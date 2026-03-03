// App — 主布局（Aether 设计语言：浮动卡片 + 渐变遮罩输入）
import { useEffect, lazy, Suspense } from 'react'
import { Layout } from 'antd'
import Sidebar from './components/Sidebar/Sidebar'
import ChatHeader from './components/ChatHeader/ChatHeader'
import ChatArea from './components/ChatArea/ChatArea'
import ChatInput from './components/ChatInput/ChatInput'
import { useChatStore, useConversationStore, useSettingsStore, useUIStore } from './store'
import { useUIStyle } from './hooks/useUIStyle'
import ConfirmationModal from './components/ConfirmationModal'
import type { ToolConfirmRequest } from '../shared/types'

const SettingsModal = lazy(() => import('./components/Settings/SettingsModal'))
const { Sider } = Layout

function App() {
    const { isGlass } = useUIStyle()
    const initListeners = useChatStore((s) => s.initListeners)
    const loadConversations = useConversationStore((s) => s.loadConversations)
    const currentConversationId = useConversationStore((s) => s.currentConversationId)
    const conversations = useConversationStore((s) => s.conversations)
    const loadConfig = useSettingsStore((s) => s.loadConfig)
    const loadMessages = useChatStore((s) => s.loadMessages)
    const clearMessages = useChatStore((s) => s.clearMessages)
    const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

    useEffect(() => {
        const cleanup = initListeners()
        loadConversations()
        loadConfig()
        return cleanup
    }, [])

    useEffect(() => {
        if (currentConversationId) {
            loadMessages(currentConversationId)
        } else {
            clearMessages()
        }
    }, [currentConversationId])

    useEffect(() => {
        if (conversations.length > 0 && !currentConversationId) {
            useConversationStore.getState().switchConversation(conversations[0].id)
        }
    }, [conversations])

    useEffect(() => {
        const api = window.hexAgent
        if (api?.onToolConfirmRequest) {
            api.onToolConfirmRequest((request: ToolConfirmRequest) => {
                useUIStore.getState().showConfirm(request)
            })
        }
    }, [])

    useEffect(() => {
        const api = window.hexAgent
        if (!api?.onShortcut) return
        api.onShortcut('shortcut:new-conversation', () => {
            useConversationStore.getState().createConversation()
        })
        api.onShortcut('shortcut:toggle-sidebar', () => {
            useUIStore.getState().toggleSidebar()
        })
        api.onShortcut('shortcut:open-settings', () => {
            useUIStore.getState().openSettings()
        })
        api.onShortcut('shortcut:cancel-generation', () => {
            const { isStreaming, cancelChat } = useChatStore.getState()
            if (isStreaming) cancelChat()
        })
    }, [])

    if (isGlass) {
        return (
            <div className="app-root-glass">
                <Layout style={{ height: '100vh', background: 'transparent' }}>
                    <Sider
                        width={280}
                        collapsedWidth={0}
                        collapsed={sidebarCollapsed}
                        style={{
                            overflow: 'hidden',
                            background: 'var(--glass-panel)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            borderRight: '1px solid var(--glass-border)',
                        }}
                        trigger={null}
                    >
                        <Sidebar />
                    </Sider>
                    <Layout style={{ display: 'flex', flexDirection: 'column', background: 'transparent' }}>
                        <ChatHeader />
                        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                            <ChatArea />
                            <ChatInput />
                        </div>
                    </Layout>
                    <Suspense fallback={null}><SettingsModal /></Suspense>
                    <ConfirmationModal />
                </Layout>
            </div>
        )
    }

    // Aether 风格：主内容区浮动卡片
    return (
        <Layout style={{ height: '100vh', background: 'var(--bg-body, #f3f4f6)' }}>
            <Sider
                width={280}
                collapsedWidth={0}
                collapsed={sidebarCollapsed}
                style={{
                    background: 'var(--bg-sidebar, #fff)',
                    overflow: 'hidden',
                    borderRight: 'none',
                }}
                trigger={null}
            >
                <Sidebar />
            </Sider>

            <Layout
                className="content-card"
                style={{ display: 'flex', flexDirection: 'column' }}
            >
                <ChatHeader />
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    <ChatArea />
                    <ChatInput />
                </div>
            </Layout>
            <Suspense fallback={null}><SettingsModal /></Suspense>
            <ConfirmationModal />
        </Layout>
    )
}

export default App
