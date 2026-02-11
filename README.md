# HexAgent

Windows 桌面 AI 助手客户端。通过对话界面与 AI 交互，支持本地文件操作、Python 代码执行，具备操作确认和步骤展示等完整交互体验。

## 功能特性

- **多模型支持** — Kimi、MiniMax，架构支持扩展更多 Provider
- **工具调用** — 文件读写、目录浏览、文件搜索、Python 代码执行、Shell 命令
- **操作确认** — 危险操作弹窗确认，保障安全
- **会话管理** — 多会话、搜索、导出（Markdown/JSON）
- **双主题** — 浅色 / 深色，两种界面风格（简约 / 极光）
- **思维链展示** — 支持 DeepSeek、MiniMax 等模型的推理过程展示

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 40 |
| 前端 | React 19 + TypeScript 5.9 |
| UI 组件库 | Ant Design 6 |
| 状态管理 | Zustand 5 |
| 构建工具 | electron-vite |
| 数据存储 | better-sqlite3 (SQLite) |

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 10

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/Dnoob/HexAgent.git
cd HexAgent

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 生产构建
pnpm build

# 打包安装程序
pnpm dist
```

## 项目结构

```
HexAgent/
├── src/
│   ├── main/           # 主进程（LLM 调用、工具执行、数据库）
│   ├── preload/        # 预加载脚本（IPC 桥梁）
│   ├── renderer/       # 渲染进程（React UI）
│   │   ├── components/ # UI 组件
│   │   ├── store/      # Zustand 状态管理
│   │   └── hooks/      # 自定义 Hooks
│   └── shared/         # 共享类型定义
├── package.json
└── electron.vite.config.ts
```

## 配置

首次启动后，在设置中配置 API Key 和模型即可使用。支持的 Provider：

- **Kimi** (Moonshot AI)
- **MiniMax**

## License

[MIT](LICENSE)
