// src/renderer/styles/theme.ts — Ant Design 6 主题配置（Aether 设计语言）
import { theme, type ThemeConfig } from 'antd'
import type { UIStyle } from '../../shared/types'

// ==================== 默认风格（Aether） ====================
export const chatgptLightTheme: ThemeConfig = {
    token: {
        colorPrimary: '#6366f1',
        colorBgContainer: '#ffffff',
        colorBgLayout: '#f3f4f6',
        borderRadius: 12,
        fontSize: 14,
        colorText: '#111827',
        colorTextSecondary: '#6b7280',
        colorBorder: '#e5e7eb',
        colorBorderSecondary: '#e5e7eb',
    },
    components: {
        Layout: {
            headerBg: '#ffffff',
            siderBg: '#ffffff',
            bodyBg: '#ffffff',
            footerBg: '#ffffff',
        },
    },
}

export const chatgptDarkTheme: ThemeConfig = {
    token: {
        colorPrimary: '#818cf8',
        colorBgContainer: '#1e293b',
        colorBgLayout: '#0f172a',
        borderRadius: 12,
        fontSize: 14,
        colorText: '#f1f5f9',
        colorTextSecondary: '#94a3b8',
        colorBorder: '#334155',
        colorBorderSecondary: '#334155',
    },
    algorithm: theme.darkAlgorithm,
    components: {
        Layout: {
            headerBg: '#1e293b',
            siderBg: '#1e293b',
            bodyBg: '#1e293b',
            footerBg: '#1e293b',
        },
    },
}

// ==================== 毛玻璃风格 ====================
export const glassLightTheme: ThemeConfig = {
    token: {
        colorPrimary: '#6366f1',
        colorBgContainer: 'rgba(255, 255, 255, 0.7)',
        colorBgLayout: 'transparent',
        borderRadius: 16,
        fontSize: 14,
    },
    components: {
        Layout: {
            headerBg: 'transparent',
            siderBg: 'transparent',
            bodyBg: 'transparent',
            footerBg: 'transparent',
        },
    },
}

export const glassDarkTheme: ThemeConfig = {
    token: {
        colorPrimary: '#818cf8',
        colorBgContainer: 'rgba(30, 30, 46, 0.7)',
        colorBgLayout: 'transparent',
        borderRadius: 16,
        fontSize: 14,
    },
    algorithm: theme.darkAlgorithm,
    components: {
        Layout: {
            headerBg: 'transparent',
            siderBg: 'transparent',
            bodyBg: 'transparent',
            footerBg: 'transparent',
        },
    },
}

// ==================== 辅助函数 ====================
const themeMap = {
    chatgpt: { light: chatgptLightTheme, dark: chatgptDarkTheme },
    glass: { light: glassLightTheme, dark: glassDarkTheme },
} as const

export function getThemeConfig(uiStyle: UIStyle, isDark: boolean): ThemeConfig {
    return themeMap[uiStyle][isDark ? 'dark' : 'light']
}

export const lightTheme = chatgptLightTheme
export const darkTheme = chatgptDarkTheme
