/** 图片预处理：MIME/大小校验 + canvas 转码 */
import type { UploadFormat } from '../types'

export interface PreprocessInput {
  file: Blob
  filename: string
  uploadFormat: UploadFormat
  maxFileSizeMB: number
}

export interface PreprocessResult {
  file: Blob
  filename: string
  mime: string
}

const FORMAT_TO_MIME: Record<Exclude<UploadFormat, 'original'>, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
}

const FORMAT_TO_EXT: Record<Exclude<UploadFormat, 'original'>, string> = {
  webp: 'webp',
  jpg: 'jpg',
  png: 'png',
}

const QUALITY: Record<'webp' | 'jpg', number> = {
  webp: 0.92,
  jpg: 0.85,
}

export class ImageValidationError extends Error {
  readonly name = 'ImageValidationError'
}

function replaceExtension(filename: string, ext: string): string {
  const i = filename.lastIndexOf('.')
  const base = i >= 0 ? filename.slice(0, i) : filename
  return `${base}.${ext}`
}

function isImageBlob(blob: Blob): boolean {
  return !!blob.type && blob.type.startsWith('image/')
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      // 延迟释放 URL，确保加载完成
      setTimeout(() => URL.revokeObjectURL(url), 0)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败'))
    }
    img.src = url
  })
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`canvas 转码失败 (${mime})`))
          return
        }
        resolve(blob)
      },
      mime,
      quality
    )
  })
}

async function transcode(
  file: Blob,
  target: Exclude<UploadFormat, 'original'>
): Promise<Blob> {
  const img = await loadImage(file)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new ImageValidationError('浏览器不支持 canvas 2d，无法转码')
  }
  ctx.drawImage(img, 0, 0)
  const mime = FORMAT_TO_MIME[target]
  const quality = target === 'png' ? undefined : QUALITY[target]
  return canvasToBlob(canvas, mime, quality)
}

export async function preprocessImage(
  input: PreprocessInput
): Promise<PreprocessResult> {
  const { file, filename, uploadFormat, maxFileSizeMB } = input

  if (!isImageBlob(file)) {
    throw new ImageValidationError('仅支持图片文件')
  }

  const maxBytes = Math.max(1, maxFileSizeMB) * 1024 * 1024
  if (file.size > maxBytes) {
    throw new ImageValidationError(
      `文件大小 ${(file.size / 1024 / 1024).toFixed(2)} MB 超过限制 ${maxFileSizeMB} MB`
    )
  }

  if (uploadFormat === 'original') {
    return { file, filename, mime: file.type }
  }

  const targetMime = FORMAT_TO_MIME[uploadFormat]
  if (file.type === targetMime) {
    return { file, filename, mime: targetMime }
  }

  // 转码并替换扩展名，匹配目标 MIME
  const transcoded = await transcode(file, uploadFormat)
  return {
    file: transcoded,
    filename: replaceExtension(filename, FORMAT_TO_EXT[uploadFormat]),
    mime: targetMime,
  }
}
