/**
 * Editor content flush registry.
 *
 * When MarkdownEditor debounces its handleChange (blocksToMarkdownLossy),
 * the store content may lag behind the editor's internal state by up to
 * 300ms. Before any save operation, call `flushAllEditors()` to ensure
 * the latest content is written to the store.
 */

type FlushFn = () => Promise<void>

const flushFns = new Set<FlushFn>()

/** Register a flush function. Returns an unsubscribe callback. */
export function registerFlushFn(fn: FlushFn): () => void {
  flushFns.add(fn)
  return () => {
    flushFns.delete(fn)
  }
}

/** Flush all registered editors. Call before save operations. */
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
