/**
 * Editor Context Menu Component
 * Provides AI actions (continue writing, polish, correct, outline, summary, format)
 * when right-clicking in the editor. Shows different menu items based on
 * whether text is selected.
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useUIStore, type AiContextMenuRequest } from '@/stores'
import { useEditorStore } from '@/stores'
import { useWorkspaceStore } from '@/stores'
import {
  PenLine,
  Sparkles,
  AlertCircle,
  List,
  FileText,
  AlignLeft,
} from 'lucide-react'

/** AI action items excluding "chat" which is only for the AI panel */
const AI_ACTION_ROLES = [
  { key: 'continue_writing', icon: PenLine },
  { key: 'polish', icon: Sparkles },
  { key: 'correct', icon: AlertCircle },
  { key: 'outline', icon: List },
  { key: 'summary', icon: FileText },
  { key: 'format', icon: AlignLeft },
] as const

interface EditorContextMenuProps {
  children: React.ReactNode
  /** Get the currently selected text; return empty string if nothing selected */
  getSelectedText: () => string
  /** Get the line range of the selection: [startLine, endLine] (1-based) */
  getSelectionLineRange?: () => [number, number] | null
  /** Get the full file content (may be async for BlockNote) */
  getFullContent: () => string | Promise<string>
}

export function EditorContextMenu({
  children,
  getSelectedText,
  getSelectionLineRange,
  getFullContent,
}: EditorContextMenuProps) {
  const { t } = useTranslation()
  const setAiContextMenuRequest = useUIStore((s) => s.setAiContextMenuRequest)
  const setRightPanelType = useUIStore((s) => s.setRightPanelType)
  const { tabs, activeTabId } = useEditorStore()
  const { rootPath } = useWorkspaceStore()

  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  const handleAiAction = useCallback(
    async (roleKey: string, roleName: string) => {
      const selectedText = getSelectedText()
      const hasSelection = selectedText.length > 0
      const content = hasSelection ? selectedText : await getFullContent()
      const lineRange = hasSelection ? getSelectionLineRange?.() : undefined

      // Compute relative path from rootPath
      let filePath = activeTab?.path || ''
      if (rootPath && filePath.startsWith(rootPath)) {
        filePath = filePath.slice(rootPath.length)
        // Remove leading slash
        if (filePath.startsWith('/')) {
          filePath = filePath.slice(1)
        }
      }

      const request: AiContextMenuRequest = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        roleKey,
        roleName,
        hasSelection,
        content,
        lineRange: lineRange || undefined,
        filePath,
      }
      // Open the AI panel first so that AIView mounts and can process the request.
      // Without this, if the AI panel is not already open, AIView won't be
      // rendered and its useEffect that handles aiContextMenuRequest won't fire.
      setRightPanelType('ai')
      setAiContextMenuRequest(request)
    },
    [getSelectedText, getSelectionLineRange, getFullContent, activeTab?.path, rootPath, setAiContextMenuRequest, setRightPanelType],
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {AI_ACTION_ROLES.map(({ key, icon: Icon }) => (
          <ContextMenuItem
            key={key}
            onClick={() => handleAiAction(key, t(`ai.role.${key}`))}
          >
            <Icon size={14} />
            <span>{t(`ai.role.${key}`)}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}
