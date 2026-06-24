/**
 * Clone Store - Manages global git clone state
 *
 * The clone state is shared between the clone dialog (TitleBarRecentPopover)
 * and the status bar (StatusBar) so that closing the dialog does not lose
 * the ongoing clone progress.
 *
 * On module load the store queries the backend (`git_clone_status`) to check
 * whether a clone is already running — this handles the case where the user
 * refreshed the page while a clone was in progress.  The backend keeps the
 * pid/url/local_path in Tauri managed state which survives a webview reload.
 */
import { create } from 'zustand'
import { gitClone, gitCloneWithCredentials, gitCloneCancel, gitCloneStatus } from '@/lib/tauri'
import { listen } from '@tauri-apps/api/event'
import i18n from '@/i18n'
import { useUIStore } from './ui'
import { useWorkspaceStore } from './workspace'

export interface CloneState {
  /** Whether a clone is currently in progress */
  isCloning: boolean
  /** The repository URL being cloned */
  cloneUrl: string
  /** The local destination path being cloned to */
  cloneLocalPath: string
  /** Latest progress message text from git */
  cloneProgress: string
  /** Error message if the clone failed */
  cloneError: string
  /** Numeric percentage (0-100) when available, otherwise null */
  clonePercent: number | null
  /** Whether the clone has just completed (for brief "complete" display) */
  cloneCompleted: boolean

  /**
   * Start a git clone.  Resolves once the backend `git_clone` command
   * returns (success or failure).  On success the cloned folder is
   * opened automatically; on failure a toast is shown unless the clone
   * was cancelled by the user.
   *
   * Returns `true` on success, `false` on failure / cancellation.
   */
  startClone: (
    url: string,
    localPath: string,
    isPrivate: boolean,
    username: string,
    password: string,
  ) => Promise<boolean>

  /** Cancel the in-progress clone (kills the git process). */
  cancelClone: () => Promise<void>

  /** Reset all clone state back to idle. */
  resetCloneState: () => void

  // ---- internal helpers driven by the global event listener ----
  _setStarted: (url?: string, localPath?: string) => void
  _setProgress: (message: string, percent: number | null) => void
  _setComplete: () => void
  _setError: (message: string) => void
}

/** Module-level flag so the startClone catch-block can suppress the toast. */
let _cancelled = false

let _listenerInitialized = false
function initCloneProgressListener() {
  if (_listenerInitialized) return
  _listenerInitialized = true

  listen<{ status: string; message: string; percent?: number; url?: string; local_path?: string }>(
    'git-clone-progress',
    (event) => {
      const payload = event.payload
      const store = useCloneStore.getState()
      if (payload.status === 'started') {
        store._setStarted(payload.url, payload.local_path)
      } else if (payload.status === 'progress') {
        store._setProgress(payload.message, payload.percent ?? null)
      } else if (payload.status === 'completed') {
        store._setComplete()
      } else if (payload.status === 'error') {
        store._setError(payload.message)
      }
    },
  )
}

/**
 * Query the backend on startup to recover clone state after a page refresh.
 * If a clone is still running (pid is present), restore isCloning/url/path.
 */
async function initFromBackend() {
  try {
    const status = await gitCloneStatus()
    if (status.pid != null) {
      useCloneStore.setState({
        isCloning: true,
        cloneUrl: status.url,
        cloneLocalPath: status.local_path,
        cloneProgress: i18n.t('recent.cloning'),
        cloneError: '',
        clonePercent: null,
        cloneCompleted: false,
      })
    }
  } catch {
    // Backend command might not be registered yet; ignore.
  }
}

export const useCloneStore = create<CloneState>((set, get) => ({
  isCloning: false,
  cloneUrl: '',
  cloneLocalPath: '',
  cloneProgress: '',
  cloneError: '',
  clonePercent: null,
  cloneCompleted: false,

  startClone: async (url, localPath, isPrivate, username, password) => {
    _cancelled = false
    set({
      isCloning: true,
      cloneUrl: url,
      cloneLocalPath: localPath,
      cloneProgress: i18n.t('recent.cloning'),
      cloneError: '',
      clonePercent: null,
      cloneCompleted: false,
    })

    try {
      const clonedPath = isPrivate
        ? await gitCloneWithCredentials(url, localPath, username, password)
        : await gitClone(url, localPath)

      set({
        isCloning: false,
        cloneProgress: i18n.t('recent.cloneComplete'),
        clonePercent: null,
        cloneCompleted: true,
      })

      // Open the cloned folder
      const { workspaceMode } = useUIStore.getState()
      const { addWorkspaceFolder, openFolder } = useWorkspaceStore.getState()
      if (workspaceMode === 'workspace') {
        await addWorkspaceFolder(clonedPath)
      } else {
        await openFolder(clonedPath)
      }

      // Clear the "completed" flag after a short delay so the UI can
      // briefly show the success state.
      setTimeout(() => {
        get().resetCloneState()
      }, 3000)
      return true
    } catch (e) {
      const wasCancelled = _cancelled
      set({
        isCloning: false,
        clonePercent: null,
        cloneError: wasCancelled ? '' : (e instanceof Error ? e.message : String(e)),
      })
      if (!wasCancelled) {
        const { showToast } = useUIStore.getState()
        const message = e instanceof Error ? e.message : String(e)
        showToast(i18n.t('recent.cloneFailed', { error: message }), 'error')
      }
      return false
    }
  },

  cancelClone: async () => {
    _cancelled = true
    try {
      await gitCloneCancel()
    } catch {
      // ignore cancel errors
    }
    set({
      isCloning: false,
      clonePercent: null,
      cloneProgress: '',
      cloneError: '',
    })
  },

  resetCloneState: () => {
    set({
      cloneUrl: '',
      cloneLocalPath: '',
      cloneProgress: '',
      cloneError: '',
      clonePercent: null,
      cloneCompleted: false,
    })
  },

  _setStarted: (url, localPath) => {
    // If isCloning is already true the values are already set by
    // startClone().  If it's false we're recovering from a page
    // refresh — restore isCloning and the url/local_path from the
    // event payload (or from the backend status query).
    set((state) => {
      if (state.isCloning) {
        return { cloneProgress: i18n.t('recent.cloning'), cloneError: '', clonePercent: null }
      }
      return {
        isCloning: true,
        cloneUrl: url ?? state.cloneUrl,
        cloneLocalPath: localPath ?? state.cloneLocalPath,
        cloneProgress: i18n.t('recent.cloning'),
        cloneError: '',
        clonePercent: null,
        cloneCompleted: false,
      }
    })
  },

  _setProgress: (message, percent) => {
    // Recover isCloning if this is a progress event arriving after a
    // page refresh (the store was reset but the backend is still running).
    set({
      isCloning: true,
      cloneProgress: message,
      clonePercent: percent,
      cloneError: '',
    })
  },

  _setComplete: () => {
    set({ isCloning: false, cloneProgress: i18n.t('recent.cloneComplete'), clonePercent: null })
  },

  _setError: (message) => {
    set({ isCloning: false, cloneError: i18n.t('recent.cloneFailed', { error: message }), clonePercent: null })
  },
}))

// Initialise the global event listener and query the backend as soon as
// the module is imported.
initCloneProgressListener()
initFromBackend()
