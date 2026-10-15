/**
 * editorBlockTransforms.ts 纯函数单测。
 * MarkdownEditor.tsx 拆分后的行为守护：确保拆出模块与原实现逻辑一致。
 */
import { describe, it, expect } from 'vitest'
import {
  isExternalUrl,
  resolveFilePath,
  walkBlocks,
  serializeBlocksForMarkdown,
  getFileBlockType,
} from '@/components/editors/editorBlockTransforms'
import { MERMAID_BLOCK_TYPE } from '@/components/editors/mermaidBlockSpec'
import { KATEX_BLOCK_TYPE } from '@/components/editors/katexBlockSpec'
import { MARKMAP_BLOCK_TYPE } from '@/components/editors/markmapBlockSpec'

describe('isExternalUrl', () => {
  it('识别 http/https/ftp/mailto/tel 等外部协议（大小写不敏感）', () => {
    expect(isExternalUrl('http://example.com')).toBe(true)
    expect(isExternalUrl('https://example.com/a?b=1')).toBe(true)
    expect(isExternalUrl('FTP://files.example.com')).toBe(true)
    expect(isExternalUrl('mailto:a@b.com')).toBe(true)
    expect(isExternalUrl('tel:+861234')).toBe(true)
  })

  it('内部路径与未支持协议不视为外部链接', () => {
    expect(isExternalUrl('/abs/path/img.png')).toBe(false)
    expect(isExternalUrl('./relative/img.png')).toBe(false)
    expect(isExternalUrl('#anchor')).toBe(false)
    // javascript:/data: 等协议不在白名单内
    expect(isExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalUrl('data:text/html,hello')).toBe(false)
  })
})

describe('resolveFilePath', () => {
  const current = '/Users/demo/notes/learn.md'

  it('绝对路径（Unix 与 Windows 盘符）原样返回', () => {
    expect(resolveFilePath('/etc/img.png', current)).toBe('/etc/img.png')
    expect(resolveFilePath('C:\\Users\\demo\\img.png', current)).toBe('C:\\Users\\demo\\img.png')
  })

  it('./ 前缀相对路径基于当前文件目录解析', () => {
    expect(resolveFilePath('./assets/img.png', current)).toBe('/Users/demo/notes/assets/img.png')
  })

  it('无前缀相对路径同样基于当前文件目录解析', () => {
    expect(resolveFilePath('img.png', current)).toBe('/Users/demo/notes/img.png')
  })

  it('.. 逐级回退当前文件目录', () => {
    expect(resolveFilePath('../shared/x.png', current)).toBe('/Users/demo/shared/x.png')
    expect(resolveFilePath('../../x.png', current)).toBe('/Users/x.png')
  })

  it('反斜杠统一转为正斜杠', () => {
    expect(resolveFilePath('.\\assets\\img.png', current)).toBe('/Users/demo/notes/assets/img.png')
  })
})

describe('walkBlocks', () => {
  it('visitor 返回新 block 时替换，返回 undefined 时保留', () => {
    const blocks = [
      { id: 'a', type: 'mermaid-ish' },
      { id: 'b', type: 'paragraph' },
    ]
    const result = walkBlocks(blocks, (b) => {
      if (b.type === 'mermaid-ish') return { ...b, type: 'codeBlock' }
      return undefined
    })
    expect(result[0].type).toBe('codeBlock')
    expect(result[1]).toEqual({ id: 'b', type: 'paragraph' })
    // 不修改原数组与原对象
    expect(blocks[0].type).toBe('mermaid-ish')
  })

  it('递归遍历嵌套 children', () => {
    const blocks = [
      {
        id: 'p',
        type: 'paragraph',
        children: [
          { id: 'child1', type: 'mermaid-ish' },
          { id: 'grand', type: 'quote', children: [{ id: 'grand1', type: 'mermaid-ish' }] },
        ],
      },
    ]
    const result = walkBlocks(blocks, (b) => (b.type === 'mermaid-ish' ? { ...b, type: 'codeBlock' } : undefined))
    expect(result[0].children[0].type).toBe('codeBlock')
    expect(result[0].children[1].children[0].type).toBe('codeBlock')
    // 原嵌套对象未被修改
    expect(blocks[0].children[0].type).toBe('mermaid-ish')
  })

  it('falsy block（null）原样跳过', () => {
    const blocks: any[] = [null, { id: 'a', type: 'paragraph' }]
    const result = walkBlocks(blocks, (b) => ({ ...b, touched: true }))
    expect(result[0]).toBeNull()
    expect(result[1].touched).toBe(true)
  })
})

describe('serializeBlocksForMarkdown', () => {
  it('mermaid block 还原为 codeBlock，无宽高时嵌入 meta 注释', () => {
    const blocks = [
      {
        id: 'm1',
        type: MERMAID_BLOCK_TYPE,
        props: { diagram: 'graph TD; A-->B' },
      },
    ]
    const result = serializeBlocksForMarkdown(blocks)
    expect(result[0].type).toBe('codeBlock')
    expect(result[0].props.language).toBe('mermaid')
    expect(result[0].content[0].text).toBe('graph TD; A-->B')
  })

  it('mermaid 有宽高时合成新 meta 并清除旧 meta', () => {
    const blocks = [
      {
        id: 'm1',
        type: MERMAID_BLOCK_TYPE,
        props: {
          width: 100,
          height: 50,
          diagram: '<!-- mermaid-meta:{"width":1,"height":1} -->\ngraph TD; A-->B',
        },
      },
    ]
    const result = serializeBlocksForMarkdown(blocks)
    expect(result[0].content[0].text).toBe(
      '<!-- mermaid-meta:{"width":100,"height":50} -->\ngraph TD; A-->B',
    )
  })

  it('katex block display=false 时 language 为 math-inline', () => {
    const blocks = [
      {
        id: 'k1',
        type: KATEX_BLOCK_TYPE,
        props: { formula: 'E=mc^2', display: false },
      },
    ]
    const result = serializeBlocksForMarkdown(blocks)
    expect(result[0].type).toBe('codeBlock')
    expect(result[0].props.language).toBe('math-inline')
    expect(result[0].content[0].text).toBe('E=mc^2')
  })

  it('katex 默认 display 时 language 为 math，宽高合成 katex-meta', () => {
    const blocks = [
      {
        id: 'k1',
        type: KATEX_BLOCK_TYPE,
        props: { formula: 'x^2', width: 200, height: 40 },
      },
    ]
    const result = serializeBlocksForMarkdown(blocks)
    expect(result[0].props.language).toBe('math')
    expect(result[0].content[0].text).toBe('<!-- katex-meta:{"width":200,"height":40} -->\nx^2')
  })

  it('markmap block 有宽高/缩放时合成 markmap-meta', () => {
    const blocks = [
      {
        id: 'mk1',
        type: MARKMAP_BLOCK_TYPE,
        props: { diagram: '# mindmap', width: 300, height: 200, scale: 1.5 },
      },
    ]
    const result = serializeBlocksForMarkdown(blocks)
    expect(result[0].type).toBe('codeBlock')
    expect(result[0].props.language).toBe('markmap')
    expect(result[0].content[0].text).toBe(
      '<!-- markmap-meta:{"width":300,"height":200,"scale":1.5} -->\n# mindmap',
    )
  })

  it('普通 block 原样保留且嵌套 children 被递归处理', () => {
    const paragraph = { id: 'p1', type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
    const blocks = [
      paragraph,
      {
        id: 'list1',
        type: 'bulletListItem',
        children: [{ id: 'c1', type: MERMAID_BLOCK_TYPE, props: { diagram: 'A' } }],
      },
    ]
    const result = serializeBlocksForMarkdown(blocks)
    expect(result[0]).toBe(paragraph)
    expect(result[1].children[0].type).toBe('codeBlock')
  })
})

describe('getFileBlockType', () => {
  it('图片扩展名返回 image（大小写不敏感）', () => {
    expect(getFileBlockType('a.png')).toBe('image')
    expect(getFileBlockType('/x/y/pic.JPG')).toBe('image')
    expect(getFileBlockType('logo.webp')).toBe('image')
  })

  it('视频/音频扩展名分别返回 video/audio', () => {
    expect(getFileBlockType('movie.mp4')).toBe('video')
    expect(getFileBlockType('clip.MOV')).toBe('video')
    expect(getFileBlockType('song.mp3')).toBe('audio')
    expect(getFileBlockType('record.flac')).toBe('audio')
  })

  it('其余扩展名与无扩展名文件返回 file', () => {
    expect(getFileBlockType('doc.pdf')).toBe('file')
    expect(getFileBlockType('doc.docx')).toBe('file')
    expect(getFileBlockType('noext')).toBe('file')
  })
})
