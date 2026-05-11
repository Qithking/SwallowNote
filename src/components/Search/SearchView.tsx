/**
 * SearchView Component - Search within workspace
 */
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, FileText, FileSearch } from 'lucide-react'

function SearchView() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSearch = async () => {
    if (!query.trim()) return
    setIsSearching(true)
    // TODO: Implement actual search
    setTimeout(() => {
      setResults([])
      setIsSearching(false)
    }, 500)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-[40px] px-3 shrink-0 select-none" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>搜索</span>
      </div>

      {/* Search Input */}
      <div className="p-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            className="w-full h-8 pl-8 pr-3 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {!query ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-4">
            <FileSearch size={24} className="mb-2 opacity-50" />
            <p className="text-sm text-center">
              Enter a search term to find files and content
            </p>
          </div>
        ) : isSearching ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Search size={16} className="animate-spin mr-2" />
            <span>{t('common.loading')}</span>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-4">
            <FileSearch size={24} className="mb-2 opacity-50" />
            <p className="text-sm">{t('search.noResults')}</p>
          </div>
        ) : (
          <div className="px-1">
            {results.map((result, index) => (
              <div
                key={index}
                className="p-2 rounded hover:bg-accent cursor-pointer"
              >
                <div className="flex items-center gap-2 text-sm">
                  <FileText size={14} className="text-muted-foreground" />
                  <span className="font-medium">{result.fileName}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 pl-6 line-clamp-2">
                  {result.preview}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export { SearchView }
