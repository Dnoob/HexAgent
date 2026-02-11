// src/main/tools.ts — 工具系统（路径沙箱 + 多种工具）
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { BrowserWindow, ipcMain } from 'electron'
import { configManager } from './config'
import { logger } from './logger'
import type { ToolResult, Artifact } from './llm/types'

// ==================== 路径沙箱 ====================

function validatePath(targetPath: string): string | null {
    const resolved = path.resolve(targetPath)
    // 合并 allowedDirectories + workingDirectory 作为允许列表
    const allowed = configManager.get('allowedDirectories')
    const workDir = configManager.get('workingDirectory')
    const allDirs = workDir ? [...new Set([...allowed, workDir])] : allowed
    for (const dir of allDirs) {
        const resolvedDir = path.resolve(dir)
        if (resolved === resolvedDir || resolved.startsWith(resolvedDir + path.sep)) {
            return null // 合法
        }
    }
    return `路径不在允许范围内: ${resolved}\n允许的目录: ${allDirs.join(', ')}`
}

// ==================== 确认弹窗（渲染进程内 Modal） ====================

let confirmIdCounter = 0

function confirmAction(title: string, message: string, detail?: string, type = 'default'): Promise<boolean> {
    if (configManager.get('autoApproveTools')) return Promise.resolve(true)

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) return Promise.resolve(false)

    const id = `confirm-${++confirmIdCounter}`
    const truncatedDetail = detail && detail.length > 2000
        ? detail.substring(0, 2000) + '\n...(内容过长已截断)'
        : detail

    return new Promise<boolean>((resolve) => {
        const handler = (_event: any, responseId: string, approved: boolean) => {
            if (responseId === id) {
                ipcMain.removeListener('tool:confirm-response', handler)
                resolve(approved)
            }
        }
        ipcMain.on('tool:confirm-response', handler)
        win.webContents.send('tool:confirm-request', { id, title, message, detail: truncatedDetail, type })
    })
}

// ==================== 工具定义 ====================

export const toolDefinitions = [
    {
        type: 'function' as const,
        function: {
            name: 'read_file',
            description: '读取指定路径的文件内容。文件大小限制 1MB。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '文件的绝对路径' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function' as const,
        function: {
            name: 'list_directory',
            description: '列出指定目录下的文件和文件夹，包含文件大小信息',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '目录的绝对路径' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function' as const,
        function: {
            name: 'write_file',
            description: '将内容写入指定路径的文件。需要用户确认。如果目标目录不存在会自动创建。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '文件的绝对路径' },
                    content: { type: 'string', description: '要写入的内容' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function' as const,
        function: {
            name: 'search_files',
            description: '在指定目录中搜索文件内容，支持字符串匹配和正则表达式',
            parameters: {
                type: 'object',
                properties: {
                    directory: { type: 'string', description: '搜索的根目录绝对路径' },
                    pattern: { type: 'string', description: '搜索模式（字符串或正则表达式）' },
                    file_pattern: { type: 'string', description: '文件名过滤（如 *.ts, *.py），默认 *' },
                    max_results: { type: 'number', description: '最大结果数，默认 20' }
                },
                required: ['directory', 'pattern']
            }
        }
    },
    {
        type: 'function' as const,
        function: {
            name: 'execute_python',
            description: '执行 Python 代码。需要用户确认。有 30 秒超时限制。',
            parameters: {
                type: 'object',
                properties: {
                    code: { type: 'string', description: 'Python 代码' }
                },
                required: ['code']
            }
        }
    },
    {
        type: 'function' as const,
        function: {
            name: 'run_command',
            description: '执行 shell 命令。需要用户确认。有 30 秒超时限制。禁止危险命令（rm -rf /、sudo 等）。',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell 命令' },
                    cwd: { type: 'string', description: '工作目录（可选，默认使用配置的工作目录）' }
                },
                required: ['command']
            }
        }
    },
]

// ==================== 工具执行器 ====================

const MAX_FILE_SIZE = 1024 * 1024 // 1MB
const COMMAND_TIMEOUT = 30000 // 30s

const DANGEROUS_COMMANDS = [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*|--recursive)\s+\//,  // rm -rf / and variants
    /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+\//,                  // rm -f /...
    /\bsudo\b/,
    /\bsu\s*($|\s+-|\s+\w)/,                              // su, su -, su root
    /\bmkfs\b/,
    /\bdd\s+.*of=\/dev/,
    /\bformat\b.*[A-Z]:/i,
    /\b:\(\)\s*\{/,                                        // fork bomb
    /\bchmod\s+777\b/,                                     // overly permissive chmod
    /\bchown\b/,
    /\bcurl\b.*\|\s*(ba)?sh/,                              // curl | bash, curl | sh
    /\bwget\b.*\|\s*(ba)?sh/,                              // wget | bash
    /\bnc\s+.*-e\b/,                                       // netcat reverse shell
    />\s*\/dev\/[sh]d[a-z]/,                               // > /dev/sda
    /\bkill\s+-9\s+(-1|1)\b/,                             // kill all processes
    /\b(shutdown|reboot|halt|poweroff)\b/,
    /\biptables\b/,
    /\bmount\b/,
    /\bumount\b/,
    /\bmkdir\s+-p\s+\/[a-z]/i,                            // mkdir -p in system dirs
    /\bsystemctl\s+(stop|disable|mask)\b/,
    />\s*\/etc\//,                                          // redirect to /etc/
    />\s*\/usr\//,                                          // redirect to /usr/
    /\beval\s/,                                             // eval injection risk
]

// ==================== 图片 Artifact 检测 ====================

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp'])
const MAX_IMAGE_SIZE = 2 * 1024 * 1024 // 2MB

/** 获取目录下的图片文件快照 (name → mtime) */
function snapshotImages(dir: string): Map<string, number> {
    const map = new Map<string, number>()
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
            if (!entry.isFile()) continue
            const ext = path.extname(entry.name).toLowerCase()
            if (!IMAGE_EXTENSIONS.has(ext)) continue
            try {
                const stat = fs.statSync(path.join(dir, entry.name))
                map.set(entry.name, stat.mtimeMs)
            } catch { /* skip */ }
        }
    } catch { /* dir may not exist */ }
    return map
}

/** 检测新创建的图片并读取为 base64 */
function detectNewImages(dir: string, before: Map<string, number>): Artifact[] {
    const artifacts: Artifact[] = []
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
            if (!entry.isFile()) continue
            const ext = path.extname(entry.name).toLowerCase()
            if (!IMAGE_EXTENSIONS.has(ext)) continue
            const fullPath = path.join(dir, entry.name)
            try {
                const stat = fs.statSync(fullPath)
                const prevMtime = before.get(entry.name)
                // New file or modified file
                if (prevMtime === undefined || stat.mtimeMs > prevMtime) {
                    if (stat.size > MAX_IMAGE_SIZE) {
                        logger.warn('tools', `Skipping large image: ${entry.name} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`)
                        continue
                    }
                    const mimeType = ext === '.svg' ? 'image/svg+xml'
                        : ext === '.png' ? 'image/png'
                        : ext === '.gif' ? 'image/gif'
                        : ext === '.webp' ? 'image/webp'
                        : 'image/jpeg'
                    const data = fs.readFileSync(fullPath)
                    const base64 = `data:${mimeType};base64,${data.toString('base64')}`
                    artifacts.push({ type: 'image', name: entry.name, base64 })
                    logger.info('tools', `Detected new image artifact: ${entry.name}`)
                }
            } catch { /* skip unreadable */ }
        }
    } catch { /* dir may not exist */ }
    return artifacts
}

// ==================== 工具执行器 ====================

const toolExecutors: Record<string, (args: any) => string | Promise<string> | Promise<ToolResult>> = {
    read_file: (args) => {
        const err = validatePath(args.path)
        if (err) return `错误: ${err}`

        try {
            const stat = fs.statSync(args.path)
            if (stat.size > MAX_FILE_SIZE) {
                return `错误: 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，限制 1MB`
            }
            return fs.readFileSync(args.path, 'utf-8')
        } catch (e: any) {
            return `错误: ${e.message}`
        }
    },

    list_directory: (args) => {
        const err = validatePath(args.path)
        if (err) return `错误: ${err}`

        try {
            const entries = fs.readdirSync(args.path, { withFileTypes: true })
            const lines = entries.map((e) => {
                if (e.isDirectory()) {
                    return `[目录] ${e.name}/`
                }
                try {
                    const stat = fs.statSync(path.join(args.path, e.name))
                    const size = stat.size < 1024 ? `${stat.size}B`
                        : stat.size < 1024 * 1024 ? `${(stat.size / 1024).toFixed(1)}KB`
                        : `${(stat.size / 1024 / 1024).toFixed(1)}MB`
                    return `[文件] ${e.name} (${size})`
                } catch {
                    return `[文件] ${e.name}`
                }
            })
            return lines.join('\n')
        } catch (e: any) {
            return `错误: ${e.message}`
        }
    },

    write_file: async (args) => {
        const err = validatePath(args.path)
        if (err) return `错误: ${err}`

        if (!await confirmAction('写入文件', args.path, args.content, 'file')) {
            return '用户拒绝了写入操作'
        }

        try {
            const dir = path.dirname(args.path)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            fs.writeFileSync(args.path, args.content, 'utf-8')
            logger.info('tools', `File written: ${args.path}`)
            return `文件已写入: ${args.path}`
        } catch (e: any) {
            return `错误: ${e.message}`
        }
    },

    search_files: (args) => {
        const err = validatePath(args.directory)
        if (err) return `错误: ${err}`

        const maxResults = args.max_results || 20
        const filePattern = args.file_pattern || '*'
        const results: string[] = []

        // 将 file_pattern 如 "*.ts" 转为正则
        const fileRegex = new RegExp(
            '^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
        )

        let searchRegex: RegExp
        try {
            searchRegex = new RegExp(args.pattern, 'i')
        } catch {
            searchRegex = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        }

        function searchDir(dir: string, depth: number) {
            if (depth > 5 || results.length >= maxResults) return
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true })
                for (const entry of entries) {
                    if (results.length >= maxResults) break
                    const fullPath = path.join(dir, entry.name)

                    if (entry.isDirectory()) {
                        // 跳过常见无用目录
                        if (['node_modules', '.git', '__pycache__', '.venv', 'dist', 'out'].includes(entry.name)) continue
                        searchDir(fullPath, depth + 1)
                    } else if (fileRegex.test(entry.name)) {
                        try {
                            const stat = fs.statSync(fullPath)
                            if (stat.size > MAX_FILE_SIZE) continue
                            const content = fs.readFileSync(fullPath, 'utf-8')
                            const lines = content.split('\n')
                            for (let i = 0; i < lines.length; i++) {
                                if (results.length >= maxResults) break
                                if (searchRegex.test(lines[i])) {
                                    results.push(`${fullPath}:${i + 1}: ${lines[i].trim()}`)
                                }
                            }
                        } catch { /* 跳过无法读取的文件 */ }
                    }
                }
            } catch { /* 跳过无法读取的目录 */ }
        }

        searchDir(args.directory, 0)

        if (results.length === 0) {
            return `未找到匹配 "${args.pattern}" 的内容`
        }
        return results.join('\n')
    },

    execute_python: async (args) => {
        if (!await confirmAction('执行 Python 代码', 'AI 要执行以下 Python 代码', args.code, 'python')) {
            return '用户拒绝了执行'
        }

        const cwd = configManager.get('workingDirectory')
        // Snapshot images before execution
        const imagesBefore = snapshotImages(cwd)

        return new Promise<ToolResult>((resolve) => {
            const proc = spawn('python3', ['-c', args.code], {
                cwd,
                timeout: COMMAND_TIMEOUT,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            })

            let stdout = ''
            let stderr = ''

            proc.stdout.on('data', (data) => { stdout += data.toString() })
            proc.stderr.on('data', (data) => { stderr += data.toString() })

            proc.on('close', (code) => {
                // 截断过长输出
                if (stdout.length > 10000) stdout = stdout.substring(0, 10000) + '\n...(输出过长已截断)'
                if (stderr.length > 5000) stderr = stderr.substring(0, 5000) + '\n...(错误输出过长已截断)'

                let result = ''
                if (stdout) result += `输出:\n${stdout}`
                if (stderr) result += `${result ? '\n' : ''}错误:\n${stderr}`
                if (!result) result = `进程退出，返回码: ${code}`
                logger.info('tools', `Python executed, exit code: ${code}`)

                // Detect newly created images
                const artifacts = detectNewImages(cwd, imagesBefore)
                if (artifacts.length > 0) {
                    result += `\n[生成了 ${artifacts.length} 个图片: ${artifacts.map(a => a.name).join(', ')}]`
                }

                resolve({ result, artifacts })
            })

            proc.on('error', (err) => {
                resolve({ result: `执行错误: ${err.message}`, artifacts: [] })
            })
        })
    },

    run_command: async (args) => {
        // 检查危险命令
        for (const pattern of DANGEROUS_COMMANDS) {
            if (pattern.test(args.command)) {
                return `拒绝执行危险命令: ${args.command}`
            }
        }

        const cwd = args.cwd || configManager.get('workingDirectory')
        const cwdErr = validatePath(cwd)
        if (cwdErr) return `错误: ${cwdErr}`

        if (!await confirmAction('执行命令', args.command, `工作目录: ${cwd}`, 'command')) {
            return '用户拒绝了执行'
        }

        return new Promise<string>((resolve) => {
            const isWin = process.platform === 'win32'
            const proc = spawn(isWin ? 'cmd' : 'bash', isWin ? ['/c', args.command] : ['-c', args.command], {
                cwd,
                timeout: COMMAND_TIMEOUT,
                env: process.env,
            })

            let stdout = ''
            let stderr = ''

            proc.stdout.on('data', (data) => { stdout += data.toString() })
            proc.stderr.on('data', (data) => { stderr += data.toString() })

            proc.on('close', (code) => {
                if (stdout.length > 10000) stdout = stdout.substring(0, 10000) + '\n...(输出过长已截断)'
                if (stderr.length > 5000) stderr = stderr.substring(0, 5000) + '\n...(错误输出过长已截断)'

                let result = ''
                if (stdout) result += stdout
                if (stderr) result += `${result ? '\n' : ''}stderr:\n${stderr}`
                if (!result) result = `命令执行完成，返回码: ${code}`
                logger.info('tools', `Command executed: ${args.command}, exit code: ${code}`)
                resolve(result)
            })

            proc.on('error', (err) => {
                resolve(`执行错误: ${err.message}`)
            })
        })
    },
}

// ==================== 工具执行入口 ====================

/** 执行工具，返回结果字符串或带 artifacts 的 ToolResult */
export function executeTool(name: string, args: any): string | Promise<string> | Promise<ToolResult> {
    const executor = toolExecutors[name]
    if (!executor) {
        return `未知工具: ${name}`
    }
    return executor(args)
}
