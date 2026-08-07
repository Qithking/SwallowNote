/**
 * 图片文件从文件树打开的回归测试
 * Source: bug/image-tree-click-not-opening
 *
 * 根因:文件树点击图片时 loadFileContent 调用 Rust read_to_string,
 * 二进制图片非 UTF-8 → reject → addTab 永不调用 → tab 不创建
 *
 * 修复:isImageFile 判断为图片时跳过 content 加载,直接 addTab(content='')
 * ImagePreviewEditor 用 convertFileSrc(tab.path) 显示,不依赖 content
 */
import { describe, it, expect } from 'vitest'
import { isImageFile } from '@/lib/utils/fileTypeUtils'
import { detectFileType } from '@/lib/utils/fileTypeUtils'

describe('isImageFile', () => {
  it('识别 PNG/JPG/GIF/WebP/BMP/ICO/SVG/AVIF/APNG 为图片', () => {
    expect(isImageFile('photo.png')).toBe(true)
    expect(isImageFile('photo.JPG')).toBe(true)
    expect(isImageFile('anim.gif')).toBe(true)
    expect(isImageFile('modern.webp')).toBe(true)
    expect(isImageFile('legacy.bmp')).toBe(true)
    expect(isImageFile('icon.ico')).toBe(true)
    expect(isImageFile('logo.svg')).toBe(true)
    expect(isImageFile('modern.avif')).toBe(true)
    expect(isImageFile('animated.apng')).toBe(true)
  })

  it('非图片文件返回 false', () => {
    expect(isImageFile('note.md')).toBe(false)
    expect(isImageFile('code.ts')).toBe(false)
    expect(isImageFile('data.json')).toBe(false)
  })

  it('无扩展名或空文件名返回 false', () => {
    expect(isImageFile('noext')).toBe(false)
    expect(isImageFile('')).toBe(false)
  })
})

describe('图片文件 content 为空时 detectFileType 仍返回 image', () => {
  // 验证修复路径:addTab content='' 后,Editor.tsx 调用 detectFileType 仍能正确路由
  it('content 为空串时 PNG 仍识别为 image', () => {
    expect(detectFileType('photo.png', '', new Set())).toBe('image')
  })

  it('content 为 undefined 时 PNG 仍识别为 image', () => {
    expect(detectFileType('photo.png', undefined, new Set())).toBe('image')
  })
})
