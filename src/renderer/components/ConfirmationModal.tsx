// ConfirmationModal — 工具执行确认弹窗（替代原生 dialog）
import { Modal, Button, Typography } from 'antd'
import { FileTextOutlined, CodeOutlined, ConsoleSqlOutlined, ExclamationCircleFilled } from '@ant-design/icons'
import { useUIStore } from '../store'

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    file: { icon: <FileTextOutlined />, color: '#f59e0b', label: '写入文件' },
    python: { icon: <CodeOutlined />, color: '#6366f1', label: 'Python 代码' },
    command: { icon: <ConsoleSqlOutlined />, color: '#10b981', label: 'Shell 命令' },
    default: { icon: <ExclamationCircleFilled />, color: '#6366f1', label: '操作确认' },
}

function ConfirmationModal() {
    const confirmRequest = useUIStore((s) => s.confirmRequest)
    const clearConfirm = useUIStore((s) => s.clearConfirm)

    if (!confirmRequest) return null

    const cfg = TYPE_CONFIG[confirmRequest.type] || TYPE_CONFIG.default

    const handleRespond = (approved: boolean) => {
        window.hexAgent.respondToolConfirm(confirmRequest.id, approved)
        clearConfirm()
    }

    return (
        <Modal
            open
            centered
            closable={false}
            maskClosable={false}
            width={520}
            title={null}
            footer={null}
            styles={{
                body: { padding: 0 },
                mask: { backdropFilter: 'blur(4px)' },
            }}
        >
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '20px 24px 16px',
            }}>
                <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: `${cfg.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, color: cfg.color,
                }}>
                    {cfg.icon}
                </div>
                <div>
                    <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>
                        {confirmRequest.title}
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        {cfg.label}
                    </Typography.Text>
                </div>
            </div>

            {/* Message */}
            <div style={{ padding: '0 24px 12px' }}>
                <div style={{
                    fontSize: 13, color: 'var(--text-secondary)',
                    padding: '8px 12px',
                    background: 'var(--chatgpt-sider-hover, #f3f4f6)',
                    borderRadius: 8,
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                }}>
                    {confirmRequest.message}
                </div>
            </div>

            {/* Detail (code block) */}
            {confirmRequest.detail && (
                <div style={{ padding: '0 24px 16px' }}>
                    <pre style={{
                        margin: 0,
                        padding: 14,
                        background: '#1e293b',
                        color: '#e2e8f0',
                        borderRadius: 10,
                        fontSize: 12,
                        lineHeight: 1.6,
                        maxHeight: 280,
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                    }}>
                        {confirmRequest.detail}
                    </pre>
                </div>
            )}

            {/* Actions */}
            <div style={{
                display: 'flex', justifyContent: 'flex-end', gap: 8,
                padding: '12px 24px 20px',
                borderTop: '1px solid var(--border-subtle, #e5e7eb)',
            }}>
                <Button
                    onClick={() => handleRespond(false)}
                    style={{ borderRadius: 8, height: 36 }}
                >
                    拒绝
                </Button>
                <Button
                    type="primary"
                    onClick={() => handleRespond(true)}
                    style={{
                        borderRadius: 8, height: 36,
                        background: cfg.color,
                        borderColor: cfg.color,
                    }}
                >
                    允许执行
                </Button>
            </div>
        </Modal>
    )
}

export default ConfirmationModal
