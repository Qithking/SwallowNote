/** 插件依赖解析器，纯函数 */
import semver from 'semver'
import type { PluginDependency } from '@/types/plugin'

// 公共类型

/** 本地已安装插件快照。 */
export interface ResolverInstalledPlugin {
  version: string
  /** 可选传递依赖，用于循环检测 */
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
  /** 父 manifest 要求的范围 */
  required: string
  /** 市场实际提供的版本 */
  available: string
}

/** 已安装但不满足 range 的依赖。 */
export interface UnsatisfiedDependency {
  id: string
  required: string
  installed: string
  /** manifest 依赖范围无法解析 */
  kind: 'out-of-range' | 'invalid-range' | 'unparseable-version'
}

/** 检测到的依赖循环。 */
export interface DependencyCycle {
  /** 循环起点 id（即闭合点） */
  root: string
  /** 完整路径，末尾重复 root */
  path: string[]
}

/** resolveDependencies 的结构化结果。 */
export interface DependencyResolution {
  ok: boolean
  /** 未安装的依赖。 */
  missing: ResolvableDependency[]
  /** 已安装但版本不符 */
  unsatisfied: UnsatisfiedDependency[]
  /** 阻碍安装的依赖循环 */
  cycles: DependencyCycle[]
  /** 拓扑安装序（不含 root），仅无循环时填充。 */
  installOrder: string[]
  /** 根 manifest 快照，用于诊断 */
  root: {
    id: string
    version: string
    dependencies: PluginDependency[]
  }
}

// 解析辅助

/** 解析 <id>@<range> 字符串。无 @ 时 range 为 *。 */
export function parseDependencySpec(spec: string): PluginDependency {
  if (typeof spec !== 'string') return { id: '', version: '' }
  const trimmed = spec.trim()
  if (!trimmed) return { id: '', version: '' }
  const at = trimmed.lastIndexOf('@')
  // 无 @ 时整体为 id，range 默认 *
  if (at < 0) {
    return { id: trimmed, version: '*' }
  }
  // @ 在首位则无 id，调用方丢弃
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

// semver 辅助

/** range 是否匹配 version（node-semver）。 */
export function satisfiesRange(range: string, version: string): boolean {
  const r = (range || '').trim() || '*'
  if (!version) return false
  // 通配符短路，避免畸形版本崩溃
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

// 核心解析器

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
    // 自引用 A→A
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

    // 已完成则跳过
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

    // 校验 range，不可解析报 invalid-range
    if (!isValidRange(dep.version)) {
      result.unsatisfied.push({
        id: pluginId,
        required: dep.version,
        installed: local.version,
        kind: 'invalid-range',
      })
      // manifest 损坏，不递归
      return
    }

    if (!satisfiesRange(dep.version, local.version)) {
      // 区分版本不可解析与越界
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
