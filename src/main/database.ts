// src/main/database.ts — 数据库模块（SQLite + 迁移系统）
import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import { logger } from './logger'

// --- 1. 打开数据库 ---
const dbPath = path.join(app.getPath('userData'), 'hexagent.db')
const db = new Database(dbPath)

// 最佳实践：WAL 模式 + 外键约束
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// --- 2. 迁移系统（基于 PRAGMA user_version） ---
interface Migration {
    version: number
    description: string
    up: () => void
}

const migrations: Migration[] = [
    {
        version: 1,
        description: '初始 schema + 扩展字段',
        up: () => {
            // 检查表是否已存在（兼容旧数据库）
            const hasConversations = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
            ).get()

            if (!hasConversations) {
                db.exec(`
                    CREATE TABLE conversations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL DEFAULT '新对话',
                        model TEXT,
                        provider TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
                    );
                    CREATE TABLE messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conversation_id INTEGER NOT NULL,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        tool_name TEXT,
                        tool_args TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                    );
                    CREATE INDEX idx_messages_conversation ON messages(conversation_id);
                `)
            } else {
                // 旧表存在，添加缺失的列
                const cols = db.prepare("PRAGMA table_info('conversations')").all() as any[]
                const colNames = cols.map((c: any) => c.name)

                if (!colNames.includes('updated_at')) {
                    // ALTER TABLE ADD COLUMN 不支持非常量默认值，用空字符串再批量填充
                    db.exec("ALTER TABLE conversations ADD COLUMN updated_at TEXT DEFAULT ''")
                    db.exec("UPDATE conversations SET updated_at = created_at WHERE updated_at = ''")
                }
                if (!colNames.includes('model')) {
                    db.exec("ALTER TABLE conversations ADD COLUMN model TEXT")
                }
                if (!colNames.includes('provider')) {
                    db.exec("ALTER TABLE conversations ADD COLUMN provider TEXT")
                }

                const msgCols = db.prepare("PRAGMA table_info('messages')").all() as any[]
                const msgColNames = msgCols.map((c: any) => c.name)

                if (!msgColNames.includes('tool_name')) {
                    db.exec("ALTER TABLE messages ADD COLUMN tool_name TEXT")
                }
                if (!msgColNames.includes('tool_args')) {
                    db.exec("ALTER TABLE messages ADD COLUMN tool_args TEXT")
                }
            }
        },
    },
    {
        version: 2,
        description: '添加 tool_result 列',
        up: () => {
            const cols = db.prepare("PRAGMA table_info('messages')").all() as any[]
            const colNames = cols.map((c: any) => c.name)
            if (!colNames.includes('tool_result')) {
                db.exec("ALTER TABLE messages ADD COLUMN tool_result TEXT")
            }
        },
    },
]

function runMigrations(): void {
    const currentVersion = (db.pragma('user_version', { simple: true }) as number) || 0
    for (const m of migrations) {
        if (m.version > currentVersion) {
            logger.info('database', `Running migration v${m.version}: ${m.description}`)
            db.transaction(() => {
                m.up()
                db.pragma(`user_version = ${m.version}`)
            })()
        }
    }
}

runMigrations()

// --- 3. 预编译 SQL 语句 ---
const stmts = {
    createConversation: db.prepare(
        'INSERT INTO conversations (title) VALUES (?)'
    ),
    getConversations: db.prepare(
        'SELECT * FROM conversations ORDER BY updated_at DESC, created_at DESC'
    ),
    getMessages: db.prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ),
    addMessage: db.prepare(
        'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)'
    ),
    addToolMessage: db.prepare(
        'INSERT INTO messages (conversation_id, role, content, tool_name, tool_args, tool_result) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    updateConversation: db.prepare(
        'UPDATE conversations SET title = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
    ),
    deleteConversation: db.prepare(
        'DELETE FROM conversations WHERE id = ?'
    ),
    touchConversation: db.prepare(
        'UPDATE conversations SET updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
    ),
    searchMessages: db.prepare(
        "SELECT m.*, c.title as conversation_title FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE m.content LIKE ? ORDER BY m.created_at DESC LIMIT 50"
    ),
    clearMessages: db.prepare(
        'DELETE FROM messages WHERE conversation_id = ?'
    ),
    deleteMessagesAfter: db.prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND id > ?'
    ),
    getConversation: db.prepare(
        'SELECT * FROM conversations WHERE id = ?'
    ),
}

// --- 4. 导出操作函数 ---

/** 创建新会话, 返回新会话的 id */
export function createConversation(title = '新对话'): number {
    const result = stmts.createConversation.run(title)
    return result.lastInsertRowid as number
}

/** 获取所有会话列表 */
export function getConversations() {
    return stmts.getConversations.all()
}

/** 获取某个会话的所有消息 */
export function getMessages(conversationId: number) {
    return stmts.getMessages.all(conversationId)
}

/** 往某个会话里添加一条消息 */
export function addMessage(conversationId: number, role: string, content: string) {
    stmts.addMessage.run(conversationId, role, content)
    // 更新会话的 updated_at
    stmts.touchConversation.run(conversationId)
}

/** 添加工具消息（包含 tool 元数据） */
export function addToolMessage(conversationId: number, content: string, toolName: string, toolArgs: string, toolResult: string) {
    stmts.addToolMessage.run(conversationId, 'tool', content, toolName, toolArgs, toolResult)
    stmts.touchConversation.run(conversationId)
}

/** 更新会话标题 */
export function updateConversation(id: number, title: string) {
    stmts.updateConversation.run(title, id)
}

/** 删除会话（CASCADE 删除关联消息） */
export function deleteConversation(id: number) {
    stmts.deleteConversation.run(id)
}

/** 搜索消息内容 */
export function searchMessages(query: string) {
    return stmts.searchMessages.all(`%${query}%`)
}

/** 清空某个会话的所有消息（保留会话本身） */
export function clearMessages(conversationId: number) {
    stmts.clearMessages.run(conversationId)
}

/** 删除某个会话中 指定消息ID 之后的所有消息 */
export function deleteMessagesAfter(conversationId: number, afterMessageId: number) {
    stmts.deleteMessagesAfter.run(conversationId, afterMessageId)
}

/** 获取单个会话信息 */
export function getConversation(id: number) {
    return stmts.getConversation.get(id)
}
