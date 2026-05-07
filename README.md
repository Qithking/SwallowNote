# SwallowNote

A fast, lightweight Markdown note-taking application built with Tauri 2.0 and Svelte 5.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **Rust** (latest stable) - [Install via rustup](https://www.rust-lang.org/tools/install)

### Install on macOS

```bash
# Install Node.js
brew install node

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Run in development mode

```bash
npm run tauri dev
```

This will start both the Vite dev server and the Tauri application.

### 3. Build for production

```bash
npm run tauri build
```

## Project Structure

```
swallownote/
├── src-tauri/                 # Rust backend
│   ├── src/
│   │   ├── commands/         # Tauri IPC commands
│   │   │   └── file.rs       # File operations
│   │   ├── services/         # Background services
│   │   │   └── file_watcher.rs
│   │   ├── lib.rs            # Library entry point
│   │   └── main.rs           # Application entry point
│   ├── Cargo.toml            # Rust dependencies
│   └── tauri.conf.json       # Tauri configuration
├── src/                      # Svelte 5 frontend
│   ├── lib/
│   │   ├── components/       # Svelte components
│   │   │   ├── Editor/
│   │   │   ├── FileTree/
│   │   │   ├── Layout/
│   │   │   └── Tabs/
│   │   ├── services/         # Frontend services
│   │   ├── stores/           # State management
│   │   └── types/            # TypeScript types
│   ├── routes/               # SvelteKit routes
│   ├── app.html              # HTML template
│   └── app.css               # Global styles
├── package.json              # Node.js dependencies
├── svelte.config.js          # Svelte configuration
├── vite.config.ts            # Vite configuration
└── tsconfig.json             # TypeScript configuration
```

## Features (Phase 1 - MVP)

- [x] File tree with lazy loading
- [x] Multi-tab editor
- [x] Markdown source editing (CodeMirror 6)
- [x] File system watching
- [x] Basic file operations (create, delete, rename)
- [ ] Git integration (planned)
- [ ] Preview mode (planned)
- [ ] Search (planned)

## Tech Stack

- **Desktop Framework**: Tauri 2.0
- **Frontend**: Svelte 5 + SvelteKit
- **Editor**: CodeMirror 6
- **State Management**: Svelte 5 Runes ($state, $derived, $effect)
- **File Watching**: notify (Rust crate)
- **Build Tool**: Vite

## License

MIT
