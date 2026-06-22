/**
 * Global Vitest setup.
 *
 * Runs before every test file. Provides:
 *  1. A default `vi.mock('@tauri-apps/api/core', …)` so any module that
 *     transitively imports the Tauri runtime (e.g. `plugin-host`,
 *     `plugin-host-takeover`) gets a no-op `invoke` rather than a
 *     real WASM call. Individual tests can still override the mock
 *     with their own `vi.mock(...)` declaration – Vitest merges them.
 *  2. `@testing-library/jest-dom` matchers (`toBeInTheDocument`, etc.)
 *     for tests that render React components.
 *  3. A clean `localStorage` between test files so leftover state from
 *     one file doesn't leak into the next.
 *
 * Keep this file minimal – it should not pull in heavy dependencies.
 */
import { vi, afterEach, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// ─── Tauri runtime shim ────────────────────────────────────────────────────
// The host's modules import `invoke` from `@tauri-apps/api/core` at
// module load time. Without a mock, that import throws in jsdom. The
// shim below is intentionally permissive: it returns `undefined` for
// every command so plain code paths work, and tests that need to
// assert on a particular call site can override with their own
// `vi.mocked(invoke).mockResolvedValueOnce(...)` from inside the
// test file.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn().mockReturnValue('macos'),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 }),
  })),
}))

// ─── Per-file cleanup ──────────────────────────────────────────────────────
// The plugin permission guard stores grants in localStorage. Tests
// within a file may set/clear grants, but those grants should not
// leak into the next file. Wipe localStorage between files so each
// test file starts from an empty permission table.
beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.clear()
  }
})

afterEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.clear()
  }
  vi.clearAllMocks()
})
