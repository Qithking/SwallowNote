# SwallowNote Plugin Template

A starter project for building [SwallowNote](https://github.com/) plugins
without depending on host source. Copy this directory to a new location
and start hacking.

## Quick start

```bash
cp -r docs/plugin-template ~/code/my-plugin
cd ~/code/my-plugin
npm install
npm run dev
```

Open http://localhost:5173 to see the standalone preview.

The preview frame (right panel) lets you:

- Emit host events (`note:open`, `note:save`, `theme:change`, etc.) and watch
  your plugin react in real time
- Inspect the plugin's storage keys
- Right-click the plugin panel to see your `registerContextMenu` items
- Toggle `isActive` to fire `onActivate` / `onDeactivate`
- View a live event log

## Build & upload

```bash
npm run build
```

Outputs:

```
dist/
├── plugin.js          # 38 kB IIFE bundle (gzip 12 kB)
└── manifest.json      # copied from src/plugin/manifest.json
```

In SwallowNote: **Settings → Plugins → Upload** the entire `dist/`
folder (or zip it first).

## Project layout

```
plugin-template/
├── index.html                 # vite dev entry
├── vite.config.ts             # dev (preview) + build (library) modes
├── tsconfig.json              # strict, includes ../plugin-sdk/src
├── package.json
├── src/
│   ├── main.tsx               # dev entry: mounts <Preview />
│   ├── preview.tsx            # dev frame with event buttons
│   ├── styles.css
│   └── plugin/
│       ├── index.tsx          # <-- YOUR CODE LIVES HERE
│       └── manifest.json
└── dist/                      # build output (gitignored)
```

## SDK connection

This template depends on `@swallow-note/plugin-sdk` via a local
`file:` reference:

```json
"dependencies": {
  "@swallow-note/plugin-sdk": "file:../plugin-sdk"
}
```

For a real plugin project published to npm, change this to:

```json
"@swallow-note/plugin-sdk": "^0.1.0"
```

(or replace the package with a vendored copy of `docs/plugin-sdk/src/index.ts`).

## What to edit

Only `src/plugin/index.tsx` and `src/plugin/manifest.json` need
editing. The rest is dev infrastructure that you can leave alone.

If you want to add new dev tooling buttons (e.g. emit a custom event
with form input), edit `src/preview.tsx`.

## Migrating from project-internal development

If you previously developed inside `SwallowNote/src/`, the migration
is:

1. Move your `index.tsx` into `src/plugin/index.tsx`
2. Replace imports:

   ```typescript
   // Before
   import type { PluginDefinition } from '@/types/plugin'
   import { usePluginStorage } from '@/lib/plugin-hooks'

   // After
   import { type PluginDefinition, usePluginStorage } from '@swallow-note/plugin-sdk'
   ```

3. Replace `@/lib/...` runtime imports with SDK re-exports
4. Update `manifest.json` to live next to `index.tsx`

The shapes are identical; the migration is mostly sed work.
