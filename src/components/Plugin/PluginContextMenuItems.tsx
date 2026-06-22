/**
 * PluginContextMenuItems
 *
 * Drop-in helper that renders plugin-contributed context menu items
 * into an existing `ContextMenuContent`. The component:
 *
 *  1. queries `pluginMenuRegistry` for items targeting the given
 *     location, evaluated against the supplied `ctx`;
 *  2. renders a separator when at least one item is applicable;
 *  3. renders each applicable item as a `ContextMenuItem`.
 *
 * Hosts that own a context menu just embed this near the end of their
 * `ContextMenuContent` and pass the location + resolved context. The
 * helper is a no-op (returns null) when no plugin has registered, so
 * there is no visual cost to wiring it up front.
 *
 * The mapping from `iconName` (string) to a real lucide icon is
 * deliberate: it lets plugin manifests stay serializable (no React
 * component types) and gives the host final say on iconography.
 * Unknown names render with a default `FileText` icon.
 */
import { useMemo } from 'react'
import {
  FileText,
  Settings,
  Trash2,
  Edit3,
  Copy,
  Scissors,
  ClipboardPaste,
  Save,
  Download,
  Upload,
  Search,
  Eye,
  Code,
  Terminal,
  Play,
  Square,
  Pause,
  RefreshCw,
  FolderPlus,
  FilePlus,
  GitBranch,
  GitCommit,
  GitMerge,
  Star,
  Heart,
  Bookmark,
  Link,
  ExternalLink,
  Plus,
  Minus,
  Check,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { getContextMenuItems } from '@/lib/plugin-menu'
import type { ContextMenuContext, ContextMenuItem as PluginContextMenuItem } from '@/types/plugin'

/** Map of icon names a plugin may declare to actual Lucide components.
 *  Keep this list small and curated; new entries are cheap to add but
 *  do grow the bundle, so prefer generic names that cover most plugins. */
const ICON_MAP: Record<string, LucideIcon> = {
  FileText,
  Settings,
  Trash2,
  Edit3,
  Copy,
  Scissors,
  ClipboardPaste,
  Save,
  Download,
  Upload,
  Search,
  Eye,
  Code,
  Terminal,
  Play,
  Square,
  Pause,
  RefreshCw,
  FolderPlus,
  FilePlus,
  GitBranch,
  GitCommit,
  GitMerge,
  Star,
  Heart,
  Bookmark,
  Link,
  ExternalLink,
  Plus,
  Minus,
  Check,
  X,
}

function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return FileText
  return ICON_MAP[name] ?? FileText
}

export interface PluginContextMenuItemsProps {
  /** The location we're rendering. */
  location: ContextMenuContext['location']
  /** Resolved context for `when` evaluation. */
  ctx: Omit<ContextMenuContext, 'location'>
}

export function PluginContextMenuItems({ location, ctx }: PluginContextMenuItemsProps): React.ReactNode {
  // Memoize so that we don't re-query the registry on every parent
  // re-render. We destructure into primitive deps instead of listing
  // `ctx` (which is a fresh object each render); that way the
  // exhaustive-deps lint stays happy without false positives.
  const items = useMemo<PluginContextMenuItem[]>(
    () => getContextMenuItems(location, { ...ctx, location }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location, ctx.path, ctx.isDirectory, ctx.activePath, ctx.selection]
  )

  if (items.length === 0) return null

  return (
    <>
      <ContextMenuSeparator style={{ backgroundColor: 'var(--border-color)' }} />
      {items.map((item) => {
        const Icon = resolveIcon(item.iconName)
        return (
          <ContextMenuItem
            key={item.id}
            onClick={() => {
              // Run the handler and swallow rejections; a misbehaving
              // plugin must not break the host's menu.
              void Promise.resolve(
                item.onClick({ ...ctx, location })
              ).catch((err) => {
                console.error(`[plugin-menu] handler for ${item.id} failed:`, err)
              })
            }}
            style={{ color: 'var(--text-secondary)' }}
            className="cursor-pointer"
          >
            <Icon size={12} />
            <span>{item.label}</span>
          </ContextMenuItem>
        )
      })}
    </>
  )
}
