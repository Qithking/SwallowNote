import { describe, it, expect } from 'vitest'
import {
  parseFrontmatter,
  serializeFrontmatter,
  stripFrontmatter,
  injectDefaultFrontmatter,
} from '@/lib/utils/frontmatter'

describe('parseFrontmatter', () => {
  it('含 frontmatter 的 Markdown', () => {
    const input = `---
title: 测试笔记
created: "2026-06-18T10:00:00.000Z"
tags:
  - meeting
  - work
---
# Hello

Body content`

    const { data, body, raw } = parseFrontmatter(input)

    expect(data.title).toBe('测试笔记')
    expect(data.created).toBe('2026-06-18T10:00:00.000Z')
    expect(data.tags).toEqual(['meeting', 'work'])
    expect(body).toBe('# Hello\n\nBody content')
    expect(raw).toContain('---')
  })

  it('不含 frontmatter 的 Markdown', () => {
    const input = '# Just a note\n\nNo frontmatter here'

    const { data, body, raw } = parseFrontmatter(input)

    expect(data).toEqual({})
    expect(body).toBe(input)
    expect(raw).toBe('')
  })

  it('空 frontmatter 块', () => {
    const input = `---
---
# Empty frontmatter`

    const { data, body } = parseFrontmatter(input)

    expect(data).toEqual({})
    expect(body).toBe('# Empty frontmatter')
  })

  it('多行值', () => {
    const input = `---
description: |
  Line 1
  Line 2
---
Content`

    const { data } = parseFrontmatter(input)

    expect(data.description).toContain('\n')
  })

  it('数组值（行内格式）', () => {
    const input = `---
tags: [a, b, c]
---
Content`

    const { data } = parseFrontmatter(input)

    expect(data.tags).toEqual(['a', 'b', 'c'])
  })

  it('中文内容', () => {
    const input = `---
title: 中文标题
author: 张三
---
这是正文`

    const { data } = parseFrontmatter(input)

    expect(data.title).toBe('中文标题')
    expect(data.author).toBe('张三')
  })

  it('布尔值', () => {
    const input = `---
pinned: true
---
Content`

    const { data } = parseFrontmatter(input)

    expect(data.pinned).toBe(true)
  })

  it('应剥离 UTF-8 BOM 并解析 frontmatter', () => {
    const content = '\uFEFF---\ntitle: Test\n---\nbody'
    const result = parseFrontmatter(content)
    expect(result.data.title).toBe('Test')
    expect(result.body).toBe('body')
  })

  it('应处理 CRLF 换行符', () => {
    const content = '---\r\ntitle: Test\r\n---\r\nbody'
    const result = parseFrontmatter(content)
    expect(result.data.title).toBe('Test')
    expect(result.body).toBe('body')
  })

  it('不应将 YAML 值中的 --- 视为闭合分隔符', () => {
    const content = '---\ndescription: "see https://example.com/a---b"\n---\nbody'
    const result = parseFrontmatter(content)
    expect(result.data.description).toBe('see https://example.com/a---b')
    expect(result.body).toBe('body')
  })

  it('应解析 frontmatter 中的嵌套对象', () => {
    const content = '---\nmetadata:\n  key: value\n  num: 42\n---\nbody'
    const result = parseFrontmatter(content)
    expect(result.data.metadata).toEqual({ key: 'value', num: 42 })
  })

  it('应处理 frontmatter 中的 null 值', () => {
    const content = '---\ntitle: Test\nauthor: null\n---\nbody'
    const result = parseFrontmatter(content)
    expect(result.data.title).toBe('Test')
    expect(result.data.author).toBeNull()
  })

  it('缺少闭合分隔符时应返回空数据', () => {
    const content = '---\ntitle: Test\nbody without closing'
    const result = parseFrontmatter(content)
    expect(result.data).toEqual({})
    expect(result.body).toBe(content)
  })

  it('当 --- 不在开头时不应解析 frontmatter', () => {
    const content = '\n---\ntitle: Test\n---\nbody'
    const result = parseFrontmatter(content)
    expect(result.data).toEqual({})
    expect(result.body).toBe(content)
  })
})

describe('serializeFrontmatter', () => {
  it('有数据', () => {
    const result = serializeFrontmatter({ title: 'Test', tags: ['a'] }, '# Hello')

    expect(result.startsWith('---\n')).toBe(true)
    expect(result).toContain('"title": "Test"')
    expect(result.endsWith('# Hello')).toBe(true)
  })

  it('空数据', () => {
    const result = serializeFrontmatter({}, '# Hello')

    expect(result).toBe('# Hello')
  })

  it('往返一致性', () => {
    const original = `---
title: Round Trip
tags:
  - x
  - y
---
Body here`

    const { data, body } = parseFrontmatter(original)
    const serialized = serializeFrontmatter(data, body)
    const { data: data2, body: body2 } = parseFrontmatter(serialized)

    expect(data2).toEqual(data)
    expect(body2).toBe(body)
  })
})

describe('stripFrontmatter', () => {
  it('含 frontmatter 的内容只返回 body', () => {
    const input = `---
title: Hello
---
# Heading`

    expect(stripFrontmatter(input)).toBe('# Heading')
  })

  it('不含 frontmatter 的内容返回原内容', () => {
    const input = '# No frontmatter'

    expect(stripFrontmatter(input)).toBe(input)
  })
})

describe('injectDefaultFrontmatter', () => {
  it('从 .md 文件名生成默认 frontmatter', () => {
    const result = injectDefaultFrontmatter('meeting-notes.md')

    expect(result).toContain('"title": "meeting-notes"')
    expect(result).toMatch(/"created":\s*"\d{4}-\d{2}-\d{2}T/)
  })

  it('非 .md 扩展名仍保留完整文件名作为 title', () => {
    const result = injectDefaultFrontmatter('test.txt')

    expect(result).toContain('"title": "test.txt"')
  })
})
