/**
 * UploadResultCard — small thumbnail + URL + action buttons.
 * Used in both the upload tab (compact mode) and the history
 * tab (full mode).
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { UploadResult } from '../types'
import { getProviderDisplayName } from '../providers'

interface UploadResultCardProps {
  result: UploadResult
  compact?: boolean
  onInsert?: () => void
}

export function UploadResultCard({
  result,
  compact,
  onInsert,
}: UploadResultCardProps): ReactNode {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.warn('[picgo] copy failed:', err)
    }
  }

  return (
    <div
      className={`rounded border border-[var(--border-color)] bg-[var(--bg-primary)] ${
        compact ? 'p-1.5' : 'p-2'
      }`}
    >
      <div className="flex gap-2 items-start">
        <img
          src={result.url}
          alt={result.filename}
          className={`${compact ? 'w-8 h-8' : 'w-14 h-14'} object-cover rounded border border-[var(--border-color)]`}
          loading="lazy"
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate" title={result.filename}>
            {result.filename}
          </div>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[var(--text-secondary)] truncate block hover:underline"
            title={result.url}
          >
            {result.url}
          </a>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            {getProviderDisplayName(result.provider)}
          </div>
        </div>
      </div>
      <div className="flex gap-1 mt-1.5">
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs rounded border border-[var(--border-color)] px-2 py-0.5 hover:bg-[var(--bg-hover)]"
        >
          {copied ? '已复制' : '复制 URL'}
        </button>
        {onInsert && (
          <button
            type="button"
            onClick={onInsert}
            className="text-xs rounded border border-[var(--border-color)] px-2 py-0.5 hover:bg-[var(--bg-hover)]"
          >
            插入到笔记
          </button>
        )}
      </div>
    </div>
  )
}
