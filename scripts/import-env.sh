#!/usr/bin/env bash
# Merge bot / AI settings copied from an old deployment's .env into this one without echoing values.
# Usage (on the new server): sudo bash /opt/dfc/scripts/import-env.sh, paste the lines, then press Ctrl+D.
# Only KOOK_*, DISCORD_*, AI_*, OPENAI_API_KEY and SUPPORT_* keys are accepted; everything else is ignored,
# so database passwords and JWT secrets of the new server can never be overwritten by a paste.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/dfc/.env}"
[ -f "$ENV_FILE" ] || { echo "找不到 $ENV_FILE" >&2; exit 1; }

echo "请粘贴从旧服务器复制的配置行（屏幕不会显示），粘贴完按回车，再按 Ctrl+D："
stty -echo 2>/dev/null || true
input="$(cat | tr -d '\r')"
stty echo 2>/dev/null || true
echo

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cp "$ENV_FILE" "$tmp"
imported=()
while IFS= read -r line; do
  [[ "$line" =~ ^(KOOK_[A-Z0-9_]+|DISCORD_[A-Z0-9_]+|AI_[A-Z0-9_]+|OPENAI_API_KEY|SUPPORT_[A-Z0-9_]+)=(.*)$ ]] || continue
  key="${BASH_REMATCH[1]}" value="${BASH_REMATCH[2]}"
  [ -n "$value" ] || continue
  grep -v "^${key}=" "$tmp" > "$tmp.next" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp.next"
  mv "$tmp.next" "$tmp"
  imported+=("$key")
done <<< "$input"

if [ "${#imported[@]}" -eq 0 ]; then
  echo "没有识别到可导入的配置行（需要形如 KOOK_TOKEN=... 的行）。" >&2
  exit 1
fi
cat "$tmp" > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "已导入 ${#imported[@]} 项：${imported[*]}"
echo "告诉 Claude「已导入」，由它重启服务。"
