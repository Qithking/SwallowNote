import { readFileSync, writeFileSync } from 'node:fs'

export interface RepoSyncInput {
  /** plugins/repo.json 路径 */
  repoJsonPath: string
  pluginId: string
  version: string
  /** zip 文件 sha256（hex 小写） */
  sha256: string
  publishedAt: string
  /** ed25519 签名 base64；空串表示未签名 → 清除条目内旧签名 */
  signatureB64: string
  /** 签名公钥 base64；非空时写入 repo.json 顶层供市场校验 */
  pubkeyB64: string
}

/**
 * 同步 plugins/repo.json（市场索引）——逐字段平移 package.sh 内嵌 python 逻辑：
 *  - 仅回填 version / sha256 / published_at / signature_b64；
 *  - download_url / changelog / tags 等静态字段原样保留；
 *  - 重打包后旧签名必然失效：无新签名时清除残留 signature_b64；
 *  - updated_at 刷新为当前时间，公钥随索引分发到顶层 pubkey_b64。
 *
 * 返回 null 表示 repo.json 中没有该插件条目（调用方给出明确报错）。
 */
export function syncRepoJson(input: RepoSyncInput): 'updated' | 'not-found' {
  const repo = JSON.parse(readFileSync(input.repoJsonPath, 'utf-8'))
  const entry = (repo.plugins ?? []).find((p: { id?: string }) => p.id === input.pluginId)
  if (!entry) {
    return 'not-found'
  }

  entry.version = input.version
  entry.sha256 = input.sha256
  delete entry.versions
  entry.published_at = input.publishedAt
  if (input.signatureB64) {
    entry.signature_b64 = input.signatureB64
  } else {
    delete entry.signature_b64
  }

  repo.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  if (input.pubkeyB64) {
    repo.pubkey_b64 = input.pubkeyB64
  }

  writeFileSync(input.repoJsonPath, JSON.stringify(repo, null, 2) + '\n')
  return 'updated'
}

/**
 * dry-run 预览：计算 repo.json 将被回填的字段，不写文件。
 * 返回 { found, before, after }；before/after 为该插件条目的 JSON 字符串。
 */
export function previewRepoSync(
  repoJsonPath: string,
  input: Omit<RepoSyncInput, 'repoJsonPath'>
): { found: boolean; before: string; after: string } {
  const repo = JSON.parse(readFileSync(repoJsonPath, 'utf-8'))
  const entry = (repo.plugins ?? []).find((p: { id?: string }) => p.id === input.pluginId)
  if (!entry) {
    return { found: false, before: '', after: '' }
  }
  const before = JSON.stringify(entry, null, 2)
  const afterEntry = JSON.parse(before)
  afterEntry.version = input.version
  afterEntry.sha256 = input.sha256
  delete afterEntry.versions
  afterEntry.published_at = input.publishedAt
  if (input.signatureB64) {
    afterEntry.signature_b64 = input.signatureB64
  } else {
    delete afterEntry.signature_b64
  }
  return { found: true, before, after: JSON.stringify(afterEntry, null, 2) }
}
