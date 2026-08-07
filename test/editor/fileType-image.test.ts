/**
 * detectFileType 图片格式识别测试
 * Source: spec/image-preview AC-8
 */
import { describe, it, expect } from 'vitest'
import { detectFileType } from '@/lib/utils/fileTypeUtils'

describe('detectFileType — image', () => {
  it('PNG 文件返回 image', () => {
    expect(detectFileType('test.png', undefined, new Set())).toBe('image')
  })

  it('JPG/JPEG 文件返回 image', () => {
    expect(detectFileType('photo.jpg', undefined, new Set())).toBe('image')
    expect(detectFileType('photo.jpeg', undefined, new Set())).toBe('image')
  })

  it('GIF/WebP/BMP/ICO 文件返回 image', () => {
    expect(detectFileType('anim.gif', undefined, new Set())).toBe('image')
    expect(detectFileType('modern.webp', undefined, new Set())).toBe('image')
    expect(detectFileType('legacy.bmp', undefined, new Set())).toBe('image')
    expect(detectFileType('icon.ico', undefined, new Set())).toBe('image')
  })

  it('SVG 文件返回 image(从 code 路由切换)', () => {
    expect(detectFileType('logo.svg', undefined, new Set())).toBe('image')
  })

  it('AVIF/APNG 文件返回 image', () => {
    expect(detectFileType('modern.avif', undefined, new Set())).toBe('image')
    expect(detectFileType('animated.apng', undefined, new Set())).toBe('image')
  })

  it('大写扩展名也返回 image', () => {
    expect(detectFileType('PHOTO.PNG', undefined, new Set())).toBe('image')
    expect(detectFileType('Photo.JPG', undefined, new Set())).toBe('image')
  })

  it('图片优先级高于 binary 检测(PNG 含 null bytes 不回退 binary)', () => {
    // PNG 文件头含 null bytes,但应优先识别为 image
    const pngContent = '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR'
    expect(detectFileType('test.png', pngContent, new Set())).toBe('image')
  })

  it('非图片格式不受影响(.ts 仍返回 code)', () => {
    expect(detectFileType('code.ts', 'console.log(1)', new Set())).toBe('code')
  })

  it('非图片格式不受影响(.md 仍返回 markdown)', () => {
    expect(detectFileType('note.md', '# hello', new Set())).toBe('markdown')
  })
})
