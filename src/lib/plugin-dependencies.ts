/**
 * Plugin dependency resolver (G4).
 *
 * Background
 * ----------
 *
 * A plugin manifest can declare peer-plugin dependencies
 * (`PluginDependency[]`, see `src/types/plugin.ts`). The host has to
 * guarantee that, at install time, every declared dependency is
 * already present on disk *and* satisfies the requested semver
 * range. Otherwise the new plugin would crash the first time it
 * tries to talk to a peer that's missing or on a different
 * version.
 *
 * This module is the *pure* layer of that check. Given:
 *
 *   - the manifest of the plugin we're about to install
 *     (id + version + dependency list)
 *   - the catalog of every plugin already installed locally
 *     (`id → { version, dependencies? }`)
 *   - the marketplace index (used to look up a missing dep so the
 *     "auto-resolve" affordance in the UI can offer to install it)
 *
 * …it returns a structured `DependencyResolution` describing:
 *
 *   - which dependencies are missing entirely
 *   - which are present but at the wrong version
 *   - which dependencies form a cycle (A → B → A)
 *   - which can be auto-resolved from the marketplace index
 *   - the flattened install order (a topological sort of the
 *     transitive closure) for callers that want to drive a
 *     sequenced install
 *
 * The function is deliberately *pure* — no Tauri calls, no
 * mutation, no async. It's invoked synchronously from the
 * `PluginMarketDetail` install handler and from the unit tests
 * in `test/plugin/plugin-dependencies.test.ts`.
 *
 * Semver notes
 * ------------
 *
 * The range field follows npm/node-semver syntax (see
 * `https://github.com/npm/node-semver#ranges`). Wildcards
 * (`*`, `x`, `X`, empty string) match any version. Invalid
 * ranges surface as a `{ kind: 'invalid-range' }` entry under
 * `unsatisfied` so the UI can show a clear error and the plugin
 * author can be told their manifest is broken.
 */
import semver from 'semver'
import type { PluginDependency } from '@/types/plugin'

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A snapshot of one locally-installed plugin as far as the
 * resolver cares. `version` is the semver string reported by the
 * host (from `PluginMetadata.version`); `dependencies` is the
 * manifest's transitive dependency list and is only consulted for
 * cycle detection across the full graph.
 */
export interface ResolverInstalledPlugin {
  version: string
  /** Optional transitive dependencies. Required for accurate
   *  cycle detection in the full plugin graph. */
  dependencies?: PluginDependency[]
}

/**
 * A snapshot of the marketplace index as far as the resolver
 * cares. We don't import `PluginIndex` here to keep this module
 * dependency-free and easy to unit-test (passing a plain
 * `Record<string, ResolverIndexEntry>` is enough).
 */
export interface ResolverIndexEntry {
  id: string
  version: string
}

/**
 * One missing dependency that *can* be satisfied by installing a
 * plugin from the marketplace index. The UI's "auto-resolve"
 * button iterates this list and triggers an install for each.
 */
export interface ResolvableDependency {
  id: string
  /** What the parent manifest required. */
  required: string
  /** What the marketplace index actually offers. */
  available: string
}

/**
 * A dependency that's present locally but doesn't satisfy the
 * requested range. Surfaced to the user so they know an
 * `auto-resolve` is *not* going to fix it (the marketplace may
 * not ship a newer build, or the local install is too new).
 */
export interface UnsatisfiedDependency {
  id: string
  required: string
  installed: string
  /** Why the installed version didn't satisfy the range.
   *  `invalid-range` means the manifest's range is itself
   *  unparseable and needs to be fixed in the upstream manifest. */
  kind: 'out-of-range' | 'invalid-range' | 'unparseable-version'
}

/**
 * A detected dependency cycle. `path` lists the plugin ids from
 * the parent's manifest back to itself, e.g. `["A", "B", "C", "A"]`
 * means A depends on B which depends on C which depends on A. The
 * install must be aborted — there's no valid order to install in.
 */
export interface DependencyCycle {
  /** Plugin id where the cycle started (== where the cycle closes). */
  root: string
  /** The full chain, including the duplicated `root` at the end. */
  path: string[]
}

/**
 * The structured result of `resolveDependencies`. `ok` is the
 * shorthand every caller wants: it means `missing.length === 0 &&
 * unsatisfied.length === 0 && cycles.length === 0`. Individual
 * buckets are exposed for richer UI rendering.
 */
export interface DependencyResolution {
  ok: boolean
  /** Dependencies that aren't installed at all. Each entry
   *  includes the marketplace `available` version when one is
   *  found in `index` (so the UI can offer an "auto-resolve"
   *  install). */
  missing: ResolvableDependency[]
  /** Dependencies that are installed but at the wrong version. */
  unsatisfied: UnsatisfiedDependency[]
  /** Dependency cycles that would prevent a clean install. */
  cycles: DependencyCycle[]
  /** Topological install order across the full transitive
   *  closure, excluding the root plugin itself. Callers that
   *  want to install missing deps *first* can read this list in
   *  order; the first item has no further dependencies among
   *  the set, and the last item is the direct child of the root.
   *  Only populated when no cycles were detected. */
  installOrder: string[]
  /** The root manifest as the resolver saw it (id + declared
   *  dependencies). Useful for diagnostics + tests. */
  root: {
    id: string
    version: string
    dependencies: PluginDependency[]
  }
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

/**
 * Parse a wire-format dependency string into a `PluginDependency`.
 *
 * The marketplace wire format (see `docs/plugin-marketplace/README.md`
 * and the sample `plugins/repo.json`) carries dependencies as
 * `"<id>@<range>"` strings — e.g. `"com.swallownote.export@^1.0.0"`.
 * Bare `"com.swallownote.export"` (no `@`) is also accepted: the
 * missing range becomes `*`, meaning "any version". Trailing
 * whitespace is trimmed. The function never throws; on parse
 * failure it returns `{ id: '', version: '' }` so the caller can
 * skip the entry without a try/catch.
 */
export function parseDependencySpec(spec: string): PluginDependency {
  if (typeof spec !== 'string') return { id: '', version: '' }
  const trimmed = spec.trim()
  if (!trimmed) return { id: '', version: '' }
  const at = trimmed.lastIndexOf('@')
  // No `@` at all: the whole string is the id, with `*` as the
  // implicit "any version" range. Matches the npm convention of
  // `npm i <id>` picking up the latest version automatically.
  if (at < 0) {
    return { id: trimmed, version: '*' }
  }
  // `@` at position 0: there is no id, only a range. The caller
  // (`parseDependencyList`) drops empty-id entries, so this path
  // surfaces as a silent skip rather than a half-built
  // dependency.
  if (at === 0) {
    return { id: '', version: trimmed.slice(1).trim() || '*' }
  }
  return {
    id: trimmed.slice(0, at).trim(),
    version: trimmed.slice(at + 1).trim() || '*',
  }
}

/**
 * Convenience: normalise a marketplace index entry's
 * `dependencies: string[]` into `PluginDependency[]`. Malformed
 * entries (empty id) are dropped.
 */
export function parseDependencyList(specs: readonly string[] | undefined): PluginDependency[] {
  if (!specs) return []
  const out: PluginDependency[] = []
  for (const s of specs) {
    const dep = parseDependencySpec(s)
    if (dep.id) out.push(dep)
  }
  return out
}

// ─── Semver helpers ──────────────────────────────────────────────────────────

/**
 * `true` when `range` matches `version` according to node-semver.
 * Empty / `*` / `x` / `X` ranges match any non-empty version. An
 * invalid range returns `false` so the caller can flag the
 * manifest rather than silently accepting it.
 */
export function satisfiesRange(range: string, version: string): boolean {
  const r = (range || '').trim() || '*'
  if (!version) return false
  // Wildcard shorthands: any of these matches any non-empty
  // version. The semver library already handles `*`, `x`, `X`,
  // and empty string in `satisfies`, but we short-circuit them
  // so a malformed version on the installed side doesn't crash.
  if (r === '*' || r === 'x' || r === 'X' || r === '') {
    return semver.valid(version) !== null
  }
  const parsedRange = semver.validRange(r)
  if (parsedRange === null) return false
  const parsedVersion = semver.valid(version)
  if (parsedVersion === null) return false
  return semver.satisfies(parsedVersion, parsedRange, { includePrerelease: true })
}

/**
 * Sanity-check that a range string is parseable. Used by the
 * resolver to flag "the manifest's range is broken" as a
 * distinct error from "the installed version is too old".
 */
export function isValidRange(range: string): boolean {
  const r = (range || '').trim() || '*'
  if (r === '*' || r === 'x' || r === 'X' || r === '') return true
  return semver.validRange(r) !== null
}

// ─── Core resolver ───────────────────────────────────────────────────────────

/**
 * Resolve the dependency graph rooted at `root`.
 *
 * The resolver walks the manifest's declared dependencies, then
 * recursively descends into the installed-plugin catalog to
 * detect cycles. It does **not** recurse into the marketplace
 * index — the index is only consulted to compute `available` for
 * missing deps. The `installOrder` is a topological sort of
 * the installed subtree (which is what we actually have to
 * guarantee is in a consistent state); transitive *missing*
 * dependencies are appended in their declared order at the end.
 *
 * Parameters
 * ----------
 * - `root` — the manifest of the plugin we're about to install
 * - `installed` — a map of plugin id → installed info, typically
 *                 built from the live `usePluginStore` + Rust
 *                 metadata. Only id + version are required for the
 *                 basic check; `dependencies` are needed for
 *                 cycle detection across the *installed* graph.
 * - `index` — optional marketplace index for "auto-resolve"
 *             hints. A missing dep that *is* in the index is
 *             reported in `missing[*].available`; one that isn't
 *             is reported with `available: ''` and the UI's
 *             auto-resolve affordance surfaces an "unknown
 *             source" warning.
 */
export function resolveDependencies(
  root: {
    id: string
    version: string
    dependencies?: PluginDependency[]
  },
  installed: Readonly<Record<string, ResolverInstalledPlugin>>,
  index?: Readonly<Record<string, ResolverIndexEntry>>,
): DependencyResolution {
  const declared: PluginDependency[] = Array.isArray(root.dependencies)
    ? root.dependencies
    : []

  const result: DependencyResolution = {
    ok: true,
    missing: [],
    unsatisfied: [],
    cycles: [],
    installOrder: [],
    root: { id: root.id, version: root.version, dependencies: declared },
  }

  // Walk the *declared* dependencies first. For each one we
  // check missing / unsatisfied / cycle-before-resolving. Cycle
  // detection happens at the end of the walk so we can return
  // every problem in one pass.
  //
  // Two sets drive the walk:
  //
  //   - `visitedStack` (array) — the chain of plugin ids we're
  //     currently inside, from the root down. Re-entering an id
  //     already on the stack means a cycle through the *current*
  //     install path; the rest of the array is the cycle itself.
  //     This is what gets reported as a `DependencyCycle.path`.
  //
  //   - `completed` (set) — plugin ids we've fully finished
  //     processing (post-order). When we re-enter a completed
  //     node from a different sibling we skip it: its subtree
  //     was already validated and added to `ordered` in the
  //     correct position.
  const visitedStack: string[] = [root.id]
  const completed = new Set<string>([root.id])
  const ordered: string[] = []

  const visit = (pluginId: string, dep: PluginDependency): void => {
    // ── Self-reference: A → A. Cheap to detect, easy to surface.
    if (pluginId === root.id) {
      result.cycles.push({ root: root.id, path: [...visitedStack, pluginId] })
      return
    }
    // ── Cycle in the current path: e.g. A → B → C → B.
    // We only flag cycles that *involve* the current recursion
    // stack — if the installed graph contains a cycle between
    // two siblings we don't visit, that's a pre-existing
    // problem the install can't make worse, and flagging it
    // here would surface false positives.
    if (visitedStack.includes(pluginId)) {
      const startIdx = visitedStack.indexOf(pluginId)
      result.cycles.push({
        root: pluginId,
        path: [...visitedStack.slice(startIdx), pluginId],
      })
      return
    }

    // Already finished in a previous sibling's subtree — its
    // descendants are already in `ordered` in the right
    // position. No need to redo the work.
    if (completed.has(pluginId)) {
      return
    }

    const local = installed[pluginId]

    if (!local) {
      // Missing entirely. If the marketplace has it, fill in
      // `available` so the UI's auto-resolve button knows what
      // version to install. We do **not** recurse into the
      // index's declared dependencies — the index is treated as
      // a flat lookup for "what version could I install", not
      // as a full graph (resolving the index's own deps would
      // require fetching every plugin's manifest, which is
      // O(repo size)).
      const idxEntry = index?.[pluginId]
      result.missing.push({
        id: pluginId,
        required: dep.version,
        available: idxEntry?.version ?? '',
      })
      return
    }

    // Installed. Validate the range. A plugin author who ships
    // an unparseable range gets a clear `invalid-range` error
    // rather than a silent "uninstalled" report.
    if (!isValidRange(dep.version)) {
      result.unsatisfied.push({
        id: pluginId,
        required: dep.version,
        installed: local.version,
        kind: 'invalid-range',
      })
      // Don't recurse — the manifest is broken.
      return
    }

    if (!satisfiesRange(dep.version, local.version)) {
      // Distinguish "installed version is unparseable" from
      // "installed version is out of range". Both are real
      // problems but the diagnostic message is different.
      const kind: UnsatisfiedDependency['kind'] =
        semver.valid(local.version) === null
          ? 'unparseable-version'
          : 'out-of-range'
      result.unsatisfied.push({
        id: pluginId,
        required: dep.version,
        installed: local.version,
        kind,
      })
      return
    }

    // In range. Mark this node as in-progress (so re-entry from
    // a sibling is treated as "already done" and not a new
    // cycle), recurse into its declared dependencies, then add
    // it to `ordered` in post-order. Post-order guarantees that
    // every plugin's prerequisites appear before it in the
    // install list — the host can install top-to-bottom without
    // re-resolving.
    completed.add(pluginId)
    if (local.dependencies && local.dependencies.length > 0) {
      visitedStack.push(pluginId)
      try {
        for (const child of local.dependencies) {
          if (!child?.id) continue
          visit(child.id, child)
        }
      } finally {
        visitedStack.pop()
      }
    }
    ordered.push(pluginId)
  }

  for (const dep of declared) {
    if (!dep?.id) continue
    visit(dep.id, dep)
  }

  result.cycles = dedupeCycles(result.cycles)
  result.ok =
    result.missing.length === 0 &&
    result.unsatisfied.length === 0 &&
    result.cycles.length === 0
  result.installOrder = result.ok ? ordered : []
  return result
}

/**
 * Cycle paths can repeat (e.g. an A → B → A cycle is reported
 * both when we visit A directly and when we re-enter it from a
 * different sibling). Keep only the first occurrence so the UI
 * doesn't render the same cycle twice.
 */
function dedupeCycles(cycles: DependencyCycle[]): DependencyCycle[] {
  const seen = new Set<string>()
  const out: DependencyCycle[] = []
  for (const c of cycles) {
    const key = c.path.join('→')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}
