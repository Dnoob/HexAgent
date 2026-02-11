// Anthropic Provider — Claude 使用不同的 API 格式，需要专用 SDK
import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, ChatMessage, ToolCallInfo, StreamCallbacks, ChatOptions } from '../types'

interface AnthropicProviderConfig {
    name: string
    apiKey: string
    defaultModel: string
    baseURL?: string
    useAuthToken?: boolean  // 使用 Bearer token 而非 x-api-key
}

export class AnthropicProvider implements LLMProvider {
    readonly name: string
    private client: Anthropic
    private defaultModel: string

    constructor(config: AnthropicProviderConfig) {
        this.name = config.name
        this.defaultModel = config.defaultModel
        const clientOpts: Record<string, any> = {
            apiKey: config.apiKey,
        }
        if (config.baseURL) {
            clientOpts.baseURL = config.baseURL
        }
        if (config.useAuthToken) {
            // MiniMax 等第三方 Anthropic 兼容端点使用 Bearer token
            clientOpts.apiKey = 'placeholder'
            clientOpts.defaultHeaders = {
                'Authorization': `Bearer ${config.apiKey}`,
                'x-api-key': config.apiKey,
            }
        }
        this.client = new Anthropic(clientOpts)
    }

    async chat(
        messages: ChatMessage[],
        tools: any[],
        callbacks: StreamCallbacks,
        options: ChatOptions,
        signal?: AbortSignal
    ): Promise<ToolCallInfo[]> {
        // Separate system message from conversation messages
        const systemMessages = messages.filter(m => m.role === 'system')
        const nonSystemMessages = messages.filter(m => m.role !== 'system')

        const systemText = systemMessages.map(m => m.content || '').join('\n\n') || undefined

        // Convert messages to Anthropic format
        const anthropicMessages = this.convertMessages(nonSystemMessages)

        // Convert OpenAI-style tool definitions to Anthropic format
        const anthropicTools = tools.length > 0 ? this.convertTools(tools) : undefined

        const stream = this.client.messages.stream({
            model: options.model || this.defaultModel,
            max_tokens: options.maxTokens || 4096,
            temperature: options.temperature,
            system: systemText,
            messages: anthropicMessages,
            tools: anthropicTools,
        }, { signal: signal ?? undefined })

        const toolCalls: ToolCallInfo[] = []
        let currentToolId = ''
        let currentToolName = ''
        let currentToolArgs = ''

        stream.on('text', (text) => {
            callbacks.onChunk(text)
        })

        stream.on('contentBlock', (block) => {
            if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input),
                    },
                })
            }
        })

        // Wait for stream to complete
        const finalMessage = await stream.finalMessage()

        // If there are tool calls, push assistant message to messages array for context
        if (toolCalls.length > 0) {
            messages.push({
                role: 'assistant',
                content: null,
                tool_calls: toolCalls,
            })
        }

        return toolCalls
    }

    /** Convert internal ChatMessage[] to Anthropic message format */
    private convertMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
        const result: Anthropic.MessageParam[] = []

        for (const msg of messages) {
            if (msg.role === 'assistant') {
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    // Assistant message with tool calls -> content blocks
                    const content: Anthropic.ContentBlockParam[] = []
                    if (msg.content) {
                        content.push({ type: 'text', text: msg.content })
                    }
                    for (const tc of msg.tool_calls) {
                        let input: Record<string, unknown>
                        try {
                            input = JSON.parse(tc.function.arguments)
                        } catch {
                            input = {}
                        }
                        content.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.function.name,
                            input,
                        })
                    }
                    result.push({ role: 'assistant', content })
                } else {
                    result.push({ role: 'assistant', content: msg.content || '' })
                }
            } else if (msg.role === 'tool') {
                // Tool results -> user message with tool_result content block
                result.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: msg.tool_call_id || '',
                            content: msg.content || '',
                        },
                    ],
                })
            } else if (msg.role === 'user') {
                result.push({ role: 'user', content: msg.content || '' })
            }
        }

        return result
    }

    /** Convert OpenAI-style tool definitions to Anthropic format */
    private convertTools(tools: any[]): Anthropic.Tool[] {
        return tools
            .filter(t => t.type === 'function')
            .map(t => ({
                name: t.function.name,
                description: t.function.description || '',
                input_schema: t.function.parameters || { type: 'object' as const, properties: {} },
            }))
    }
}
