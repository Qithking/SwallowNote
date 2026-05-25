/**
 * StatusBar Component - Bottom status bar
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { Link, User } from 'lucide-react'
import { useUIStore } from '@/stores'
import { checkLatestVersion, downloadLatestRelease, openInstaller, DownloadProgress } from '@/lib/tauri'
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
  const { showToast } = useUIStore()
  const { autoCheckUpdate } = useUIStore()
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
      }
    } catch {
    }
  }

  const handleVersionClick = useCallback(async () => {
    if (versionStatus === 'downloading') {
      return
    }

    if (versionStatus === 'idle' || versionStatus === 'check-failed' || versionStatus === 'up-to-date') {
      setVersionStatus('checking')
      try {
        const result = await checkLatestVersion()
        if (result) {
          setLatestVersion(result.latest)
          if (result.hasUpdate) {
            setVersionStatus('has-update')
          } else {
            setVersionStatus('up-to-date')
          }
        } else {
          setVersionStatus('check-failed')
        }
      } catch {
        setVersionStatus('check-failed')
      }
      return
    }

    if (versionStatus === 'has-update' || versionStatus === 'download-failed') {
      setVersionStatus('downloading')
      setDownloadProgress(0)
      lastProgressRef.current = -1
      cancelDownloadRef.current?.()
      const cancel = downloadLatestRelease(
        (progress: DownloadProgress) => {
          const rounded = Math.round(progress.progress)
          // Skip setState if the integer progress hasn't changed
          if (rounded !== lastProgressRef.current) {
            lastProgressRef.current = rounded
            setDownloadProgress(rounded)
          }
        },
        (path: string) => {
          setDownloadedPath(path)
          setVersionStatus('download-ready')
          setShowUpgradeDialog(true)
          cancelDownloadRef.current = null
        },
        (error: string) => {
          setVersionStatus('download-failed')
          showToast(t('statusBar.downloadFailed', { error }))
          cancelDownloadRef.current = null
        }
      )
      cancelDownloadRef.current = cancel
    }

    if (versionStatus === 'download-ready') {
      setShowUpgradeDialog(true)
    }
  }, [versionStatus, showToast])

  const handleUpgradeConfirm = useCallback(async () => {
    setShowUpgradeDialog(false)
    if (downloadedPath) {
      try {
        await openInstaller(downloadedPath)
      } catch {
        showToast(t('statusBar.openInstallerFailed'))
      }
    }
  }, [downloadedPath, showToast])

  const handleUpgradeCancel = useCallback(() => {
    setShowUpgradeDialog(false)
    setVersionStatus('download-ready')
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
            <span className="text-green-500">({t('statusBar.downloadReady')})</span>
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
            <AlertDialogCancel onClick={handleUpgradeCancel}>{t('common.no')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleUpgradeConfirm}>{t('common.yes')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div
        className="mt-1 flex items-center justify-between px-3 text-[12px] shrink-0 select-none"
      >
        {/* Left Section */}
        <div className="flex items-center gap-2">

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