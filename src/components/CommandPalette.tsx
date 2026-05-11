/**
 * CommandPalette Component - Quick command search (Ctrl+P)
 * Adapted to use shadcn/ui Dialog + Command components
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileText,
  FolderOpen,
  Settings,
  Terminal,
  Save,
  RefreshCw,
} from 'lucide-react'
import { useUIStore } from '@/stores'
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

interface CommandItem {
  id: string
  label: string
  icon: typeof FileText
  shortcut?: string
  action: () => void
}

function CommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { commandPaletteVisible, toggleCommandPalette } = useUIStore()

  const commands: CommandItem[] = [
    {
      id: 'open-folder',
      label: 'Open Folder',
      icon: FolderOpen,
      shortcut: 'Ctrl+O',
      action: async () => {
        // Open folder dialog
        toggleCommandPalette()
      },
    },
    {
      id: 'new-file',
      label: 'New File',
      icon: FileText,
      shortcut: 'Ctrl+N',
      action: () => {
        toggleCommandPalette()
      },
    },
    {
      id: 'save',
      label: 'Save',
      icon: Save,
      shortcut: 'Ctrl+S',
      action: () => {
        toggleCommandPalette()
      },
    },
    {
      id: 'refresh',
      label: 'Refresh File Tree',
      icon: RefreshCw,
      action: () => {
        toggleCommandPalette()
      },
    },
    {
      id: 'settings',
      label: 'Open Settings',
      icon: Settings,
      shortcut: 'Ctrl+,',
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
      action: () => {
        toggleCommandPalette()
      },
    },
  ]

  useEffect(() => {
    setOpen(commandPaletteVisible)
  }, [commandPaletteVisible])

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      toggleCommandPalette()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <CommandInput placeholder={t('commandPalette.placeholder')} />
          <CommandList>
            <CommandEmpty>{t('commandPalette.noResults')}</CommandEmpty>
            <CommandGroup heading="Navigation">
              {commands.slice(0, 2).map((cmd) => {
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
              {commands.slice(2, 4).map((cmd) => {
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
              {commands.slice(4).map((cmd) => {
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
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export { CommandPalette }
