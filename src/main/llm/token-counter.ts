// Token 估算模块 — 不依赖 tiktoken，使用近似算法
import type { ChatMessage } from './types'

/**
 * 估算文本 token 数量（近似值）
 * - CJK 字符：约 1 token/字符
 * - ASCII 字符：约 0.25 token/字符（即 ~4 字符/token）
 */
export function estimateTokens(text: string): number {
    if (!text) return 0

    let tokens = 0
    for (const char of text) {
        const code = char.charCodeAt(0)
        if (
            (code >= 0x4E00 && code <= 0x9FFF) ||  // CJK 统一汉字
            (code >= 0x3400 && code <= 0x4DBF) ||  // CJK 扩展 A
            (code >= 0x3000 && code <= 0x303F) ||  // CJK 符号和标点
            (code >= 0xFF00 && code <= 0xFFEF)     // 全角形式
        ) {
            tokens += 1
        } else {
            tokens += 0.25
        }
    }

    return Math.ceil(tokens)
}

/** 估算单条消息的 token 数（包含角色标记等开销） */
function estimateMessageTokens(msg: ChatMessage): number {
    let tokens = 4 // 消息格式开销（role, separators）
    tokens += estimateTokens(msg.content || '')
    if (msg.reasoning_content) {
        tokens += estimateTokens(msg.reasoning_content)
    }
    if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
            tokens += estimateTokens(tc.function.name)
            tokens += estimateTokens(tc.function.arguments)
            tokens += 4 // tool_call 格式开销
        }
    }
    return tokens
}

/** 估算整个消息列表的 token 数 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
    let total = 3 // 对话格式开销（begin/end tokens）
    for (const msg of messages) {
        total += estimateMessageTokens(msg)
    }
    return total
}

/**
 * 裁剪消息以适应上下文窗口
 *
 * 策略：保留 system 消息 + 尽可能多的最近消息
 * 当总 token 数超过 maxTokens 的 80% 时触发裁剪
 */
export function trimMessages(messages: ChatMessage[], contextWindow: number): ChatMessage[] {
    const maxTokens = Math.floor(contextWindow * 0.8) // 留 20% 给回复
    const total = estimateMessagesTokens(messages)

    if (total <= maxTokens) return messages

    // 分离 system 消息和非 system 消息
    const systemMsgs = messages.filter(m => m.role === 'system')
    const nonSystemMsgs = messages.filter(m => m.role !== 'system')

    const systemTokens = systemMsgs.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
    const available = maxTokens - systemTokens

    if (available <= 0) {
        // system 消息本身就超限，只保留 system + 最后一条
        return [...systemMsgs, nonSystemMsgs[nonSystemMsgs.length - 1]]
    }

    // 从最近的消息开始，尽可能多地保留
    const kept: ChatMessage[] = []
    let usedTokens = 0

    for (let i = nonSystemMsgs.length - 1; i >= 0; i--) {
        const msgTokens = estimateMessageTokens(nonSystemMsgs[i])
        if (usedTokens + msgTokens > available) break
        kept.unshift(nonSystemMsgs[i])
        usedTokens += msgTokens
    }

    // 至少保留最后一条消息
    if (kept.length === 0 && nonSystemMsgs.length > 0) {
        kept.push(nonSystemMsgs[nonSystemMsgs.length - 1])
    }

    return [...systemMsgs, ...kept]
}

/** 各模型的上下文窗口大小（token 数） */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    // OpenAI
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'o1': 200000,
    'o3-mini': 200000,
    // Anthropic
    'claude-sonnet-4-20250514': 200000,
    'claude-opus-4-20250514': 200000,
    'claude-haiku-4-20250514': 200000,
    // Kimi
    'kimi-K2.5': 131072,
    'moonshot-v1-8k': 8192,
    'moonshot-v1-32k': 32768,
    // DeepSeek
    'deepseek-chat': 65536,
    'deepseek-reasoner': 65536,
    // MiniMax
    'MiniMax-M2.1': 200000,
    // Ollama (conservative defaults)
    'llama3': 8192,
    'qwen2.5': 32768,
    'deepseek-r1': 65536,
}

/** 获取模型的上下文窗口大小，未知模型返回保守默认值 */
export function getContextWindow(model: string): number {
    return MODEL_CONTEXT_WINDOWS[model] || 8192
}
