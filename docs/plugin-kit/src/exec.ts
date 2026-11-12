import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface RunResult {
  status: number
  stdout: string
  stderr: string
}

/**
 * 运行外部命令。stdio: 'inherit' 时透传输出并把非零退出码转为进程退出
 * （vite / cargo 构建失败必须原样暴露）；stdio: 'pipe' 时捕获输出供调用方处理。
 */
export function runCmd(
  cmd: string,
  args: string[],
  opts: { cwd?: string; stdio?: 'inherit' | 'pipe' } = {}
): RunResult {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: opts.stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf-8',
  })
  if (res.error) {
    // 命令本身无法启动（不存在等）按 127 语义处理
    const stderr = res.error instanceof Error ? res.error.message : String(res.error)
    process.stderr.write(`✗ 无法执行 ${cmd}: ${stderr}\n`)
    return { status: 127, stdout: '', stderr }
  }
  return {
    status: res.status ?? 1,
    stdout: typeof res.stdout === 'string' ? res.stdout : '',
    stderr: typeof res.stderr === 'string' ? res.stderr : '',
  }
}

/** 优先使用工程本地 node_modules/.bin 下的可执行文件，避免全局解析歧义 */
export function resolveLocalBin(pluginDir: string, bin: string): string | null {
  const p = join(pluginDir, 'node_modules', '.bin', bin)
  return existsSync(p) ? p : null
}
