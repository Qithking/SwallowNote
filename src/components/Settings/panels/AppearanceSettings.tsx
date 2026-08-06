import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import type { Theme, CustomThemeColors, CustomTheme } from '@/stores'
import { GradientEditor } from '../GradientEditor'
const themes: { value: Theme; labelKey: string; emoji: string }[] = [
  { value: 'light', labelKey: 'settings.appearance.theme.light', emoji: '\u2600\uFE0F' },
  { value: 'dark', labelKey: 'settings.appearance.theme.dark', emoji: '\uD83C\uDF19' },
  { value: 'system', labelKey: 'settings.appearance.theme.system', emoji: '\uD83D\uDCBB' },
]

export function AppearanceSettings({
  theme,
  setTheme,
  customThemes,
  activeLightCustomThemeId,
  activeDarkCustomThemeId,
  setActiveCustomThemeId,
  addCustomTheme,
  deleteCustomTheme,
  renameCustomTheme,
  updateCustomThemeColor,
}: {
  theme: Theme
  setTheme: (v: Theme) => void
  customThemes: CustomTheme[]
  activeLightCustomThemeId: string | null
  activeDarkCustomThemeId: string | null
  setActiveCustomThemeId: (type: 'light' | 'dark', id: string) => void
  addCustomTheme: (name: string, type: 'light' | 'dark') => void
  deleteCustomTheme: (id: string) => void
  renameCustomTheme: (id: string, name: string) => void
  updateCustomThemeColor: (id: string, type: 'light' | 'dark', key: keyof CustomThemeColors, value: string) => void
}) {
  const { t } = useTranslation()
  const [customThemeTab, setCustomThemeTab] = useState<'light' | 'dark'>('light')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const activeCustomThemeId = customThemeTab === 'light' ? activeLightCustomThemeId : activeDarkCustomThemeId
  return (
    <>
      <section id="section-appearance" className="space-y-4">
        <h2 className="text-base font-semibold">{t('settings.appearance')}</h2>
        <Card>
          <CardContent className="p-0">
            <div className="py-3 px-4 border-b border-border">
              <div className="flex items-start justify-between">
                <div className="mr-4 pt-1">
                  <Label className="text-sm font-medium">{t('settings.appearance.theme')}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('settings.appearance.theme.desc')}</p>
                </div>
                <Tabs value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                  <TabsList>
                    {themes.map((themeOption) => (
                      <TabsTrigger key={themeOption.value} value={themeOption.value} className="gap-1.5">
                        <span>{themeOption.emoji}</span>
                        {t(themeOption.labelKey)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            </div>
            <div className="px-4 py-2 border-b border-border">
              <Tabs value={customThemeTab} onValueChange={(v) => setCustomThemeTab(v as 'light' | 'dark')}>
                <TabsList>
                  <TabsTrigger value="light">{t('settings.appearance.customTheme.lightTab')}</TabsTrigger>
                  <TabsTrigger value="dark">{t('settings.appearance.customTheme.darkTab')}</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex min-h-[280px]">
              <div className="w-44 border-r border-border py-2 px-2 flex flex-col">
                <div className="flex-1 overflow-y-auto space-y-0.5">
                  {customThemes
                    .filter((ct) => ct.themeType === customThemeTab)
                    .map((ct) => (
                    <div
                      key={ct.id}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer group',
                        activeCustomThemeId === ct.id ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                      )}
                      onClick={() => setActiveCustomThemeId(customThemeTab, ct.id)}
                    >
                      <div className={cn(
                        'w-3.5 h-3.5 rounded-full border shrink-0',
                        activeCustomThemeId === ct.id ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                      )} />
                      {renamingId === ct.id ? (
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <input
                            className="flex-1 min-w-0 bg-background border border-border rounded px-1 py-0.5 text-xs"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                renameCustomTheme(ct.id, renameValue)
                                setRenamingId(null)
                              } else if (e.key === 'Escape') {
                                setRenamingId(null)
                              }
                            }}
                            autoFocus
                          />
                          <button onClick={() => { renameCustomTheme(ct.id, renameValue); setRenamingId(null) }}><Check size={12} /></button>
                          <button onClick={() => setRenamingId(null)}><X size={12} /></button>
                        </div>
                      ) : (
                        <span className="truncate flex-1">{ct.name}</span>
                      )}
                      {!ct.isBuiltIn && renamingId !== ct.id && (
                        <div className="hidden group-hover:flex items-center gap-0.5">
                          <button
                            className="p-0.5 hover:text-primary"
                            onClick={(e) => { e.stopPropagation(); setRenamingId(ct.id); setRenameValue(ct.name) }}
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            className="p-0.5 hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(ct.id) }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full justify-start gap-1.5 text-xs"
                  onClick={() => addCustomTheme(t('settings.appearance.customTheme.add'), customThemeTab)}
                >
                  <Plus size={12} />
                  {t('settings.appearance.customTheme.add')}
                </Button>
              </div>
              <div className="flex-1 p-4">
                {(() => {
                  const activeTheme = customThemes.find((ct) => ct.id === activeCustomThemeId)
                  if (!activeTheme) return <div className="text-sm text-muted-foreground">{t('settings.appearance.customTheme.comingSoon')}</div>
                  const colors = customThemeTab === 'light' ? activeTheme.light : activeTheme.dark
                  const colorFields: { key: keyof CustomThemeColors; labelKey: string; descKey: string; gradientKey?: keyof CustomThemeColors; gradientLabelKey?: string }[] = [
                    { key: 'themeColor', labelKey: 'settings.appearance.customTheme.themeColor', descKey: 'settings.appearance.customTheme.themeColor.desc' },
                    { key: 'textColor', labelKey: 'settings.appearance.customTheme.textColor', descKey: 'settings.appearance.customTheme.textColor.desc' },
                    { key: 'borderColor', labelKey: 'settings.appearance.customTheme.borderColor', descKey: 'settings.appearance.customTheme.borderColor.desc' },
                    { key: 'tooltipColor', labelKey: 'settings.appearance.customTheme.tooltipColor', descKey: 'settings.appearance.customTheme.tooltipColor.desc' },
                    { key: 'appBg', labelKey: 'settings.appearance.customTheme.appBg', descKey: 'settings.appearance.customTheme.appBg.desc', gradientKey: 'appBgGradient', gradientLabelKey: 'settings.appearance.customTheme.appBgGradient' },
                    { key: 'contentBg', labelKey: 'settings.appearance.customTheme.contentBg', descKey: 'settings.appearance.customTheme.contentBg.desc', gradientKey: 'contentBgGradient', gradientLabelKey: 'settings.appearance.customTheme.contentBgGradient' },
                  ]
                  return (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                      {colorFields.map((field) => (
                        <div key={field.key} className={cn(field.gradientKey && 'col-span-2')}>
                          <div className="flex items-center justify-between">
                            <div className="mr-2 min-w-0">
                              <Label className="text-xs font-medium">{t(field.labelKey)}</Label>
                              <p className="text-[10px] text-muted-foreground leading-tight">{t(field.descKey)}</p>
                            </div>
                            <input
                              type="color"
                              value={colors[field.key]}
                              onChange={(e) => updateCustomThemeColor(activeTheme.id, customThemeTab, field.key, e.target.value)}
                              disabled={activeTheme.isBuiltIn}
                              className={cn(
                                'w-7 h-7 rounded cursor-pointer border border-border bg-background shrink-0',
                                activeTheme.isBuiltIn && 'opacity-50 cursor-not-allowed'
                              )}
                            />
                          </div>
                          {field.gradientKey && field.gradientLabelKey && (
                            <div className="mt-1.5 space-y-1">
                              <div className="flex items-center gap-2">
                                <Label className="text-[10px] text-muted-foreground shrink-0">{t(field.gradientLabelKey)}</Label>
                                {!activeTheme.isBuiltIn && colors[field.gradientKey] && (
                                  <button
                                    className="text-[10px] text-muted-foreground hover:text-destructive"
                                    onClick={() => updateCustomThemeColor(activeTheme.id, customThemeTab, field.gradientKey!, '')}
                                  >
                                    {t('common.clear')}
                                  </button>
                                )}
                              </div>
                              {colors[field.gradientKey] ? (
                                <GradientEditor
                                  value={colors[field.gradientKey]!}
                                  onChange={(v) => updateCustomThemeColor(activeTheme.id, customThemeTab, field.gradientKey!, v)}
                                  disabled={activeTheme.isBuiltIn}
                                />
                              ) : (
                                !activeTheme.isBuiltIn && (
                                  <button
                                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                                    onClick={() => updateCustomThemeColor(activeTheme.id, customThemeTab, field.gradientKey!, `linear-gradient(135deg, ${colors[field.key]} 0%, ${colors[field.key]} 100%)`)}
                                  >
                                    <Plus size={10} />
                                    设置渐变
                                  </button>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.appearance.customTheme.delete')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.appearance.customTheme.deleteConfirm', { name: customThemes.find((ct) => ct.id === deleteTarget)?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deleteTarget) deleteCustomTheme(deleteTarget)
              setDeleteTarget(null)
            }}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
