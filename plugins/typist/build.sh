#!/bin/bash
# Build the typist plugin backend binary and place it in the expected location.
# The host's invoke_plugin looks for: <plugin_path>/backend/plugin_<plugin_id>
#
# Usage: ./build.sh [release]

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-debug}"

# Build the binary
if [ "$MODE" = "release" ]; then
  cargo build --release --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/release/plugin_com_swallownote_typist"
else
  cargo build --manifest-path "$SCRIPT_DIR/src-tauri/Cargo.toml"
  BIN_PATH="$SCRIPT_DIR/src-tauri/target/debug/plugin_com_swallownote_typist"
fi

# Create backend directory and copy with the expected name
mkdir -p "$SCRIPT_DIR/backend"
cp "$BIN_PATH" "$SCRIPT_DIR/backend/plugin_com.swallownote.typist"
chmod +x "$SCRIPT_DIR/backend/plugin_com.swallownote.typist"

echo "Built: $SCRIPT_DIR/backend/plugin_com.swallownote.typist"
