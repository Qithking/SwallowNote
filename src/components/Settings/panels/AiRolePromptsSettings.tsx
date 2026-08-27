import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { useAiRolePrompts } from '@/hooks/useAiRolePrompts'

export function AiRolePromptsSettings() {
  const { t } = useTranslation()
  const {
    rolePrompts,
    selectedRoleKey,
    selectedRolePrompt,
    setSelectedRoleKey,
    addRole,
    deleteRole,
    updatePrompt,
    renameRole,
    resetRole,
    resetAllRoles,
    setPromptText,
  } = useAiRolePrompts()

  const [editingRoleName, setEditingRoleName] = useState<string | null>(null)
  const [editingRoleNameValue, setEditingRoleNameValue] = useState('')
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<string | null>(null)
  const [addingRole, setAddingRole] = useState(false)
  const [newRoleKey, setNewRoleKey] = useState('')
  const [newRoleName, setNewRoleName] = useState('')

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">{t('settings.ai.rolePrompts')}</Label>
              <p className="text-[10px] text-muted-foreground leading-tight">{t('settings.ai.rolePrompts.desc')}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={async () => {
                try {
                  await resetAllRoles()
                  toast.success(t('settings.ai.rolePrompts.resetAllSuccess'))
                } catch (e) {
                  toast.error(t('settings.ai.rolePrompts.resetAllFailed') + ': ' + String(e))
                }
              }}
            >
              {t('settings.ai.rolePrompts.resetAll')}
            </Button>
          </div>
          <div className="flex min-h-[280px]">
            {/* Left: role list */}
            <div className="w-44 border-r border-border py-2 px-2 flex flex-col">
              <div className="flex-1 overflow-y-auto space-y-0.5">
                {rolePrompts.map((rp) => (
                  <div
                    key={rp.role_key}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer group',
                      selectedRoleKey === rp.role_key ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                    )}
                    onClick={() => setSelectedRoleKey(rp.role_key)}
                  >
                    {editingRoleName === rp.role_key ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input
                          className="flex-1 min-w-0 bg-background border border-border rounded px-1 py-0.5 text-xs"
                          value={editingRoleNameValue}
                          onChange={(e) => setEditingRoleNameValue(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              try {
                                await renameRole(rp.role_key, editingRoleNameValue)
                                setEditingRoleName(null)
                              } catch (err) {
                                toast.error(String(err))
                              }
                            } else if (e.key === 'Escape') {
                              setEditingRoleName(null)
                            }
                          }}
                          autoFocus
                        />
                        <button onClick={async () => {
                          try {
                            await renameRole(rp.role_key, editingRoleNameValue)
                            setEditingRoleName(null)
                          } catch (err) {
                            toast.error(String(err))
                          }
                        }}><Check size={12} /></button>
                        <button onClick={() => setEditingRoleName(null)}><X size={12} /></button>
                      </div>
                    ) : (
                      <span className="truncate flex-1">{rp.name}</span>
                    )}
                    {rp.role_key !== 'chat' && editingRoleName !== rp.role_key && (
                      <div className="hidden group-hover:flex items-center gap-0.5">
                        <button
                          className="p-0.5 hover:text-primary"
                          onClick={(e) => { e.stopPropagation(); setEditingRoleName(rp.role_key); setEditingRoleNameValue(rp.name) }}
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          className="p-0.5 hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteRoleTarget(rp.role_key) }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add new role */}
              {addingRole ? (
                <div className="mt-2 space-y-1.5 px-1">
                  <Input
                    className="h-6 text-xs"
                    placeholder={t('settings.ai.rolePrompts.keyPlaceholder')}
                    value={newRoleKey}
                    onChange={(e) => setNewRoleKey(e.target.value)}
                  />
                  <Input
                    className="h-6 text-xs"
                    placeholder={t('settings.ai.rolePrompts.namePlaceholder')}
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      className="h-6 text-[10px] px-2"
                      disabled={!newRoleKey.trim() || !newRoleName.trim()}
                      onClick={async () => {
                        try {
                          await addRole(newRoleKey.trim(), newRoleName.trim())
                          setAddingRole(false)
                          setNewRoleKey('')
                          setNewRoleName('')
                        } catch (e) {
                          toast.error(t('settings.ai.rolePrompts.addFailed') + ': ' + String(e))
                        }
                      }}
                    >
                      <Check size={10} className="mr-0.5" />
                      {t('common.ok')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2"
                      onClick={() => { setAddingRole(false); setNewRoleKey(''); setNewRoleName('') }}
                    >
                      <X size={10} />
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full justify-start gap-1.5 text-xs"
                  onClick={() => setAddingRole(true)}
                >
                  <Plus size={12} />
                  {t('settings.ai.rolePrompts.add')}
                </Button>
              )}
            </div>

            {/* Right: prompt editor */}
            <div className="flex-1 p-4">
              {selectedRolePrompt ? (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium">{t('settings.ai.rolePrompts.roleName')}</Label>
                    <p className="text-[10px] text-muted-foreground">{selectedRolePrompt.is_builtin ? t('settings.ai.rolePrompts.roleName.builtin') : t('settings.ai.rolePrompts.roleName.custom')}</p>
                    <p className="text-sm mt-1">{selectedRolePrompt.name}</p>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">{t('settings.ai.rolePrompts.roleKey')}</Label>
                    <p className="text-[10px] text-muted-foreground">{t('settings.ai.rolePrompts.roleKey.desc')}</p>
                    <p className="text-sm mt-1 font-mono text-muted-foreground">{selectedRolePrompt.role_key}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-medium">{t('settings.ai.rolePrompts.promptContent')}</Label>
                      <p className="text-[10px] text-muted-foreground">{t('settings.ai.rolePrompts.promptContent.desc')}</p>
                    </div>
                    {selectedRolePrompt.is_builtin && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={async () => {
                          try {
                            await resetRole(selectedRolePrompt.role_key)
                            toast.success(t('settings.ai.rolePrompts.resetSuccess'))
                          } catch (e) {
                            toast.error(t('settings.ai.rolePrompts.resetFailed') + ': ' + String(e))
                          }
                        }}
                      >
                        {t('settings.ai.rolePrompts.reset')}
                      </Button>
                    )}
                  </div>
                  <Textarea
                    className="min-h-[120px] text-xs"
                    placeholder={t('settings.ai.rolePrompts.promptContent.placeholder')}
                    value={selectedRolePrompt.prompt}
                    onChange={(e) => setPromptText(selectedRolePrompt.role_key, e.target.value)}
                    onBlur={async () => {
                      try {
                        await updatePrompt(selectedRolePrompt.role_key, selectedRolePrompt.prompt)
                      } catch (e) {
                        toast.error(t('settings.ai.rolePrompts.saveFailed') + ': ' + String(e))
                      }
                    }}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t('settings.ai.rolePrompts.selectRole')}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteRoleTarget} onOpenChange={(open) => { if (!open) setDeleteRoleTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.ai.rolePrompts.delete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.ai.rolePrompts.deleteConfirm', { name: rolePrompts.find((p) => p.role_key === deleteRoleTarget)?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteRoleTarget(null)}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (deleteRoleTarget) {
                try {
                  await deleteRole(deleteRoleTarget)
                } catch (e) {
                  toast.error(t('settings.ai.rolePrompts.deleteFailed') + ': ' + String(e))
                }
              }
              setDeleteRoleTarget(null)
            }}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
