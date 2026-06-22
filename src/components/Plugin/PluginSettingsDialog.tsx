/**
 * PluginSettingsDialog — generic settings form driven by a
 * plugin-supplied `settings.json` schema.
 *
 * The dialog is intentionally field-agnostic: every supported type
 * (string, string-multiline, number, boolean, select, color,
 * directory, password) renders through the same dispatch table in
 * [`renderField`], so adding a new type is a one-component change
 * plus a new branch in the dispatch.
 *
 * Lifecycle:
 *   1. `useEffect` on open → call `loadSettings(pluginId)` to
 *      fetch values + schema from the host. We treat "no schema"
 *      as a render-time error (the button shouldn't have shown).
 *   2. The user edits fields. We keep a local `values` map so
 *      saving and canceling are independent: cancel just unmounts
 *      and the host never sees the local edits.
 *   3. Save → `saveSettings` IPC. On success we toast and switch
 *      the close button to "Close" (no longer "Cancel") so the
 *      user can verify the saved state.
 *   4. Required validation is purely client-side; the host
 *      doesn't re-check on write, so the dialog is the only line
 *      of defense against empty values for `required: true`.
 */
import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, FolderOpen, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { open as openDirDialog } from '@tauri-apps/plugin-dialog'
import {
  hasSettings,
  isFieldVisible,
  loadSettings,
  saveSettings,
  type PluginSettingsField,
  type PluginSettingsView,
} from '@/lib/plugin-settings'

interface Props {
  pluginId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional: pre-loaded view to avoid a redundant IPC. */
  initial?: PluginSettingsView | null
}

export function PluginSettingsDialog({
  pluginId,
  open,
  onOpenChange,
  initial,
}: Props) {
  const [view, setView] = useState<PluginSettingsView | null>(initial ?? null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)
  const [reveal, setReveal] = useState<Record<string, boolean>>({})

  // Reset local state when the dialog opens / closes / target id
  // changes. Without this a previous plugin's schema could bleed
  // into the next open.
  useEffect(() => {
    if (!open) {
      setView(null)
      setValues({})
      setReveal({})
      setSavedOnce(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.resolve(initial ?? loadSettings(pluginId, true))
      .then((v) => {
        if (cancelled) return
        if (!hasSettings(v)) {
          toast.error('该插件未提供 settings.json')
          onOpenChange(false)
          return
        }
        setView(v)
        // Seed local values: prefer stored values, fall back to
        // schema defaults so a brand-new plugin shows the right
        // initial state.
        const seeded: Record<string, unknown> = {}
        for (const f of v.schema!.fields) {
          if (f.key in v.values) seeded[f.key] = v.values[f.key]
          else seeded[f.key] = f.default ?? defaultForType(f)
        }
        setValues(seeded)
      })
      .catch((e) => {
        if (cancelled) return
        toast.error(`加载设置失败：${String(e)}`)
        onOpenChange(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, pluginId, initial, onOpenChange])

  // Subset of the schema fields that pass the current
  // `visibleWhen` predicates. Recomputed whenever `values`
  // changes (e.g. the user switches `defaultProvider` from
  // "github" to "tencent" — the GitHub-only block should
  // disappear and the Tencent-only block appear in the same
  // render). We also reuse this list in the validation pass
  // so a `required: true` field that is currently hidden
  // doesn't permanently disable the Save button.
  const visibleFields = useMemo(
    () => view?.schema?.fields.filter((f) => isFieldVisible(f, values)) ?? [],
    [view, values]
  )

  const validation = useMemo(() => {
    const errors: Record<string, string> = {}
    for (const f of visibleFields) {
      if (!f.required) continue
      const v = values[f.key]
      if (v === undefined || v === null || v === '') {
        errors[f.key] = '此字段为必填'
      }
    }
    return errors
  }, [visibleFields, values])

  const canSave = !saving && Object.keys(validation).length === 0

  const handleSave = async () => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      await saveSettings(pluginId, values)
      setSavedOnce(true)
      toast.success('设置已保存')
    } catch (e) {
      toast.error(`设置保存失败：${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {view?.schema?.title ?? `${pluginId} 设置`}
          </DialogTitle>
          {view?.schema?.description && (
            <DialogDescription>{view.schema.description}</DialogDescription>
          )}
        </DialogHeader>

        {loading || !view?.schema ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {visibleFields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                value={values[field.key]}
                error={validation[field.key]}
                revealed={!!reveal[field.key]}
                onToggleReveal={() =>
                  setReveal((r) => ({ ...r, [field.key]: !r[field.key] }))
                }
                onChange={(v) => {
                  setValues((prev) => ({ ...prev, [field.key]: v }))
                  setSavedOnce(false)
                }}
                onPickDirectory={async () => {
                  if (field.type !== 'directory') return
                  const picked = await openDirDialog({ directory: true, multiple: false })
                  if (typeof picked === 'string') {
                    setValues((prev) => ({ ...prev, [field.key]: picked }))
                    setSavedOnce(false)
                  }
                }}
              />
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {savedOnce ? '关闭' : '取消'}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface FieldRowProps {
  field: PluginSettingsField
  value: unknown
  error: string | undefined
  revealed: boolean
  onToggleReveal: () => void
  onChange: (next: unknown) => void
  onPickDirectory: () => void
}

function FieldRow({
  field,
  value,
  error,
  revealed,
  onToggleReveal,
  onChange,
  onPickDirectory,
}: FieldRowProps) {
  const isSecret = field.secret || field.type === 'password'
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1">
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
      </Label>
      {field.type === 'boolean' ? (
        <div className="flex items-center gap-2">
          <Switch
            checked={!!value}
            onCheckedChange={(v) => onChange(v)}
          />
          <span className="text-sm text-muted-foreground">
            {value ? '已开启' : '已关闭'}
          </span>
        </div>
      ) : field.type === 'select' ? (
        <Select
          value={value == null ? '' : String(value)}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === 'string-multiline' ? (
        <Textarea
          rows={4}
          value={value == null ? '' : String(value)}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'number' ? (
        <Input
          type="number"
          value={value == null ? '' : String(value)}
          placeholder={field.placeholder}
          onChange={(e) => {
            const v = e.target.value
            onChange(v === '' ? null : Number(v))
          }}
        />
      ) : field.type === 'color' ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="h-9 w-12 rounded border border-input bg-transparent"
            value={value == null ? '#000000' : String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
          <Input
            value={value == null ? '' : String(value)}
            placeholder="#000000"
            onChange={(e) => onChange(e.target.value)}
            className="flex-1"
          />
        </div>
      ) : field.type === 'directory' ? (
        <div className="flex items-center gap-2">
          <Input
            value={value == null ? '' : String(value)}
            placeholder={field.placeholder ?? '未选择目录'}
            readOnly
            className="flex-1"
          />
          <Button variant="outline" type="button" onClick={onPickDirectory}>
            <FolderOpen className="mr-1 h-4 w-4" /> 选择
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type={isSecret && !revealed ? 'password' : 'text'}
            value={value == null ? '' : String(value)}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1"
          />
          {isSecret && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={onToggleReveal}
              aria-label={revealed ? '隐藏' : '显示'}
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      {field.placeholder && !error && field.type === 'string' && (
        <p className="text-xs text-muted-foreground">{field.placeholder}</p>
      )}
    </div>
  )
}

function defaultForType(field: PluginSettingsField): unknown {
  switch (field.type) {
    case 'boolean':
      return false
    case 'number':
      return 0
    case 'select':
      return field.options?.[0]?.value ?? null
    default:
      return ''
  }
}
