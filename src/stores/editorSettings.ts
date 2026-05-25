/**
 * Editor Settings Store - Manages BlockNote editor typography settings
 * Default values reference VSCode markdown preview
 */
import { create } from 'zustand'
import { saveSessionState, getSessionState } from '@/lib/tauri'

let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Sync typography values from the store to CSS custom properties on <html>.
 * This ensures the editor renders with correct font sizes immediately on mount,
 * avoiding the "font-size flicker" caused by async settings loading.
 */
function applyToCSS(state: Partial<EditorSettingsState>) {
  const root = document.documentElement
  if (state.h1Size !== undefined) root.style.setProperty('--h1-size', `${state.h1Size}px`)
  if (state.h2Size !== undefined) root.style.setProperty('--h2-size', `${state.h2Size}px`)
  if (state.h3Size !== undefined) root.style.setProperty('--h3-size', `${state.h3Size}px`)
  if (state.h4Size !== undefined) root.style.setProperty('--h4-size', `${state.h4Size}px`)
  if (state.h5Size !== undefined) root.style.setProperty('--h5-size', `${state.h5Size}px`)
  if (state.bodySize !== undefined) root.style.setProperty('--body-size', `${state.bodySize}px`)
  if (state.lineHeight !== undefined) root.style.setProperty('--line-height', String(state.lineHeight))
  if (state.letterSpacing !== undefined) root.style.setProperty('--letter-spacing', `${state.letterSpacing}px`)
}

export interface EditorSettingsState {
  // Font sizes in px (VSCode defaults)
  h1Size: number
  h2Size: number
  h3Size: number
  h4Size: number
  h5Size: number
  bodySize: number
  
  // Line height (VSCode default: 1.6)
  lineHeight: number
  
  // Letter spacing in px (VSCode default: 0)
  letterSpacing: number
  
  // Padding settings for normal note (vertical/horizontal)
  normalPaddingVertical: number
  normalPaddingHorizontal: number
  
  // Padding settings for wide note (vertical/horizontal)
  widePaddingVertical: number
  widePaddingHorizontal: number
  
  // Actions
  setH1Size: (size: number) => void
  setH2Size: (size: number) => void
  setH3Size: (size: number) => void
  setH4Size: (size: number) => void
  setH5Size: (size: number) => void
  setBodySize: (size: number) => void
  setLineHeight: (height: number) => void
  setLetterSpacing: (spacing: number) => void
  setNormalPaddingVertical: (padding: number) => void
  setNormalPaddingHorizontal: (padding: number) => void
  setWidePaddingVertical: (padding: number) => void
  setWidePaddingHorizontal: (padding: number) => void
  resetToDefault: () => void
  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
}

// VSCode markdown preview default values
const DEFAULT_SETTINGS = {
  h1Size: 32,
  h2Size: 24,
  h3Size: 19,
  h4Size: 16,
  h5Size: 14,
  bodySize: 14,
  lineHeight: 1.6,
  letterSpacing: 0,
  // Padding defaults (vertical/horizontal)
  normalPaddingVertical: 30,
  normalPaddingHorizontal: 80,
  widePaddingVertical: 30,
  widePaddingHorizontal: 20,
}

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    useEditorSettingsStore.getState().saveSettings()
    saveTimer = null
  }, 3000)
}

function collectSettings(state: EditorSettingsState): Record<string, string> {
  return {
    editor_h1Size: String(state.h1Size),
    editor_h2Size: String(state.h2Size),
    editor_h3Size: String(state.h3Size),
    editor_h4Size: String(state.h4Size),
    editor_h5Size: String(state.h5Size),
    editor_bodySize: String(state.bodySize),
    editor_lineHeight: String(state.lineHeight),
    editor_letterSpacing: String(state.letterSpacing),
    editor_normalPaddingVertical: String(state.normalPaddingVertical),
    editor_normalPaddingHorizontal: String(state.normalPaddingHorizontal),
    editor_widePaddingVertical: String(state.widePaddingVertical),
    editor_widePaddingHorizontal: String(state.widePaddingHorizontal),
  }
}

export const useEditorSettingsStore = create<EditorSettingsState>((set, get) => {
  return {
  ...DEFAULT_SETTINGS,
  
  setH1Size: (size) => {
    set({ h1Size: size })
    applyToCSS({ h1Size: size })
    scheduleSave()
  },
  
  setH2Size: (size) => {
    set({ h2Size: size })
    applyToCSS({ h2Size: size })
    scheduleSave()
  },
  
  setH3Size: (size) => {
    set({ h3Size: size })
    applyToCSS({ h3Size: size })
    scheduleSave()
  },
  
  setH4Size: (size) => {
    set({ h4Size: size })
    applyToCSS({ h4Size: size })
    scheduleSave()
  },
  
  setH5Size: (size) => {
    set({ h5Size: size })
    applyToCSS({ h5Size: size })
    scheduleSave()
  },
  
  setBodySize: (size) => {
    set({ bodySize: size })
    applyToCSS({ bodySize: size })
    scheduleSave()
  },
  
  setLineHeight: (height) => {
    set({ lineHeight: height })
    applyToCSS({ lineHeight: height })
    scheduleSave()
  },
  
  setLetterSpacing: (spacing) => {
    set({ letterSpacing: spacing })
    applyToCSS({ letterSpacing: spacing })
    scheduleSave()
  },
  
  setNormalPaddingVertical: (padding) => {
    set({ normalPaddingVertical: padding })
    scheduleSave()
  },
  
  setNormalPaddingHorizontal: (padding) => {
    set({ normalPaddingHorizontal: padding })
    scheduleSave()
  },
  
  setWidePaddingVertical: (padding) => {
    set({ widePaddingVertical: padding })
    scheduleSave()
  },
  
  setWidePaddingHorizontal: (padding) => {
    set({ widePaddingHorizontal: padding })
    scheduleSave()
  },
  
  resetToDefault: () => {
    set(DEFAULT_SETTINGS)
    applyToCSS(DEFAULT_SETTINGS)
    scheduleSave()
  },
  
  loadSettings: async () => {
    try {
      const saved = await getSessionState()
      if (Object.keys(saved).length === 0) return
      
      const partial: Partial<EditorSettingsState> = {}
      if (saved.editor_h1Size) partial.h1Size = Number(saved.editor_h1Size)
      if (saved.editor_h2Size) partial.h2Size = Number(saved.editor_h2Size)
      if (saved.editor_h3Size) partial.h3Size = Number(saved.editor_h3Size)
      if (saved.editor_h4Size) partial.h4Size = Number(saved.editor_h4Size)
      if (saved.editor_h5Size) partial.h5Size = Number(saved.editor_h5Size)
      if (saved.editor_bodySize) partial.bodySize = Number(saved.editor_bodySize)
      if (saved.editor_lineHeight) partial.lineHeight = Number(saved.editor_lineHeight)
      if (saved.editor_letterSpacing) partial.letterSpacing = Number(saved.editor_letterSpacing)
      if (saved.editor_normalPaddingVertical) partial.normalPaddingVertical = Number(saved.editor_normalPaddingVertical)
      if (saved.editor_normalPaddingHorizontal) partial.normalPaddingHorizontal = Number(saved.editor_normalPaddingHorizontal)
      if (saved.editor_widePaddingVertical) partial.widePaddingVertical = Number(saved.editor_widePaddingVertical)
      if (saved.editor_widePaddingHorizontal) partial.widePaddingHorizontal = Number(saved.editor_widePaddingHorizontal)
      
      set(partial)
      applyToCSS(partial)
    } catch (err) {
      console.error('Failed to load editor settings:', err)
    }
  },
  
  saveSettings: async () => {
    try {
      const state = get()
      const settings = collectSettings(state)
      await saveSessionState(settings)
    } catch (err) {
      console.error('Failed to save editor settings:', err)
    }
  },
  }
})