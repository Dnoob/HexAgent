// src/renderer/hooks/useUIStyle.ts — UI 风格 Context
import { createContext, useContext } from 'react'
import type { UIStyle } from '../../shared/types'

interface UIStyleContextValue {
    uiStyle: UIStyle
    isChatGPT: boolean
    isGlass: boolean
}

export const UIStyleContext = createContext<UIStyleContextValue>({
    uiStyle: 'chatgpt',
    isChatGPT: true,
    isGlass: false,
})

export function useUIStyle(): UIStyleContextValue {
    return useContext(UIStyleContext)
}
