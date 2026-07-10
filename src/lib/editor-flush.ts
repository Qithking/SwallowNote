/** 编辑器内容刷新注册表 */

type FlushFn = () => Promise<void>

const flushFns = new Set<FlushFn>()

/** 注册刷新函数，返回取消订阅 */
export function registerFlushFn(fn: FlushFn): () => void {
  flushFns.add(fn)
  return () => {
    flushFns.delete(fn)
  }
}

/** 保存前刷新所有编辑器 */
export async function flushAllEditors(): Promise<void> {
  const fns = Array.from(flushFns)
  if (fns.length === 0) return
  await Promise.all(
    fns.map((fn) =>
      fn().catch((e) => {
        console.error('[editor-flush] Flush failed:', e)
      }),
    ),
  )
}
