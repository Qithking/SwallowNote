/**
 * SearchView Component - VSCode-like search with file content search support
 */
import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { Search, ChevronRight, ChevronDown, X, Filter, FileText, Plus, Trash2 } from 'lucide-react'
import { searchInFiles, SearchResult as TSearchResult } from '@/lib/tauri'
import { useWorkspaceStore, useEditorStore, useUIStore } from '@/stores'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getFileIcon } from '@/lib/utils/fileIcon'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { FullPathTooltip } from './FullPathTooltip'

type SearchResult = TSearchResult

interface FlattenedResult {
  type: 'file'
  file: SearchResult
  isExpanded: boolean
}

interface FlattenedMatch {
  type: 'match'
  file: SearchResult
  match: { line_number: number; content: string; start_col: number; end_col: number }
}

type FlattenedItem = FlattenedResult | FlattenedMatch

/**
 * Count words in content, properly handling CJK characters.
 */
function countWords(content: string): number {
  let count = 0
  const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g
  const cjkMatches = content.match(cjkRegex)
  if (cjkMatches) {
    count += cjkMatches.length
  }
  const withoutCjk = content.replace(cjkRegex, ' ')
  const latinWords = withoutCjk.split(/\s+/).filter(Boolean)
  count += latinWords.length
  return count
}

// 单个搜索结果文件项 - 使用 memo 优化
const SearchResultFile = memo(function SearchResultFile({
  result,
  isExpanded,
  onToggle,
}: {
  result: SearchResult
  isExpanded: boolean
  onToggle: (filePath: string) => void
}) {
  return (
    <div
      className="flex items-center h-6 px-2 cursor-pointer hover:bg-[var(--bg-hover)]"
      onClick={() => onToggle(result.file_path)}
    >
      {isExpanded ? (
        <ChevronDown size={14} className="mr-1 shrink-0" style={{ color: 'var(--text-muted)' }} />
      ) : (
        <ChevronRight size={14} className="mr-1 shrink-0" style={{ color: 'var(--text-muted)' }} />
      )}
      {getFileIcon(result.file_name, 14)}
      <FullPathTooltip content={result.file_path}>
        <span
          className="text-xs truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {result.file_name}
        </span>
      </FullPathTooltip>
      <span className="ml-auto text-xs px-1 rounded shrink-0" style={{ 
        color: 'var(--text-muted)',
        backgroundColor: 'var(--bg-tertiary)'
      }}>
        {result.line_matches.length}
      </span>
    </div>
  )
})

// 单个匹配项 - 使用 memo 优化
const SearchResultMatch = memo(function SearchResultMatch({
  file,
  match,
  query,
  onClick,
}: {
  file: SearchResult
  match: { line_number: number; content: string; start_col: number; end_col: number }
  query: string
  onClick: (file: SearchResult, lineNumber: number) => void
}) {
  return (
    <div
      className="flex items-center h-5 cursor-pointer hover:bg-[var(--bg-hover)]"
      onClick={() => onClick(file, match.line_number)}
    >
      <div className="w-[26px] shrink-0" />
      <span className="text-xs truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
        <HighlightMatches content={match.content} query={query} />
      </span>
    </div>
  )
})

// 高亮匹配文本 - 使用 memo 优化
const HighlightMatches = memo(function HighlightMatches({ content, query }: { content: string; query: string }) {
  if (!query) return <>{content}</>
  
  const lowerContent = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matches: { start: number; end: number }[] = []
  
  let pos = 0
  while ((pos = lowerContent.indexOf(lowerQuery, pos)) !== -1) {
    matches.push({ start: pos, end: pos + query.length })
    pos += 1
  }
  
  if (matches.length === 0) return <>{content}</>
  
  const parts: { text: string; highlighted: boolean }[] = []
  let lastEnd = 0
  
  for (const m of matches) {
    if (m.start > lastEnd) {
      parts.push({ text: content.substring(lastEnd, m.start), highlighted: false })
    }
    parts.push({ text: content.substring(m.start, m.end), highlighted: true })
    lastEnd = m.end
  }
  
  if (lastEnd < content.length) {
    parts.push({ text: content.substring(lastEnd), highlighted: false })
  }
  
  return (
    <>
      {parts.map((part, i) =>
        part.highlighted
          ? <span key={`h-${i}`} style={{ backgroundColor: 'rgba(255, 200, 0, 0.4)' }}>{part.text}</span>
          : <span key={`p-${i}`}>{part.text}</span>
      )}
    </>
  )
})

const SearchView = memo(function SearchView() {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders)
  const workspaceMode = useUIStore((s) => s.workspaceMode)
  const addTab = useEditorStore((s) => s.addTab)
  const inputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  // YAML 筛选状态
  const [showYamlFilter, setShowYamlFilter] = useState(false)
  const [yamlFilters, setYamlFilters] = useState<Array<{ key: string; value: string }>>([])
  const [yamlResults, setYamlResults] = useState<Array<{ file_path: string; title: string | null }>>([])
  const [isYamlSearching, setIsYamlSearching] = useState(false)
  const [selectedYamlPath, setSelectedYamlPath] = useState<string | null>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([])
      setYamlResults([])
      return
    }

    const searchPaths = workspaceMode === 'workspace' 
      ? workspaceFolders 
      : (rootPath ? [rootPath] : [])

    if (searchPaths.length === 0) {
      setResults([])
      return
    }

    setIsSearching(true)

    try {
      const searchPromises = searchPaths.map(path =>
        searchInFiles({
          query,
          root_path: path,
          case_sensitive: caseSensitive,
          whole_word: wholeWord,
          use_regex: useRegex,
          include_files: null,
          exclude_files: null,
        }).catch(() => [])
      )

      const allResults = await Promise.all(searchPromises)

      const mergedMap = new Map<string, SearchResult>()
      for (const results of allResults) {
        for (const result of results) {
          if (mergedMap.has(result.file_path)) {
            const existing = mergedMap.get(result.file_path)!
            const existingLines = new Set(existing.line_matches.map(m => m.line_number))
            for (const match of result.line_matches) {
              if (!existingLines.has(match.line_number)) {
                existing.line_matches.push(match)
                existingLines.add(match.line_number)
              }
            }
          } else {
            mergedMap.set(result.file_path, { ...result })
          }
        }
      }
      const mergedResults = Array.from(mergedMap.values())

      setResults(mergedResults)
      setExpandedFiles(new Set(mergedResults.map(r => r.file_path)))
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [query, workspaceMode, workspaceFolders, rootPath, caseSensitive, wholeWord, useRegex])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }, [handleSearch])

  // YAML 筛选搜索
  const handleYamlSearch = useCallback(async () => {
    const filters: Record<string, string> = {}
    for (const f of yamlFilters) {
      if (f.key.trim() && f.value.trim()) {
        filters[f.key.trim()] = f.value.trim()
      }
    }
    if (Object.keys(filters).length === 0) {
      setYamlResults([])
      return
    }

    setIsYamlSearching(true)
    try {
      const result = await invoke<Array<{ file_path: string; title: string | null }>>('search_frontmatter', {
        filters,
      })
      setYamlResults(result)
      setShowYamlFilter(false)
    } catch (e) {
      console.error('YAML search failed:', e)
      setYamlResults([])
    } finally {
      setIsYamlSearching(false)
    }
  }, [yamlFilters])

  const toggleFileExpanded = useCallback((filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }, [])

  const handleResultClick = useCallback(async (result: SearchResult, lineNumber?: number) => {
    try {
      const { readFile } = await import('@/lib/tauri')
      const content = await readFile(result.file_path)
      addTab({
        id: result.file_path,
        path: result.file_path,
        name: result.file_name,
        content,
        isDirty: false,
        isEdited: false,
        viewMode: 'source' as const,
        fileSize: content.length > 1024 ? `${(content.length / 1024).toFixed(1)}Kb` : `${content.length}B`,
        modifiedTime: new Date().toLocaleString(),
        wordCount: countWords(content),
        cursorPosition: lineNumber ? { line: lineNumber, column: 1 } : undefined,
      })
      if (lineNumber) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('scroll-to-line', { detail: { line: lineNumber } }))
        }, 200)
      }
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }, [addTab])

  // 扁平化搜索结果用于虚拟化
  const flattenedItems = useMemo<FlattenedItem[]>(() => {
    const items: FlattenedItem[] = []
    for (const result of results) {
      items.push({ type: 'file', file: result, isExpanded: expandedFiles.has(result.file_path) })
      if (expandedFiles.has(result.file_path)) {
        for (const match of result.line_matches) {
          items.push({ type: 'match', file: result, match })
        }
      }
    }
    return items
  }, [results, expandedFiles])

  // 虚拟化配置
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: flattenedItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => flattenedItems[index]?.type === 'file' ? 24 : 20,
    overscan: 10,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalMatches = useMemo(() => results.reduce((sum, r) => sum + r.line_matches.length, 0), [results])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-[40px] px-3 shrink-0 select-none" >
        <span className="text-sm font-medium ">{t('search.title')}</span>
      </div>

      {/* Search Input */}
      <div className="p-2 ">
        <div 
          className="flex items-center h-8 rounded overflow-hidden"
          style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
        >
          <input
            ref={inputRef}
            type="text"
            className="flex-1 h-full pl-2 bg-transparent text-sm focus:outline-none min-w-0"
            style={{ color: 'var(--text-primary)' }}
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          
          {query && (
            <button
              onClick={() => { setQuery(''); setYamlResults([]) }}
              className="flex items-center justify-center w-6 h-full shrink-0 cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={12} />
            </button>
          )}
          
          <div className="flex items-center h-6 m-1 rounded">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCaseSensitive(!caseSensitive)}
                  className="flex items-center justify-center w-5 h-full cursor-pointer rounded-l-sm"
                  style={{ 
                    backgroundColor: caseSensitive ? 'var(--bg-hover)' : 'transparent',
                    color: caseSensitive ? 'var(--text-primary)' : 'var(--text-muted)'
                  }}
                >
                  <span className="text-xs font-bold">Aa</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('search.caseSensitive')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setWholeWord(!wholeWord)}
                  className="flex items-center justify-center w-5 h-full cursor-pointer"
                  style={{ 
                    backgroundColor: wholeWord ? 'var(--bg-hover)' : 'transparent',
                    color: wholeWord ? 'var(--text-primary)' : 'var(--text-muted)'
                  }}
                >
                  <span className="text-xs font-medium">ab</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('search.wholeWord')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setUseRegex(!useRegex)}
                  className="flex items-center justify-center w-5 h-full rounded-r-sm"
                  style={{ 
                    backgroundColor: useRegex ? 'var(--bg-hover)' : 'transparent',
                    color: useRegex ? 'var(--text-primary)' : 'var(--text-muted)'
                  }}
                >
                  <span className="text-xs">.*</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('search.regex')}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* YAML 筛选切换按钮 */}
        <div className="flex items-center gap-1 mt-1">
          <button
            onClick={() => setShowYamlFilter(!showYamlFilter)}
            className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded hover:bg-accent"
            style={{ color: showYamlFilter ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            <Filter size={12} />
            {t('search.yamlFilter')}
            <ChevronRight size={10} className={showYamlFilter ? 'rotate-90' : ''} />
          </button>
        </div>

        {/* YAML 筛选区域 */}
        {showYamlFilter && (
          <div className="mt-1 w-full space-y-1.5 p-2 rounded border border-border/50 bg-background/50">
            {/* 动态键值对条件 */}
            {yamlFilters.map((filter, idx) => (
              <div key={idx} className="flex items-center gap-1 w-full">
                <input
                  type="text"
                  value={filter.key}
                  onChange={(e) => {
                    const next = [...yamlFilters]
                    next[idx] = { ...next[idx], key: e.target.value }
                    setYamlFilters(next)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleYamlSearch()}
                  placeholder={t('search.filterKey')}
                  className="shrink-0 min-w-[60px] max-w-[80px] h-6 px-1.5 text-xs bg-transparent border border-border/50 rounded outline-none focus:border-primary/50"
                  style={{ color: 'var(--text-primary)' }}
                />
                <span className="text-[11px] text-muted-foreground shrink-0">:</span>
                <input
                  type="text"
                  value={filter.value}
                  onChange={(e) => {
                    const next = [...yamlFilters]
                    next[idx] = { ...next[idx], value: e.target.value }
                    setYamlFilters(next)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleYamlSearch()}
                  placeholder={t('search.filterValue')}
                  className="flex-1 min-w-0 h-6 px-1.5 text-xs bg-transparent border border-border/50 rounded outline-none focus:border-primary/50"
                  style={{ color: 'var(--text-primary)' }}
                />
                <button
                  onClick={() => {
                    setYamlFilters(yamlFilters.filter((_, i) => i !== idx))
                  }}
                  className="p-0.5 text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {/* 添加条件按钮 */}
            <button
              onClick={() => setYamlFilters([...yamlFilters, { key: '', value: '' }])}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full"
            >
              <Plus size={11} />
              {t('search.addFilter')}
            </button>
            {/* 搜索按钮 */}
            <button
              onClick={handleYamlSearch}
              disabled={isYamlSearching}
              className="w-full h-6 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {isYamlSearching ? t('search.searching') : t('search.yamlSearch')}
            </button>
          </div>
        )}

        {/* YAML 筛选结果 */}
        {yamlResults.length > 0 && (
          <div className="mt-1 border-t border-border/50 pt-1">
            <div className="px-2 py-1 text-[11px] text-muted-foreground">
              {yamlResults.length} {t('common.files')}
            </div>
            {yamlResults.map((item) => {
              const fileName = item.file_path.split('/').pop() || item.file_path
              const isSelected = selectedYamlPath === item.file_path
              return (
                <div
                  key={item.file_path}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-0.5 cursor-pointer text-xs',
                    isSelected
                      ? 'bg-primary/10 text-[var(--text-primary)]'
                      : 'hover:bg-accent/50 text-[var(--text-secondary)]',
                  )}
                  onClick={() => {
                    setSelectedYamlPath(item.file_path)
                    handleResultClick({
                      file_path: item.file_path,
                      file_name: fileName,
                      line_matches: [],
                    } as SearchResult)
                  }}
                >
                  <FileText size={12} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{fileName}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Results Header */}
      {query && !isSearching && (
        <div className="px-3 py-1 text-xs" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
          {results.length > 0 ? (
            t('search.resultSummary', { files: results.length, matches: totalMatches })
          ) : (
            t('search.noResults')
          )}
        </div>
      )}

      {/* Results List with Virtualization */}
      <ScrollArea className="flex-1">
        {!query ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] px-4">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-sm text-center">{t('search.inputPlaceholder')}</p>
          </div>
        ) : isSearching ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <Search size={16} className="animate-spin mr-2" />
            <span className="text-sm">{t('search.searching')}</span>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] px-4">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-sm">{t('search.notFound')}</p>
          </div>
        ) : (
          <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems.map((virtualItem) => {
                const item = flattenedItems[virtualItem.index]
                return (
                  <div
                    key={virtualItem.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualItem.size}px`,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    {item.type === 'file' ? (
                      <SearchResultFile
                        result={item.file}
                        isExpanded={item.isExpanded}
                        onToggle={toggleFileExpanded}
                      />
                    ) : (
                      <SearchResultMatch
                        file={item.file}
                        match={item.match}
                        query={query}
                        onClick={handleResultClick}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  )
})

export { SearchView }
