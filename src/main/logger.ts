// src/main/logger.ts — 日志系统
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_FILES = 5

class Logger {
    private logDir: string
    private logFile: string
    private minLevel: LogLevel

    constructor() {
        this.logDir = path.join(app.getPath('userData'), 'logs')
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true })
        }
        this.logFile = path.join(this.logDir, 'hexagent.log')
        this.minLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
        this.rotate()
    }

    private rotate(): void {
        try {
            if (!fs.existsSync(this.logFile)) return
            const stat = fs.statSync(this.logFile)
            if (stat.size < MAX_FILE_SIZE) return

            // 滚动：hexagent.4.log → 删除，3→4, 2→3, 1→2, hexagent.log→1
            for (let i = MAX_FILES - 1; i >= 1; i--) {
                const src = path.join(this.logDir, `hexagent.${i}.log`)
                const dst = path.join(this.logDir, `hexagent.${i + 1}.log`)
                if (fs.existsSync(src)) {
                    if (i + 1 >= MAX_FILES) {
                        fs.unlinkSync(src)
                    } else {
                        fs.renameSync(src, dst)
                    }
                }
            }
            fs.renameSync(this.logFile, path.join(this.logDir, 'hexagent.1.log'))
        } catch (e) {
            console.error('Log rotation failed:', e)
        }
    }

    private log(level: LogLevel, module: string, message: string, data?: any): void {
        if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return

        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '')
        const tag = level.toUpperCase().padEnd(5)
        let line = `[${timestamp}] [${tag}] [${module}] ${message}`
        if (data !== undefined) {
            line += ` ${JSON.stringify(data)}`
        }

        // 控制台输出
        const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
        consoleFn(line)

        // 文件输出
        try {
            fs.appendFileSync(this.logFile, line + '\n', 'utf-8')
        } catch {
            // 日志写入失败不应影响应用
        }
    }

    debug(module: string, message: string, data?: any): void { this.log('debug', module, message, data) }
    info(module: string, message: string, data?: any): void { this.log('info', module, message, data) }
    warn(module: string, message: string, data?: any): void { this.log('warn', module, message, data) }
    error(module: string, message: string, data?: any): void { this.log('error', module, message, data) }
}

export const logger = new Logger()
