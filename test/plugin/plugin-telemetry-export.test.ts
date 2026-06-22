/**
 * TC-08: Plugin telemetry exportLogs / jsonl round-trip tests
 *
 * Covers Task 8 (G8) acceptance criteria:
 *  1. `exportLogs` returns a `LogExportResult` whose `text` is
 *     valid JSON Lines (one JSON object per line, terminated by
 *     a trailing newline).
 *  2. Each emitted object carries the discriminator `kind` plus
 *     the source metric's fields.
 *  3. The `pluginId` argument, when supplied, restricts the
 *     output to records from that plugin.
 *  4. The output is sorted chronologically (oldest first) so the
 *     file reads top-to-bottom as a normal log.
 *  5. An empty buffer produces an empty string (no spurious
 *     lines, no header row).
 *  6. The function is pure: it does not touch the filesystem and
 *     does not mutate the in-memory metric buffers.
 *  7. Round-trip: every line of the export can be re-parsed as
 *     JSON and reconstructs the input record's key fields.
 *  8. Format-string contract: the third positional argument is
 *     currently a no-op alias for jsonl, but the function must
 *     accept it without error so a future `'csv'` branch can be
 *     added without breaking the call site.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  exportLogs,
  recordEventMetric,
  recordStorageMetric,
  recordHookMetric,
  recordBackendMetric,
  clearAllMetrics,
  clearPluginMetrics,
  type LogExportResult,
} from '@/lib/plugin-telemetry'

/**
 * Parse a jsonl payload back into an array of decoded records.
 * Helper kept local to the test file so the assertion reads as
 * "split on newlines, parse each line, assert equality". We
 * reject on the first malformed line because a valid export
 * must round-trip cleanly.
 */
function parseJsonl(text: string): Array<Record<string, unknown>> {
  if (text === '') return []
  const lines = text.split('\n')
  // Trailing newline produces a final empty entry which we drop
  // before parsing; the test for the trailing newline lives in
  // a separate assertion below.
  const out: Array<Record<string, unknown>> = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') continue
    out.push(JSON.parse(line) as Record<string, unknown>)
  }
  return out
}

describe('TC-08: exportLogs jsonl format', () => {
  beforeEach(() => {
    clearAllMetrics()
  })
  afterEach(() => {
    clearAllMetrics()
  })

  it('TC-08-01: returns an empty string when no metrics are recorded', () => {
    const result: LogExportResult = exportLogs()
    expect(result.text).toBe('')
    expect(result.recordCount).toBe(0)
    expect(result.format).toBe('jsonl')
  })

  it('TC-08-02: empty pluginId-scoped export is also empty when no records match', () => {
    recordHookMetric('com.test.alpha', 'onLoad', 1.2, true)
    const result = exportLogs('com.test.beta')
    expect(result.text).toBe('')
    expect(result.recordCount).toBe(0)
  })

  it('TC-08-03: a single event metric produces exactly one jsonl line plus a trailing newline', () => {
    recordEventMetric('com.test.alpha', 'note:open', { noteId: 'n1', path: '/a.md' }, 2, 3.5, 0)
    const result = exportLogs('com.test.alpha')
    // Trailing newline is the canonical POSIX "ends with EOL"
    // convention. `wc -l` counts newline-terminated lines, so
    // a single record should produce one line + a final \n.
    expect(result.text.endsWith('\n')).toBe(true)
    const lines = result.text.split('\n')
    // split('\n') on `"x\n"` yields `['x', '']` — the trailing
    // empty entry is the artifact of the final newline.
    expect(lines[lines.length - 1]).toBe('')
    const records = parseJsonl(result.text)
    expect(records).toHaveLength(1)
    const rec = records[0]
    expect(rec.kind).toBe('event')
    expect(rec.pluginId).toBe('com.test.alpha')
    expect(rec.event).toBe('note:open')
    expect(rec.handlerCount).toBe(2)
    expect(rec.totalDurationMs).toBe(3.5)
    expect(rec.errors).toBe(0)
    expect(typeof rec.timestamp).toBe('number')
    expect(typeof rec.time).toBe('string')
    // `level` is one of the four LogLevel strings; we don't
    // pin the exact value here, only that it's a string.
    expect(typeof rec.level).toBe('string')
    expect(result.recordCount).toBe(1)
  })

  it('TC-08-04: each emitted line is independently valid JSON', () => {
    // Mix a record of every kind so the test exercises all four
    // branches of the export's discriminator. We record the
    // records in interleaved order to verify the chronological
    // sort the export applies.
    recordEventMetric('com.test.a', 'note:open', { noteId: 'n1', path: '/a.md' }, 1, 1.0, 0)
    recordStorageMetric('com.test.b', 'set', 3, 128, 0.5, true)
    recordHookMetric('com.test.c', 'onLoad', 2.0, true)
    recordBackendMetric('com.test.d', 'scan_plugins', 4.0, true)
    const result = exportLogs()
    const records = parseJsonl(result.text)
    expect(records).toHaveLength(4)
    const kinds = records.map((r) => r.kind)
    expect(kinds).toEqual(['event', 'storage', 'hook', 'ipc'])
    // The storage line should round-trip the `success: true`
    // and the `error: null` placeholders, proving the export
    // serialises optional fields uniformly across kinds.
    const storage = records.find((r) => r.kind === 'storage')!
    expect(storage.operation).toBe('set')
    expect(storage.success).toBe(true)
    expect(storage.error).toBe(null)
  })

  it('TC-08-05: errors are surfaced as non-null `error` strings on hook / storage / ipc records', () => {
    recordHookMetric('com.test.err', 'onLoad', 1, false, 'boom')
    recordStorageMetric('com.test.err', 'get', 1, 0, 1, false, 'nope')
    recordBackendMetric('com.test.err', 'cmd', 1, false, 'kaboom')
    const result = exportLogs('com.test.err')
    const records = parseJsonl(result.text)
    expect(records).toHaveLength(3)
    for (const rec of records) {
      expect(rec.error).toBeTruthy()
    }
  })

  it('TC-08-06: pluginId filter restricts the output to one plugin only', () => {
    recordHookMetric('com.test.a', 'onLoad', 1, true)
    recordHookMetric('com.test.b', 'onLoad', 1, true)
    recordHookMetric('com.test.a', 'onUnload', 2, true)
    recordEventMetric('com.test.b', 'theme:change', { theme: 'dark' }, 1, 0.5, 0)
    const result = exportLogs('com.test.a')
    const records = parseJsonl(result.text)
    expect(records).toHaveLength(2)
    for (const rec of records) {
      expect(rec.pluginId).toBe('com.test.a')
    }
    expect(result.recordCount).toBe(2)
  })

  it('TC-08-07: output is sorted oldest-first (chronological order)', () => {
    // Record events with monotonically increasing timestamps.
    // `recordEventMetric` calls `Date.now()` internally, but
    // the values are recorded back-to-back in a single
    // microtask, so we can't rely on wall-clock order. We
    // verify the *export* ordering instead by recording the
    // events in a specific order and asserting the export
    // matches. (The sort key is `timestamp` ms, which is
    // strictly non-decreasing for back-to-back `Date.now()`
    // calls.)
    recordEventMetric('com.test.a', 'note:open', { noteId: '1', path: '/1.md' }, 0, 0, 0)
    recordEventMetric('com.test.a', 'note:change', { noteId: '1', path: '/1.md', content: 'x' }, 0, 0, 0)
    recordEventMetric('com.test.a', 'note:save', { noteId: '1', path: '/1.md' }, 0, 0, 0)
    const result = exportLogs('com.test.a')
    const records = parseJsonl(result.text)
    const events = records.map((r) => r.event as string)
    expect(events).toEqual(['note:open', 'note:change', 'note:save'])
    // And the timestamps are non-decreasing — that's the
    // definition of "oldest first".
    const ts = records.map((r) => r.timestamp as number)
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1])
    }
  })

  it('TC-08-08: export does not mutate the in-memory metric buffers', () => {
    recordEventMetric('com.test.a', 'app:ready', {}, 0, 0, 0)
    recordStorageMetric('com.test.b', 'get', 0, 0, 0.1, true)
    const result = exportLogs()
    expect(result.recordCount).toBe(2)
    // A second call must produce the same record count.
    // (The function being pure over its inputs is the property
    // we care about; the metric buffers' per-type length
    // isn't observable from outside, but the export's own
    // count is.)
    const result2 = exportLogs()
    expect(result2.recordCount).toBe(2)
    expect(result2.text).toBe(result.text)
  })

  it('TC-08-09: clearPluginMetrics drops the plugin from a subsequent export', () => {
    recordEventMetric('com.test.a', 'app:ready', {}, 0, 0, 0)
    recordEventMetric('com.test.b', 'app:ready', {}, 0, 0, 0)
    let result = exportLogs()
    expect(result.recordCount).toBe(2)
    clearPluginMetrics('com.test.a')
    result = exportLogs()
    expect(result.recordCount).toBe(1)
    const records = parseJsonl(result.text)
    expect(records[0].pluginId).toBe('com.test.b')
    // The pluginId-scoped export for the cleared plugin is now
    // empty.
    result = exportLogs('com.test.a')
    expect(result.recordCount).toBe(0)
  })

  it('TC-08-10: format argument is accepted and echoed back as "jsonl"', () => {
    // The function currently ignores the `format` value and
    // always emits jsonl. The contract is "accept any value of
    // the LogExportFormat union without error", so a future
    // branch that switches on it doesn't break the call site.
    const result = exportLogs(undefined, 'jsonl')
    expect(result.format).toBe('jsonl')
    // And the produced text must still be a valid jsonl.
    const records = parseJsonl(result.text)
    expect(Array.isArray(records)).toBe(true)
  })

  it('TC-08-11: round-trip — every line parses as JSON and the field set matches the metric type', () => {
    recordEventMetric('com.test.rt', 'note:open', { noteId: 'n1', path: '/a.md' }, 4, 7.5, 1)
    recordStorageMetric('com.test.rt', 'set', 2, 64, 0.8, true)
    recordHookMetric('com.test.rt', 'onLoad', 2.2, true)
    recordBackendMetric('com.test.rt', 'scan_plugins', 5.0, false, 'timeout')
    const result = exportLogs('com.test.rt')
    const records = parseJsonl(result.text)
    expect(records).toHaveLength(4)
    // Event record: event-specific keys present.
    const event = records.find((r) => r.kind === 'event')!
    expect(event).toMatchObject({
      kind: 'event',
      pluginId: 'com.test.rt',
      event: 'note:open',
      handlerCount: 4,
      totalDurationMs: 7.5,
      errors: 1,
    })
    // Storage record: operation + dataSize + keyCount.
    const storage = records.find((r) => r.kind === 'storage')!
    expect(storage).toMatchObject({
      kind: 'storage',
      pluginId: 'com.test.rt',
      operation: 'set',
      keyCount: 2,
      dataSize: 64,
      durationMs: 0.8,
      success: true,
    })
    // Hook record: hook + duration.
    const hook = records.find((r) => r.kind === 'hook')!
    expect(hook).toMatchObject({
      kind: 'hook',
      pluginId: 'com.test.rt',
      hook: 'onLoad',
      durationMs: 2.2,
      success: true,
    })
    // Backend record: command + success=false + error string.
    const ipc = records.find((r) => r.kind === 'ipc')!
    expect(ipc).toMatchObject({
      kind: 'ipc',
      pluginId: 'com.test.rt',
      command: 'scan_plugins',
      durationMs: 5.0,
      success: false,
      error: 'timeout',
    })
  })

  it('TC-08-12: the file ends with exactly one trailing newline (POSIX text file convention)', () => {
    recordHookMetric('com.test.x', 'onLoad', 1, true)
    const result = exportLogs('com.test.x')
    // Exactly one trailing newline: `endsWith('\n')` is true
    // and removing it leaves a non-empty string.
    expect(result.text.endsWith('\n')).toBe(true)
    expect(result.text.endsWith('\n\n')).toBe(false)
  })

  it('TC-08-13: { limit } caps the export to the most-recent N records for the scope', () => {
    // Record 5 hooks for alpha, then 3 hooks for beta. The
    // global, unfiltered export would see 8 records; the
    // alpha-scoped export sees 5.
    recordHookMetric('com.test.alpha', 'onLoad', 1, true)
    recordHookMetric('com.test.alpha', 'onLoad', 1, true)
    recordHookMetric('com.test.alpha', 'onLoad', 1, true)
    recordHookMetric('com.test.alpha', 'onLoad', 1, true)
    recordHookMetric('com.test.alpha', 'onLoad', 1, true)
    recordHookMetric('com.test.beta', 'onLoad', 1, true)
    recordHookMetric('com.test.beta', 'onLoad', 1, true)
    recordHookMetric('com.test.beta', 'onLoad', 1, true)
    // Cap alpha at 2 — the cap applies *after* the plugin
    // filter, so we get 2 alpha records (not 2 of the 8 global
    // records). Order is the default 'asc' (oldest first), so
    // we expect the *first* two recorded alphas.
    const result = exportLogs('com.test.alpha', 'jsonl', { limit: 2 })
    expect(result.recordCount).toBe(2)
    const records = parseJsonl(result.text)
    expect(records).toHaveLength(2)
    for (const rec of records) {
      expect(rec.pluginId).toBe('com.test.alpha')
    }
  })

  it('TC-08-14: { order: "desc" } reverses the chronological order (newest first)', () => {
    // `recordEventMetric` stamps `Date.now()` internally, so
    // three back-to-back calls in a single microtask would
    // produce identical millisecond timestamps and the sort
    // would be a no-op (stable sort, same order in / same
    // order out). We use fake timers + `vi.advanceTimersByTime`
    // to guarantee strictly increasing timestamps so the
    // `desc` order is observable.
    vi.useFakeTimers()
    const base = new Date('2026-06-14T12:00:00Z')
    vi.setSystemTime(base)
    recordEventMetric('com.test.a', 'note:open', { noteId: '1', path: '/1.md' }, 0, 0, 0)
    vi.advanceTimersByTime(1)
    recordEventMetric('com.test.a', 'note:change', { noteId: '1', path: '/1.md', content: 'x' }, 0, 0, 0)
    vi.advanceTimersByTime(1)
    recordEventMetric('com.test.a', 'note:save', { noteId: '1', path: '/1.md' }, 0, 0, 0)
    vi.useRealTimers()
    const result = exportLogs('com.test.a', 'jsonl', { order: 'desc' })
    const records = parseJsonl(result.text)
    const events = records.map((r) => r.event as string)
    expect(events).toEqual(['note:save', 'note:change', 'note:open'])
    // And the timestamps are non-increasing — the definition
    // of "newest first".
    const ts = records.map((r) => r.timestamp as number)
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeLessThanOrEqual(ts[i - 1])
    }
  })

  it('TC-08-15: limit + order compose — most recent N (newest first) for the scope', () => {
    // 5 alphas, then 3 betas. The Popup's Copy/Export use
    // `{ limit: 100, order: 'desc' }`, but here we shrink the
    // limit to 2 to make the assertion crisp. We expect the
    // *newest* two alphas — the last two recorded. Same
    // fake-timer trick as TC-08-14 to keep timestamps strictly
    // increasing across the 8 calls.
    vi.useFakeTimers()
    const base = new Date('2026-06-14T12:00:00Z')
    vi.setSystemTime(base)
    for (let i = 0; i < 5; i++) {
      recordHookMetric('com.test.alpha', `step-${i}`, 1, true)
      vi.advanceTimersByTime(1)
    }
    for (let i = 0; i < 3; i++) {
      recordHookMetric('com.test.beta', `step-${i}`, 1, true)
      vi.advanceTimersByTime(1)
    }
    vi.useRealTimers()
    const result = exportLogs('com.test.alpha', 'jsonl', {
      limit: 2,
      order: 'desc',
    })
    expect(result.recordCount).toBe(2)
    const records = parseJsonl(result.text)
    expect(records).toHaveLength(2)
    for (const rec of records) {
      expect(rec.pluginId).toBe('com.test.alpha')
    }
    // Newest-first: hook names descend from `step-4` to `step-3`.
    const hooks = records.map((r) => r.hook as string)
    expect(hooks).toEqual(['step-4', 'step-3'])
  })

  it('TC-08-16: a non-positive or NaN `limit` is treated as "no cap"', () => {
    recordHookMetric('com.test.c', 'onLoad', 1, true)
    recordHookMetric('com.test.c', 'onLoad', 1, true)
    recordHookMetric('com.test.c', 'onLoad', 1, true)
    // 0, -1, and NaN all mean "include everything".
    expect(exportLogs('com.test.c', 'jsonl', { limit: 0 }).recordCount).toBe(3)
    expect(exportLogs('com.test.c', 'jsonl', { limit: -1 }).recordCount).toBe(3)
    expect(exportLogs('com.test.c', 'jsonl', { limit: Number.NaN }).recordCount).toBe(3)
  })
})

// ─── Wave C / Minor 7: clearPluginMetrics bumps the version ───────────────
/**
 * `clearPluginMetrics(id)` is called from the plugin store's
 * uninstall path (`unregisterPlugin` / `setPlugins` diff) so
 * a freshly-uninstalled plugin's residual metrics don't linger
 * in the ring buffers. The companion `usePluginTelemetryVersion`
 * hook is consumed by `PluginManagerView`'s stats ribbon /
 * storage meter / errors counter, so the clear must notify
 * subscribers — otherwise the ribbon would keep showing the
 * uninstalled plugin's totals until the *next* recorder call
 * (which on a quiet host can be minutes or hours away).
 *
 * We assert the strictly-increasing invariant: the version
 * counter after `clearPluginMetrics` is greater than the value
 * before. This matches the contract documented on
 * `getMetricsVersion` and is sufficient to trigger a re-render
 * in any `useSyncExternalStore` consumer.
 */
describe('TC-WaveC-Minor7: clearPluginMetrics bumps the metrics version', () => {
  beforeEach(() => {
    clearAllMetrics()
  })
  afterEach(() => {
    clearAllMetrics()
  })

  it('bumps the version counter by exactly 1 after clearing one plugin', async () => {
    const {
      getMetricsVersion,
      recordEventMetric,
      clearPluginMetrics,
    } = await import('@/lib/plugin-telemetry')
    recordEventMetric('com.test.alpha', 'app:ready', {}, 1, 0, 0)
    recordEventMetric('com.test.beta', 'app:ready', {}, 1, 0, 0)
    const v0 = getMetricsVersion()
    clearPluginMetrics('com.test.alpha')
    const v1 = getMetricsVersion()
    expect(v1).toBe(v0 + 1)
  })

  it('notifies subscribers (useSyncExternalStore-style)', async () => {
    const {
      recordEventMetric,
      clearPluginMetrics,
      subscribeToMetricsVersion,
    } = await import('@/lib/plugin-telemetry')
    recordEventMetric('com.test.alpha', 'app:ready', {}, 1, 0, 0)
    const cb = (() => {
      let calls = 0
      const fn = () => { calls += 1 }
      Object.defineProperty(fn, 'calls', { get: () => calls })
      return fn as unknown as () => void & { calls: number }
    })()
    const unsubscribe = subscribeToMetricsVersion(cb)
    clearPluginMetrics('com.test.alpha')
    expect(cb.calls).toBe(1)
    unsubscribe()
  })
})
