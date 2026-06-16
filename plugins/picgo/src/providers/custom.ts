/**
 * Custom provider — generic HTTP endpoint with templated body and
 * dot-path response parsing.
 *
 * Reads from `settings.customEndpoint` / `customMethod` /
 * `customHeaders` / `customBodyTemplate` / `customResponseUrlPath`.
 *
 * - `customHeaders`: multi-line, each line `Key: Value`; merged on
 *   top of a default `Content-Type: application/json` header (or
 *   left untouched when the body is empty).
 * - `customBodyTemplate`: supports placeholders `{filename}`,
 *   `{base64}`, `{mime}`, `{size}`. If `{base64}` is present the
 *   body is treated as a JSON object string and a `base64` field
 *   is computed; otherwise the placeholder is replaced literally.
 * - `customResponseUrlPath`: dot-separated JSONPath, e.g. `data.url`
 *   or `result.image`. The plugin walks the parsed response and
 *   returns the string at that path.
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

/** Parse `Key: Value` lines into a headers object. */
function parseHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colon = trimmed.indexOf(':')
    if (colon < 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = trimmed.slice(colon + 1).trim()
    if (!key) continue
    out[key] = value
  }
  return out
}

function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean)
  let cur: unknown = obj
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return cur
}

function hasBase64Placeholder(tpl: string): boolean {
  return /\{base64\}/.test(tpl)
}

export const customProvider: PicgoProvider = {
  id: 'custom',
  displayName: 'Custom',
  async upload(
    file: Blob,
    filename: string,
    settings: AllSettings,
    signal: AbortSignal,
    onProgress?: UploadProgressHandler
  ): Promise<UploadResult> {
    const endpoint = settings.customEndpoint?.trim()
    if (!endpoint) {
      throw new Error('Custom: 缺少端点 URL (customEndpoint)')
    }
    const method = (settings.customMethod || 'POST').toUpperCase() as
      | 'POST'
      | 'PUT'
    const template = settings.customBodyTemplate
    if (!template) {
      throw new Error('Custom: 缺少请求体模板 (customBodyTemplate)')
    }
    const responsePath = settings.customResponseUrlPath?.trim() || ''

    const base64 = await blobToBase64(file)
    const bodyString = template
      .replace(/\{filename\}/g, filename)
      .replace(/\{base64\}/g, base64)
      .replace(/\{mime\}/g, file.type || 'application/octet-stream')
      .replace(/\{size\}/g, String(file.size))

    const headers = parseHeaders(settings.customHeaders)
    // Default to JSON when the body uses placeholders but no
    // Content-Type is supplied. Skip when the body is empty
    // (caller may want to send a raw binary upload).
    if (!headers['Content-Type'] && !headers['content-type'] && hasBase64Placeholder(template)) {
      headers['Content-Type'] = 'application/json'
    }

    let resp: Response
    try {
      resp = await fetch(endpoint, {
        method,
        headers,
        body: bodyString,
        signal,
      })
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err
      throw new Error(`Custom: 网络错误：${(err as Error).message || 'fetch 失败'}`)
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new Error('Custom: 鉴权失败，请检查请求头配置')
    }

    // Try JSON first, fall back to text (some endpoints return
    // plain text URLs in the body).
    let text: string
    try {
      text = await resp.text()
    } catch (err) {
      throw new Error(`Custom: 响应读取失败：${(err as Error).message}`)
    }

    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // not JSON; leave parsed as the raw text
    }

    if (!resp.ok) {
      const detail =
        typeof parsed === 'string' ? parsed.slice(0, 200) : `HTTP ${resp.status}`
      throw new Error(`Custom: ${detail}`)
    }

    let url: unknown
    if (responsePath) {
      url = resolvePath(parsed, responsePath)
    } else if (typeof parsed === 'string') {
      url = parsed
    }

    if (typeof url !== 'string' || !url) {
      throw new Error(
        `Custom: 响应中未找到 URL（路径：${responsePath || '(none)'}）`
      )
    }

    onProgress?.({ loaded: file.size, total: file.size, percent: 100 })

    return {
      url,
      provider: 'custom',
      filename,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      mime: file.type || undefined,
    }
  },
}
