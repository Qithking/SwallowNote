/**
 * EditorSettings Component - Panel for BlockNote typography settings
 * Includes font sizes (h1-h5, body), line height, and letter spacing controls
 */
import { RotateCcw } from 'lucide-react'
import { useEditorSettingsStore } from '@/stores'
import { NumberInput } from '@/components/ui/number-input'

function EditorSettings() {
  const {
    h1Size,
    h2Size,
    h3Size,
    h4Size,
    h5Size,
    bodySize,
    lineHeight,
    letterSpacing,
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
          排版设置
        </span>
        <button
          onClick={resetToDefault}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
          title="恢复默认"
        >
          <RotateCcw size={12} />
          <span>重置</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 scrollable-area">
        {/* Font Sizes */}
        <Section title="字体大小">
          <SettingRow label="标题 H1">
            <NumberInput
              value={h1Size}
              onChange={setH1Size}
              min={20}
              max={48}
              unit="px"
            />
          </SettingRow>
          <SettingRow label="标题 H2">
            <NumberInput
              value={h2Size}
              onChange={setH2Size}
              min={18}
              max={36}
              unit="px"
            />
          </SettingRow>
          <SettingRow label="标题 H3">
            <NumberInput
              value={h3Size}
              onChange={setH3Size}
              min={16}
              max={28}
              unit="px"
            />
          </SettingRow>
          <SettingRow label="标题 H4">
            <NumberInput
              value={h4Size}
              onChange={setH4Size}
              min={14}
              max={24}
              unit="px"
            />
          </SettingRow>
          <SettingRow label="标题 H5">
            <NumberInput
              value={h5Size}
              onChange={setH5Size}
              min={12}
              max={20}
              unit="px"
            />
          </SettingRow>
          <SettingRow label="正文">
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
        <Section title="行间距">
          <SettingRow label="行距">
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
        <Section title="字间距">
          <SettingRow label="字距">
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

        {/* Normal Note Padding */}
        <Section title="普通笔记内边距">
          <SettingRow label="上下">
            <NumberInput
              value={normalPaddingVertical}
              onChange={setNormalPaddingVertical}
              min={0}
              max={120}
              unit="px"
            />
          </SettingRow>
          <SettingRow label="左右">
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
        <Section title="宽笔记内边距">
          <SettingRow label="上下">
            <NumberInput
              value={widePaddingVertical}
              onChange={setWidePaddingVertical}
              min={0}
              max={120}
              unit="px"
            />
          </SettingRow>
          <SettingRow label="左右">
            <NumberInput
              value={widePaddingHorizontal}
              onChange={setWidePaddingHorizontal}
              min={0}
              max={200}
              unit="px"
            />
          </SettingRow>
        </Section>
      </div>
    </div>
  )
}

export { EditorSettings }