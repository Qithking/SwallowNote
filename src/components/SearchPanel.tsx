/**
 * SearchPanel Component - Global search panel (Ctrl+Shift+F)
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X, FileText } from 'lucide-react'
import { useUIStore } from '@/stores'

interface SearchResult {
  path: string
  line: number
  column: number
  content: string
  preview: string
}

function SearchPanel() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toggleSearchPanel } = useUIStore()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSearch = async () => {
    if (!query.trim()) return
    setIsSearching(true)
    // TODO: Implement actual search using Tauri commands
    // For now, simulate search results
    setTimeout(() => {
      setResults([])
      setIsSearching(false)
    }, 500)
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
      <div className="max-h-80 overflow-y-auto">
        {isSearching ? (
          <div className="p-4 text-center text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : results.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            {query ? t('search.noResults') : t('search.placeholder')}
          </div>
        ) : (
          results.map((result, index) => (
            <div
              key={index}
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
      </div>

      {/* Search Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-foreground">
        <span>Enter to search, Esc to close</span>
        <span>{results.length} results</span>
      </div>
    </div>
  )
}

export { SearchPanel }
