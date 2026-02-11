// 预加载脚本 - 桥梁（主进程与渲染进程之间的安全通道）
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld('hexAgent', {
    // ==================== 数据库操作 ====================
    createConversation: (title?: string) => ipcRenderer.invoke('db:create-conversation', title),
    getConversations: () => ipcRenderer.invoke('db:get-conversations'),
    getMessages: (conversationId: number) => ipcRenderer.invoke('db:get-messages', conversationId),
    addMessage: (conversationId: number, role: string, content: string) =>
        ipcRenderer.invoke('db:add-message', conversationId, role, content),
    addToolMessage: (conversationId: number, content: string, toolName: string, toolArgs: string, toolResult: string) =>
        ipcRenderer.invoke('db:add-tool-message', conversationId, content, toolName, toolArgs, toolResult),
    updateConversation: (id: number, title: string) =>
        ipcRenderer.invoke('db:update-conversation', id, title),
    deleteConversation: (id: number) =>
        ipcRenderer.invoke('db:delete-conversation', id),
    searchMessages: (query: string) =>
        ipcRenderer.invoke('db:search-messages', query),
    clearMessages: (conversationId: number) =>
        ipcRenderer.invoke('db:clear-messages', conversationId),
    deleteMessagesAfter: (conversationId: number, afterMessageId: number) =>
        ipcRenderer.invoke('db:delete-messages-after', conversationId, afterMessageId),
    exportConversation: (conversationId: number, format: 'markdown' | 'json') =>
        ipcRenderer.invoke('db:export-conversation', conversationId, format),

    // ==================== LLM 操作 ====================
    chat: (messages: { role: string; content: string }[], options?: { provider?: string; model?: string }) =>
        ipcRenderer.invoke('llm:chat', messages, options),
    cancelChat: () => ipcRenderer.send('llm:cancel'),
    onLLMChunk: (callback: (chunk: string) => void) => {
        ipcRenderer.removeAllListeners('llm:chunk')
        ipcRenderer.on('llm:chunk', (_event, chunk) => callback(chunk))
    },
    onLLMThinking: (callback: (chunk: string) => void) => {
        ipcRenderer.removeAllListeners('llm:thinking')
        ipcRenderer.on('llm:thinking', (_event, chunk) => callback(chunk))
    },
    onLLMDone: (callback: () => void) => {
        ipcRenderer.removeAllListeners('llm:done')
        ipcRenderer.on('llm:done', () => callback())
    },
    onLLMError: (callback: (error: string) => void) => {
        ipcRenderer.removeAllListeners('llm:error')
        ipcRenderer.on('llm:error', (_event, error) => callback(error))
    },
    onLLMToolCall: (callback: (name: string, args: any) => void) => {
        ipcRenderer.removeAllListeners('llm:tool-call')
        ipcRenderer.on('llm:tool-call', (_event, name, args) => callback(name, args))
    },
    onToolResult: (callback: (toolName: string, result: string, artifacts: any[]) => void) => {
        ipcRenderer.removeAllListeners('llm:tool-result')
        ipcRenderer.on('llm:tool-result', (_event, toolName, result, artifacts) => callback(toolName, result, artifacts))
    },

    // ==================== 配置操作 ====================
    getConfig: () => ipcRenderer.invoke('config:get-all'),
    setConfig: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),

    // ==================== 设置操作 ====================
    setApiKey: (provider: string, key: string) =>
        ipcRenderer.invoke('settings:set-api-key', provider, key),
    getApiKey: (provider: string) =>
        ipcRenderer.invoke('settings:get-api-key', provider),

    // ==================== 系统操作 ====================
    selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('select-directory'),
    getAppVersion: () => ipcRenderer.invoke('app:get-version'),

    // ==================== 工具确认 ====================
    onToolConfirmRequest: (callback: (request: { id: string; title: string; message: string; detail?: string; type: string }) => void) => {
        ipcRenderer.removeAllListeners('tool:confirm-request')
        ipcRenderer.on('tool:confirm-request', (_event, request) => callback(request))
    },
    respondToolConfirm: (id: string, approved: boolean) => {
        ipcRenderer.send('tool:confirm-response', id, approved)
    },

    // ==================== 快捷键事件 ====================
    onShortcut: (action: string, callback: () => void) => {
        ipcRenderer.removeAllListeners(action)
        ipcRenderer.on(action, () => callback())
    },
})
