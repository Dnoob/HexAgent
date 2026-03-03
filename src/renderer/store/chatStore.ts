// src/renderer/store/chatStore.ts — 聊天消息状态管理
import { create } from 'zustand'
import { useConversationStore } from './conversationStore'
import type { Plan } from '@shared/types'

export interface Message {
    id?: number
    role: 'user' | 'assistant' | 'tool'
    content: string
    thinkingContent?: string
    tokenCount?: number
    toolName?: string
    toolArgs?: string
    toolResult?: string
    artifacts?: Array<{ type: 'image'; name: string; base64: string }>
    plan?: Plan
}

/** 错误类型分类 */
export type ChatErrorType = 'network' | 'auth' | 'rate_limit' | 'unknown'

export interface ChatError {
    type: ChatErrorType
    message: string
}

/** 解析错误字符串，返回分类后的 ChatError */
function classifyError(raw: string): ChatError {
    const lower = raw.toLowerCase()
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('authentication')) {
        return { type: 'auth', message: 'API 密钥无效或已过期，请检查设置中的 API Key 配置。' }
    }
    if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota') || lower.includes('too many requests')) {
        return { type: 'rate_limit', message: 'API 调用额度已用尽或请求过于频繁，请稍后再试。' }
    }
    if (lower.includes('fetch') || lower.includes('network') || lower.includes('econnrefused') || lower.includes('timeout') || lower.includes('enotfound') || lower.includes('socket')) {
        return { type: 'network', message: '网络连接失败，请检查网络设置和 API 地址配置。' }
    }
    return { type: 'unknown', message: raw }
}

/** 粗略估算 token 数（CJK ~1 token/char, ASCII ~0.25 token/char） */
function estimateTokens(text: string): number {
    let count = 0
    for (const ch of text) {
        count += ch.charCodeAt(0) > 0x7f ? 1 : 0.25
    }
    return Math.ceil(count)
}

interface ChatState {
    messages: Message[]
    isStreaming: boolean
    error: ChatError | null

    loadMessages: (conversationId: number) => Promise<void>
    sendMessage: (text: string, conversationId: number) => Promise<void>
    retryLastAssistant: (conversationId: number) => Promise<void>
    editAndResend: (conversationId: number, messageIndex: number, newContent: string) => Promise<void>
    cancelChat: () => void
    clearError: () => void
    clearMessages: () => void

    /** 初始化 IPC 监听器（只调用一次，返回清理函数） */
    initListeners: () => () => void
}

export const useChatStore = create<ChatState>((set, get) => {
    // 闭包变量：流式过程中累积的完整内容
    let streamingContent = ''
    // 闭包变量：流式过程中累积的思考内容
    let streamingThinkingContent = ''
    // 当前会话 ID（由 sendMessage 设置，供 onDone 回调使用）
    let activeConversationId: number | null = null

    /** 异步生成会话标题（基于用户第一条消息） */
    async function generateTitle(convId: number, userText: string) {
        try {
            const convStore = useConversationStore.getState()
            const conv = convStore.conversations.find((c) => c.id === convId)
            if (!conv || conv.title !== '新对话') return

            const title = await window.hexAgent.generateTitle(convId, userText)
            if (title) {
                await convStore.loadConversations()
            }
        } catch {
            // 标题生成失败，静默忽略
        }
    }

    return {
        messages: [],
        isStreaming: false,
        error: null,

        loadMessages: async (conversationId: number) => {
            const rows = await window.hexAgent.getMessages(conversationId)
            const messages: Message[] = rows.map((row: any) => ({
                id: row.id,
                role: row.role,
                content: row.content,
                tokenCount: row.token_count || undefined,
                toolName: row.tool_name || undefined,
                toolArgs: row.tool_args || undefined,
                toolResult: row.tool_result || undefined,
            }))
            set({ messages })
        },

        sendMessage: async (text: string, conversationId: number) => {
            if (get().isStreaming) return
            activeConversationId = conversationId
            set({ error: null })

            // 1. 用户消息写入数据库
            await window.hexAgent.addMessage(conversationId, 'user', text)
            await get().loadMessages(conversationId)

            // 2. 添加空 assistant 消息 + 开始流式
            streamingContent = ''
            streamingThinkingContent = ''
            set((state) => ({
                messages: [...state.messages, { role: 'assistant', content: '' }],
                isStreaming: true,
            }))

            // 3. 发起 LLM 调用（传入对话历史，不包含最后一条空消息）
            // 过滤掉 tool 消息：tool 消息仅用于 UI 展示，实际工具调用在 agent loop 内完成
            const history = get().messages.slice(0, -1)
                .filter((m) => m.role !== 'tool')
                .map((m) => ({ role: m.role, content: m.content }))
            await window.hexAgent.chat(history)
        },

        retryLastAssistant: async (conversationId: number) => {
            if (get().isStreaming) return
            const { messages } = get()
            // 找到最后一条 user 消息
            let lastUserIndex = -1
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    lastUserIndex = i
                    break
                }
            }
            if (lastUserIndex === -1) return

            // 移除最后一条 user 消息之后的所有消息（包括 assistant 和 tool）
            const trimmedMessages = messages.slice(0, lastUserIndex + 1)
            set({ messages: trimmedMessages, error: null })

            // 开始重新生成
            activeConversationId = conversationId
            streamingContent = ''
            streamingThinkingContent = ''
            set((state) => ({
                messages: [...state.messages, { role: 'assistant', content: '' }],
                isStreaming: true,
            }))

            const history = trimmedMessages
                .filter((m) => m.role !== 'tool')
                .map((m) => ({ role: m.role, content: m.content }))
            await window.hexAgent.chat(history)
        },

        editAndResend: async (conversationId: number, messageIndex: number, newContent: string) => {
            if (get().isStreaming) return
            const { messages } = get()
            const targetMsg = messages[messageIndex]
            if (!targetMsg || targetMsg.role !== 'user') return

            // 1. Delete messages after the target message in DB
            if (targetMsg.id != null) {
                // Delete the target message and all after it by deleting after the previous message
                // We need to find the message just before the target
                const prevMsg = messageIndex > 0 ? messages[messageIndex - 1] : null
                if (prevMsg?.id != null) {
                    await window.hexAgent.deleteMessagesAfter(conversationId, prevMsg.id)
                } else {
                    // Target is the first message, clear all messages
                    await window.hexAgent.clearMessages(conversationId)
                }
            }

            // 2. Truncate local messages to before the target message
            const trimmedMessages = messages.slice(0, messageIndex)
            set({ messages: trimmedMessages, error: null })

            // 3. Add the new user message to DB
            await window.hexAgent.addMessage(conversationId, 'user', newContent)
            await get().loadMessages(conversationId)

            // 4. Start streaming (same as sendMessage)
            activeConversationId = conversationId
            streamingContent = ''
            streamingThinkingContent = ''
            set((state) => ({
                messages: [...state.messages, { role: 'assistant', content: '' }],
                isStreaming: true,
            }))

            const history = get().messages.slice(0, -1)
                .filter((m) => m.role !== 'tool')
                .map((m) => ({ role: m.role, content: m.content }))
            await window.hexAgent.chat(history)
        },

        cancelChat: () => {
            window.hexAgent.cancelChat()
            set({ isStreaming: false })
        },

        clearError: () => set({ error: null }),
        clearMessages: () => set({ messages: [], error: null }),

        initListeners: () => {
            // 工具调用通知
            window.hexAgent.onLLMToolCall((name, args) => {
                const argsStr = typeof args === 'string' ? args : JSON.stringify(args, null, 2)
                set((state) => {
                    const msgs = [...state.messages]
                    // 在最后一条 assistant 消息前插入工具消息
                    msgs.splice(msgs.length - 1, 0, {
                        role: 'tool',
                        content: `调用工具: ${name}`,
                        toolName: name,
                        toolArgs: argsStr,
                    })
                    return { messages: msgs }
                })
            })

            // 工具结果回传（含 artifacts）
            window.hexAgent.onToolResult((toolName, result, artifacts) => {
                set((state) => {
                    const msgs = [...state.messages]
                    // 从后往前找最后一条匹配的 tool 消息
                    for (let i = msgs.length - 1; i >= 0; i--) {
                        if (msgs[i].role === 'tool' && msgs[i].toolName === toolName && !msgs[i].toolResult) {
                            msgs[i] = { ...msgs[i], toolResult: result, artifacts }
                            // 存入数据库（artifacts 太大不存，仅当前会话可见）
                            if (activeConversationId) {
                                window.hexAgent.addToolMessage(
                                    activeConversationId,
                                    msgs[i].content,
                                    toolName,
                                    msgs[i].toolArgs || '',
                                    result
                                )
                            }
                            break
                        }
                    }
                    return { messages: msgs }
                })
            })

            // Plan 更新
            window.hexAgent.onLLMPlanUpdate((plan) => {
                set((state) => {
                    const msgs = [...state.messages]
                    // 更新最后一条 assistant 消息的 plan
                    for (let i = msgs.length - 1; i >= 0; i--) {
                        if (msgs[i].role === 'assistant') {
                            msgs[i] = { ...msgs[i], plan }
                            break
                        }
                    }
                    return { messages: msgs }
                })
            })

            // 流式思考内容（reasoning_split 通道）
            window.hexAgent.onLLMThinking((chunk) => {
                streamingThinkingContent += chunk
                set((state) => {
                    const msgs = [...state.messages]
                    const last = msgs[msgs.length - 1]
                    msgs[msgs.length - 1] = { ...last, thinkingContent: streamingThinkingContent }
                    return { messages: msgs }
                })
            })

            // 流式 token
            window.hexAgent.onLLMChunk((chunk) => {
                streamingContent += chunk
                set((state) => {
                    const msgs = [...state.messages]
                    const last = msgs[msgs.length - 1]
                    msgs[msgs.length - 1] = { ...last, content: streamingContent }
                    return { messages: msgs }
                })
            })

            // 完成
            window.hexAgent.onLLMDone(async () => {
                const convId = activeConversationId
                let content = streamingContent
                let thinkingContent = streamingThinkingContent

                // Fallback: parse <think>...</think> tags if no thinking came via reasoning_split
                if (!thinkingContent && content) {
                    const thinkMatch = content.match(/^<think>([\s\S]*?)<\/think>\s*/)
                    if (thinkMatch) {
                        thinkingContent = thinkMatch[1].trim()
                        content = content.slice(thinkMatch[0].length)
                    }
                }

                const tokens = estimateTokens(content)
                set((state) => {
                    const msgs = [...state.messages]
                    if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
                        msgs[msgs.length - 1] = {
                            ...msgs[msgs.length - 1],
                            content,
                            tokenCount: tokens,
                            ...(thinkingContent ? { thinkingContent } : {}),
                        }
                    }
                    return { messages: msgs, isStreaming: false }
                })
                if (convId && content) {
                    // 保存 artifacts（base64 太大不存 DB，仅内存保留）
                    // 按 tool 消息的顺序依次记录，reload 后按相同顺序还原
                    const toolArtifactsList: (Message['artifacts'] | undefined)[] = []
                    get().messages.forEach((m) => {
                        if (m.role === 'tool') {
                            toolArtifactsList.push(m.artifacts)
                        }
                    })

                    await window.hexAgent.addMessage(convId, 'assistant', content)
                    await get().loadMessages(convId)

                    // 将 artifacts 合并回 reload 后的消息
                    if (toolArtifactsList.some(a => a && a.length > 0)) {
                        set((state) => {
                            const msgs = [...state.messages]
                            let toolIdx = 0
                            for (let i = 0; i < msgs.length; i++) {
                                if (msgs[i].role === 'tool') {
                                    const arts = toolArtifactsList[toolIdx]
                                    if (arts && arts.length > 0) {
                                        msgs[i] = { ...msgs[i], artifacts: arts }
                                    }
                                    toolIdx++
                                }
                            }
                            return { messages: msgs }
                        })
                    }

                    // 用用户第一条消息作为标题
                    const msgs = get().messages
                    const firstUser = msgs.find((m) => m.role === 'user')
                    if (firstUser) {
                        generateTitle(convId, firstUser.content)
                    }
                }
            })

            // 错误
            window.hexAgent.onLLMError((error) => {
                set({ error: classifyError(error), isStreaming: false })
            })

            // 返回清理函数（目前 removeAllListeners 在 preload 中处理）
            return () => {}
        },
    }
})
