// Sidebar — Aether 风格侧边栏
import { memo, useMemo, useState, Fragment } from 'react'
import { Button, Input, Popconfirm, Typography, theme } from 'antd'
import { PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { useConversationStore, useChatStore } from '../../store'
import { useUIStyle } from '../../hooks/useUIStyle'
import type { ConversationRow } from '../../../shared/types'

type DateGroup = { label: string; items: ConversationRow[] }

function groupByDate(conversations: ConversationRow[]): DateGroup[] {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterdayStart = todayStart - 86400000
    const weekStart = todayStart - 6 * 86400000
    const groups: Record<string, ConversationRow[]> = { '今天': [], '昨天': [], '近7天': [], '更早': [] }
    for (const conv of conversations) {
        const t = new Date(conv.updated_at || conv.created_at).getTime()
        if (t >= todayStart) groups['今天'].push(conv)
        else if (t >= yesterdayStart) groups['昨天'].push(conv)
        else if (t >= weekStart) groups['近7天'].push(conv)
        else groups['更早'].push(conv)
    }
    return Object.entries(groups).filter(([, items]) => items.length > 0).map(([label, items]) => ({ label, items }))
}

function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}天前`
    return new Date(dateStr).toLocaleDateString()
}

function Sidebar() {
    const { token } = theme.useToken()
    const { isGlass } = useUIStyle()
    const conversations = useConversationStore((s) => s.conversations)
    const currentConversationId = useConversationStore((s) => s.currentConversationId)
    const createConversation = useConversationStore((s) => s.createConversation)
    const switchConversation = useConversationStore((s) => s.switchConversation)
    const deleteConversation = useConversationStore((s) => s.deleteConversation)
    const renameConversation = useConversationStore((s) => s.renameConversation)
    const searchQuery = useConversationStore((s) => s.searchQuery)
    const setSearchQuery = useConversationStore((s) => s.setSearchQuery)
    const clearMessages = useChatStore((s) => s.clearMessages)

    const [editingId, setEditingId] = useState<number | null>(null)
    const [editTitle, setEditTitle] = useState('')

    const filteredConversations = useMemo(
        () => searchQuery ? conversations.filter((c) => c.title.includes(searchQuery)) : conversations,
        [conversations, searchQuery]
    )
    const dateGroups = useMemo(() => groupByDate(filteredConversations), [filteredConversations])

    const handleNew = async () => { clearMessages(); await createConversation() }
    const handleSwitch = (id: number) => { if (id !== currentConversationId) switchConversation(id) }
    const handleStartRename = (id: number, title: string) => { setEditingId(id); setEditTitle(title) }
    const handleFinishRename = async () => {
        if (editingId && editTitle.trim()) await renameConversation(editingId, editTitle.trim())
        setEditingId(null)
    }
    const isActive = (id: number) => id === currentConversationId

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 新建对话按钮 — Aether 风格 */}
            <div style={{ padding: 16 }}>
                <button
                    onClick={handleNew}
                    style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 14px',
                        background: isGlass ? 'var(--glass-card)' : 'var(--bg-content, #fff)',
                        border: `1px solid var(--border-subtle, ${token.colorBorderSecondary})`,
                        borderRadius: 12,
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        transition: 'all 0.15s ease',
                        boxShadow: 'var(--shadow-sm)',
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
                    <span style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        background: 'var(--primary-light, #eef2ff)',
                        color: 'var(--primary, #6366f1)',
                        transition: 'all 0.15s ease',
                    }}>
                        <PlusOutlined style={{ fontSize: 14 }} />
                    </span>
                    <span>新对话</span>
                </button>
            </div>

            {/* 搜索框 */}
            <div style={{ padding: '0 16px 12px' }}>
                <Input
                    placeholder="搜索会话..."
                    prefix={<SearchOutlined style={{ color: 'var(--text-tertiary)' }} />}
                    size="small"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    allowClear
                    style={{
                        borderRadius: 8,
                        background: 'var(--bg-body, #f3f4f6)',
                        border: '1px solid transparent',
                    }}
                />
            </div>

            {/* 会话列表 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
                {dateGroups.map((group) => (
                    <Fragment key={group.label}>
                        <div style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--text-tertiary)',
                            padding: '12px 8px 6px',
                            textTransform: 'uppercase',
                            letterSpacing: 0.8,
                        }}>
                            {group.label}
                        </div>

                        {group.items.map((conv) => (
                            <div
                                key={conv.id}
                                className="sidebar-conv-item"
                                onClick={() => handleSwitch(conv.id)}
                                style={{
                                    padding: '8px 10px',
                                    cursor: 'pointer',
                                    borderRadius: 8,
                                    marginBottom: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    transition: 'all 0.15s ease',
                                    background: isActive(conv.id)
                                        ? 'var(--chatgpt-sider-active, var(--glass-card, #eef2ff))'
                                        : 'transparent',
                                }}
                                onMouseEnter={(e) => {
                                    if (!isActive(conv.id))
                                        (e.currentTarget as HTMLDivElement).style.background =
                                            'var(--chatgpt-sider-hover, var(--glass-card, #f3f4f6))'
                                }}
                                onMouseLeave={(e) => {
                                    if (!isActive(conv.id))
                                        (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    {editingId === conv.id ? (
                                        <Input
                                            size="small"
                                            value={editTitle}
                                            onChange={(e) => setEditTitle(e.target.value)}
                                            onPressEnter={handleFinishRename}
                                            onBlur={handleFinishRename}
                                            autoFocus
                                            onClick={(e) => e.stopPropagation()}
                                            style={{ borderRadius: 6 }}
                                        />
                                    ) : (
                                        <Typography.Text
                                            ellipsis
                                            style={{
                                                fontSize: 13,
                                                display: 'block',
                                                color: isActive(conv.id) ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                fontWeight: isActive(conv.id) ? 500 : 400,
                                            }}
                                        >
                                            {conv.title}
                                        </Typography.Text>
                                    )}
                                </div>

                                <div
                                    className="sidebar-conv-actions"
                                    style={{ display: 'flex', gap: 2, marginLeft: 4, flexShrink: 0 }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <Button type="text" size="small" icon={<EditOutlined />}
                                        onClick={() => handleStartRename(conv.id, conv.title)}
                                        style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 24, height: 24, padding: 0 }}
                                    />
                                    <Popconfirm title="确认删除此会话？" onConfirm={() => deleteConversation(conv.id)} okText="删除" cancelText="取消">
                                        <Button type="text" size="small" icon={<DeleteOutlined />}
                                            style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 24, height: 24, padding: 0 }}
                                        />
                                    </Popconfirm>
                                </div>
                            </div>
                        ))}
                    </Fragment>
                ))}
            </div>
        </div>
    )
}

export default memo(Sidebar)
