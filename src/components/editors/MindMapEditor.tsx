/**
 * MindMapEditor — Compatibility shim.
 *
 * The full `.smm` editor has moved to the
 * `com.swallownote.mindmap` plugin (see `plugins/mindmap/`).
 * This file stays behind so users on older hosts (or those who
 * have disabled the plugin) still get a clear "please install
 * the plugin" hint instead of a black screen when opening a
 * `.smm` file.
 *
 * The shim is intentionally tiny — no `simple-mind-map` import,
 * no business logic, no i18n keys. Users who see it are sent
 * straight to the plugin manager; from there they install
 * `com.swallownote.mindmap` and the real editor takes over.
 */
import { useTranslation } from 'react-i18next'
import { FileCode } from 'lucide-react'
import { useUIStore } from '@/stores'

export function MindMapEditor({ filename }: { content: string; onChange?: (content: string) => void; filename?: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary-gradient,var(--bg-primary))]">
      <div className="text-center max-w-md px-4">
        <FileCode size={48} className="mx-auto mb-4 opacity-40" />
        <p className="text-lg text-[var(--text-muted)]">{t('editor.mindmapPluginMissingTitle')}</p>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          {t('editor.mindmapPluginMissingBody', { filename: filename ?? '' })}
        </p>
        <button
          onClick={() => useUIStore.getState().setSettingsSection('plugins')}
          className="mt-4 px-4 py-2 rounded bg-[var(--theme-color)] text-white hover:opacity-90"
        >
          {t('editor.mindmapPluginInstall')}
        </button>
      </div>
    </div>
  )
}
