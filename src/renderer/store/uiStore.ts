// src/renderer/store/uiStore.ts — UI 状态
import { create } from 'zustand'

export interface ConfirmRequest {
    id: string
    title: string
    message: string
    detail?: string
    type: string // 'file' | 'python' | 'command' | 'default'
}

interface UIState {
    sidebarCollapsed: boolean
    settingsModalOpen: boolean
    confirmRequest: ConfirmRequest | null

    toggleSidebar: () => void
    openSettings: () => void
    closeSettings: () => void
    showConfirm: (request: ConfirmRequest) => void
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
