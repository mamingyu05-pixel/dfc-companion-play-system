#!/usr/bin/env bash
# Store one secret in the deployment .env without it appearing on screen, in shell history or in chat.
# Usage (on the server): sudo bash /opt/dfc/scripts/set-secret.sh DISCORD_TOKEN
set -euo pipefail

KEY="${1:-}"
ENV_FILE="${ENV_FILE:-/opt/dfc/.env}"
if [[ ! "$KEY" =~ ^[A-Z][A-Z0-9_]{1,63}$ ]]; then
  echo "用法: sudo bash $0 配置名，例如 DISCORD_TOKEN" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "找不到 $ENV_FILE" >&2
  exit 1
fi

read -rsp "请粘贴 $KEY 的值（输入时屏幕不会显示），然后按回车：" VALUE
echo
VALUE="$(printf '%s' "$VALUE" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
if [ -z "$VALUE" ]; then
  echo "没有输入内容，已取消。" >&2
  exit 1
fi
if [[ "$VALUE" == *$'\n'* ]]; then
  echo "值不能包含换行，已取消。" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
grep -v "^${KEY}=" "$ENV_FILE" > "$tmp" || true
printf '%s=%s\n' "$KEY" "$VALUE" >> "$tmp"
cat "$tmp" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "$KEY 已保存（${#VALUE} 个字符）。告诉 Claude「已保存」，由它重启服务。"
