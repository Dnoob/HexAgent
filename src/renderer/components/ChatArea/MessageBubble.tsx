// MessageBubble — Aether 风格消息（方圆角头像 + 发送者名称 + 无气泡）
import { memo, useState, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { Button, Collapse, Tooltip, Input, Space, theme } from 'antd'
import {
    UserOutlined,
    RobotOutlined,
    ToolOutlined,
    CopyOutlined,
    CheckOutlined,
    ReloadOutlined,
    CodeOutlined,
    FileTextOutlined,
    EditOutlined,
    FolderOpenOutlined,
    SearchOutlined,
    ExclamationCircleOutlined,
    SendOutlined,
    CloseOutlined,
    BulbOutlined,
} from '@ant-design/icons'
import MarkdownRenderer from './MarkdownRenderer'
import CodeBlock from './CodeBlock'
import InlineArtifact from './InlineArtifact'
import { useUIStyle } from '../../hooks/useUIStyle'
import type { Message } from '../../store'

interface Props {
    message: Message
    messageIndex?: number
    isLastAssistant?: boolean
    onRetry?: () => void
    onEditAndResend?: (messageIndex: number, newContent: string) => void
    isStreaming?: boolean
}

const toolIconMap: Record<string, { icon: ReactNode; label: string }> = {
    read_file:       { icon: <FileTextOutlined />,   label: '读取文件' },
    write_file:      { icon: <EditOutlined />,       label: '写入文件' },
    list_directory:  { icon: <FolderOpenOutlined />, label: '列出目录' },
    search_files:    { icon: <SearchOutlined />,     label: '搜索文件' },
    execute_python:  { icon: <CodeOutlined />,       label: '执行 Python' },
    run_command:     { icon: <CodeOutlined />,       label: '执行命令' },
}

const RESULT_TRUNCATE_LINES = 20

function isErrorResult(text: string): boolean {
    const lower = text.toLowerCase()
    return lower.startsWith('error:') || lower.startsWith('错误') ||
        lower.includes('traceback') || lower.includes('exception') ||
        lower.includes('permission denied') || lower.includes('not found') ||
        /^(errno|oserror|filenotfounderror|permissionerror)/i.test(lower)
}

function formatJson(raw: string): string {
    try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw }
}

function ToolResultContent({ content, toolName, token: designToken }: {
    content: string; toolName?: string; token: ReturnType<typeof theme.useToken>['token']
}) {
    const [expanded, setExpanded] = useState(false)
    if (!content) return null

    if (isErrorResult(content)) {
        return (
            <div style={{
                background: designToken.colorErrorBg, border: `1px solid ${designToken.colorErrorBorder}`,
                borderRadius: 6, padding: '8px 12px', fontSize: 12, color: designToken.colorErrorText,
                display: 'flex', alignItems: 'flex-start', gap: 6,
            }}>
                <ExclamationCircleOutlined style={{ marginTop: 2, flexShrink: 0 }} />
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>{content}</pre>
            </div>
        )
    }

    if (toolName === 'list_directory') {
        const lines = content.split('\n').filter(Boolean)
        const displayLines = expanded ? lines : lines.slice(0, RESULT_TRUNCATE_LINES)
        return (
            <div>
                <div style={{ background: designToken.colorFillQuaternary, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: 'monospace', lineHeight: '20px' }}>
                    {displayLines.map((line, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FolderOpenOutlined style={{ fontSize: 11, color: designToken.colorTextQuaternary }} /><span>{line}</span>
                        </div>
                    ))}
                </div>
                {lines.length > RESULT_TRUNCATE_LINES && (
                    <Button type="link" size="small" onClick={() => setExpanded(!expanded)} style={{ fontSize: 11, padding: '2px 0', height: 'auto' }}>
                        {expanded ? '收起' : `展开全部 (${lines.length} 项)`}
                    </Button>
                )}
            </div>
        )
    }

    const looksLikeCode = toolName === 'read_file' || /^(import |from |def |class |function |const |let |var |#include|package )/.test(content.trimStart())
    if (looksLikeCode) {
        const lines = content.split('\n')
        const needsTruncation = lines.length > RESULT_TRUNCATE_LINES && !expanded
        const displayContent = needsTruncation ? lines.slice(0, RESULT_TRUNCATE_LINES).join('\n') + '\n...' : content
        return (
            <div>
                <CodeBlock>{displayContent}</CodeBlock>
                {lines.length > RESULT_TRUNCATE_LINES && (
                    <Button type="link" size="small" onClick={() => setExpanded(!expanded)} style={{ fontSize: 11, padding: '2px 0', height: 'auto' }}>
                        {expanded ? '收起' : `展开全部 (${lines.length} 行)`}
                    </Button>
                )}
            </div>
        )
    }

    const lines = content.split('\n')
    const needsTruncation = lines.length > RESULT_TRUNCATE_LINES && !expanded
    const displayContent = needsTruncation ? lines.slice(0, RESULT_TRUNCATE_LINES).join('\n') + '\n...' : content
    return (
        <div>
            <pre style={{ background: designToken.colorFillQuaternary, padding: 8, borderRadius: 6, overflow: 'auto', maxHeight: expanded ? 'none' : 400, fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '20px' }}>
                {displayContent}
            </pre>
            {lines.length > RESULT_TRUNCATE_LINES && (
                <Button type="link" size="small" onClick={() => setExpanded(!expanded)} style={{ fontSize: 11, padding: '2px 0', height: 'auto' }}>
                    {expanded ? '收起' : `展开全部 (${lines.length} 行)`}
                </Button>
            )}
        </div>
    )
}

function MessageBubble({ message, messageIndex, isLastAssistant, onRetry, onEditAndResend, isStreaming }: Props) {
    const { role, content, tokenCount, toolName, toolArgs, toolResult, thinkingContent } = message
    const [hovered, setHovered] = useState(false)
    const [copied, setCopied] = useState(false)
    const [editing, setEditing] = useState(false)
    const [editContent, setEditContent] = useState('')
    const copyTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const { token } = theme.useToken()
    const { isGlass } = useUIStyle()

    // ==================== 工具消息（紧凑单行） ====================
    if (role === 'tool') {
        const toolInfo = toolName ? toolIconMap[toolName] : undefined
        const displayIcon = toolInfo?.icon ?? <ToolOutlined />
        const displayLabel = toolInfo?.label ?? toolName ?? '工具调用'
        const rc = content || toolResult || ''
        const hasError = rc ? isErrorResult(rc) : false
        const formattedArgs = useMemo(() => toolArgs ? formatJson(toolArgs) : null, [toolArgs])

        // 生成摘要文字
        const getSummary = () => {
            if (!rc) return '执行中...'
            if (hasError) return '失败'
            if (rc.startsWith('用户拒绝')) return '已拒绝'
            if (toolName === 'list_directory') {
                const count = rc.split('\n').filter(Boolean).length
                return `${count} 项`
            }
            if (toolName === 'read_file') {
                const lines = rc.split('\n').length
                return `${lines} 行`
            }
            if (toolName === 'write_file') return '完成'
            if (toolName === 'execute_python' || toolName === 'run_command') {
                const lines = rc.split('\n').filter(Boolean).length
                return lines > 0 ? `${lines} 行输出` : '完成'
            }
            return '完成'
        }

        // 提取关键参数简要信息
        const getArgHint = () => {
            if (!toolArgs) return null
            try {
                const parsed = JSON.parse(toolArgs)
                if (parsed.path) return parsed.path.split(/[/\\]/).pop()
                if (parsed.command) return parsed.command.length > 40 ? parsed.command.substring(0, 40) + '...' : parsed.command
                if (parsed.code) {
                    const firstLine = parsed.code.split('\n')[0]
                    return firstLine.length > 40 ? firstLine.substring(0, 40) + '...' : firstLine
                }
                if (parsed.directory) return parsed.directory.split(/[/\\]/).pop()
            } catch { /* ignore */ }
            return null
        }

        const [expanded, setExpanded] = useState(false)
        const argHint = getArgHint()
        const hasDetail = !!(formattedArgs || rc)

        return (
            <div className="fade-in" style={{ padding: '2px 0', marginLeft: 44 }}>
                {/* 单行摘要 */}
                <div
                    onClick={() => hasDetail && setExpanded(!expanded)}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '4px 10px', borderRadius: 6,
                        fontSize: 12, color: 'var(--text-tertiary)',
                        cursor: hasDetail ? 'pointer' : 'default',
                        transition: 'background 0.15s',
                        background: expanded ? (isGlass ? 'var(--glass-card)' : token.colorFillQuaternary) : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (hasDetail) e.currentTarget.style.background = isGlass ? 'var(--glass-card)' : token.colorFillQuaternary }}
                    onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = 'transparent' }}
                >
                    <span style={{ display: 'flex', fontSize: 13, color: hasError ? token.colorError : 'var(--primary, #6366f1)' }}>{displayIcon}</span>
                    <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{displayLabel}</span>
                    {argHint && <span style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace', fontSize: 11 }}>{argHint}</span>}
                    <span style={{ color: hasError ? token.colorError : token.colorSuccess, fontSize: 11 }}>
                        {hasError ? <><ExclamationCircleOutlined /> {getSummary()}</> : <>
                            <CheckOutlined style={{ fontSize: 10 }} /> {getSummary()}
                        </>}
                    </span>
                    {hasDetail && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▶</span>}
                </div>

                {/* 展开详情 */}
                {expanded && (
                    <div style={{ marginTop: 4, marginLeft: 10, paddingLeft: 10, borderLeft: `2px solid var(--border-subtle, #e5e7eb)` }}>
                        {formattedArgs && (
                            <div style={{ marginBottom: 6 }}>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2 }}>参数</div>
                                <CodeBlock className="language-json">{formattedArgs}</CodeBlock>
                            </div>
                        )}
                        {rc && (
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2 }}>结果</div>
                                <ToolResultContent content={rc} toolName={toolName} token={token} />
                            </div>
                        )}
                    </div>
                )}

                {/* 内嵌图片（始终可见，不受展开状态影响） */}
                {message.artifacts && message.artifacts.length > 0 && (
                    <InlineArtifact artifacts={message.artifacts} />
                )}
            </div>
        )
    }

    const isUser = role === 'user'

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(content).then(() => {
            setCopied(true)
            clearTimeout(copyTimerRef.current)
            copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
        })
    }, [content])

    // ==================== 消息内容样式 ====================
    const getGlassStyle = (): React.CSSProperties => {
        if (isUser) return {
            background: 'var(--glass-user-bg)', backdropFilter: 'blur(12px)', border: '1px solid var(--glass-user-border)',
            padding: '10px 14px', borderRadius: 16, wordBreak: 'break-word', lineHeight: 1.6, fontSize: 14, width: 'fit-content', maxWidth: '85%',
        }
        return {
            background: 'var(--glass-assistant-bg)', backdropFilter: 'blur(12px)', border: '1px solid var(--glass-assistant-border)',
            padding: '10px 14px', borderRadius: 16, wordBreak: 'break-word', lineHeight: 1.6, fontSize: 14,
        }
    }

    return (
        <div
            className="fade-in"
            style={{ display: 'flex', gap: 12, padding: '16px 0', position: 'relative' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* 头像 — 方圆角 */}
            <div style={{
                width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, flexShrink: 0, boxShadow: 'var(--shadow-sm)',
                ...(isUser ? {
                    background: 'var(--avatar-user-bg, #fff)',
                    border: `1px solid var(--avatar-user-border, #e5e7eb)`,
                    color: 'var(--text-secondary)',
                } : {
                    background: `linear-gradient(135deg, var(--avatar-ai-from, #6366f1), var(--avatar-ai-to, #8b5cf6))`,
                    color: '#fff',
                    border: 'none',
                }),
            }}>
                {isUser ? <UserOutlined /> : <RobotOutlined />}
            </div>

            {/* 消息内容 */}
            <div style={{ flex: 1, minWidth: 0 }}>
                {/* 发送者名称 + 时间 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {isUser ? '你' : 'HexAgent'}
                    </span>
                    {hovered && tokenCount != null && tokenCount > 0 && !isUser && (
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', transition: 'opacity 0.15s' }}>
                            ~{tokenCount} tokens
                        </span>
                    )}
                </div>

                {/* 思考过程 */}
                {!isUser && thinkingContent && (() => {
                    const stillThinking = isStreaming && isLastAssistant && !content
                    return (
                        <Collapse
                            size="small"
                            defaultActiveKey={stillThinking ? ['thinking'] : []}
                            items={[{
                                key: 'thinking',
                                label: (
                                    <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                                        <BulbOutlined /><span>思考过程</span>
                                        {stillThinking && <>
                                            <style>{`@keyframes thinking-dot { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }`}</style>
                                            {[0, 1, 2].map((i) => <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-tertiary)', display: 'inline-block', animation: `thinking-dot 1.4s ease-in-out ${i * 0.2}s infinite` }} />)}
                                        </>}
                                    </span>
                                ),
                                children: <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{thinkingContent}</div>,
                            }]}
                            style={{ marginBottom: 6, background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8 }}
                        />
                    )
                })()}

                {/* 消息正文 */}
                {isUser && editing ? (
                    <div style={{ background: token.colorBgContainer, padding: '10px 14px', borderRadius: 12, border: `1px solid var(--primary, #6366f1)` }}>
                        <Input.TextArea value={editContent} onChange={(e) => setEditContent(e.target.value)} autoSize={{ minRows: 2, maxRows: 10 }} style={{ fontSize: 14, marginBottom: 8 }} autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditing(false)
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = editContent.trim(); if (t && onEditAndResend && messageIndex != null) { setEditing(false); onEditAndResend(messageIndex, t) } }
                            }}
                        />
                        <Space size={8} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button size="small" icon={<CloseOutlined />} onClick={() => setEditing(false)}>取消</Button>
                            <Button type="primary" size="small" icon={<SendOutlined />} disabled={!editContent.trim()}
                                onClick={() => { const t = editContent.trim(); if (t && onEditAndResend && messageIndex != null) { setEditing(false); onEditAndResend(messageIndex, t) } }}>发送</Button>
                        </Space>
                    </div>
                ) : isGlass ? (
                    <div style={getGlassStyle()}>
                        {isUser ? <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span> : <MarkdownRenderer content={content} />}
                    </div>
                ) : (
                    <div style={{ wordBreak: 'break-word', lineHeight: 1.7, fontSize: 15, color: 'var(--text-primary)' }}>
                        {isUser ? <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span> : <MarkdownRenderer content={content} />}
                    </div>
                )}

                {/* 操作按钮 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, minHeight: 22 }}>
                    {isUser && hovered && !editing && !isStreaming && onEditAndResend && (
                        <Tooltip title="编辑">
                            <Button type="text" size="small" icon={<EditOutlined />}
                                onClick={() => { setEditContent(content); setEditing(true) }}
                                style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '0 4px', height: 22 }} />
                        </Tooltip>
                    )}
                    {!isUser && hovered && (
                        <>
                            <Tooltip title={copied ? '已复制' : '复制'}>
                                <Button type="text" size="small"
                                    icon={copied ? <CheckOutlined style={{ color: token.colorSuccess }} /> : <CopyOutlined />}
                                    onClick={handleCopy}
                                    style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '0 4px', height: 22 }} />
                            </Tooltip>
                            {isLastAssistant && onRetry && (
                                <Tooltip title="重新生成">
                                    <Button type="text" size="small" icon={<ReloadOutlined />} onClick={onRetry}
                                        style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '0 4px', height: 22 }} />
                                </Tooltip>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

export default memo(MessageBubble)
