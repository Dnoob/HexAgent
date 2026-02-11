// electron-vite 构建配置
// 类似 Qt 的 .pro 文件, 告诉构建工具怎么编译三个目标
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import path from "path"

export default defineConfig({
    // 主进程配置
    main: {
        build: {
            outDir: 'out/main'
        },
        resolve: {
            alias: {
                '@shared': path.resolve(__dirname, 'src/shared'),
            }
        }
    },
    // 预加载脚本配置
    preload: {
        build: {
            outDir: 'out/preload'
        },
        resolve: {
            alias: {
                '@shared': path.resolve(__dirname, 'src/shared'),
            }
        }
    },
    // 渲染进程配置
    renderer: {
        plugins: [react()],
        build: {
            outDir: 'out/renderer'
        },
        resolve: {
            alias: {
                '@shared': path.resolve(__dirname, 'src/shared'),
            }
        }
    }
})
