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
import { resolveNodeModifiedTime } from '@/components/FileTree/FileTreeView'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
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
  searchOptions,
  onClick,
}: {
  file: SearchResult
  match: { line_number: number; content: string; start_col: number; end_col: number }
  query: string
  searchOptions: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
  onClick: (file: SearchResult, lineNumber: number) => void
}) {
  return (
    <div
      className="flex items-center h-5 cursor-pointer hover:bg-[var(--bg-hover)]"
      onClick={() => onClick(file, match.line_number)}
    >
      <div className="w-[26px] shrink-0" />
      <span className="text-xs truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
        <HighlightMatches content={match.content} query={query} searchOptions={searchOptions} />
      </span>
    </div>
  )
})

/**
 * I13④：收集与后端搜索语义一致的高亮区间（regex/全词/大小写开关联动）。
 * 此前高亮用字面 indexOf——regex/全词模式下高亮与实际命中不一致。
 * 无效正则返回空区间（退化为不高亮，与后端编译失败无结果一致），不抛错。
 */
export function collectHighlightRanges(
  content: string,
  query: string,
  opts: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
): Array<{ start: number; end: number }> {
  if (!query) return []
  let re: RegExp
  try {
    const flags = opts.caseSensitive ? 'g' : 'gi'
    if (opts.useRegex) {
      re = new RegExp(query, flags) // 后端 use_regex 时 whole_word 不参与
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      re = new RegExp(opts.wholeWord ? `\\b(?:${escaped})\\b` : escaped, flags)
    }
  } catch {
    return []
  }
  const ranges: Array<{ start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++ // 零宽匹配防死循环
    ranges.push({ start: m.index, end: m.index + m[0].length })
    if (ranges.length >= 500) break // 单行高亮上限，防极端长文本
  }
  return ranges
}

// 高亮匹配文本 - 使用 memo 优化
const HighlightMatches = memo(function HighlightMatches({
  content,
  query,
  searchOptions,
}: {
  content: string
  query: string
  searchOptions: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
}) {
  // 正则编译+全文扫描结果缓存：props 不变时不重复计算
  const matches = useMemo(
    () => collectHighlightRanges(content, query, searchOptions),
    [content, query, searchOptions]
  )

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

/** YAML 筛选结果行（与后端 search_frontmatter 返回对应） */
export interface YamlFilterResult {
  file_path: string
  title: string | null
}

/**
 * 按工作区根列表逐个限定查询 frontmatter 索引并按 file_path 去重合并（I6）。
 * 全局 SQLite 索引跨工作区共享，不按前缀限定会把其它工作区的记录混入结果。
 */
export async function searchFrontmatterByRoots(
  roots: string[],
  filters: Record<string, string>
): Promise<YamlFilterResult[]> {
  if (roots.length === 0) return []
  const perRoot = await Promise.all(
    roots.map((root) =>
      invoke<YamlFilterResult[]>('search_frontmatter', { filters, pathPrefix: root }).catch(() => [])
    )
  )
  const merged = new Map<string, YamlFilterResult>()
  for (const list of perRoot) {
    for (const r of list) {
      if (!merged.has(r.file_path)) merged.set(r.file_path, r)
    }
  }
  return [...merged.values()]
}

const SearchView = memo(function SearchView() {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders)
  const workspaceMode = useUIStore((s) => s.workspaceMode)
  const addTab = useEditorStore((s) => s.addTab)
  const inputRef = useRef<HTMLInputElement>(null)
  // 为 yaml 筛选条件生成稳定唯一 id，避免用 index 作 key 在删除/重排时输入状态错位
  const filterIdRef = useRef(0)
  const { t } = useTranslation()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  // I13①：区分「已回车搜索过」与「仅输入未回车」——未搜索时不显示「未找到匹配项」
  const [hasSearched, setHasSearched] = useState(false)
  // 产生当前 results 的搜索词：高亮用它而非实时 query——
  // 输入时 searchedQuery 不变 → match 项 memo 命中 → keystroke 渲染跳过列表（防卡死）
  const [searchedQuery, setSearchedQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  // I13③：搜索代际号——连续搜索时丢弃旧响应，防止旧结果覆盖新结果
  const searchSeqRef = useRef(0)

  // YAML 筛选状态
  const [showYamlFilter, setShowYamlFilter] = useState(false)
  const [yamlFilters, setYamlFilters] = useState<Array<{ id: number; key: string; value: string }>>([])
  const [yamlResults, setYamlResults] = useState<Array<{ file_path: string; title: string | null }>>([])
  const [isYamlSearching, setIsYamlSearching] = useState(false)
  const [selectedYamlPath, setSelectedYamlPath] = useState<string | null>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 当前搜索范围根：folder 模式 rootPath；workspace 模式多根（I6 YAML 筛选共用）
  const searchRoots = useMemo<string[]>(
    () => (workspaceMode === 'workspace' ? workspaceFolders : (rootPath ? [rootPath] : [])),
    [workspaceMode, workspaceFolders, rootPath]
  )

  // 高亮开关引用稳定化：内联对象会让所有 match 项 memo 失效（每 keystroke 全量重渲染）
  const searchOptions = useMemo(
    () => ({ caseSensitive, wholeWord, useRegex }),
    [caseSensitive, wholeWord, useRegex]
  )

  // I13②③：搜索主体支持开关值覆写（开关切换时立即携带最新值重搜，绕过 setState 异步）
  const runSearch = useCallback(async (overrides?: {
    caseSensitive?: boolean
    wholeWord?: boolean
    useRegex?: boolean
  }) => {
    if (!query.trim()) {
      setResults([])
      setYamlResults([])
      return
    }

    const searchPaths = searchRoots

    if (searchPaths.length === 0) {
      setResults([])
      return
    }

    const cs = overrides?.caseSensitive ?? caseSensitive
    const ww = overrides?.wholeWord ?? wholeWord
    const re = overrides?.useRegex ?? useRegex
    // I13③：代际号防竞态——旧响应晚到时丢弃，不覆盖新结果
    const seq = ++searchSeqRef.current
    setIsSearching(true)

    try {
      // 多根合并为单次 invoke：取消粒度=批次（新查询立即令旧批次后端遍历退出）
      const mergedResults = await searchInFiles({
        query,
        roots: searchPaths,
        case_sensitive: cs,
        whole_word: ww,
        use_regex: re,
      })
      if (seq !== searchSeqRef.current) return // 已有更新的搜索发起，丢弃本次旧结果

      setResults(mergedResults)
      setExpandedFiles(new Set(mergedResults.map(r => r.file_path)))
      setSearchedQuery(query)
      setHasSearched(true)
    } catch (e) {
      // 白名单拒绝/invoke 失败必须可见，否则表现为「搜不到结果」无法排查
      logger.error('search', 'Content search failed:', e)
      if (seq === searchSeqRef.current) setResults([])
    } finally {
      if (seq === searchSeqRef.current) {
        setIsSearching(false)
        setHasSearched(true)
      }
    }
  }, [query, searchRoots, caseSensitive, wholeWord, useRegex])

  const handleSearch = useCallback(() => runSearch(), [runSearch])

  // 即时搜索下输入不清 hasSearched：保留旧结果列表，新结果 300ms 后平滑替换
  // （回车时代的「输入即清」会让每个字符触发 列表→placeholder→列表 的闪动）
  const setQueryValue = useCallback((value: string) => {
    setQuery(value)
  }, [])

  // 即时搜索：输入/开关停止变化 300ms 后自动搜索（空 query 立即清结果）；
  // 前端防抖 + 后端代际号双层确保连续输入只跑最后一次查询
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    searchTimerRef.current = setTimeout(
      () => runSearch(),
      query.trim() ? 300 : 0,
    )
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [query, caseSensitive, wholeWord, useRegex, runSearch])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // 回车立即搜索并取消挂起的防抖计时器，避免 300ms 后重复搜索
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
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
      // I6：按当前工作区根逐个限定查询并合并，避免全局索引跨工作区污染
      const merged = await searchFrontmatterByRoots(searchRoots, filters)
      setYamlResults(merged)
      setShowYamlFilter(false)
    } catch (e) {
      logger.error('search', 'YAML search failed:', e)
      setYamlResults([])
    } finally {
      setIsYamlSearching(false)
    }
  }, [yamlFilters, searchRoots])

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
      // S-02：冲突文件不得以普通 tab 加载（工作树含标记）——改走冲突面板
      const { openFileWithConflictGuard } = await import('@/lib/git/conflictOpen')
      if (openFileWithConflictGuard(result.file_path)) return
      const { readFile } = await import('@/lib/tauri')
      const content = await readFile(result.file_path)
      // I9 同款：真实 mtime（获取失败保持 undefined，不回退当前时间）
      const modifiedTime = await resolveNodeModifiedTime(result.file_path)
      addTab({
        id: result.file_path,
        path: result.file_path,
        name: result.file_name,
        content,
        isDirty: false,
        isEdited: false,
        viewMode: 'source' as const,
        fileSize: content.length > 1024 ? `${(content.length / 1024).toFixed(1)}Kb` : `${content.length}B`,
        modifiedTime,
        wordCount: countWords(content),
        cursorPosition: lineNumber ? { line: lineNumber, column: 1 } : undefined,
      })
      if (lineNumber) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('scroll-to-line', { detail: { line: lineNumber } }))
        }, 200)
      }
    } catch (e) {
      logger.error('search', 'Failed to open file:', e)
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
    // 提供稳定 key，避免展开/折叠时按 index 复用导致渲染错位
    getItemKey: (index) => {
      const it = flattenedItems[index]
      return it?.type === 'file'
        ? `f-${it.file.file_path}`
        : `m-${it.file.file_path}-${it.match.line_number}`
    },
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
            onChange={(e) => setQueryValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          
          {query && (
            <button
              // 清空关键词：保留 yaml 筛选器（原业务逻辑），仅清空关键词与结果
              onClick={() => { setQueryValue(''); setYamlResults([]) }}
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
                  onClick={() => {
                    const next = !caseSensitive
                    setCaseSensitive(next)
                    // I13②：已有搜索结果时切换开关自动重搜（携带最新开关值）
                    if (query.trim() && hasSearched) void runSearch({ caseSensitive: next })
                  }}
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
                  onClick={() => {
                    const next = !wholeWord
                    setWholeWord(next)
                    // I13②：已有搜索结果时切换开关自动重搜
                    if (query.trim() && hasSearched) void runSearch({ wholeWord: next })
                  }}
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
                  onClick={() => {
                    const next = !useRegex
                    setUseRegex(next)
                    // I13②：已有搜索结果时切换开关自动重搜
                    if (query.trim() && hasSearched) void runSearch({ useRegex: next })
                  }}
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
              <div key={filter.id} className="flex items-center gap-1 w-full">
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
              onClick={() => setYamlFilters([...yamlFilters, { id: filterIdRef.current++, key: '', value: '' }])}
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

      {/* Results Header：搜索中且已有旧结果时保留显示，避免标题行每轮搜索消失重现 */}
      {query && (results.length > 0 || !isSearching) && (
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
        {/* 无 query 或从未搜索过 → placeholder；搜索中且无旧结果 → spinner；
            有旧结果时始终渲染列表，新结果 key 稳定增量替换（防闪动） */}
        {!query || (!hasSearched && results.length === 0) ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] px-4">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-sm text-center">{t('search.inputPlaceholder')}</p>
          </div>
        ) : isSearching && results.length === 0 ? (
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
                        query={searchedQuery}
                        searchOptions={searchOptions}
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
