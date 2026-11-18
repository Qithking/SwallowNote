/**
 * Imgur provider.
 *
 * - Endpoint: `POST https://api.imgur.com/3/image`
 * - Auth: `Authorization: Client-ID <clientId>`
 * - Body: JSON `{ image: <base64>, name?: <filename> }`
 * - Response: `{ success, status, data: { link, ... } }`
 */
import type { AllSettings, UploadResult, UploadProgressHandler } from '../types'
import type { PicgoProvider } from './types'

const IMGUR_ENDPOINT = 'https://api.imgur.com/3/image'

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

export const imgurProvider: PicgoProvider = {
  id: 'imgur',
  displayName: 'Imgur',
  async upload(
    file: Blob,
    filename: string,
    settings: AllSettings,
    signal: AbortSignal,
    onProgress?: UploadProgressHandler
  ): Promise<UploadResult> {
    if (!settings.imgurClientId) {
      throw new Error('Imgur: 缺少 Client-ID')
    }

    const base64 = await blobToBase64(file)
    const body = JSON.stringify({
      image: base64,
      name: filename,
      type: file.type || 'image/*',
    })

    let resp: Response
    try {
      resp = await fetch(IMGUR_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Client-ID ${settings.imgurClientId}`,
          'Content-Type': 'application/json',
        },
        body,
        signal,
      })
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err
      throw new Error(`Imgur: 网络错误：${(err as Error).message || 'fetch 失败'}`)
    }

    let json: {
      success?: boolean
      status?: number
      data?: { link?: string; error?: string }
    }
    try {
      json = await resp.json()
    } catch (err) {
      throw new Error(`Imgur: 响应解析失败：${(err as Error).message}`)
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new Error('Imgur: 鉴权失败，请检查 Client-ID')
    }
    if (!resp.ok || !json.success) {
      const detail = json.data?.error || `HTTP ${resp.status}`
      throw new Error(`Imgur: ${detail}`)
    }

    const url = json.data?.link
    if (!url) {
      throw new Error('Imgur: 响应中未包含 data.link')
    }

    onProgress?.({ loaded: file.size, total: file.size, percent: 100 })

    return {
      url,
      provider: 'imgur',
      filename,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      mime: file.type || undefined,
    }
  },
}
