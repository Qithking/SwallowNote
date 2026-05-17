/**
 * SearchView Component - VSCode-like search with file content search support
 */
import { useState, useEffect, useRef } from 'react'
import { Search, ChevronRight, ChevronDown, X } from 'lucide-react'
import { searchInFiles, SearchResult as TSearchResult } from '@/lib/tauri'
import { useWorkspaceStore, useEditorStore, useUIStore } from '@/stores'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getFileIcon } from '@/lib/utils/fileIcon'

interface SearchResult extends TSearchResult {}

function SearchView() {
  const { rootPath, workspaceFolders } = useWorkspaceStore()
  const { workspaceMode } = useUIStore()
  const { addTab } = useEditorStore()
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Keyboard shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSearch = async () => {
    if (!query.trim()) {
      setResults([])
      return
    }

    // Determine search paths based on workspace mode
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
          query: query,
          root_path: path,
          case_sensitive: caseSensitive,
          whole_word: wholeWord,
          use_regex: useRegex,
          include_files: null,
          exclude_files: null,
        }).catch(() => [])
      )

      const allResults = await Promise.all(searchPromises)
      
      // Merge results and deduplicate by file_path
      const mergedMap = new Map<string, SearchResult>()
      for (const results of allResults) {
        for (const result of results) {
          if (mergedMap.has(result.file_path)) {
            // Merge line_matches for existing file
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
    } catch (e) {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }

  // Auto-search on query change with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch()
    }, 300)
    return () => clearTimeout(timer)
  }, [query, caseSensitive, wholeWord, useRegex, rootPath, workspaceFolders, workspaceMode])

  const toggleFileExpanded = (filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }

  const handleResultClick = async (result: SearchResult) => {
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
        viewMode: 'preview' as const,
        fileSize: content.length > 1024 ? `${(content.length / 1024).toFixed(1)}Kb` : `${content.length}B`,
        modifiedTime: new Date().toLocaleString(),
        wordCount: content.split(/\s+/).filter(Boolean).length,
      })
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  const totalMatches = results.reduce((sum, r) => sum + r.line_matches.length, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-[40px] px-3 shrink-0 select-none" >
        <span className="text-sm font-medium ">搜索</span>
      </div>

      {/* Search Input - VSCode style */}
      <div className="p-2 ">
        <div 
          className="flex items-center h-8 rounded overflow-hidden"
          style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
        >
         
          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            className="flex-1 h-full pl-2 bg-transparent text-sm focus:outline-none min-w-0"
            style={{ color: 'var(--text-primary)' }}
            placeholder="搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          
          {/* Clear Button */}
          {query && (
            <button
              onClick={() => setQuery('')}
              className="flex items-center justify-center w-6 h-full shrink-0 cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={12} />
            </button>
          )}
          
          {/* Search Options */}
          <div 
            className="flex items-center h-6 m-1 rounded"            
          >
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
              <TooltipContent side="bottom">大小写匹配</TooltipContent>
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
              <TooltipContent side="bottom">全词匹配</TooltipContent>
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
              <TooltipContent side="bottom">正则表达式</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Results Header */}
      {query && !isSearching && (
        <div className="px-3 py-1 text-xs" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
          {results.length > 0 ? (
            `${results.length} 个文件，${totalMatches} 个匹配项`
          ) : (
            '无结果'
          )}
        </div>
      )}

      {/* Results List - VSCode style */}
      <ScrollArea className="flex-1">
        {!query ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] px-4">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-sm text-center">输入搜索内容</p>
          </div>
        ) : isSearching ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
            <Search size={16} className="animate-spin mr-2" />
            <span className="text-sm">搜索中...</span>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] px-4">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-sm">未找到匹配项</p>
          </div>
        ) : (
          <div className="py-1">
            {results.map((result) => {
              const isExpanded = expandedFiles.has(result.file_path)
              
              return (
                <div key={result.file_path}>
                  {/* File header - VSCode style */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="flex items-center h-6 px-2 cursor-pointer hover:bg-[var(--bg-hover)]"
                        onClick={() => toggleFileExpanded(result.file_path)}
                      >
                        {/* Collapse/Expand arrow */}
                        {isExpanded ? (
                          <ChevronDown size={14} className="mr-1 shrink-0" style={{ color: 'var(--text-muted)' }} />
                        ) : (
                          <ChevronRight size={14} className="mr-1 shrink-0" style={{ color: 'var(--text-muted)' }} />
                        )}
                        {/* File icon */}
                        {getFileIcon(result.file_name, 14)}
                        {/* File name */}
                        <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                          {result.file_name}
                        </span>
                        {/* Match count badge */}
                        <span className="ml-auto text-xs px-1 rounded shrink-0" style={{ 
                          color: 'var(--text-muted)',
                          backgroundColor: 'var(--bg-tertiary)'
                        }}>
                          {result.line_matches.length}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{result.file_path}</TooltipContent>
                  </Tooltip>

                  {/* Match lines - content aligned with file icon */}
                  {isExpanded && result.line_matches.map((match, idx) => (
                    <div
                      key={`${result.file_path}-${match.line_number}-${idx}`}
                      className="flex items-center h-5 cursor-pointer hover:bg-[var(--bg-hover)]"
                      onClick={() => handleResultClick(result)}
                    >
                      {/* Spacer = arrow(14) + gap(4) = 18px to align with icon */}
                      <div className="w-[26px] shrink-0" />
                      {/* Content aligned with file icon */}
                      <span className="text-xs truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
                        {highlightAllMatches(match.content, query)}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// Highlight all matches in content (VSCode style)
function highlightAllMatches(content: string, query: string) {
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
  
  // Build highlighted JSX
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
          ? <span key={i} style={{ backgroundColor: 'rgba(255, 200, 0, 0.4)' }}>{part.text}</span>
          : <span key={i}>{part.text}</span>
      )}
    </>
  )
}

export { SearchView }