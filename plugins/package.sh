#!/usr/bin/env bash
#
# plugins/package.sh — 插件可复现打包 + 签名 + 索引更新一站式脚本
#
# 用法:
#   ./plugins/package.sh <plugin-name> <changelog>
#   例: ./plugins/package.sh picgo "v0.1.4: 清理已废弃权限声明"
#
# 可复现保证: zip 内所有条目使用固定时间戳(2020-01-01)、固定权限、
# 固定排序与压缩级别 —— 相同源文件产物字节级一致，sha256 稳定。
#
# 步骤:
#   1. 校验 dist/manifest.json 与仓库 manifest.json 一致（防止打包过时源）
#   2. 按标准结构打包: index.js / manifest.json / settings.json(顶层优先,
#      回退 dist) / backend/*(dist/backend 下有则带 backend/ 前缀)
#   3. sign_plugin 签名并更新 plugins/repo.json
#      (version/sha256/signature_b64/changelog/published_at/updated_at)
#   4. 输出摘要。git add/commit/push 由使用者自行执行。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_NAME="${1:?用法: ./plugins/package.sh <plugin-name> <changelog>}"
CHANGELOG="${2:?缺少 changelog 参数}"
PLUGIN_DIR="$REPO_ROOT/plugins/$PLUGIN_NAME"
ZIP_PATH="$PLUGIN_DIR/com.swallownote.$PLUGIN_NAME.zip"

[ -d "$PLUGIN_DIR" ] || { echo "错误: 插件目录不存在: $PLUGIN_DIR" >&2; exit 1; }
[ -f "$PLUGIN_DIR/dist/index.js" ] || { echo "错误: 缺少 $PLUGIN_DIR/dist/index.js（请先构建）" >&2; exit 1; }

python3 - "$PLUGIN_DIR" "$ZIP_PATH" <<'PYEOF'
import json, os, platform, sys, zipfile

plugin_dir, zip_path = sys.argv[1], sys.argv[2]
dist = os.path.join(plugin_dir, "dist")

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

# 1. dist manifest 必须与仓库 manifest 一致（打包源同步防线）
repo_manifest = load(os.path.join(plugin_dir, "manifest.json"))
dist_manifest = load(os.path.join(dist, "manifest.json"))
if repo_manifest != dist_manifest:
    sys.exit(f"错误: {plugin_dir}/dist/manifest.json 与仓库 manifest.json 不一致，先同步再打包")

# 2. 组装文件清单: zip 内路径 -> 本地路径（按 zip 内路径排序保证确定性）
entries = {}
entries["index.js"] = os.path.join(dist, "index.js")
entries["manifest.json"] = os.path.join(dist, "manifest.json")
# settings.json: 顶层优先，回退 dist
top_settings = os.path.join(plugin_dir, "settings.json")
dist_settings = os.path.join(dist, "settings.json")
if os.path.isfile(top_settings):
    entries["settings.json"] = top_settings
elif os.path.isfile(dist_settings):
    entries["settings.json"] = dist_settings
# backend/: 递归收集 dist/backend（支持平台子目录布局 backend/<platform>/…）
backend_dir = os.path.join(dist, "backend")

def host_platform_dir():
    s, m = platform.system(), platform.machine()
    if s == "Darwin":
        return "darwin-aarch64" if m == "arm64" else "darwin-x86_64"
    if s == "Windows":
        return "windows-x86_64"
    if s == "Linux":
        return "linux-aarch64" if m == "aarch64" else "linux-x86_64"
    return "unknown"

root_backend_files = []
if os.path.isdir(backend_dir):
    for root, _dirs, files in os.walk(backend_dir):
        for name in sorted(files):
            rel = os.path.relpath(os.path.join(root, name), backend_dir)
            entries[f"backend/{rel}"] = os.path.join(root, name)
            if "/" not in rel:
                root_backend_files.append(rel)

# 平台整理（跨平台单包布局）：根部二进制同时复制进 host 平台子目录，
# 根文件保留为旧版 app 的兜底（旧 resolve 只认根布局）。
host_dir = host_platform_dir()
for rel in root_backend_files:
    entries[f"backend/{host_dir}/{rel}"] = os.path.join(backend_dir, rel)

# 兜底：部分构建流程会清空 dist/backend 但把产物留在插件根 backend/。
# 若 dist 下没有任何 backend 条目，改从插件根 backend/ 收集。
if not root_backend_files:
    alt_backend = os.path.join(plugin_dir, "backend")
    if os.path.isdir(alt_backend):
        for root, _dirs, files in os.walk(alt_backend):
            for name in sorted(files):
                rel = os.path.relpath(os.path.join(root, name), alt_backend)
                entries[f"backend/{rel}"] = os.path.join(root, name)
                if "/" not in rel:
                    entries[f"backend/{host_dir}/{rel}"] = os.path.join(root, name)

FIXED_TIME = (2020, 1, 1, 0, 0, 0)
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for arcname in sorted(entries):
        mode = 0o755 if arcname.startswith("backend/") else 0o644
        info = zipfile.ZipInfo(arcname, date_time=FIXED_TIME)
        info.create_system = 3           # unix
        info.external_attr = (0o100000 | mode) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(entries[arcname], "rb") as f:
            zf.writestr(info, f.read())
print(f"打包完成: {zip_path}")
PYEOF

# 3. 签名并更新 repo.json（sign_plugin 输出裸 base64 签名，ed25519 确定性：同 zip 同签名）
SIG=$(cargo run --quiet --manifest-path "$REPO_ROOT/src-tauri/Cargo.toml" \
  --example sign_plugin -- sign "$ZIP_PATH" 2>/dev/null | grep -v '^warning' | tail -n 1)
[ -n "$SIG" ] || { echo "错误: 签名失败" >&2; exit 1; }

PUBLISHED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
python3 - "$REPO_ROOT/plugins/repo.json" "$PLUGIN_NAME" "$SIG" "$CHANGELOG" "$PUBLISHED_AT" <<'PYEOF'
import hashlib, json, sys, collections

repo_json, name, sig, changelog, published = sys.argv[1:6]
entry_id = f"com.swallownote.{name}"
with open(repo_json, encoding="utf-8") as f:
    data = json.load(f, object_pairs_hook=collections.OrderedDict)

with open(f"plugins/{name}/manifest.json", encoding="utf-8") as f:
    version = json.load(f)["version"]
with open(f"plugins/{name}/com.swallownote.{name}.zip", "rb") as f:
    sha256 = hashlib.sha256(f.read()).hexdigest()

for p in data["plugins"]:
    if p["id"] != entry_id:
        continue
    p["version"] = version
    p["sha256"] = sha256
    p["signature_b64"] = sig
    p["changelog"] = changelog
    p["published_at"] = published
    break
else:
    sys.exit(f"错误: repo.json 中找不到 {entry_id}")

data["updated_at"] = published
with open(repo_json, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"repo.json 已更新: {entry_id} v{version} sha256={sha256[:12]}...")
PYEOF

echo "完成。下一步: git add plugins/$PLUGIN_NAME plugins/repo.json && git commit && git push"
