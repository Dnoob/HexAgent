// src/main/config.ts — 配置管理（类似 Qt 的 QSettings）
import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AppConfig, LLMProviderType, AuthMode } from '../shared/types'

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
const KEYS_DIR = path.join(app.getPath('userData'), 'keys')

function getDefaults(): AppConfig {
    return {
        activeProvider: 'kimi',
        activeModel: 'kimi-K2.5',
        authMode: 'api',
        theme: 'light',
        uiStyle: 'chatgpt',
        workingDirectory: app.getPath('home'),
        allowedDirectories: [app.getPath('home')],
        maxToolIterations: 20,
        autoApproveTools: false,
        enablePlanning: false,
        mcpServers: [],
        temperature: 0.7,
        maxTokens: 4096,
        systemPrompt: '你是 HexAgent，一个智能桌面助手。你可以帮助用户处理文件、回答问题、编写代码等任务。请用简洁清晰的中文回答。',
    }
}

class ConfigManager {
    private config: AppConfig

    constructor() {
        this.config = this.load()
    }

    private load(): AppConfig {
        const defaults = getDefaults()
        try {
            if (fs.existsSync(CONFIG_PATH)) {
                const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
                const saved = JSON.parse(raw)
                return { ...defaults, ...saved }
            }
        } catch (e) {
            console.error('Failed to load config:', e)
        }
        return defaults
    }

    save(): void {
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8')
        } catch (e) {
            console.error('Failed to save config:', e)
        }
    }

    get<K extends keyof AppConfig>(key: K): AppConfig[K] {
        return this.config[key]
    }

    set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
        this.config[key] = value
        this.save()
    }

    getAll(): AppConfig {
        return { ...this.config }
    }

    // ==================== API Key 管理（加密存储） ====================

    setApiKey(provider: string, key: string): void {
        if (!fs.existsSync(KEYS_DIR)) {
            fs.mkdirSync(KEYS_DIR, { recursive: true })
        }
        const keyPath = path.join(KEYS_DIR, `${provider}.key`)
        if (safeStorage.isEncryptionAvailable()) {
            const encrypted = safeStorage.encryptString(key)
            fs.writeFileSync(keyPath, encrypted)
        } else {
            // 降级：base64 编码（不安全但总比明文好一点）
            fs.writeFileSync(keyPath, Buffer.from(key).toString('base64'), 'utf-8')
        }
    }

    getApiKey(provider: string): string | null {
        const keyPath = path.join(KEYS_DIR, `${provider}.key`)
        try {
            if (!fs.existsSync(keyPath)) return null
            if (safeStorage.isEncryptionAvailable()) {
                const encrypted = fs.readFileSync(keyPath)
                return safeStorage.decryptString(encrypted)
            } else {
                const encoded = fs.readFileSync(keyPath, 'utf-8')
                return Buffer.from(encoded, 'base64').toString('utf-8')
            }
        } catch (e) {
            console.error(`Failed to read API key for ${provider}:`, e)
            return null
        }
    }

    /** 获取当前活跃 Provider 的 API Key（优先配置存储，回退环境变量） */
    getActiveApiKey(): string {
        const provider = this.config.activeProvider
        const authMode = this.config.authMode || 'api'
        // 先查加密存储（按 {provider}-{authMode} 格式）
        const storedKey = this.getApiKey(`${provider}-${authMode}`)
        if (storedKey) return storedKey
        // 兼容旧格式：按 provider 名查找
        const legacyKey = this.getApiKey(provider)
        if (legacyKey) return legacyKey
        // 回退到环境变量
        const envMap: Record<LLMProviderType, string> = {
            openai: 'OPENAI_API_KEY',
            anthropic: 'ANTHROPIC_API_KEY',
            kimi: 'KIMI_API_KEY',
            deepseek: 'DEEPSEEK_API_KEY',
            minimax: 'MINIMAX_API_KEY',
            ollama: '',
        }
        const envKey = envMap[provider]
        return (envKey && process.env[envKey]) || ''
    }
}

export const configManager = new ConfigManager()
