#!/bin/bash
# Package the mindmap plugin into a zip that can be installed in SwallowNote.
#
# The zip file is named after the plugin id (com.swallownote.mindmap.zip)
# and contains:
#   - index.js          (ES module bundle built by Vite)
#   - manifest.json     (plugin metadata)
#
# Usage: ./package.sh [debug|release] [--skip-repo]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-debug}"
SKIP_REPO=0

# Parse flags
for arg in "$@"; do
  case "$arg" in
    debug|release) MODE="$arg" ;;
    --skip-repo) SKIP_REPO=1 ;;
  esac
done

PLUGIN_ID="com.swallownote.mindmap"
DIST_DIR="$SCRIPT_DIR/dist"
REPO_JSON="$SCRIPT_DIR/../repo.json"
MANIFEST="$SCRIPT_DIR/manifest.json"

PUBLISHED_AT=$(python3 -c "from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")

# Refresh publishedAt
echo "==> Refreshing publishedAt"
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

echo "==> Building frontend (Vite ES module bundle)..."
cd "$SCRIPT_DIR"
npx vite build

# Copy manifest into dist
cp "$MANIFEST" "$DIST_DIR/manifest.json"

echo "==> Creating zip package..."
cd "$DIST_DIR"
ZIP_NAME="${PLUGIN_ID}.zip"
rm -f "$SCRIPT_DIR/$PLUGIN_ID"*.zip

# Deterministic zip: pin mtime + strip extra attributes
touch -d '2020-01-01T00:00:00Z' \
  "$DIST_DIR/index.js" \
  "$DIST_DIR/manifest.json" \
  "$DIST_DIR"
zip -X -r "$SCRIPT_DIR/$ZIP_NAME" index.js manifest.json > /dev/null

echo ""
echo "✓ Plugin package created: $SCRIPT_DIR/$ZIP_NAME"
echo "  Contents:"
zipinfo -1 "$SCRIPT_DIR/$ZIP_NAME"
echo ""

VERSION=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['version'])" 2>/dev/null || echo "0.0.0")
echo "  version:       $VERSION"
echo "  published_at:  $PUBLISHED_AT"

# Sync repo.json
if [ "$SKIP_REPO" = "1" ]; then
  echo ""
  echo "→ Skipping repo.json sync (--skip-repo)"
elif [ ! -f "$REPO_JSON" ]; then
  echo ""
  echo "⚠ plugins/repo.json not found — skipping index sync"
else
  echo ""
  echo "==> Syncing plugins/repo.json..."
  SHA256=$(shasum -a 256 "$SCRIPT_DIR/$ZIP_NAME" | awk '{print $1}')
  python3 - "$REPO_JSON" "$PLUGIN_ID" "$SHA256" "$VERSION" "$PUBLISHED_AT" <<'PY'
import json, sys, datetime as _dt
repo_path, plugin_id, sha256, version, published_at = sys.argv[1:6]
with open(repo_path, 'r', encoding='utf-8') as f:
    repo = json.load(f)
updated = False
for plugin in repo.get('plugins', []):
    if plugin.get('id') != plugin_id:
        continue
    plugin['version'] = version
    plugin['sha256'] = sha256
    plugin.pop('versions', None)
    plugin['published_at'] = published_at
    updated = True
    break
if not updated:
    print(f"  ⚠ plugin id {plugin_id} not found in repo.json")
    sys.exit(0)
repo['updated_at'] = _dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(repo_path, 'w', encoding='utf-8') as f:
    json.dump(repo, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(f"  ✓ version       = {version}")
print(f"  ✓ sha256        = {sha256}")
print(f"  ✓ published_at  = {published_at}")
PY
fi

echo ""
echo "Install via: Plugin Manager → drag & drop or select the zip file"
