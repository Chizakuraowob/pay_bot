// 用法：
//   node scripts/simulate-callback.js <tradeNo> paid|failed
//
// 流程：
//   1. 從 DB 撈訂單，確認 provider 是 mock
//   2. 取出 mock gateway secret
//   3. 計算 HMAC sig，POST 到本機 /webhook/mock
//   4. 印出回應；訂單狀態應更新，Discord 訊息應被編輯
//
// 前提：API 服務已啟動（npm run dev / start），mock gateway 已 seed。
import crypto from 'node:crypto';
import { prisma } from '../src/db/index.js';
import { decryptJson } from '../src/lib/crypto.js';
import { signMock } from '../src/gateways/mock.js';
import { config } from '../src/config.js';

const [, , tradeNo, status = 'paid'] = process.argv;
if (!tradeNo) {
  console.error('用法: node scripts/simulate-callback.js <tradeNo> [paid|failed]');
  process.exit(1);
}
if (!['paid', 'failed'].includes(status)) {
  console.error('status 必須是 paid 或 failed');
  process.exit(1);
}

const order = await prisma.order.findUnique({ where: { tradeNo } });
if (!order) {
  console.error(`找不到訂單 ${tradeNo}`);
  process.exit(1);
}
if (order.provider !== 'mock') {
  console.error(`訂單 ${tradeNo} 的 provider=${order.provider}，不是 mock。此腳本只能模擬 mock 訂單。`);
  process.exit(1);
}

const gw = await prisma.gatewayConfig.findUnique({ where: { provider: 'mock' } });
if (!gw) {
  console.error('mock gateway 未設定，請先跑 npm run seed:mock');
  process.exit(1);
}
const { secret } = decryptJson(gw.credentials);
const nonce = crypto.randomBytes(8).toString('hex');
const sig = signMock(secret, { tradeNo, status, nonce });

// 本機跑 simulate 一律打 localhost；PUBLIC_BASE_URL 是給外界（Discord 按鈕 / 真金流 callback）看的，
// 通常會是 https://pay.example.com 之類的對外網域，本機不一定能解析。
// 可用 SIMULATE_TARGET 環境變數覆寫。
const host = config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host;
const url = process.env.SIMULATE_TARGET || `http://${host}:${config.server.port}/webhook/mock`;
const body = new URLSearchParams({ tradeNo, status, nonce, sig });

console.log(`POST ${url}`);
console.log(`  ${body.toString()}`);

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body,
});
const text = await res.text();
console.log(`status: ${res.status}`);
console.log(`body  : ${text}`);

await prisma.$disconnect();
