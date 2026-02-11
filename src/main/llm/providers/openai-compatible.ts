// OpenAI 兼容 Provider 基类（OpenAI / Kimi / DeepSeek 共用）
import OpenAI from 'openai'
import type { LLMProvider, ChatMessage, ToolCallInfo, StreamCallbacks, ChatOptions } from '../types'

interface OpenAICompatibleConfig {
    name: string
    apiKey: string
    baseURL: string
    defaultModel: string
    defaultHeaders?: Record<string, string>
    supportsReasoningContent?: boolean
    supportsReasoningSplit?: boolean
}

export class OpenAICompatibleProvider implements LLMProvider {
    readonly name: string
    private client: OpenAI
    private defaultModel: string
    private supportsReasoningContent: boolean
    private supportsReasoningSplit: boolean

    constructor(config: OpenAICompatibleConfig) {
        this.name = config.name
        this.defaultModel = config.defaultModel
        this.supportsReasoningContent = config.supportsReasoningContent || false
        this.supportsReasoningSplit = config.supportsReasoningSplit || false
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            defaultHeaders: config.defaultHeaders,
        })
    }

    async chat(
        messages: ChatMessage[],
        tools: any[],
        callbacks: StreamCallbacks,
        options: ChatOptions,
        signal?: AbortSignal
    ): Promise<ToolCallInfo[]> {
        const stream = await this.client.chat.completions.create({
            model: options.model || this.defaultModel,
            messages: messages as any,
            tools: tools.length > 0 ? tools : undefined,
            stream: true,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            ...(this.supportsReasoningSplit ? { reasoning_split: true } as any : {}),
        }, { signal })

        const toolCalls: ToolCallInfo[] = []
        let reasoningContent = ''

        for await (const chunk of stream) {
            const choice = chunk.choices[0]
            const delta = choice?.delta as any

            // 文字内容
            if (delta?.content) {
                callbacks.onChunk(delta.content)
            }

            // 思考内容（Kimi/DeepSeek 特有）
            if (this.supportsReasoningContent && typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
                reasoningContent += delta.reasoning_content
                callbacks.onThinking?.(delta.reasoning_content)
            }

            // 思考内容（MiniMax reasoning_split）
            if (this.supportsReasoningSplit && delta?.reasoning_details) {
                const details = delta.reasoning_details
                if (Array.isArray(details)) {
                    for (const detail of details) {
                        if (detail?.type === 'thinking' && typeof detail.content === 'string' && detail.content) {
                            reasoningContent += detail.content
                            callbacks.onThinking?.(detail.content)
                        }
                    }
                }
            }

            // 工具调用分片拼接
            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.index !== undefined) {
                        if (!toolCalls[tc.index]) {
                            toolCalls[tc.index] = { id: '', function: { name: '', arguments: '' } }
                        }
                        if (tc.id) toolCalls[tc.index].id = tc.id
                        if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name
                        if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments
                    }
                }
            }
        }

        // 如果有 reasoning_content，附加到返回的 toolCalls 上下文中
        // （通过修改 messages 来传递，和原来的逻辑一致）
        if (toolCalls.length > 0 && reasoningContent) {
            const assistantMsg: any = { role: 'assistant', content: null, tool_calls: toolCalls, reasoning_content: reasoningContent }
            messages.push(assistantMsg)
        } else if (toolCalls.length > 0) {
            messages.push({ role: 'assistant', content: null, tool_calls: toolCalls })
        }

        return toolCalls
    }
}
