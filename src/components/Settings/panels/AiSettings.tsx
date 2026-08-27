import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import type { AiProviderCategory, AiModelConfig } from '@/lib/ai'
import { SettingRow } from '../SettingRow'
import { AiModelForm } from './AiModelForm'
import { AiRolePromptsSettings } from './AiRolePromptsSettings'

export function AiSettings({
  aiPort,
  setAiPort,
  aiModels,
  activeAiModelId,
  defaultAiModelId,
  addAiModel,
  removeAiModel,
  setActiveAiModel,
  setDefaultAiModel,
  updateAiModelApiKey,
}: {
  aiPort: number
  setAiPort: (v: number) => void
  aiModels: AiModelConfig[]
  activeAiModelId: string
  defaultAiModelId: string
  addAiModel: (model: Omit<AiModelConfig, 'id'>) => void
  removeAiModel: (id: string) => void
  setActiveAiModel: (id: string) => void
  setDefaultAiModel: (id: string) => void
  updateAiModelApiKey: (id: string, key: string) => void
}) {
  const { t } = useTranslation()
  const [aiCategoryTab, setAiCategoryTab] = useState<AiProviderCategory>('local')
  const [deleteAiModelTarget, setDeleteAiModelTarget] = useState<string | null>(null)

  return (
    <>
      <section id="section-ai" className="space-y-4">
        <h2 className="text-base font-semibold">{t('settings.ai')}</h2>

        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-border">
              <SettingRow label={t('settings.ai.defaultModel')} desc={t('settings.ai.defaultModel.desc')}>
                <Select value={defaultAiModelId} onValueChange={(v) => setDefaultAiModel(v)}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder={t('settings.ai.defaultModel.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {aiModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}{model.isBuiltIn ? ` · ${t('ai.builtIn')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            </div>

            <div className="px-4 pt-4 pb-2">
              <Tabs value={aiCategoryTab} onValueChange={(v) => {
                setAiCategoryTab(v as AiProviderCategory)
              }}>
                <TabsList className="w-full">
                  <TabsTrigger value="local" className="flex-1">{t('settings.ai.category.local')}</TabsTrigger>
                  <TabsTrigger value="api" className="flex-1">{t('settings.ai.category.api')}</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex min-h-[200px]">
              <div className="w-44 border-r border-border py-2 px-2 flex flex-col">
                <div className="flex-1 overflow-y-auto space-y-0.5">
                  {aiModels.filter((m) => m.category === aiCategoryTab).length === 0 && (
                    <p className="text-xs text-muted-foreground py-4 text-center">{t('settings.ai.noModels')}</p>
                  )}
                  {aiModels
                    .filter((m) => m.category === aiCategoryTab)
                    .map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          'flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer group',
                          m.id === activeAiModelId ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                        )}
                        onClick={() => setActiveAiModel(m.id)}
                      >
                        <span className="truncate flex-1">{m.name || m.model}{m.isBuiltIn ? ` · ${t('ai.builtIn')}` : ''}</span>
                        {!m.isBuiltIn && (
                          <button
                            className="p-0.5 hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteAiModelTarget(m.id)
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              <AiModelForm
                aiCategoryTab={aiCategoryTab}
                aiModels={aiModels}
                activeAiModelId={activeAiModelId}
                aiPort={aiPort}
                addAiModel={addAiModel}
                updateAiModelApiKey={updateAiModelApiKey}
              />
            </div>

            <div className="border-t border-border" />

            <div className="px-4 py-3">
              <SettingRow label={t('settings.ai.port')} desc={t('settings.ai.port.desc')}>
                <Input
                  className="w-[100px]"
                  type="number"
                  min={1024}
                  max={65535}
                  value={aiPort}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10)
                    if (!isNaN(val) && val >= 1024 && val <= 65535) {
                      setAiPort(val)
                    }
                  }}
                />
              </SettingRow>
            </div>
          </CardContent>
        </Card>

        <AiRolePromptsSettings />
      </section>

      <AlertDialog open={!!deleteAiModelTarget} onOpenChange={(open) => { if (!open) setDeleteAiModelTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.ai.deleteModel')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.ai.deleteModelConfirm', { name: aiModels.find((m) => m.id === deleteAiModelTarget)?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteAiModelTarget(null)}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deleteAiModelTarget) removeAiModel(deleteAiModelTarget)
              setDeleteAiModelTarget(null)
            }}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
