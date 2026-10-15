import { describe, it, expect } from 'vitest'
import { resolveMarkdownImagePath } from '@/utils/resolveImagePath'

describe('resolveMarkdownImagePath', () => {
  const rootPath = 'D:/notes'

  describe('完整 URL 原样返回', () => {
    it('http:// URL', () => {
      expect(resolveMarkdownImagePath('http://example.com/foo.png', '', rootPath)).toBe(
        'http://example.com/foo.png',
      )
    })

    it('https:// URL', () => {
      expect(resolveMarkdownImagePath('https://example.com/bar.jpg', '/a/b.md', rootPath)).toBe(
        'https://example.com/bar.jpg',
      )
    })

    it('data: URI', () => {
      expect(resolveMarkdownImagePath('data:image/png;base64,abc', '/a/b.md', rootPath)).toBe(
        'data:image/png;base64,abc',
      )
    })

    it('asset:// URL', () => {
      expect(resolveMarkdownImagePath('asset://localhost/abc', '/a/b.md', rootPath)).toBe(
        'asset://localhost/abc',
      )
    })

    it('http://asset.localhost URL', () => {
      expect(
        resolveMarkdownImagePath('http://asset.localhost/D%3A/notes/img.png', '/a/b.md', rootPath),
      ).toBe('http://asset.localhost/D%3A/notes/img.png')
    })
  })

  describe('本地绝对路径原样返回', () => {
    it('Unix 绝对路径', () => {
      expect(resolveMarkdownImagePath('/home/user/img.png', '/a/b.md', rootPath)).toBe(
        '/home/user/img.png',
      )
    })

    it('Windows 盘符绝对路径 (正斜杠)', () => {
      expect(resolveMarkdownImagePath('D:/notes/img.png', '/a/b.md', rootPath)).toBe(
        'D:/notes/img.png',
      )
    })

    it('Windows 盘符绝对路径 (反斜杠)', () => {
      expect(resolveMarkdownImagePath('D:\\notes\\img.png', '/a/b.md', rootPath)).toBe(
        'D:\\notes\\img.png',
      )
    })
  })

  describe('相对路径解析', () => {
    it('./images/foo.png 基于当前文件目录解析', () => {
      expect(resolveMarkdownImagePath('./images/foo.png', 'D:/notes/sub/note.md', rootPath)).toBe(
        'D:/notes/sub/images/foo.png',
      )
    })

    it('percent-encoded 相对路径先解码再解析（Notion 导出场景）', () => {
      expect(
        resolveMarkdownImagePath('85%283%29%2Fimages%2Fabc.png', '/Users/u/notion/note.md', rootPath),
      ).toBe('/Users/u/notion/85(3)/images/abc.png')
    })

    it('percent-encoded 绝对路径解码后按绝对路径返回', () => {
      expect(
        resolveMarkdownImagePath('%2FUsers%2Fu%2Fimg%20name.png', '/a/b.md', rootPath),
      ).toBe('/Users/u/img name.png')
    })

    it('含非法 % 序列的路径按原文解析', () => {
      expect(resolveMarkdownImagePath('images/100%.png', '/a/b.md', rootPath)).toBe(
        '/a/images/100%.png',
      )
    })

    it('images/foo.png (无 ./ 前缀)', () => {
      expect(resolveMarkdownImagePath('images/foo.png', 'D:/notes/sub/note.md', rootPath)).toBe(
        'D:/notes/sub/images/foo.png',
      )
    })

    it('../assets/foo.png 上级目录', () => {
      expect(resolveMarkdownImagePath('../assets/foo.png', 'D:/notes/sub/note.md', rootPath)).toBe(
        'D:/notes/assets/foo.png',
      )
    })

    it('../../foo.png 多级上级', () => {
      expect(
        resolveMarkdownImagePath('../../foo.png', 'D:/notes/sub/deep/note.md', rootPath),
      ).toBe('D:/notes/foo.png')
    })
  })

  describe('Windows 反斜杠归一化', () => {
    it('反斜杠相对路径 images\\foo.png', () => {
      expect(resolveMarkdownImagePath('images\\foo.png', 'D:/notes/sub/note.md', rootPath)).toBe(
        'D:/notes/sub/images/foo.png',
      )
    })

    it('反斜杠前缀 .\\images\\foo.png', () => {
      expect(
        resolveMarkdownImagePath('.\\images\\foo.png', 'D:/notes/sub/note.md', rootPath),
      ).toBe('D:/notes/sub/images/foo.png')
    })

    it('混合分隔符 .\\images/foo.png', () => {
      expect(
        resolveMarkdownImagePath('.\\images/foo.png', 'D:/notes/sub/note.md', rootPath),
      ).toBe('D:/notes/sub/images/foo.png')
    })

    it('currentFilePath 用反斜杠 D:\\notes\\sub\\note.md', () => {
      expect(
        resolveMarkdownImagePath('./img.png', 'D:\\notes\\sub\\note.md', rootPath),
      ).toBe('D:/notes/sub/img.png')
    })

    it('反斜杠上级 ..\\assets\\foo.png', () => {
      expect(
        resolveMarkdownImagePath('..\\assets\\foo.png', 'D:/notes/sub/note.md', rootPath),
      ).toBe('D:/notes/assets/foo.png')
    })
  })

  describe('边界场景', () => {
    it('currentFilePath 为空时回退到 rootPath', () => {
      expect(resolveMarkdownImagePath('images/foo.png', '', rootPath)).toBe(
        'D:/notes/images/foo.png',
      )
    })

    it('currentFilePath 和 rootPath 均为空时原样返回', () => {
      expect(resolveMarkdownImagePath('images/foo.png', '', '')).toBe('images/foo.png')
    })

    it('空 url 原样返回', () => {
      expect(resolveMarkdownImagePath('', 'D:/notes/note.md', rootPath)).toBe('')
    })

    it('仅 . 的路径', () => {
      expect(resolveMarkdownImagePath('.', 'D:/notes/sub/note.md', rootPath)).toBe(
        'D:/notes/sub',
      )
    })
  })
})
