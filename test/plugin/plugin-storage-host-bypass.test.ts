/**
 * TC-WaveE-M1: Plugin storage host-only operations bypass
 * permission check.
 *
 * Covers the fix for the regression reported after
 * `PluginStorageInspector`'s i18n cleanup: opening the
 * storage inspector for a plugin that has NOT been granted
 * the `storage` permission (e.g. `com.swallownote.export`,
 * which only declares `backend`) used to throw
 * `PluginPermissionDeniedError: Plugin "…" is not allowed to
 * read storage`. The storage inspector is a *user-facing*
 * debugging tool, not a plugin code path — the user must be
 * able to inspect and clear storage for any plugin
 * regardless of its current `storage` grant (a revoked
 * plugin may still have stale data on disk from a previous
 * session).
 *
 * Fix: the host gets its own set of entry points
 * (`getPluginStorageEntries`, `deletePluginStorageEntry`,
 * `clearPluginStorage`) that route through `*Host()` methods
 * on the concrete `PluginStorageImpl` and skip the
 * `requireStoragePermission` guard. The SDK-facing methods
 * (`get`, `set`, `delete`, `clear`, `keys`, `entries`) keep
 * enforcing the guard, so plugin code still can't read or
 * write storage without the grant.
 *
 * The test exercises both directions: the SDK path throws
 * (no `storage` grant), the host path returns / no-ops.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { PluginPermissionDeniedError } from '@/lib/plugin-permission-guard'
import {
  getPluginStorage,
  getPluginStorageEntries,
  deletePluginStorageEntry,
  clearPluginStorage,
} from '@/lib/plugin-host'

// ─── File-IO mock (jsdom has no real disk) ────────────────────────────────

const STORAGE_FILE = '/mock/storage/com.test.export.json'
const SAMPLE_DATA = {
  recentFormat: 'docx',
  pageSize: 'A4',
}

// Each test gets a fresh in-memory buffer; the mock functions
// below read/write from this single object.
let backingFile: Record<string, unknown> | null = null

beforeEach(() => {
  backingFile = { ...SAMPLE_DATA }
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === 'get_plugin_storage_path') return STORAGE_FILE
    return undefined
  })
})

afterEach(() => {
  backingFile = null
  vi.mocked(invoke).mockReset()
})

// Mock `@/lib/tauri` so the storage impl sees a virtual disk.
// The mock returns/reads from `backingFile` so we can also
// assert that a `deleteHost`/`clearHost` mutates the buffer.
vi.mock('@/lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri')>()
  return {
    ...actual,
    getPluginStoragePath: vi.fn(async () => STORAGE_FILE),
    pathExists: vi.fn(async () => backingFile !== null),
    readFile: vi.fn(async () => JSON.stringify(backingFile ?? {})),
    writeFile: vi.fn(async (_p: string, content: string) => {
      backingFile = JSON.parse(content)
    }),
  }
})

// ─── Tests ────────────────────────────────────────────────────────────────

describe('TC-WaveE-M1: storage inspector bypasses storage permission', () => {
  it('the SDK `entries()` throws PluginPermissionDeniedError when storage is not granted', async () => {
    const store = getPluginStorage('com.test.export')
    // No `storage` permission grant. The SDK-facing method must
    // refuse to expose storage contents to plugin code.
    await expect(store.entries()).rejects.toBeInstanceOf(PluginPermissionDeniedError)
  })

  it('the SDK `set()` also throws without the storage grant (regression check)', async () => {
    const store = getPluginStorage('com.test.export')
    await expect(store.set('foo', 'bar')).rejects.toBeInstanceOf(PluginPermissionDeniedError)
  })

  it('getPluginStorageEntries (host) returns entries even without the storage grant', async () => {
    const entries = await getPluginStorageEntries('com.test.export')
    expect(entries.length).toBe(2)
    // Entries are `{ key, size }` — sizes are JSON-encoded length,
    // so just check keys are present.
    expect(entries.map((e) => e.key).sort()).toEqual(['pageSize', 'recentFormat'])
  })

  it('deletePluginStorageEntry (host) removes a key without the storage grant', async () => {
    // Sanity: entry exists before delete
    const before = await getPluginStorageEntries('com.test.export')
    expect(before.some((e) => e.key === 'recentFormat')).toBe(true)

    // No grant, but the host op succeeds.
    await deletePluginStorageEntry('com.test.export', 'recentFormat')

    const after = await getPluginStorageEntries('com.test.export')
    expect(after.some((e) => e.key === 'recentFormat')).toBe(false)
    expect(after.some((e) => e.key === 'pageSize')).toBe(true)
  })

  it('clearPluginStorage (host) empties the namespace without the storage grant', async () => {
    await clearPluginStorage('com.test.export')

    const after = await getPluginStorageEntries('com.test.export')
    expect(after).toEqual([])
  })

  it('granting the storage permission does NOT break the host-only path', async () => {
    // Sanity: after granting, the SDK method works AND the host
    // method still works (i.e. granting the permission doesn't
    // accidentally make the host ops go through the permission
    // check or change behaviour).
    const { setGranted, clearGranted } = await import('@/lib/plugin-permission-guard')
    setGranted('com.test.granted', ['storage'])

    // SDK works (with grant).
    const store = getPluginStorage('com.test.granted')
    await store.set('k', 'v')
    const sdkEntries = await store.entries()
    expect(sdkEntries.some((e) => e.key === 'k')).toBe(true)

    // Host still works (no permission check).
    const hostEntries = await getPluginStorageEntries('com.test.granted')
    expect(hostEntries.some((e) => e.key === 'k')).toBe(true)

    clearGranted('com.test.granted')
  })
})
