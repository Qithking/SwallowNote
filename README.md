# SwallowNote

A cross-platform Markdown editor built with Tauri 2.x, React, and BlockNote.

## Tech Stack

- **Framework**: Tauri 2.x + React 18
- **Markdown Editor**: BlockNote
- **Code Editor**: CodeMirror 6
- **UI Components**: shadcn/ui + Radix UI
- **Styling**: Tailwind CSS v4 + CSS Variables
- **State Management**: Zustand
- **Icons**: Lucide React
- **i18n**: react-i18next
- **Build Tool**: Vite

## Features

- 📝 Markdown editing with BlockNote (WYSIWYG)
- 💻 Code editing with CodeMirror 6
- 🌲 File tree browser with workspace support
- 📑 Multi-tab editing
- 🔍 Quick file search (Ctrl+P)
- 🔎 Global content search (Ctrl+Shift+F)
- 🌙 Light/Dark/System theme
- 🌐 Multi-language support (English/Chinese)
- 📁 Folder history with SQLite storage
- ⌨️ VSCode-style keyboard shortcuts

## Keyboard Shortcuts

| Shortcut      | Action            |
| ------------- | ----------------- |
| Ctrl+P        | Command Palette   |
| Ctrl+Shift+F  | Global Search     |
| Ctrl+B        | Toggle Sidebar    |
| Ctrl+W        | Close Tab         |
| Ctrl+Tab      | Next Tab          |
| Ctrl+1-9      | Switch to Tab 1-9 |
| Ctrl+,        | Settings          |
| Escape        | Close Overlays    |

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

```text
src/
├── components/          # React components
│   ├── TitleBar/       # Custom title bar
│   ├── Sidebar/        # Sidebar container
│   ├── TabBar/         # Tab management
│   ├── Editor/         # Main editor (BlockNote + CodeMirror)
│   ├── StatusBar/     # Bottom status bar
│   ├── CommandPalette/ # Command palette
│   ├── FileTree/       # File tree components
│   ├── Search/         # Search components
│   ├── Git/            # Git integration
│   └── Settings/      # Settings components
├── stores/              # Zustand stores
│   ├── workspace.ts    # Workspace state
│   ├── filetree.ts     # File tree state
│   ├── editor.ts       # Editor state
│   ├── ui.ts           # UI state
│   └── git.ts          # Git state
├── hooks/               # Custom React hooks
├── lib/                 # Utilities
│   ├── utils.ts        # Helper functions
│   └── tauri.ts        # Tauri API wrappers
├── i18n/               # Internationalization
│   └── locales/        # Translation files
└── App.tsx             # Root component
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

## Downloads

Download the latest release for your platform:

- **macOS**: DMG installer (Apple Silicon + Intel)
- **Windows**: MSI installer
- **Linux**: AppImage or DEB package

Visit the [Releases](https://github.com/Qithking/SwallowNote/releases) page to download.

## License

GPL-3.0
