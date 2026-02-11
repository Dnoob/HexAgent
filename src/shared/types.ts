// src/shared/types.ts — 全局共享类型（类似 C++ 公共头文件）

// ==================== IPC 频道名 ====================
export const IpcChannels = {
    // 数据库
    DB_CREATE_CONVERSATION: 'db:create-conversation',
    DB_GET_CONVERSATIONS: 'db:get-conversations',
    DB_GET_MESSAGES: 'db:get-messages',
    DB_ADD_MESSAGE: 'db:add-message',
    DB_UPDATE_CONVERSATION: 'db:update-conversation',
    DB_DELETE_CONVERSATION: 'db:delete-conversation',
    DB_SEARCH_MESSAGES: 'db:search-messages',
    DB_CLEAR_MESSAGES: 'db:clear-messages',
    DB_DELETE_MESSAGES_AFTER: 'db:delete-messages-after',
    DB_ADD_TOOL_MESSAGE: 'db:add-tool-message',
    DB_EXPORT_CONVERSATION: 'db:export-conversation',
    // LLM
    LLM_CHAT: 'llm:chat',
    LLM_CHUNK: 'llm:chunk',
    LLM_DONE: 'llm:done',
    LLM_ERROR: 'llm:error',
    LLM_THINKING: 'llm:thinking',
    LLM_TOOL_CALL: 'llm:tool-call',
    LLM_TOOL_RESULT: 'llm:tool-result',
    LLM_CANCEL: 'llm:cancel',
    // 配置
    CONFIG_GET: 'config:get',
    CONFIG_SET: 'config:set',
    CONFIG_GET_ALL: 'config:get-all',
    // 设置
    SETTINGS_SET_API_KEY: 'settings:set-api-key',
    SETTINGS_GET_API_KEY: 'settings:get-api-key',
    // 系统
    SELECT_DIRECTORY: 'select-directory',
    GET_APP_VERSION: 'app:get-version',
    // 快捷键事件（主进程 → 渲染进程）
    SHORTCUT_NEW_CONVERSATION: 'shortcut:new-conversation',
    SHORTCUT_TOGGLE_SIDEBAR: 'shortcut:toggle-sidebar',
    SHORTCUT_OPEN_SETTINGS: 'shortcut:open-settings',
    SHORTCUT_CANCEL_GENERATION: 'shortcut:cancel-generation',
    // 工具确认（主进程 ↔ 渲染进程）
    TOOL_CONFIRM_REQUEST: 'tool:confirm-request',
    TOOL_CONFIRM_RESPONSE: 'tool:confirm-response',
} as const

// ==================== 数据库行类型 ====================
export interface ConversationRow {
    id: number
    title: string
    model?: string
    provider?: string
    created_at: string
    updated_at: string
}

export interface MessageRow {
    id: number
    conversation_id: number
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string
    tool_name?: string
    tool_args?: string
    tool_result?: string
    token_count?: number
    created_at: string
}

// ==================== UI 类型 ====================
export type UIStyle = 'chatgpt' | 'glass'

// ==================== LLM 类型 ====================
export type LLMProviderType = 'openai' | 'anthropic' | 'kimi' | 'deepseek' | 'minimax' | 'ollama'
export type AuthMode = 'api' | 'coding-plan'

export interface LLMProviderConfig {
    type: LLMProviderType
    name: string
    baseURL: string
    models: string[]
    defaultModel: string
    supportsStreaming: boolean
    supportsTools: boolean
    supportsVision: boolean
    supportsReasoningSplit?: boolean
    defaultHeaders?: Record<string, string>
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string | null
    tool_calls?: ToolCallInfo[]
    tool_call_id?: string
    reasoning_content?: string
}

export interface ToolCallInfo {
    id: string
    function: { name: string; arguments: string }
}

// ==================== Artifact 类型 ====================
export interface Artifact {
    type: 'image'
    name: string
    base64: string  // data:image/png;base64,...
}

// ==================== 应用配置 ====================
export interface AppConfig {
    activeProvider: LLMProviderType
    activeModel: string
    authMode: AuthMode
    theme: 'light' | 'dark' | 'system'
    uiStyle: UIStyle
    workingDirectory: string
    allowedDirectories: string[]
    maxToolIterations: number
    temperature: number
    maxTokens: number
    autoApproveTools: boolean
    systemPrompt: string
    windowState?: {
        width: number
        height: number
        x?: number
        y?: number
        maximized: boolean
    }
}

// ==================== Preload API 类型 ====================
export interface HexAgentAPI {
    // 数据库
    createConversation: (title?: string) => Promise<number>
    getConversations: () => Promise<ConversationRow[]>
    getMessages: (conversationId: number) => Promise<MessageRow[]>
    addMessage: (conversationId: number, role: string, content: string) => Promise<void>
    addToolMessage: (conversationId: number, content: string, toolName: string, toolArgs: string, toolResult: string) => Promise<void>
    updateConversation: (id: number, title: string) => Promise<void>
    deleteConversation: (id: number) => Promise<void>
    searchMessages: (query: string) => Promise<MessageRow[]>
    clearMessages: (conversationId: number) => Promise<void>
    deleteMessagesAfter: (conversationId: number, afterMessageId: number) => Promise<void>
    exportConversation: (conversationId: number, format: 'markdown' | 'json') => Promise<boolean>

    // LLM
    chat: (messages: { role: string; content: string }[], options?: { provider?: string; model?: string }) => Promise<void>
    cancelChat: () => void
    onLLMChunk: (callback: (chunk: string) => void) => void
    onLLMThinking: (callback: (chunk: string) => void) => void
    onLLMDone: (callback: () => void) => void
    onLLMError: (callback: (error: string) => void) => void
    onLLMToolCall: (callback: (name: string, args: any) => void) => void
    onToolResult: (callback: (toolName: string, result: string, artifacts: Artifact[]) => void) => void

    // 配置
    getConfig: () => Promise<AppConfig>
    setConfig: (key: string, value: any) => Promise<void>

    // 设置
    setApiKey: (provider: string, key: string) => Promise<void>
    getApiKey: (provider: string) => Promise<string | null>

    // 系统
    selectDirectory: () => Promise<string | null>
    getAppVersion: () => Promise<string>

    // 工具确认
    onToolConfirmRequest: (callback: (request: { id: string; title: string; message: string; detail?: string; type: string }) => void) => void
    respondToolConfirm: (id: string, approved: boolean) => void

    // 快捷键事件监听
    onShortcut: (action: string, callback: () => void) => void
}
