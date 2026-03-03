import { app, BrowserWindow, ipcMain } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js'
import { configManager } from '../config'
import { logger } from '../logger'
import type {
    Artifact,
    MCPPromptDetail,
    MCPPromptSummary,
    MCPResourceDetail,
    MCPResourceSummary,
    MCPServerConfig,
    MCPServerStatus,
    ToolConfirmRequest,
} from '../../shared/types'
import type { ToolResult } from '../llm/types'

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport

interface MCPToolEntry {
    qualifiedName: string
    originalName: string
    serverId: string
    serverName: string
    config: MCPServerConfig
    tool: Tool
    client: Client
}

interface ServerRuntime {
    config: MCPServerConfig
    client: Client
    transport: McpTransport
    tools: Tool[]
    prompts: Prompt[]
    resources: Resource[]
    status: MCPServerStatus
}

type ConfirmActionOptions = Pick<ToolConfirmRequest, 'actionLabel' | 'actionDescription'>

let confirmIdCounter = 0

function confirmAction(title: string, message: string, detail?: string, type = 'default', options?: ConfirmActionOptions): Promise<boolean> {
    if (configManager.get('autoApproveTools')) return Promise.resolve(true)

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) return Promise.resolve(false)

    const id = `confirm-${++confirmIdCounter}`
    const truncatedDetail = detail && detail.length > 2000
        ? detail.substring(0, 2000) + '\n...(内容过长已截断)'
        : detail

    return new Promise<boolean>((resolve) => {
        const handler = (_event: unknown, responseId: string, approved: boolean) => {
            if (responseId === id) {
                ipcMain.removeListener('tool:confirm-response', handler)
                resolve(approved)
            }
        }

        ipcMain.on('tool:confirm-response', handler)
        win.webContents.send('tool:confirm-request', {
            id,
            title,
            message,
            detail: truncatedDetail,
            type,
            ...options,
        } satisfies ToolConfirmRequest)
    })
}

function sanitizeNameSegment(value: string): string {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'mcp'
}

function shortHash(value: string): string {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
    }
    return Math.abs(hash).toString(36).slice(0, 6)
}

function normalizeSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
    if (schema && schema.type === 'object') return schema
    return { type: 'object', properties: {} }
}

function formatCallArguments(args: unknown): string {
    try {
        return JSON.stringify(args, null, 2)
    } catch {
        return String(args)
    }
}

function resourceToText(resource: {
    uri: string
    text?: string
    blob?: string
    mimeType?: string
}): string {
    if (resource.text) {
        return `[资源] ${resource.uri}\n${resource.text}`
    }
    if (resource.blob) {
        return `[资源] ${resource.uri}\n二进制内容 (${resource.mimeType || 'application/octet-stream'})`
    }
    return `[资源] ${resource.uri}`
}

function promptContentToText(content: unknown): string {
    if (!content || typeof content !== 'object') return String(content || '')
    const item = content as {
        type?: string
        text?: string
        data?: string
        mimeType?: string
        resource?: { uri: string; text?: string; blob?: string; mimeType?: string }
        uri?: string
        name?: string
        description?: string
    }
    switch (item.type) {
        case 'text':
            return item.text || ''
        case 'resource':
            return item.resource ? resourceToText(item.resource) : '[资源]'
        case 'resource_link':
            return `[资源链接] ${item.name || item.uri || '未知资源'}${item.description ? `\n${item.description}` : ''}`
        case 'image':
            return `[图片] ${item.mimeType || 'image'}`
        case 'audio':
            return `[音频] ${item.mimeType || 'audio'}`
        default:
            return `[${item.type || 'content'}]`
    }
}

function buildHeaders(config: MCPServerConfig): HeadersInit | undefined {
    if (!config.headers || Object.keys(config.headers).length === 0) return undefined
    return config.headers
}

function mapPromptSummary(prompt: Prompt): MCPPromptSummary {
    return {
        name: prompt.name,
        title: prompt.title,
        description: prompt.description,
        arguments: prompt.arguments?.map((arg) => ({
            name: arg.name,
            description: arg.description,
            required: arg.required,
        })),
    }
}

function mapResourceSummary(resource: Resource): MCPResourceSummary {
    return {
        uri: resource.uri,
        name: resource.name,
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
    }
}

export class McpManager {
    private runtimes = new Map<string, ServerRuntime>()
    private toolIndex = new Map<string, MCPToolEntry>()

    async reloadFromConfig(): Promise<MCPServerStatus[]> {
        await this.disconnectAll()

        const configs = configManager.get('mcpServers') || []
        for (const config of configs) {
            if (!config.enabled) continue
            await this.connectServer(config)
        }

        this.rebuildToolIndex()
        return this.getStatuses()
    }

    async refreshServer(serverId: string): Promise<MCPServerStatus> {
        await this.disconnectServer(serverId)

        const config = (configManager.get('mcpServers') || []).find((item) => item.id === serverId)
        if (!config) {
            return {
                serverId,
                name: serverId,
                enabled: false,
                connected: false,
                transport: 'stdio',
                toolCount: 0,
                toolNames: [],
                promptCount: 0,
                resourceCount: 0,
                lastError: '未找到 MCP server 配置',
            }
        }

        if (!config.enabled) {
            this.rebuildToolIndex()
            return this.getStatusForConfig(config)
        }

        const status = await this.connectServer(config)
        this.rebuildToolIndex()
        return status
    }

    async testServer(config: MCPServerConfig): Promise<MCPServerStatus> {
        const runtime = this.createRuntime(config)
        try {
            await runtime.client.connect(runtime.transport)
            await this.fetchCapabilities(runtime)
            runtime.status = this.buildStatus(config, {
                connected: true,
                toolCount: runtime.tools.length,
                toolNames: runtime.tools.map((tool) => tool.name),
                promptCount: runtime.prompts.length,
                resourceCount: runtime.resources.length,
                pid: runtime.transport instanceof StdioClientTransport ? runtime.transport.pid || undefined : undefined,
                serverVersion: runtime.client.getServerVersion()?.version,
            })
            return runtime.status
        } catch (e: any) {
            return this.buildStatus(config, {
                connected: false,
                lastError: e.message || String(e),
            })
        } finally {
            await runtime.client.close().catch(() => {})
        }
    }

    getStatuses(): MCPServerStatus[] {
        const configs = configManager.get('mcpServers') || []
        return configs.map((config) => this.getStatusForConfig(config))
    }

    async getServerDetails(serverId: string): Promise<{
        status: MCPServerStatus
        prompts: MCPPromptSummary[]
        resources: MCPResourceSummary[]
    }> {
        const runtime = this.runtimes.get(serverId)
        if (!runtime) {
            const config = (configManager.get('mcpServers') || []).find((item) => item.id === serverId)
            return {
                status: config ? this.getStatusForConfig(config) : {
                    serverId,
                    name: serverId,
                    enabled: false,
                    connected: false,
                    transport: 'stdio',
                    toolCount: 0,
                    toolNames: [],
                    promptCount: 0,
                    resourceCount: 0,
                    lastError: '未找到 MCP server 配置',
                },
                prompts: [],
                resources: [],
            }
        }

        await this.fetchCapabilities(runtime)
        return {
            status: runtime.status,
            prompts: runtime.prompts.map(mapPromptSummary),
            resources: runtime.resources.map(mapResourceSummary),
        }
    }

    async getPrompt(serverId: string, promptName: string): Promise<MCPPromptDetail> {
        const runtime = this.getConnectedRuntime(serverId)
        const response = await runtime.client.getPrompt({ name: promptName })
        return {
            description: response.description,
            messages: response.messages.map((item) => ({
                role: item.role,
                content: promptContentToText(item.content),
            })),
        }
    }

    async readResource(serverId: string, uri: string): Promise<MCPResourceDetail> {
        const runtime = this.getConnectedRuntime(serverId)
        const response = await runtime.client.readResource({ uri })
        const contents = response.contents.map((item) => resourceToText(item))
        return {
            uri,
            mimeType: response.contents[0]?.mimeType,
            text: contents.join('\n\n') || `[资源] ${uri}`,
        }
    }

    getToolDefinitions(): Array<{
        type: 'function'
        function: {
            name: string
            description: string
            parameters: Record<string, unknown>
        }
    }> {
        return [...this.toolIndex.values()].map((entry) => {
            const readOnly = entry.tool.annotations?.readOnlyHint ? '只读' : '可写'
            const destructive = entry.tool.annotations?.destructiveHint ? '，可能修改外部状态' : ''
            return {
                type: 'function' as const,
                function: {
                    name: entry.qualifiedName,
                    description: `[MCP:${entry.serverName}] ${entry.tool.description || entry.originalName}（${readOnly}${destructive}）`,
                    parameters: normalizeSchema(entry.tool.inputSchema as Record<string, unknown> | undefined),
                },
            }
        })
    }

    async executeTool(name: string, args: unknown): Promise<ToolResult | null> {
        const entry = this.toolIndex.get(name)
        if (!entry) return null

        const readOnly = !!entry.tool.annotations?.readOnlyHint
        const allowedTools = entry.config.allowedTools || []
        if (allowedTools.length > 0 && !allowedTools.includes(entry.originalName)) {
            return { result: `MCP 工具已被禁用: ${entry.originalName}`, artifacts: [] }
        }

        if (!readOnly && !entry.config.autoApprove) {
            const approved = await confirmAction(
                'MCP 工具调用',
                `${entry.serverName} · ${entry.originalName}`,
                formatCallArguments(args),
                'default',
                {
                    actionLabel: '外部工具',
                    actionDescription: '该操作将调用外部 MCP server 提供的工具。',
                }
            )
            if (!approved) {
                return { result: '用户拒绝了 MCP 工具调用', artifacts: [] }
            }
        }

        try {
            const response = await entry.client.callTool({
                name: entry.originalName,
                arguments: (args as Record<string, unknown>) || {},
            })
            return this.normalizeCallResult(entry.originalName, response)
        } catch (e: any) {
            logger.warn('mcp', `MCP tool call failed: ${entry.originalName}`, { error: e.message })
            return { result: `MCP 工具执行错误: ${e.message || e}`, artifacts: [] }
        }
    }

    private getConnectedRuntime(serverId: string): ServerRuntime {
        const runtime = this.runtimes.get(serverId)
        if (!runtime || !runtime.status.connected) {
            throw new Error('MCP server 未连接')
        }
        return runtime
    }

    private async connectServer(config: MCPServerConfig): Promise<MCPServerStatus> {
        const runtime = this.createRuntime(config)

        try {
            await runtime.client.connect(runtime.transport)
            await this.fetchCapabilities(runtime)
            runtime.status = this.buildStatus(config, {
                connected: true,
                toolCount: runtime.tools.length,
                toolNames: runtime.tools.map((tool) => tool.name),
                promptCount: runtime.prompts.length,
                resourceCount: runtime.resources.length,
                pid: runtime.transport instanceof StdioClientTransport ? runtime.transport.pid || undefined : undefined,
                serverVersion: runtime.client.getServerVersion()?.version,
            })
            this.runtimes.set(config.id, runtime)
            logger.info('mcp', `Connected MCP server: ${config.name} (${runtime.tools.length} tools)`)
            return runtime.status
        } catch (e: any) {
            const status = this.buildStatus(config, {
                connected: false,
                lastError: e.message || String(e),
            })
            logger.warn('mcp', `Failed to connect MCP server: ${config.name}`, { error: status.lastError })
            await runtime.client.close().catch(() => {})
            this.runtimes.set(config.id, { ...runtime, status })
            return status
        }
    }

    private createRuntime(config: MCPServerConfig): ServerRuntime {
        const transport = this.createTransport(config)
        const runtime: ServerRuntime = {
            config,
            client: new Client(
                { name: 'HexAgent', version: app.getVersion() },
                {
                    capabilities: {},
                    listChanged: {
                        tools: {
                            autoRefresh: true,
                            onChanged: (error, tools) => {
                                if (error) {
                                    runtime.status = {
                                        ...runtime.status,
                                        connected: false,
                                        lastError: error.message,
                                    }
                                } else if (tools) {
                                    runtime.tools = tools
                                    runtime.status = this.mergeCounts(runtime.status, runtime)
                                }
                                this.rebuildToolIndex()
                            },
                        },
                        prompts: {
                            autoRefresh: true,
                            onChanged: (error, prompts) => {
                                if (error) {
                                    runtime.status = {
                                        ...runtime.status,
                                        connected: false,
                                        lastError: error.message,
                                    }
                                } else if (prompts) {
                                    runtime.prompts = prompts
                                    runtime.status = this.mergeCounts(runtime.status, runtime)
                                }
                            },
                        },
                        resources: {
                            autoRefresh: true,
                            onChanged: (error, resources) => {
                                if (error) {
                                    runtime.status = {
                                        ...runtime.status,
                                        connected: false,
                                        lastError: error.message,
                                    }
                                } else if (resources) {
                                    runtime.resources = resources
                                    runtime.status = this.mergeCounts(runtime.status, runtime)
                                }
                            },
                        },
                    },
                }
            ),
            transport,
            tools: [],
            prompts: [],
            resources: [],
            status: this.buildStatus(config),
        }

        if (transport instanceof StdioClientTransport) {
            const stderr = transport.stderr
            if (stderr) {
                stderr.on('data', (chunk) => {
                    const text = chunk.toString().trim()
                    if (!text) return
                    runtime.status = {
                        ...runtime.status,
                        lastError: text.substring(0, 500),
                    }
                })
            }
        }

        transport.onerror = (error) => {
            runtime.status = {
                ...runtime.status,
                connected: false,
                lastError: error.message,
            }
            this.rebuildToolIndex()
        }

        transport.onclose = () => {
            runtime.status = {
                ...runtime.status,
                connected: false,
            }
            this.rebuildToolIndex()
        }

        return runtime
    }

    private createTransport(config: MCPServerConfig): McpTransport {
        if (config.transport === 'streamable-http') {
            return new StreamableHTTPClientTransport(new URL(config.url || ''), {
                requestInit: {
                    headers: buildHeaders(config),
                },
            })
        }

        if (config.transport === 'sse') {
            const headers = buildHeaders(config)
            return new SSEClientTransport(new URL(config.url || ''), {
                requestInit: { headers },
                eventSourceInit: { headers } as any,
            })
        }

        return new StdioClientTransport({
            command: config.command,
            args: config.args,
            cwd: config.cwd || configManager.get('workingDirectory'),
            env: config.env,
            stderr: 'pipe',
        })
    }

    private async fetchCapabilities(runtime: ServerRuntime): Promise<void> {
        const capabilities = runtime.client.getServerCapabilities()

        if (capabilities?.tools) {
            const listed = await runtime.client.listTools()
            runtime.tools = listed.tools
        } else {
            runtime.tools = []
        }

        if (capabilities?.prompts) {
            const listed = await runtime.client.listPrompts()
            runtime.prompts = listed.prompts
        } else {
            runtime.prompts = []
        }

        if (capabilities?.resources) {
            const listed = await runtime.client.listResources()
            runtime.resources = listed.resources
        } else {
            runtime.resources = []
        }

        runtime.status = this.mergeCounts(runtime.status, runtime, {
            connected: true,
            lastError: undefined,
        })
    }

    private mergeCounts(
        status: MCPServerStatus,
        runtime: ServerRuntime,
        overrides?: Partial<MCPServerStatus>
    ): MCPServerStatus {
        return {
            ...status,
            connected: true,
            toolCount: runtime.tools.length,
            toolNames: runtime.tools.map((tool) => tool.name),
            promptCount: runtime.prompts.length,
            resourceCount: runtime.resources.length,
            ...overrides,
        }
    }

    private buildStatus(config: MCPServerConfig, overrides?: Partial<MCPServerStatus>): MCPServerStatus {
        return {
            serverId: config.id,
            name: config.name,
            enabled: config.enabled,
            connected: false,
            transport: config.transport,
            toolCount: 0,
            toolNames: [],
            promptCount: 0,
            resourceCount: 0,
            ...overrides,
        }
    }

    private getStatusForConfig(config: MCPServerConfig): MCPServerStatus {
        return this.runtimes.get(config.id)?.status || this.buildStatus(config)
    }

    private rebuildToolIndex(): void {
        this.toolIndex.clear()

        for (const runtime of this.runtimes.values()) {
            if (!runtime.status.connected) continue
            for (const tool of runtime.tools) {
                if (runtime.config.allowedTools?.length && !runtime.config.allowedTools.includes(tool.name)) {
                    continue
                }

                const qualifiedName = this.buildQualifiedToolName(runtime.config, tool.name)
                this.toolIndex.set(qualifiedName, {
                    qualifiedName,
                    originalName: tool.name,
                    serverId: runtime.config.id,
                    serverName: runtime.config.name,
                    config: runtime.config,
                    tool,
                    client: runtime.client,
                })
            }
        }
    }

    private buildQualifiedToolName(config: MCPServerConfig, toolName: string): string {
        const prefix = sanitizeNameSegment(config.toolNamePrefix || config.id).slice(0, 16)
        const toolSegment = sanitizeNameSegment(toolName).slice(0, 36)
        const base = `mcp_${prefix}_${toolSegment}`.replace(/_+/g, '_')
        const suffix = shortHash(`${config.id}:${toolName}`)
        const trimmed = base.slice(0, 57)
        return `${trimmed}_${suffix}`
    }

    private normalizeCallResult(toolName: string, response: {
        content?: Array<{
            type: string
            text?: string
            data?: string
            mimeType?: string
            resource?: { uri: string; text?: string; blob?: string; mimeType?: string }
            uri?: string
            name?: string
            description?: string
        }>
        structuredContent?: Record<string, unknown>
        toolResult?: unknown
        isError?: boolean
    }): ToolResult {
        const artifacts: Artifact[] = []
        const parts: string[] = []

        if ('toolResult' in response && response.toolResult !== undefined) {
            return {
                result: JSON.stringify(response.toolResult, null, 2),
                artifacts: [],
            }
        }

        for (const item of response.content || []) {
            switch (item.type) {
                case 'text':
                    if (item.text) parts.push(item.text)
                    break
                case 'image':
                    if (item.data && item.mimeType) {
                        artifacts.push({
                            type: 'image',
                            name: `${toolName}-${artifacts.length + 1}`,
                            base64: `data:${item.mimeType};base64,${item.data}`,
                        })
                        parts.push(`[图片] ${item.mimeType}`)
                    }
                    break
                case 'resource':
                    if (item.resource) parts.push(resourceToText(item.resource))
                    break
                case 'resource_link':
                    parts.push(`[资源链接] ${item.name || item.uri || '未知资源'}${item.description ? `\n${item.description}` : ''}`)
                    break
                case 'audio':
                    parts.push(`[音频] ${item.mimeType || 'audio'} 内容已返回`)
                    break
                default:
                    parts.push(`[${item.type}]`)
                    break
            }
        }

        if (response.structuredContent && Object.keys(response.structuredContent).length > 0) {
            parts.push(JSON.stringify(response.structuredContent, null, 2))
        }

        const result = parts.filter(Boolean).join('\n\n') || 'MCP 工具执行完成'
        return {
            result: response.isError ? `错误: ${result}` : result,
            artifacts,
        }
    }

    private async disconnectServer(serverId: string): Promise<void> {
        const runtime = this.runtimes.get(serverId)
        if (!runtime) return

        await runtime.client.close().catch(() => {})
        this.runtimes.delete(serverId)
    }

    private async disconnectAll(): Promise<void> {
        const serverIds = [...this.runtimes.keys()]
        for (const serverId of serverIds) {
            await this.disconnectServer(serverId)
        }
        this.toolIndex.clear()
    }
}

export const mcpManager = new McpManager()
