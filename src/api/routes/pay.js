import crypto from 'node:crypto';
import { prisma } from '../../db/index.js';
import { loadGateway } from '../../gateways/index.js';
import { decryptJson } from '../../lib/crypto.js';
import { signMock } from '../../gateways/mock.js';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

// 中介頁：使用者點 Discord 按鈕進來 → 我們動態產生付款表單 POST 給金流
// 這樣金流憑證 / 簽章都是即時計算，避免 Discord 訊息過期或 token 外洩
export async function payRoutes(fastify) {
  // GET /pay/:orderId  → HTML 自動 submit form
  fastify.get('/pay/:orderId', async (req, reply) => {
    const { orderId } = req.params;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      reply.code(404);
      return errorPage('找不到此訂單');
    }
    if (order.status !== 'pending') {
      return errorPage(`此訂單狀態為 ${order.status}，無法付款。`);
    }
    if (order.expiresAt < new Date()) {
      // 自動標記過期
      await prisma.order.update({ where: { id: order.id }, data: { status: 'expired' } });
      return errorPage('訂單已過期。');
    }

    let payload;
    try {
      const { instance } = await loadGateway(order.gatewayId, { byId: true });
      payload = await instance.createOrder({
        tradeNo: order.tradeNo,
        amount: order.amount,
        itemName: order.itemName,
        returnUrl: `${config.server.publicBaseUrl}/webhook/${order.provider}`,
        clientReturnUrl: `${config.server.publicBaseUrl}/pay/return?o=${order.id}`,
        expiresAt: order.expiresAt,
      });
    } catch (e) {
      logger.error({ err: e, orderId }, 'createOrder failed');
      return errorPage(`金流啟動失敗：${e.message}`);
    }

    reply.header('content-type', 'text/html; charset=utf-8');
    if (payload.mode === 'redirect') {
      reply.redirect(payload.paymentUrl, 302);
      return;
    }
    return autoSubmitForm(payload.actionUrl, payload.formFields);
  });

  // ===== Mock 金流測試頁 =====
  fastify.get('/_dev/mock-pay/:tradeNo', async (req, reply) => {
    const { tradeNo } = req.params;
    const order = await prisma.order.findUnique({ where: { tradeNo } });
    if (!order) {
      reply.code(404);
      return errorPage('找不到此訂單');
    }
    if (order.provider !== 'mock') {
      reply.code(400);
      return errorPage('此訂單非 mock 金流');
    }
    const gw = await prisma.gatewayConfig.findUnique({ where: { provider: 'mock' } });
    if (!gw) {
      reply.code(500);
      return errorPage('mock gateway 未設定');
    }
    const creds = decryptJson(gw.credentials);
    const nonce = crypto.randomBytes(8).toString('hex');
    const sigPaid = signMock(creds.secret, { tradeNo, status: 'paid', nonce });
    const sigFailed = signMock(creds.secret, { tradeNo, status: 'failed', nonce });
    // 用相對路徑，避免 PUBLIC_BASE_URL 被設為對外網域時，瀏覽器解析不到本機。
    const action = '/webhook/mock';
    reply.header('content-type', 'text/html; charset=utf-8');
    return mockPayHtml({
      order,
      action,
      nonce,
      sigPaid,
      sigFailed,
    });
  });

  // 使用者付款後瀏覽器導回 — 不一定可信，真正狀態以 server callback 為準
  fastify.all('/pay/return', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>付款完成</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
.box{text-align:center;max-width:480px;padding:32px;background:#1e293b;border-radius:12px}
h1{margin:0 0 12px}p{color:#94a3b8}</style></head>
<body><div class="box"><h1>✅ 已收到付款請求</h1><p>實際結果請回 Discord 查看訊息更新。可關閉此分頁。</p></div></body></html>`;
  });
}

function autoSubmitForm(action, fields) {
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(String(v))}">`)
    .join('\n');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>導向付款…</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
.box{text-align:center}</style></head>
<body><div class="box"><p>正在導向付款頁…</p>
<form id="f" method="post" action="${escapeHtml(action)}">${inputs}<noscript><button type="submit">繼續</button></noscript></form>
<script>document.getElementById('f').submit();</script></div></body></html>`;
}

function errorPage(msg) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>錯誤</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
.box{text-align:center;max-width:480px;padding:32px;background:#1e293b;border-radius:12px}</style></head>
<body><div class="box"><h1>⚠️ 無法付款</h1><p>${escapeHtml(msg)}</p></div></body></html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mockPayHtml({ order, action, nonce, sigPaid, sigFailed }) {
  const hidden = (status, sig) => `
    <input type="hidden" name="tradeNo" value="${escapeHtml(order.tradeNo)}">
    <input type="hidden" name="status" value="${status}">
    <input type="hidden" name="nonce" value="${escapeHtml(nonce)}">
    <input type="hidden" name="sig" value="${escapeHtml(sig)}">
  `;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>🧪 Mock 付款</title>
<style>
  body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .box{max-width:520px;width:100%;background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px}
  h1{margin:0 0 8px;font-size:22px}
  .sub{color:#f59e0b;font-size:13px;margin-bottom:24px}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #334155;font-size:14px}
  .row .k{color:#94a3b8}
  .actions{display:flex;gap:12px;margin-top:24px}
  button{flex:1;padding:14px;font-size:15px;font-weight:600;border:none;border-radius:8px;cursor:pointer;color:#fff}
  .ok{background:#10b981}
  .ok:hover{background:#059669}
  .fail{background:#ef4444}
  .fail:hover{background:#dc2626}
  code{background:#0f172a;padding:2px 6px;border-radius:4px;font-size:12px}
</style></head>
<body><div class="box">
  <h1>🧪 Mock 付款測試頁</h1>
  <div class="sub">⚠️ 這是 dev-only 假付款頁，不要在 production 啟用 mock gateway。</div>
  <div class="row"><span class="k">訂單</span><code>${escapeHtml(order.tradeNo)}</code></div>
  <div class="row"><span class="k">品項</span><span>${escapeHtml(order.itemName)}</span></div>
  <div class="row"><span class="k">金額</span><span>NT$ ${order.amount.toLocaleString()}</span></div>
  <div class="row"><span class="k">狀態</span><span>${order.status}</span></div>
  <div class="actions">
    <form method="post" action="${escapeHtml(action)}" style="flex:1">
      ${hidden('paid', sigPaid)}
      <button class="ok" type="submit">✅ 模擬成功</button>
    </form>
    <form method="post" action="${escapeHtml(action)}" style="flex:1">
      ${hidden('failed', sigFailed)}
      <button class="fail" type="submit">❌ 模擬失敗</button>
    </form>
  </div>
</div></body></html>`;
}
