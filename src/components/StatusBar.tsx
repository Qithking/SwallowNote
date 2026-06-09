/**
 * StatusBar Component - Bottom status bar
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { Link, User, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { useUIStore, useGitStore } from '@/stores'
import { checkLatestVersion, downloadLatestRelease, openInstaller, installAndRestart, DownloadProgress } from '@/lib/tauri'
import { open } from '@tauri-apps/plugin-shell'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import packageJson from '../../package.json'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'

type VersionStatus = 'idle' | 'checking' | 'has-update' | 'up-to-date' | 'check-failed' | 'downloading' | 'download-ready' | 'download-failed'

const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000 // 1 hour in ms

function StatusBar() {
  const showToast = useUIStore((s) => s.showToast)
  const autoCheckUpdate = useUIStore((s) => s.autoCheckUpdate)
  const syncStatus = useGitStore((s) => s.syncStatus)
  const { t } = useTranslation()
  const [currentVersion] = useState(packageJson.version)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [versionStatus, setVersionStatus] = useState<VersionStatus>('idle')
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null)
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false)
  const cancelDownloadRef = useRef<(() => void) | null>(null)
  // Track last emitted progress to skip redundant setState calls
  const lastProgressRef = useRef<number>(-1)
  // Ref to track if a check is already in progress (prevents concurrent checks)
  const isCheckingRef = useRef(false)
  // Mirror versionStatus into a ref so callbacks always read the latest value
  // without needing it as a dependency (avoids stale-closure bugs)
  const versionStatusRef = useRef<VersionStatus>(versionStatus)
  // Keep the ref in sync with the state
  versionStatusRef.current = versionStatus

  useEffect(() => {
    checkDownloadedInstaller()
    return () => {
      cancelDownloadRef.current?.()
    }
  }, [])

  // Auto-check on first launch + periodic silent check every hour
  useEffect(() => {
    if (!autoCheckUpdate) return

    // Initial check after a short delay (so the app UI is ready first)
    const initialTimer = setTimeout(() => {
      silentCheckForUpdate()
    }, 3000)

    // Set up hourly interval
    const intervalId = setInterval(() => {
      silentCheckForUpdate()
    }, UPDATE_CHECK_INTERVAL)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(intervalId)
    }
  }, [autoCheckUpdate])

  /**
   * Silent version check: only updates the status bar when a new version is found.
   * If no update or check fails, does not change the current versionStatus at all
   * (so it won't disrupt any ongoing download or other state).
   */
  const silentCheckForUpdate = useCallback(async () => {
    // Prevent concurrent checks
    if (isCheckingRef.current) return
    isCheckingRef.current = true

    try {
      const result = await checkLatestVersion()
      if (result?.hasUpdate) {
        setLatestVersion(result.latest)
        // Only transition to has-update if we're in a state that makes sense
        setVersionStatus(prev => {
          // Don't interrupt downloading or download-ready states
          if (prev === 'downloading' || prev === 'download-ready') return prev
          versionStatusRef.current = 'has-update'
          return 'has-update'
        })
      }
      // If no update, or check failed: do nothing (silent)
    } catch {
      // Silent: ignore errors
    } finally {
      isCheckingRef.current = false
    }
  }, [])

  const checkDownloadedInstaller = async () => {
    try {
      const platform_ext = await invoke<string>('get_platform_extension')
      const packageName = `SwallowNote_${currentVersion}${platform_ext}`
      const downloadDir = await invoke<string>('get_download_dir')
      const filePath = `${downloadDir}/${packageName}`
      const exists = await invoke<boolean>('path_exists', { path: filePath })
      if (exists) {
        setDownloadedPath(filePath)
        setLatestVersion(currentVersion)
        setVersionStatus('download-ready')
        versionStatusRef.current = 'download-ready'
      }
    } catch {
    }
  }

  const handleVersionClick = useCallback(async () => {
    const status = versionStatusRef.current

    if (status === 'downloading') {
      return
    }

    if (status === 'idle' || status === 'check-failed' || status === 'up-to-date') {
      setVersionStatus('checking')
      versionStatusRef.current = 'checking'
      try {
        const result = await checkLatestVersion()
        if (result) {
          setLatestVersion(result.latest)
          if (result.hasUpdate) {
            setVersionStatus('has-update')
            versionStatusRef.current = 'has-update'
          } else {
            setVersionStatus('up-to-date')
            versionStatusRef.current = 'up-to-date'
          }
        } else {
          setVersionStatus('check-failed')
          versionStatusRef.current = 'check-failed'
        }
      } catch {
        setVersionStatus('check-failed')
        versionStatusRef.current = 'check-failed'
      }
      return
    }

    if (status === 'has-update' || status === 'download-failed') {
      // Cancel any previous download listeners first
      cancelDownloadRef.current?.()
      cancelDownloadRef.current = null

      setVersionStatus('downloading')
      versionStatusRef.current = 'downloading'
      setDownloadProgress(0)
      lastProgressRef.current = -1

      const cancel = downloadLatestRelease(
        (progress: DownloadProgress) => {
          // Only accept progress if we are still in downloading state
          if (versionStatusRef.current !== 'downloading') return
          const rounded = Math.round(progress.progress)
          // Skip setState if the integer progress hasn't changed
          if (rounded !== lastProgressRef.current) {
            lastProgressRef.current = rounded
            setDownloadProgress(rounded)
          }
        },
        (path: string) => {
          if (versionStatusRef.current !== 'downloading') return
          setDownloadedPath(path)
          setVersionStatus('download-ready')
          versionStatusRef.current = 'download-ready'
          setShowUpgradeDialog(true)
          cancelDownloadRef.current = null
        },
        (error: string) => {
          if (versionStatusRef.current !== 'downloading') return
          setVersionStatus('download-failed')
          versionStatusRef.current = 'download-failed'
          showToast(t('statusBar.downloadFailed', { error }))
          cancelDownloadRef.current = null
        }
      )
      cancelDownloadRef.current = cancel
    }

    if (status === 'download-ready') {
      setShowUpgradeDialog(true)
    }
  }, [showToast])

  const handleUpgradeConfirm = useCallback(async () => {
    setShowUpgradeDialog(false)
    if (downloadedPath) {
      try {
        // Save session state before installing update
        window.dispatchEvent(new CustomEvent('save-session-now'))
        // On macOS, use install_and_restart for seamless in-place upgrade
        // On other platforms, fall back to open_installer
        const isMac = navigator.platform.toLowerCase().includes('mac')
        if (isMac && downloadedPath.endsWith('.dmg')) {
          setVersionStatus('idle') // Will exit soon anyway
          await installAndRestart(downloadedPath)
        } else {
          await openInstaller(downloadedPath)
        }
      } catch (e) {
        const errorMsg = String(e)
        // If install_and_restart failed, fall back to open_installer
        if (downloadedPath.endsWith('.dmg')) {
          try {
            await openInstaller(downloadedPath)
            return
          } catch {
            // Both methods failed
          }
        }
        showToast(t('statusBar.installFailed', { error: errorMsg }))
      }
    }
  }, [downloadedPath, showToast])

  const handleUpgradeCancel = useCallback(() => {
    setShowUpgradeDialog(false)
    setVersionStatus('download-ready')
    versionStatusRef.current = 'download-ready'
  }, [])

  const handleRepoLinkClick = async () => {
    try {
      await open('https://github.com/Qithking/SwallowNote')
    } catch {
      showToast(t('statusBar.openLinkFailed'))
    }
  }

  const renderVersionDisplay = () => {
    const baseVersion = `v${currentVersion}`
    switch (versionStatus) {
      case 'idle':
      case 'check-failed':
        return <span className="opacity-60 hover:opacity-100 cursor-pointer">{baseVersion}</span>
      case 'up-to-date':
        return <span className="opacity-60 hover:opacity-100 cursor-pointer">{baseVersion} ({t('statusBar.upToDate')})</span>
      case 'checking':
        return <span className="opacity-60 animate-pulse">{baseVersion} ({t('statusBar.checking')})</span>
      case 'has-update':
        return (
          <span className="flex items-center gap-1">
            <span className="opacity-60">{baseVersion}</span>
            <span className="text-green-500">({latestVersion})</span>
            <Button
              size="sm"
              variant="default"
              className="h-5 text-[10px] px-2 py-0"
              onClick={handleVersionClick}
            >
              {t('statusBar.download')}
            </Button>
          </span>
        )
      case 'downloading':
        return (
          <span className="flex items-center gap-1.5 opacity-60">
            <span>{baseVersion}</span>
            <span
              className="inline-block h-1.5 w-16 rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--border)' }}
            >
              <span
                className="block h-full rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${downloadProgress}%`,
                  backgroundColor: 'var(--theme-color)',
                }}
              />
            </span>
            <span className="tabular-nums min-w-[2ch] text-right">{downloadProgress}%</span>
          </span>
        )
      case 'download-ready':
        return (
          <span className="flex items-center gap-1">
            <span className="opacity-60">{baseVersion}</span>
            <Button
              size="sm"
              variant="default"
              className="h-5 text-[10px] px-2 py-0"
              onClick={handleVersionClick}
            >
              {t('statusBar.installAndRestart')}
            </Button>
          </span>
        )
      case 'download-failed':
        return (
          <span className="flex items-center gap-1">
            <span className="opacity-60">{baseVersion}</span>
            <span className="text-red-500">({t('statusBar.downloadFailedText')})</span>
          </span>
        )
      default:
        return <span className="opacity-60">{baseVersion}</span>
    }
  }

  const getVersionTooltip = () => {
    switch (versionStatus) {
      case 'idle':
        return t('statusBar.clickToCheck')
      case 'checking':
        return t('statusBar.checking')
      case 'has-update':
        return t('statusBar.foundNewVersion', { version: latestVersion })
      case 'up-to-date':
        return t('statusBar.upToDate')
      case 'check-failed':
        return t('statusBar.checkFailed')
      case 'downloading':
        return t('statusBar.downloadingTooltip', { progress: downloadProgress })
      case 'download-ready':
        return t('statusBar.downloadReadyTooltip')
      case 'download-failed':
        return t('statusBar.downloadFailedTooltip')
      default:
        return t('statusBar.clickToCheck')
    }
  }

  return (
    <>
      <AlertDialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('statusBar.newVersionFound')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('statusBar.newVersionReady', { version: latestVersion })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleUpgradeCancel}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleUpgradeConfirm}>{t('statusBar.installAndRestart')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div
        className="mt-1 flex items-center justify-between px-3 text-[12px] shrink-0 select-none"
      >
        {/* Left Section */}
        <div className="flex items-center gap-2">
          {syncStatus.lastSyncTime != null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 opacity-60 hover:opacity-100">
                  {syncStatus.isSyncing ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : syncStatus.failed > 0 || syncStatus.conflicted > 0 ? (
                    syncStatus.conflicted > 0 ? (
                      <AlertTriangle size={12} className="text-yellow-500" />
                    ) : (
                      <XCircle size={12} className="text-red-500" />
                    )
                  ) : (
                    <CheckCircle2 size={12} className="text-green-500" />
                  )}
                  <span className="text-[11px]">
                    {syncStatus.isSyncing
                      ? t('statusBar.syncing')
                      : t('statusBar.syncResult', {
                          succeeded: syncStatus.succeeded,
                          failed: syncStatus.failed + syncStatus.conflicted,
                        })}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {syncStatus.isSyncing
                  ? t('statusBar.syncing')
                  : `${t('statusBar.syncResult', { succeeded: syncStatus.succeeded, failed: syncStatus.failed + syncStatus.conflicted })}${syncStatus.conflicted > 0 ? ` (${t('statusBar.syncConflicted', { count: syncStatus.conflicted })})` : ''}`}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="opacity-60 hover:opacity-100 cursor-pointer flex items-center gap-1"
                onClick={handleRepoLinkClick}
              >
                <Link size={12} />
                GitHub
              </span>
            </TooltipTrigger>
            <TooltipContent>{t('statusBar.openGitHub')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="opacity-60 hover:opacity-100 cursor-pointer flex items-center gap-1">
                <User size={12} />
                Qithking
              </span>
            </TooltipTrigger>
            <TooltipContent>{t('statusBar.author')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span onClick={handleVersionClick}>
                {renderVersionDisplay()}
              </span>
            </TooltipTrigger>
            <TooltipContent>{getVersionTooltip()}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </>
  )
}

export { StatusBar }