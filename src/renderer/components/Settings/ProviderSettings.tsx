// ProviderSettings — 模型/Provider 配置
import { useState, useEffect } from 'react'
import { Form, Select, Input, Button, Space, message, Card, Typography } from 'antd'
import { EyeInvisibleOutlined, EyeOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../../store'
import type { LLMProviderType, AuthMode } from '../../../shared/types'

const PROVIDERS: { value: LLMProviderType; label: string; models: string[] }[] = [
    { value: 'kimi', label: 'Kimi', models: ['kimi-K2.5', 'moonshot-v1-32k', 'moonshot-v1-8k'] },
    { value: 'minimax', label: 'MiniMax', models: ['MiniMax-M2.1'] },
]

function ProviderSettings() {
    const config = useSettingsStore((s) => s.config)
    const updateConfig = useSettingsStore((s) => s.updateConfig)
    const setApiKey = useSettingsStore((s) => s.setApiKey)
    const [apiKeyInput, setApiKeyInput] = useState('')
    const [showKey, setShowKey] = useState(false)

    const activeProvider = config?.activeProvider || 'kimi'
    const activeModel = config?.activeModel || 'kimi-K2.5'
    const authMode = (config?.authMode || 'api') as AuthMode
    const currentProviderInfo = PROVIDERS.find((p) => p.value === activeProvider)

    // 加载已存储的 API Key
    useEffect(() => {
        setApiKeyInput('')
        setShowKey(false)
    }, [activeProvider])

    const handleProviderChange = (value: LLMProviderType) => {
        updateConfig('activeProvider', value)
        const provider = PROVIDERS.find((p) => p.value === value)
        if (provider) {
            updateConfig('activeModel', provider.models[0])
        }
    }

    const handleSaveKey = async () => {
        if (!apiKeyInput.trim()) return
        await setApiKey(activeProvider, apiKeyInput.trim())
        message.success('API Key 已保存')
        setApiKeyInput('')
    }

    return (
        <div style={{ padding: '0 16px' }}>
            <Form layout="vertical" size="small">
                {/* Provider 选择 */}
                <Form.Item label="AI 服务商">
                    <Select
                        value={activeProvider}
                        onChange={handleProviderChange}
                        options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
                    />
                </Form.Item>

                {/* 模型选择 */}
                <Form.Item label="模型">
                    <Select
                        value={activeModel}
                        onChange={(value) => updateConfig('activeModel', value)}
                        options={currentProviderInfo?.models.map((m) => ({ value: m, label: m })) || []}
                    />
                </Form.Item>

                {/* 认证模式 */}
                <Form.Item label="认证模式">
                    <Select
                        value={authMode}
                        onChange={(value: AuthMode) => updateConfig('authMode', value)}
                        options={[
                            { value: 'api', label: 'API Key' },
                            { value: 'coding-plan', label: 'Coding Plan' },
                        ]}
                    />
                </Form.Item>

                {/* API Key */}
                {(
                    <Form.Item label="API Key">
                        <Space.Compact style={{ width: '100%' }}>
                            <Input
                                type={showKey ? 'text' : 'password'}
                                placeholder="输入 API Key..."
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                                suffix={
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={showKey ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                                        onClick={() => setShowKey(!showKey)}
                                    />
                                }
                            />
                            <Button type="primary" onClick={handleSaveKey} disabled={!apiKeyInput.trim()}>
                                保存
                            </Button>
                        </Space.Compact>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            API Key 使用操作系统级加密存储
                        </Typography.Text>
                    </Form.Item>
                )}
            </Form>
        </div>
    )
}

export default ProviderSettings
