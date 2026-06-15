#!/bin/bash
# Package the typist plugin into a zip that can be installed in SwallowNote.
#
# The zip file is named after the plugin id (com.swallownote.typist.zip)
# and contains:
#   - index.js          (ES module bundle built by Vite)
#   - manifest.json     (plugin metadata)
#   - backend/          (Rust binary for Markdown → themed HTML)
#     └── plugin_com.swallownote.typist
#
# Usage: ./package.sh [release]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-debug}"
PLUGIN_ID="com.swallownote.typist"
DIST_DIR="$SCRIPT_DIR/dist"

echo "==> Building frontend (Vite ES module bundle)..."
cd "$SCRIPT_DIR"
npx vite build

echo "==> Building backend (Rust binary)..."
cd "$SCRIPT_DIR"
if [ "$MODE" = "release" ]; then
  cargo build --release --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/release/plugin_com_swallownote_typist"
else
  cargo build --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/debug/plugin_com_swallownote_typist"
fi

# Copy backend binary into dist/backend/ with the expected name
mkdir -p "$DIST_DIR/backend"
cp "$BIN_PATH" "$DIST_DIR/backend/plugin_$PLUGIN_ID"
chmod +x "$DIST_DIR/backend/plugin_$PLUGIN_ID"

echo "==> Creating zip package..."
cd "$DIST_DIR"
ZIP_NAME="${PLUGIN_ID}.zip"
rm -f "$SCRIPT_DIR/$PLUGIN_ID"*.zip
zip -r "$SCRIPT_DIR/$ZIP_NAME" index.js manifest.json backend/

echo ""
echo "✓ Plugin package created: $SCRIPT_DIR/$ZIP_NAME"
echo "  Contents:"
zipinfo -1 "$SCRIPT_DIR/$ZIP_NAME"
echo ""
echo "Install via: Plugin Manager → drag & drop or select the zip file"
