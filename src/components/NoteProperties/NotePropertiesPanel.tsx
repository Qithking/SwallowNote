/**
 * NotePropertiesPanel - Note frontmatter properties editor panel
 * Strictly follows prototype-properties.html new design
 */
import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Plus, Trash2 } from 'lucide-react'
import { useEditorStore } from '@/stores'
import { isStandardKey } from '@/lib/types/frontmatter'
import type { NoteFrontmatter, NoteStatus } from '@/lib/types/frontmatter'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'

interface NotePropertiesPanelProps {
  tabId: string
  frontmatter: NoteFrontmatter
}

function formatDateCompact(iso?: string): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

interface CustomPropertyRowProps {
  keyName: string
  value: string
  onRename: (oldKey: string, newKey: string) => void
  onUpdate: (key: string, value: string) => void
  onDelete: (key: string) => void
  removeLabel: string
}

function CustomPropertyRow({
  keyName,
  value,
  onRename,
  onUpdate,
  onDelete,
  removeLabel,
}: CustomPropertyRowProps) {
  // Local state for key input to avoid losing focus on every keystroke
  const [localKey, setLocalKey] = useState(keyName)
  const [localValue, setLocalValue] = useState(value)

  // Sync external changes (e.g. when the parent reorders or reloads)
  useEffect(() => {
    setLocalKey(keyName)
  }, [keyName])

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const commitKey = useCallback(() => {
    onRename(keyName, localKey)
  }, [keyName, localKey, onRename])

  const commitValue = useCallback(() => {
    onUpdate(keyName, localValue)
  }, [keyName, localValue, onUpdate])

  return (
    <div className="np-custom-row">
      <input
        className="np-custom-key"
        value={localKey}
        onChange={(e) => setLocalKey(e.target.value)}
        onBlur={commitKey}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          else if (e.key === 'Escape') {
            setLocalKey(keyName)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        style={{ border: '1px solid var(--pa-line)', background: 'transparent' }}
      />
      <input
        className="np-custom-val"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commitValue}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          else if (e.key === 'Escape') {
            setLocalValue(value)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        style={{ border: '1px solid var(--pa-line)', background: 'transparent' }}
      />
      <button
        className="np-custom-del"
        onClick={() => onDelete(keyName)}
        aria-label={removeLabel}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

function NotePropertiesPanel({ tabId, frontmatter }: NotePropertiesPanelProps) {
  const { t } = useTranslation()
  const updateTabFrontmatter = useEditorStore((s) => s.updateTabFrontmatter)
  const replaceTabFrontmatter = useEditorStore((s) => s.replaceTabFrontmatter)

  const tagInputRef = useRef<HTMLInputElement>(null)
  const catInputRef = useRef<HTMLInputElement>(null)

  const update = useCallback(
    (data: Partial<NoteFrontmatter>) => {
      updateTabFrontmatter(tabId, data)
    },
    [tabId, updateTabFrontmatter]
  )

  // --- Tags chip input ---
  const [tagInput, setTagInput] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const tags = frontmatter.tags ?? []

  const handleTagKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const val = tagInput.trim()
        if (val && !tags.includes(val)) {
          update({ tags: [...tags, val] })
        }
        setTagInput('')
      } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
        update({ tags: tags.slice(0, -1) })
      }
    },
    [tagInput, tags, update]
  )

  const removeTag = useCallback(
    (tag: string) => {
      update({ tags: tags.filter((t) => t !== tag) })
    },
    [tags, update]
  )

  // --- Categories chip input ---
  const [catInput, setCatInput] = useState('')
  const [showCatInput, setShowCatInput] = useState(false)
  const categories = frontmatter.categories ?? []

  const handleCatKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const val = catInput.trim()
        if (val && !categories.includes(val)) {
          update({ categories: [...categories, val] })
        }
        setCatInput('')
      } else if (e.key === 'Backspace' && !catInput && categories.length > 0) {
        update({ categories: categories.slice(0, -1) })
      }
    },
    [catInput, categories, update]
  )

  const removeCategory = useCallback(
    (cat: string) => {
      update({ categories: categories.filter((c) => c !== cat) })
    },
    [categories, update]
  )

  // --- Custom properties ---
  const customEntries = Object.entries(frontmatter).filter(
    ([key]) => !isStandardKey(key)
  )

  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  const handleAddProperty = useCallback(() => {
    const k = newKey.trim()
    const v = newValue.trim()
    if (!k) return
    update({ [k]: v })
    setNewKey('')
    setNewValue('')
    setShowAddForm(false)
  }, [newKey, newValue, update])

  const removeCustomProperty = useCallback(
    (key: string) => {
      const cleaned: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(frontmatter)) {
        if (k !== key) cleaned[k] = val
      }
      replaceTabFrontmatter(tabId, cleaned as NoteFrontmatter)
    },
    [frontmatter, tabId, replaceTabFrontmatter]
  )

  const updateCustomProperty = useCallback(
    (key: string, value: string) => {
      update({ [key]: value })
    },
    [update]
  )

  const renameCustomProperty = useCallback(
    (oldKey: string, newKey: string) => {
      const trimmed = newKey.trim()
      if (!trimmed || trimmed === oldKey) return
      if (trimmed in frontmatter) return // avoid duplicate key
      if (isStandardKey(trimmed)) return // prevent renaming to a standard key
      const entries = Object.entries(frontmatter)
      const next: Record<string, unknown> = {}
      for (const [k, v] of entries) {
        if (k === oldKey) next[trimmed] = v
        else next[k] = v
      }
      replaceTabFrontmatter(tabId, next as NoteFrontmatter)
    },
    [frontmatter, tabId, replaceTabFrontmatter]
  )
  const statusOptions: NoteStatus[] = ['draft', 'published', 'archived']

  return (
    <div className="np-root">
      {/* Header */}
      <div className="np-header">
        <div className="np-header-icon">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M3 3h10v10H3z M5 6h6M5 8h6M5 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span className="np-header-title">{t('noteProperties.title')}</span>
      </div>

      <ScrollArea className="np-scroll">
        <div className="np-body">
          {/* Group: Basic */}
          <div className="np-field-group">
            <div className="np-group-label">{t('noteProperties.group_basic')}</div>

            {/* Title */}
            <div className="np-inline-field" style={{ marginBottom: 4 }}>
              <span className="np-inline-label">{t('noteProperties.title_field')}</span>
              <div className="np-inline-control" >
                <input
                  className="np-input"
                  value={frontmatter.title ?? ''}
                  onChange={(e) => update({ title: e.target.value })}
                  placeholder={t('noteProperties.title_field')}
                  style={{ textAlign: 'right', border: '1px solid var(--pa-line)', background: 'transparent' }}
                />
              </div>
            </div>

            {/* Created time */}
            <div className="np-inline-field" style={{ marginBottom: 2 }}>
              <span className="np-inline-label">{t('noteProperties.created')}</span>
              <div className="np-inline-control" style={{ flex: 1, maxWidth: 160, textAlign: 'right' }}>
                <span className="np-meta-item" style={{ justifyContent: 'flex-end' }}>
                  <span className="np-meta-dot" style={{ background: 'var(--pa-positive)' }} />
                  {formatDateCompact(frontmatter.created)}
                </span>
              </div>
            </div>

            {/* Updated time */}
            <div className="np-inline-field">
              <span className="np-inline-label">{t('noteProperties.updated')}</span>
              <div className="np-inline-control" >
                <span className="np-meta-item" style={{ justifyContent: 'flex-end' }}>
                  <span className="np-meta-dot" />
                  {formatDateCompact(frontmatter.updated)}
                </span>
              </div>
            </div>
          </div>

          {/* Group: Classification */}
          <div className="np-field-group">
            <div className="np-group-label">{t('noteProperties.group_classification')}</div>

            {/* Tags */}
            <div className="np-inline-field" style={{ marginBottom: 6 }}>
              <span className="np-inline-label">{t('noteProperties.tags')}</span>
              <div className="np-inline-control" >
                <div className="np-chips">
                  {tags.map((tag) => (
                    <span key={tag} className="np-chip">
                      {tag}
                      <button
                        className="np-chip-x"
                        onClick={() => removeTag(tag)}
                        aria-label={t('noteProperties.remove')}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <button
                    className="np-chip-add"
                    onClick={() => {
                      setShowTagInput(true)
                      setTimeout(() => tagInputRef.current?.focus(), 0)
                    }}
                    aria-label={t('noteProperties.addProperty')}
                  >
                    <Plus size={10} />
                  </button>
                  {showTagInput && (
                    <input
                      ref={tagInputRef}
                      className="np-chip-input"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                      onBlur={() => {
                        if (!tagInput.trim()) setShowTagInput(false)
                      }}
                      placeholder={t('noteProperties.tagPlaceholder')}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Categories */}
            <div className="np-inline-field" style={{ marginBottom: 4 }}>
              <span className="np-inline-label">{t('noteProperties.categories')}</span>
              <div className="np-inline-control">
                <div className="np-chips">
                  {categories.map((cat) => (
                    <span key={cat} className="np-chip">
                      {cat}
                      <button
                        className="np-chip-x"
                        onClick={() => removeCategory(cat)}
                        aria-label={t('noteProperties.remove')}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <button
                    className="np-chip-add"
                    onClick={() => {
                      setShowCatInput(true)
                      setTimeout(() => catInputRef.current?.focus(), 0)
                    }}
                    aria-label={t('noteProperties.addProperty')}
                  >
                    <Plus size={10} />
                  </button>
                  {showCatInput && (
                    <input
                      ref={catInputRef}
                      className="np-chip-input"
                      value={catInput}
                      onChange={(e) => setCatInput(e.target.value)}
                      onKeyDown={handleCatKeyDown}
                      onBlur={() => {
                        if (!catInput.trim()) setShowCatInput(false)
                      }}
                      placeholder={t('noteProperties.tagPlaceholder')}
                      style={{ border: 'none' }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Group: Details */}
          <div className="np-field-group">
            <div className="np-group-label">{t('noteProperties.group_details')}</div>

            {/* Author */}
            <div className="np-inline-field" style={{ marginBottom: 4 }}>
              <span className="np-inline-label">{t('noteProperties.author')}</span>
              <div className="np-inline-control" >
                <input
                  className="np-input"
                  value={frontmatter.author ?? ''}
                  onChange={(e) => update({ author: e.target.value })}
                  placeholder={t('noteProperties.author')}
                  style={{ textAlign: 'right', border: '1px solid var(--pa-line)', background: 'transparent' }}
                />
              </div>
            </div>

            {/* Status */}
            <div className="np-inline-field" style={{ marginBottom: 4 }}>
              <span className="np-inline-label">{t('noteProperties.status')}</span>
              <div className="np-inline-control" style={{ display: 'flex', justifyContent: 'flex-end'}}>
                <Select
                  value={frontmatter.status ?? ''}
                  onValueChange={(val) => update({ status: val as NoteStatus })}
                >
                  <SelectTrigger className="np-select-trigger">
                    <SelectValue placeholder={t('noteProperties.status')} />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`noteProperties.status_${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Pinned */}
            <div className="np-inline-field">
              <span className="np-inline-label">{t('noteProperties.pinned')}</span>
              <Switch
                checked={frontmatter.pinned ?? false}
                onCheckedChange={(checked) => update({ pinned: checked })}
              />
            </div>
          </div>

          {/* Custom properties */}
          <div className="np-divider" />
          <div className="np-section-header">
            <span className="np-section-title">{t('noteProperties.customProperties')}</span>
            <button
              className="np-section-add"
              onClick={() => setShowAddForm(!showAddForm)}
              aria-label={t('noteProperties.addProperty')}
            >
              <Plus size={11} />
            </button>
          </div>

          {showAddForm && (
            <div className="np-add-form">
              <input
                className="np-input np-input-sm"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={t('noteProperties.key')}
                style={{ width: 72, flex: 'none', border: '1px solid var(--pa-line)', background: 'transparent' }}
              />
              <input
                className="np-input np-input-sm"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={t('noteProperties.value')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddProperty()
                }}
                style={{ border: '1px solid var(--pa-line)', background: 'transparent' }}
              />
              <button
                className="np-add-confirm"
                onClick={handleAddProperty}
                disabled={!newKey.trim()}
              >
                {t('noteProperties.add')}
              </button>
            </div>
          )}

          {customEntries.length === 0 && !showAddForm ? (
            <div className="np-empty">{t('noteProperties.noProperties')}</div>
          ) : (
            customEntries.map(([key, value]) => (
              <CustomPropertyRow
                key={key}
                keyName={key}
                value={String(value ?? '')}
                onRename={renameCustomProperty}
                onUpdate={updateCustomProperty}
                onDelete={removeCustomProperty}
                removeLabel={t('noteProperties.remove')}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export { NotePropertiesPanel }
