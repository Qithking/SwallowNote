/**
 * Editor Settings Store - Manages BlockNote editor typography settings
 * Default values reference VSCode markdown preview
 */
import { create } from 'zustand'

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

export const useEditorSettingsStore = create<EditorSettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  
  setH1Size: (size) => {
    set({ h1Size: size })
    get().saveSettings()
  },
  
  setH2Size: (size) => {
    set({ h2Size: size })
    get().saveSettings()
  },
  
  setH3Size: (size) => {
    set({ h3Size: size })
    get().saveSettings()
  },
  
  setH4Size: (size) => {
    set({ h4Size: size })
    get().saveSettings()
  },
  
  setH5Size: (size) => {
    set({ h5Size: size })
    get().saveSettings()
  },
  
  setBodySize: (size) => {
    set({ bodySize: size })
    get().saveSettings()
  },
  
  setLineHeight: (height) => {
    set({ lineHeight: height })
    get().saveSettings()
  },
  
  setLetterSpacing: (spacing) => {
    set({ letterSpacing: spacing })
    get().saveSettings()
  },
  
  setNormalPaddingVertical: (padding) => {
    set({ normalPaddingVertical: padding })
    get().saveSettings()
  },
  
  setNormalPaddingHorizontal: (padding) => {
    set({ normalPaddingHorizontal: padding })
    get().saveSettings()
  },
  
  setWidePaddingVertical: (padding) => {
    set({ widePaddingVertical: padding })
    get().saveSettings()
  },
  
  setWidePaddingHorizontal: (padding) => {
    set({ widePaddingHorizontal: padding })
    get().saveSettings()
  },
  
  resetToDefault: () => {
    set(DEFAULT_SETTINGS)
    get().saveSettings()
  },
  
  loadSettings: async () => {
    try {
      // Will be implemented with SQLite
    } catch (err) {
      console.error('Failed to load editor settings:', err)
    }
  },
  
  saveSettings: async () => {
    try {
      // Will be implemented with SQLite
    } catch (err) {
      console.error('Failed to save editor settings:', err)
    }
  },
}))