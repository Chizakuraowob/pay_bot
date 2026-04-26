#!/usr/bin/env bash
# 一鍵部署 — Linux VPS。第一次執行會跑完整流程；第二次以後 reuse 設定。
#
# 用法：
#   bash scripts/deploy.sh           # 互動式部署
#   bash scripts/deploy.sh --restart # 拉取最新 code 並 reload pm2
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
info()  { color "36" "▶ $1"; }
ok()    { color "32" "✓ $1"; }
warn()  { color "33" "⚠ $1"; }
err()   { color "31" "✗ $1"; }

# ===== 0. 檢查環境 =====
command -v node >/dev/null 2>&1 || { err "找不到 node，請先安裝 Node.js 20+"; exit 1; }
command -v npm  >/dev/null 2>&1 || { err "找不到 npm";  exit 1; }

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Node 版本 < 20，建議升級到 20 以上"
fi

# ===== --restart 快速模式 =====
if [ "${1:-}" = "--restart" ]; then
  info "拉取最新 code..."
  git pull --ff-only || warn "git pull 失敗，繼續..."
  info "安裝/更新依賴..."
  npm ci --omit=dev || npm install --omit=dev
  info "套用 DB schema..."
  npx prisma db push --skip-generate
  npx prisma generate
  info "重啟 pm2..."
  npx pm2 reload ecosystem.config.cjs || npx pm2 start ecosystem.config.cjs
  ok "完成"
  exit 0
fi

# ===== 1. .env =====
if [ ! -f .env ]; then
  info "建立 .env（複製自 .env.example）"
  cp .env.example .env
  warn "請編輯 .env 填入 DISCORD_TOKEN / DISCORD_CLIENT_ID / PUBLIC_BASE_URL 等。完成後再跑一次 deploy.sh"
  exit 0
fi
ok ".env 已存在"

# 自動補產 ENCRYPTION_KEY / JWT_SECRET（若是空的）
gen_secret() {
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}
ensure_secret() {
  local key=$1
  if ! grep -qE "^${key}=." .env; then
    local val
    val=$(gen_secret)
    if grep -qE "^${key}=" .env; then
      sed -i.bak "s|^${key}=.*|${key}=${val}|" .env && rm -f .env.bak
    else
      echo "${key}=${val}" >> .env
    fi
    ok "已自動產生 ${key}"
  fi
}
ensure_secret ENCRYPTION_KEY
ensure_secret JWT_SECRET

# ===== 2. 依賴 =====
info "安裝依賴 (npm ci)..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
ok "依賴安裝完成"

# ===== 3. DB =====
mkdir -p data logs
info "套用 Prisma schema..."
npx prisma db push --skip-generate
npx prisma generate
ok "DB ready"

# ===== 4. 註冊 Slash Commands =====
info "註冊 Discord slash commands..."
npm run register-commands
ok "指令註冊完成"

# ===== 5. 第一個 admin =====
ADMIN_COUNT=$(node -e "
import('@prisma/client').then(async ({ PrismaClient }) => {
  const p = new PrismaClient();
  const n = await p.adminUser.count();
  console.log(n);
  await p.\$disconnect();
});
" 2>/dev/null || echo "0")

if [ "$ADMIN_COUNT" = "0" ]; then
  warn "尚未建立後台管理員。執行 npm run create-admin 建立。"
fi

# ===== 6. pm2 啟動 =====
if ! command -v pm2 >/dev/null 2>&1 && ! npx pm2 -v >/dev/null 2>&1; then
  info "安裝 pm2..."
  npm install -g pm2 || npm install pm2
fi

info "用 pm2 啟動..."
npx pm2 start ecosystem.config.cjs || npx pm2 reload ecosystem.config.cjs
npx pm2 save || true
ok "啟動完成。檢視：npx pm2 logs pay-discord-bot"

cat <<EOF

$(color "32" "═════════════ 部署完成 ═════════════")
  狀態      : npx pm2 status
  即時 log  : npx pm2 logs pay-discord-bot
  重啟      : bash scripts/deploy.sh --restart
  停止      : npx pm2 stop pay-discord-bot

  下一步：
    1. 若還沒建管理員：npm run create-admin
    2. 確認 PUBLIC_BASE_URL 對外可達（金流 callback 要打得進來）
    3. Discord 後台開好 log 頻道，把 ID 填進 .env DISCORD_LOG_CHANNEL_ID
EOF
