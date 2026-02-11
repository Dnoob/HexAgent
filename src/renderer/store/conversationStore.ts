// src/renderer/store/conversationStore.ts — 会话管理状态
import { create } from 'zustand'
import type { ConversationRow } from '../../shared/types'

interface ConversationState {
    conversations: ConversationRow[]
    currentConversationId: number | null
    searchQuery: string

    loadConversations: () => Promise<void>
    createConversation: (title?: string) => Promise<number>
    switchConversation: (id: number) => void
    renameConversation: (id: number, title: string) => Promise<void>
    deleteConversation: (id: number) => Promise<void>
    setSearchQuery: (query: string) => void
}

export const useConversationStore = create<ConversationState>((set, get) => ({
    conversations: [],
    currentConversationId: null,
    searchQuery: '',

    loadConversations: async () => {
        const conversations = await window.hexAgent.getConversations()
        set({ conversations })
    },

    createConversation: async (title?: string) => {
        const id = await window.hexAgent.createConversation(title || '新对话')
        await get().loadConversations()
        set({ currentConversationId: id })
        return id
    },

    switchConversation: (id: number) => {
        set({ currentConversationId: id })
    },

    renameConversation: async (id: number, title: string) => {
        await window.hexAgent.updateConversation(id, title)
        await get().loadConversations()
    },

    deleteConversation: async (id: number) => {
        await window.hexAgent.deleteConversation(id)
        const { currentConversationId } = get()
        if (currentConversationId === id) {
            set({ currentConversationId: null })
        }
        await get().loadConversations()
    },

    setSearchQuery: (query: string) => {
        set({ searchQuery: query })
    },
}))
