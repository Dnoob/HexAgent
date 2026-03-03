// 主进程入口
import { llmManager } from './llm/manager'
import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { createConversation, getConversations, getMessages, addMessage, addToolMessage, updateConversation, deleteConversation, searchMessages, clearMessages, getConversation, deleteMessagesAfter } from './database'
import fs from 'fs'
import { configManager } from './config'
import { logger } from './logger'
import type { LLMProviderType, ChatMessage, MessageRow, ConversationRow, MCPServerConfig } from '../shared/types'
import path from 'path'
import { mcpManager } from './mcp/manager'

let mainWindow: BrowserWindow | null = null

// ==================== 窗口状态持久化 ====================

/** 简单防抖：在 delay 毫秒内多次调用只执行最后一次 */
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
    let timer: ReturnType<typeof setTimeout> | undefined
    return ((...args: any[]) => {
        clearTimeout(timer)
        timer = setTimeout(() => fn(...args), delay)
    }) as unknown as T
}

function saveWindowState(): void {
    if (!mainWindow) return
    try {
        const maximized = mainWindow.isMaximized()
        // 最大化时用已保存的位置，否则读当前位置
        const saved = configManager.get('windowState')
        const currentBounds = mainWindow.getBounds()
        configManager.set('windowState', {
            width: maximized && saved ? saved.width : currentBounds.width,
            height: maximized && saved ? saved.height : currentBounds.height,
            x: maximized && saved ? saved.x : currentBounds.x,
            y: maximized && saved ? saved.y : currentBounds.y,
            maximized,
        })
    } catch (e) {
        logger.warn('app', 'Failed to save window state')
    }
}

function createWindow(): void {
    const savedState = configManager.get('windowState')
    mainWindow = new BrowserWindow({
        width: savedState?.width || 1200,
        height: savedState?.height || 800,
        x: savedState?.x,
        y: savedState?.y,
        minWidth: 800,
        minHeight: 600,
        title: 'HexAgent',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // preload needs Node APIs
        }
    })

    if (savedState?.maximized) {
        mainWindow.maximize()
    }

    // 窗口状态变化时保存（resize/move 使用防抖减少磁盘写入）
    const debouncedSave = debounce(saveWindowState, 300)
    mainWindow.on('resize', debouncedSave)
    mainWindow.on('move', debouncedSave)
    mainWindow.on('close', saveWindowState)

    mainWindow.on('closed', () => {
        mainWindow = null
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    logger.info('app', 'Window created')
}

// ==================== 应用菜单 + 快捷键 ====================

function buildMenu(): void {
    const sendShortcut = (action: string) => {
        mainWindow?.webContents.send(action)
    }

    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: '文件',
            submenu: [
                {
                    label: '新建对话',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => sendShortcut('shortcut:new-conversation'),
                },
                { type: 'separator' },
                {
                    label: '设置',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => sendShortcut('shortcut:open-settings'),
                },
                { type: 'separator' },
                { label: '退出', role: 'quit' },
            ],
        },
        {
            label: '编辑',
            submenu: [
                { label: '撤销', role: 'undo' },
                { label: '重做', role: 'redo' },
                { type: 'separator' },
                { label: '剪切', role: 'cut' },
                { label: '复制', role: 'copy' },
                { label: '粘贴', role: 'paste' },
                { label: '全选', role: 'selectAll' },
            ],
        },
        {
            label: '视图',
            submenu: [
                {
                    label: '切换侧边栏',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => sendShortcut('shortcut:toggle-sidebar'),
                },
                { type: 'separator' },
                { label: '刷新', role: 'reload' },
                { label: '开发者工具', role: 'toggleDevTools' },
                { type: 'separator' },
                { label: '实际大小', role: 'resetZoom' },
                { label: '放大', role: 'zoomIn' },
                { label: '缩小', role: 'zoomOut' },
                { type: 'separator' },
                { label: '全屏', role: 'togglefullscreen' },
            ],
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '关于 HexAgent',
                    click: () => sendShortcut('shortcut:open-settings'),
                },
            ],
        },
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
}

// ==================== Escape 键取消生成 ====================

function registerEscapeShortcut(): void {
    // Escape 通过 before-input-event 处理（不占用全局快捷键）
    mainWindow?.webContents.on('before-input-event', (_event, input) => {
        if (input.key === 'Escape' && input.type === 'keyDown') {
            mainWindow?.webContents.send('shortcut:cancel-generation')
        }
    })
}

// ==================== IPC 输入验证辅助 ====================

const VALID_MESSAGE_ROLES = ['user', 'assistant', 'tool', 'system'] as const
const VALID_CONFIG_KEYS: ReadonlySet<string> = new Set([
    'activeProvider', 'activeModel', 'authMode', 'theme', 'uiStyle',
    'workingDirectory', 'allowedDirectories', 'maxToolIterations',
    'autoApproveTools', 'enablePlanning', 'mcpServers', 'temperature', 'maxTokens', 'systemPrompt', 'windowState',
])
const VALID_PROVIDERS: ReadonlySet<string> = new Set([
    'openai', 'anthropic', 'kimi', 'deepseek', 'minimax', 'ollama',
])
const MAX_STRING_LENGTH = 100_000 // 100KB for message content
const MAX_TITLE_LENGTH = 500

function sanitizeTitleCandidate(raw: string): string {
    if (!raw) return ''

    let cleaned = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
        .replace(/<\/?think>/gi, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .trim()

    const lines = cleaned
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    for (const line of lines) {
        const normalized = line
            .replace(/^#+\s*/, '')
            .replace(/^(标题|title)\s*[:：]\s*/i, '')
            .replace(/^["'""''《》【】]+|["'""''《》【】]+$/g, '')
            .trim()

        if (!normalized) continue
        if (/^<\/?think>$/i.test(normalized)) continue
        if (/^(好的|当然|这是|以下|我建议|让我|根据)/.test(normalized)) continue
        return normalized.substring(0, 20)
    }

    return ''
}

function buildFallbackTitle(userText: string): string {
    return userText
        .replace(/\s+/g, ' ')
        .replace(/^["'""''《》【】]+|["'""''《》【】]+$/g, '')
        .trim()
        .substring(0, 20)
}

function normalizeMcpServerConfig(raw: MCPServerConfig): MCPServerConfig {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid MCP server config')
    }
    if (typeof raw.id !== 'string' || !raw.id.trim()) {
        throw new Error('Invalid MCP server id')
    }
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
        throw new Error('Invalid MCP server name')
    }
    if (raw.transport !== 'stdio' && raw.transport !== 'streamable-http' && raw.transport !== 'sse') {
        throw new Error('Invalid MCP transport')
    }
    if (typeof raw.command !== 'string') {
        throw new Error('Invalid MCP command')
    }
    if (!Array.isArray(raw.args) || raw.args.some((arg) => typeof arg !== 'string')) {
        throw new Error('Invalid MCP args')
    }
    if (raw.cwd !== undefined && typeof raw.cwd !== 'string') {
        throw new Error('Invalid MCP cwd')
    }
    if (raw.env !== undefined) {
        if (typeof raw.env !== 'object' || raw.env === null) {
            throw new Error('Invalid MCP env')
        }
        for (const [key, value] of Object.entries(raw.env)) {
            if (typeof key !== 'string' || typeof value !== 'string') {
                throw new Error('Invalid MCP env entry')
            }
        }
    }
    if (raw.url !== undefined && typeof raw.url !== 'string') {
        throw new Error('Invalid MCP url')
    }
    if (raw.headers !== undefined) {
        if (typeof raw.headers !== 'object' || raw.headers === null) {
            throw new Error('Invalid MCP headers')
        }
        for (const [key, value] of Object.entries(raw.headers)) {
            if (typeof key !== 'string' || typeof value !== 'string') {
                throw new Error('Invalid MCP header entry')
            }
        }
    }
    if (raw.toolNamePrefix !== undefined && typeof raw.toolNamePrefix !== 'string') {
        throw new Error('Invalid MCP toolNamePrefix')
    }
    if (raw.allowedTools !== undefined) {
        if (!Array.isArray(raw.allowedTools) || raw.allowedTools.some((item) => typeof item !== 'string')) {
            throw new Error('Invalid MCP allowedTools')
        }
    }

    if (raw.transport === 'stdio' && !raw.command.trim()) {
        throw new Error('Invalid MCP command')
    }
    if ((raw.transport === 'streamable-http' || raw.transport === 'sse') && !raw.url?.trim()) {
        throw new Error('Invalid MCP url')
    }

    return {
        id: raw.id.trim(),
        name: raw.name.trim(),
        enabled: !!raw.enabled,
        transport: raw.transport,
        command: raw.command.trim(),
        args: raw.args.map((arg) => arg.trim()).filter(Boolean),
        ...(raw.cwd?.trim() ? { cwd: raw.cwd.trim() } : {}),
        ...(raw.env ? { env: raw.env } : {}),
        ...(raw.url?.trim() ? { url: raw.url.trim() } : {}),
        ...(raw.headers ? { headers: raw.headers } : {}),
        ...(raw.toolNamePrefix?.trim() ? { toolNamePrefix: raw.toolNamePrefix.trim() } : {}),
        ...(raw.allowedTools ? { allowedTools: raw.allowedTools.map((item) => item.trim()).filter(Boolean) } : {}),
        autoApprove: !!raw.autoApprove,
    }
}

// ==================== 数据库 IPC ====================
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    })
    return result.filePaths[0] || null
})

ipcMain.handle('db:create-conversation', (_event, title: string) => {
    if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
        throw new Error('Invalid title')
    }
    return createConversation(title)
})

ipcMain.handle('db:get-conversations', () => {
    return getConversations()
})

ipcMain.handle('db:get-messages', (_event, conversationId: number) => {
    if (typeof conversationId !== 'number' || !Number.isInteger(conversationId) || conversationId < 0) {
        throw new Error('Invalid conversationId')
    }
    return getMessages(conversationId)
})

ipcMain.handle('db:add-message', (_event, conversationId: number, role: string, content: string) => {
    if (typeof conversationId !== 'number' || !Number.isInteger(conversationId) || conversationId < 0) {
        throw new Error('Invalid conversationId')
    }
    if (typeof role !== 'string' || !(VALID_MESSAGE_ROLES as readonly string[]).includes(role)) {
        throw new Error(`Invalid role: ${role}`)
    }
    if (typeof content !== 'string' || content.length > MAX_STRING_LENGTH) {
        throw new Error('Invalid content')
    }
    return addMessage(conversationId, role, content)
})

ipcMain.handle('db:add-tool-message', (_event, conversationId: number, content: string, toolName: string, toolArgs: string, toolResult: string) => {
    if (typeof conversationId !== 'number' || !Number.isInteger(conversationId) || conversationId < 0) {
        throw new Error('Invalid conversationId')
    }
    if (typeof content !== 'string' || content.length > MAX_STRING_LENGTH) {
        throw new Error('Invalid content')
    }
    if (typeof toolName !== 'string' || toolName.length > 200) {
        throw new Error('Invalid toolName')
    }
    if (typeof toolArgs !== 'string' || toolArgs.length > MAX_STRING_LENGTH) {
        throw new Error('Invalid toolArgs')
    }
    if (typeof toolResult !== 'string' || toolResult.length > MAX_STRING_LENGTH) {
        throw new Error('Invalid toolResult')
    }
    return addToolMessage(conversationId, content, toolName, toolArgs, toolResult)
})

ipcMain.handle('db:update-conversation', (_event, id: number, title: string) => {
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) {
        throw new Error('Invalid id')
    }
    if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
        throw new Error('Invalid title')
    }
    return updateConversation(id, title)
})

ipcMain.handle('db:delete-conversation', (_event, id: number) => {
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) {
        throw new Error('Invalid id')
    }
    return deleteConversation(id)
})

ipcMain.handle('db:search-messages', (_event, query: string) => {
    if (typeof query !== 'string' || query.length === 0 || query.length > 1000) {
        throw new Error('Invalid search query')
    }
    return searchMessages(query)
})

ipcMain.handle('db:clear-messages', (_event, conversationId: number) => {
    if (typeof conversationId !== 'number' || !Number.isInteger(conversationId) || conversationId < 0) {
        throw new Error('Invalid conversationId')
    }
    return clearMessages(conversationId)
})

ipcMain.handle('db:delete-messages-after', (_event, conversationId: number, afterMessageId: number) => {
    if (typeof conversationId !== 'number' || !Number.isInteger(conversationId) || conversationId < 0) {
        throw new Error('Invalid conversationId')
    }
    if (typeof afterMessageId !== 'number' || !Number.isInteger(afterMessageId) || afterMessageId < 0) {
        throw new Error('Invalid afterMessageId')
    }
    return deleteMessagesAfter(conversationId, afterMessageId)
})

ipcMain.handle('db:export-conversation', async (_event, conversationId: number, format: 'markdown' | 'json') => {
    if (typeof conversationId !== 'number' || !Number.isInteger(conversationId) || conversationId < 0) {
        throw new Error('Invalid conversationId')
    }
    if (format !== 'markdown' && format !== 'json') {
        throw new Error('Invalid format: must be "markdown" or "json"')
    }

    const conversation = getConversation(conversationId) as ConversationRow | undefined
    if (!conversation) throw new Error('Conversation not found')

    const messages = getMessages(conversationId) as MessageRow[]

    let content: string
    let defaultFileName: string
    let filters: Electron.FileFilter[]

    if (format === 'markdown') {
        const lines: string[] = []
        lines.push(`# ${conversation.title}`)
        lines.push('')
        lines.push(`> Exported from HexAgent | ${conversation.created_at}`)
        if (conversation.model) lines.push(`> Model: ${conversation.provider || ''}/${conversation.model}`)
        lines.push('')

        for (const msg of messages) {
            const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role
            lines.push(`## ${roleLabel}`)
            lines.push('')
            lines.push(msg.content)
            lines.push('')
        }

        content = lines.join('\n')
        defaultFileName = `${conversation.title.replace(/[<>:"/\\|?*]/g, '_')}.md`
        filters = [{ name: 'Markdown', extensions: ['md'] }]
    } else {
        const exportData = {
            title: conversation.title,
            model: conversation.model,
            provider: conversation.provider,
            created_at: conversation.created_at,
            updated_at: conversation.updated_at,
            messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
                created_at: m.created_at,
            })),
        }
        content = JSON.stringify(exportData, null, 2)
        defaultFileName = `${conversation.title.replace(/[<>:"/\\|?*]/g, '_')}.json`
        filters = [{ name: 'JSON', extensions: ['json'] }]
    }

    const result = await dialog.showSaveDialog({
        title: 'Export Conversation',
        defaultPath: defaultFileName,
        filters,
    })

    if (result.canceled || !result.filePath) return false

    fs.writeFileSync(result.filePath, content, 'utf-8')
    logger.info('export', `Conversation ${conversationId} exported to ${result.filePath}`)
    return true
})

// ==================== LLM IPC ====================
ipcMain.handle('llm:chat', async (event, messages: { role: string, content: string }[], options?: { provider?: LLMProviderType; model?: string }) => {
    // Validate messages array
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('Invalid messages: must be a non-empty array')
    }
    for (const msg of messages) {
        if (typeof msg !== 'object' || msg === null) {
            throw new Error('Invalid message entry')
        }
        if (typeof msg.role !== 'string' || !(VALID_MESSAGE_ROLES as readonly string[]).includes(msg.role)) {
            throw new Error(`Invalid message role: ${msg.role}`)
        }
        if (msg.content !== null && typeof msg.content !== 'string') {
            throw new Error('Invalid message content')
        }
    }
    // Validate options
    if (options !== undefined && options !== null) {
        if (typeof options !== 'object') {
            throw new Error('Invalid options')
        }
        if (options.provider !== undefined && !VALID_PROVIDERS.has(options.provider)) {
            throw new Error(`Invalid provider: ${options.provider}`)
        }
        if (options.model !== undefined && (typeof options.model !== 'string' || options.model.length > 100)) {
            throw new Error('Invalid model')
        }
    }

    await llmManager.chat(
        messages as ChatMessage[],
        {
            onChunk: (chunk) => event.sender.send('llm:chunk', chunk),
            onThinking: (chunk) => event.sender.send('llm:thinking', chunk),
            onDone: () => event.sender.send('llm:done'),
            onError: (error) => event.sender.send('llm:error', error),
            onToolCall: (name, args) => event.sender.send('llm:tool-call', name, args),
            onToolResult: (toolName, result, artifacts) => event.sender.send('llm:tool-result', toolName, result, artifacts),
            onPlanUpdate: (plan) => event.sender.send('llm:plan-update', plan),
        },
        options
    )
})

ipcMain.on('llm:cancel', () => {
    llmManager.cancel()
})

// ==================== 配置 IPC ====================
ipcMain.handle('config:get-all', () => {
    return configManager.getAll()
})

ipcMain.handle('config:set', (_event, key: string, value: any) => {
    if (typeof key !== 'string' || !VALID_CONFIG_KEYS.has(key)) {
        throw new Error(`Invalid config key: ${key}`)
    }
    const normalizedValue = key === 'mcpServers'
        ? (() => {
            if (!Array.isArray(value)) throw new Error('Invalid mcpServers')
            return value.map((item) => normalizeMcpServerConfig(item))
        })()
        : value

    configManager.set(key as any, normalizedValue)
    // 切换 provider/model/authMode 时清除缓存的 Provider 实例
    if (key === 'activeProvider' || key === 'activeModel' || key === 'authMode') {
        llmManager.clearProviderCache()
    }
    if (key === 'mcpServers') {
        return mcpManager.reloadFromConfig()
    }
})

ipcMain.handle('settings:set-api-key', (_event, provider: string, key: string) => {
    if (typeof provider !== 'string' || provider.length > 100) {
        throw new Error('Invalid provider')
    }
    if (typeof key !== 'string' || key.length > 1000) {
        throw new Error('Invalid API key')
    }
    configManager.setApiKey(provider, key)
    // 清除缓存，下次调用时用新 Key 创建 Provider
    llmManager.clearProviderCache()
    logger.info('config', `API key set for provider: ${provider}`)
})

ipcMain.handle('settings:get-api-key', (_event, provider: string) => {
    if (typeof provider !== 'string' || provider.length > 100) {
        throw new Error('Invalid provider')
    }
    return configManager.getApiKey(provider)
})

ipcMain.handle('app:get-version', () => {
    return app.getVersion()
})

// ==================== MCP IPC ====================
ipcMain.handle('mcp:test-server', async (_event, config: MCPServerConfig) => {
    return mcpManager.testServer(normalizeMcpServerConfig(config))
})

ipcMain.handle('mcp:get-statuses', () => {
    return mcpManager.getStatuses()
})

ipcMain.handle('mcp:refresh-servers', async () => {
    return mcpManager.reloadFromConfig()
})

ipcMain.handle('mcp:refresh-server', async (_event, serverId: string) => {
    if (typeof serverId !== 'string' || !serverId.trim()) {
        throw new Error('Invalid serverId')
    }
    return mcpManager.refreshServer(serverId.trim())
})

ipcMain.handle('mcp:get-server-details', async (_event, serverId: string) => {
    if (typeof serverId !== 'string' || !serverId.trim()) {
        throw new Error('Invalid serverId')
    }
    return mcpManager.getServerDetails(serverId.trim())
})

ipcMain.handle('mcp:get-prompt', async (_event, serverId: string, promptName: string) => {
    if (typeof serverId !== 'string' || !serverId.trim()) {
        throw new Error('Invalid serverId')
    }
    if (typeof promptName !== 'string' || !promptName.trim()) {
        throw new Error('Invalid promptName')
    }
    return mcpManager.getPrompt(serverId.trim(), promptName.trim())
})

ipcMain.handle('mcp:read-resource', async (_event, serverId: string, uri: string) => {
    if (typeof serverId !== 'string' || !serverId.trim()) {
        throw new Error('Invalid serverId')
    }
    if (typeof uri !== 'string' || !uri.trim()) {
        throw new Error('Invalid uri')
    }
    return mcpManager.readResource(serverId.trim(), uri.trim())
})

// ==================== 标题生成 ====================
ipcMain.handle('llm:generate-title', async (_event, conversationId: number, userText: string) => {
    if (typeof conversationId !== 'number' || !Number.isInteger(conversationId) || conversationId < 0) {
        throw new Error('Invalid conversationId')
    }
    if (typeof userText !== 'string') {
        throw new Error('Invalid text')
    }

    try {
        const providerType = configManager.get('activeProvider')
        const model = configManager.get('activeModel')
        const authMode = configManager.get('authMode') || 'api'
        const { getProviderConfig } = await import('./llm/provider-registry')
        const config = getProviderConfig(providerType, authMode)
        const apiKey = configManager.getApiKey(providerType)

        const messages = [
            { role: 'system' as const, content: '你是标题生成器。用户会发送一段消息，你只需返回一个10字以内的简短标题。只输出标题本身，不要引号、标点、解释或任何多余内容。' },
            { role: 'user' as const, content: userText.substring(0, 200) },
        ]

        // 非流式调用，直接拿结果
        let title = ''

        if (providerType === 'anthropic') {
            const { default: Anthropic } = await import('@anthropic-ai/sdk')
            const client = new Anthropic({ apiKey: apiKey || '' })
            const systemMsg = messages.find(m => m.role === 'system')
            const userMsgs = messages.filter(m => m.role !== 'system')
            const response = await client.messages.create({
                model: model || config.defaultModel,
                max_tokens: 50,
                ...(systemMsg ? { system: systemMsg.content } : {}),
                messages: userMsgs.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            })
            const block = response.content[0]
            if (block.type === 'text') title = block.text
        } else {
            const { default: OpenAI } = await import('openai')
            const client = new OpenAI({
                apiKey: providerType === 'ollama' ? 'ollama' : (apiKey || ''),
                baseURL: config.baseURL,
                defaultHeaders: config.defaultHeaders,
            })
            const response = await client.chat.completions.create({
                model: model || config.defaultModel,
                messages: messages as any,
                max_tokens: 50,
            })
            title = response.choices[0]?.message?.content || ''
        }

        title = sanitizeTitleCandidate(title)
        if (!title) {
            title = buildFallbackTitle(userText)
        }
        if (title) {
            updateConversation(conversationId, title)
            return title
        }
        return null
    } catch (e: any) {
        logger.warn('llm', `Title generation failed: ${e.message}`)
        return null
    }
})

// ==================== 应用生命周期 ====================
app.whenReady().then(() => {
    logger.info('app', 'HexAgent starting')
    createWindow()
    buildMenu()
    registerEscapeShortcut()
    mcpManager.reloadFromConfig().catch((e) => {
        logger.warn('mcp', `Initial MCP load failed: ${e.message}`)
    })
})

app.on('window-all-closed', () => {
    app.quit()
})
