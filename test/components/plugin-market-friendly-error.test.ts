/**
 * BUG-A(代码侧): 安装失败错误文案吞掉 HTTP 状态码。
 *
 * 行为契约: friendlyInstallError 对 HTTP 状态类错误（如
 * "HTTP 404 downloading com.swallownote.ai@0.1.5"）必须透传原始消息
 * （含状态码与插件 id），让用户能区分"仓库缺文件(404)"与"网络异常"；
 * 笼统的「下载失败:网络异常或文件已被移除」只留给真正的网络层失败
 * （fetch TypeError）。
 */
import { describe, it, expect } from 'vitest'
import { friendlyInstallError } from '@/components/Plugin/PluginMarketDetail'

const t = (key: string) => `<i18n:${key}>`

describe('BUG-A: friendlyInstallError 透传 HTTP 状态错误', () => {
  it('HTTP 404 下载错误透传原始消息（含状态码与插件 id）', () => {
    const raw = 'HTTP 404 downloading com.swallownote.ai@0.1.5'
    const msg = friendlyInstallError(new Error(raw), t)
    expect(msg).toContain('404')
    expect(msg).toContain('com.swallownote.ai')
    // 不得吞成笼统文案
    expect(msg).not.toBe('<i18n:plugin.market.errorDownload>')
  })

  it('网络层失败（Failed to fetch）仍映射为笼统下载失败文案', () => {
    const msg = friendlyInstallError(new Error('TypeError: Failed to fetch'), t)
    expect(msg).toBe('<i18n:plugin.market.errorDownload>')
  })

  it('sha256 mismatch 仍映射为摘要错误文案（不回归）', () => {
    const msg = friendlyInstallError(
      new Error('sha256 mismatch for a@1.0.0: expected x, got y'),
      t,
    )
    expect(msg).toBe('<i18n:plugin.market.errorSha256Mismatch>')
  })
})
