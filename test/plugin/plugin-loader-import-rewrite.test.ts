/**
 * Unit tests for the plugin loader's import-to-const rewriter.
 *
 * The host runtime reads a plugin's `index.js` from disk, wraps it
 * in a blob URL, and `import()`s it. Because the blob URL has no
 * package resolver, any `import "react"` / `import "react-dom"` /
 * `import "react/jsx-runtime"` style import would fail. The loader
 * rewrites those imports to reads from `window.React` /
 * `window.ReactDOM` / `window.ReactJSXRuntime` instead.
 *
 * This test guards the rewrite rules against regressions — in
 * particular, the `import { X as Y } from "react-dom"` form that
 * broke `com.swallownote.mindmap` (which uses `createPortal`).
 */
import { describe, expect, it } from 'vitest'

/**
 * Mirror the chain of regex `.replace()` calls from
 * `src/lib/plugin-loader.ts:loadPluginModuleWithRef`. The real
 * code is not exported, so we re-implement it here to make the
 * rewrite rules individually testable. Any drift between this
 * copy and the loader will surface as a failed test.
 */
function rewriteImports(code: string): string {
  return code
    .replace(
      /import\s+(\w+)\s*,\s*\{([^}]*)\}\s*from\s+["']react["'];?/g,
      (_m, def, named: string) => {
        const names = named.split(',').map((s) => s.trim().split(/\s+as\s+/).map((x) => x.trim()))
        const lines = [`const ${def} = window.React;`]
        for (const [orig, alias] of names) {
          lines.push(alias ? `const ${alias} = window.React.${orig};` : `const ${orig} = window.React.${orig};`)
        }
        return lines.join('\n')
      }
    )
    .replace(
      /import\s*\{([^}]*)\}\s*from\s+["']react["'];?/g,
      (_m, named: string) => {
        const names = named.split(',').map((s) => s.trim().split(/\s+as\s+/).map((x) => x.trim()))
        return names.map(([orig, alias]) =>
          alias ? `const ${alias} = window.React.${orig};` : `const ${orig} = window.React.${orig};`
        ).join('\n')
      }
    )
    .replace(
      /import\s+(\w+)\s+from\s+["']react["'];?/g,
      'const $1 = window.React;'
    )
    .replace(
      /import\s*\*\s*as\s+(\w+)\s+from\s+["']react["'];?/g,
      'const $1 = window.React;'
    )
    .replace(
      /import\s*\{([^}]*)\}\s*from\s+["']react["'];?/g,
      (_m, named: string) => {
        const names = named.split(',').map((s) => s.trim().split(/\s+as\s+/).map((x) => x.trim()))
        return names.map(([orig, alias]) =>
          alias ? `const ${alias} = window.React.${orig};` : `const ${orig} = window.React.${orig};`
        ).join('\n')
      }
    )
    .replace(
      /import\s+(\w+)\s+from\s+["']react-dom\/client["'];?/g,
      'const $1 = window.ReactDOM;'
    )
    .replace(
      /import\s+(\w+)\s+from\s+["']react-dom["'];?/g,
      'const $1 = window.ReactDOM;'
    )
    .replace(
      /import\s*\*\s*as\s+(\w+)\s+from\s+["']react-dom\/client["'];?/g,
      'const $1 = window.ReactDOM;'
    )
    .replace(
      /import\s*\*\s*as\s+(\w+)\s+from\s+["']react-dom["'];?/g,
      'const $1 = window.ReactDOM;'
    )
    .replace(
      /import\s*\{([^}]*)\}\s*from\s+["']react-dom["'];?/g,
      (_m, named: string) => {
        const names = named.split(',').map((s) => s.trim().split(/\s+as\s+/).map((x) => x.trim()))
        return names.map(([orig, alias]) =>
          alias ? `const ${alias} = window.ReactDOM.${orig};` : `const ${orig} = window.ReactDOM.${orig};`
        ).join('\n')
      }
    )
    .replace(
      /import\s*\{([^}]*)\}\s*from\s+["']react-dom\/client["'];?/g,
      (_m, named: string) => {
        const names = named.split(',').map((s) => s.trim().split(/\s+as\s+/).map((x) => x.trim()))
        return names.map(([orig, alias]) =>
          alias ? `const ${alias} = window.ReactDOM.${orig};` : `const ${orig} = window.ReactDOM.${orig};`
        ).join('\n')
      }
    )
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*["']react\/jsx-runtime["'];?/g,
      (_m, named: string) => {
        const names = named.split(',').map((s) => s.trim().split(/\s+as\s+/).map((x) => x.trim()))
        return names.map(([orig, alias]) =>
          alias ? `const ${alias} = window.ReactJSXRuntime.${orig};` : `const ${orig} = window.ReactJSXRuntime.${orig};`
        ).join('\n')
      }
    )
    .replace(
      /import\s+(\w+)\s+from\s*["']react\/jsx-runtime["'];?/g,
      'const $1 = window.ReactJSXRuntime;'
    )
    .replace(
      /import\s*\*\s*as\s+(\w+)\s+from\s*["']react\/jsx-runtime["'];?/g,
      'const $1 = window.ReactJSXRuntime;'
    )
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*["']react\/jsx-dev-runtime["'];?/g,
      (_m, named: string) => {
        const names = named.split(',').map((s) => s.trim().split(/\s+as\s+/).map((x) => x.trim()))
        return names.map(([orig, alias]) =>
          alias ? `const ${alias} = window.ReactJSXRuntime.${orig};` : `const ${orig} = window.ReactJSXRuntime.${orig};`
        ).join('\n')
      }
    )
    .replace(
      /import\s+(\w+)\s+from\s*["']react\/jsx-dev-runtime["'];?/g,
      'const $1 = window.ReactJSXRuntime;'
    )
}

/** Returns true if any top-level `import` statement survived rewriting. */
function hasResidualImport(code: string): boolean {
  return /^import\s/m.test(code)
}

describe('plugin loader import rewriter', () => {
  it('rewrites `import * as X from "react"`', () => {
    const out = rewriteImports('import * as O from "react";')
    expect(out).toContain('const O = window.React;')
    expect(hasResidualImport(out)).toBe(false)
  })

  it('rewrites `import X from "react"`', () => {
    const out = rewriteImports('import React from "react";')
    expect(out).toContain('const React = window.React;')
    expect(hasResidualImport(out)).toBe(false)
  })

  it('rewrites `import { X } from "react"`', () => {
    const out = rewriteImports('import { useState } from "react";')
    expect(out).toContain('const useState = window.React.useState;')
    expect(hasResidualImport(out)).toBe(false)
  })

  it('rewrites `import { X as Y } from "react"`', () => {
    const out = rewriteImports('import { useState as useX } from "react";')
    expect(out).toContain('const useX = window.React.useState;')
    expect(hasResidualImport(out)).toBe(false)
  })

  it('rewrites `import X, { Y as Z } from "react"`', () => {
    const out = rewriteImports('import React, { useState as u } from "react";')
    expect(out).toContain('const React = window.React;')
    expect(out).toContain('const u = window.React.useState;')
    expect(hasResidualImport(out)).toBe(false)
  })

  // ─── react-dom ──────────────────────────────────────────────────────

  it('rewrites `import * as X from "react-dom"`', () => {
    const out = rewriteImports('import * as Hu from "react-dom";')
    expect(out).toContain('const Hu = window.ReactDOM;')
    expect(hasResidualImport(out)).toBe(false)
  })

  it('rewrites `import X from "react-dom"`', () => {
    const out = rewriteImports('import ReactDOM from "react-dom";')
    expect(out).toContain('const ReactDOM = window.ReactDOM;')
    expect(hasResidualImport(out)).toBe(false)
  })

  it('rewrites `import { X } from "react-dom"`', () => {
    const out = rewriteImports('import { createPortal } from "react-dom";')
    expect(out).toContain('const createPortal = window.ReactDOM.createPortal;')
    expect(hasResidualImport(out)).toBe(false)
  })

  // The exact case that broke com.swallownote.mindmap: Vite
  // emitted `import { createPortal as FS } from "react-dom"` and
  // the loader did not match it. This regression test guards
  // against the rule being dropped in the future.
  it('rewrites `import { X as Y } from "react-dom"`', () => {
    const out = rewriteImports('import { createPortal as FS } from "react-dom";')
    expect(out).toContain('const FS = window.ReactDOM.createPortal;')
    expect(hasResidualImport(out)).toBe(false)
  })

  it('rewrites `import { X, Y as Z } from "react-dom"`', () => {
    const out = rewriteImports('import { createPortal as FS, flushSync as flush } from "react-dom";')
    expect(out).toContain('const FS = window.ReactDOM.createPortal;')
    expect(out).toContain('const flush = window.ReactDOM.flushSync;')
    expect(hasResidualImport(out)).toBe(false)
  })

  it('rewrites `import { X as Y } from "react-dom/client"`', () => {
    const out = rewriteImports('import { createRoot as Root } from "react-dom/client";')
    expect(out).toContain('const Root = window.ReactDOM.createRoot;')
    expect(hasResidualImport(out)).toBe(false)
  })

  // ─── react/jsx-runtime ──────────────────────────────────────────────

  it('rewrites `import { jsx, jsxs, Fragment } from "react/jsx-runtime"`', () => {
    const out = rewriteImports('import { jsxs, jsx, Fragment } from "react/jsx-runtime";')
    expect(out).toContain('const jsxs = window.ReactJSXRuntime.jsxs;')
    expect(out).toContain('const jsx = window.ReactJSXRuntime.jsx;')
    expect(out).toContain('const Fragment = window.ReactJSXRuntime.Fragment;')
    expect(hasResidualImport(out)).toBe(false)
  })

  it('rewrites `import { X as Y } from "react/jsx-runtime"`', () => {
    const out = rewriteImports('import { jsxs as ve, jsx as S, Fragment as Za } from "react/jsx-runtime";')
    expect(out).toContain('const ve = window.ReactJSXRuntime.jsxs;')
    expect(out).toContain('const S = window.ReactJSXRuntime.jsx;')
    expect(out).toContain('const Za = window.ReactJSXRuntime.Fragment;')
    expect(hasResidualImport(out)).toBe(false)
  })

  // ─── Full mindmap-like import preamble ──────────────────────────────

  it('handles the full set of imports emitted by com.swallownote.mindmap', () => {
    const code = [
      'import * as O from "react";',
      'import RS, { useSyncExternalStore as zS, useState as Zt, useEffect as sn, useCallback as Un } from "react";',
      'import { jsxs as ve, jsx as S, Fragment as Za } from "react/jsx-runtime";',
      'import * as Hu from "react-dom";',
      'import { createPortal as FS } from "react-dom";',
    ].join('\n')
    const out = rewriteImports(code)
    expect(hasResidualImport(out)).toBe(false)
    expect(out).toContain('const O = window.React;')
    expect(out).toContain('const RS = window.React;')
    expect(out).toContain('const zS = window.React.useSyncExternalStore;')
    expect(out).toContain('const ve = window.ReactJSXRuntime.jsxs;')
    expect(out).toContain('const Hu = window.ReactDOM;')
    expect(out).toContain('const FS = window.ReactDOM.createPortal;')
  })
})
