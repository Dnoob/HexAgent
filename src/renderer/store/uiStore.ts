// src/renderer/store/uiStore.ts — UI 状态
import { create } from 'zustand'
import type { ToolConfirmRequest } from '@shared/types'

interface UIState {
    sidebarCollapsed: boolean
    settingsModalOpen: boolean
    confirmRequest: ToolConfirmRequest | null

    toggleSidebar: () => void
    openSettings: () => void
    closeSettings: () => void
    showConfirm: (request: ToolConfirmRequest) => void
    clearConfirm: () => void
}

export const useUIStore = create<UIState>((set) => ({
    sidebarCollapsed: false,
    settingsModalOpen: false,
    confirmRequest: null,

    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    openSettings: () => set({ settingsModalOpen: true }),
    closeSettings: () => set({ settingsModalOpen: false }),
    showConfirm: (request) => set({ confirmRequest: request }),
    clearConfirm: () => set({ confirmRequest: null }),
}))
