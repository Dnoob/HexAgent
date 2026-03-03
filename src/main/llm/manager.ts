// LLM Manager — 管理 Provider 实例和 Agent Loop
import type { LLMProviderType, AuthMode } from '../../shared/types'
import type { LLMProvider, ChatMessage, StreamCallbacks, ChatOptions, ToolCallInfo, ToolResult, Plan, PlanStep } from './types'
import { getProviderConfig } from './provider-registry'
import { OpenAICompatibleProvider } from './providers/openai-compatible'
import { AnthropicProvider } from './providers/anthropic'
import { configManager } from '../config'
import { executeTool, getToolDefinitions } from '../tools'
import { logger } from '../logger'
import { trimMessages, compressMessages, getContextWindow, estimateMessagesTokens } from './token-counter'

/** 规划提示词 */
const PLANNING_PROMPT = `你是一个任务规划专家。请分析用户的请求，将其分解为清晰的执行步骤。

规则：
1. 如果任务很简单（如简单问答、单步操作），返回空计划：{"steps": []}
2. 如果任务需要多个步骤，返回包含步骤的计划
3. 每个步骤应该是独立可执行的
4. 步骤数量控制在 2-6 个

请严格按以下 JSON 格式返回，不要包含其他内容：
{"steps": [{"title": "步骤标题", "description": "详细描述这一步要做什么"}]}`

/** LLM 单次调用超时（2 分钟） */
const LLM_CALL_TIMEOUT = 120_000

/** Agent Loop 总超时（5 分钟） */
const AGENT_LOOP_TIMEOUT = 300_000

/** 带超时的 Promise 包装 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${label} 超时 (${Math.round(ms / 1000)}s)`)),
            ms
        )
        promise.then(
            (val) => { clearTimeout(timer); resolve(val) },
            (err) => { clearTimeout(timer); reject(err) }
        )
    })
}

export class LLMManager {
    private providers: Map<string, LLMProvider> = new Map()
    private activeAbortController: AbortController | null = null

    /** 获取或创建 Provider 实例（按 provider + authMode 缓存） */
    private getProvider(type: LLMProviderType, authMode: AuthMode): LLMProvider {
        const cacheKey = `${type}-${authMode}`
        const cached = this.providers.get(cacheKey)
        if (cached) return cached

        const config = getProviderConfig(type, authMode)
        const apiKey = configManager.getActiveApiKey()
        logger.info('llm', `Creating provider: ${type}/${authMode}, baseURL: ${config.baseURL}, apiKey: ${apiKey ? apiKey.slice(0, 8) + '...' : '(empty)'}`)

        let provider: LLMProvider
        const useAnthropicFormat = type === 'anthropic'
        if (useAnthropicFormat) {
            provider = new AnthropicProvider({
                name: config.name,
                apiKey,
                defaultModel: config.defaultModel,
            })
        } else {
            provider = new OpenAICompatibleProvider({
                name: config.name,
                apiKey: type === 'ollama' ? 'ollama' : apiKey,
                baseURL: config.baseURL,
                defaultModel: config.defaultModel,
                defaultHeaders: config.defaultHeaders,
                supportsReasoningContent: type === 'kimi' || type === 'deepseek',
                supportsReasoningSplit: config.supportsReasoningSplit,
            })
        }

        this.providers.set(cacheKey, provider)
        return provider
    }

    /** 清除缓存的 Provider（API Key 变更时调用） */
    clearProviderCache(type?: LLMProviderType): void {
        if (type) {
            this.providers.delete(type)
        } else {
            this.providers.clear()
        }
    }

    /** 取消当前正在进行的聊天 */
    cancel(): void {
        this.activeAbortController?.abort()
        this.activeAbortController = null
    }

    /**
     * 核心方法：流式对话 + Agent Loop
     */
    async chat(
        messages: ChatMessage[],
        callbacks: StreamCallbacks,
        options?: { provider?: LLMProviderType; model?: string }
    ): Promise<void> {
        const providerType = options?.provider || configManager.get('activeProvider')
        const model = options?.model || configManager.get('activeModel')
        const authMode = configManager.get('authMode') || 'api'
        const maxIterations = configManager.get('maxToolIterations')
        const temperature = configManager.get('temperature')
        const maxTokens = configManager.get('maxTokens')

        const provider = this.getProvider(providerType, authMode)
        this.activeAbortController = new AbortController()

        // 如果配置了系统提示词，插入到消息列表开头
        const systemPrompt = configManager.get('systemPrompt')
        if (systemPrompt && messages[0]?.role !== 'system') {
            messages.unshift({ role: 'system', content: systemPrompt })
        }

        logger.info('llm', `Starting chat with ${providerType}/${model} (${authMode})`)

        const chatOptions: ChatOptions = { model, temperature, maxTokens }
        const loopStartTime = Date.now()
        const enablePlanning = configManager.get('enablePlanning')

        try {
            if (enablePlanning) {
                await this.planAndExecute(
                    provider, messages, callbacks, chatOptions,
                    maxIterations, loopStartTime
                )
            } else {
                await this.agentLoop(
                    provider, messages, callbacks, chatOptions,
                    0, maxIterations, loopStartTime
                )
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                logger.info('llm', 'Chat cancelled by user')
                callbacks.onDone()
            } else {
                logger.error('llm', 'Chat error', { message: error.message })
                callbacks.onError(error.message || '未知错误')
                callbacks.onDone()
            }
        } finally {
            this.activeAbortController = null
        }
    }

    /** Plan-and-Execute：先规划再逐步执行 */
    private async planAndExecute(
        provider: LLMProvider,
        messages: ChatMessage[],
        callbacks: StreamCallbacks,
        options: ChatOptions,
        maxIterations: number,
        loopStartTime: number
    ): Promise<void> {
        // 规划阶段：用无工具的 LLM 调用生成计划
        let plan: Plan | null = null
        try {
            const planMessages: ChatMessage[] = [
                { role: 'system', content: PLANNING_PROMPT },
                ...messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-3),
            ]

            let planText = ''
            const planCallbacks: StreamCallbacks = {
                onChunk: (text) => { planText += text },
                onDone: () => {},
                onError: () => {},
                onToolCall: () => {},
            }

            await withTimeout(
                provider.chat(planMessages, [], planCallbacks, options, this.activeAbortController?.signal),
                LLM_CALL_TIMEOUT,
                '规划调用'
            )

            // 解析 JSON 计划
            const jsonMatch = planText.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])
                if (parsed.steps && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
                    const steps: PlanStep[] = parsed.steps.map((s: any) => ({
                        title: s.title || '',
                        description: s.description || '',
                        status: 'pending' as const,
                    }))
                    plan = { steps, currentStepIndex: 0 }
                    logger.info('llm', `Plan generated with ${steps.length} steps`)
                } else {
                    logger.info('llm', 'Plan is empty, falling back to direct execution')
                }
            }
        } catch (e: any) {
            logger.warn('llm', `Planning failed: ${e.message}, falling back to direct execution`)
        }

        // 无计划或空计划 → 直接走普通 agent loop
        if (!plan || plan.steps.length === 0) {
            await this.agentLoop(provider, messages, callbacks, options, 0, maxIterations, loopStartTime)
            return
        }

        // 通知前端：计划已生成
        callbacks.onPlanUpdate?.({ ...plan })

        // 执行阶段：遍历每个步骤
        for (let i = 0; i < plan.steps.length; i++) {
            if (this.activeAbortController?.signal.aborted) {
                throw new DOMException('Aborted', 'AbortError')
            }

            plan.currentStepIndex = i
            plan.steps[i].status = 'in_progress'
            callbacks.onPlanUpdate?.({ ...plan, steps: [...plan.steps] })

            // 注入步骤上下文
            const stepContext: ChatMessage = {
                role: 'system',
                content: `[当前执行步骤 ${i + 1}/${plan.steps.length}] ${plan.steps[i].title}\n${plan.steps[i].description}`,
            }
            messages.push(stepContext)

            try {
                // 用现有 agentLoop 执行当前步骤
                // 创建一个 wrapper callbacks，不在步骤内调用 onDone
                const stepDone = new Promise<void>((resolve) => {
                    const stepCallbacks: StreamCallbacks = {
                        ...callbacks,
                        onDone: () => resolve(),
                        onError: (error) => {
                            callbacks.onError(error)
                            resolve()
                        },
                    }
                    this.agentLoop(
                        provider, messages, stepCallbacks, options,
                        0, maxIterations, loopStartTime
                    ).catch(() => resolve())
                })
                await stepDone

                plan.steps[i].status = 'completed'
            } catch (e: any) {
                plan.steps[i].status = 'failed'
                logger.warn('llm', `Step ${i + 1} failed: ${e.message}`)
            }

            callbacks.onPlanUpdate?.({ ...plan, steps: [...plan.steps] })
        }

        callbacks.onDone()
    }

    /** 调用 LLM 生成摘要（用于对话压缩） */
    private async summarize(text: string): Promise<string> {
        const providerType = configManager.get('activeProvider')
        const authMode = configManager.get('authMode') || 'api'
        const model = configManager.get('activeModel')
        const provider = this.getProvider(providerType, authMode)

        const messages: ChatMessage[] = [
            { role: 'user', content: text },
        ]

        let result = ''
        const callbacks: StreamCallbacks = {
            onChunk: (chunk) => { result += chunk },
            onDone: () => {},
            onError: () => {},
            onToolCall: () => {},
        }

        await provider.chat(messages, [], callbacks, { model, temperature: 0.3, maxTokens: 1024 })
        return result
    }

    /** Agent Loop：递归执行工具调用 */
    private async agentLoop(
        provider: LLMProvider,
        messages: ChatMessage[],
        callbacks: StreamCallbacks,
        options: ChatOptions,
        depth: number,
        maxDepth: number,
        loopStartTime: number
    ): Promise<void> {
        // 检查迭代次数限制
        if (depth >= maxDepth) {
            callbacks.onChunk('\n[已达到最大工具调用次数限制]')
            callbacks.onDone()
            return
        }

        // 检查总时间限制
        if (Date.now() - loopStartTime > AGENT_LOOP_TIMEOUT) {
            callbacks.onChunk('\n[Agent Loop 超时，已自动停止]')
            callbacks.onDone()
            return
        }

        // 上下文窗口管理：优先压缩，fallback 到截断
        const model = options.model || 'gpt-4o'
        const contextWindow = getContextWindow(model)
        const tokensBefore = estimateMessagesTokens(messages)

        if (tokensBefore > contextWindow * 0.7) {
            try {
                const compressed = await compressMessages(messages, contextWindow, (text) => this.summarize(text))
                const tokensAfter = estimateMessagesTokens(compressed)
                logger.info('llm', `Context compressed: ${tokensBefore} → ${tokensAfter} tokens (window: ${contextWindow})`)
                messages.length = 0
                messages.push(...compressed)
            } catch (e: any) {
                logger.warn('llm', `Compression failed, falling back to trim: ${e.message}`)
                const trimmed = trimMessages(messages, contextWindow)
                const tokensAfter = estimateMessagesTokens(trimmed)
                logger.info('llm', `Context trimmed: ${tokensBefore} → ${tokensAfter} tokens (window: ${contextWindow})`)
                messages.length = 0
                messages.push(...trimmed)
            }
        }

        // 带超时地调用 LLM
        logger.info('llm', `Agent loop iteration ${depth + 1}/${maxDepth}`)

        const toolDefinitions = await getToolDefinitions()

        const toolCalls = await withTimeout(
            provider.chat(
                messages,
                toolDefinitions,
                callbacks,
                options,
                this.activeAbortController?.signal
            ),
            LLM_CALL_TIMEOUT,
            'LLM 调用'
        )

        if (toolCalls.length === 0) {
            callbacks.onDone()
            return
        }

        // 执行每个工具
        for (const tc of toolCalls) {
            // 检查是否已被取消
            if (this.activeAbortController?.signal.aborted) {
                throw new DOMException('Aborted', 'AbortError')
            }

            try {
                const args = JSON.parse(tc.function.arguments)
                callbacks.onToolCall(tc.function.name, args)

                logger.info('llm', `Executing tool: ${tc.function.name}`)
                const rawResult = await executeTool(tc.function.name, args)

                // Normalize: ToolResult (with artifacts) or plain string
                let resultStr: string
                let artifacts: ToolResult['artifacts'] = []
                if (typeof rawResult === 'string') {
                    resultStr = rawResult
                } else {
                    resultStr = rawResult.result
                    artifacts = rawResult.artifacts
                }

                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: resultStr,
                })

                // Notify renderer about tool result + artifacts
                callbacks.onToolResult?.(tc.function.name, resultStr, artifacts)
            } catch (e: any) {
                logger.warn('llm', `Tool execution failed: ${tc.function.name}`, { error: e.message })
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: `工具执行错误: ${e.message}`,
                })
                callbacks.onToolResult?.(tc.function.name, `工具执行错误: ${e.message}`, [])
            }
        }

        // 递归：继续 Agent Loop
        await this.agentLoop(
            provider, messages, callbacks, options,
            depth + 1, maxDepth, loopStartTime
        )
    }
}

export const llmManager = new LLMManager()
