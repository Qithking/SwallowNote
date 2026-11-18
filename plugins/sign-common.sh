#!/usr/bin/env bash
# 插件包 ed25519 签名公共逻辑（各 package.sh source 后调用）。
#
# 用法：
#   source "$(dirname "$0")/../sign-common.sh"
#   plugin_sign_zip "$SCRIPT_DIR/$ZIP_NAME"
#
# 效果：设置全局变量 SIGNATURE_B64 / PUBKEY_B64。
#   - 密钥可用：两者为 base64 值，写入 repo.json 供宿主市场安装校验
#   - 密钥缺失：两者为空字符串，python3 同步段会清除旧签名
#     （未签名 zip 无法通过市场安装校验，仍可本地拖拽安装）

# shellcheck shell=bash
plugin_sign_zip() {
  local zip_path="$1"
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local tool=(
    cargo run --quiet
    --manifest-path "$repo_root/src-tauri/Cargo.toml"
    --example sign_plugin --
  )

  SIGNATURE_B64=""
  PUBKEY_B64=""
  if SIGNATURE_B64=$("${tool[@]}" sign "$zip_path"); then
    PUBKEY_B64=$("${tool[@]}" pubkey)
    echo "  ✓ signed (ed25519, pubkey ${PUBKEY_B64:0:12}...)"
  else
    SIGNATURE_B64=""
    PUBKEY_B64=""
    echo "  ⚠ 未找到签名密钥（SWALLOWNOTE_PLUGIN_SIGNING_KEY 或 plugins/.signing-key），已跳过签名"
    echo "  ⚠ 未签名 zip 无法通过市场安装校验，仍可本地拖拽安装"
  fi
}
