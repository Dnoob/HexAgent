// MarkdownRenderer — Markdown 渲染（语法高亮 + GFM 支持）
import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { theme } from 'antd'
import 'highlight.js/styles/vs2015.css'
import CodeBlock from './CodeBlock'

interface Props {
    content: string
}

function MarkdownRenderer({ content }: Props) {
    const { token } = theme.useToken()

    return (
        <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
                // 代码块 → CodeBlock 组件
                code({ className, children, ...props }) {
                    const isInline = !className
                    if (isInline) {
                        return (
                            <code
                                style={{
                                    background: token.colorFillTertiary,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    fontSize: '0.9em',
                                }}
                                {...props}
                            >
                                {children}
                            </code>
                        )
                    }
                    return <CodeBlock className={className}>{children}</CodeBlock>
                },
                // 表格样式
                table({ children }) {
                    return (
                        <div style={{ overflow: 'auto', margin: '8px 0' }}>
                            <table style={{
                                borderCollapse: 'collapse',
                                width: '100%',
                                fontSize: 14,
                            }}>
                                {children}
                            </table>
                        </div>
                    )
                },
                th({ children }) {
                    return (
                        <th style={{
                            border: `1px solid ${token.colorBorderSecondary}`,
                            padding: '8px 12px',
                            background: token.colorFillQuaternary,
                            textAlign: 'left',
                        }}>
                            {children}
                        </th>
                    )
                },
                td({ children }) {
                    return (
                        <td style={{
                            border: `1px solid ${token.colorBorderSecondary}`,
                            padding: '8px 12px',
                        }}>
                            {children}
                        </td>
                    )
                },
                // 链接在新窗口打开
                a({ href, children }) {
                    return (
                        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: token.colorPrimary }}>
                            {children}
                        </a>
                    )
                },
            }}
        >
            {content}
        </Markdown>
    )
}

export default memo(MarkdownRenderer)
