/**
 * EditorSettings Component - Panel for BlockNote typography settings
 * Includes font sizes (h1-h5, body), line height, and letter spacing controls
 */
import { RotateCcw } from 'lucide-react'
import { useEditorSettingsStore } from '@/stores'
import { NumberInput } from '@/components/ui/number-input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'

function EditorSettings() {
  const { t } = useTranslation()
  const {
    h1Size,
    h2Size,
    h3Size,
    h4Size,
    h5Size,
    bodySize,
    lineHeight,
    letterSpacing,
    paragraphSpacing,
    firstLineIndent,
    normalPaddingVertical,
    normalPaddingHorizontal,
    widePaddingVertical,
    widePaddingHorizontal,
    setH1Size,
    setH2Size,
    setH3Size,
    setH4Size,
    setH5Size,
    setBodySize,
    setLineHeight,
    setLetterSpacing,
    setParagraphSpacing,
    setFirstLineIndent,
    setNormalPaddingVertical,
    setNormalPaddingHorizontal,
    setWidePaddingVertical,
    setWidePaddingHorizontal,
    resetToDefault,
  } = useEditorSettingsStore()

  const SettingRow = ({
    label,
    children,
  }: {
    label: string
    children: React.ReactNode
  }) => {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-[var(--font-size)] text-[var(--text-secondary)]">{label}</span>
        {children}
      </div>
    )
  }

  const Section = ({
    title,
    children,
  }: {
    title: string
    children: React.ReactNode
  }) => {
    return (
      <div className="mb-3">
        <h3 className="text-xs font-medium uppercase tracking-wider">
          {title}
        </h3>
        <div className="rounded-lg p-2">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between h-[40px] px-3 shrink-0"      
        style={{ fontSize: 'var(--font-size-md)' }} 
      >
        <span className="text-md font-medium uppercase tracking-wider ">
          {t('editorSettings.title')}
        </span>
        <button
          onClick={resetToDefault}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
          title={t('editorSettings.resetToDefault')}
        >
          <RotateCcw size={12} />
          <span>{t('editorSettings.reset')}</span>
        </button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 p-3">
        {/* Font Sizes */}
        <Section title={t('editorSettings.sectionFont')}>
          <SettingRow label={t('editorSettings.labelH1')}>
            <NumberInput
              value={h1Size}
              onChange={setH1Size}
              min={20}
              max={48}
              unit="px"
            />
          </SettingRow>
          <SettingRow label={t('editorSettings.labelH2')}>
            <NumberInput
              value={h2Size}
              onChange={setH2Size}
              min={18}
              max={36}
              unit="px"
            />
          </SettingRow>
          <SettingRow label={t('editorSettings.labelH3')}>
            <NumberInput
              value={h3Size}
              onChange={setH3Size}
              min={16}
              max={28}
              unit="px"
            />
          </SettingRow>
          <SettingRow label={t('editorSettings.labelH4')}>
            <NumberInput
              value={h4Size}
              onChange={setH4Size}
              min={14}
              max={24}
              unit="px"
            />
          </SettingRow>
          <SettingRow label={t('editorSettings.labelH5')}>
            <NumberInput
              value={h5Size}
              onChange={setH5Size}
              min={12}
              max={20}
              unit="px"
            />
          </SettingRow>
          <SettingRow label={t('editorSettings.labelBody')}>
            <NumberInput
              value={bodySize}
              onChange={setBodySize}
              min={10}
              max={20}
              unit="px"
            />
          </SettingRow>
        </Section>

        {/* Line Height */}
        <Section title={t('editorSettings.sectionLineHeight')}>
          <SettingRow label={t('editorSettings.labelLineHeight')}>
            <NumberInput
              value={lineHeight}
              onChange={setLineHeight}
              min={1.2}
              max={2.5}
              step={0.1}
            />
          </SettingRow>
        </Section>

        {/* Letter Spacing */}
        <Section title={t('editorSettings.sectionLetterSpacing')}>
          <SettingRow label={t('editorSettings.labelLetterSpacing')}>
            <NumberInput
              value={letterSpacing}
              onChange={setLetterSpacing}
              min={-2}
              max={8}
              step={0.5}
              unit="px"
            />
          </SettingRow>
        </Section>

        {/* Paragraph Spacing */}
        <Section title={t('editorSettings.sectionParagraphSpacing')}>
          <SettingRow label={t('editorSettings.labelParagraphSpacing')}>
            <NumberInput
              value={paragraphSpacing}
              onChange={setParagraphSpacing}
              min={0}
              max={48}
              step={1}
              unit="px"
            />
          </SettingRow>
        </Section>

        {/* First Line Indent */}
        <Section title={t('editorSettings.sectionFirstLineIndent')}>
          <SettingRow label={t('editorSettings.labelFirstLineIndent')}>
            <Switch
              checked={firstLineIndent}
              onCheckedChange={setFirstLineIndent}
            />
          </SettingRow>
        </Section>

        {/* Normal Note Padding */}
        <Section title={t('editorSettings.sectionNormalPadding')}>
          <SettingRow label={t('editorSettings.labelPaddingTopBottom')}>
            <NumberInput
              value={normalPaddingVertical}
              onChange={setNormalPaddingVertical}
              min={0}
              max={120}
              unit="px"
            />
          </SettingRow>
          <SettingRow label={t('editorSettings.labelPaddingLeftRight')}>
            <NumberInput
              value={normalPaddingHorizontal}
              onChange={setNormalPaddingHorizontal}
              min={0}
              max={200}
              unit="px"
            />
          </SettingRow>
        </Section>

        {/* Wide Note Padding */}
        <Section title={t('editorSettings.sectionWidePadding')}>
          <SettingRow label={t('editorSettings.labelPaddingTopBottom')}>
            <NumberInput
              value={widePaddingVertical}
              onChange={setWidePaddingVertical}
              min={0}
              max={120}
              unit="px"
            />
          </SettingRow>
          <SettingRow label={t('editorSettings.labelPaddingLeftRight')}>
            <NumberInput
              value={widePaddingHorizontal}
              onChange={setWidePaddingHorizontal}
              min={0}
              max={200}
              unit="px"
            />
          </SettingRow>
        </Section>
      </ScrollArea>
    </div>
  )
}

export { EditorSettings }