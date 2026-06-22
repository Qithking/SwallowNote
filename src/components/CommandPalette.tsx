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
  Terminal,
  Save,
  RefreshCw,
  Zap,
  Puzzle,
} from 'lucide-react'
import { useUIStore } from '@/stores'
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
import { formatShortcutForDisplay } from '@/lib/shortcuts'
import type { PluginCommand } from '@/types/plugin'

interface CommandItem {
  id: string
  label: string
  icon: typeof FileText
  shortcut?: string
  group: 'navigation' | 'edit' | 'view' | 'plugin'
  action: () => void
}

function pluginIconFor(command: PluginCommand): typeof Zap {
  // We don't bundle every lucide icon by name; fall back to a
  // generic "zap" glyph when the plugin asked for an icon the
  // host doesn't recognise. The iconName field is a hint, not a
  // contract — a future iteration can add a real name→component
  // map if the UX warrants it.
  void command.iconName
  return Zap
}

function CommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { commandPaletteVisible, toggleCommandPalette, pluginCommandShortcuts } = useUIStore()
  const pluginCommands = usePluginCommands()

  // Lookup plugin id by command id so we can show the bound
  // shortcut. The list snapshot from `usePluginCommands` already
  // filters by `when()`, so we just need to project the
  // `<pluginId>:<commandId>` key.
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
            // eslint-disable-next-line no-console
            console.error('[command-palette] plugin command threw:', err)
          }
        },
      }
    })
  }, [pluginCommands, pluginCommandShortcuts])

  const commands: CommandItem[] = useMemo(() => {
    const builtIn: CommandItem[] = [
      {
        id: 'open-folder',
        label: 'Open Folder',
        icon: FolderOpen,
        shortcut: 'Ctrl+O',
        group: 'navigation',
        action: async () => {
          toggleCommandPalette()
        },
      },
      {
        id: 'new-file',
        label: 'New File',
        icon: FileText,
        shortcut: 'Ctrl+N',
        group: 'navigation',
        action: () => {
          toggleCommandPalette()
        },
      },
      {
        id: 'save',
        label: 'Save',
        icon: Save,
        shortcut: 'Ctrl+S',
        group: 'edit',
        action: () => {
          toggleCommandPalette()
        },
      },
      {
        id: 'refresh',
        label: 'Refresh File Tree',
        icon: RefreshCw,
        group: 'edit',
        action: () => {
          toggleCommandPalette()
        },
      },
      {
        id: 'settings',
        label: 'Open Settings',
        icon: Settings,
        shortcut: 'Ctrl+,',
        group: 'view',
        action: () => {
          useUIStore.getState().setSidebarView('settings')
          toggleCommandPalette()
        },
      },
      {
        id: 'terminal',
        label: 'Open Terminal',
        icon: Terminal,
        shortcut: 'Ctrl+`',
        group: 'view',
        action: () => {
          toggleCommandPalette()
        },
      },
    ]
    return [...builtIn, ...pluginCommandItems]
  }, [pluginCommandItems, toggleCommandPalette])

  useEffect(() => {
    setOpen(commandPaletteVisible)
  }, [commandPaletteVisible])

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      toggleCommandPalette()
    }
  }

  // Group helpers. We render one CommandGroup per category so
  // plugins that share a category cluster together; built-ins
  // keep their original Navigation/Edit/View layout.
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
