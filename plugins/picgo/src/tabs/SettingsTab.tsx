/**
 * SettingsTab — read-only summary of the current settings.
 *
 * The plugin does not own a custom settings UI; the host's
 * PluginSettingsDialog reads `settings.json` and renders the
 * full form. This tab exists so the user can verify what the
 * plugin is actually using without leaving the right panel.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PluginPanelProps } from '@swallow-note/plugin-sdk'
import type { AllSettings } from '../types'
import { resolveSettings, isProviderConfigured } from '../lib/settings'
import { getProviderDisplayName } from '../providers'

interface SettingsTabProps extends Pick<PluginPanelProps, 'getAllSettings'> {
  refreshTick: number
}

function maskToken(s: string | undefined): string {
  if (!s) return '未设置'
  if (s.length <= 6) return '******'
  return `${s.slice(0, 3)}…${s.slice(-3)}（已设置）`
}

export function SettingsTab({ getAllSettings, refreshTick }: SettingsTabProps): ReactNode {
  const [settings, setSettings] = useState<AllSettings | null>(null)

  useEffect(() => {
    let cancelled = false
    void getAllSettings().then((raw) => {
      if (cancelled) return
      setSettings(resolveSettings(raw))
    })
    return () => {
      cancelled = true
    }
  }, [getAllSettings, refreshTick])

  if (!settings) {
    return <div className="p-3 text-sm text-[var(--text-secondary)]">加载中…</div>
  }

  const provider = settings.defaultProvider
  const ready = isProviderConfigured(provider, settings)

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <div className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
        <div className="text-xs text-[var(--text-secondary)] mb-1">当前默认图床</div>
        <div className="font-medium mb-2">{getProviderDisplayName(provider)}</div>
        <ProviderSummary settings={settings} />
        <div
          className={`mt-2 text-xs ${
            ready ? 'text-green-600' : 'text-amber-600'
          }`}
        >
          {ready ? '已配置完成' : '配置不完整，请打开设置补充'}
        </div>
      </div>

      <div className="rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
        <div className="text-xs text-[var(--text-secondary)] mb-1">通用选项</div>
        <Row k="转码格式" v={settings.uploadFormat} />
        <Row k="最大文件大小" v={`${settings.maxFileSizeMB} MB`} />
        <Row k="文件名策略" v={settings.filenameStrategy} />
        <Row k="插入格式" v={settings.linkFormat} />
        <Row k="历史缓存" v={settings.enableHistory ? `开（${settings.historyRetention} 条）` : '关'} />
      </div>

      <button
        type="button"
        onClick={() => {
          // The host surfaces the PluginSettingsDialog when the
          // user clicks ⚙ on the plugin card. There's no in-panel
          // command for it; the visible button is here as a hint
          // to the user. When the host adds a programmatic hook
          // we'll wire it up.
          alert('请通过插件卡片的 ⚙ 按钮打开完整设置面板。')
        }}
        className="rounded border border-[var(--border-color)] bg-[var(--theme-color)] text-white px-3 py-2 hover:opacity-90"
      >
        打开设置
      </button>

      <div className="text-xs text-[var(--text-secondary)]">
        完整设置项（含自定义端点 Body 模板）请通过插件卡片的 ⚙ 按钮打开。
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }): ReactNode {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-[var(--text-secondary)]">{k}</span>
      <span className="font-mono text-xs">{v}</span>
    </div>
  )
}

function ProviderSummary({ settings }: { settings: AllSettings }): ReactNode {
  switch (settings.defaultProvider) {
    case 'smms':
      return <Row k="Token" v={maskToken(settings.smmsToken)} />
    case 'imgur':
      return <Row k="Client-ID" v={maskToken(settings.imgurClientId)} />
    case 'github':
      return (
        <>
          <Row k="Token" v={maskToken(settings.githubToken)} />
          <Row k="Owner" v={settings.githubOwner || '未设置'} />
          <Row k="Repo" v={settings.githubRepo || '未设置'} />
          <Row k="Branch" v={settings.githubBranch || 'main'} />
          <Row k="Path" v={settings.githubPathPrefix || ''} />
        </>
      )
    case 'tencent':
      return (
        <>
          <Row k="SecretId" v={maskToken(settings.tencentSecretId)} />
          <Row k="SecretKey" v={maskToken(settings.tencentSecretKey)} />
          <Row k="Region" v={settings.tencentRegion || '未设置'} />
          <Row k="Bucket" v={settings.tencentBucket || '未设置'} />
          <Row k="Protocol" v={settings.tencentProtocol} />
          <Row k="Path" v={settings.tencentKeyPrefix || ''} />
        </>
      )
    case 'aliyun':
      return (
        <>
          <Row k="AccessKey ID" v={maskToken(settings.aliyunAccessKeyId)} />
          <Row k="AccessKey Secret" v={maskToken(settings.aliyunAccessKeySecret)} />
          <Row k="Region" v={settings.aliyunRegion || '未设置'} />
          <Row k="Bucket" v={settings.aliyunBucket || '未设置'} />
          {settings.aliyunEndpoint ? (
            <Row k="Endpoint" v={settings.aliyunEndpoint} />
          ) : null}
          <Row k="Path" v={settings.aliyunKeyPrefix || ''} />
        </>
      )
    case 'qiniu':
      return (
        <>
          <Row k="AccessKey" v={maskToken(settings.qiniuAccessKey)} />
          <Row k="SecretKey" v={maskToken(settings.qiniuSecretKey)} />
          <Row k="Bucket" v={settings.qiniuBucket || '未设置'} />
          <Row k="Zone" v={settings.qiniuZone} />
          <Row k="Domain" v={settings.qiniuDomain || '未设置'} />
          <Row k="Path" v={settings.qiniuKeyPrefix || ''} />
        </>
      )
    case 'upyun':
      return (
        <>
          <Row k="Operator" v={settings.upyunOperator || '未设置'} />
          <Row k="Password" v={maskToken(settings.upyunPassword)} />
          <Row k="Service" v={settings.upyunBucket || '未设置'} />
          <Row k="Domain" v={settings.upyunDomain || '未设置'} />
          <Row k="Path" v={settings.upyunKeyPrefix || ''} />
        </>
      )
    case 'minio':
      return (
        <>
          <Row k="Endpoint" v={settings.minioEndpoint || '未设置'} />
          <Row k="AccessKey" v={maskToken(settings.minioAccessKey)} />
          <Row k="SecretKey" v={maskToken(settings.minioSecretKey)} />
          <Row k="Bucket" v={settings.minioBucket || '未设置'} />
          <Row k="Region" v={settings.minioRegion || 'us-east-1'} />
          <Row k="HTTPS" v={settings.minioUseSsl ? '开' : '关'} />
          <Row k="Path-Style" v={settings.minioPathStyle ? '开' : '关'} />
          <Row k="Path" v={settings.minioKeyPrefix || ''} />
        </>
      )
    case 'custom':
      return (
        <>
          <Row k="Endpoint" v={settings.customEndpoint || '未设置'} />
          <Row k="Method" v={settings.customMethod} />
          <Row k="URL 路径" v={settings.customResponseUrlPath || '未设置'} />
        </>
      )
    default:
      return null
  }
}
