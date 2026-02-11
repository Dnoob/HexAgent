// React 入口
import { useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import ErrorBoundary from './components/ErrorBoundary'
import { getThemeConfig } from './styles/theme'
import { UIStyleContext } from './hooks/useUIStyle'
import { useSettingsStore } from './store'
import './styles/global.css'
import './styles/ui-styles.css'
import App from './App'

function Root() {
    const themeMode = useSettingsStore((s) => s.config?.theme) || 'light'
    const uiStyle = useSettingsStore((s) => s.config?.uiStyle) || 'chatgpt'
    const isDark = themeMode === 'dark'

    const themeConfig = useMemo(() => getThemeConfig(uiStyle, isDark), [uiStyle, isDark])

    const uiStyleValue = useMemo(() => ({
        uiStyle,
        isChatGPT: uiStyle === 'chatgpt',
        isGlass: uiStyle === 'glass',
    }), [uiStyle])

    return (
        <div
            data-theme={isDark ? 'dark' : 'light'}
            data-ui-style={uiStyle}
            style={{ height: '100%' }}
        >
            <ConfigProvider theme={themeConfig} locale={zhCN}>
                <AntApp>
                    <UIStyleContext.Provider value={uiStyleValue}>
                        <ErrorBoundary>
                            <App />
                        </ErrorBoundary>
                    </UIStyleContext.Provider>
                </AntApp>
            </ConfigProvider>
        </div>
    )
}

const root = createRoot(document.getElementById('root')!)
root.render(<Root />)
