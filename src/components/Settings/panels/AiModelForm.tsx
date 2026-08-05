import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, RefreshCw, Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { testAiModel, restartAiProxy } from '@/lib/tauri'
import { getProviderById, getProvidersByCategory, type AiProviderCategory, type AiModelConfig } from '@/lib/ai'
import { useUIStore } from '@/stores'

export function AiModelForm({
  aiCategoryTab,
  aiModels,
  activeAiModelId,
  aiPort,
  addAiModel,
  updateAiModelApiKey,
}: {
  aiCategoryTab: AiProviderCategory
  aiModels: AiModelConfig[]
  activeAiModelId: string
  aiPort: number
  addAiModel: (model: Omit<AiModelConfig, 'id'>) => void
  updateAiModelApiKey: (id: string, key: string) => void
}) {
  const { t } = useTranslation()
  const [aiFormProvider, setAiFormProvider] = useState('ollama')
  const [aiFormApiKey, setAiFormApiKey] = useState('')
  const [aiFormBaseUrl, setAiFormBaseUrl] = useState('')
  const [aiFormName, setAiFormName] = useState('')
  const [aiFormModel, setAiFormModel] = useState('')
  const [aiTesting, setAiTesting] = useState(false)

  // Reset provider and base URL when category tab changes
  useEffect(() => {
    setAiFormProvider(aiCategoryTab === 'local' ? 'ollama' : 'custom')
    const provider = getProviderById(aiCategoryTab === 'local' ? 'ollama' : 'custom')
    if (provider?.defaultBaseUrl) setAiFormBaseUrl(provider.defaultBaseUrl)
  }, [aiCategoryTab])

  return (
    <div className="flex-1 p-4">
      <p className="text-xs font-medium text-muted-foreground mb-3">{t('settings.ai.addModel')}</p>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="mr-2 min-w-0">
            <Label className="text-xs font-medium">{t('settings.ai.provider')}</Label>
            <p className="text-[10px] text-muted-foreground leading-tight">{t('settings.ai.provider.desc')}</p>
          </div>
          <Select value={aiFormProvider} onValueChange={(v) => {
            setAiFormProvider(v)
            const provider = getProviderById(v)
            if (provider?.defaultBaseUrl) setAiFormBaseUrl(provider.defaultBaseUrl)
          }}>
            <SelectTrigger className="w-[200px] h-7 text-xs">
              <SelectValue placeholder={t('settings.ai.provider.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {getProvidersByCategory(aiCategoryTab).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {aiFormProvider && getProviderById(aiFormProvider)?.requiresApiKey && (
          <div className="flex items-center justify-between">
            <div className="mr-2 min-w-0">
              <Label className="text-xs font-medium">{t('settings.ai.apiKey')}</Label>
              <p className="text-[10px] text-muted-foreground leading-tight">{t('settings.ai.apiKey.desc')}</p>
            </div>
            <Input
              className="w-[200px] h-7 text-xs"
              type="password"
              placeholder={t('settings.ai.apiKey.placeholder')}
              value={aiFormApiKey}
              onChange={(e) => setAiFormApiKey(e.target.value)}
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="mr-2 min-w-0">
            <Label className="text-xs font-medium">{t('settings.ai.baseUrl')}</Label>
            <p className="text-[10px] text-muted-foreground leading-tight">{t('settings.ai.baseUrl.desc')}</p>
          </div>
          <Input
            className="w-[200px] h-7 text-xs"
            placeholder={aiFormProvider ? (getProviderById(aiFormProvider)?.defaultBaseUrl || '') : ''}
            value={aiFormBaseUrl}
            onChange={(e) => setAiFormBaseUrl(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="mr-2 min-w-0">
            <Label className="text-xs font-medium">{t('settings.ai.modelName')}</Label>
            <p className="text-[10px] text-muted-foreground leading-tight">{t('settings.ai.modelName.desc')}</p>
          </div>
          <Input
            className="w-[200px] h-7 text-xs"
            placeholder={t('settings.ai.modelName.placeholder')}
            value={aiFormName}
            onChange={(e) => setAiFormName(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="mr-2 min-w-0">
            <Label className="text-xs font-medium">{t('settings.ai.modelId')}</Label>
            <p className="text-[10px] text-muted-foreground leading-tight">{t('settings.ai.model.desc')}</p>
          </div>
          <Input
            className="w-[200px] h-7 text-xs"
            placeholder={t('settings.ai.model.placeholder')}
            value={aiFormModel}
            onChange={(e) => setAiFormModel(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            disabled={!aiFormProvider || !aiFormModel}
            onClick={() => {
              addAiModel({
                name: aiFormName || aiFormModel,
                category: aiCategoryTab,
                provider: aiFormProvider,
                apiKey: '',
                baseUrl: aiFormBaseUrl,
                model: aiFormModel,
              })
              if (aiFormApiKey) {
                const models = useUIStore.getState().aiModels
                const lastModel = models[models.length - 1]
                if (lastModel) updateAiModelApiKey(lastModel.id, aiFormApiKey)
              }
              setAiFormProvider('')
              setAiFormApiKey('')
              setAiFormBaseUrl('')
              setAiFormName('')
              setAiFormModel('')
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('settings.ai.add')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!activeAiModelId || aiTesting}
            onClick={async () => {
              setAiTesting(true)
              try {
                const activeModel = aiModels.find((m) => m.id === activeAiModelId)
                if (!activeModel) return
                const apiKey = activeModel._decryptedApiKey || ''
                await restartAiProxy(activeModel.provider, apiKey, activeModel.baseUrl, activeModel.model, aiPort)
                await testAiModel(activeModel.provider, apiKey, activeModel.baseUrl, activeModel.model, aiPort)
                toast.success(t('settings.ai.testSuccess'))
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e)
                toast.error(t('settings.ai.testFailed') + ': ' + message)
              } finally {
                setAiTesting(false)
              }
            }}
          >
            {aiTesting ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Bot className="h-3.5 w-3.5 mr-1" />}
            {t('settings.ai.test')}
          </Button>
        </div>
      </div>
    </div>
  )
}
