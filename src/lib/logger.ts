/**
 * 统一日志模块 — 前端 API 层
 *
 * Source: spec/unified-logging
 * 提供内存环形缓冲 (LogStore) + 5 级 logger API
 */

/** 标准 5 级日志枚举 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

/** 日志行结构 */
export interface LogEntry {
  timestamp: number // epoch ms
  level: LogLevel
  source: string // 模块名，如 'ui', 'editor', 'git', 'plugin:com.foo'
  message: string
  args?: unknown[]
}

/** 内存环形缓冲最大条数 */
export const MAX_LOG_ENTRIES = 5000

/**
 * LogStore — 内存环形缓冲 + 订阅机制
 *
 * 维护最近 MAX_LOG_ENTRIES 条日志，供 LogViewer 实时订阅展示。
 * 写入超过上限时自动丢弃最早的日志。
 */
class LogStoreImpl {
  private entries: LogEntry[] = []
  private listeners = new Set<(entry: LogEntry) => void>()

  /** 写入一条日志到环形缓冲尾部 */
  push(entry: LogEntry): void {
    this.entries.push(entry)
    if (this.entries.length > MAX_LOG_ENTRIES) {
      // 丢弃最早的超额日志
      this.entries.splice(0, this.entries.length - MAX_LOG_ENTRIES)
    }
    // 通知订阅者
    for (const listener of this.listeners) {
      listener(entry)
    }
  }

  /** 订阅新日志条目，返回取消订阅函数 */
  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 返回当前缓冲区内所有日志（按时间顺序，最早在前） */
  getAll(): LogEntry[] {
    return [...this.entries]
  }

  /** 清空缓冲区 */
  clear(): void {
    this.entries = []
  }

  /** 导出为 JSONL 格式（每行一条 JSON） */
  exportJsonl(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n')
  }
}

/** 全局单例 LogStore */
export const logStore = new LogStoreImpl()

/** 文件写入器类型：由外部注入（生产环境用 @tauri-apps/plugin-log） */
type FileWriter = (level: LogLevel, message: string) => void

let fileWriter: FileWriter | null = null

/**
 * 注入文件写入器（生产环境在 app 启动时调用）。
 * 传入 null 可禁用文件写入。
 */
export function setFileWriter(writer: FileWriter | null): void {
  fileWriter = writer
}

/**
 * 初始化生产环境日志：将 @tauri-apps/plugin-log 注入为 fileWriter，
 * 并监听后端 `log://log` 事件把后端日志（含 Rust log::*!）统一写入 LogStore。
 *
 * 去重：有 fileWriter 时 writeLog 不直接写 logStore，由本函数的监听器统一写入
 * （前端日志转发到后端后也会被 emit 回来，统一入口避免重复）。
 *
 * 在 App 启动时调用一次。失败时降级为仅内存 + console（writeLog 直接写 logStore）。
 */
export async function attachLogger(): Promise<void> {
  try {
    const pluginLog = await import('@tauri-apps/plugin-log')
    const levelMap: Record<LogLevel, (msg: string) => Promise<void>> = {
      trace: pluginLog.trace,
      debug: pluginLog.debug,
      info: pluginLog.info,
      warn: pluginLog.warn,
      error: pluginLog.error,
    }
    setFileWriter((level, message) => {
      // fire-and-forget；错误由 writeLog 的 try/catch 兜底
      void levelMap[level](message)
    })

    // 监听后端日志事件（Rust log::*! 经 Webview target emit 到前端）
    // payload level 是数字: 1=Trace 2=Debug 3=Info 4=Warn 5=Error
    const numToLevel: Record<number, LogLevel> = {
      1: 'trace', 2: 'debug', 3: 'info', 4: 'warn', 5: 'error',
    }
    await pluginLog.attachLogger(({ message, level }) => {
      const mappedLevel = numToLevel[level] ?? 'info'
      // 后端日志 message 可能带 [source] 前缀（如 "[git] push failed"）
      // 解析前缀作为 source，与前端 logger 的 source 格式统一
      const match = /^\[([^\]]+)\]\s*(.*)$/.exec(message)
      const source = match ? match[1] : 'backend'
      const msg = match ? match[2] : message
      logStore.push({
        timestamp: Date.now(),
        level: mappedLevel,
        source,
        message: msg,
      })
    })
  } catch (e) {
    // @tauri-apps/plugin-log 不可用（测试环境/非 Tauri 上下文）
    // eslint-disable-next-line no-console
    console.warn('[logger] @tauri-apps/plugin-log unavailable, file logging disabled', e)
  }
}

/** console 方法映射 */
const consoleMethods: Record<LogLevel, 'trace' | 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
}

/**
 * logger — 前端统一日志 API
 *
 * 每次调用同时：
 * 1. 写入 LogStore 内存环形缓冲
 * 2. 转发到浏览器 console（保留 dev 可见性）
 * 3. 后续经 @tauri-apps/plugin-log 写入文件（AC-1e）
 */
export const logger: {
  trace(source: string, message: string, ...args: unknown[]): void
  debug(source: string, message: string, ...args: unknown[]): void
  info(source: string, message: string, ...args: unknown[]): void
  warn(source: string, message: string, ...args: unknown[]): void
  error(source: string, message: string, ...args: unknown[]): void
} = {
  trace: (source, message, ...args) => writeLog('trace', source, message, args),
  debug: (source, message, ...args) => writeLog('debug', source, message, args),
  info: (source, message, ...args) => writeLog('info', source, message, args),
  warn: (source, message, ...args) => writeLog('warn', source, message, args),
  error: (source, message, ...args) => writeLog('error', source, message, args),
}

/** 内部：写入一条日志到 LogStore + console + 文件 */
function writeLog(level: LogLevel, source: string, message: string, args: unknown[]): void {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    source,
    message,
    ...(args.length > 0 ? { args } : {}),
  }
  const formatted = `[${source}] ${message}`
  // 转发到浏览器 console（保留 dev 可见性）
  // eslint-disable-next-line no-console
  console[consoleMethods[level]](formatted, ...args)
  // 转发到文件写入器（生产环境经 @tauri-apps/plugin-log 写入后端文件）
  if (fileWriter) {
    try {
      fileWriter(level, formatted)
      // 有 fileWriter 时不直接写 logStore —— 前端日志转发到后端后会经
      // log://log 事件 emit 回来，由 attachLogger 的监听器统一写入 logStore，避免重复
    } catch (e) {
      // fileWriter 抛错时降级为直接写 logStore + console
      logStore.push(entry)
      // eslint-disable-next-line no-console
      console.error('[logger] fileWriter failed', e)
    }
  } else {
    // 无 fileWriter（测试/降级）：直接写 logStore
    logStore.push(entry)
  }
}

/** 插件 logger 接口：自动带 plugin:<pluginId> source 前缀 */
export interface PluginLogger {
  trace(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/**
 * 为插件创建 logger 实例。
 * 所有日志自动带 `plugin:<pluginId>` source 前缀，写入统一日志通道。
 */
export function createPluginLogger(pluginId: string): PluginLogger {
  const source = `plugin:${pluginId}`
  return {
    trace: (msg, ...args) => writeLog('trace', source, msg, args),
    debug: (msg, ...args) => writeLog('debug', source, msg, args),
    info: (msg, ...args) => writeLog('info', source, msg, args),
    warn: (msg, ...args) => writeLog('warn', source, msg, args),
    error: (msg, ...args) => writeLog('error', source, msg, args),
  }
}
