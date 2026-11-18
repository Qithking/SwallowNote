/**
 * C30 安全回归：第三方图床响应 URL 拼入笔记前的注入防护。
 *
 * 覆盖两层：
 * 1. custom provider 响应 URL 的 scheme 校验（拒绝 javascript:/data: 等可执行载体）
 * 2. editor-insert 拼 markdown/HTML 链接时的特殊字符转义
 */
import { describe, it, expect } from 'vitest'
import { buildInsertText, escapeMarkdownUrl } from '../src/lib/editor-insert'
import { validateImageUrlScheme } from '../src/providers/custom'
import type { UploadResult } from '../src/types'

function makeResult(url: string, filename = 'photo.png'): UploadResult {
  return {
    url,
    provider: 'custom',
    filename,
    size: 123,
    uploadedAt: '2026-11-13T00:00:00.000Z',
  }
}

describe('escapeMarkdownUrl', () => {
  it('普通 URL 原样返回', () => {
    expect(escapeMarkdownUrl('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png'
    )
  })

  it('括号/空格/引号等破坏 markdown 语法的字符百分号编码', () => {
    expect(escapeMarkdownUrl('https://x.com/a(b).png')).toBe(
      'https://x.com/a%28b%29.png'
    )
    expect(escapeMarkdownUrl('https://x.com/a b.png')).toBe(
      'https://x.com/a%20b.png'
    )
    expect(escapeMarkdownUrl('https://x.com/a"b<c>d.png')).toBe(
      'https://x.com/a%22b%3Cc%3Ed.png'
    )
  })

  it('已编码的百分号序列不被二次破坏', () => {
    expect(escapeMarkdownUrl('https://x.com/a%20b.png')).toBe(
      'https://x.com/a%20b.png'
    )
  })
})

describe('buildInsertText markdown 注入防护', () => {
  it('URL 含右括号时不破坏 markdown 链接结构', () => {
    const text = buildInsertText(makeResult('https://x.com/a)b.png'), 'markdown')
    // 编码后整段仍是单个合法 markdown 图片链接
    expect(text).toBe('![photo.png](https://x.com/a%29b.png)')
    expect(text.match(/!\[.*\]\((.*)\)/)?.[1]).toBe('https://x.com/a%29b.png')
  })

  it('alt 文件名中的括号被移除（既有行为保持）', () => {
    const text = buildInsertText(makeResult('https://x.com/a.png', 'ph[o]to'), 'markdown')
    expect(text).toBe('![photo](https://x.com/a.png)')
  })
})

describe('buildInsertText HTML 注入防护', () => {
  it('URL 含双引号时不逃逸出 src 属性', () => {
    const text = buildInsertText(makeResult('https://x.com/a"b.png'), 'html')
    expect(text).toContain('&quot;')
    expect(text).not.toContain('"b.png')
  })

  it('alt 含尖括号时做 HTML 转义', () => {
    const text = buildInsertText(makeResult('https://x.com/a.png', '<img>'), 'html')
    expect(text).toContain('&lt;img&gt;')
  })
})

describe('validateImageUrlScheme（custom provider 响应校验）', () => {
  it('http/https 放行', () => {
    expect(() => validateImageUrlScheme('https://cdn.example.com/a.png')).not.toThrow()
    expect(() => validateImageUrlScheme('http://cdn.example.com/a.png')).not.toThrow()
  })

  it('javascript:/data:/file: 等危险 scheme 拒绝', () => {
    expect(() => validateImageUrlScheme('javascript:alert(1)')).toThrow()
    expect(() => validateImageUrlScheme('data:text/html;base64,PHNjcmlwdD4=')).toThrow()
    expect(() => validateImageUrlScheme('file:///etc/passwd')).toThrow()
  })

  it('非绝对 URL 拒绝', () => {
    expect(() => validateImageUrlScheme('/uploads/a.png')).toThrow()
    expect(() => validateImageUrlScheme('')).toThrow()
  })
})
