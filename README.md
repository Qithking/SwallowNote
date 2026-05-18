# SwallowNote

<!-- Badges -->
[![GitHub Actions](https://github.com/Qithking/SwallowNote/actions/workflows/release.yml/badge.svg)](https://github.com/Qithking/SwallowNote/actions)
[![Version](https://img.shields.io/github/v/release/Qithking/SwallowNote?color=blue)](https://github.com/Qithking/SwallowNote/releases)
[![License](https://img.shields.io/github/license/Qithking/SwallowNote)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-green)]()

<!-- Visual Preview -->
<!-- TODO: Add screenshots or demo video -->
<!-- ![SwallowNote Demo](screenshots/demo.png) -->

A powerful, cross-platform Markdown editor built with Tauri 2.x, React, and BlockNote.

## Features

| Feature | Description |
|---------|-------------|
| 📝 WYSIWYG Editor | Markdown editing with BlockNote - what you see is what you get |
| 💻 Code Highlighting | Full-featured code editing with CodeMirror 6 |
| 🌲 File Explorer | Browse files with workspace support |
| 📑 Multi-Tab | Open multiple files simultaneously |
| 🔍 Quick Search | Find files instantly with Ctrl+P |
| 🔎 Global Search | Search content across files with Ctrl+Shift+F |
| 🌙 Themes | Light, Dark, and System theme support |
| 🌐 i18n | English and Chinese language support |
| 📁 History | Track recently opened folders with SQLite |

## Quick Start

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Tauri CLI 2.x

### Installation

```bash
# Clone the repository
git clone https://github.com/Qithking/SwallowNote.git
cd SwallowNote

# Install dependencies
npm install

# Run in development
npm run tauri dev

# Build for production
npm run tauri build
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Command Palette |
| `Ctrl+Shift+F` | Global Search |
| `Ctrl+B` | Toggle Sidebar |
| `Ctrl+W` | Close Tab |
| `Ctrl+Tab` | Next Tab |
| `Ctrl+1-9` | Switch to Tab 1-9 |
| `Ctrl+,` | Settings |
| `Escape` | Close Overlays |

## Downloads

Download the latest release for your platform:

| Platform | Installer | Requirements |
|----------|----------|--------------|
| macOS | DMG (Universal) | macOS 13.0+ |
| Windows | MSI | Windows 10+ |
| Linux | AppImage / DEB | Ubuntu 20.04+ / Fedora 34+ |

📦 [All Releases](https://github.com/Qithking/SwallowNote/releases)

## Tech Stack

- **Framework**: [Tauri 2.x](https://tauri.app/) + React 18
- **Markdown Editor**: [BlockNote](https://github.com/BlockNote-Editor/BlockNote)
- **Code Editor**: [CodeMirror 6](https://codemirror.net/)
- **UI Components**: shadcn/ui + Radix UI
- **Styling**: Tailwind CSS v4
- **State Management**: Zustand
- **i18n**: react-i18next
- **Build Tool**: Vite

## Project Structure

```
swallownote/
├── src/                    # React frontend source
│   ├── components/         # UI components
│   │   ├── Editor/        # BlockNote + CodeMirror editors
│   │   ├── FileTree/      # File explorer
│   │   ├── Search/        # Search panels
│   │   ├── Sidebar/       # Sidebar container
│   │   └── Settings/       # Settings panel
│   ├── stores/            # Zustand state stores
│   ├── hooks/             # Custom React hooks
│   ├── lib/                # Utilities and Tauri wrappers
│   └── i18n/               # Internationalization
├── src-tauri/              # Rust backend source
├── package.json            # Node dependencies
└── tauri.conf.json         # Tauri configuration
```

## Configuration

### Theme Configuration

The app uses CSS variables for theming. Theme colors are defined in `src/index.css`.

```css
:root {
  --bg-primary: #ffffff;
  --text-primary: #1a1a1a;
}
```

### State Management

Zustand stores manage different domains:

| Store | Purpose |
|-------|---------|
| `workspaceStore` | Root path and workspace loading |
| `fileTreeStore` | File tree structure and selection |
| `editorStore` | Tabs and editor content |
| `uiStore` | UI preferences (theme, sidebar, etc.) |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions:

- 🐛 [Report Bug](https://github.com/Qithking/SwallowNote/issues)
- 💡 [Request Feature](https://github.com/Qithking/SwallowNote/issues)
- 📖 [Discussions](https://github.com/Qithking/SwallowNote/discussions)

---

⭐ Star this project if you find it helpful!
