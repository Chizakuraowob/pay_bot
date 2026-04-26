# Pay Discord Bot — 進度紀錄

## 專案目標
- Discord bot 用斜線指令 `/charge` 開立付款連結
- 訊息含按鈕導向金流頁面
- 下方狀態訊息即時顯示付款狀態（pending → paid / failed / expired）
- 多金流廠商可切換（台灣：綠界 ECPay、藍新 NewebPay，後續可擴充）
- 網頁後台管理 API key、訂單、log

## 技術棧
- **Runtime**: Node.js 20+ (ESM)
- **Bot**: discord.js v14
- **API**: Fastify（webhook + admin API + 靜態後台）
- **DB**: SQLite + Prisma
- **加密**: AES-256-GCM（API key 落地加密）
- **後台**: 靜態 HTML + vanilla JS（單頁）+ JWT cookie
- **部署**: VPS（systemd / pm2）+ Nginx 反向代理

## 目錄結構
```
pay_discord_bot/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── index.js              # 主進入點（同進程跑 bot + api）
│   ├── config.js             # 環境變數載入
│   ├── lib/
│   │   ├── crypto.js         # AES-256-GCM
│   │   └── logger.js         # pino
│   ├── db/
│   │   └── index.js          # Prisma client
│   ├── gateways/
│   │   ├── base.js           # PaymentGateway interface
│   │   ├── ecpay.js          # 綠界
│   │   ├── newebpay.js       # 藍新
│   │   └── index.js          # registry / factory
│   ├── bot/
│   │   ├── index.js          # bot client
│   │   ├── register-commands.js
│   │   └── commands/
│   │       └── charge.js
│   └── api/
│       ├── index.js          # Fastify app
│       ├── routes/
│       │   ├── webhook.js    # /webhook/:gateway
│       │   ├── pay.js        # /pay/:orderId  (中介轉跳)
│       │   ├── admin-auth.js # /api/admin/login etc.
│       │   └── admin.js      # /api/admin/...
│       └── public/           # 靜態後台 SPA
├── scripts/
│   └── create-admin.js
├── data/                     # SQLite 檔案位置（runtime）
├── .env.example
├── bot.md                    # ← 本檔案
└── readme.md
```

## 進度

### v0.1 — 骨架與基礎建設 ✅ 已完成
- [x] package.json、目錄、.env.example、.gitignore
- [x] bot.md / readme.md
- [x] Prisma schema + DB layer (SQLite)
- [x] crypto (AES-256-GCM) / logger (pino) / config
- [x] gateway base interface
- [x] ECPay 綠界 adapter（CheckMacValue 驗章 + form_post）
- [x] NewebPay 藍新 adapter（AES-CBC TradeInfo + TradeSha）
- [x] Discord bot + `/charge` 指令（embed + 按鈕 + 監測訊息）
- [x] Webhook 接收 + 編輯狀態訊息（idempotent）
- [x] 中介付款頁 `/pay/:orderId`（動態產生表單 POST 給金流）
- [x] Admin web（登入、儀表板、金流 CRUD、訂單、log）
- [x] create-admin 腳本

### v0.1.1 — 測試模組 ✅
- [x] **Mock 金流 adapter**（`src/gateways/mock.js`）
  - 註冊為 `mock` provider
  - createOrder 重導到 `/_dev/mock-pay/:tradeNo`
  - 假付款頁顯示「模擬成功 / 失敗」兩顆按鈕，簽章伺服器端預先計算
  - HMAC-SHA256(`tradeNo|status|nonce`) 防偽
- [x] **Seed 腳本** `scripts/seed-mock-gateway.js`：一鍵建立啟用的 mock gateway
- [x] **CLI 模擬腳本** `scripts/simulate-callback.js`：繞過瀏覽器直接打 webhook
- [x] **單元測試** `test/`（23 個 case，全綠）
  - crypto round-trip / IV 隨機性 / 防竄改
  - ECPay CheckMacValue 確定性 / 排序無關 / paid+failed callback
  - NewebPay TradeInfo 加解密 / TradeSha 公式 / 驗章拒絕
  - Mock signMock 簽章正確性

### 已通過驗證
- 模組載入：所有 16 個 .js 檔可成功 import
- 加密：AES-256-GCM 加解密 round-trip
- 綠界：CheckMacValue 計算為固定值（deterministic），長度 64 hex
- 藍新：createOrder 產生 form_post + TradeInfo + TradeSha 64 hex
- API：/healthz、/admin/(SPA)、/api/admin/login 整套登入流程、/api/admin/me、/api/admin/providers、/api/admin/stats、/webhook/ecpay 預期錯誤回應
- DB：Prisma schema push 成功

### v0.2 — 待規劃
- [ ] 訂單過期定時任務（setInterval 掃 expired，並更新監測訊息）
- [ ] Discord OAuth 取代密碼登入
- [ ] 多 guild 支援（每個 guild 各自設定金流）
- [ ] 退款 / 部分退款
- [ ] LINE Pay / JKOPay / 街口支付 adapter
- [ ] CSRF token（目前只靠 SameSite=lax cookie）
- [ ] Webhook 來源 IP 白名單（綠界 / 藍新 callback IP）

## 啟動順序（首次）
1. `npm install`
2. `cp .env.example .env` 並填入必要值（ENCRYPTION_KEY / JWT_SECRET 用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 產生）
3. `mkdir -p data && npm run db:push`
4. `npm run create-admin` 建管理員
5. `npm run register-commands` 註冊 slash command
6. `npm run dev`（或 `npm start`）
7. 開 `http://localhost:3000/admin/` 設定金流

## 安全注意事項
- API key 一律 AES-256-GCM 加密後落地，明文只在記憶體
- Webhook 一律驗簽章 + idempotency（同一 trade_no 不重複處理）
- Admin web 走 HttpOnly cookie + CSRF token
- 金流 callback 來源 IP 可選擇性白名單（綠界、藍新有公布）
- 上線必走 HTTPS，Nginx 終結 TLS

## 訂單狀態流轉
```
pending ──(付款成功)──▶ paid
   │
   ├──(callback 失敗)──▶ failed
   │
   └──(超過 expiresAt)──▶ expired
```

## Callback 流程
1. 金流商 POST 到 `https://your-domain/webhook/{gateway}`
2. 驗簽章 → 失敗 reject
3. 找 order，狀態若已是終態（paid/failed/expired）→ 回 OK 但不重複編輯訊息
4. 更新 order 狀態 + 寫 payment_logs
5. 用 Discord REST 編輯 monitor message
6. 回應金流商指定的 ack 字串（綠界 `1|OK`、藍新 200）
