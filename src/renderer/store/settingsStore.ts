// src/renderer/store/settingsStore.ts — 设置/配置状态
import { create } from 'zustand'
import type { AppConfig } from '../../shared/types'

interface SettingsState {
    config: AppConfig | null
    isLoading: boolean

    loadConfig: () => Promise<void>
    updateConfig: (key: string, value: any) => Promise<void>
    setApiKey: (provider: string, key: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    config: null,
    isLoading: false,

    loadConfig: async () => {
        set({ isLoading: true })
        try {
            const config = await window.hexAgent.getConfig()
            set({ config })
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
    },

    setApiKey: async (provider: string, key: string) => {
        await window.hexAgent.setApiKey(provider, key)
    },
}))
