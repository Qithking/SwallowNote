/**
 * H2 安装链路 harness：downloadPluginZip 完整链路（缓存→下载→sha256→缓存）
 * + installPluginFromBytes 参数契约。
 *
 * 用 fake-indexeddb 驱动真实 IndexedDB 缓存代码路径（jsdom 无 indexedDB，
 * 其它测试只能走"缓存跳过"分支，缓存命中/驱逐/LRU 无法覆盖）。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}))

import { downloadPluginZip, installPluginFromBytes } from '../plugin-market'
import type { PluginIndexEntry } from '@/types/plugin'

const REPO_URL = 'https://example.com/repo.json'

async function sha256HexOf(bytes: Uint8Array | number[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function makeEntry(sha256: string, downloadUrl = 'https://example.com/a.zip'): PluginIndexEntry {
  return {
    id: 'com.test.plugin',
    name: 'test',
    version: '1.0.0',
    description: '',
    author: '',
    tags: [],
    downloadUrl,
    sha256,
    signatureB64: '',
    pubkeyB64: '',
    dependencies: [],
    versions: [],
  } as unknown as PluginIndexEntry
}

/** 直写缓存库，构造"损坏缓存记录"场景（bytes 与 sha256 不符） */
async function putCorruptCacheRecord(sha256: string, bytes: number[]): Promise<void> {
  const req = indexedDB.open('swallow-plugin-market', 1)
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('plugin-zips', 'readwrite')
    tx.objectStore('plugin-zips').put({ sha256, bytes: new Uint8Array(bytes).buffer, fetchedAt: Date.now(), downloadUrl: 'x' })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  // downloadPluginZip 持有模块级连接，重开后旧连接仍有效，无需特殊处理
}

beforeEach(() => {
  invokeMock.mockReset()
})

describe('H2 安装链路：downloadPluginZip 缓存→下载→校验→缓存', () => {
  it('缓存命中：第二次下载同条目不再发起网络请求', async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0x11]
    const sha = await sha256HexOf(bytes)
    invokeMock.mockResolvedValue([...bytes])
    const entry = makeEntry(sha)

    await downloadPluginZip(entry, REPO_URL)
    expect(invokeMock).toHaveBeenCalledTimes(1)

    // 第二次：缓存命中，invoke 不再调用
    await downloadPluginZip(entry, REPO_URL)
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('缓存损坏：bytes 与 sha256 不符 → 驱逐并重新下载（自愈）', async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0x22]
    const sha = await sha256HexOf(bytes)
    // 预埋一条损坏记录：key 是正确 sha256，但 bytes 是错的
    await putCorruptCacheRecord(sha, [0x00, 0x01, 0x02])

    invokeMock.mockResolvedValue([...bytes])
    const result = await downloadPluginZip(makeEntry(sha), REPO_URL)

    // 损坏记录被驱逐，重新走网络，返回正确字节
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(await sha256HexOf(new Uint8Array(result))).toBe(sha)

    // 自愈后缓存可用：再次下载不再走网络
    await downloadPluginZip(makeEntry(sha), REPO_URL)
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('sha256 mismatch：抛错且不写缓存（下次下载仍走网络）', async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0x33]
    invokeMock.mockResolvedValue([...bytes])
    const entry = makeEntry('f'.repeat(64))

    await expect(downloadPluginZip(entry, REPO_URL)).rejects.toThrow(/sha256 mismatch/)
    expect(invokeMock).toHaveBeenCalledTimes(1)

    // 不写缓存：下次仍走网络（invoke 第二次调用）
    await expect(downloadPluginZip(entry, REPO_URL)).rejects.toThrow(/sha256 mismatch/)
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it('LRU 淘汰：超过 20 条后最旧条目被驱逐（重新下载走网络）', async () => {
    // 先灌 25 个不同条目；此前缓存已有少量旧条目，
    // 25 + 旧条目 > 20 必然淘汰最旧（含本组第一个）
    const firstSha = await sha256HexOf([0x50, 0x4b, 0x03, 0x04, 0x40])
    for (let i = 0; i < 25; i++) {
      const bytes = [0x50, 0x4b, 0x03, 0x04, 0x40 + i]
      const sha = await sha256HexOf(bytes)
      invokeMock.mockResolvedValue([...bytes])
      await downloadPluginZip(makeEntry(sha, `https://example.com/lru-${i}.zip`), REPO_URL)
    }
    const callsAfterFill = invokeMock.mock.calls.length

    // 本组第一个条目最旧 → 已被 LRU 淘汰 → 重新下载走网络
    invokeMock.mockResolvedValue([0x50, 0x4b, 0x03, 0x04, 0x40])
    await downloadPluginZip(makeEntry(firstSha, 'https://example.com/lru-0.zip'), REPO_URL)
    expect(invokeMock.mock.calls.length).toBe(callsAfterFill + 1)
  })
})

describe('H2 安装链路：错误契约与 URL 安全', () => {
  it('HTTP 状态透传契约：invoke 抛 "HTTP 404 ..." → 抛 "HTTP 404 downloading <id>@<ver>"', async () => {
    // 字节标记须避开 LRU 测试灌入的 0x40~0x58 区间，否则命中缓存
    const sha = await sha256HexOf([0x50, 0x4b, 0x03, 0x04, 0x81])
    invokeMock.mockRejectedValue(new Error('HTTP 404 downloading remote'))
    await expect(downloadPluginZip(makeEntry(sha), REPO_URL)).rejects.toThrow(
      'HTTP 404 downloading com.test.plugin@1.0.0',
    )
  })

  it('downloadUrl 非法 scheme（ftp:）→ 拒绝且不发起网络请求', async () => {
    const sha = await sha256HexOf([0x50, 0x4b, 0x03, 0x04, 0x82])
    await expect(
      downloadPluginZip(makeEntry(sha, 'ftp://example.com/a.zip'), REPO_URL),
    ).rejects.toThrow(/disallowed scheme/)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('相对 downloadUrl 基于 repoUrl 解析为绝对地址后拉取', async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0x83]
    const sha = await sha256HexOf(bytes)
    invokeMock.mockResolvedValue([...bytes])
    await downloadPluginZip(makeEntry(sha, './pkgs/a.zip'), REPO_URL)
    expect(invokeMock).toHaveBeenCalledWith(
      'plugin_fetch_market_bytes',
      expect.objectContaining({ url: 'https://example.com/pkgs/a.zip' }),
    )
  })
})

describe('H2 安装链路：installPluginFromBytes 参数契约', () => {
  it('ArrayBuffer → invoke 收到 number 数组与完整参数（宿主重校验 sha256+签名）', async () => {
    invokeMock.mockResolvedValue({})
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x61]).buffer
    await installPluginFromBytes({
      pluginId: 'com.test.plugin',
      version: '1.0.0',
      bytes,
      sha256: 'a'.repeat(64),
      pubkeyB64: 'PUBKEY',
      signatureB64: 'SIG',
      source: 'https://example.com/repo.json',
    })
    expect(invokeMock).toHaveBeenCalledWith('install_plugin_from_bytes', {
      pluginId: 'com.test.plugin',
      version: '1.0.0',
      bytes: [0x50, 0x4b, 0x03, 0x04, 0x61],
      sha256: 'a'.repeat(64),
      pubkeyB64: 'PUBKEY',
      signatureB64: 'SIG',
      source: 'https://example.com/repo.json',
    })
  })

  it('pubkey/signature 缺省 → 空串（与 Rust 端契约一致）', async () => {
    invokeMock.mockResolvedValue({})
    await installPluginFromBytes({
      pluginId: 'com.test.plugin',
      version: '1.0.0',
      bytes: new Uint8Array([1]).buffer,
      sha256: 'b'.repeat(64),
    })
    const args = invokeMock.mock.calls[0][1] as Record<string, unknown>
    expect(args.pubkeyB64).toBe('')
    expect(args.signatureB64).toBe('')
    expect(args.source).toBeUndefined()
  })
})
