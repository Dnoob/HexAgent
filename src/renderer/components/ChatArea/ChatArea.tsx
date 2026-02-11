// ChatArea — 消息区域（底部留白给浮动输入框）
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Alert, Button } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import { useChatStore, useConversationStore, useUIStore } from '../../store'
import MessageBubble from './MessageBubble'
import ThinkingIndicator from './ThinkingIndicator'
import WelcomeScreen from './WelcomeScreen'

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

    useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages, isStreaming])

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

                {messages.map((msg, index) => (
                    <MessageBubble
                        key={`${msg.role}-${index}-${msg.content.slice(0, 20)}`}
                        message={msg}
                        messageIndex={index}
                        isLastAssistant={index === lastAssistantIndex}
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
            </div>
        </div>
    )
}

export default ChatArea
