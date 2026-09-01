#!/bin/bash
# Kira 桌宠一键安装
#   curl -fsSL https://raw.githubusercontent.com/elivoa/kira/main/install.sh | bash
# 加 --user 装到 ~/Applications（不需要管理员权限，自动更新也完全无感）：
#   curl -fsSL https://raw.githubusercontent.com/elivoa/kira/main/install.sh | bash -s -- --user
set -euo pipefail

REPO="elivoa/kira"
APP_NAME="Kira.app"
DEST="/Applications"
if [ "${1:-}" = "--user" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

if [ "$(uname -m)" != "arm64" ]; then
  echo "注意：当前发布包只有 Apple Silicon (arm64) 版本，Intel Mac 暂时跑不了。" >&2
  exit 1
fi

echo "==> 查询最新版本…"
JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
TAG=$(printf '%s' "$JSON" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
DMG_URL=$(printf '%s' "$JSON" | sed -n 's/.*"browser_download_url": *"\([^"]*\.dmg\)".*/\1/p' | head -1)
[ -z "${DMG_URL:-}" ] && { echo "获取下载地址失败（仓库还没有 release？）" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "==> 下载 Kira ${TAG:-latest} …"
curl -fSL --progress-bar -o "$TMP/kira.dmg" "$DMG_URL"

echo "==> 挂载 dmg…"
MNT=$(hdiutil attach -nobrowse -readonly "$TMP/kira.dmg" | sed -n 's#.*\(/Volumes/.*\)#\1#p' | head -1)
[ -z "${MNT:-}" ] && { echo "挂载 dmg 失败" >&2; exit 1; }

echo "==> 安装到 $DEST …"
if [ -w "$DEST" ]; then
  rm -rf "$DEST/$APP_NAME"
  cp -R "$MNT/$APP_NAME" "$DEST/"
else
  sudo rm -rf "$DEST/$APP_NAME"
  sudo cp -R "$MNT/$APP_NAME" "$DEST/"
fi
hdiutil detach "$MNT" -quiet || true

# 未签名应用：必须去掉隔离属性，否则 Gatekeeper 报「已损坏」
if [ -w "$DEST/$APP_NAME" ]; then
  xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true
else
  sudo xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true
fi

echo "==> 完成！启动 Kira…"
open "$DEST/$APP_NAME"
echo "Kira ${TAG:-} 已装好。以后有新版本她会自己提示更新，不用再跑这个脚本。"
