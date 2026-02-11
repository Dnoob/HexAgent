// ChatHeader — Aether 风格顶栏（半透明 + backdrop-blur + 模型标签）
import { useMemo, useCallback } from 'react'
import { Button, Typography, Dropdown, Modal, message, theme } from 'antd'
import {
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    SettingOutlined,
    DownloadOutlined,
    ClearOutlined,
} from '@ant-design/icons'
import { useUIStore, useConversationStore, useChatStore, useSettingsStore } from '../../store'
import { useUIStyle } from '../../hooks/useUIStyle'

function ChatHeader() {
    const { token } = theme.useToken()
    const { isGlass } = useUIStyle()
    const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
    const toggleSidebar = useUIStore((s) => s.toggleSidebar)
    const openSettings = useUIStore((s) => s.openSettings)
    const currentId = useConversationStore((s) => s.currentConversationId)
    const conversations = useConversationStore((s) => s.conversations)
    const messages = useChatStore((s) => s.messages)
    const clearMessages = useChatStore((s) => s.clearMessages)
    const loadMessages = useChatStore((s) => s.loadMessages)
    const config = useSettingsStore((s) => s.config)

    const currentTitle = conversations.find((c) => c.id === currentId)?.title || 'HexAgent'
    const modelLabel = config?.activeModel || ''

    const totalTokens = useMemo(
        () => messages.reduce((sum, m) => sum + (m.tokenCount || 0), 0),
        [messages]
    )
    const hasMessages = messages.length > 0
    const hasConversation = currentId !== null

    const handleExport = useCallback(async (format: 'markdown' | 'json') => {
        if (!currentId) return
        try {
            const success = await window.hexAgent.exportConversation(currentId, format)
            if (success) message.success('导出成功')
        } catch (err: any) {
            message.error(`导出失败: ${err.message || err}`)
        }
    }, [currentId])

    const handleClearMessages = useCallback(() => {
        if (!currentId) return
        Modal.confirm({
            title: '清空消息',
            content: '确定要清空当前对话的所有消息吗？此操作不可撤销。',
            okText: '确定',
            cancelText: '取消',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await window.hexAgent.clearMessages(currentId)
                    clearMessages()
                    await loadMessages(currentId)
                    message.success('消息已清空')
                } catch (err: any) {
                    message.error(`清空失败: ${err.message || err}`)
                }
            },
        })
    }, [currentId, clearMessages, loadMessages])

    const exportMenuItems = useMemo(() => [
        { key: 'md', label: '导出为 Markdown', onClick: () => handleExport('markdown') },
        { key: 'json', label: '导出为 JSON', onClick: () => handleExport('json') },
    ], [handleExport])

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            height: 52,
            borderBottom: `1px solid var(--border-subtle, ${token.colorBorderSecondary})`,
            background: isGlass ? 'var(--glass-panel)' : 'var(--bg-content, #fff)',
            backdropFilter: isGlass ? 'blur(20px)' : 'blur(8px)',
            WebkitBackdropFilter: isGlass ? 'blur(20px)' : 'blur(8px)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
        }}>
            {/* 左侧 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Button
                    type="text"
                    icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                    onClick={toggleSidebar}
                    style={{ color: 'var(--text-secondary)' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Typography.Text strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                        {currentTitle}
                    </Typography.Text>
                    {modelLabel && (
                        <span style={{
                            padding: '1px 8px',
                            borderRadius: 20,
                            background: 'var(--primary-light, #eef2ff)',
                            color: 'var(--primary, #6366f1)',
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                            border: `1px solid var(--border-focus, #c7d2fe)`,
                        }}>
                            {modelLabel}
                        </span>
                    )}
                </div>
            </div>

            {/* 右侧 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {totalTokens > 0 && (
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>
                        ~{totalTokens} tokens
                    </Typography.Text>
                )}
                {hasConversation && hasMessages && (
                    <>
                        <Dropdown menu={{ items: exportMenuItems }} placement="bottomRight">
                            <Button type="text" icon={<DownloadOutlined />} style={{ color: 'var(--text-secondary)' }} />
                        </Dropdown>
                        <Button type="text" icon={<ClearOutlined />} onClick={handleClearMessages} style={{ color: 'var(--text-secondary)' }} />
                    </>
                )}
                <Button type="text" icon={<SettingOutlined />} onClick={openSettings} style={{ color: 'var(--text-secondary)' }} />
            </div>
        </div>
    )
}

export default ChatHeader
