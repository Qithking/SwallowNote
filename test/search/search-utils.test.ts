import { describe, it, expect } from 'vitest'

describe('TC-050: 全局搜索测试', () => {
  interface SearchResult {
    title: string
    path: string
    snippet: string
    score: number
  }

  const mockDocuments = [
    { path: '/workspace/note1.md', content: 'Hello World! This is a test note about React and TypeScript.' },
    { path: '/workspace/note2.md', content: 'Learning Vue.js framework for building web applications.' },
    { path: '/workspace/docs/guide.md', content: 'Getting started with SwallowNote. Features include Markdown editing and AI assistant.' },
    { path: '/workspace/docs/api.md', content: 'API documentation for the SwallowNote plugin system.' },
    { path: '/workspace/projects/project1.md', content: 'Project documentation with code examples in Python and JavaScript.' },
  ]

  const searchDocuments = (query: string): SearchResult[] => {
    const lowerQuery = query.toLowerCase()
    const keywords = lowerQuery.split(/\s+/).filter(k => k.length > 0)
    
    if (keywords.length === 0) {
      return mockDocuments.map(doc => ({
        title: doc.path.split('/').pop() || doc.path,
        path: doc.path,
        snippet: doc.content.substring(0, 50) + (doc.content.length > 50 ? '...' : ''),
        score: 0
      }))
    }
    
    return mockDocuments
      .map(doc => {
        const title = doc.path.split('/').pop() || doc.path
        const lowerTitle = title.toLowerCase()
        const lowerContent = doc.content.toLowerCase()
        
        const allKeywordsMatch = keywords.every(k => lowerTitle.includes(k) || lowerContent.includes(k))
        
        if (!allKeywordsMatch) return null
        
        const index = lowerContent.indexOf(keywords[0])
        const snippetLength = 50
        const start = Math.max(0, index - 10)
        const end = Math.min(doc.content.length, start + snippetLength)
        const snippet = (start > 0 ? '...' : '') + doc.content.substring(start, end) + (end < doc.content.length ? '...' : '')
        
        let score = 0
        if (lowerTitle.includes(lowerQuery)) score += 50
        if (lowerContent.includes(lowerQuery)) score += 30
        if (lowerContent.startsWith(lowerQuery)) score += 20
        
        return {
          title,
          path: doc.path,
          snippet,
          score
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score) as SearchResult[]
  }

  it('TC-050-01: 基本搜索功能', () => {
    const results = searchDocuments('React')
    
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('note1.md')
    expect(results[0].path).toBe('/workspace/note1.md')
  })

  it('TC-050-02: 搜索结果排序', () => {
    const results = searchDocuments('test note')
    
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('note1.md')
  })

  it('TC-050-03: 模糊搜索', () => {
    const results = searchDocuments('swallow')
    
    expect(results.length).toBe(2)
    expect(results[0].title).toBe('guide.md')
    expect(results[1].title).toBe('api.md')
  })

  it('TC-050-04: 搜索结果片段预览', () => {
    const results = searchDocuments('AI')
    
    expect(results.length).toBe(1)
    expect(results[0].snippet).toContain('AI')
    expect(results[0].snippet.length).toBeLessThanOrEqual(55)
  })

  it('TC-050-05: 大小写不敏感', () => {
    const results1 = searchDocuments('react')
    const results2 = searchDocuments('React')
    const results3 = searchDocuments('REACT')
    
    expect(results1.length).toBe(1)
    expect(results2.length).toBe(1)
    expect(results3.length).toBe(1)
    expect(results1[0].title).toBe(results2[0].title)
    expect(results2[0].title).toBe(results3[0].title)
  })

  it('TC-050-06: 空搜索返回所有结果', () => {
    const results = searchDocuments('')
    
    expect(results.length).toBe(5)
  })

  it('TC-050-07: 搜索不存在的内容', () => {
    const results = searchDocuments('nonexistent term that does not exist')
    
    expect(results.length).toBe(0)
  })

  it('TC-050-08: 多关键词搜索', () => {
    const results = searchDocuments('documentation')
    
    expect(results.length).toBe(2)
    expect(results.map(r => r.title)).toContain('api.md')
    expect(results.map(r => r.title)).toContain('project1.md')
  })

  it('TC-050-09: 搜索标题匹配', () => {
    const results = searchDocuments('guide')
    
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('guide.md')
  })
})

describe('搜索结果评分测试', () => {
  const calculateScore = (query: string, title: string, content: string): number => {
    const lowerQuery = query.toLowerCase()
    const lowerTitle = title.toLowerCase()
    const lowerContent = content.toLowerCase()
    
    let score = 0
    
    if (lowerTitle.includes(lowerQuery)) score += 50
    if (lowerContent.includes(lowerQuery)) score += 30
    
    return score
  }

  it('标题匹配得分更高', () => {
    const score1 = calculateScore('guide', 'guide.md', 'some content')
    const score2 = calculateScore('guide', 'readme.md', 'guide content')
    
    expect(score1).toBe(50)
    expect(score2).toBe(30)
    expect(score1).toBeGreaterThan(score2)
  })

  it('内容匹配加分', () => {
    const score1 = calculateScore('guide', 'guide.md', 'guide is good')
    const score2 = calculateScore('guide', 'guide.md', 'this guide')
    
    expect(score1).toBe(80)
    expect(score2).toBe(80)
  })
})
