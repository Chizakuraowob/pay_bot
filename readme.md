# Pay Discord Bot

支援台灣金流（綠界 ECPay、藍新 NewebPay、統一金流 PAYUNi、速買配 SmilePay）的 Discord 收款 bot，含管理後台。

## 功能
- `/charge` 斜線指令：金額、品項、金流、指定付款者（可選）
- Embed 訊息含「前往付款」按鈕 + 監測訊息；終態時自動換成完成訊息
- 金流 callback 進來自動更新狀態（pending → paid / failed / expired / cancelled）
- **管理介面雙模式**：
  - 網頁後台 — 金流設定 / API key / 訂單 / log
  - Discord `/admin` 指令 — 同樣的功能但走 Discord（適合無法開 80/443 的 VPS）
- **Discord log 頻道**：訂單事件鏡射到指定頻道（建立 / 付款 / 失敗 / 過期）
- 多金流可切換，加新廠商只需實作 `PaymentGateway` interface

## 需求
- Node.js 20+
- 一張公網可達的網域（金流 callback 用）— 開發階段可用 ngrok / cloudflared
- 各家金流的測試 / 正式商店帳號

## 安裝

```bash
git clone <this-repo>
cd pay_discord_bot
npm install

cp .env.example .env
# 編輯 .env 填入 DISCORD_TOKEN / DISCORD_CLIENT_ID / PUBLIC_BASE_URL
# 產生 ENCRYPTION_KEY 與 JWT_SECRET：
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"

# 初始化資料庫
mkdir -p data
npm run db:push

# 建立後台管理員帳號（互動式輸入密碼）
npm run create-admin

# 註冊 Discord slash commands（首次或指令有變動時跑）
npm run register-commands
```

## 啟動

開發模式（同進程跑 bot + API）：
```bash
npm run dev
```

正式模式：
```bash
npm start
```

## 設定金流

1. 開後台 `https://your-domain/admin`，用剛建立的帳號登入
2. 「金流設定」→ 新增 / 編輯 gateway，貼上 MerchantID、HashKey、HashIV 等
3. 把該 gateway 啟用後，bot 才會把它列入 `/charge` 的選項

### 各金流必填欄位
| Gateway | 必填欄位 |
|---|---|
| ECPay 綠界 | MerchantID / HashKey / HashIV |
| NewebPay 藍新 | MerchantID / HashKey / HashIV |
| PAYUNi 統一金流 | MerID / HashKey (32 bytes) / HashIV (16 bytes) |
| SmilePay 速買配 | Dcvc / Rvg2c / Verify_key |

### 在金流後台設定 callback URL
- 綠界 `ReturnURL`：`{PUBLIC_BASE_URL}/webhook/ecpay`
- 綠界 `ClientBackURL`（付款完成導回）：`{PUBLIC_BASE_URL}/pay/return`
- 藍新 `NotifyURL`：`{PUBLIC_BASE_URL}/webhook/newebpay`
- 藍新 `ReturnURL`：`{PUBLIC_BASE_URL}/pay/return`
- PAYUNi `NotifyURL`：`{PUBLIC_BASE_URL}/webhook/payuni`
- PAYUNi `ReturnURL`：`{PUBLIC_BASE_URL}/pay/return`
- SmilePay `Send_url`（背景通知）：`{PUBLIC_BASE_URL}/webhook/smilepay`
- SmilePay `Roturl`（前景導回）：`{PUBLIC_BASE_URL}/pay/return`

## 使用方式（在 Discord）

### 開單
```
/charge amount:1000 item:活動報名費 gateway:ecpay payer:@小明
```
Bot 會回：
1. 一則 embed：含金額、品項、付款者、「前往付款」按鈕
2. 下一則監測訊息：⏳ — 付款完成 / 失敗 / 過期時，舊訊息會被刪掉並發新的完成訊息

### Discord 管理（替代後台）
先把自己 Discord User ID 加進 `DISCORD_ADMIN_USER_IDS`（可逗號分隔多人），然後在任一頻道輸入：
```
/admin
```
會跳出一張只有你看得到（ephemeral）的管理面板，含按鈕：
- 💳 **金流商管理** — 列表 / 新增（modal 表單填憑證） / 啟用停用 / 沙箱切換 / 編輯憑證 / 刪除（二次確認）
- 📋 **訂單管理** — 依狀態切換、單筆詳情、取消 pending 訂單（二次確認）
- 📜 **系統紀錄** — 依 level 過濾最近 log
- 📊 **統計** — 訂單數量 / 已收金額

所有按鈕、下拉選單、表單回應都是 ephemeral，僅發送 `/admin` 的管理員自己看得到，其他人不會看到也無法點按按鈕。新增 / 編輯金流憑證走 Discord 原生 modal 表單，不必開瀏覽器。

### Log 頻道
設定 `DISCORD_LOG_CHANNEL_ID` 後，bot 會把訂單事件以 embed 鏡射到該頻道（建立 / 付款 / 失敗 / 過期）。權限要點：bot 角色在該頻道需有 `Send Messages` 與 `Embed Links`。

## 部署到 VPS

### 一鍵部署（推薦）

```bash
# 1. 裝 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. clone 後跑部署腳本
git clone <this-repo>
cd pay_discord_bot
bash scripts/deploy.sh
# 第一次會建立 .env，編輯填入 DISCORD_TOKEN 等再跑一次
bash scripts/deploy.sh

# 後續更新
bash scripts/deploy.sh --restart
```

腳本會：自動產生 `ENCRYPTION_KEY` / `JWT_SECRET` → 安裝依賴 → `prisma db push` → 註冊 slash commands → 用 pm2 起服務（`ecosystem.config.cjs`）。

不想開 80/443 的話：依然能跑，只是網頁後台從外部進不去。可走 `/admin` Discord 指令做日常管理；金流 callback 仍需要對外可達的 URL（可用 Cloudflare Tunnel 把 `localhost:3000` 暴露出去，免開 port）。

### 手動 systemd（替代方案）

```bash
sudo nano /etc/systemd/system/pay-bot.service
```

```ini
[Unit]
Description=Pay Discord Bot
After=network.target

[Service]
Type=simple
User=botuser
WorkingDirectory=/home/botuser/pay_discord_bot
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/home/botuser/pay_discord_bot/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pay-bot
sudo systemctl status pay-bot
```

### Nginx 反向代理（範例）
```nginx
server {
    listen 443 ssl http2;
    server_name pay.example.com;

    ssl_certificate     /etc/letsencrypt/live/pay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 安全建議
- `.env` 權限設成 600：`chmod 600 .env`
- ENCRYPTION_KEY、JWT_SECRET **絕不能換**（換掉舊 API key 就無法解密）— 換之前先把 gateway 設定備份
- Admin web 一律走 HTTPS
- 定期備份 `data/app.db`（含加密後的 key）
- 金流 callback 來源 IP 可在 Nginx 加白名單（看各家公告）

## 測試 / 開發

### 1. Mock 金流（不需真金流帳號就能跑完整流程）
```bash
# 建立並啟用 mock gateway（會印出 secret）
npm run seed:mock

# 在 Discord：/charge amount:100 item:測試 gateway:mock
# 按「前往付款」→ 跳到本地假付款頁 → 按「模擬成功 / 失敗」
# 監測訊息會即時更新
```

### 2. CLI 模擬 callback（不開瀏覽器）
```bash
npm run simulate -- TX12345 paid
npm run simulate -- TX12345 failed
```
直接對 `/webhook/mock` 發送已簽章的 callback，等同點假付款頁的按鈕。
適合 grep 訊息編輯邏輯或寫整合測試。

### 3. 單元測試
```bash
npm test
```
涵蓋 crypto / ECPay 簽章 / NewebPay 加解密 / Mock HMAC（23 個 case）。

⚠️ **mock gateway 不要在 production 啟用** — 它會接受任何帶有有效 HMAC 的 callback，
等同把付款狀態交給任何持有 secret 的人。上線前到後台停用或刪除。

## 進度與規劃
詳見 [bot.md](./bot.md)

## 授權
Apache-2.0 License

## 製作者
Chizakura