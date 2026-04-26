import crypto from 'node:crypto';
import { PaymentGateway } from './base.js';

/**
 * Mock 金流（dev 用）
 *
 * 流程：
 * 1. createOrder → redirect 到 ${publicBaseUrl}/_dev/mock-pay/:tradeNo
 * 2. /_dev/mock-pay/:tradeNo 顯示假付款頁，含「模擬成功 / 失敗」兩顆按鈕
 * 3. 按下後 POST 到 /webhook/mock，body 含 HMAC 簽章
 * 4. verifyCallback 驗 HMAC，回傳對應狀態
 *
 * 不要在 production 啟用！
 */
export class MockGateway extends PaymentGateway {
  static provider = 'mock';
  static displayName = '🧪 Mock (測試用)';
  static credentialFields = [
    { key: 'secret', label: 'Secret (HMAC)', required: true, secret: true },
  ];

  async createOrder({ tradeNo }) {
    return {
      mode: 'redirect',
      paymentUrl: `${this.publicBaseUrl}/_dev/mock-pay/${encodeURIComponent(tradeNo)}`,
    };
  }

  async verifyCallback(body) {
    const tradeNo = String(body.tradeNo || '');
    const status = String(body.status || '');
    const nonce = String(body.nonce || '');
    const sig = String(body.sig || '');
    if (!tradeNo || !['paid', 'failed'].includes(status) || !sig) {
      return { ok: false, tradeNo, status: 'failed', raw: body, ackResponse: 'invalid body' };
    }
    const expected = signMock(this.credentials.secret, { tradeNo, status, nonce });
    if (!safeEqual(expected, sig)) {
      return { ok: false, tradeNo, status: 'failed', raw: body, ackResponse: 'sig mismatch' };
    }
    return {
      ok: true,
      tradeNo,
      status,
      raw: body,
      ackResponse: 'OK',
    };
  }
}

export function signMock(secret, { tradeNo, status, nonce }) {
  return crypto
    .createHmac('sha256', String(secret))
    .update(`${tradeNo}|${status}|${nonce}`)
    .digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
