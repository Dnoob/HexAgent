// src/main/tools.ts — 工具系统（路径沙箱 + 多种工具）
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { BrowserWindow, ipcMain } from 'electron'
import { configManager } from './config'
import { logger } from './logger'
import type { ToolResult, Artifact } from './llm/types'
import type { ToolConfirmRequest } from '../shared/types'
import { mcpManager } from './mcp/manager'
import { browserManager } from './browser'

// ==================== HTML → 纯文本 ====================

function htmlToText(html: string): string {
    // 去除 script / style / nav / header / footer
    let text = html.replace(/<(script|style|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // block 元素转换行
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
    text = text.replace(/<br\s*\/?>/gi, '\n')
    // 剥离所有标签
    text = text.replace(/<[^>]+>/g, '')
    // 解码常见 HTML 实体
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    // 压缩空白
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    return text
}

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

type ConfirmActionOptions = Pick<ToolConfirmRequest, 'actionLabel' | 'actionDescription'>

function confirmAction(title: string, message: string, detail?: string, type = 'default', options?: ConfirmActionOptions): Promise<boolean> {
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
        win.webContents.send('tool:confirm-request', {
            id,
            title,
            message,
            detail: truncatedDetail,
            type,
            ...options,
        } satisfies ToolConfirmRequest)
    })
}

// ==================== 工具定义 ====================

export const builtinToolDefinitions = [
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
            name: 'edit_file',
            description: '局部编辑文件：找到 old_text 并替换为 new_text。需要用户确认。适用于小范围修改，无需重写整个文件。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '文件的绝对路径' },
                    old_text: { type: 'string', description: '要查找并替换的原始文本（必须精确匹配）' },
                    new_text: { type: 'string', description: '替换后的新文本' }
                },
                required: ['path', 'old_text', 'new_text']
            }
        }
    },
    {
        type: 'function' as const,
        function: {
            name: 'glob',
            description: '按文件名模式搜索文件。支持 glob 语法：** 匹配任意层级目录，* 匹配文件名，? 匹配单字符。只读操作。',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'glob 模式（如 **/*.ts, src/**/*.tsx, *.py）' },
                    directory: { type: 'string', description: '搜索根目录（可选，默认工作目录）' },
                    max_results: { type: 'number', description: '最大结果数，默认 50' }
                },
                required: ['pattern']
            }
        }
    },
    {
        type: 'function' as const,
        function: {
            name: 'grep',
            description: '在文件内容中搜索匹配的文本，支持正则表达式。返回 filepath:lineNum: matched_line 格式。只读操作。',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: '搜索模式（字符串或正则表达式）' },
                    directory: { type: 'string', description: '搜索的根目录绝对路径' },
                    file_pattern: { type: 'string', description: '文件名过滤（如 *.ts, *.py），默认搜索所有文件' },
                    max_results: { type: 'number', description: '最大结果数，默认 20' }
                },
                required: ['pattern', 'directory']
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
    {
        type: 'function' as const,
        function: {
            name: 'web_search',
            description: '搜索互联网，返回相关网页标题、URL 和摘要。只读操作，无需用户确认。',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: '搜索关键词' },
                    max_results: { type: 'number', description: '最大结果数，默认 5' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function' as const,
        function: {
            name: 'fetch_url',
            description: '获取指定 URL 的网页内容（HTML 自动转为纯文本）。只读操作，无需用户确认。',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: '要获取的 URL（仅支持 http/https）' },
                    max_length: { type: 'number', description: '返回内容的最大字符数，默认 10000' }
                },
                required: ['url']
            }
        }
    },
    {
        type: 'function' as const,
        function: {
            name: 'browser_action',
            description: '浏览器自动化。操作：navigate（打开URL）、screenshot（截图）、click（点击）、type（输入）、scroll（滚动）、evaluate（执行JS）、get_text（获取文本）、list_tabs（列出标签页）、switch_tab（切换标签页）、close（关闭浏览器）。多个标签页时用 list_tabs 查看、switch_tab 切换，navigate 默认在当前标签页打开，new_tab=true 新开标签页。',
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['navigate', 'screenshot', 'click', 'type', 'scroll', 'evaluate', 'get_text', 'list_tabs', 'switch_tab', 'close'],
                        description: '要执行的操作'
                    },
                    url: { type: 'string', description: 'navigate 的目标 URL' },
                    new_tab: { type: 'boolean', description: 'navigate 时是否新开标签页（默认 false 在当前标签页打开，设为 true 保留当前页面并新开标签页）' },
                    tab_index: { type: 'number', description: 'switch_tab 时的目标标签页索引（从 list_tabs 获取）' },
                    selector: { type: 'string', description: 'click/type/get_text 的 CSS 选择器' },
                    text: { type: 'string', description: 'type 操作要输入的文本' },
                    direction: { type: 'string', enum: ['up', 'down'], description: 'scroll 方向' },
                    code: { type: 'string', description: 'evaluate 执行的 JavaScript 代码' },
                },
                required: ['action']
            }
        }
    },
]

// ==================== 工具执行器 ====================

const MAX_FILE_SIZE = 1024 * 1024 // 1MB
const COMMAND_TIMEOUT = 30000 // 30s
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'out', '.next', '.cache'])

/** glob 模式转正则：支持 **、*、? */
function globMatch(pattern: string, filePath: string): boolean {
    const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // 转义特殊字符（不含 * ?）
        .replace(/\*\*/g, '\0')                   // 暂存 **
        .replace(/\*/g, '[^/]*')                   // * → 匹配非 / 字符
        .replace(/\?/g, '[^/]')                    // ? → 匹配单个非 / 字符
        .replace(/\0/g, '.*')                      // ** → 匹配任意字符（含 /）
    return new RegExp(`^${regex}$`).test(filePath)
}

/** 递归收集文件路径 */
function walkDirectory(dir: string, maxDepth: number, skipDirs: Set<string>): string[] {
    const results: string[] = []
    function walk(currentDir: string, depth: number) {
        if (depth > maxDepth) return
        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true })
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name)
                if (entry.isDirectory()) {
                    if (skipDirs.has(entry.name)) continue
                    walk(fullPath, depth + 1)
                } else {
                    results.push(fullPath)
                }
            }
        } catch { /* skip unreadable */ }
    }
    walk(dir, 0)
    return results
}

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

        try {
            const exists = fs.existsSync(args.path)
            if (exists && fs.statSync(args.path).isDirectory()) {
                return `错误: 目标路径是目录，无法写入文件: ${args.path}`
            }

            if (!await confirmAction(
                '写入文件',
                args.path,
                args.content,
                'file',
                exists
                    ? { actionLabel: '覆盖文件', actionDescription: '目标文件已存在，确认后会用新内容完整覆盖。' }
                    : { actionLabel: '新增文件', actionDescription: '目标文件不存在，确认后会创建文件并写入内容。' }
            )) {
                return '用户拒绝了写入操作'
            }

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

    edit_file: async (args) => {
        const err = validatePath(args.path)
        if (err) return `错误: ${err}`

        try {
            if (!fs.existsSync(args.path)) {
                return `错误: 文件不存在: ${args.path}`
            }
            const stat = fs.statSync(args.path)
            if (stat.size > MAX_FILE_SIZE) {
                return `错误: 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，限制 1MB`
            }
            const content = fs.readFileSync(args.path, 'utf-8')
            const index = content.indexOf(args.old_text)
            if (index === -1) {
                return `错误: 未找到要替换的文本。请确认提供的 old_text 与文件内容完全一致（包括空格和换行）。`
            }
            // 检查是否有多处匹配
            const secondIndex = content.indexOf(args.old_text, index + args.old_text.length)
            if (secondIndex !== -1) {
                return `错误: 找到多处匹配，请提供更精确的上下文文本以确保唯一匹配。`
            }

            const newContent = content.substring(0, index) + args.new_text + content.substring(index + args.old_text.length)

            // 生成 diff 预览
            const oldLines = args.old_text.split('\n').map((l: string) => `- ${l}`).join('\n')
            const newLines = args.new_text.split('\n').map((l: string) => `+ ${l}`).join('\n')
            const diff = `${oldLines}\n${newLines}`

            if (!await confirmAction('编辑文件', args.path, diff, 'file')) {
                return '用户拒绝了编辑操作'
            }

            fs.writeFileSync(args.path, newContent, 'utf-8')
            logger.info('tools', `File edited: ${args.path}`)
            return `文件已编辑: ${args.path}`
        } catch (e: any) {
            return `错误: ${e.message}`
        }
    },

    glob: (args) => {
        const dir = args.directory || configManager.get('workingDirectory')
        const err = validatePath(dir)
        if (err) return `错误: ${err}`

        const maxResults = args.max_results || 50
        const allFiles = walkDirectory(dir, 10, SKIP_DIRS)
        const matched: string[] = []

        for (const fullPath of allFiles) {
            if (matched.length >= maxResults) break
            const relativePath = path.relative(dir, fullPath)
            if (globMatch(args.pattern, relativePath)) {
                matched.push(relativePath)
            }
        }

        if (matched.length === 0) {
            return `未找到匹配 "${args.pattern}" 的文件`
        }
        return matched.join('\n')
    },

    grep: (args) => {
        const err = validatePath(args.directory)
        if (err) return `错误: ${err}`

        const maxResults = args.max_results || 20
        const filePattern = args.file_pattern
        const fileRegex = filePattern
            ? new RegExp('^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
            : null

        let searchRegex: RegExp
        try {
            searchRegex = new RegExp(args.pattern, 'i')
        } catch {
            searchRegex = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        }

        const allFiles = walkDirectory(args.directory, 5, SKIP_DIRS)
        const results: string[] = []

        for (const fullPath of allFiles) {
            if (results.length >= maxResults) break
            const fileName = path.basename(fullPath)
            if (fileRegex && !fileRegex.test(fileName)) continue
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
            } catch { /* skip */ }
        }

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

    web_search: async (args) => {
        const maxResults = args.max_results || 5
        const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)

            // 使用 POST 方法更可靠
            const response = await fetch('https://html.duckduckgo.com/html/', {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ q: args.query }).toString(),
                signal: controller.signal,
            })
            clearTimeout(timeout)

            const html = await response.text()

            // 解析搜索结果：按 result 块分割，分别提取标题、URL、摘要
            const results: string[] = []
            const blocks = html.split(/class="result\s/)
            for (const block of blocks) {
                if (results.length >= maxResults) break
                const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/)
                const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)
                if (!linkMatch) continue
                const url = decodeURIComponent(linkMatch[1].replace(/.*uddg=([^&]*).*/, '$1') || linkMatch[1])
                const title = decodeEntities(linkMatch[2].replace(/<[^>]+>/g, '')).trim()
                const snippet = snippetMatch ? decodeEntities(snippetMatch[1].replace(/<[^>]+>/g, '')).trim() : ''
                if (title && url) {
                    results.push(`${results.length + 1}. ${title}\n   URL: ${url}\n   ${snippet}`)
                }
            }

            if (results.length === 0) {
                return `未找到关于 "${args.query}" 的搜索结果`
            }
            logger.info('tools', `Web search: "${args.query}" → ${results.length} results`)
            return results.join('\n\n')
        } catch (e: any) {
            if (e.name === 'AbortError') return `搜索超时，请稍后重试`
            return `搜索错误: ${e.message}`
        }
    },

    fetch_url: async (args) => {
        const maxLength = args.max_length || 10000
        try {
            const url = new URL(args.url)
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return `错误: 仅支持 http/https 协议`
            }

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 30000)

            // 优先使用 Jina Reader（可渲染 JS 动态页面）
            let text = ''
            try {
                const jinaResponse = await fetch(`https://r.jina.ai/${args.url}`, {
                    headers: {
                        'Accept': 'text/plain',
                        'X-No-Cache': 'true',
                    },
                    signal: controller.signal,
                })
                if (jinaResponse.ok) {
                    text = await jinaResponse.text()
                }
            } catch {
                // Jina 失败，下面回退到直接 fetch
            }

            // 回退：直接 fetch + htmlToText
            if (!text || text.length < 50) {
                const response = await fetch(args.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
                    signal: controller.signal,
                })
                const contentType = response.headers.get('content-type') || ''
                const raw = await response.text()
                text = contentType.includes('text/html') ? htmlToText(raw) : raw
            }

            clearTimeout(timeout)

            if (text.length > maxLength) {
                text = text.substring(0, maxLength) + `\n...(内容已截断，共 ${text.length} 字符)`
            }

            logger.info('tools', `Fetched URL: ${args.url} (${text.length} chars)`)
            return text
        } catch (e: any) {
            if (e.name === 'AbortError') return `获取超时，请稍后重试`
            return `获取错误: ${e.message}`
        }
    },

    browser_action: async (args): Promise<ToolResult> => {
        const { action, url, selector, text, direction, code, new_tab } = args

        try {
            switch (action) {
                case 'navigate': {
                    if (!url) return { result: '错误: navigate 操作需要提供 url 参数', artifacts: [] }
                    if (!await confirmAction('浏览器导航', `${new_tab ? '[新标签页] ' : ''}打开 URL: ${url}`, undefined, 'default', {
                        actionLabel: new_tab ? '新标签页打开' : '打开网页',
                        actionDescription: new_tab ? '将新开标签页并打开此 URL，当前页面保持不变。' : '将在当前标签页打开此 URL。'
                    })) {
                        return { result: '用户拒绝了操作', artifacts: [] }
                    }
                    const page = new_tab ? await browserManager.newTab() : await browserManager.getPage()
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
                    const title = await page.title()
                    // 返回结果附带所有标签页列表，让 AI 感知多 tab 状态
                    const tabs = await browserManager.listTabs()
                    const tabInfo = tabs.map(t =>
                        `  [${t.index}]${t.active ? ' *' : '  '} ${t.title || '(空白页)'} - ${t.url}`
                    ).join('\n')
                    logger.info('tools', `Browser navigated to: ${url}${new_tab ? ' (new tab)' : ''}`)
                    return { result: `已${new_tab ? '在新标签页中' : ''}打开: ${url}\n页面标题: ${title}\n\n当前标签页:\n${tabInfo}`, artifacts: [] }
                }

                case 'screenshot': {
                    if (!browserManager.isRunning) {
                        return { result: '错误: 浏览器未启动，请先使用 navigate 打开网页', artifacts: [] }
                    }
                    const screenshot = await browserManager.screenshot()
                    return {
                        result: '截图完成',
                        artifacts: [{ type: 'image', name: 'screenshot.png', base64: screenshot }]
                    }
                }

                case 'click': {
                    if (!selector) return { result: '错误: click 操作需要提供 selector 参数', artifacts: [] }
                    if (!browserManager.isRunning) {
                        return { result: '错误: 浏览器未启动，请先使用 navigate 打开网页', artifacts: [] }
                    }
                    if (!await confirmAction('浏览器点击', `点击元素: ${selector}`, undefined, 'default', {
                        actionLabel: '点击元素',
                        actionDescription: `将点击匹配 CSS 选择器 "${selector}" 的元素。`
                    })) {
                        return { result: '用户拒绝了操作', artifacts: [] }
                    }
                    const page = await browserManager.getPage()
                    await page.waitForSelector(selector, { timeout: 5000 })
                    await page.click(selector)
                    await new Promise(r => setTimeout(r, 1000))
                    logger.info('tools', `Browser clicked: ${selector}`)
                    return { result: `已点击: ${selector}`, artifacts: [] }
                }

                case 'type': {
                    if (!selector) return { result: '错误: type 操作需要提供 selector 参数', artifacts: [] }
                    if (!text) return { result: '错误: type 操作需要提供 text 参数', artifacts: [] }
                    if (!browserManager.isRunning) {
                        return { result: '错误: 浏览器未启动，请先使用 navigate 打开网页', artifacts: [] }
                    }
                    if (!await confirmAction('浏览器输入', `在 ${selector} 中输入文本`, text, 'default', {
                        actionLabel: '输入文本',
                        actionDescription: `将在匹配 "${selector}" 的元素中输入文本。`
                    })) {
                        return { result: '用户拒绝了操作', artifacts: [] }
                    }
                    const page = await browserManager.getPage()
                    await page.waitForSelector(selector, { timeout: 5000 })
                    // 先清空输入框内容，再输入新文本
                    await page.$eval(selector, (el: any) => { el.value = ''; el.focus() })
                    await page.type(selector, text)
                    logger.info('tools', `Browser typed in: ${selector}`)
                    return { result: `已在 ${selector} 中输入文本`, artifacts: [] }
                }

                case 'scroll': {
                    if (!browserManager.isRunning) {
                        return { result: '错误: 浏览器未启动，请先使用 navigate 打开网页', artifacts: [] }
                    }
                    const page = await browserManager.getPage()
                    const scrollDir = direction === 'up' ? -600 : 600
                    await page.evaluate((dy) => window.scrollBy(0, dy), scrollDir)
                    await new Promise(r => setTimeout(r, 500))
                    return { result: `已${direction === 'up' ? '向上' : '向下'}滚动页面`, artifacts: [] }
                }

                case 'evaluate': {
                    if (!code) return { result: '错误: evaluate 操作需要提供 code 参数', artifacts: [] }
                    if (!browserManager.isRunning) {
                        return { result: '错误: 浏览器未启动，请先使用 navigate 打开网页', artifacts: [] }
                    }
                    if (!await confirmAction('执行浏览器 JS', '在页面中执行 JavaScript', code, 'command')) {
                        return { result: '用户拒绝了操作', artifacts: [] }
                    }
                    const page = await browserManager.getPage()
                    const jsResult = await page.evaluate(code)
                    const resultStr = jsResult === undefined ? 'undefined'
                        : typeof jsResult === 'string' ? jsResult
                        : JSON.stringify(jsResult, null, 2)
                    logger.info('tools', 'Browser JS evaluated')
                    return {
                        result: resultStr.length > 10000
                            ? resultStr.substring(0, 10000) + '\n...(输出过长已截断)'
                            : resultStr,
                        artifacts: []
                    }
                }

                case 'get_text': {
                    if (!browserManager.isRunning) {
                        return { result: '错误: 浏览器未启动，请先使用 navigate 打开网页', artifacts: [] }
                    }
                    const page = await browserManager.getPage()
                    let pageText: string
                    if (selector) {
                        await page.waitForSelector(selector, { timeout: 5000 })
                        pageText = await page.$eval(selector, el => el.textContent || '') as string
                    } else {
                        pageText = await page.evaluate(() => document.body.innerText) as string
                    }
                    if (pageText.length > 10000) {
                        pageText = pageText.substring(0, 10000) + '\n...(内容过长已截断)'
                    }
                    return { result: pageText, artifacts: [] }
                }

                case 'list_tabs': {
                    if (!browserManager.isRunning) {
                        return { result: '浏览器未启动，没有打开的标签页', artifacts: [] }
                    }
                    const tabs = await browserManager.listTabs()
                    const tabList = tabs.map(t =>
                        `[${t.index}]${t.active ? ' (当前)' : ''} ${t.title || '(空白页)'} - ${t.url}`
                    ).join('\n')
                    return { result: `共 ${tabs.length} 个标签页:\n${tabList}`, artifacts: [] }
                }

                case 'switch_tab': {
                    if (args.tab_index === undefined) return { result: '错误: switch_tab 需要提供 tab_index 参数', artifacts: [] }
                    if (!browserManager.isRunning) {
                        return { result: '错误: 浏览器未启动', artifacts: [] }
                    }
                    const page = await browserManager.switchTab(args.tab_index)
                    const title = await page.title()
                    return { result: `已切换到标签页 [${args.tab_index}]: ${title} - ${page.url()}`, artifacts: [] }
                }

                case 'close': {
                    await browserManager.close()
                    return { result: '浏览器已关闭', artifacts: [] }
                }

                default:
                    return { result: `错误: 未知操作 "${action}"`, artifacts: [] }
            }
        } catch (e: any) {
            logger.error('tools', `Browser action error: ${e.message}`)
            return { result: `浏览器操作错误: ${e.message}`, artifacts: [] }
        }
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
export async function getToolDefinitions() {
    return [
        ...builtinToolDefinitions,
        ...mcpManager.getToolDefinitions(),
    ]
}

export async function executeTool(name: string, args: any): Promise<string | ToolResult> {
    const executor = toolExecutors[name]
    if (executor) {
        return await executor(args)
    }

    const mcpResult = await mcpManager.executeTool(name, args)
    if (mcpResult) {
        return mcpResult
    }

    return `未知工具: ${name}`
}
