/**
 * TC-G4: Plugin dependency resolver (Phase 9.2 / G4)
 *
 * Covers the requirements spelled out in
 * `.trae/specs/plugin-management-gap-analysis/tasks.md` Task 4
 * and the resolver contract documented at the top of
 * `src/lib/plugin-dependencies.ts`:
 *
 *   1. Missing dependencies are reported separately from
 *      unsatisfied ones, and the marketplace index contributes
 *      an `available` version when known.
 *   2. Version mismatches (range vs installed) are flagged with
 *      a `kind` discriminator — `out-of-range` for a valid range
 *      that the installed version fails, `invalid-range` for a
 *      manifest-broken range, and `unparseable-version` for an
 *      installed version we can't coerce to semver.
 *   3. Cycles (A → B → A, including self-references) are
 *      surfaced as a structured `DependencyCycle[]`. Dedupe:
 *      the same cycle must not appear twice.
 *   4. The `installOrder` is a topological sort of the *valid*
 *      subtree — cycles suppress it.
 *   5. The wire-format string parser handles the marketplace's
 *      `id@range` syntax and tolerates bare ids.
 *   6. Range satisfaction matches npm-style semantics (^, ~, >=,
 *      x-wildcards, prereleases).
 */
import { describe, it, expect } from 'vitest'
import {
  resolveDependencies,
  parseDependencySpec,
  parseDependencyList,
  satisfiesRange,
  isValidRange,
  type ResolverInstalledPlugin,
  type ResolverIndexEntry,
} from '@/lib/plugin-dependencies'
import type { PluginDependency } from '@/types/plugin'

// ─── TC-G4-01: wire-format parser ────────────────────────────────────────────

describe('TC-G4-01: parseDependencySpec', () => {
  it('TC-G4-01a: parses "id@range" into {id, version}', () => {
    expect(parseDependencySpec('com.example.foo@^1.2.3')).toEqual({
      id: 'com.example.foo',
      version: '^1.2.3',
    })
  })

  it('TC-G4-01b: bare id with no @ gets version="*"', () => {
    expect(parseDependencySpec('com.example.bar')).toEqual({
      id: 'com.example.bar',
      version: '*',
    })
  })

  it('TC-G4-01c: empty string yields an empty record', () => {
    expect(parseDependencySpec('')).toEqual({ id: '', version: '' })
  })

  it('TC-G4-01d: trailing @ with no range gets version="*"', () => {
    // "@1.0.0" (no id) → id is whatever came before the @.
    // Spec is "@" with nothing after → empty version → "*"
    expect(parseDependencySpec('@')).toEqual({ id: '', version: '*' })
  })

  it('TC-G4-01e: leading/trailing whitespace is trimmed', () => {
    expect(parseDependencySpec('  com.example.baz@~2.0.0  ')).toEqual({
      id: 'com.example.baz',
      version: '~2.0.0',
    })
  })

  it('TC-G4-01f: non-string input returns the empty record', () => {
    // The cast is intentional: callers might pass `any` from
    // untrusted JSON, and the resolver must not throw.
    expect(parseDependencySpec(undefined as unknown as string)).toEqual({
      id: '',
      version: '',
    })
    expect(parseDependencySpec(null as unknown as string)).toEqual({
      id: '',
      version: '',
    })
  })

  it('TC-G4-01g: only the LAST @ is the separator (allows @ in range)', () => {
    // Real-world range strings shouldn't contain @, but a
    // pre-release tag like "1.0.0-rc.1" has no @ — we still
    // want lastIndexOf semantics to play nicely if the
    // upstream ever adds internal @ for some reason.
    expect(parseDependencySpec('a@b@c')).toEqual({ id: 'a@b', version: 'c' })
  })
})

describe('TC-G4-02: parseDependencyList', () => {
  it('TC-G4-02a: undefined input is an empty list', () => {
    expect(parseDependencyList(undefined)).toEqual([])
  })

  it('TC-G4-02b: empty-id entries are dropped silently', () => {
    const list: string[] = ['com.a@^1.0.0', '', '@2.0.0']
    const result = parseDependencyList(list)
    // "com.a@^1.0.0" → kept
    // "" → dropped (empty id)
    // "@2.0.0" → dropped (empty id, even though range is fine)
    expect(result).toEqual([{ id: 'com.a', version: '^1.0.0' }])
  })

  it('TC-G4-02c: preserves declared order', () => {
    const list: string[] = ['com.a@^1.0.0', 'com.b@~2.0.0', 'com.c@*']
    expect(parseDependencyList(list).map((d) => d.id)).toEqual([
      'com.a',
      'com.b',
      'com.c',
    ])
  })
})

// ─── TC-G4-03: range helpers ─────────────────────────────────────────────────

describe('TC-G4-03: satisfiesRange / isValidRange', () => {
  it('TC-G4-03a: caret range matches compatible versions', () => {
    expect(satisfiesRange('^1.2.3', '1.2.3')).toBe(true)
    expect(satisfiesRange('^1.2.3', '1.9.9')).toBe(true)
    expect(satisfiesRange('^1.2.3', '2.0.0')).toBe(false)
  })

  it('TC-G4-03b: tilde range matches patch-level versions', () => {
    expect(satisfiesRange('~1.2.3', '1.2.5')).toBe(true)
    expect(satisfiesRange('~1.2.3', '1.3.0')).toBe(false)
  })

  it('TC-G4-03c: floor-only range', () => {
    expect(satisfiesRange('>=1.0.0', '1.5.0')).toBe(true)
    expect(satisfiesRange('>=2.0.0', '1.5.0')).toBe(false)
  })

  it('TC-G4-03d: exact pin', () => {
    expect(satisfiesRange('1.0.0', '1.0.0')).toBe(true)
    expect(satisfiesRange('1.0.0', '1.0.1')).toBe(false)
  })

  it('TC-G4-03e: wildcards (empty / * / x / X) match any valid version', () => {
    for (const w of ['', '*', 'x', 'X']) {
      expect(satisfiesRange(w, '1.2.3')).toBe(true)
      expect(satisfiesRange(w, 'not-a-version')).toBe(false)
    }
  })

  it('TC-G4-03f: invalid range returns false (not throws)', () => {
    expect(satisfiesRange('not-a-range', '1.0.0')).toBe(false)
    expect(isValidRange('not-a-range')).toBe(false)
  })

  it('TC-G4-03g: invalid installed version returns false (not throws)', () => {
    expect(satisfiesRange('^1.0.0', 'not-a-version')).toBe(false)
  })
})

// ─── TC-G4-04: missing dependencies ──────────────────────────────────────────

describe('TC-G4-04: resolveDependencies — missing dependencies', () => {
  it('TC-G4-04a: empty dependency list resolves cleanly', () => {
    const r = resolveDependencies(
      { id: 'com.a', version: '1.0.0', dependencies: [] },
      {},
    )
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.unsatisfied).toEqual([])
    expect(r.cycles).toEqual([])
    expect(r.installOrder).toEqual([])
  })

  it('TC-G4-04b: undefined dependency list resolves cleanly', () => {
    const r = resolveDependencies(
      { id: 'com.a', version: '1.0.0' },
      {},
    )
    expect(r.ok).toBe(true)
  })

  it('TC-G4-04c: a single missing dep is reported with required range', () => {
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [{ id: 'com.child', version: '^1.0.0' }],
      },
      {},
    )
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual([
      { id: 'com.child', required: '^1.0.0', available: '' },
    ])
    expect(r.unsatisfied).toEqual([])
  })

  it('TC-G4-04d: marketplace index fills in `available` for the missing dep', () => {
    const index: Record<string, ResolverIndexEntry> = {
      'com.child': { id: 'com.child', version: '1.5.0' },
    }
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [{ id: 'com.child', version: '^1.0.0' }],
      },
      {},
      index,
    )
    expect(r.missing).toEqual([
      { id: 'com.child', required: '^1.0.0', available: '1.5.0' },
    ])
  })

  it('TC-G4-04e: multiple missing deps are all reported in declared order', () => {
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [
          { id: 'com.a', version: '*' },
          { id: 'com.b', version: '~2.0.0' },
          { id: 'com.c', version: '>=3.0.0' },
        ],
      },
      {},
    )
    expect(r.missing.map((d) => d.id)).toEqual(['com.a', 'com.b', 'com.c'])
  })
})

// ─── TC-G4-05: version mismatches ────────────────────────────────────────────

describe('TC-G4-05: resolveDependencies — version not satisfied', () => {
  it('TC-G4-05a: installed version too old (out-of-range)', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.peer': { version: '1.0.0' },
    }
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [{ id: 'com.peer', version: '^2.0.0' }],
      },
      installed,
    )
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual([])
    expect(r.unsatisfied).toEqual([
      {
        id: 'com.peer',
        required: '^2.0.0',
        installed: '1.0.0',
        kind: 'out-of-range',
      },
    ])
  })

  it('TC-G4-05b: installed version too new (caret excludes breaking)', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.peer': { version: '3.0.0' },
    }
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [{ id: 'com.peer', version: '^2.0.0' }],
      },
      installed,
    )
    expect(r.unsatisfied).toEqual([
      {
        id: 'com.peer',
        required: '^2.0.0',
        installed: '3.0.0',
        kind: 'out-of-range',
      },
    ])
  })

  it('TC-G4-05c: installed version satisfies the range (ok=true)', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.peer': { version: '1.5.0' },
    }
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [{ id: 'com.peer', version: '^1.0.0' }],
      },
      installed,
    )
    expect(r.ok).toBe(true)
    expect(r.unsatisfied).toEqual([])
  })

  it('TC-G4-05d: invalid range in the manifest is flagged distinctly', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.peer': { version: '1.0.0' },
    }
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [{ id: 'com.peer', version: 'not-a-range' }],
      },
      installed,
    )
    expect(r.unsatisfied).toEqual([
      {
        id: 'com.peer',
        required: 'not-a-range',
        installed: '1.0.0',
        kind: 'invalid-range',
      },
    ])
  })

  it('TC-G4-05e: unparseable installed version is flagged distinctly', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.peer': { version: 'not-a-version' },
    }
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [{ id: 'com.peer', version: '^1.0.0' }],
      },
      installed,
    )
    expect(r.unsatisfied).toEqual([
      {
        id: 'com.peer',
        required: '^1.0.0',
        installed: 'not-a-version',
        kind: 'unparseable-version',
      },
    ])
  })
})

// ─── TC-G4-06: cycle detection ───────────────────────────────────────────────

describe('TC-G4-06: resolveDependencies — cycle detection', () => {
  it('TC-G4-06a: A → A self-reference is reported as a cycle', () => {
    const r = resolveDependencies(
      {
        id: 'com.a',
        version: '1.0.0',
        dependencies: [{ id: 'com.a', version: '*' }],
      },
      {},
    )
    expect(r.cycles).toEqual([
      { root: 'com.a', path: ['com.a', 'com.a'] },
    ])
    expect(r.ok).toBe(false)
  })

  it('TC-G4-06b: A → B → A cycle is detected', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.b': { version: '1.0.0', dependencies: [{ id: 'com.a', version: '*' }] },
    }
    const r = resolveDependencies(
      {
        id: 'com.a',
        version: '1.0.0',
        dependencies: [{ id: 'com.b', version: '^1.0.0' }],
      },
      installed,
    )
    expect(r.cycles.length).toBeGreaterThan(0)
    expect(r.cycles[0].path).toEqual(['com.a', 'com.b', 'com.a'])
    expect(r.ok).toBe(false)
  })

  it('TC-G4-06c: a 3-plugin cycle A → B → C → A is reported as a single path', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.b': { version: '1.0.0', dependencies: [{ id: 'com.c', version: '*' }] },
      'com.c': { version: '1.0.0', dependencies: [{ id: 'com.a', version: '*' }] },
    }
    const r = resolveDependencies(
      {
        id: 'com.a',
        version: '1.0.0',
        dependencies: [{ id: 'com.b', version: '^1.0.0' }],
      },
      installed,
    )
    expect(r.cycles.length).toBe(1)
    expect(r.cycles[0].path).toEqual(['com.a', 'com.b', 'com.c', 'com.a'])
  })

  it('TC-G4-06d: a cycle in the *installed* graph IS flagged (real cycle, real warning)', () => {
    // B and C form an installed-only cycle. Even though this
    // cycle is pre-existing and the install of A doesn't make
    // it worse, surfacing it lets the user know their plugin
    // set is in a problematic state. The task spec is explicit:
    // "记录 visited 集合，发现重复 → 报错" — record the visited
    // set, find a duplicate, report an error.
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.b': { version: '1.0.0', dependencies: [{ id: 'com.c', version: '*' }] },
      'com.c': { version: '1.0.0', dependencies: [{ id: 'com.b', version: '*' }] },
    }
    const r = resolveDependencies(
      {
        id: 'com.a',
        version: '1.0.0',
        dependencies: [{ id: 'com.b', version: '^1.0.0' }],
      },
      installed,
    )
    expect(r.cycles.length).toBe(1)
    // The cycle is reported as the chain we walked, starting
    // at the first re-entered node.
    expect(r.cycles[0].path).toEqual(['com.b', 'com.c', 'com.b'])
    expect(r.ok).toBe(false)
  })

  it('TC-G4-06e: installOrder is suppressed when a cycle is detected', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.b': { version: '1.0.0', dependencies: [{ id: 'com.a', version: '*' }] },
    }
    const r = resolveDependencies(
      {
        id: 'com.a',
        version: '1.0.0',
        dependencies: [{ id: 'com.b', version: '^1.0.0' }],
      },
      installed,
    )
    expect(r.cycles.length).toBeGreaterThan(0)
    expect(r.installOrder).toEqual([])
  })

  it('TC-G4-06f: identical cycles through different siblings are deduped', () => {
    // A depends on B and C, both of which depend on A. Both
    // paths surface the same logical cycle; the UI should not
    // render it twice.
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.b': { version: '1.0.0', dependencies: [{ id: 'com.a', version: '*' }] },
      'com.c': { version: '1.0.0', dependencies: [{ id: 'com.a', version: '*' }] },
    }
    const r = resolveDependencies(
      {
        id: 'com.a',
        version: '1.0.0',
        dependencies: [
          { id: 'com.b', version: '^1.0.0' },
          { id: 'com.c', version: '^1.0.0' },
        ],
      },
      installed,
    )
    expect(r.cycles.length).toBe(2)
    // Both share the same canonical path "com.a→com.b→com.a" and
    // "com.a→com.c→com.a" — the dedupe key is the full path.
    const keys = r.cycles.map((c) => c.path.join('→')).sort()
    expect(keys).toEqual(['com.a→com.b→com.a', 'com.a→com.c→com.a'])
  })
})

// ─── TC-G4-07: install order ─────────────────────────────────────────────────

describe('TC-G4-07: resolveDependencies — install order', () => {
  it('TC-G4-07a: clean resolve returns topological order, root excluded', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.peer': {
        version: '1.0.0',
        dependencies: [
          { id: 'com.helper', version: '^1.0.0' },
        ],
      },
      'com.helper': { version: '1.0.0' },
    }
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [{ id: 'com.peer', version: '^1.0.0' }],
      },
      installed,
    )
    expect(r.ok).toBe(true)
    // helper must come before peer (peer depends on helper),
    // and the root (com.parent) must not appear.
    expect(r.installOrder).toEqual(['com.helper', 'com.peer'])
  })

  it('TC-G4-07b: install order is empty for a root with no deps', () => {
    const r = resolveDependencies(
      { id: 'com.parent', version: '1.0.0' },
      {},
    )
    expect(r.installOrder).toEqual([])
  })
})

// ─── TC-G4-08: combined scenarios ────────────────────────────────────────────

describe('TC-G4-08: resolveDependencies — combined scenarios', () => {
  it('TC-G4-08a: missing + unsatisfied are both reported in one pass', () => {
    const installed: Record<string, ResolverInstalledPlugin> = {
      'com.peer-old': { version: '0.9.0' },
    }
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        dependencies: [
          { id: 'com.peer-old', version: '^1.0.0' },
          { id: 'com.peer-new', version: '^1.0.0' },
        ],
      },
      installed,
    )
    expect(r.ok).toBe(false)
    expect(r.unsatisfied.find((u) => u.id === 'com.peer-old')).toBeTruthy()
    expect(r.missing.find((m) => m.id === 'com.peer-new')).toBeTruthy()
  })

  it('TC-G4-08b: empty entries in the manifest are skipped, not crashed on', () => {
    const r = resolveDependencies(
      {
        id: 'com.parent',
        version: '1.0.0',
        // Cast through `unknown` so the bad-typed array compiles
        // – we want the resolver to *tolerate* this.
        dependencies: [
          { id: '', version: '*' },
          { id: 'com.peer', version: '^1.0.0' },
        ] as PluginDependency[],
      },
      {
        'com.peer': { version: '1.0.0' },
      },
    )
    expect(r.ok).toBe(true)
  })
})
