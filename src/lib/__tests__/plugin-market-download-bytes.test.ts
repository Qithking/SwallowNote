/**
 * dev-fix: market-install-digest-typeerror
 *
 * macOS（WKWebView）上 tauri 对 ipc::Response 的 raw 响应经 eval 以 JSON
 * number 数组回传（非 ArrayBuffer），downloadPluginZip 必须归一化后再算
 * sha256，否则 crypto.subtle.digest 抛 TypeError 导致市场安装失败
 * （复现：安装 com.swallownote.mindmap@0.2.3 报
 * "The provided value is not of type '(ArrayBuffer or ArrayBufferView)'"）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}))

import { downloadPluginZip } from '../plugin-market'
import type { PluginIndexEntry } from '@/types/plugin'

/** 带 PK zip 头的字节数组（模拟 number 数组形态的 invoke 返回值） */
const ZIP_BYTES = [0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]

const REPO_URL = 'https://example.com/repo.json'

function makeEntry(sha256: string): PluginIndexEntry {
  return {
    id: 'com.swallownote.mindmap',
    name: 'mindmap',
    version: '0.2.3',
    description: '',
    author: '',
    tags: [],
    downloadUrl: 'https://example.com/com.swallownote.mindmap.zip',
    sha256,
    signatureB64: '',
    pubkeyB64: '',
    dependencies: [],
    versions: [],
  } as unknown as PluginIndexEntry
}

async function sha256HexOf(view: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', view.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('downloadPluginZip：raw invoke 结果归一化', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('bug 复现：invoke 返回 number 数组（macOS eval 路径）→ sha256 校验通过，不抛 TypeError', async () => {
    const expected = await sha256HexOf(new Uint8Array(ZIP_BYTES))
    invokeMock.mockResolvedValue([...ZIP_BYTES])
    const bytes = await downloadPluginZip(makeEntry(expected), REPO_URL)
    expect(bytes).toBeInstanceOf(ArrayBuffer)
    expect(await sha256HexOf(new Uint8Array(bytes))).toBe(expected)
  })

  it('invoke 返回 ArrayBuffer（fetch raw 路径）→ 原样通过', async () => {
    const expected = await sha256HexOf(new Uint8Array(ZIP_BYTES))
    invokeMock.mockResolvedValue(new Uint8Array(ZIP_BYTES).buffer)
    const bytes = await downloadPluginZip(makeEntry(expected), REPO_URL)
    expect(await sha256HexOf(new Uint8Array(bytes))).toBe(expected)
  })

  it('摘要不匹配 → 抛 sha256 mismatch', async () => {
    invokeMock.mockResolvedValue([...ZIP_BYTES])
    await expect(
      downloadPluginZip(makeEntry('deadbeef'.repeat(8)), REPO_URL)
    ).rejects.toThrow(/sha256 mismatch/)
  })
})
