#!/bin/bash
# 密盘插件安装脚本 - 将构建产物安装到 SwallowNote app_data 目录
#
# 用法：bash install-secret-disk.sh
#
# 执行后启动 SwallowNote 应用即可在侧边栏看到密盘图标。

set -e

PLUGIN_ID="com.swallownote.secret-disk"
SOURCE_DIR="/Users/thking/code/codeBuddy/SwallowNote/plugins/secret-disk"
APP_DATA_DIR="$HOME/Library/Application Support/com.swallownote.app"
PLUGIN_DIR="$APP_DATA_DIR/plugins/$PLUGIN_ID/current"

echo "=== 密盘插件安装 ==="
echo "源目录: $SOURCE_DIR"
echo "目标目录: $PLUGIN_DIR"
echo ""

# 检查源文件
if [ ! -f "$SOURCE_DIR/dist/index.js" ]; then
  echo "[错误] 前端构建产物不存在: $SOURCE_DIR/dist/index.js"
  echo "请先在插件目录执行: npm run build"
  exit 1
fi
if [ ! -f "$SOURCE_DIR/backend/plugin_com.swallownote.secret-disk" ]; then
  echo "[错误] 后端二进制不存在: $SOURCE_DIR/backend/plugin_com.swallownote.secret-disk"
  echo "请先在插件目录执行: bash build.sh release"
  exit 1
fi

# 创建目标目录
mkdir -p "$PLUGIN_DIR/backend"

# 复制前端产物
cp "$SOURCE_DIR/dist/index.js" "$PLUGIN_DIR/"
cp "$SOURCE_DIR/manifest.json" "$PLUGIN_DIR/"
cp "$SOURCE_DIR/settings.json" "$PLUGIN_DIR/"

# 复制后端二进制并设置可执行权限
cp "$SOURCE_DIR/backend/plugin_com.swallownote.secret-disk" "$PLUGIN_DIR/backend/"
chmod +x "$PLUGIN_DIR/backend/plugin_com.swallownote.secret-disk"

# 标记来源为本地开发
echo "local" > "$PLUGIN_DIR/.source"

echo "=== 安装完成 ==="
echo ""
echo "已安装文件："
ls -la "$PLUGIN_DIR/"
echo ""
echo "后端二进制："
ls -la "$PLUGIN_DIR/backend/"
echo ""
echo "下一步："
echo "1. 启动 SwallowNote 应用"
echo "2. 侧边栏应出现密盘图标（Lock 图标）"
echo "3. 首次点击 → 设置密码 → 创建加密数据库"
echo "4. 验证 .swl 文件权限：ls -l \"$APP_DATA_DIR/plugins/$PLUGIN_ID/secret.swl\""
