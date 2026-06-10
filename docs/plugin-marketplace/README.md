# 插件市场 —— 仓库协议

本目录是 SwallowNote 内置插件市场（Phase 9.2）的**示例插件仓库**。仓库就是一个**通过 HTTPS 静态托管**的目录——不需要任何服务端代码。

## 目录结构

```text
plugin-marketplace/
├── README.md          ← 本文件
├── repo.json          ← 索引（打开市场时拉取）
├── pubkey.b64         ← base64 编码的 32 字节 ed25519 验证公钥
│                        （对未自带 pubkey_b64 的条目作为默认）
└── artifacts/         ← zip 包，每个 (id, version) 一份
    ├── <id>-<version>.zip
    └── ...
```

## `repo.json`

顶层结构（对应 `src-tauri/src/commands/plugin.rs::PluginIndex`）：

```ts
interface PluginIndex {
  schema_version: 1
  updated_at: string                  // ISO 8601，刷新提示
  pubkey_b64: string                  // 仓库级 ed25519 公钥（b64 原始 32 字节）
  plugins: PluginIndexEntry[]
}

interface PluginIndexEntry {
  id: string                          // 例如 "com.example.hello-world"
  name: string
  version: string                     // 最新 semver
  description: string
  author: string
  icon?: string                       // SVG/PNG 的绝对 URL
  tags: string[]
  download_url: string                // zip 的绝对 URL
  sha256: string                      // zip 字节的小写十六进制摘要
  signature_b64: string               // 对 zip 字节的 ed25519 签名
  pubkey_b64: string                  // 覆盖仓库级公钥（可选）
  versions: PluginIndexEntryVersion[] // 历史版本（最新在前）
  dependencies: string[]              // 依赖的对等插件 id
}

interface PluginIndexEntryVersion {
  version: string
  download_url: string
  sha256: string
  changelog: string
  published_at: string                // ISO 8601
}
```

## 签名流程

每个 zip 用 ed25519 私钥签名一次。宿主（`install_plugin_from_bytes`，位于 `src-tauri/src/commands/plugin.rs`）在安装前会校验**两项**：

1. zip 字节的 **SHA-256 摘要** 与 `entry.sha256` 一致。
2. zip 字节的 **ed25519 签名** 与 `entry.signature_b64` 一致，验签公钥为 `entry.pubkey_b64`（若该字段为空则回退到仓库级 `pubkey_b64`）。

任一项校验失败都会抛 `PluginError::Security(...)`，且**不会有任何文件落盘**。

### 为什么要用 base64 编码的原始 32 字节，而不是 PEM？

PEM 需要 ASN.1 DER 解析 `SubjectPublicKeyInfo` 结构，这要么引入新依赖、要么手写 ~80 行 ASN.1。对一个固定大小的公钥来说，原始 32 字节形式更简洁，前端也完全不需要 ed25519 加密库——**只有 Rust 宿主用得到**。

### 生成一个签过名的 zip

```bash
# 1. 构建插件（例如 hello-world）
cd docs/plugin-samples/hello-world
npm install
npm run build           # 产出 dist/index.js 等

# 2. 打包
zip -r ../../../plugin-marketplace/artifacts/com.example.hello-world-0.1.0.zip \
  dist manifest.json index.tsx

# 3. 用仓库私钥签名（替换成你自己的）
PRIV_B64=$(cat ../../plugin-marketplace/priv.b64)
node -e "
  const c = require('crypto');
  const fs = require('fs');
  const buf = fs.readFileSync('artifacts/com.example.hello-world-0.1.0.zip');
  const priv = Buffer.from('\${PRIV_B64}', 'base64');
  // 重新导入为 PKCS8 DER
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420','hex'),
    priv,
  ]);
  const key = c.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const sig = c.sign(null, buf, key);
  console.log('sha256:  ' + c.createHash('sha256').update(buf).digest('hex'));
  console.log('sig_b64: ' + sig.toString('base64'));
"
# → 把输出的 sha256 和 sig_b64 粘贴到 repo.json 对应条目
```

宿主端的验签代码与之**完全一致**：

```rust
verifier.verify(zip_bytes, &Signature::from_bytes(&sig_b64_decoded))
```

## 宿主如何拉取仓库

用户在市场 UI 中粘贴一个 `repo.json` URL（或选择内置的默认仓库）。`src/lib/plugin-market.ts` 接着：

1. `fetch(url)` → 解析为 `PluginIndex`。
2. 对每个条目，把 `local_version`（来自 `invoke('check_plugin_updates', { repoUrl: url })`）与 `entry.version` 比较。
3. 安装时，查找该条目的 `download_url` + `sha256` + `signature_b64`（或回退到仓库级 `pubkey_b64`）。
4. 把 zip 下载到内存中的 `Blob`（同时按 `sha256` 缓存到 IndexedDB——二次安装只需一次 IndexedDB 读取）。
5. `invoke('install_plugin_from_bytes', { id, version, bytes, sha256, pubkeyB64, signatureB64 })`。

## 安全特性

- **zip 被篡改**：SHA-256 不匹配 → 在签名校验之前就被拒绝。
- **公钥错误**：签名校验失败 → 拒绝。
- **`download_url` 遭 MITM**：SHA-256 不匹配（或签名失败）→ 拒绝。
- **`repo.json` 遭 MITM**：恶意索引可以发起 DoS（把条目指向不可达 URL），但**无法**下发一个未用私钥签名的插件——签名校验就是 zip 与索引条目之间的"绑定关系"。

## 示例密钥对

`pubkey.b64` 随本示例仓库一并发布。**仅用于演示**；对应的私钥**未**包含在内。要跑完整的端到端安装测试，请生成你自己的密钥对并重新签名示例 zip。

```bash
node -e "
  const c = require('crypto');
  const kp = c.generateKeyPairSync('ed25519');
  const rawPub = kp.publicKey.export({format: 'der', type: 'spki'}).slice(-32);
  const rawPriv = kp.privateKey.export({format: 'der', type: 'pkcs8'}).slice(-32);
  require('fs').writeFileSync('pubkey.b64', rawPub.toString('base64'));
  require('fs').writeFileSync('priv.b64',  rawPriv.toString('base64'));
  console.log('Wrote pubkey.b64 and priv.b64');
"
```
