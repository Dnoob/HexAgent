// src/renderer/store/settingsStore.ts — 设置/配置状态
import { create } from 'zustand'
import type { AppConfig, MCPPromptDetail, MCPResourceDetail, MCPServerConfig, MCPServerStatus } from '../../shared/types'

interface SettingsState {
    config: AppConfig | null
    isLoading: boolean
    mcpStatuses: MCPServerStatus[]

    loadConfig: () => Promise<void>
    updateConfig: (key: string, value: any) => Promise<void>
    setApiKey: (provider: string, key: string) => Promise<void>
    refreshMcpStatuses: () => Promise<void>
    refreshMcpServers: () => Promise<void>
    refreshMcpServer: (serverId: string) => Promise<MCPServerStatus>
    testMcpServer: (config: MCPServerConfig) => Promise<MCPServerStatus>
    getMcpServerDetails: (serverId: string) => Promise<{
        status: MCPServerStatus
        prompts: import('../../shared/types').MCPPromptSummary[]
        resources: import('../../shared/types').MCPResourceSummary[]
    }>
    getMcpPrompt: (serverId: string, promptName: string) => Promise<MCPPromptDetail>
    readMcpResource: (serverId: string, uri: string) => Promise<MCPResourceDetail>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    config: null,
    isLoading: false,
    mcpStatuses: [],

    loadConfig: async () => {
        set({ isLoading: true })
        try {
            const config = await window.hexAgent.getConfig()
            const mcpStatuses = await window.hexAgent.getMcpStatuses()
            set({ config, mcpStatuses })
        } catch (e) {
            console.error('Failed to load config:', e)
        } finally {
            set({ isLoading: false })
        }
    },

    updateConfig: async (key: string, value: any) => {
        await window.hexAgent.setConfig(key, value)
        // 更新本地状态
        const config = get().config
        if (config) {
            set({ config: { ...config, [key]: value } })
        }
        if (key === 'mcpServers') {
            await get().refreshMcpStatuses()
        }
    },

    setApiKey: async (provider: string, key: string) => {
        await window.hexAgent.setApiKey(provider, key)
    },

    refreshMcpStatuses: async () => {
        const mcpStatuses = await window.hexAgent.getMcpStatuses()
        set({ mcpStatuses })
    },

    refreshMcpServers: async () => {
        const mcpStatuses = await window.hexAgent.refreshMcpServers()
        set({ mcpStatuses })
    },

    refreshMcpServer: async (serverId: string) => {
        const status = await window.hexAgent.refreshMcpServer(serverId)
        const statuses = get().mcpStatuses
        const next = statuses.some((item) => item.serverId === serverId)
            ? statuses.map((item) => item.serverId === serverId ? status : item)
            : [...statuses, status]
        set({ mcpStatuses: next })
        return status
    },

    testMcpServer: async (config: MCPServerConfig) => {
        return window.hexAgent.testMcpServer(config)
    },

    getMcpServerDetails: async (serverId: string) => {
        return window.hexAgent.getMcpServerDetails(serverId)
    },

    getMcpPrompt: async (serverId: string, promptName: string) => {
        return window.hexAgent.getMcpPrompt(serverId, promptName)
    },

    readMcpResource: async (serverId: string, uri: string) => {
        return window.hexAgent.readMcpResource(serverId, uri)
    },
}))
