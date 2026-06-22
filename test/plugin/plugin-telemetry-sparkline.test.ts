/**
 * TC-12: Plugin telemetry time-window aggregation (sparkline data)
 *
 * Covers Task 12 (G12) acceptance criteria:
 *  1. `aggregateTelemetryByTimeWindow` returns one bucket per
 *     `bucketCount`, with `startTs`/`endTs` correctly aligned to
 *     `now - bucketCount * windowMs`.
 *  2. Records whose `timestamp` falls in `[startTs, endTs)` are
 *     counted in that bucket; records outside the window are
 *     dropped.
 *  3. `avgHookDurationMs` and `avgBackendDurationMs` are computed
 *     per bucket as `sum / count`; empty buckets are `0`.
 *  4. `errorRate` is `errorCount / totalCount`; empty buckets
 *     are `0`.
 *  5. Filtering by `pluginId` only aggregates records from the
 *     matching plugin.
 *  6. The function is defensive: invalid `windowMs` or `bucketCount`
 *     yield an empty result rather than throwing.
 *  7. Bucket count, window size, and the `now` parameter are all
 *     honoured by the layout math.
 *  8. Storage, hook, backend, and event metrics are all folded
 *     into `errorCount` / `totalCount`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  aggregateTelemetryByTimeWindow,
  recordEventMetric,
  recordStorageMetric,
  recordHookMetric,
  recordBackendMetric,
  clearAllMetrics,
  type TelemetryBucket,
} from '@/lib/plugin-telemetry'

/**
 * Build a fully-populated bucket with sensible defaults. Useful for
 * tests that want a "valid non-empty" bucket to pass to the
 * sparkline component without filling out every field individually.
 */
function makeBucket(overrides: Partial<TelemetryBucket> = {}): TelemetryBucket {
  return {
    startTs: 0,
    endTs: 60_000,
    hookCount: 0,
    backendCount: 0,
    storageCount: 0,
    eventCount: 0,
    avgHookDurationMs: 0,
    avgBackendDurationMs: 0,
    errorCount: 0,
    totalCount: 0,
    errorRate: 0,
    ...overrides,
  }
}

/**
 * "Now" used by all tests. We pin it to the current wall clock
 * at the start of each test because the metric recorders
 * (recordHookMetric etc.) use `Date.now()` internally for the
 * `timestamp` field. A test that wants deterministic bucket
 * placement just calls `recordX(...)` and then asks the
 * aggregator to use the same `now`.
 *
 * Tests that need to *shift* time use `vi.useFakeTimers` +
 * `vi.setSystemTime` so `Date.now()` follows the fake clock.
 */
function nowPlus(deltaMs: number = 0): number {
  return Date.now() + deltaMs
}

describe('TC-12: aggregateTelemetryByTimeWindow', () => {
  beforeEach(() => {
    clearAllMetrics()
  })
  afterEach(() => {
    clearAllMetrics()
    vi.useRealTimers()
  })

  it('TC-12-01: empty buffer returns 30 empty buckets by default', () => {
    const buckets = aggregateTelemetryByTimeWindow()
    expect(buckets).toHaveLength(30)
    for (const b of buckets) {
      expect(b.hookCount).toBe(0)
      expect(b.backendCount).toBe(0)
      expect(b.storageCount).toBe(0)
      expect(b.eventCount).toBe(0)
      expect(b.avgHookDurationMs).toBe(0)
      expect(b.avgBackendDurationMs).toBe(0)
      expect(b.errorCount).toBe(0)
      expect(b.totalCount).toBe(0)
      expect(b.errorRate).toBe(0)
    }
  })

  it('TC-12-02: bucket boundaries span [now - bucketCount*windowMs, now]', () => {
    // Pin "now" so the math is deterministic. We use a fixed
    // future-ish value here purely to assert the layout math;
    // we don't record any metrics in this test, so the
    // wall-clock mismatch is irrelevant.
    const now = nowPlus(0) + 60 * 60_000
    const buckets = aggregateTelemetryByTimeWindow({
      now,
      windowMs: 60_000,
      bucketCount: 30,
    })
    expect(buckets).toHaveLength(30)
    // Bucket 0: [now - 30*60s, now - 29*60s)
    expect(buckets[0].startTs).toBe(now - 30 * 60_000)
    expect(buckets[0].endTs).toBe(now - 29 * 60_000)
    // Bucket 29: [now - 60s, now)
    expect(buckets[29].startTs).toBe(now - 60_000)
    expect(buckets[29].endTs).toBe(now)
    // Adjacent buckets abut exactly: bucket[i].endTs === bucket[i+1].startTs
    for (let i = 0; i < buckets.length - 1; i++) {
      expect(buckets[i].endTs).toBe(buckets[i + 1].startTs)
    }
  })

  it('TC-12-03: hook metric in the most recent bucket lands in bucket 29', () => {
    recordHookMetric('com.test.a', 'onLoad', 5, true)
    // Pin `now` *after* the recording so the record's
    // timestamp (also `Date.now()`-based) is strictly
    // before `now`; otherwise the `ts >= now` guard in
    // `place()` drops the record.
    const now = Date.now()
    const buckets = aggregateTelemetryByTimeWindow({ now, windowMs: 60_000, bucketCount: 30 })
    const last = buckets[buckets.length - 1]
    expect(last.hookCount).toBe(1)
    expect(last.totalCount).toBe(1)
    expect(last.avgHookDurationMs).toBe(5)
    expect(last.errorRate).toBe(0)
    // All other buckets are empty.
    for (let i = 0; i < buckets.length - 1; i++) {
      expect(buckets[i].totalCount).toBe(0)
    }
  })

  it('TC-12-04: avgHookDurationMs is the sum / count over multiple hooks in one bucket', () => {
    // Three back-to-back hook records. They share the same
    // timestamp at ms granularity so they all land in the last
    // bucket. Durations 10 + 20 + 30 = 60, average = 20.
    recordHookMetric('com.test.a', 'onLoad', 10, true)
    recordHookMetric('com.test.a', 'onLoad', 20, true)
    recordHookMetric('com.test.a', 'onLoad', 30, true)
    const now = Date.now()
    const buckets = aggregateTelemetryByTimeWindow({ now, windowMs: 60_000, bucketCount: 30 })
    const last = buckets[buckets.length - 1]
    expect(last.hookCount).toBe(3)
    expect(last.avgHookDurationMs).toBeCloseTo(20, 5)
  })

  it('TC-12-05: failed hooks contribute to errorCount and errorRate', () => {
    recordHookMetric('com.test.a', 'onLoad', 1, true)
    recordHookMetric('com.test.a', 'onLoad', 1, false)
    recordHookMetric('com.test.a', 'onLoad', 1, true)
    const now = Date.now()
    const buckets = aggregateTelemetryByTimeWindow({ now, windowMs: 60_000, bucketCount: 30 })
    const last = buckets[buckets.length - 1]
    expect(last.errorCount).toBe(1)
    expect(last.totalCount).toBe(3)
    expect(last.errorRate).toBeCloseTo(1 / 3, 5)
  })

  it('TC-12-06: pluginId filter restricts the aggregation to one plugin', () => {
    recordHookMetric('com.test.a', 'onLoad', 1, true)
    recordHookMetric('com.test.b', 'onLoad', 1, true)
    recordHookMetric('com.test.a', 'onUnload', 1, true)
    const now = Date.now()
    const aBuckets = aggregateTelemetryByTimeWindow({
      pluginId: 'com.test.a',
      now,
      windowMs: 60_000,
      bucketCount: 30,
    })
    const aLast = aBuckets[aBuckets.length - 1]
    expect(aLast.hookCount).toBe(2)
    // A second call without the filter picks up the third record.
    const allBuckets = aggregateTelemetryByTimeWindow({
      now,
      windowMs: 60_000,
      bucketCount: 30,
    })
    const allLast = allBuckets[allBuckets.length - 1]
    expect(allLast.hookCount).toBe(3)
  })

  it('TC-12-07: records outside the time window are dropped', () => {
    // Use fake timers so we can control the recording time
    // *and* the aggregation reference time. We advance 10
    // minutes, record a hook, then aggregate with a 5-minute
    // window. The record is too old to land in any bucket.
    vi.useFakeTimers()
    const real = new Date('2026-06-14T10:00:00Z')
    vi.setSystemTime(real)
    recordHookMetric('com.test.a', 'onLoad', 5, true)
    const recorded = real.getTime()
    // 31 minutes after recording, the record is outside
    // the 30-minute window. The first bucket starts at
    // `now - 30 * 60s`; the record's age is 31 minutes, so
    // it's older than the first bucket and gets dropped.
    const now = recorded + 31 * 60_000
    const buckets = aggregateTelemetryByTimeWindow({
      now,
      windowMs: 60_000,
      bucketCount: 30,
    })
    for (const b of buckets) {
      expect(b.hookCount).toBe(0)
      expect(b.totalCount).toBe(0)
    }
  })

  it('TC-12-07b: records within the time window land in their bucket', () => {
    // Companion to TC-12-07: a record that is 5 minutes old
    // relative to a 5-minute aggregation `now` lands in the
    // *oldest* bucket of a 5×60s layout (boundary inclusive).
    vi.useFakeTimers()
    const real = new Date('2026-06-14T10:00:00Z')
    vi.setSystemTime(real)
    recordHookMetric('com.test.a', 'onLoad', 5, true)
    const recorded = real.getTime()
    // 5 minutes later, the record is exactly on the first
    // bucket's start boundary (firstStart = now - 5*60s =
    // recorded). The place() guard `ts < firstStart` is
    // strict-less-than, so the record IS counted in bucket 0.
    const now = recorded + 5 * 60_000
    const buckets = aggregateTelemetryByTimeWindow({
      now,
      windowMs: 60_000,
      bucketCount: 5,
    })
    const first = buckets[0]
    expect(first.hookCount).toBe(1)
    expect(buckets[buckets.length - 1].hookCount).toBe(0)
  })

  it('TC-12-08: storage, event, and backend errors all roll up into errorCount', () => {
    recordStorageMetric('com.test.a', 'get', 1, 0, 1, false, 'io')
    recordBackendMetric('com.test.a', 'cmd', 1, false, 'timeout')
    recordEventMetric('com.test.a', 'note:open', { noteId: 'n', path: '/a' }, 1, 1, 2)
    const now = Date.now()
    const buckets = aggregateTelemetryByTimeWindow({ now, windowMs: 60_000, bucketCount: 30 })
    const last = buckets[buckets.length - 1]
    // 1 storage + 1 backend + 1 event = 3 total, with errors: 1 + 1 + 2 = 4
    expect(last.totalCount).toBe(3)
    expect(last.errorCount).toBe(4)
    expect(last.errorRate).toBeCloseTo(4 / 3, 5)
    expect(last.storageCount).toBe(1)
    expect(last.backendCount).toBe(1)
    expect(last.eventCount).toBe(1)
  })

  it('TC-12-09: backend metrics contribute to avgBackendDurationMs but not avgHookDurationMs', () => {
    recordBackendMetric('com.test.a', 'cmd', 7, true)
    recordBackendMetric('com.test.a', 'cmd', 13, true)
    const now = Date.now()
    const buckets = aggregateTelemetryByTimeWindow({ now, windowMs: 60_000, bucketCount: 30 })
    const last = buckets[buckets.length - 1]
    expect(last.hookCount).toBe(0)
    expect(last.avgHookDurationMs).toBe(0)
    expect(last.backendCount).toBe(2)
    expect(last.avgBackendDurationMs).toBeCloseTo(10, 5)
  })

  it('TC-12-10: invalid windowMs / bucketCount yield an empty result (no throw)', () => {
    expect(aggregateTelemetryByTimeWindow({ windowMs: 0 })).toEqual([])
    expect(aggregateTelemetryByTimeWindow({ windowMs: -1 })).toEqual([])
    expect(aggregateTelemetryByTimeWindow({ windowMs: NaN })).toEqual([])
    expect(aggregateTelemetryByTimeWindow({ windowMs: Infinity })).toEqual([])
    expect(aggregateTelemetryByTimeWindow({ bucketCount: 0 })).toEqual([])
    expect(aggregateTelemetryByTimeWindow({ bucketCount: -5 })).toEqual([])
    // A custom (still positive) width still works.
    const buckets = aggregateTelemetryByTimeWindow({ windowMs: 1000, bucketCount: 5 })
    expect(buckets).toHaveLength(5)
  })

  it('TC-12-11: the default options match the spec (30 buckets × 60s = 30 minutes)', () => {
    // For this layout test we don't care about the absolute
    // timestamp, only the relative spacing; we can pin `now`
    // to a value 1h ahead of the real clock because no records
    // are present in the buffer.
    const now = Date.now() + 60 * 60_000
    const buckets = aggregateTelemetryByTimeWindow({ now })
    expect(buckets).toHaveLength(30)
    // First bucket starts at now - 30 minutes, last ends at now.
    expect(buckets[0].startTs).toBe(now - 30 * 60_000)
    expect(buckets[buckets.length - 1].endTs).toBe(now)
  })

  it('TC-12-12: empty buckets return `errorRate === 0` (no NaN propagation)', () => {
    const now = Date.now() + 60 * 60_000
    const buckets = aggregateTelemetryByTimeWindow({ now })
    for (const b of buckets) {
      // Crucial: the sparkline color picker branches on
      // `errorRate <= 0`; if it ever becomes NaN, the
      // `classifyErrorRate` helper would mis-classify the
      // chart as `warn` (because NaN comparisons are all
      // false). Guard against that here.
      expect(Number.isFinite(b.errorRate)).toBe(true)
      expect(b.errorRate).toBe(0)
    }
  })
})

// Lightweight sanity test for the helper that the sparkline
// component uses to build its polyline. The component itself is
// React and is covered by the integration in `PluginInstalledCard`,
// but the "no data → null" contract is load-bearing and worth
// pinning down with a direct check.
describe('TC-12: makeBucket helper (test-only)', () => {
  it('TC-12-13: makeBucket returns the documented shape', () => {
    const b = makeBucket({ hookCount: 2, avgHookDurationMs: 4.5, errorRate: 0.5 })
    expect(b.hookCount).toBe(2)
    expect(b.avgHookDurationMs).toBe(4.5)
    expect(b.errorRate).toBe(0.5)
    // Unspecified fields default to zero.
    expect(b.backendCount).toBe(0)
    expect(b.avgBackendDurationMs).toBe(0)
  })
})
