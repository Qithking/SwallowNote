# Core Plugins

Bundled, in-tree plugin manifests shipped with the host. They are **not
auto-loaded** — they exist as a small, well-commented reference library
for plugin authors and as a smoke test for the host's lifecycle, event,
storage, and context-menu APIs.

## Zero host coupling

Every `.tsx` in this directory imports **only** from
`@swallow-note/plugin-sdk`. No host internals (`@/lib/plugin-*`,
`@/types/plugin`, ...) appear. A plugin author can copy any of these
files into a fresh `docs/plugin-template` project and have it run
unchanged in the browser preview, the standalone build, and the host.

This is the contract that makes "future plugin development never
touches host code" possible. If you need a new capability, add an
export to the SDK first.

## Layout

```
core-plugins/
├── index.ts                   # Re-exports all manifests as CORE_PLUGINS (SAMPLE_PLUGINS is deprecated)
├── recent-notes-counter.tsx   # Baseline: storage + events + context-menu
├── word-counter.tsx           # editorToolbar + editorArea placement
├── theme-watcher.tsx          # Multi-event subscription + settings emit
└── README.md                  # this file
```

Each `.tsx` is a complete `PluginDefinition` (default export) and can
be installed by copying it to `<plugins>/<id>/index.tsx` and clicking
"Install from folder" in the plugin manager. The host's permission
guard will prompt the user for whatever the manifest declares.

## What each sample covers

| API surface                                 | recent-notes | word-counter | theme-watcher |
| ------------------------------------------- | :----------: | :----------: | :-----------: |
| `iconPosition: 'sidebar'`                   | ✅           |              | ✅            |
| `iconPosition: 'editorToolbar'`             |              | ✅           |               |
| `contentPosition: 'leftPanel'`              | ✅           |              |               |
| `contentPosition: 'rightPanel'`             |              |              | ✅            |
| `contentPosition: 'editorArea'`             |              | ✅           |               |
| Persistent storage (`usePluginStorage`)     | ✅           | ✅           | ✅            |
| Single event (`usePluginEvent`)             | ✅           | ✅           |               |
| Multi-event (`usePluginEvents`)             |              |              | ✅            |
| Context menu contribution                   | ✅           |              |               |
| Settings dialog                             | ✅           | ✅           | ✅            |
| Lifecycle: `onLoad` / `onUnload`            | ✅           |              | ✅            |
| Lifecycle: `onEnable` / `onDisable`         | ✅           |              | ✅            |
| Lifecycle: `onMount` / `onUnmount`          | ✅           | ✅           | ✅            |
| Lifecycle: `onActivate` / `onDeactivate`    | ✅           |              | ✅            |
| Declared permissions                        | `storage` `events` `context-menu` | `events` `storage` | `events` `storage` |
| Synthesises a host event from a handler     |              |              | ✅            |

## Permissions cheat-sheet

| Permission        | Required for                                         |
| ----------------- | ---------------------------------------------------- |
| `storage`         | `getPluginStorage` / `usePluginStorage` / `store.*`  |
| `events`          | `events.on(...)` / `usePluginEvent` / `usePluginEvents` |
| `context-menu`    | `registerContextMenu` / `unregisterContextMenu`      |
| `backend`         | `invokeBackend` (Tauri IPC to plugin's Rust crate)   |
| `filesystem-read` | Reading files outside the plugin's own directory     |
| `filesystem-write`| Writing files outside the plugin's own directory     |
| `network`         | `fetch` / WebSocket to non-localhost                 |
| `clipboard`       | `navigator.clipboard.readText/writeText`             |
| `notifications`   | `new Notification(...)` / host toast bridge          |

The host throws `PluginPermissionDeniedError` the first time a plugin
attempts a guarded operation without the matching grant. Catch it at
the boundary if you want to degrade gracefully.

## Lifecycle cheat-sheet

```
register         ─► onLoad          (once, after install)
enable toggle    ─► onEnable        (off → on)
disable toggle   ─► onDisable       (on → off)
uninstall        ─► onUnload        (once, before file removal)
panel mounts     ─► onMount         (every mount)
panel unmounts   ─► onUnmount       (every unmount)
panel activated  ─► onActivate      (focus)
panel deactivated─► onDeactivate    (blur)
```

All hooks receive a `PluginContext`:

```ts
interface PluginContext {
  pluginId: string
  pluginPath: string
  invokeBackend: (command: string, args?: Record<string, unknown>) => Promise<unknown>
}
```

`invokeBackend` throws when called from a lifecycle hook — backend IPC
is only valid from inside a mounted panel component. Lifecycle hooks
should use `getPluginStorage(pluginId)` and the `pluginEventBus`
singleton directly.

## Installing a sample

1. Create a folder under the host's plugins directory, e.g.
   `com.example.recent-notes/`.
2. Copy the sample's `index.tsx` (or the compiled `.js` if your
   build doesn't run TypeScript on plugin sources) into the folder.
3. Restart the host (or hit "Reload plugins" in the manager) and
   click "Install from folder" in the plugin manager.
4. Grant the requested permissions in the dialog that appears.

For local dev you can also hot-load a sample by importing its default
export into the host's dev bootstrap and pushing it through
`usePluginStore.getState().setPlugins([...])`.
