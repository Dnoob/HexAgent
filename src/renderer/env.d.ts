// src/renderer/env.d.ts — 渲染进程类型声明
import type { HexAgentAPI } from '../shared/types'

interface Window {
    hexAgent: HexAgentAPI
}
