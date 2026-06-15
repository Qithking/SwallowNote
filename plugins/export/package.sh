#!/bin/bash
# Package the export plugin into a zip that can be installed in SwallowNote.
#
# The zip file is named after the plugin id (com.swallownote.export.zip)
# and contains:
#   - index.js          (ES module bundle built by Vite)
#   - manifest.json     (plugin metadata)
#   - backend/          (Rust binary for DOCX conversion)
#     └── plugin_com.swallownote.export
#
# Usage: ./package.sh [release]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-debug}"
PLUGIN_ID="com.swallownote.export"
DIST_DIR="$SCRIPT_DIR/dist"

echo "==> Building frontend (Vite ES module bundle)..."
cd "$SCRIPT_DIR"
npx vite build

echo "==> Building backend (Rust binary)..."
cd "$SCRIPT_DIR"
if [ "$MODE" = "release" ]; then
  cargo build --release --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/release/plugin_com_swallownote_export"
else
  cargo build --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/debug/plugin_com_swallownote_export"
fi

# Copy backend binary into dist/backend/ with the expected name
mkdir -p "$DIST_DIR/backend"
cp "$BIN_PATH" "$DIST_DIR/backend/plugin_$PLUGIN_ID"
chmod +x "$DIST_DIR/backend/plugin_$PLUGIN_ID"

echo "==> Creating zip package..."
# Re-read version from dist/manifest.json (post-build, guaranteed up-to-date)
VERSION=$(python3 -c "import json; print(json.load(open('$DIST_DIR/manifest.json'))['version'])" 2>/dev/null || echo "0.0.0")
cd "$DIST_DIR"
ZIP_NAME="${PLUGIN_ID}.zip"
rm -f "$SCRIPT_DIR/$PLUGIN_ID"*.zip

# Deterministic zip: pin the mtime of every file we are about to
# archive to a fixed epoch, then use `zip -X` to strip extra
# attributes (uid / gid / atime / extended timestamps) from the
# local file headers. Without this, two consecutive `vite build`
# + `cargo build` runs produce zips with different SHA-256 even
# though the *contents* are byte-identical — the host's plugin
# installer compares the on-the-wire zip hash against the value
# declared in `plugins/repo.json`, and a non-deterministic
# build means we have to bump `repo.json`'s `sha256` on every
# rebuild, even when no code changed.
#
# We touch the directory entries too (`dist/backend/`, `dist/`)
# because `zip` records the directory's mtime in the central
# directory and that field is *not* stripped by `-X` — leaving
# it alone would still leak the current system clock into the
# final hash.
touch -d '2020-01-01T00:00:00Z' \
  "$DIST_DIR/index.js" \
  "$DIST_DIR/manifest.json" \
  "$DIST_DIR/backend/plugin_$PLUGIN_ID" \
  "$DIST_DIR" \
  "$DIST_DIR/backend"
zip -X -r "$SCRIPT_DIR/$ZIP_NAME" index.js manifest.json backend/ > /dev/null

echo ""
echo "✓ Plugin package created: $SCRIPT_DIR/$ZIP_NAME"
echo "  Contents:"
zipinfo -1 "$SCRIPT_DIR/$ZIP_NAME"
echo ""
echo "Install via: Plugin Manager → drag & drop or select the zip file"
