// Provider 注册表 — 所有可用 LLM Provider 的静态配置
import type { LLMProviderType, LLMProviderConfig, AuthMode } from '../../shared/types'

/** 双模式配置：Regular API 和 Coding Plan 使用不同的 baseURL */
interface DualModeProviderConfig {
    api: LLMProviderConfig
    'coding-plan': LLMProviderConfig
}

export const PROVIDER_CONFIGS: Record<LLMProviderType, DualModeProviderConfig> = {
    openai: {
        api: {
            type: 'openai',
            name: 'OpenAI',
            baseURL: 'https://api.openai.com/v1',
            models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
            defaultModel: 'gpt-4o',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: true,
        },
        'coding-plan': {
            type: 'openai',
            name: 'OpenAI',
            baseURL: 'https://api.openai.com/v1',
            models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'],
            defaultModel: 'gpt-4o',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: true,
        },
    },
    anthropic: {
        api: {
            type: 'anthropic',
            name: 'Anthropic (Claude)',
            baseURL: 'https://api.anthropic.com',
            models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250514'],
            defaultModel: 'claude-sonnet-4-20250514',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: true,
        },
        'coding-plan': {
            type: 'anthropic',
            name: 'Anthropic (Claude)',
            baseURL: 'https://api.anthropic.com',
            models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250514'],
            defaultModel: 'claude-sonnet-4-20250514',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: true,
        },
    },
    kimi: {
        api: {
            type: 'kimi',
            name: 'Kimi (月之暗面)',
            baseURL: 'https://api.moonshot.cn/v1',
            models: ['kimi-K2.5', 'moonshot-v1-32k', 'moonshot-v1-8k'],
            defaultModel: 'kimi-K2.5',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: false,
        },
        'coding-plan': {
            type: 'kimi',
            name: 'Kimi (Coding Plan)',
            baseURL: 'https://api.kimi.com/coding/v1',
            models: ['kimi-K2.5', 'moonshot-v1-32k', 'moonshot-v1-8k'],
            defaultModel: 'kimi-K2.5',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: false,
            defaultHeaders: { 'User-Agent': 'KimiCLI/1.9' },
        },
    },
    deepseek: {
        api: {
            type: 'deepseek',
            name: 'DeepSeek',
            baseURL: 'https://api.deepseek.com',
            models: ['deepseek-chat', 'deepseek-reasoner'],
            defaultModel: 'deepseek-chat',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: false,
        },
        'coding-plan': {
            type: 'deepseek',
            name: 'DeepSeek',
            baseURL: 'https://api.deepseek.com',
            models: ['deepseek-chat', 'deepseek-reasoner'],
            defaultModel: 'deepseek-chat',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: false,
        },
    },
    minimax: {
        api: {
            type: 'minimax',
            name: 'MiniMax',
            baseURL: 'https://api.minimaxi.com/v1',
            models: ['MiniMax-M2.1'],
            defaultModel: 'MiniMax-M2.1',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: false,
            supportsReasoningSplit: true,
        },
        'coding-plan': {
            type: 'minimax',
            name: 'MiniMax (Coding Plan)',
            baseURL: 'https://api.minimaxi.com/v1',
            models: ['MiniMax-M2.1'],
            defaultModel: 'MiniMax-M2.1',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: false,
            supportsReasoningSplit: true,
        },
    },
    ollama: {
        api: {
            type: 'ollama',
            name: 'Ollama (本地)',
            baseURL: 'http://localhost:11434/v1',
            models: ['llama3', 'qwen2.5', 'deepseek-r1'],
            defaultModel: 'llama3',
            supportsStreaming: true,
            supportsTools: false,
            supportsVision: false,
        },
        'coding-plan': {
            type: 'ollama',
            name: 'Ollama (本地)',
            baseURL: 'http://localhost:11434/v1',
            models: ['llama3', 'qwen2.5', 'deepseek-r1'],
            defaultModel: 'llama3',
            supportsStreaming: true,
            supportsTools: false,
            supportsVision: false,
        },
    },
}

/** 获取指定 provider + authMode 的配置 */
export function getProviderConfig(type: LLMProviderType, authMode: AuthMode): LLMProviderConfig {
    return PROVIDER_CONFIGS[type][authMode]
}
