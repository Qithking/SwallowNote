/**
 * Cloud-upload icon — matches the WenyanIcon stroke style.
 * 24x24 viewBox, currentColor strokes.
 */
import type { ReactNode } from 'react'

export function PicgoIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.5 19a4.5 4.5 0 1 0-1.41-8.775 6 6 0 0 0-11.59 1.95A4.5 4.5 0 0 0 6 19h11.5z" />
      <path d="M12 12v9" />
      <path d="m9 15 3-3 3 3" />
    </svg>
  )
}
