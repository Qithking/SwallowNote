/**
 * StatusBar Component - Bottom status bar
 */
import { useState, useCallback, useEffect } from 'react'
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

type VersionStatus = 'idle' | 'checking' | 'has-update' | 'up-to-date' | 'check-failed' | 'downloading' | 'download-ready' | 'download-failed'

function StatusBar() {
  const { showToast } = useUIStore()
  const [currentVersion] = useState(packageJson.version)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [versionStatus, setVersionStatus] = useState<VersionStatus>('idle')
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null)
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false)

  useEffect(() => {
    checkDownloadedInstaller()
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
      downloadLatestRelease(
        (progress: DownloadProgress) => {
          setDownloadProgress(Math.round(progress.progress))
        },
        (path: string) => {
          setDownloadedPath(path)
          setShowUpgradeDialog(true)
        },
        (error: string) => {
          setVersionStatus('download-failed')
          showToast(`下载失败: ${error}`)
        }
      )
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
        showToast('打开安装包失败')
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
      showToast('打开链接失败')
    }
  }

  const renderVersionDisplay = () => {
    const baseVersion = `v${currentVersion}`
    switch (versionStatus) {
      case 'idle':
      case 'up-to-date':
      case 'check-failed':
        return <span className="opacity-60 hover:opacity-100 cursor-pointer">{baseVersion}</span>
      case 'checking':
        return <span className="opacity-60 animate-pulse">{baseVersion} (检测中...)</span>
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
              下载升级
            </Button>
          </span>
        )
      case 'downloading':
        return (
          <span className="opacity-60">
            {baseVersion} (下载中: {downloadProgress}%)
          </span>
        )
      case 'download-ready':
        return (
          <span className="flex items-center gap-1">
            <span className="opacity-60">{baseVersion}</span>
            <span className="text-green-500">(新版本已就绪)</span>
          </span>
        )
      case 'download-failed':
        return (
          <span className="flex items-center gap-1">
            <span className="opacity-60">{baseVersion}</span>
            <span className="text-red-500">(下载失败)</span>
          </span>
        )
      default:
        return <span className="opacity-60">{baseVersion}</span>
    }
  }

  const getVersionTooltip = () => {
    switch (versionStatus) {
      case 'idle':
        return '点击检测新版本'
      case 'checking':
        return '检测中...'
      case 'has-update':
        return `发现新版本 ${latestVersion}，点击下载`
      case 'up-to-date':
        return '已是最新版本'
      case 'check-failed':
        return '检测失败，点击重试'
      case 'downloading':
        return `下载中: ${downloadProgress}%`
      case 'download-ready':
        return '新版本已就绪，点击升级'
      case 'download-failed':
        return '下载失败，点击重试'
      default:
        return '点击检测新版本'
    }
  }

  return (
    <>
      <AlertDialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>发现新版本</AlertDialogTitle>
            <AlertDialogDescription>
              新版本 {latestVersion} 已下载完成。是否立即升级？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleUpgradeCancel}>否</AlertDialogCancel>
            <AlertDialogAction onClick={handleUpgradeConfirm}>是</AlertDialogAction>
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
            <TooltipContent>打开 GitHub 仓库</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="opacity-60 hover:opacity-100 cursor-pointer flex items-center gap-1">
                <User size={12} />
                Qithking
              </span>
            </TooltipTrigger>
            <TooltipContent>作者</TooltipContent>
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