/**
 * Editor Context Menu Component
 * Host shell for the editor right-click menu. Built-in AI actions were
 * removed (AI now lives in the official plugin); this component only
 * renders plugin-contributed items (editor surface).
 */
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useEditorStore } from '@/stores'
import { PluginContextMenuItems } from '@/components/Plugin/PluginContextMenuItems'

interface EditorContextMenuProps {
  children: React.ReactNode
  /** Get the currently selected text; return empty string if nothing selected */
  getSelectedText: () => string
}

export function EditorContextMenu({ children, getSelectedText }: EditorContextMenuProps) {
  const activeTabPath = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '')

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {/* Plugin-contributed items (editor surface). The host owns
            the selection state, so we resolve the current selection
            and active tab path on each render and pass them in. The
            helper re-evaluates `when` predicates whenever the
            relevant context fields change. */}
        <PluginContextMenuItems
          location="editor"
          ctx={{
            path: activeTabPath || undefined,
            activePath: activeTabPath || undefined,
            selection: getSelectedText() || undefined,
          }}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}
