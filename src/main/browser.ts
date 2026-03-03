// src/main/browser.ts — 浏览器管理器（puppeteer-core 单例）
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import fs from 'fs'
import { logger } from './logger'

const IDLE_TIMEOUT = 5 * 60 * 1000 // 5 分钟空闲自动关闭

/** 自动检测系统安装的 Chrome/Edge 路径 */
function findChromePath(): string | null {
    const candidates: string[] = process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
        : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
        : [
            // Linux / WSL
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/microsoft-edge',
            '/usr/bin/microsoft-edge-stable',
        ]

    // WSL: 也检查 Windows 侧的 Chrome/Edge
    if (process.platform === 'linux') {
        try {
            const wslPaths = [
                '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
                '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
                '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
                '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            ]
            candidates.push(...wslPaths)
        } catch { /* ignore */ }
    }

    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p
        } catch { /* ignore */ }
    }
    return null
}

class BrowserManager {
    private browser: Browser | null = null
    private page: Page | null = null
    private idleTimer: NodeJS.Timeout | null = null

    /** 获取或启动浏览器页面 */
    async getPage(): Promise<Page> {
        this.resetIdleTimer()

        // 检查现有 page 是否仍可用
        if (this.page && !this.page.isClosed() && this.browser?.connected) {
            await this.page.bringToFront()
            return this.page
        }

        // page 已关闭但浏览器还在，创建新 tab
        if (this.browser?.connected) {
            this.page = await this.browser.newPage()
            await this.page.bringToFront()
            return this.page
        }

        // 需要（重新）启动
        await this.close()

        const executablePath = findChromePath()
        if (!executablePath) {
            throw new Error(
                '未找到 Chrome 或 Edge 浏览器。请安装 Google Chrome 或 Microsoft Edge 后重试。\n' +
                '下载地址: https://www.google.com/chrome/'
            )
        }

        logger.info('browser', `Launching browser: ${executablePath}`)
        this.browser = await puppeteer.launch({
            executablePath,
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--no-first-run',
            ],
            defaultViewport: null,
        })

        // 复用启动时自带的 tab，避免多出 about:blank
        const pages = await this.browser.pages()
        this.page = pages.length > 0 ? pages[0] : await this.browser.newPage()

        // 浏览器意外断开时清理
        this.browser.on('disconnected', () => {
            logger.info('browser', 'Browser disconnected')
            this.browser = null
            this.page = null
            this.clearIdleTimer()
        })

        return this.page
    }

    /** 新建标签页并设为当前活动页 */
    async newTab(): Promise<Page> {
        this.resetIdleTimer()
        if (!this.browser?.connected) {
            // 浏览器未启动，getPage 会自动启动
            return this.getPage()
        }
        this.page = await this.browser.newPage()
        await this.page.bringToFront()
        return this.page
    }

    /** 列出所有标签页 */
    async listTabs(): Promise<{ index: number; title: string; url: string; active: boolean }[]> {
        if (!this.browser?.connected) return []
        const pages = await this.browser.pages()
        const result: { index: number; title: string; url: string; active: boolean }[] = []
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i]
            if (p.isClosed()) continue
            result.push({
                index: i,
                title: await p.title().catch(() => ''),
                url: p.url(),
                active: p === this.page,
            })
        }
        return result
    }

    /** 切换到指定索引的标签页 */
    async switchTab(index: number): Promise<Page> {
        this.resetIdleTimer()
        if (!this.browser?.connected) {
            throw new Error('浏览器未启动')
        }
        const pages = await this.browser.pages()
        if (index < 0 || index >= pages.length) {
            throw new Error(`标签页索引 ${index} 超出范围（共 ${pages.length} 个标签页）`)
        }
        const target = pages[index]
        if (target.isClosed()) {
            throw new Error(`标签页 ${index} 已关闭`)
        }
        this.page = target
        await this.page.bringToFront()
        return this.page
    }

    /** 截取当前页面截图，返回 base64 */
    async screenshot(): Promise<string> {
        const page = await this.getPage()
        const buffer = await page.screenshot({ type: 'png', fullPage: false })
        return `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`
    }

    /** 关闭浏览器 */
    async close(): Promise<void> {
        this.clearIdleTimer()
        if (this.browser) {
            try {
                await this.browser.close()
            } catch { /* already closed */ }
            this.browser = null
            this.page = null
            logger.info('browser', 'Browser closed')
        }
    }

    /** 浏览器是否已启动 */
    get isRunning(): boolean {
        return !!this.browser?.connected
    }

    private resetIdleTimer(): void {
        this.clearIdleTimer()
        this.idleTimer = setTimeout(() => {
            logger.info('browser', 'Idle timeout, closing browser')
            this.close()
        }, IDLE_TIMEOUT)
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer)
            this.idleTimer = null
        }
    }
}

export const browserManager = new BrowserManager()
