// GeneralSettings — 精简通用设置
import { Form, Radio, Slider, InputNumber, Button, Space, Typography, Collapse, Switch } from 'antd'
import { FolderOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../../store'

function GeneralSettings() {
    const config = useSettingsStore((s) => s.config)
    const updateConfig = useSettingsStore((s) => s.updateConfig)

    const handleSelectDirectory = async () => {
        const dir = await window.hexAgent.selectDirectory()
        if (dir) updateConfig('workingDirectory', dir)
    }

    if (!config) return null

    return (
        <div style={{ padding: '0 16px' }}>
            <Form layout="vertical" size="small">
                {/* 界面风格 */}
                <Form.Item label="界面风格">
                    <Radio.Group
                        value={config.uiStyle || 'chatgpt'}
                        onChange={(e) => updateConfig('uiStyle', e.target.value)}
                    >
                        <Radio.Button value="chatgpt">简约</Radio.Button>
                        <Radio.Button value="glass">极光</Radio.Button>
                    </Radio.Group>
                </Form.Item>

                {/* 主题 */}
                <Form.Item label="主题">
                    <Radio.Group
                        value={config.theme}
                        onChange={(e) => updateConfig('theme', e.target.value)}
                    >
                        <Radio.Button value="light">浅色</Radio.Button>
                        <Radio.Button value="dark">深色</Radio.Button>
                    </Radio.Group>
                </Form.Item>

                {/* 工作目录 */}
                <Form.Item label="工作目录">
                    <Space>
                        <Typography.Text code style={{ fontSize: 12 }}>
                            {config.workingDirectory}
                        </Typography.Text>
                        <Button size="small" icon={<FolderOutlined />} onClick={handleSelectDirectory}>
                            浏览
                        </Button>
                    </Space>
                </Form.Item>

                {/* 自动允许工具执行 */}
                <Form.Item label="自动允许工具执行" extra="开启后 AI 调用工具时不再弹窗确认">
                    <Switch
                        checked={config.autoApproveTools || false}
                        onChange={(v) => updateConfig('autoApproveTools', v)}
                    />
                </Form.Item>

                {/* 启用任务规划 */}
                <Form.Item label="启用任务规划" extra="开启后 AI 会先制定执行计划再逐步执行">
                    <Switch
                        checked={config.enablePlanning || false}
                        onChange={(v) => updateConfig('enablePlanning', v)}
                    />
                </Form.Item>

                {/* 高级选项 */}
                <Collapse
                    ghost
                    size="small"
                    items={[{
                        key: 'advanced',
                        label: <span style={{ fontSize: 12, color: '#9ca3af' }}>高级选项</span>,
                        children: (
                            <div>
                                <Form.Item label={`Temperature: ${config.temperature}`} style={{ marginBottom: 12 }}>
                                    <Slider min={0} max={2} step={0.1} value={config.temperature} onChange={(v) => updateConfig('temperature', v)} />
                                </Form.Item>
                                <Form.Item label="最大 Token 数" style={{ marginBottom: 0 }}>
                                    <InputNumber min={256} max={128000} step={256} value={config.maxTokens} onChange={(v) => v && updateConfig('maxTokens', v)} style={{ width: 150 }} />
                                </Form.Item>
                            </div>
                        ),
                    }]}
                />
            </Form>
        </div>
    )
}

export default GeneralSettings
