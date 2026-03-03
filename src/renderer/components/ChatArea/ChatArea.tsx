// ChatArea — 消息区域（底部留白给浮动输入框）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button } from 'antd'
import { SettingOutlined, VerticalAlignBottomOutlined } from '@ant-design/icons'
import { useChatStore, useConversationStore, useUIStore } from '../../store'
import type { Message } from '../../store'
import MessageBubble from './MessageBubble'
import ThinkingIndicator from './ThinkingIndicator'
import WelcomeScreen from './WelcomeScreen'

interface MessageGroup {
    message: Message
    index: number
    toolMessages: Message[]
}

const BOTTOM_THRESHOLD = 96

function ChatArea() {
    const messages = useChatStore((s) => s.messages)
    const isStreaming = useChatStore((s) => s.isStreaming)
    const error = useChatStore((s) => s.error)
    const clearError = useChatStore((s) => s.clearError)
    const retryLastAssistant = useChatStore((s) => s.retryLastAssistant)
    const editAndResend = useChatStore((s) => s.editAndResend)
    const currentConversationId = useConversationStore((s) => s.currentConversationId)
    const openSettings = useUIStore((s) => s.openSettings)
    const scrollRef = useRef<HTMLDivElement>(null)
    const nearBottomRef = useRef(true)
    const [isNearBottom, setIsNearBottom] = useState(true)

    const updateScrollState = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        const nextIsNearBottom = distanceFromBottom <= BOTTOM_THRESHOLD
        nearBottomRef.current = nextIsNearBottom
        setIsNearBottom(nextIsNearBottom)
    }, [])

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTo({ top: el.scrollHeight, behavior })
        requestAnimationFrame(updateScrollState)
    }, [updateScrollState])

    useEffect(() => {
        nearBottomRef.current = true
        setIsNearBottom(true)
    }, [currentConversationId])

    useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        if (nearBottomRef.current) {
            el.scrollTo({
                top: el.scrollHeight,
                behavior: isStreaming ? 'auto' : 'smooth',
            })
        }

        requestAnimationFrame(updateScrollState)
    }, [messages, isStreaming, updateScrollState])

    // 将 tool 消息归组到后续的 assistant 消息上
    const messageGroups = useMemo(() => {
        const groups: MessageGroup[] = []
        let pendingTools: Message[] = []

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i]
            if (msg.role === 'tool') {
                pendingTools.push(msg)
            } else {
                groups.push({
                    message: msg,
                    index: i,
                    toolMessages: msg.role === 'assistant' ? pendingTools : [],
                })
                pendingTools = []
            }
        }
        return groups
    }, [messages])

    const lastAssistantIndex = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') return i
        }
        return -1
    }, [messages])

    const handleRetry = useCallback(() => {
        if (currentConversationId) retryLastAssistant(currentConversationId)
    }, [currentConversationId, retryLastAssistant])

    const handleEditAndResend = useCallback((messageIndex: number, newContent: string) => {
        if (currentConversationId) editAndResend(currentConversationId, messageIndex, newContent)
    }, [currentConversationId, editAndResend])

    const showScrollToBottom = messages.length > 0 && !isNearBottom

    if (messages.length === 0 && !isStreaming) return <WelcomeScreen />

    function getErrorTitle() {
        if (!error) return '错误'
        switch (error.type) {
            case 'auth': return '认证失败'
            case 'rate_limit': return '额度不足'
            case 'network': return '网络错误'
            default: return '请求失败'
        }
    }

    return (
        <div
            ref={scrollRef}
            onScroll={updateScrollState}
            style={{
                height: '100%',
                overflow: 'auto',
                scrollBehavior: 'smooth',
            }}
        >
            <div style={{
                maxWidth: 768,
                margin: '0 auto',
                padding: '16px 16px 140px',
            }}>
                {error && (
                    <Alert
                        message={getErrorTitle()}
                        description={
                            <div>
                                <div>{error.message}</div>
                                {error.type === 'auth' && (
                                    <Button size="small" icon={<SettingOutlined />} onClick={openSettings} style={{ marginTop: 8 }}>
                                        打开设置
                                    </Button>
                                )}
                            </div>
                        }
                        type="error"
                        closable
                        onClose={clearError}
                        style={{ marginBottom: 12 }}
                    />
                )}

                {messageGroups.map((group) => (
                    <MessageBubble
                        key={`${group.message.role}-${group.index}-${group.message.content.slice(0, 20)}`}
                        message={group.message}
                        messageIndex={group.index}
                        toolMessages={group.toolMessages.length > 0 ? group.toolMessages : undefined}
                        isLastAssistant={group.index === lastAssistantIndex}
                        onRetry={!isStreaming ? handleRetry : undefined}
                        onEditAndResend={!isStreaming ? handleEditAndResend : undefined}
                        isStreaming={isStreaming}
                    />
                ))}

                {isStreaming && messages.length > 0 &&
                    messages[messages.length - 1].content === '' &&
                    !messages[messages.length - 1].thinkingContent && (
                    <ThinkingIndicator />
                )}

                {showScrollToBottom && (
                    <div style={{
                        position: 'sticky',
                        bottom: 152,
                        display: 'flex',
                        justifyContent: 'flex-end',
                        pointerEvents: 'none',
                        paddingTop: 12,
                    }}>
                        <Button
                            type="default"
                            shape="round"
                            size="small"
                            icon={<VerticalAlignBottomOutlined />}
                            onClick={() => scrollToBottom('smooth')}
                            style={{
                                pointerEvents: 'auto',
                                boxShadow: 'var(--shadow-md)',
                            }}
                        >
                            回到底部
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default ChatArea
