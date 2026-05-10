# SwallowNote

A cross-platform Markdown editor built with Tauri 2.x, React, and Milkdown.

## Tech Stack

- **Framework**: Tauri 2.x + React 18
- **Editor**: Milkdown (Markdown editor)
- **Code Editor**: CodeMirror 6
- **UI**: shadcn/ui + Tailwind CSS v4
- **State Management**: Zustand
- **Styling**: Tailwind CSS v4 + CSS Variables
- **Icons**: Lucide React
- **i18n**: react-i18next
- **Build Tool**: Vite

## Features

- 📝 Markdown editing with Milkdown
- 💻 Code editing with CodeMirror 6
- 🌲 File tree browser
- 📑 Multi-tab editing
- 🔍 Quick file search (Ctrl+P)
- 🔎 Global content search (Ctrl+Shift+F)
- 🌙 Light/Dark/System theme
- 🌐 Multi-language support (English/Chinese)
- 📁 Git integration
- 🤖 AI assistant panel
- ⌨️ VSCode-style keyboard shortcuts

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+P | Command Palette |
| Ctrl+Shift+F | Global Search |
| Ctrl+B | Toggle Sidebar |
| Ctrl+W | Close Tab |
| Ctrl+1-9 | Switch to Tab 1-9 |
| Ctrl+, | Settings |
| Escape | Close Overlays |

## Getting Started

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Tauri CLI 2.x

### Installation

```bash
# Install dependencies
npm install

# Run in development
npm run tauri dev

# Build for production
npm run tauri build
```

## Project Structure

```
src/
├── components/          # React components
│   ├── TitleBar.tsx    # Custom title bar
│   ├── Sidebar.tsx     # Sidebar container
│   ├── TabBar.tsx      # Tab management
│   ├── Editor.tsx      # Main editor
│   ├── StatusBar.tsx   # Bottom status bar
│   ├── CommandPalette.tsx
│   ├── SearchPanel.tsx
│   ├── FileTree/       # File tree components
│   ├── Search/        # Search components
│   ├── Git/           # Git components
│   ├── AI/            # AI components
│   └── Settings/      # Settings components
├── stores/             # Zustand stores
│   ├── workspace.ts   # Workspace state
│   ├── filetree.ts    # File tree state
│   ├── editor.ts      # Editor state
│   ├── ui.ts          # UI state
│   └── git.ts         # Git state
├── hooks/              # Custom React hooks
│   ├── useKeyboardShortcuts.ts
│   └── useTheme.ts
├── lib/                # Utilities
│   ├── utils.ts       # Helper functions
│   └── tauri.ts       # Tauri API wrappers
├── i18n/              # Internationalization
│   ├── index.ts       # i18n configuration
│   └── locales/       # Translation files
│       ├── en.json
│       └── zh-CN.json
└── App.tsx            # Root component
```

## Development Notes

### Theme System

The app uses CSS variables for theming. Theme colors are defined in `src/index.css` and can be toggled between light, dark, and system preferences.

### State Management

Zustand is used for global state management. Each store handles a specific domain:
- `workspaceStore`: Root path and workspace loading state
- `fileTreeStore`: File tree structure and selection
- `editorStore`: Tabs and editor content
- `uiStore`: UI preferences (theme, sidebar visibility, etc.)
- `gitStore`: Git repository state

### Tauri Commands

Tauri backend commands are wrapped in `src/lib/tauri.ts` for type-safe access from the React frontend.

## License

MIT
