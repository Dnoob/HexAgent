// src/main/llm/types.ts — LLM Provider 接口定义
import type { Artifact } from '../../shared/types'

export type { Artifact }

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string | null
    tool_calls?: ToolCallInfo[]
    tool_call_id?: string
    reasoning_content?: string
}

export interface ToolCallInfo {
    id: string
    function: { name: string; arguments: string }
}

export interface ToolResult {
    result: string
    artifacts: Artifact[]
}

export interface PlanStep {
    title: string
    description: string
    status: 'pending' | 'in_progress' | 'completed' | 'failed'
}

export interface Plan {
    steps: PlanStep[]
    currentStepIndex: number
}

export interface StreamCallbacks {
    onChunk: (text: string) => void
    onThinking?: (text: string) => void
    onDone: () => void
    onError: (error: string) => void
    onToolCall: (name: string, args: any) => void
    onToolResult?: (toolName: string, result: string, artifacts: Artifact[]) => void
    onPlanUpdate?: (plan: Plan) => void
}

export interface ChatOptions {
    model?: string
    temperature?: number
    maxTokens?: number
}

/**
 * LLM Provider 接口（类似 C++ 的纯虚基类）
 * 每个 Provider 实现这个接口
 */
export interface LLMProvider {
    readonly name: string

    /**
     * 流式对话
     * @returns 工具调用列表（如果有），空数组表示纯文本回复
     */
    chat(
        messages: ChatMessage[],
        tools: any[],
        callbacks: StreamCallbacks,
        options: ChatOptions,
        signal?: AbortSignal
    ): Promise<ToolCallInfo[]>
}
