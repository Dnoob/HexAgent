// WelcomeScreen — Aether 风格欢迎页
import { RobotOutlined, FileExcelOutlined, CodeOutlined, FolderOpenOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { theme } from 'antd'
import { useSettingsStore, useChatStore, useConversationStore } from '../../store'
import { useUIStyle } from '../../hooks/useUIStyle'

const quickTemplates = [
    { icon: <FileExcelOutlined style={{ fontSize: 20 }} />, title: '分析 Excel 数据', prompt: '帮我分析一份 Excel 文件的数据，生成统计摘要和图表' },
    { icon: <CodeOutlined style={{ fontSize: 20 }} />, title: '编写 Python 脚本', prompt: '帮我写一个 Python 脚本，用于批量处理文件' },
    { icon: <FolderOpenOutlined style={{ fontSize: 20 }} />, title: '整理文件目录', prompt: '帮我整理当前工作目录下的文件，按类型分类归档' },
    { icon: <QuestionCircleOutlined style={{ fontSize: 20 }} />, title: '回答技术问题', prompt: '我有一个技术问题想请教你' },
]

function WelcomeScreen() {
    const config = useSettingsStore((s) => s.config)
    const sendMessage = useChatStore((s) => s.sendMessage)
    const currentConversationId = useConversationStore((s) => s.currentConversationId)
    const createConversation = useConversationStore((s) => s.createConversation)
    const { token } = theme.useToken()
    const { isGlass } = useUIStyle()

    const handleTemplateClick = async (prompt: string) => {
        let convId = currentConversationId
        if (!convId) convId = await createConversation(prompt.substring(0, 30))
        sendMessage(prompt, convId)
    }

    const modelLabel = config?.activeModel || '未配置'

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
            <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
                {/* Logo */}
                <div style={{
                    width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px',
                    background: `linear-gradient(135deg, var(--avatar-ai-from, #6366f1), var(--avatar-ai-to, #8b5cf6))`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: 'var(--shadow-md)',
                }}>
                    <RobotOutlined style={{ fontSize: 28, color: '#fff' }} />
                </div>

                <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                    HexAgent
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
                    你的 AI 助手，可以帮助你处理文件、编写代码、回答问题。
                </div>

                {/* 模型标签 */}
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 12px', borderRadius: 20,
                    background: 'var(--primary-light, #eef2ff)',
                    border: `1px solid var(--border-focus, #c7d2fe)`,
                    fontSize: 11, fontWeight: 600, color: 'var(--primary, #6366f1)',
                    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 32,
                }}>
                    {modelLabel}
                </div>

                {/* 快捷模板 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    {quickTemplates.map((tpl) => (
                        <button
                            key={tpl.title}
                            onClick={() => handleTemplateClick(tpl.prompt)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
                                border: `1px solid var(--border-subtle, ${token.colorBorderSecondary})`,
                                background: isGlass ? 'var(--glass-card)' : 'var(--bg-content, #fff)',
                                color: 'var(--text-primary)',
                                fontSize: 13, fontWeight: 500, textAlign: 'left',
                                transition: 'all 0.15s ease',
                                boxShadow: 'var(--shadow-sm)',
                                ...(isGlass ? { backdropFilter: 'blur(10px)' } : {}),
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.boxShadow = 'var(--shadow-md)'
                                e.currentTarget.style.borderColor = 'var(--primary, #6366f1)'
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
                                e.currentTarget.style.borderColor = `var(--border-subtle, ${token.colorBorderSecondary})`
                            }}
                        >
                            <span style={{ color: 'var(--primary, #6366f1)', display: 'flex' }}>{tpl.icon}</span>
                            <span>{tpl.title}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default WelcomeScreen
