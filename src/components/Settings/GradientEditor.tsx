import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GradientStop {
  color: string
  position: number // 0-100
}

interface GradientEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

const DIRECTIONS = [
  { angle: 0, label: '↑' },
  { angle: 45, label: '↗' },
  { angle: 90, label: '→' },
  { angle: 135, label: '↘' },
  { angle: 180, label: '↓' },
  { angle: 225, label: '↙' },
  { angle: 270, label: '←' },
  { angle: 315, label: '↖' },
]

function parseGradient(str: string): { angle: number; stops: GradientStop[] } | null {
  if (!str) return null
  const match = str.match(/^linear-gradient\(\s*(\d+)deg\s*,\s*(.+)\s*\)$/)
  if (!match) return null
  const angle = parseInt(match[1], 10)
  const stopsStr = match[2]
  const stops: GradientStop[] = []
  const parts = stopsStr.split(/,\s*(?=[a-f\d#]|rgba?\()/i)
  for (const part of parts) {
    const stopMatch = part.trim().match(/^(.+?)\s+(\d+)%$/)
    if (stopMatch) {
      stops.push({ color: stopMatch[1].trim(), position: parseInt(stopMatch[2], 10) })
    }
  }
  if (stops.length < 2) return null
  return { angle, stops }
}

function buildGradient(angle: number, stops: GradientStop[]): string {
  const stopsStr = stops
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${s.position}%`)
    .join(', ')
  return `linear-gradient(${angle}deg, ${stopsStr})`
}

export function GradientEditor({ value, onChange, disabled }: GradientEditorProps) {
  const [open, setOpen] = useState(false)
  const [angle, setAngle] = useState(135)
  const [stops, setStops] = useState<GradientStop[]>([
    { color: '#ffffff', position: 0 },
    { color: '#000000', position: 100 },
  ])
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const parsed = parseGradient(value)
    if (parsed) {
      setAngle(parsed.angle)
      setStops(parsed.stops)
    }
  }, [value])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const emitChange = useCallback(
    (newAngle: number, newStops: GradientStop[]) => {
      onChange(buildGradient(newAngle, newStops))
    },
    [onChange]
  )

  const handleAngleChange = (newAngle: number) => {
    setAngle(newAngle)
    emitChange(newAngle, stops)
  }

  const handleStopColorChange = (index: number, color: string) => {
    const newStops = stops.map((s, i) => (i === index ? { ...s, color } : s))
    setStops(newStops)
    emitChange(angle, newStops)
  }

  const handleStopPositionChange = (index: number, position: number) => {
    const clamped = Math.max(0, Math.min(100, position))
    const newStops = stops.map((s, i) => (i === index ? { ...s, position: clamped } : s))
    setStops(newStops)
    emitChange(angle, newStops)
  }

  const handleAddStop = () => {
    if (stops.length >= 6) return
    const sorted = [...stops].sort((a, b) => a.position - b.position)
    const lastTwo = sorted.slice(-2)
    const midPos = Math.round((lastTwo[0].position + lastTwo[1].position) / 2)
    const newStops = [...stops, { color: '#888888', position: midPos }]
    setStops(newStops)
    emitChange(angle, newStops)
  }

  const handleRemoveStop = (index: number) => {
    if (stops.length <= 2) return
    const newStops = stops.filter((_, i) => i !== index)
    setStops(newStops)
    emitChange(angle, newStops)
  }

  const gradientPreview = buildGradient(angle, stops)

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger: compact preview bar */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full h-6 rounded border border-border flex items-center gap-1 px-1 group',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <div
          className="flex-1 h-4 rounded-sm"
          style={{ background: gradientPreview }}
        />
        <ChevronDown
          size={10}
          className={cn(
            'text-muted-foreground shrink-0 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-[var(--bg-secondary)] border border-border rounded-md shadow-lg p-2 space-y-2">
          {/* Direction */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground w-6 shrink-0">方向</span>
            <div className="flex gap-0.5">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.angle}
                  onClick={() => handleAngleChange(d.angle)}
                  className={cn(
                    'w-5 h-5 rounded text-[9px] flex items-center justify-center border transition-colors',
                    angle === d.angle
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-accent'
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color stops */}
          <div className="space-y-0.5">
            {stops.map((stop, index) => (
              <div key={index} className="flex items-center gap-1">
                <input
                  type="color"
                  value={stop.color}
                  onChange={(e) => handleStopColorChange(index, e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border border-border bg-transparent shrink-0 p-0"
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={stop.position}
                  onChange={(e) => handleStopPositionChange(index, parseInt(e.target.value, 10))}
                  className="flex-1 h-1"
                />
                <span className="text-[9px] text-muted-foreground w-7 text-right">{stop.position}%</span>
                <button
                  onClick={() => handleRemoveStop(index)}
                  disabled={stops.length <= 2}
                  className={cn(
                    'w-4 h-4 flex items-center justify-center rounded hover:bg-accent text-muted-foreground shrink-0',
                    stops.length <= 2 && 'opacity-30 cursor-not-allowed'
                  )}
                >
                  <X size={8} />
                </button>
              </div>
            ))}
          </div>

          {/* Add stop */}
          <button
            onClick={handleAddStop}
            disabled={stops.length >= 6}
            className={cn(
              'flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground w-full',
              stops.length >= 6 && 'opacity-30 cursor-not-allowed'
            )}
          >
            <Plus size={9} />
            添加节点
          </button>
        </div>
      )}
    </div>
  )
}
