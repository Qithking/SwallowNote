/**
 * `MindMapPanel` — placeholder shown when the user clicks the
 * mind-map icon in the title bar. The plugin's actual editing
 * surface is the `editorComponent` mounted by the host when a
 * `.smm` file is opened; this panel is just a hint pointing the
 * user at the right file type.
 */
import { useT } from './i18n/useT'
import { Network } from 'lucide-react'

export function MindMapPanel() {
  const t = useT()
  return (
    <div
      className="flex-1 flex items-center justify-center p-8"
      style={{
        background: 'var(--bg-secondary)',
        color: 'var(--text-secondary)',
      }}
    >
      <div className="max-w-md text-center space-y-3">
        <div
          className="mx-auto flex items-center justify-center w-12 h-12 rounded-full"
          style={{
            background: 'var(--bg-tertiary, var(--bg-hover))',
            color: 'var(--theme-color)',
          }}
        >
          <Network size={22} />
        </div>
        <h2
          className="text-base font-medium"
          style={{ color: 'var(--text-primary)' }}
        >
          {t('mindMap.defaultRootText')}
        </h2>
        <p className="text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>
          {t('mindMap.loading')}
        </p>
        <p
          className="text-[11px] mt-4 inline-block px-2 py-0.5 rounded"
          style={{
            background: 'var(--bg-tertiary, var(--bg-hover))',
            color: 'var(--text-secondary)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          .smm
        </p>
      </div>
    </div>
  )
}
