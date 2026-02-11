// CodeBlock — 代码块组件（行号 + 语言 badge + 复制按钮 + 语法高亮）
import { memo, useState } from 'react'
import { Button, message } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'

interface Props {
    className?: string
    children: React.ReactNode
}

function CodeBlock({ className, children }: Props) {
    const [copied, setCopied] = useState(false)
    const code = String(children).replace(/\n$/, '')
    const language = className?.replace('language-', '') || ''
    const lineCount = code.split('\n').length

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            message.error('复制失败')
        }
    }

    // Generate line numbers string
    const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')

    return (
        <div style={{
            position: 'relative',
            background: '#1e1e1e',
            borderRadius: 8,
            margin: '8px 0',
            overflow: 'hidden',
            fontSize: 13,
        }}>
            {/* 顶栏：语言 badge + 复制按钮 */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 8px 4px 12px',
                background: '#2d2d2d',
                borderBottom: '1px solid #3a3a3a',
            }}>
                {language ? (
                    <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        color: '#569cd6',
                        background: 'rgba(86,156,214,0.12)',
                        padding: '2px 8px',
                        borderRadius: 4,
                    }}>
                        {language}
                    </span>
                ) : (
                    <span />
                )}
                <Button
                    type="text"
                    size="small"
                    icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                    style={{
                        color: copied ? '#73d13d' : '#999',
                        fontSize: 12,
                    }}
                    onClick={handleCopy}
                >
                    {copied ? '已复制' : '复制'}
                </Button>
            </div>

            {/* 代码内容（带行号） */}
            <div style={{ display: 'flex', overflow: 'auto' }}>
                {/* 行号 */}
                <pre style={{
                    margin: 0,
                    padding: '12px 12px 12px 14px',
                    textAlign: 'right',
                    userSelect: 'none',
                    color: '#5a5a5a',
                    fontSize: 12,
                    lineHeight: '20px',
                    fontFamily: 'monospace',
                    borderRight: '1px solid #333',
                    flexShrink: 0,
                }}>
                    {lineNumbers}
                </pre>

                {/* 代码 */}
                <pre style={{
                    margin: 0,
                    padding: '12px 16px 12px 12px',
                    overflow: 'auto',
                    flex: 1,
                    lineHeight: '20px',
                }}>
                    <code className={className} style={{ color: '#d4d4d4', fontSize: 13 }}>
                        {children}
                    </code>
                </pre>
            </div>
        </div>
    )
}

export default memo(CodeBlock)
