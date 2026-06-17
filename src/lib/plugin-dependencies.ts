/** 插件依赖解析器（G4），pure 函数。输出：DependencyResolution（missing/unsatisfied/cycles/installOrder）。 */
import semver from 'semver'
import type { PluginDependency } from '@/types/plugin'

// ─── Public types ─────────────────────────────────────────────────────────────

/** 本地已安装插件快照。 */
export interface ResolverInstalledPlugin {
  version: string
  /** Optional transitive dependencies. Required for accurate
   *  cycle detection in the full plugin graph. */
  dependencies?: PluginDependency[]
}

/** 市场索引快照。 */
export interface ResolverIndexEntry {
  id: string
  version: string
}

/** 可从市场安装的缺失依赖。 */
export interface ResolvableDependency {
  id: string
  /** What the parent manifest required. */
  required: string
  /** What the marketplace index actually offers. */
  available: string
}

/** 已安装但不满足 range 的依赖。 */
export interface UnsatisfiedDependency {
  id: string
  required: string
  installed: string
  /** Why the installed version didn't satisfy the range.
   *  `invalid-range` means the manifest's range is itself
   *  unparseable and needs to be fixed in the upstream manifest. */
  kind: 'out-of-range' | 'invalid-range' | 'unparseable-version'
}

/** 检测到的依赖循环。 */
export interface DependencyCycle {
  /** Plugin id where the cycle started (== where the cycle closes). */
  root: string
  /** The full chain, including the duplicated `root` at the end. */
  path: string[]
}

/** resolveDependencies 的结构化结果。 */
export interface DependencyResolution {
  ok: boolean
  /** 未安装的依赖。 */
  missing: ResolvableDependency[]
  /** Dependencies that are installed but at the wrong version. */
  unsatisfied: UnsatisfiedDependency[]
  /** Dependency cycles that would prevent a clean install. */
  cycles: DependencyCycle[]
  /** 拓扑安装序（不含 root），仅无循环时填充。 */
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

/** 解析 <id>@<range> 字符串。无 @ 时 range 为 *。 */
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

/** 将 string[] 规范化为 PluginDependency[]。 */
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

/** range 是否匹配 version（node-semver）。 */
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

/** 检查 range 是否可解析。 */
export function isValidRange(range: string): boolean {
  const r = (range || '').trim() || '*'
  if (r === '*' || r === 'x' || r === 'X' || r === '') return true
  return semver.validRange(r) !== null
}

// ─── Core resolver ───────────────────────────────────────────────────────────

/**
 * 解析依赖图。遍历声明依赖，递归已安装目录检测循环；不递归市场索引。
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

  // visitedStack 检测循环，completed 避免重复处理。
  const visitedStack: string[] = [root.id]
  const completed = new Set<string>([root.id])
  const ordered: string[] = []

  const visit = (pluginId: string, dep: PluginDependency): void => {
    // ── Self-reference: A → A. Cheap to detect, easy to surface.
    if (pluginId === root.id) {
      result.cycles.push({ root: root.id, path: [...visitedStack, pluginId] })
      return
    }
    // 仅检测当前递归路径上的循环。
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
      // 缺失依赖填入 available，不递归索引。
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

    // 后序遍历保证拓扑序。
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

/** 按 path 去重循环。 */
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
