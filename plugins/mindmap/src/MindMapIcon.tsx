import type { ReactNode } from 'react'

/**
 * MindMap plugin icon — a 3-node mind-map glyph that fits the
 * `currentColor` stroke convention used elsewhere in the title bar.
 */
export function MindMapIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Central node */}
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      {/* Three child nodes */}
      <circle cx="4" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="20" cy="6" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="19" r="1.6" fill="currentColor" stroke="none" />
      {/* Connecting lines */}
      <path d="M10.2 10.5 5.5 6.4" />
      <path d="M13.8 10.5 18.6 7.4" />
      <path d="M13.7 13.6 18 17.5" />
    </svg>
  )
}
