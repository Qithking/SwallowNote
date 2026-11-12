import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ask, confirm } from './prompt.js'
import type { PluginPermission } from './permissions.js'
import { PERMISSION_CHOICES } from './permissions.js'

/** kit 包根目录（dist/cli.js → 上一级） */
const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE_DIR = join(KIT_ROOT, 'template')

export interface CreateOptions {
  /** 插件显示名 */
  name?: string
  /** 插件 id（默认 com.swallownote.<kebab-name>） */
  id?: string
  /** 是否含 Rust 后端 */
  backend?: boolean
  /** 权限列表（逗号分隔），缺省走交互多选 */
  permissions?: string
}

/** 显示名 → kebab-case（非 ASCII 字符无法转换，返回空由调用方要求显式 id） */
export function toKebab(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-')
}

function validateId(id: string): string | null {
  if (!/^[a-z][a-z0-9.-]*$/.test(id)) return '插件 id 需以小写字母开头，仅含小写字母、数字、点、连字符'
  if (!id.startsWith('com.swallownote.')) return '插件 id 建议以 com.swallownote. 开头（避免与其他来源插件冲突）'
  return null
}

/** 交互式问询补齐缺失项：插件名 → 默认 id → 是否 Rust 后端 → 权限多选 */
async function collectAnswers(targetDir: string, opts: CreateOptions): Promise<{
  name: string
  id: string
  backend: boolean
  permissions: PluginPermission[]
}> {
  let name = opts.name ?? ''
  while (!name) {
    name = await ask('插件名称（如：快速笔记）')
    if (!name) console.log('  插件名称不能为空')
  }

  const kebab = toKebab(name)
  let id = opts.id ?? ''
  if (!id) {
    const defId = kebab ? `com.swallownote.${kebab}` : undefined
    id = await ask('插件 ID', defId)
    let err = validateId(id)
    while (err) {
      console.log(`  ${err}`)
      id = await ask('插件 ID', defId)
      err = validateId(id)
    }
  } else {
    const err = validateId(id)
    if (err) throw new Error(err)
  }

  let backend = opts.backend
  if (backend === undefined) {
    backend = await confirm('是否包含 Rust 后端（src-tauri）？', false)
  }

  let permissions: PluginPermission[]
  if (opts.permissions) {
    permissions = opts.permissions.split(',').map((s) => s.trim()).filter(Boolean) as PluginPermission[]
  } else {
    // 权限多选：列出全部可选权限与说明，输入序号逗号分隔；回车采用默认
    console.log('\n可选权限：')
    PERMISSION_CHOICES.forEach((p, i) => {
      console.log(`  ${i + 1}) ${p.key.padEnd(18)} ${p.description}`)
    })
    const defaults = ['storage', 'events', ...(backend ? ['backend'] : [])]
    const defaultIdx = defaults.map((d) => PERMISSION_CHOICES.findIndex((p) => p.key === d) + 1).join(',')
    const answer = await ask('选择权限（序号逗号分隔，回车 = 默认）', defaultIdx)
    const picked = answer
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= PERMISSION_CHOICES.length)
      .map((n) => PERMISSION_CHOICES[n - 1].key)
    permissions = [...new Set(picked)]
  }
  console.log(
    `\n==> 将生成${backend ? '后端型' : '前端型'}插件工程：\n    名称 ${name}\n    ID   ${id}\n    目录 ${targetDir}\n    权限 ${permissions.join(', ') || '（无）'}\n`
  )
  return { name, id, backend, permissions }
}

/** 模板相对依赖路径：file: 路径相对目标工程根，Cargo path 相对 src-tauri 目录 */
function relPath(fromDir: string, toDir: string): string {
  const r = relative(fromDir, toDir).split('\\').join('/')
  return r.startsWith('.') ? r : './' + r
}

/** 递归收集模板文件（相对路径），跳过目录本身 */
function collectTemplateFiles(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = base ? `${base}/${entry}` : entry
    if (statSync(full).isDirectory()) {
      out.push(...collectTemplateFiles(full, rel))
    } else {
      out.push(rel)
    }
  }
  return out
}

/**
 * swallow-plugin create —— 从内嵌 template/ 渲染生成插件工程。
 * 前端型/后端型两分支：后端型额外拷贝 template/src-tauri 并接通 RPC 依赖。
 */
export async function cmdCreate(targetDirArg: string | undefined, opts: CreateOptions): Promise<void> {
  const nonInteractive = Boolean(opts.name && opts.id && opts.backend !== undefined)

  // 未指定目录时按 kebab 名落到当前目录下
  let targetDir = targetDirArg ? resolve(targetDirArg) : undefined
  if (!targetDir && nonInteractive) {
    throw new Error('非交互模式需要提供目标目录：swallow-plugin create <targetDir> ...')
  }
  if (!targetDir) {
    const suggested = opts.id ? `./${toKebab(opts.id.split('.').pop() ?? 'plugin')}-plugin` : './my-plugin'
    const dir = await ask('目标目录', suggested)
    targetDir = resolve(dir)
  }

  const { name, id, backend, permissions } = await collectAnswers(targetDir, opts)
  const kebab = toKebab(opts.id ? (opts.id.split('.').pop() ?? 'plugin') : name) || 'plugin'

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    throw new Error(`目标目录非空，拒绝覆盖：${targetDir}`)
  }
  // 先落目录再取真实路径：macOS 的 /tmp 是 /private/tmp 的符号链接，
  // 若按词法路径计算 file:/path 相对深度，npm 生成的符号链接在真实路径下会差一层而断裂
  mkdirSync(targetDir, { recursive: true })
  const realTargetDir = realpathSync(targetDir)

  // file: 依赖指向仓库内 SDK / kit；Cargo path 指向仓库内 plugin-rpc（并行创建中）
  const kitDir = KIT_ROOT
  const sdkDir = resolve(kitDir, '..', 'plugin-sdk')
  const rpcDir = resolve(kitDir, '..', 'plugin-rpc')
  const binName = 'plugin_' + id.replace(/[^a-zA-Z0-9]/g, '_')

  const tokens: Record<string, string> = {
    __NPM_NAME__: `swallownote-plugin-${kebab}`,
    __PLUGIN_NAME__: name,
    __PLUGIN_ID__: id,
    __PLUGIN_DESCRIPTION__: `SwallowNote 插件：${name}`,
    __KEBAB__: kebab,
    __BIN_NAME__: binName,
    __HAS_BACKEND__: String(backend),
    __PERMISSIONS_JSON__: JSON.stringify(permissions, null, 2).split('\n').join('\n  '),
    __PUBLISHED_AT__: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    __SDK_DEP_PATH__: relPath(realTargetDir, sdkDir),
    __KIT_DEP_PATH__: relPath(realTargetDir, kitDir),
    __RPC_DEP_PATH__: relPath(join(realTargetDir, 'src-tauri'), rpcDir),
  }

  // 模板清单：公共文件全部拷贝；src-tauri 仅后端型拷贝
  const allFiles = collectTemplateFiles(TEMPLATE_DIR).filter((f) => backend || !f.startsWith('src-tauri/'))
  for (const rel of allFiles) {
    const src = join(TEMPLATE_DIR, rel)
    const dest = join(targetDir, rel)
    let content = readFileSync(src, 'utf-8')
    for (const [token, value] of Object.entries(tokens)) {
      content = content.split(token).join(value)
    }
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, content)
  }

  console.log(`✓ 已生成 ${backend ? '后端型' : '前端型'}插件工程：${targetDir}`)
  console.log('\n下一步：')
  console.log(`  cd ${relative(process.cwd(), targetDir) || targetDir}`)
  console.log('  npm install')
  console.log('  npm run dev       # standalone 预览面板')
  console.log('  npm run build     # vite build +（后端型）cargo build --release')
  console.log('  npm run package   # 打 zip、签名并同步 plugins/repo.json')
}
