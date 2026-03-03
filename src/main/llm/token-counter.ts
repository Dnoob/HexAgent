// Token 估算模块 — 不依赖 tiktoken，使用近似算法
import type { ChatMessage } from './types'

/**
 * 估算文本 token 数量（近似值）
 * - CJK 字符：约 1 token/字符
 * - ASCII 字符：约 0.25 token/字符（即 ~4 字符/token）
 */
export function estimateTokens(text: string): number {
    if (!text) return 0

    let tokens = 0
    for (const char of text) {
        const code = char.charCodeAt(0)
        if (
            (code >= 0x4E00 && code <= 0x9FFF) ||  // CJK 统一汉字
            (code >= 0x3400 && code <= 0x4DBF) ||  // CJK 扩展 A
            (code >= 0x3000 && code <= 0x303F) ||  // CJK 符号和标点
            (code >= 0xFF00 && code <= 0xFFEF)     // 全角形式
        ) {
            tokens += 1
        } else {
            tokens += 0.25
        }
    }

    return Math.ceil(tokens)
}

/** 估算单条消息的 token 数（包含角色标记等开销） */
function estimateMessageTokens(msg: ChatMessage): number {
    let tokens = 4 // 消息格式开销（role, separators）
    tokens += estimateTokens(msg.content || '')
    if (msg.reasoning_content) {
        tokens += estimateTokens(msg.reasoning_content)
    }
    if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
            tokens += estimateTokens(tc.function.name)
            tokens += estimateTokens(tc.function.arguments)
            tokens += 4 // tool_call 格式开销
        }
    }
    return tokens
}

/** 估算整个消息列表的 token 数 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
    let total = 3 // 对话格式开销（begin/end tokens）
    for (const msg of messages) {
        total += estimateMessageTokens(msg)
    }
    return total
}

/**
 * 裁剪消息以适应上下文窗口
 *
 * 策略：保留 system 消息 + 尽可能多的最近消息
 * 当总 token 数超过 maxTokens 的 80% 时触发裁剪
 */
export function trimMessages(messages: ChatMessage[], contextWindow: number): ChatMessage[] {
    const maxTokens = Math.floor(contextWindow * 0.8) // 留 20% 给回复
    const total = estimateMessagesTokens(messages)

    if (total <= maxTokens) return messages

    // 分离 system 消息和非 system 消息
    const systemMsgs = messages.filter(m => m.role === 'system')
    const nonSystemMsgs = messages.filter(m => m.role !== 'system')

    const systemTokens = systemMsgs.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
    const available = maxTokens - systemTokens

    if (available <= 0) {
        // system 消息本身就超限，只保留 system + 最后一条
        return [...systemMsgs, nonSystemMsgs[nonSystemMsgs.length - 1]]
    }

    // 从最近的消息开始，尽可能多地保留
    const kept: ChatMessage[] = []
    let usedTokens = 0

    for (let i = nonSystemMsgs.length - 1; i >= 0; i--) {
        const msgTokens = estimateMessageTokens(nonSystemMsgs[i])
        if (usedTokens + msgTokens > available) break
        kept.unshift(nonSystemMsgs[i])
        usedTokens += msgTokens
    }

    // 至少保留最后一条消息
    if (kept.length === 0 && nonSystemMsgs.length > 0) {
        kept.push(nonSystemMsgs[nonSystemMsgs.length - 1])
    }

    return [...systemMsgs, ...kept]
}

/**
 * 压缩消息历史：将旧消息压缩为摘要，保留最近的消息
 *
 * - 触发阈值：70% 上下文窗口（低于截断的 80%，留空间给摘要）
 * - 最少 6 条消息才压缩，否则 fallback 到 trimMessages
 * - 保留最近 ~40% 窗口的消息，更早的消息通过 LLM 生成摘要
 * - summarize 回调由调用方注入，解耦 token-counter 与 provider
 */
export async function compressMessages(
    messages: ChatMessage[],
    contextWindow: number,
    summarize: (text: string) => Promise<string>
): Promise<ChatMessage[]> {
    const threshold = Math.floor(contextWindow * 0.7)
    const total = estimateMessagesTokens(messages)

    if (total <= threshold) return messages

    // 分离 system 和非 system
    const systemMsgs = messages.filter(m => m.role === 'system')
    const nonSystemMsgs = messages.filter(m => m.role !== 'system')

    // 消息太少，fallback 到 trimMessages
    if (nonSystemMsgs.length < 6) {
        return trimMessages(messages, contextWindow)
    }

    // 计算保留最近 ~40% 窗口的消息
    const systemTokens = systemMsgs.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
    const keepBudget = Math.floor(contextWindow * 0.4) - systemTokens
    const recentMsgs: ChatMessage[] = []
    let recentTokens = 0

    for (let i = nonSystemMsgs.length - 1; i >= 0; i--) {
        const t = estimateMessageTokens(nonSystemMsgs[i])
        if (recentTokens + t > keepBudget) break
        recentMsgs.unshift(nonSystemMsgs[i])
        recentTokens += t
    }

    // 至少保留最后 2 条
    if (recentMsgs.length < 2) {
        recentMsgs.length = 0
        recentMsgs.push(...nonSystemMsgs.slice(-2))
    }

    // 需要压缩的旧消息
    const oldCount = nonSystemMsgs.length - recentMsgs.length
    if (oldCount < 2) {
        return trimMessages(messages, contextWindow)
    }

    const oldMsgs = nonSystemMsgs.slice(0, oldCount)

    // 格式化旧消息为文本
    const oldText = oldMsgs.map(m => {
        const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : m.role
        const text = m.content || ''
        // 工具调用只保留名称
        const toolInfo = m.tool_calls
            ? `\n[调用工具: ${m.tool_calls.map(tc => tc.function.name).join(', ')}]`
            : ''
        // 截断过长的单条消息
        const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text
        return `${role}: ${truncated}${toolInfo}`
    }).join('\n')

    // 调用 LLM 生成摘要
    const summaryPrompt = `请用中文总结以下对话历史的要点，不超过 500 字。重点保留：用户的需求、AI 的关键决策、已完成的操作、重要的文件路径和代码变更。\n\n${oldText}`
    const summary = await summarize(summaryPrompt)

    // 组装：system + 摘要 system 消息 + 保留的最近消息
    const summaryMsg: ChatMessage = {
        role: 'system',
        content: `[对话历史摘要]\n${summary}`,
    }

    return [...systemMsgs, summaryMsg, ...recentMsgs]
}

/** 各模型的上下文窗口大小（token 数） */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    // OpenAI
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'o1': 200000,
    'o3-mini': 200000,
    // Anthropic
    'claude-sonnet-4-20250514': 200000,
    'claude-opus-4-20250514': 200000,
    'claude-haiku-4-20250514': 200000,
    // Kimi
    'kimi-K2.5': 131072,
    'moonshot-v1-8k': 8192,
    'moonshot-v1-32k': 32768,
    // DeepSeek
    'deepseek-chat': 65536,
    'deepseek-reasoner': 65536,
    // MiniMax
    'MiniMax-M2.1': 200000,
    // Ollama (conservative defaults)
    'llama3': 8192,
    'qwen2.5': 32768,
    'deepseek-r1': 65536,
}

/** 获取模型的上下文窗口大小，未知模型返回保守默认值 */
export function getContextWindow(model: string): number {
    return MODEL_CONTEXT_WINDOWS[model] || 8192
}
