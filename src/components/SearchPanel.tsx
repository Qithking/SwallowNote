/**
 * SearchPanel Component - Global search panel (Ctrl+Shift+F)
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X, FileText } from 'lucide-react'
import { useUIStore, useWorkspaceStore } from '@/stores'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  searchInFiles,
  type SearchResult as TSearchResult,
} from '@/lib/tauri'

interface SearchResult {
  path: string
  line: number
  column: number
  content: string
  preview: string
}

/**
 * Flatten the Tauri hierarchical `SearchResult[]` (one entry per
 * file with nested `line_matches`) into the flat `SearchResult[]`
 * shape the panel renders (one row per match). Exported so unit
 * tests can exercise the mapping without standing up a Tauri
 * command surface.
 */
export function flattenSearchResults(
  tauriResults: TSearchResult[],
  previewMaxLen = 200,
): SearchResult[] {
  const flat: SearchResult[] = []
  for (const file of tauriResults) {
    for (const match of file.line_matches) {
      const content = match.content ?? ''
      const preview =
        content.length > previewMaxLen
          ? content.slice(0, previewMaxLen) + '…'
          : content
      flat.push({
        path: file.file_path,
        line: match.line_number,
        column: match.start_col,
        content,
        preview,
      })
    }
  }
  return flat
}

function SearchPanel() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toggleSearchPanel, workspaceMode } = useUIStore()
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const workspaceFolders = useWorkspaceStore((s) => s.workspaceFolders)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSearch = async () => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      return
    }

    const searchPaths =
      workspaceMode === 'workspace'
        ? workspaceFolders
        : rootPath
          ? [rootPath]
          : []

    if (searchPaths.length === 0) {
      setResults([])
      return
    }

    setIsSearching(true)
    try {
      const responses = await Promise.all(
        searchPaths.map((path) =>
          searchInFiles({
            query: trimmed,
            root_path: path,
            case_sensitive: false,
            whole_word: false,
            use_regex: false,
            include_files: null,
            exclude_files: null,
          }).catch(() => [] as TSearchResult[]),
        ),
      )
      setResults(flattenSearchResults(responses.flat()))
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    } else if (e.key === 'Escape') {
      toggleSearchPanel()
    }
  }

  return (
    <div className="search-panel">
      {/* Search Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Search size={16} className="text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          className="flex-1 bg-transparent border-none outline-none text-sm"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={toggleSearchPanel}
          className="p-1 rounded hover:bg-accent"
        >
          <X size={16} />
        </button>
      </div>

      {/* Search Results */}
      <ScrollArea className="max-h-80">
        {isSearching ? (
          <div className="p-4 text-center text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : results.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            {query ? t('search.noResults') : t('search.placeholder')}
          </div>
        ) : (
          results.map((result) => (
            <div
              key={`${result.path}:${result.line}`}
              className="p-3 hover:bg-accent cursor-pointer border-b border-border last:border-b-0"
            >
              <div className="flex items-center gap-2 text-sm">
                <FileText size={14} className="text-muted-foreground" />
                <span className="font-medium">{result.path}</span>
                <span className="text-muted-foreground">
                  {t('statusBar.Ln')} {result.line}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1 pl-6">
                {result.preview}
              </p>
            </div>
          ))
        )}
      </ScrollArea>

      {/* Search Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-foreground">
        <span>{t('search.hint')}</span>
        <span>{results.length} results</span>
      </div>
    </div>
  )
}

export { SearchPanel }
