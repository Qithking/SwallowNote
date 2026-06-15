/**
 * TC-WaveD-M13: PluginStorageInspector race-condition guard
 *
 * Covers the Wave D review finding: when the user closes the
 * storage inspector for plugin A and immediately opens it for
 * plugin B, the in-flight `getPluginStorageEntries(A)` call
 * must NOT overwrite the entries that B's response is about
 * to deliver. The fix introduces a `cancelled` flag captured
 * by the `useEffect`'s closure and flipped on the cleanup
 * path. The test below exercises that exact race by:
 *
 *   1. Mocking `getPluginStorageEntries` to return a deferred
 *      we control.
 *   2. Mounting the dialog with plugin A, capturing the
 *      deferred for A.
 *   3. Swapping the dialog to plugin B (re-renders → cleanup
 *      runs → `cancelled` flips to true for A's effect).
 *   4. Resolving A's deferred AFTER the swap; the dialog
 *      should NOT show A's row.
 *
 * The test deliberately avoids any time-based assertions
 * (no `setTimeout` waits, no `vi.useFakeTimers`) so it is
 * deterministic in jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import type { PluginDefinition } from '@/types/plugin'

// We mock the storage host module so we can control
// `getPluginStorageEntries`. The mock is hoisted by
// `vi.doMock`, so the component module has to be imported
// *after* `vi.doMock` runs. The dynamic import at the top
// of each test is intentional.
const deferreds: Array<{
  resolve: (value: Array<{ key: string; size: number }>) => void
}> = []
let pendingA: { resolve: (v: Array<{ key: string; size: number }>) => void } | null = null

vi.doMock('@/lib/plugin-host', () => ({
  getPluginStorageEntries: vi.fn().mockImplementation(
    (id: string) =>
      new Promise<Array<{ key: string; size: number }>>((resolve) => {
        const entry = { resolve }
        deferreds.push(entry)
        if (id === 'com.test.alpha') {
          pendingA = entry
        }
      }),
  ),
  deletePluginStorageEntry: vi.fn().mockResolvedValue(undefined),
  clearPluginStorage: vi.fn().mockResolvedValue(undefined),
  getPluginStorage: vi.fn().mockReturnValue({
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const makePlugin = (id: string, name: string): PluginDefinition =>
  ({
    id,
    name,
    description: '',
    version: '0.0.0',
    author: '',
    enabled: true,
    permissions: [],
  } as unknown as PluginDefinition)

describe('TC-WaveD-M13: PluginStorageInspector race-condition guard', () => {
  beforeEach(() => {
    deferreds.length = 0
    pendingA = null
  })
  afterEach(() => {
    cleanup()
    deferreds.length = 0
    pendingA = null
    vi.clearAllMocks()
  })

  it('a slow response from plugin A is dropped when plugin B replaces it', async () => {
    const { PluginStorageInspector } = await import('@/components/Plugin/PluginStorageInspector')

    const pluginA = makePlugin('com.test.alpha', 'Alpha')
    const pluginB = makePlugin('com.test.beta', 'Beta')

    function Harness() {
      const [plugin, setPlugin] = useState<PluginDefinition>(pluginA)
      return (
        <>
          <button data-testid="swap" onClick={() => setPlugin(pluginB)}>
            swap
          </button>
          <PluginStorageInspector open={true} plugin={plugin} onOpenChange={() => undefined} />
        </>
      )
    }

    render(<Harness />)

    // A's request is in-flight (deferred). Swap to B; this
    // triggers the previous effect's cleanup → `cancelled = true`
    // for A's IIFE.
    act(() => {
      fireEvent.click(screen.getByTestId('swap'))
    })

    // Two requests have been made (A then B). Resolve A's
    // response with a row that says "A:stale".
    expect(deferreds.length).toBeGreaterThanOrEqual(2)
    expect(pendingA).toBeTruthy()
    await act(async () => {
      pendingA!.resolve([{ key: 'A:stale', size: 10 }])
      // Yield a microtask so any (incorrect) setEntries call
      // has a chance to flush before the assertion.
      await Promise.resolve()
    })
    // The dialog must NOT show the A row — the cancelled
    // guard prevented the `setEntries([A:stale])` from
    // running. We assert by `queryByText`, which returns
    // null for absent nodes.
    expect(screen.queryByText('A:stale')).toBeNull()
  })

  it('a fast response from plugin A still populates the dialog when no swap occurs', async () => {
    const { PluginStorageInspector } = await import('@/components/Plugin/PluginStorageInspector')

    const pluginA = makePlugin('com.test.alpha', 'Alpha')

    function Harness() {
      return (
        <PluginStorageInspector open={true} plugin={pluginA} onOpenChange={() => undefined} />
      )
    }

    render(<Harness />)
    expect(deferreds.length).toBeGreaterThanOrEqual(1)
    const deferredA = deferreds[deferreds.length - 1]
    await act(async () => {
      deferredA.resolve([{ key: 'A:fresh', size: 10 }])
      await Promise.resolve()
    })
    // A's row IS shown when no swap happens. The `title`
    // attribute carries the long key (the visible cell
    // truncates), so we look for it there.
    expect(screen.queryByTitle('A:fresh')).toBeTruthy()
  })
})
