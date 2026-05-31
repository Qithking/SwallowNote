# SwallowNote

<p align="center">
  <strong>A powerful, cross-platform Markdown editor built with Tauri 2.x, React, and BlockNote</strong>
</p>

<p align="center">
  <a href="README.zh-CN.md">中文</a> | English
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#downloads">Downloads</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

---

## Badges

[![GitHub Actions](https://github.com/Qithking/SwallowNote/actions/workflows/release.yml/badge.svg)](https://github.com/Qithking/SwallowNote/actions)
[![Release](https://img.shields.io/github/v/release/Qithking/SwallowNote?color=blue&logo=github)](https://github.com/Qithking/SwallowNote/releases)
[![License](https://img.shields.io/github/license/Qithking/SwallowNote?color=green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-green?logo=apple&logoColor=white)]()

---

## Features

- 📝 **WYSIWYG Markdown Editor** - Rich editing experience with BlockNote (what you see is what you get)
- 💻 **Code Highlighting** - Full-featured code editing with CodeMirror 6 and syntax highlighting for 15+ languages
- 🌲 **File Explorer** - Browse and manage files with workspace support
- 📑 **Multi-Tab Editing** - Open and edit multiple files simultaneously with tab management
- 🔍 **Quick Search** - Find files instantly with `Ctrl+P` command palette
- 🔎 **Global Search** - Search content across all files with `Ctrl+Shift+F`
- 🤖 **AI Assistant** - Integrated AI-powered writing assistance
- 🧠 **Mind Map** - Visual mind mapping support for brainstorming
- 🌙 **Themes** - Light, Dark, and System theme support with CSS variables
- 🌐 **Internationalization** - English and Chinese (Simplified) language support
- 📁 **History Tracking** - Track recently opened folders with SQLite storage
- 🔧 **Git Integration** - Built-in Git version control support
- ⌨️ **Keyboard Shortcuts** - Comprehensive keyboard shortcuts for power users

## Screenshots

<p align="center">
  <img src="screenshots/main-interface.png" width="800" alt="SwallowNote Main Interface - Light Mode">
</p>

<p align="center">
  <img src="screenshots/dark-mode.png" width="800" alt="SwallowNote Dark Mode">
</p>

## Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **Rust** >= 1.70.0 (for Tauri)
- **Tauri CLI** >= 2.0.0

### Installation

```bash
# Clone the repository
git clone https://github.com/Qithking/SwallowNote.git

# Navigate to project directory
cd SwallowNote

# Install Node.js dependencies
npm install

# Start development server
npm run tauri dev

# Build for production
npm run tauri build
```

### Development Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite development server |
| `npm run build` | Build frontend for production |
| `npm run preview` | Preview production build |
| `npm run tauri dev` | Run app in development mode |
| `npm run tauri build` | Build app for production |
| `npm run lint` | Run ESLint |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` / `Cmd+P` | Open Command Palette |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Global Search |
| `Ctrl+B` / `Cmd+B` | Toggle Sidebar |
| `Ctrl+W` / `Cmd+W` | Close Current Tab |
| `Ctrl+Tab` / `Ctrl+Option+Right` | Next Tab |
| `Ctrl+Shift+Tab` / `Ctrl+Option+Left` | Previous Tab |
| `Ctrl+1-9` / `Cmd+1-9` | Switch to Tab 1-9 |
| `Ctrl+,` / `Cmd+,` | Open Settings |
| `Escape` | Close Overlays/Dialogs |
| `Ctrl+S` / `Cmd+S` | Save File |

## Downloads

### Latest Release

Download the latest stable release from [GitHub Releases](https://github.com/Qithking/SwallowNote/releases/latest):

| Platform | Format | Requirements |
|----------|--------|--------------|
| 🍎 macOS | DMG (Universal Binary) | macOS 13.0+ (Ventura) |
| 🪟 Windows | MSI Installer | Windows 10+ (64-bit) |
| 🐧 Linux | AppImage / DEB / RPM | Ubuntu 20.04+ / Fedora 34+ |

### All Releases

📦 [View All Releases](https://github.com/Qithking/SwallowNote/releases)

## Tech Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| [React](https://react.dev/) | ^19.x | UI Framework |
| [TypeScript](https://www.typescriptlang.org/) | ^5.x | Type Safety |
| [Vite](https://vitejs.dev/) | ^5.x | Build Tool |
| [Tauri](https://tauri.app/) | ^2.x | Desktop Shell |
| [BlockNote](https://blocknote.dev/) | ^0.51.x | WYSIWYG Editor |
| [CodeMirror](https://codemirror.net/) | ^6.x | Code Editor |
| [Tailwind CSS](https://tailwindcss.com/) | ^4.x | Styling |
| [Zustand](https://zustand-demo.pmnd.rs/) | ^5.x | State Management |
| [Radix UI](https://www.radix-ui.com/) | Latest | Accessible Components |
| [shadcn/ui](https://ui.shadcn.com/) | Latest | Component Library |
| [Lucide](https://lucide.dev/) | Latest | Icon Library |
| [i18next](https://www.i18next.com/) | ^23.x | Internationalization |

### Backend (Rust)

| Technology | Purpose |
|------------|---------|
| Tauri 2.x | Desktop API & Window Management |
| SQLite (via rusqlite) | Data Persistence |
| Git (via git2) | Version Control Integration |
| File System Watcher (notify) | Real-time File Monitoring |

## Project Structure

```
swallownote/
├── .github/
│   └── workflows/          # GitHub Actions CI/CD
├── src/                     # React Frontend Source
│   ├── components/          # UI Components
│   │   ├── AI/             # AI Assistant Components
│   │   ├── DiffViewer/      # Diff Viewer Component
│   │   ├── Directory/       # Directory Browser
│   │   ├── EditorSettings/  # Editor Settings Panel
│   │   ├── FileTree/        # File Explorer Tree
│   │   ├── Git/             # Git Integration UI
│   │   ├── History/         # History Panel
│   │   ├── Search/          # Search Components
│   │   ├── Settings/        # Application Settings
│   │   ├── editors/         # BlockNote & CodeMirror Editors
│   │   └── ui/              # Base UI Components (shadcn/ui)
│   ├── hooks/               # Custom React Hooks
│   ├── i18n/                # Translation Files (en, zh-CN)
│   ├── lib/                 # Utilities & Tauri Wrappers
│   ├── stores/              # Zustand State Stores
│   ├── types/               # TypeScript Type Definitions
│   └── utils/               # Utility Functions
├── src-tauri/               # Rust Backend Source
│   ├── src/
│   │   ├── ai_proxy/       # AI Proxy Service
│   │   ├── commands/       # Tauri Command Handlers
│   │   ├── db/             # Database Layer
│   │   ├── plugins/        # Tauri Plugins
│   │   └── services/       # Business Logic Services
│   ├── capabilities/       # Tauri Capabilities
│   ├── gen/schemas/        # Generated Schemas
│   └── tauri.conf.json     # Tauri Configuration
├── assets/                  # Static Assets
├── capabilities/            # Tauri Capabilities Config
├── public/                  # Public Resources
├── package.json            # Node.js Dependencies
├── tsconfig.json           # TypeScript Configuration
├── vite.config.ts          # Vite Configuration
└── README.md              # This File
```

## Configuration

### Theme Customization

The application uses CSS custom properties for theming. You can customize colors in `src/index.css`:

```css
:root {
  /* Light theme colors */
  --bg-primary: #ffffff;
  --text-primary: #1a1a1a;
  --theme-color: #3b82f6;
}

[data-theme="dark"] {
  /* Dark theme colors */
  --bg-primary: #1a1a1a;
  --text-primary: #e5e5e5;
}
```

### State Management Architecture

The application uses Zustand stores to manage different domains:

| Store | Purpose | Key State |
|-------|---------|-----------|
| `useWorkspaceStore` | Workspace & folder management | `rootPath`, `workspaceFolders` |
| `useEditorStore` | Editor tabs & content | `tabs`, `activeTabId`, `viewMode` |
| `useUIStore` | UI preferences | `theme`, `sidebarOpen`, `noteWidth` |
| `useGitStore` | Git integration state | `repositories`, `syncStatus` |
| `useEditorSettingsStore` | Editor configuration | `fontSize`, `lineHeight`, etc. |

## Contributing

We welcome contributions! Here's how you can help:

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/Qithking/SwallowNote/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Your environment (OS, version)

### Suggesting Features

1. Check existing feature requests in [Issues](https://github.com/Qithking/SwallowNote/issues)
2. Create a new issue with the `enhancement` label
3. Describe the use case and proposed solution

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes following the code style
4. Test thoroughly on your platform(s)
5. Commit with clear messages: `git commit -m 'Add amazing feature'`
6. Push to your fork: `git push origin feature/amazing-feature`
7. Open a Pull Request with a description of changes

### Development Guidelines

- Follow TypeScript strict mode
- Use ESLint for code quality
- Write meaningful commit messages
- Update documentation as needed
- Test on multiple platforms when possible

## Support

| Resource | Link |
|----------|------|
| 📖 Documentation | [Wiki](https://github.com/Qithking/SwallowNote/wiki) |
| 🐛 Bug Reports | [Issues](https://github.com/Qithking/SwallowNote/issues) |
| 💡 Feature Requests | [Discussions](https://github.com/Qithking/SwallowNote/discussions) |
| 💬 Community Chat | [Discussions](https://github.com/Qithking/SwallowNote/discussions) |

## Acknowledgments

- [Tauri Team](https://tauri.app/) - Amazing desktop framework
- [BlockNote Team](https://blocknote.dev/) - Excellent block-based editor
- [Shadcn UI](https://ui.shadcn.com/) - Beautiful component library
- All contributors and users who make this project better

## License

This project is licensed under the **GPL-3.0 License** - see the [LICENSE](LICENSE) file for details.

```
Copyright (c) 2024 Qithking

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
```

---

<div align="center">

**Made with ❤️ by [Qithking](https://github.com/Qithking)**

If you find this project helpful, please consider giving it a ⭐ Star!

[⬆ Back to Top](#swallownote)

</div>
