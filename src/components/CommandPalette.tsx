/**
 * CommandPalette Component - Quick command search (Ctrl+P)
 * Adapted to use shadcn/ui Dialog + Command components
 *
 * Task 9 / G9: also surfaces every command contributed by an
 * installed plugin (via `usePluginCommands()`). Each plugin entry
 * shows its user-configured shortcut (if any) and is dispatchable
 * the same way as a built-in command. Plugin commands that opted
 * out via `when()` are hidden automatically by the hook.
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileText,
  FolderOpen,
  Settings,
  Save,
  RefreshCw,
  Zap,
  Puzzle,
  Trash2,
  Edit3,
  Copy,
  Scissors,
  ClipboardPaste,
  Download,
  Upload,
  Search,
  Eye,
  Code,
  Terminal,
  Play,
  Square,
  Pause,
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
import { useUIStore } from '@/stores'
import { useShallow } from 'zustand/react/shallow'
import { usePluginCommands } from '@/lib/plugin-hooks'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { formatShortcutForDisplay, getShortcutKey } from '@/lib/shortcuts'
import type { PluginCommand } from '@/types/plugin'
import {
  handleNewFile,
  handleOpenFile,
  handleSaveFile,
  handleToggleSettings,
  handleRefreshFileTree,
} from '@/hooks/useKeyboardShortcuts'
import { logger } from '@/lib/logger'

interface CommandItem {
  id: string
  label: string
  icon: typeof FileText
  shortcut?: string
  group: 'navigation' | 'edit' | 'view' | 'plugin'
  action: () => void
}

/** 插件 iconName → lucide 图标的映射表。
 *  与 PluginContextMenuItems 的 ICON_MAP 保持一致，
 *  缺失时回退到 Zap（命令面板默认图标）。 */
const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
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

function pluginIconFor(command: PluginCommand): typeof Zap {
  // 通过映射表解析插件声明的 iconName，未命中时回退到 Zap
  return PLUGIN_ICON_MAP[command.iconName ?? ''] ?? Zap
}

function CommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // useShallow 选择性订阅，避免全量订阅 useUIStore 导致的重渲染
  const { commandPaletteVisible, toggleCommandPalette, pluginCommandShortcuts, customShortcuts } = useUIStore(
    useShallow((s) => ({
      commandPaletteVisible: s.commandPaletteVisible,
      toggleCommandPalette: s.toggleCommandPalette,
      pluginCommandShortcuts: s.pluginCommandShortcuts,
      customShortcuts: s.customShortcuts,
    })),
  )
  const pluginCommands = usePluginCommands()

  // 通过 command id 查找 plugin id 以显示绑定快捷键
  const pluginCommandItems = useMemo<CommandItem[]>(() => {
    return pluginCommands.map((cmd) => {
      const pluginCmd = cmd as PluginCommand & { __pluginId: string }
      const bindingKey = `${pluginCmd.__pluginId}:${cmd.id}`
      const bound = pluginCommandShortcuts[bindingKey]
      return {
        id: `plugin:${pluginCmd.__pluginId}:${cmd.id}`,
        label: cmd.label,
        icon: pluginIconFor(cmd),
        shortcut: bound ? formatShortcutForDisplay(bound) : undefined,
        group: 'plugin' as const,
        action: () => {
          try {
            void cmd.onTrigger()
          } catch (err) {
            // Don't let a buggy plugin's onTrigger take down the
            // palette. Log and swallow so the host keeps
            // working. The plugin author sees the error in the
            // diagnostics popup via plugin-telemetry.
            logger.error('command-palette', 'plugin command threw:', err)
          }
        },
      }
    })
  }, [pluginCommands, pluginCommandShortcuts])

  const commands: CommandItem[] = useMemo(() => {
    const sk = (k: Parameters<typeof getShortcutKey>[0]) =>
      formatShortcutForDisplay(getShortcutKey(k, customShortcuts))
    const builtIn: CommandItem[] = [
      {
        id: 'open-folder',
        label: 'Open Folder',
        icon: FolderOpen,
        shortcut: sk('openFile'),
        group: 'navigation',
        action: () => {
          toggleCommandPalette()
          void handleOpenFile()
        },
      },
      {
        id: 'new-file',
        label: 'New File',
        icon: FileText,
        shortcut: sk('newFile'),
        group: 'navigation',
        action: () => {
          toggleCommandPalette()
          void handleNewFile()
        },
      },
      {
        id: 'save',
        label: 'Save',
        icon: Save,
        shortcut: sk('saveFile'),
        group: 'edit',
        action: () => {
          toggleCommandPalette()
          void handleSaveFile()
        },
      },
      {
        id: 'refresh',
        label: 'Refresh File Tree',
        icon: RefreshCw,
        group: 'edit',
        action: () => {
          toggleCommandPalette()
          void handleRefreshFileTree()
        },
      },
      {
        id: 'settings',
        label: 'Open Settings',
        icon: Settings,
        shortcut: sk('settings'),
        group: 'view',
        action: () => {
          toggleCommandPalette()
          handleToggleSettings()
        },
      },
    ]
    return [...builtIn, ...pluginCommandItems]
  }, [pluginCommandItems, toggleCommandPalette, customShortcuts])

  useEffect(() => {
    setOpen(commandPaletteVisible)
  }, [commandPaletteVisible])

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      toggleCommandPalette()
    }
  }

  // 按分组渲染 CommandGroup，同类插件聚合
  const navigation = commands.filter((c) => c.group === 'navigation')
  const edit = commands.filter((c) => c.group === 'edit')
  const view = commands.filter((c) => c.group === 'view')
  const pluginGroup = commands.filter((c) => c.group === 'plugin')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput placeholder={t('commandPalette.placeholder')} />
          <CommandList>
            <CommandEmpty>{t('commandPalette.noResults')}</CommandEmpty>
            <CommandGroup heading="Navigation">
              {navigation.map((cmd) => {
                const Icon = cmd.icon
                return (
                  <CommandItem
                    key={cmd.id}
                    value={cmd.label}
                    onSelect={() => cmd.action()}
                  >
                    <Icon size={18} className="mr-2" />
                    <span>{cmd.label}</span>
                    {cmd.shortcut && (
                      <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            <CommandGroup heading="Edit">
              {edit.map((cmd) => {
                const Icon = cmd.icon
                return (
                  <CommandItem
                    key={cmd.id}
                    value={cmd.label}
                    onSelect={() => cmd.action()}
                  >
                    <Icon size={18} className="mr-2" />
                    <span>{cmd.label}</span>
                    {cmd.shortcut && (
                      <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            <CommandGroup heading="View">
              {view.map((cmd) => {
                const Icon = cmd.icon
                return (
                  <CommandItem
                    key={cmd.id}
                    value={cmd.label}
                    onSelect={() => cmd.action()}
                  >
                    <Icon size={18} className="mr-2" />
                    <span>{cmd.label}</span>
                    {cmd.shortcut && (
                      <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {pluginGroup.length > 0 && (
              <CommandGroup heading="Plugins">
                {pluginGroup.map((cmd) => {
                  const Icon = cmd.icon
                  return (
                    <CommandItem
                      key={cmd.id}
                      value={cmd.label}
                      onSelect={() => cmd.action()}
                    >
                      <Icon size={18} className="mr-2" />
                      <span>{cmd.label}</span>
                      {cmd.shortcut ? (
                        <CommandShortcut>{cmd.shortcut}</CommandShortcut>
                      ) : (
                        <span className="ml-auto text-[10px] text-muted-foreground inline-flex items-center gap-1">
                          <Puzzle size={11} />
                        </span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export { CommandPalette }
