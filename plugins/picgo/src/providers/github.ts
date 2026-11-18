/**
 * GitHub provider — uses the Contents API as a free image host.
 *
 * - Endpoint: `PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}`
 * - Auth: `Authorization: token <PAT>`
 * - Body: `{ message, content: <base64>, branch }`
 * - Response: `{ content: { download_url, ... } }`
 */
import type { AllSettings, UploadResult, UploadProgressHandler } from '../types'
import type { PicgoProvider } from './types'

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    )
  }
  return typeof btoa === 'function' ? btoa(binary) : binary
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, '')
}

function joinPath(prefix: string, filename: string): string {
  const p = trimSlashes(prefix || '')
  return p ? `${p}/${filename}` : filename
}

export const githubProvider: PicgoProvider = {
  id: 'github',
  displayName: 'GitHub',
  async upload(
    file: Blob,
    filename: string,
    settings: AllSettings,
    signal: AbortSignal,
    onProgress?: UploadProgressHandler
  ): Promise<UploadResult> {
    if (!settings.githubToken) {
      throw new Error('GitHub: 缺少 Personal Access Token')
    }
    if (!settings.githubOwner || !settings.githubRepo) {
      throw new Error('GitHub: 缺少 Owner / Repo')
    }

    const branch = settings.githubBranch?.trim() || 'main'
    const path = joinPath(settings.githubPathPrefix || '', filename)
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(
      settings.githubOwner
    )}/${encodeURIComponent(
      settings.githubRepo
    )}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`

    const base64 = await blobToBase64(file)
    const body = JSON.stringify({
      message: `upload ${filename} via SwallowNote PicGo plugin`,
      content: base64,
      branch,
    })

    let resp: Response
    try {
      resp = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          Authorization: `token ${settings.githubToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
        },
        body,
        signal,
      })
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err
      throw new Error(`GitHub: 网络错误：${(err as Error).message || 'fetch 失败'}`)
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new Error('GitHub: 鉴权失败，请检查 Token 权限（需要 repo）')
    }

    let json: {
      content?: { download_url?: string; path?: string }
      message?: string
      errors?: Array<{ message?: string }>
    }
    try {
      json = await resp.json()
    } catch (err) {
      throw new Error(`GitHub: 响应解析失败：${(err as Error).message}`)
    }

    if (!resp.ok) {
      const detail =
        json.message ||
        (json.errors && json.errors[0]?.message) ||
        `HTTP ${resp.status}`
      throw new Error(`GitHub: ${detail}`)
    }

    const url = json.content?.download_url
    if (!url) {
      throw new Error('GitHub: 响应中未包含 content.download_url')
    }

    onProgress?.({ loaded: file.size, total: file.size, percent: 100 })

    return {
      url,
      provider: 'github',
      filename,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      mime: file.type || undefined,
    }
  },
}
