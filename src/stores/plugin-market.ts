/**
 * Plugin Marketplace store (Phase 9.2).
 *
 * Holds:
 * - The currently-selected repo URL (persisted to localStorage so
 *   the marketplace tab opens to the same repo the user last viewed).
 * - The latest fetched `PluginIndex` and the in-flight fetch state.
 * - A search query and tag-filter applied to the index.
 * - The most recent `check_plugin_updates` result, so the UI can
 *   show "Update" vs "Install" vs "Up to date" without re-fetching.
 *
 * The actual install/update/rollback work is done through
 * `src/lib/plugin-market.ts` and the Tauri host. The store just
 * coordinates; it never holds plugin bytes (those go through the
 * IndexedDB zip cache directly).
 */
import { create } from 'zustand'
import type { PluginIndex, PluginIndexEntry, PluginUpdateInfo } from '@/types/plugin'
import {
  fetchPluginIndexCached,
  fetchWithProgress,
  checkPluginUpdates,
  invalidateIndexCache,
  normaliseIndex,
} from '@/lib/plugin-market'
import { usePluginStore } from './plugin'

const REPO_URL_STORAGE_KEY = 'swallow-plugin-market:repo-url'
const DEFAULT_REPO_URL = ''

function loadRepoUrl(): string {
  try {
    return localStorage.getItem(REPO_URL_STORAGE_KEY) ?? DEFAULT_REPO_URL
  } catch {
    return DEFAULT_REPO_URL
  }
}

export interface PluginMarketState {
  /** Currently configured repo URL. */
  repoUrl: string
  /** Set the repo URL and persist it. */
  setRepoUrl: (url: string) => void

  /** Plugin ID to auto-open in the detail dialog on next mount/render.
   *  Set by `PluginManagerView.handleUpdatePlugin` and consumed by
   *  `PluginMarketView` which clears it after opening the dialog. */
  pendingDetailId: string | null
  /** Set the pending detail ID (and clear it after consumption). */
  setPendingDetailId: (id: string | null) => void

  /** The latest fetched index, or `null` before the first fetch. */
  index: PluginIndex | null
  /** `true` while a fetch is in flight. */
  isFetchingIndex: boolean
  /** Last error string from a fetch attempt. */
  fetchError: string | null
  /** Download progress percentage (0-100) for index fetch. */
  fetchProgress: number

  /** Refresh the index for the current repo URL.
   *  @param options.background - If true, refresh without setting loading state
   */
  refreshIndex: (options?: { background?: boolean }) => Promise<void>
  /** Refresh the index with progress tracking. */
  refreshIndexWithProgress: () => Promise<void>

  /** Search query (matches name/description/id/tags). */
  searchQuery: string
  setSearchQuery: (q: string) => void

  /** Active tag filter; empty array = all tags. */
  tagFilter: string[]
  setTagFilter: (tags: string[]) => void
  toggleTag: (tag: string) => void

  /** Update info returned by the last `check_plugin_updates` call. */
  updates: PluginUpdateInfo[]
  isCheckingUpdates: boolean
  /** Map of `pluginId → localVersion` for installed plugins, used to
   *  mark a card "Installed" vs "Update available". Sourced from the
   *  host's update info + the local plugin store.
   *  @param options.background - If true, refresh without setting loading state
   */
  refreshUpdates: (options?: { background?: boolean }) => Promise<void>

  /** All tag strings present in the current index. */
  allTags: () => string[]

  /** The visible entries after search + tag filter are applied. */
  filteredEntries: () => PluginIndexEntry[]

  /** Look up the local-version of an entry, if any. */
  localVersionFor: (id: string) => string | undefined
}

export const usePluginMarketStore = create<PluginMarketState>((set, get) => ({
  repoUrl: loadRepoUrl(),
  setRepoUrl: (url) => {
    try {
      localStorage.setItem(REPO_URL_STORAGE_KEY, url)
    } catch {
      /* private mode / quota — ignore */
    }
    // Changing the URL invalidates the cached index and update list.
    invalidateIndexCache(url)
    set({ repoUrl: url, index: null, updates: [] })
  },

  pendingDetailId: null,
  setPendingDetailId: (id) => set({ pendingDetailId: id }),

  index: null,
  isFetchingIndex: false,
  fetchError: null,
  fetchProgress: 0,
  refreshIndex: async (options?: { background?: boolean }) => {
    const url = get().repoUrl
    if (!url) {
      set({ index: null, fetchError: null })
      return
    }
    // If background refresh, don't clear isFetchingIndex to avoid UI flicker
    if (!options?.background) {
      set({ isFetchingIndex: true, fetchError: null, fetchProgress: 0 })
    }
    try {
      const index = await fetchPluginIndexCached(url)
      set({ index, isFetchingIndex: false, fetchError: null, fetchProgress: 100 })
    } catch (e: any) {
      set({
        isFetchingIndex: false,
        fetchError: e?.message ?? String(e),
        fetchProgress: 0,
      })
    }
  },
  refreshIndexWithProgress: async () => {
    const url = get().repoUrl
    if (!url) {
      set({ index: null, fetchError: null, fetchProgress: 0 })
      return
    }
    set({ isFetchingIndex: true, fetchError: null, fetchProgress: 0 })
    try {
      const text = await fetchWithProgress(url, (percent) => {
        set({ fetchProgress: percent })
      })
      const raw = JSON.parse(text)
      // Normalise the index using the shared normaliser so all fields
      // (schemaVersion, pubkeyB64, signatureB64, versions, etc.) are
      // present. The previous hand-rolled mapping missed critical
      // fields like pubkeyB64 (breaking signature verification) and
      // versions/dependencies (breaking the detail dialog).
      const index = normaliseIndex(raw)
      set({ index, isFetchingIndex: false, fetchError: null, fetchProgress: 100 })
    } catch (e: any) {
      set({
        isFetchingIndex: false,
        fetchError: e?.message ?? String(e),
        fetchProgress: 0,
      })
    }
  },

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),

  tagFilter: [],
  setTagFilter: (tags) => set({ tagFilter: tags }),
  toggleTag: (tag) => {
    const cur = get().tagFilter
    set({
      tagFilter: cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag],
    })
  },

  updates: [],
  isCheckingUpdates: false,
  refreshUpdates: async (options?: { background?: boolean }) => {
    const url = get().repoUrl
    if (!url) {
      set({ updates: [] })
      return
    }
    // If background refresh, don't set isCheckingUpdates to avoid UI flicker
    if (!options?.background) {
      set({ isCheckingUpdates: true })
    }
    try {
      const updates = await checkPluginUpdates(url)
      set({ updates, isCheckingUpdates: false })
    } catch {
      set({ updates: [], isCheckingUpdates: false })
    }
  },

  allTags: () => {
    const idx = get().index
    if (!idx) return []
    const set = new Set<string>()
    for (const p of idx.plugins) {
      for (const t of p.tags) set.add(t)
    }
    return Array.from(set).sort()
  },

  filteredEntries: () => {
    const { index, searchQuery, tagFilter } = get()
    if (!index) return []
    const q = searchQuery.trim().toLowerCase()
    return index.plugins.filter((p) => {
      if (tagFilter.length > 0 && !tagFilter.every((t) => p.tags.includes(t))) {
        return false
      }
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  },

  localVersionFor: (id) => {
    // Prefer the host's update info (it tracks the *active* semver,
    // not just any version on disk). Fall back to the local plugin
    // store so a plugin that's installed and up-to-date — and
    // therefore absent from the `updates` list — still resolves
    // correctly. Without the fallback the marketplace card flips
    // to "Install" for a plugin the user has already installed.
    const u = get().updates.find((x) => x.id === id)
    if (u?.localVersion) return u.localVersion
    return usePluginStore.getState().plugins.find((p) => p.id === id)?.version
  },
}))
