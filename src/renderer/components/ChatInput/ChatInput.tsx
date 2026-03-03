// ChatInput — Aether 风格浮动输入框（渐变遮罩 + shadow-float + focus ring）
import { useState } from 'react'
import { Input, theme } from 'antd'
import { SendOutlined, StopOutlined } from '@ant-design/icons'
import { useChatStore, useConversationStore } from '../../store'
import { useUIStyle } from '../../hooks/useUIStyle'

const { TextArea } = Input

function ChatInput() {
    const { token } = theme.useToken()
    const { isGlass } = useUIStyle()
    const [text, setText] = useState('')
    const [focused, setFocused] = useState(false)
    const sendMessage = useChatStore((s) => s.sendMessage)
    const isStreaming = useChatStore((s) => s.isStreaming)
    const cancelChat = useChatStore((s) => s.cancelChat)
    const currentConversationId = useConversationStore((s) => s.currentConversationId)
    const createConversation = useConversationStore((s) => s.createConversation)

    async function send() {
        if (!text.trim() || isStreaming) return
        let convId = currentConversationId
        if (!convId) convId = await createConversation(text.trim().substring(0, 30))
        const content = text
        setText('')
        sendMessage(content, convId)
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!isStreaming) send()
        }
    }

    const hasText = text.trim().length > 0

    return (
        <div
            className="input-gradient-mask"
            style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '32px 16px 16px',
                zIndex: 5,
            }}
        >
            <div style={{ maxWidth: 768, margin: '0 auto' }}>
                <div style={{
                    position: 'relative',
                    background: isGlass ? 'var(--glass-card)' : 'var(--bg-input, #fff)',
                    borderRadius: 16,
                    border: `1px solid ${focused ? 'var(--primary, #6366f1)' : 'var(--border-subtle, #e5e7eb)'}`,
                    boxShadow: focused
                        ? 'var(--shadow-float), 0 0 0 2px var(--primary-glow, rgba(99,102,241,0.15))'
                        : 'var(--shadow-float)',
                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                    ...(isGlass ? {
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                    } : {}),
                }}>
                    <TextArea
                        placeholder={isStreaming ? '正在生成回复，可继续输入，停止后发送' : '问我任何问题...'}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        autoSize={{ minRows: 1, maxRows: 6 }}
                        variant="borderless"
                        style={{
                            flex: 1,
                            resize: 'none',
                            fontSize: 14,
                            padding: '12px 52px 12px 16px',
                            background: 'transparent',
                            color: 'var(--text-primary)',
                            minHeight: 48,
                        }}
                    />
                    {/* 发送/停止按钮 — 嵌在右下角 */}
                    <button
                        onClick={isStreaming ? cancelChat : send}
                        disabled={!isStreaming && !hasText}
                        style={{
                            position: 'absolute',
                            right: 8,
                            bottom: 8,
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            border: 'none',
                            cursor: (!isStreaming && !hasText) ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 16,
                            transition: 'all 0.15s ease',
                            ...(isStreaming ? {
                                background: token.colorError,
                                color: '#fff',
                            } : hasText ? {
                                background: 'var(--primary, #6366f1)',
                                color: '#fff',
                                boxShadow: 'var(--shadow-sm)',
                            } : {
                                background: 'var(--bg-body, #f3f4f6)',
                                color: 'var(--text-tertiary, #9ca3af)',
                            }),
                        }}
                    >
                        {isStreaming ? <StopOutlined /> : <SendOutlined />}
                    </button>
                </div>
                {isStreaming && (
                    <div style={{ marginTop: 8, paddingLeft: 4, fontSize: 12, color: 'var(--text-tertiary)' }}>
                        正在生成回复，可继续输入；停止后即可发送。
                    </div>
                )}
            </div>
        </div>
    )
}

export default ChatInput
