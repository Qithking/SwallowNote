/**
 * StatusBar Component - Bottom status bar
 */
import { useState, useCallback } from 'react'
import { Link, User } from 'lucide-react'
import { useUIStore } from '@/stores'
import { checkLatestVersion, downloadLatestRelease, DownloadProgress } from '@/lib/tauri'
import { open } from '@tauri-apps/plugin-shell'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { Button } from '@/components/ui/button'
import packageJson from '../../package.json'

type VersionStatus = 'idle' | 'checking' | 'has-update' | 'up-to-date' | 'check-failed' | 'downloading' | 'download-complete' | 'download-failed'

function StatusBar() {
  const { showToast } = useUIStore()
  const [currentVersion] = useState(packageJson.version)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [versionStatus, setVersionStatus] = useState<VersionStatus>('idle')
  const [downloadProgress, setDownloadProgress] = useState<number>(0)

  const handleVersionClick = useCallback(async () => {
    if (versionStatus === 'downloading' || versionStatus === 'download-complete') {
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
        () => {
          setVersionStatus('download-complete')
        },
        (error: string) => {
          setVersionStatus('download-failed')
          showToast(`下载失败: ${error}`)
        }
      )
    }
  }, [versionStatus, showToast])

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
      case 'download-complete':
        return (
          <span className="flex items-center gap-1">
            <span className="opacity-60">{baseVersion}</span>
            <span className="text-green-500">(下载完成)</span>
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
      case 'download-complete':
        return '下载完成'
      case 'download-failed':
        return '下载失败，点击重试'
      default:
        return '点击检测新版本'
    }
  }

  return (
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
  )
}

export { StatusBar }