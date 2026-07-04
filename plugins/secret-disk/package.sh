#!/bin/bash
# Package the secret-disk plugin into a zip that can be installed in SwallowNote.
#
# The zip file is named after the plugin id (com.swallownote.secret-disk.zip)
# and contains:
#   - index.js          (ES module bundle built by Vite)
#   - manifest.json     (plugin metadata)
#   - settings.json     (plugin settings schema)
#   - backend/          (Rust binary for加密数据库后端)
#     └── plugin_com.swallownote.secret-disk
#
# Bump policy (default: patch):
#   --bump patch   0.1.0 → 0.1.1  (default, safe for fixes)
#   --bump minor   0.1.0 → 0.2.0
#   --bump major   0.1.0 → 1.0.0
#   --bump none    do not change the version
#   --version X.Y.Z  pin the new version explicitly
#
#   --no-bump     alias for --bump none
#   --skip-repo   skip the plugins/repo.json sync
#
# Usage: ./package.sh [debug|release] [--bump <level>|--no-bump|--version X.Y.Z] [--skip-repo]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE=""
BUMP="patch"
SKIP_REPO=0
PIN_VERSION=""

# 解析命令行参数：第一个位置参数为构建模式（debug|release），其余为标志
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    debug|release)
      MODE="$arg"
      ;;
    --skip-repo)
      SKIP_REPO=1
      ;;
    --no-bump)
      BUMP="none"
      ;;
    --bump)
      BUMP="__NEEDS_VALUE__"
      ;;
    --bump=*)
      BUMP="${arg#--bump=}"
      ;;
    --version)
      PIN_VERSION="__NEEDS_VALUE__"
      ;;
    --version=*)
      PIN_VERSION="${arg#--version=}"
      ;;
    *)
      # 处理 --bump <level> 形式
      if [ "$BUMP" = "__NEEDS_VALUE__" ]; then
        BUMP="$arg"
      elif [ "$PIN_VERSION" = "__NEEDS_VALUE__" ]; then
        PIN_VERSION="$arg"
      else
        POSITIONAL+=("$arg")
      fi
      ;;
  esac
done

# 默认 debug 构建
if [ -z "$MODE" ]; then
  if [ ${#POSITIONAL[@]} -gt 0 ] && { [ "${POSITIONAL[0]}" = "debug" ] || [ "${POSITIONAL[0]}" = "release" ]; }; then
    MODE="${POSITIONAL[0]}"
  else
    MODE="release"
  fi
fi

# 校验 bump level
case "$BUMP" in
  patch|minor|major|none) ;;
  __NEEDS_VALUE__)
    echo "✗ --bump requires a value (patch|minor|major|none)" >&2
    exit 1
    ;;
  *)
    echo "✗ Unknown --bump level: $BUMP (expected patch|minor|major|none)" >&2
    exit 1
    ;;
esac

if [ "$PIN_VERSION" = "__NEEDS_VALUE__" ]; then
  echo "✗ --version requires a value (X.Y.Z)" >&2
  exit 1
fi

# --version X.Y.Z 隐含 --bump none
if [ -n "$PIN_VERSION" ]; then
  if ! [[ "$PIN_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.-]+)?$ ]]; then
    echo "✗ --version '$PIN_VERSION' is not a valid semver" >&2
    exit 1
  fi
  BUMP="none"
fi

PLUGIN_ID="com.swallownote.secret-disk"
DIST_DIR="$SCRIPT_DIR/dist"
REPO_JSON="$SCRIPT_DIR/../repo.json"
MANIFEST="$SCRIPT_DIR/manifest.json"
SRC_INDEX="$SCRIPT_DIR/src/index.tsx"
CARGO_TOML="$SCRIPT_DIR/src-tauri/Cargo.toml"
PKG_JSON="$SCRIPT_DIR/package.json"
SETTINGS="$SCRIPT_DIR/settings.json"

# ─── 版本号 bump（构建前） ───────────────────────────────────────────────────
# 在 vite build 之前 bump，确保新版本号被烘焙进 index.js
OLD_VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])" 2>/dev/null || echo "0.0.0")
PUBLISHED_AT=$(python3 -c "from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")

if [ -n "$PIN_VERSION" ]; then
  NEW_VERSION="$PIN_VERSION"
elif [ "$BUMP" = "none" ]; then
  NEW_VERSION="$OLD_VERSION"
else
  NEW_VERSION=$(python3 - "$OLD_VERSION" "$BUMP" <<'PY'
import sys
from semver import VersionInfo
old, level = sys.argv[1], sys.argv[2]
v = VersionInfo.parse(old)
if level == "patch":
    print(str(v.bump_patch()))
elif level == "minor":
    print(str(v.bump_minor()))
elif level == "major":
    print(str(v.bump_major()))
PY
  ) || {
    echo "✗ Failed to bump version '$OLD_VERSION' with --bump $BUMP" >&2
    echo "  (Requires the 'semver' PyPI package: pip install semver)" >&2
    exit 1
  }
fi

# 版本变更时同步到 manifest.json / src/index.tsx / Cargo.toml / package.json
VERSION_CHANGED=0
if [ "$NEW_VERSION" != "$OLD_VERSION" ]; then
  VERSION_CHANGED=1
  echo "==> Bumping version: $OLD_VERSION → $NEW_VERSION ($BUMP)"
  # manifest.json — 权威来源
  python3 - "$MANIFEST" "$NEW_VERSION" "$PUBLISHED_AT" <<'PY'
import json, sys
path, version, published_at = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'r', encoding='utf-8') as f:
    m = json.load(f)
m['version'] = version
m['publishedAt'] = published_at
with open(path, 'w', encoding='utf-8') as f:
    json.dump(m, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY

  # src/index.tsx — 通过正则替换 version 字面量
  python3 - "$SRC_INDEX" "$OLD_VERSION" "$NEW_VERSION" <<'PY'
import re, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()
pattern = re.compile(r"(version:\s*['\"])" + re.escape(old) + r"(['\"])")
new_src, n = pattern.subn(r"\g<1>" + new + r"\g<2>", src, count=1)
if n == 0:
    print(f"  ⚠ could not find version literal '{old}' in {path} — leaving as-is", file=sys.stderr)
else:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_src)
PY

  # src-tauri/Cargo.toml — 同步 crate 版本
  python3 - "$CARGO_TOML" "$OLD_VERSION" "$NEW_VERSION" <<'PY'
import re, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()
pattern = re.compile(r"(?m)^(version\s*=\s*['\"])" + re.escape(old) + r"(['\"])")
new_src, n = pattern.subn(r"\g<1>" + new + r"\g<2>", src, count=1)
if n == 0:
    print(f"  ⚠ could not find crate version '{old}' in {path} — leaving as-is", file=sys.stderr)
else:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_src)
PY

  # package.json — 同步 npm 版本
  python3 - "$PKG_JSON" "$NEW_VERSION" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    p = json.load(f)
p['version'] = version
with open(path, 'w', encoding='utf-8') as f:
    json.dump(p, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
fi

# 无版本变更时刷新 publishedAt 时间戳
if [ "$VERSION_CHANGED" = "0" ]; then
  echo "==> Refreshing publishedAt (version unchanged at $OLD_VERSION)"
  python3 - "$MANIFEST" "$PUBLISHED_AT" <<'PY'
import json, sys
path, published_at = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    m = json.load(f)
m['publishedAt'] = published_at
with open(path, 'w', encoding='utf-8') as f:
    json.dump(m, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY
fi

# ─── 前端构建 ────────────────────────────────────────────────────────────────
echo "==> Building frontend (Vite ES module bundle)..."
cd "$SCRIPT_DIR"
npx vite build

# ─── 后端构建 ────────────────────────────────────────────────────────────────
echo "==> Building backend (Rust binary, mode=$MODE)..."
cd "$SCRIPT_DIR"
if [ "$MODE" = "release" ]; then
  cargo build --release --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/release/plugin_com_swallownote_secret_disk"
else
  cargo build --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/debug/plugin_com_swallownote_secret_disk"
fi

# 复制后端二进制到 dist/backend/，使用宿主期望的命名
mkdir -p "$DIST_DIR/backend"
cp "$BIN_PATH" "$DIST_DIR/backend/plugin_$PLUGIN_ID"
chmod +x "$DIST_DIR/backend/plugin_$PLUGIN_ID"

# 复制 manifest + settings 到 dist，确保 zip 内文件一致
cp "$MANIFEST" "$DIST_DIR/manifest.json"
cp "$SETTINGS" "$DIST_DIR/settings.json"

# ─── 打包 zip ────────────────────────────────────────────────────────────────
echo "==> Creating zip package..."
cd "$DIST_DIR"
ZIP_NAME="${PLUGIN_ID}.zip"
rm -f "$SCRIPT_DIR/$PLUGIN_ID"*.zip

# 确定性 zip：固定 mtime，使用 -X 剥离额外属性，保证两次构建产物哈希一致
touch -d '2020-01-01T00:00:00Z' \
  "$DIST_DIR/index.js" \
  "$DIST_DIR/manifest.json" \
  "$DIST_DIR/settings.json" \
  "$DIST_DIR/backend/plugin_$PLUGIN_ID" \
  "$DIST_DIR" \
  "$DIST_DIR/backend"
zip -X -r "$SCRIPT_DIR/$ZIP_NAME" index.js manifest.json settings.json backend/ > /dev/null

echo ""
echo "✓ Plugin package created: $SCRIPT_DIR/$ZIP_NAME"
echo "  Contents:"
zipinfo -1 "$SCRIPT_DIR/$ZIP_NAME"
echo ""
echo "  version:       $NEW_VERSION"
echo "  published_at:  $PUBLISHED_AT"

# ─── 同步 plugins/repo.json（市场索引） ──────────────────────────────────────
if [ "$SKIP_REPO" = "1" ]; then
  echo ""
  echo "→ Skipping repo.json sync (--skip-repo)"
elif [ ! -f "$REPO_JSON" ]; then
  echo ""
  echo "⚠ plugins/repo.json not found at $REPO_JSON — skipping index sync"
  echo "  The zip is ready; update the marketplace index manually."
else
  echo ""
  echo "==> Syncing plugins/repo.json..."
  SHA256=$(shasum -a 256 "$SCRIPT_DIR/$ZIP_NAME" | awk '{print $1}')
  python3 - "$REPO_JSON" "$PLUGIN_ID" "$SHA256" "$NEW_VERSION" "$PUBLISHED_AT" <<'PY'
import json
import sys
import datetime as _dt

repo_path, plugin_id, sha256, version, published_at = sys.argv[1:6]

with open(repo_path, 'r', encoding='utf-8') as f:
    repo = json.load(f)

updated = False
for plugin in repo.get('plugins', []):
    if plugin.get('id') != plugin_id:
        continue
    plugin['version'] = version
    plugin['sha256'] = sha256
    if plugin.get('download_url'):
        plugin['download_url'] = plugin['download_url']
    plugin.pop('versions', None)
    plugin['published_at'] = published_at
    if not plugin.get('changelog'):
        prior = plugin.get('versions')
        if isinstance(prior, list) and prior:
            head = prior[0]
            if isinstance(head, dict) and head.get('changelog'):
                plugin['changelog'] = head['changelog']
    updated = True
    break

if not updated:
    print(f"  ⚠ plugin id {plugin_id} not found in repo.json — please add it manually")
    sys.exit(0)

repo['updated_at'] = _dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

with open(repo_path, 'w', encoding='utf-8') as f:
    json.dump(repo, f, ensure_ascii=False, indent=2)
    f.write('\n')

print(f"  ✓ version       = {version}")
print(f"  ✓ sha256        = {sha256}")
print(f"  ✓ published_at  = {published_at}")
print(f"  ✓ updated_at    = {repo['updated_at']}")
PY
fi

echo ""
echo "Install via: Plugin Manager → drag & drop or select the zip file"
