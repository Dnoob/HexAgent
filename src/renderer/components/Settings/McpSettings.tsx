import { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Empty,
    Form,
    Input,
    Modal,
    Popconfirm,
    Select,
    Space,
    Switch,
    Tabs,
    Tag,
    Typography,
    message,
} from 'antd'
import {
    DeleteOutlined,
    EditOutlined,
    EyeOutlined,
    PlusOutlined,
    ReloadOutlined,
    CheckCircleOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import { useSettingsStore } from '../../store'
import type {
    MCPPromptDetail,
    MCPPromptSummary,
    MCPResourceDetail,
    MCPResourceSummary,
    MCPServerConfig,
    MCPServerStatus,
    MCPTransportType,
} from '../../../shared/types'

interface McpFormState {
    id: string
    name: string
    transport: MCPTransportType
    command: string
    argsText: string
    cwd: string
    envText: string
    url: string
    headersText: string
    toolNamePrefix: string
    allowedToolsText: string
    enabled: boolean
    autoApprove: boolean
}

function createEmptyState(): McpFormState {
    return {
        id: '',
        name: '',
        transport: 'stdio',
        command: '',
        argsText: '',
        cwd: '',
        envText: '',
        url: '',
        headersText: '',
        toolNamePrefix: '',
        allowedToolsText: '',
        enabled: true,
        autoApprove: false,
    }
}

function toFormState(config: MCPServerConfig): McpFormState {
    return {
        id: config.id,
        name: config.name,
        transport: config.transport,
        command: config.command,
        argsText: config.args.join('\n'),
        cwd: config.cwd || '',
        envText: config.env ? JSON.stringify(config.env, null, 2) : '',
        url: config.url || '',
        headersText: config.headers ? JSON.stringify(config.headers, null, 2) : '',
        toolNamePrefix: config.toolNamePrefix || '',
        allowedToolsText: config.allowedTools?.join('\n') || '',
        enabled: config.enabled,
        autoApprove: !!config.autoApprove,
    }
}

function slugify(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-server'
}

function parseJsonMap(text: string, label: string): Record<string, string> | undefined {
    if (!text.trim()) return undefined

    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${label}必须是 JSON 对象`)
    }

    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') {
            throw new Error(`${label}的值必须是字符串`)
        }
        result[key] = value
    }
    return result
}

function parseFormState(state: McpFormState): MCPServerConfig {
    const id = slugify(state.id || state.name)
    const env = parseJsonMap(state.envText, '环境变量')
    const headers = parseJsonMap(state.headersText, '请求头')

    return {
        id,
        name: state.name.trim(),
        enabled: state.enabled,
        transport: state.transport,
        command: state.command.trim(),
        args: state.argsText.split('\n').map((line) => line.trim()).filter(Boolean),
        ...(state.cwd.trim() ? { cwd: state.cwd.trim() } : {}),
        ...(env ? { env } : {}),
        ...(state.url.trim() ? { url: state.url.trim() } : {}),
        ...(headers ? { headers } : {}),
        ...(state.toolNamePrefix.trim() ? { toolNamePrefix: state.toolNamePrefix.trim() } : {}),
        ...(state.allowedToolsText.trim()
            ? { allowedTools: state.allowedToolsText.split('\n').map((line) => line.trim()).filter(Boolean) }
            : {}),
        autoApprove: state.autoApprove,
    }
}

function statusTag(status?: MCPServerStatus) {
    return status?.connected ? <Tag color="success">已连接</Tag> : <Tag color="error">未连接</Tag>
}

function renderPromptArguments(prompt: MCPPromptSummary) {
    if (!prompt.arguments || prompt.arguments.length === 0) return '无参数'
    return prompt.arguments.map((arg) => `${arg.name}${arg.required ? ' *' : ''}`).join(', ')
}

function McpSettings() {
    const config = useSettingsStore((s) => s.config)
    const mcpStatuses = useSettingsStore((s) => s.mcpStatuses)
    const updateConfig = useSettingsStore((s) => s.updateConfig)
    const refreshMcpStatuses = useSettingsStore((s) => s.refreshMcpStatuses)
    const refreshMcpServers = useSettingsStore((s) => s.refreshMcpServers)
    const refreshMcpServer = useSettingsStore((s) => s.refreshMcpServer)
    const testMcpServer = useSettingsStore((s) => s.testMcpServer)
    const getMcpServerDetails = useSettingsStore((s) => s.getMcpServerDetails)
    const getMcpPrompt = useSettingsStore((s) => s.getMcpPrompt)
    const readMcpResource = useSettingsStore((s) => s.readMcpResource)

    const [editingId, setEditingId] = useState<string | null>(null)
    const [formState, setFormState] = useState<McpFormState>(createEmptyState())
    const [modalOpen, setModalOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [testingId, setTestingId] = useState<string | null>(null)

    const [browserOpen, setBrowserOpen] = useState(false)
    const [browserLoading, setBrowserLoading] = useState(false)
    const [browsingServer, setBrowsingServer] = useState<MCPServerConfig | null>(null)
    const [browserStatus, setBrowserStatus] = useState<MCPServerStatus | null>(null)
    const [browserPrompts, setBrowserPrompts] = useState<MCPPromptSummary[]>([])
    const [browserResources, setBrowserResources] = useState<MCPResourceSummary[]>([])
    const [selectedPrompt, setSelectedPrompt] = useState<MCPPromptDetail | null>(null)
    const [selectedPromptName, setSelectedPromptName] = useState<string>('')
    const [selectedResource, setSelectedResource] = useState<MCPResourceDetail | null>(null)
    const [selectedResourceUri, setSelectedResourceUri] = useState<string>('')

    useEffect(() => {
        refreshMcpStatuses().catch((e) => {
            console.error('Failed to refresh MCP statuses:', e)
        })
    }, [refreshMcpStatuses])

    const servers = config?.mcpServers || []
    const statusMap = useMemo(
        () => new Map(mcpStatuses.map((item) => [item.serverId, item])),
        [mcpStatuses]
    )

    const openCreate = () => {
        setEditingId(null)
        setFormState(createEmptyState())
        setModalOpen(true)
    }

    const openEdit = (server: MCPServerConfig) => {
        setEditingId(server.id)
        setFormState(toFormState(server))
        setModalOpen(true)
    }

    const closeModal = () => {
        setModalOpen(false)
        setEditingId(null)
    }

    const saveServer = async () => {
        if (!config) return
        setSaving(true)
        try {
            const parsed = parseFormState(formState)
            if (!parsed.name) throw new Error('请填写名称')
            if (parsed.transport === 'stdio' && !parsed.command) throw new Error('请填写启动命令')
            if (parsed.transport !== 'stdio' && !parsed.url) throw new Error('请填写远程 URL')

            const duplicate = servers.find((item) => item.id === parsed.id && item.id !== editingId)
            if (duplicate) {
                throw new Error(`MCP server id 已存在: ${parsed.id}`)
            }

            const nextServers = editingId
                ? servers.map((item) => item.id === editingId ? parsed : item)
                : [...servers, parsed]

            await updateConfig('mcpServers', nextServers)
            message.success(editingId ? 'MCP server 已更新' : 'MCP server 已添加')
            closeModal()
        } catch (e: any) {
            message.error(e.message || String(e))
        } finally {
            setSaving(false)
        }
    }

    const updateServerList = async (nextServers: MCPServerConfig[]) => {
        await updateConfig('mcpServers', nextServers)
    }

    const handleToggle = async (server: MCPServerConfig, enabled: boolean) => {
        await updateServerList(servers.map((item) => item.id === server.id ? { ...item, enabled } : item))
        message.success(enabled ? 'MCP server 已启用' : 'MCP server 已禁用')
    }

    const handleDelete = async (serverId: string) => {
        await updateServerList(servers.filter((item) => item.id !== serverId))
        message.success('MCP server 已删除')
    }

    const handleTest = async (server: MCPServerConfig) => {
        setTestingId(server.id)
        try {
            const status = await testMcpServer(server)
            if (status.connected) {
                message.success(`连接成功，工具 ${status.toolCount} / Prompts ${status.promptCount} / Resources ${status.resourceCount}`)
            } else {
                message.error(status.lastError || '连接失败')
            }
            await refreshMcpStatuses()
        } finally {
            setTestingId(null)
        }
    }

    const handleRefresh = async (serverId: string) => {
        const status = await refreshMcpServer(serverId)
        if (status.connected) {
            message.success(`已刷新，工具 ${status.toolCount} / Prompts ${status.promptCount} / Resources ${status.resourceCount}`)
        } else {
            message.error(status.lastError || '刷新失败')
        }
    }

    const openBrowser = async (server: MCPServerConfig) => {
        setBrowserOpen(true)
        setBrowsingServer(server)
        setBrowserLoading(true)
        setBrowserStatus(statusMap.get(server.id) || null)
        setBrowserPrompts([])
        setBrowserResources([])
        setSelectedPrompt(null)
        setSelectedPromptName('')
        setSelectedResource(null)
        setSelectedResourceUri('')

        try {
            const details = await getMcpServerDetails(server.id)
            setBrowserStatus(details.status)
            setBrowserPrompts(details.prompts)
            setBrowserResources(details.resources)
        } catch (e: any) {
            message.error(e.message || '加载 MCP 详情失败')
        } finally {
            setBrowserLoading(false)
        }
    }

    const loadPrompt = async (promptName: string) => {
        if (!browsingServer) return
        setSelectedPromptName(promptName)
        try {
            const detail = await getMcpPrompt(browsingServer.id, promptName)
            setSelectedPrompt(detail)
        } catch (e: any) {
            message.error(e.message || '加载 Prompt 失败')
        }
    }

    const loadResource = async (uri: string) => {
        if (!browsingServer) return
        setSelectedResourceUri(uri)
        try {
            const detail = await readMcpResource(browsingServer.id, uri)
            setSelectedResource(detail)
        } catch (e: any) {
            message.error(e.message || '读取 Resource 失败')
        }
    }

    if (!config) return null

    return (
        <div style={{ padding: '0 16px' }}>
            <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    支持 `stdio`、`streamable-http`、`sse`。保存后会自动重连并刷新 tools/prompts/resources。
                </Typography.Text>
                <Space>
                    <Button size="small" icon={<ReloadOutlined />} onClick={() => refreshMcpServers().then(() => message.success('MCP servers 已刷新'))}>
                        刷新全部
                    </Button>
                    <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>
                        添加 Server
                    </Button>
                </Space>
            </Space>

            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="远程 transport 建议显式配置请求头；工具名前缀建议保持简短，避免映射后的工具名过长。"
            />

            {servers.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有配置 MCP server" />
            ) : (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {servers.map((server) => {
                        const status = statusMap.get(server.id)
                        const isTesting = testingId === server.id

                        return (
                            <Card
                                key={server.id}
                                size="small"
                                title={
                                    <Space>
                                        <span>{server.name}</span>
                                        <Tag color={server.enabled ? 'blue' : 'default'}>{server.enabled ? '已启用' : '已禁用'}</Tag>
                                        {statusTag(status)}
                                        <Tag>{server.transport}</Tag>
                                    </Space>
                                }
                                extra={
                                    <Space>
                                        <Switch size="small" checked={server.enabled} onChange={(checked) => handleToggle(server, checked)} />
                                        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openBrowser(server)} />
                                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(server)} />
                                        <Popconfirm title="确认删除这个 MCP server？" onConfirm={() => handleDelete(server.id)}>
                                            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                                        </Popconfirm>
                                    </Space>
                                }
                            >
                                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                    {server.transport === 'stdio' ? (
                                        <>
                                            <Typography.Text code>{server.command}</Typography.Text>
                                            {server.args.length > 0 && (
                                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                                    参数：{server.args.join(' ')}
                                                </Typography.Text>
                                            )}
                                        </>
                                    ) : (
                                        <Typography.Text code>{server.url}</Typography.Text>
                                    )}
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                        ID：{server.id}{server.toolNamePrefix ? ` · 前缀：${server.toolNamePrefix}` : ''}
                                    </Typography.Text>
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                        Tools：{status?.toolCount || 0} · Prompts：{status?.promptCount || 0} · Resources：{status?.resourceCount || 0}
                                    </Typography.Text>
                                    {status?.serverVersion && (
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            Server Version：{status.serverVersion}
                                        </Typography.Text>
                                    )}
                                    {status?.lastError && (
                                        <Typography.Text type="danger" style={{ fontSize: 12 }}>
                                            {status.lastError}
                                        </Typography.Text>
                                    )}
                                    <Space>
                                        <Button
                                            size="small"
                                            icon={status?.connected ? <CheckCircleOutlined /> : <WarningOutlined />}
                                            loading={isTesting}
                                            onClick={() => handleTest(server)}
                                        >
                                            测试连接
                                        </Button>
                                        <Button size="small" icon={<ReloadOutlined />} onClick={() => handleRefresh(server.id)}>
                                            刷新能力
                                        </Button>
                                        <Button size="small" icon={<EyeOutlined />} onClick={() => openBrowser(server)}>
                                            浏览
                                        </Button>
                                    </Space>
                                </Space>
                            </Card>
                        )
                    })}
                </Space>
            )}

            <Modal
                title={editingId ? '编辑 MCP Server' : '添加 MCP Server'}
                open={modalOpen}
                onCancel={closeModal}
                onOk={saveServer}
                okText={editingId ? '保存' : '添加'}
                confirmLoading={saving}
                width={700}
            >
                <Form layout="vertical" size="small">
                    <Form.Item label="名称" required>
                        <Input value={formState.name} onChange={(e) => setFormState((state) => ({ ...state, name: e.target.value }))} />
                    </Form.Item>
                    <Form.Item label="ID" extra="留空时会根据名称自动生成，只允许字母、数字和连字符。">
                        <Input value={formState.id} onChange={(e) => setFormState((state) => ({ ...state, id: e.target.value }))} />
                    </Form.Item>
                    <Form.Item label="Transport">
                        <Select
                            value={formState.transport}
                            onChange={(value: MCPTransportType) => setFormState((state) => ({ ...state, transport: value }))}
                            options={[
                                { value: 'stdio', label: 'stdio' },
                                { value: 'streamable-http', label: 'streamable-http' },
                                { value: 'sse', label: 'sse' },
                            ]}
                        />
                    </Form.Item>

                    {formState.transport === 'stdio' ? (
                        <>
                            <Form.Item label="命令" required>
                                <Input value={formState.command} onChange={(e) => setFormState((state) => ({ ...state, command: e.target.value }))} placeholder="例如：npx" />
                            </Form.Item>
                            <Form.Item label="参数" extra="每行一个参数。">
                                <Input.TextArea value={formState.argsText} onChange={(e) => setFormState((state) => ({ ...state, argsText: e.target.value }))} autoSize={{ minRows: 3, maxRows: 8 }} />
                            </Form.Item>
                            <Form.Item label="工作目录">
                                <Input value={formState.cwd} onChange={(e) => setFormState((state) => ({ ...state, cwd: e.target.value }))} placeholder="留空则使用当前工作目录设置" />
                            </Form.Item>
                            <Form.Item label="环境变量（JSON）">
                                <Input.TextArea value={formState.envText} onChange={(e) => setFormState((state) => ({ ...state, envText: e.target.value }))} placeholder={'例如：{\n  "API_KEY": "xxx"\n}'} autoSize={{ minRows: 3, maxRows: 8 }} />
                            </Form.Item>
                        </>
                    ) : (
                        <>
                            <Form.Item label="URL" required>
                                <Input value={formState.url} onChange={(e) => setFormState((state) => ({ ...state, url: e.target.value }))} placeholder="例如：https://example.com/mcp" />
                            </Form.Item>
                            <Form.Item label="请求头（JSON）">
                                <Input.TextArea value={formState.headersText} onChange={(e) => setFormState((state) => ({ ...state, headersText: e.target.value }))} placeholder={'例如：{\n  "Authorization": "Bearer xxx"\n}'} autoSize={{ minRows: 3, maxRows: 8 }} />
                            </Form.Item>
                        </>
                    )}

                    <Form.Item label="工具名前缀">
                        <Input value={formState.toolNamePrefix} onChange={(e) => setFormState((state) => ({ ...state, toolNamePrefix: e.target.value }))} placeholder="例如：fs" />
                    </Form.Item>
                    <Form.Item label="允许工具列表" extra="留空表示允许该 server 暴露的所有工具；每行一个原始工具名。">
                        <Input.TextArea value={formState.allowedToolsText} onChange={(e) => setFormState((state) => ({ ...state, allowedToolsText: e.target.value }))} autoSize={{ minRows: 2, maxRows: 6 }} />
                    </Form.Item>
                    <Space>
                        <Space>
                            <Switch checked={formState.enabled} onChange={(checked) => setFormState((state) => ({ ...state, enabled: checked }))} />
                            <span>启用</span>
                        </Space>
                        <Space>
                            <Switch checked={formState.autoApprove} onChange={(checked) => setFormState((state) => ({ ...state, autoApprove: checked }))} />
                            <span>自动批准非只读工具</span>
                        </Space>
                    </Space>
                </Form>
            </Modal>

            <Modal
                title={browsingServer ? `MCP Browser · ${browsingServer.name}` : 'MCP Browser'}
                open={browserOpen}
                onCancel={() => setBrowserOpen(false)}
                footer={null}
                width={900}
            >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {browserStatus ? `状态：${browserStatus.connected ? '已连接' : '未连接'} · Tools ${browserStatus.toolCount} · Prompts ${browserStatus.promptCount} · Resources ${browserStatus.resourceCount}` : ''}
                    </Typography.Text>
                    <Tabs
                        items={[
                            {
                                key: 'prompts',
                                label: `Prompts (${browserPrompts.length})`,
                                children: browserLoading ? null : browserPrompts.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无 Prompts" /> : (
                                    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12 }}>
                                        <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                                            {browserPrompts.map((prompt) => (
                                                <div
                                                    key={prompt.name}
                                                    onClick={() => loadPrompt(prompt.name)}
                                                    style={{
                                                        padding: '10px 12px',
                                                        cursor: 'pointer',
                                                        borderBottom: '1px solid #f5f5f5',
                                                        background: selectedPromptName === prompt.name ? '#f5f7ff' : '#fff',
                                                    }}
                                                >
                                                    <div style={{ fontWeight: 600 }}>{prompt.title || prompt.name}</div>
                                                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>{renderPromptArguments(prompt)}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, minHeight: 240 }}>
                                            {selectedPrompt ? (
                                                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                                    {selectedPrompt.description && <Typography.Text type="secondary">{selectedPrompt.description}</Typography.Text>}
                                                    {selectedPrompt.messages.map((item, index) => (
                                                        <div key={`${item.role}-${index}`}>
                                                            <Typography.Text strong>{item.role}</Typography.Text>
                                                            <pre style={{ marginTop: 6, padding: 12, borderRadius: 8, background: '#fafafa', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.content}</pre>
                                                        </div>
                                                    ))}
                                                </Space>
                                            ) : (
                                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个 Prompt 查看内容" />
                                            )}
                                        </div>
                                    </div>
                                ),
                            },
                            {
                                key: 'resources',
                                label: `Resources (${browserResources.length})`,
                                children: browserLoading ? null : browserResources.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无 Resources" /> : (
                                    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12 }}>
                                        <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8 }}>
                                            {browserResources.map((resource) => (
                                                <div
                                                    key={resource.uri}
                                                    onClick={() => loadResource(resource.uri)}
                                                    style={{
                                                        padding: '10px 12px',
                                                        cursor: 'pointer',
                                                        borderBottom: '1px solid #f5f5f5',
                                                        background: selectedResourceUri === resource.uri ? '#f5f7ff' : '#fff',
                                                    }}
                                                >
                                                    <div style={{ fontWeight: 600 }}>{resource.title || resource.name}</div>
                                                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>{resource.uri}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, minHeight: 240 }}>
                                            {selectedResource ? (
                                                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                                    <Typography.Text type="secondary">{selectedResource.uri}</Typography.Text>
                                                    <pre style={{ margin: 0, padding: 12, borderRadius: 8, background: '#fafafa', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto' }}>{selectedResource.text}</pre>
                                                </Space>
                                            ) : (
                                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个 Resource 查看内容" />
                                            )}
                                        </div>
                                    </div>
                                ),
                            },
                        ]}
                    />
                </Space>
            </Modal>
        </div>
    )
}

export default McpSettings
