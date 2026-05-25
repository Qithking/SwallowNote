/**
 * Editor Component - Main editor area
 * Shows the content of the active tab with appropriate editor
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditorStore, useUIStore, useWorkspaceStore } from '@/stores'
import { detectFileType } from '@/lib/utils/fileTypeUtils'
import { MarkdownEditor } from './editors/MarkdownEditor'
import { CodeEditor } from './editors/CodeEditor'
import DiffViewer from './DiffViewer/DiffViewer'
import { FileCode, FolderOpen, FileText, Clock, GitFork, ArrowRight, Layers } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from 'react-i18next'
import { openFolderDialog, openFileDialog, getFolderHistory } from '@/lib/tauri'
import { formatShortcutForDisplay, getShortcutKey } from '@/lib/shortcuts'
import appIconUrl from '@/assets/app-icon.png'

interface UnsupportedEditorProps {
  filename: string
  reason: string
}

function UnsupportedEditor({ filename, reason }: UnsupportedEditorProps) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary-gradient,var(--bg-primary))]">
      <div className="text-center">
        <FileCode size={48} className="mx-auto mb-4 opacity-40" />
        <p className="text-lg text-[var(--text-muted)]">{t('editor.cannotOpen')}</p>
        <p className="text-sm text-[var(--text-muted)] mt-2">{filename}</p>
        <p className="text-xs text-[var(--text-muted)] mt-1 opacity-60">{reason}</p>
      </div>
    </div>
  )
}

function WelcomeActionItem({
  icon: Icon,
  label,
  shortcut,
  description,
  onClick,
}: {
  icon: React.ElementType
  label: string
  shortcut?: string
  description?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 w-full px-4 py-2.5 rounded-md text-left transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
      style={{ color: 'var(--text-primary)' }}
    >
      <Icon size={18} className="shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--theme-color)' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{label}</span>
          {shortcut && (
            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-mono"
              style={{
                background: 'var(--bg-hover)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-color)'
              }}
            >
              {shortcut}
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{description}</p>
        )}
      </div>
      <ArrowRight size={14} className="shrink-0 opacity-0 group-hover:opacity-40 transition-opacity" />
    </button>
  )
}

function RecentFileItem({ path, onClick }: { path: string; onClick: () => void }) {
  const isWorkspace = path.endsWith('.swallow-workspace')
  const name = isWorkspace
    ? (path.split('/').pop() || path).replace('.swallow-workspace', '')
    : (path.split('/').pop() || path)
  const dir = path.substring(0, path.lastIndexOf('/'))
  const dirName = dir.split('/').pop() || dir

  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-2 w-full px-4 py-1.5 rounded-sm text-left transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
      style={{ color: 'var(--text-primary)' }}
    >
      {isWorkspace ? (
        <Layers size={13} className="shrink-0" style={{ color: 'var(--theme-color)' }} />
      ) : (
        <FolderOpen size={13} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
      )}
      <span className="text-[13px] flex-1 truncate">{name}</span>
      <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{dirName}</span>
    </button>
  )
}

function WelcomeScreen() {
  const { t } = useTranslation()
  const { customShortcuts, workspaceMode } = useUIStore()
  const [recentPaths, setRecentPaths] = useState<string[]>([])

  // Use the imported app icon URL (Vite static asset)
  const appIconSrc = appIconUrl

  const getShortcut = useCallback((key: string) => {
    const sc = getShortcutKey(key as any, customShortcuts)
    return formatShortcutForDisplay(sc)
  }, [customShortcuts])

  // Load recent folder history on mount
  useEffect(() => {
    getFolderHistory().then((paths) => setRecentPaths(paths)).catch(() => {})
  }, [])

  const handleOpenFolder = useCallback(async () => {
    try {
      if (workspaceMode === 'workspace') {
        const { openWorkspaceDialog } = await import('@/lib/tauri')
        const path = await openWorkspaceDialog()
        if (path) {
          await useWorkspaceStore.getState().loadWorkspaceFile(path)
        }
      } else {
        const path = await openFolderDialog()
        if (path) {
          await useWorkspaceStore.getState().openFolder(path)
        }
      }
    } catch (e) {
      console.error('Failed to open:', e)
    }
  }, [workspaceMode])

  const handleOpenFile = useCallback(async () => {
    try {
      const path = await openFileDialog()
      if (!path) return
      // Open file as a tab
      const name = path.split('/').pop() || 'untitled.md'
      const id = `file-${Date.now()}`
      useEditorStore.getState().addTab({
        id,
        path,
        name,
        content: '',
        isDirty: false,
        isEdited: false,
        viewMode: 'preview',
      })
      useEditorStore.getState().loadTabContent(id)
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }, [])

  const handleOpenRecent = useCallback(async (path: string) => {
    try {
      const isWorkspace = path.endsWith('.swallow-workspace')
      const { switchMode } = useWorkspaceStore.getState()
      if (isWorkspace) {
        // Switch to workspace mode first if needed, then load the workspace file
        if (workspaceMode !== 'workspace') {
          await switchMode('workspace')
        }
        await useWorkspaceStore.getState().loadWorkspaceFile(path)
      } else {
        // Switch to folder mode first if needed, then open the folder
        if (workspaceMode !== 'folder') {
          await switchMode('folder')
        }
        await useWorkspaceStore.getState().openFolder(path)
      }
    } catch (e) {
      console.error('Failed to open recent:', e)
    }
  }, [workspaceMode])

  const handleCloneRepo = useCallback(() => {
    // Dispatch event to open the clone dialog (handled by TitleBarRecentPopover)
    window.dispatchEvent(new CustomEvent('open-clone-dialog'))
  }, [])

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[720px] mx-auto px-8 py-10 flex flex-col items-center">
        {/* Logo / Title */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 overflow-hidden" style={{
            background: 'var(--bg-primary-gradient, var(--bg-primary))',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)'
          }}>
            <img src={appIconSrc} alt="SwallowNote" className="w-full h-full object-contain" draggable={false} />
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('editor.welcome')}
          </h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--text-muted)' }}>
            {t('editor.welcomeHint')}
          </p>
        </div>

        {/* Action Cards */}
        <div className="w-full grid grid-cols-2 gap-3 mb-6 max-w-[600px]">
          {/* Start Card */}
          <div className="rounded-lg p-4 space-y-1" style={{
            background: 'var(--bg-primary-gradient, var(--bg-primary))',
            border: '1px solid var(--border-color)'
          }}>
            <p className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-muted)' }}>
              {t('welcome.start')}
            </p>
            <WelcomeActionItem
              icon={FileText}
              label={t('welcome.openFile')}
              shortcut={getShortcut('openFile')}
              onClick={handleOpenFile}
            />
            <WelcomeActionItem
              icon={FolderOpen}
              label={t('welcome.openFolder')}
              shortcut={getShortcut('openFile')}
              onClick={handleOpenFolder}
            />
            <WelcomeActionItem
              icon={GitFork}
              label={t('welcome.cloneRepo')}
              onClick={handleCloneRepo}
            />
          </div>

          {/* Recent Card */}
          <div className="rounded-lg p-4" style={{
            background: 'var(--bg-primary-gradient, var(--bg-primary))',
            border: '1px solid var(--border-color)'
          }}>
            <p className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-muted)' }}>
              {t('welcome.recent')}
            </p>
            {recentPaths.length > 0 ? (
              <div className="space-y-0.5 max-h-[180px] overflow-y-auto">
                {recentPaths.slice(0, 8).map((path) => (
                  <RecentFileItem
                    key={path}
                    path={path}
                    onClick={() => handleOpenRecent(path)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-4 text-center">
                <Clock size={20} className="mx-auto mb-2 opacity-30" style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('welcome.noRecent')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Keyboard Shortcuts Hint */}
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          <span><kbd className="font-mono px-1 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>⌘P</kbd> {t('welcome.quickOpen')}</span>
          <span><kbd className="font-mono px-1 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>⌘N</kbd> {t('welcome.newFile')}</span>
          <span><kbd className="font-mono px-1 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>⌘S</kbd> {t('welcome.save')}</span>
          <span><kbd className="font-mono px-1 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>⌘,</kbd> {t('welcome.settings')}</span>
        </div>
      </div>
    </div>
  )
}

export function EditorView() {
  const { tabs, activeTabId, updateTabContent, scrollToLine } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const scrollToLineRef = useRef(scrollToLine)
  const { t } = useTranslation()

  // Listen for scroll-to-line events
  useEffect(() => {
    const handler = (e: Event) => {
      const line = (e as CustomEvent).detail.line
      scrollToLineRef.current?.(line)
    }
    window.addEventListener('scroll-to-line', handler)
    return () => window.removeEventListener('scroll-to-line', handler)
  }, [])

  if (!activeTab) {
    return <WelcomeScreen />
  }

  // Handle diff tab
  if (activeTab.type === 'diff') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <DiffViewer diffContent={activeTab.diffContent || ''} />
      </div>
    )
  }

  const fileType = detectFileType(activeTab.name, activeTab.content)
  const viewMode = activeTab.viewMode

  const handleContentChange = (content: string) => {
    updateTabContent(activeTab.id, content)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {activeTab.isLoading && (
        <div className="absolute top-0 left-0 right-0 z-10">
          <Progress />
        </div>
      )}

      {fileType === 'markdown' && (
        <div className="flex-1 overflow-hidden">
          {viewMode === 'source' ? (
            <CodeEditor
              content={activeTab.content}
              filename={activeTab.name}
              onChange={handleContentChange}
              className="flex-1"
            />
          ) : (
            <MarkdownEditor
              key={activeTab.id}
              content={activeTab.content}
              onChange={handleContentChange}
            />
          )}
        </div>
      )}

      {fileType === 'code' && (
        <div className="flex-1 flex overflow-hidden">
          <CodeEditor
            content={activeTab.content}
            filename={activeTab.name}
            onChange={handleContentChange}
            className="flex-1"
          />
        </div>
      )}

      {fileType === 'binary' && (
        <UnsupportedEditor
          filename={activeTab.name}
          reason={t('editor.binaryFile')}
        />
      )}
    </div>
  )
}
