#!/usr/bin/env node
/** swallow-plugin —— SwallowNote 插件共享构建工具入口 */
import { cmdBuild } from './build.js'
import { cmdCreate, type CreateOptions } from './create.js'
import { cmdPackage, type PackageOptions } from './pack.js'
import type { BumpLevel } from './version.js'

const HELP = `swallow-plugin —— SwallowNote 插件共享构建工具

用法: swallow-plugin <command> [options]

命令:
  create [targetDir]   生成插件工程脚手架（交互式问询：插件名 → id → 是否 Rust 后端 → 权限多选）
  build                构建插件: vite build +（工程含 src-tauri 时）cargo build --release
  package              打包发布: 版本 bump → 构建 → 确定性 zip → ed25519 签名 → repo.json 同步

选项（各命令通用）:
  -h, --help           显示帮助

create 选项:
  --name <名称>        插件显示名
  --id <com.swallownote.x>   插件 id（默认 com.swallownote.<kebab-name>）
  --backend            包含 Rust 后端（--frontend 为纯前端）
  --permissions a,b,c  权限列表（跳过多选）

build 选项:（无）

package 选项:
  --bump <patch|minor|major>  版本 bump 级别（默认 patch）
  --no-bump            不变更版本（publishedAt 保持不变，保证产物字节确定）
  --version X.Y.Z      显式钉住新版本（隐含 --no-bump）
  --skip-repo          跳过 plugins/repo.json 同步
  --dry-run            只打印计划与 repo.json 回填预览，不写文件、不构建

示例:
  swallow-plugin create ./my-plugin
  swallow-plugin create /tmp/demo --name 示例插件 --id com.swallownote.demo --backend
  swallow-plugin build
  swallow-plugin package --bump minor
`

function printHelpAndExit(code: number): never {
  process.stdout.write(HELP)
  process.exit(code)
}

/** 手写参数解析：--key value / --key=value / 布尔开关 */
function parseArgs(argv: string[]): { positionals: string[]; flags: Map<string, string | boolean> } {
  const VALUE_FLAGS = new Set(['--name', '--id', '--permissions', '--bump', '--version'])
  const positionals: string[] = []
  const flags = new Map<string, string | boolean>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq > 0) {
        flags.set(arg.slice(0, eq), arg.slice(eq + 1))
        continue
      }
      if (VALUE_FLAGS.has(arg)) {
        const value = argv[++i]
        if (value === undefined) {
          console.error(`✗ ${arg} 需要一个值`)
          process.exit(1)
        }
        flags.set(arg, value)
      } else {
        flags.set(arg, true)
      }
    } else {
      positionals.push(arg)
    }
  }
  return { positionals, flags }
}

async function main(): Promise<void> {
  // 全量解析（含子命令名），使 `swallow-plugin --help` 与 `swallow-plugin create --help` 都能命中帮助分支
  const { positionals, flags } = parseArgs(process.argv.slice(2))
  const [command, ...positionalRest] = positionals

  if (!command || flags.has('--help') || flags.has('-h')) {
    printHelpAndExit(command ? 0 : 1)
  }

  switch (command) {
    case 'create': {
      const opts: CreateOptions = {
        name: flags.get('--name') as string | undefined,
        id: flags.get('--id') as string | undefined,
        backend: flags.has('--backend') ? true : flags.has('--frontend') ? false : undefined,
        permissions: flags.get('--permissions') as string | undefined,
      }
      await cmdCreate(positionalRest[0], opts)
      break
    }
    case 'build': {
      cmdBuild(process.cwd())
      break
    }
    case 'package': {
      const bumpFlag = flags.get('--bump') as string | undefined
      const pinVersion = flags.get('--version') as string | undefined
      if (bumpFlag && !['major', 'minor', 'patch'].includes(bumpFlag)) {
        console.error(`✗ 未知 --bump 级别: ${bumpFlag}（期望 patch|minor|major）`)
        process.exit(1)
      }
      if (pinVersion && !/^\d+\.\d+\.\d+$/.test(pinVersion)) {
        console.error(`✗ --version '${pinVersion}' 不是合法 semver（期望 X.Y.Z）`)
        process.exit(1)
      }
      const opts: PackageOptions = {
        // --version X.Y.Z 隐含 --no-bump；默认 patch（与 package.sh 一致）
        bump: (flags.has('--no-bump') || pinVersion) ? 'none' : (bumpFlag as BumpLevel | undefined) ?? 'patch',
        pinVersion,
        skipRepo: flags.has('--skip-repo'),
        dryRun: flags.has('--dry-run'),
      }
      cmdPackage(process.cwd(), opts)
      break
    }
    default:
      console.error(`✗ 未知命令: ${command}（可用: create | build | package）`)
      printHelpAndExit(1)
  }
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
