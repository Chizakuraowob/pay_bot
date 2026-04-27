import crypto from 'node:crypto';
import { PaymentGateway } from './base.js';

/**
 * 速買配 SmilePay  Web ATM / 信用卡 / 超商代收 / ATM 整合付款
 * 文件：https://www.smilepay.net/api/spec/SPPayment.asp
 *
 * 串接重點：
 * - 用 GET / form-post 跳轉 SPPayment.asp，由 SmilePay 提供付款頁
 * - 背景通知（Roturl）回我們的 NotifyURL，body 含 Mid_smilepay 驗證碼
 *   Mid_smilepay 公式（VBScript Mid 為 1-indexed）：
 *     num1 = int( Mid(Smseid,1,1) + Mid(Smseid,6,2) + Mid(Smseid,3,2) + Mid(Smseid,8,1) )  // 6 位
 *     num2 = int( Mid(Smseid,2,1) + Mid(Smseid,7,1) )                                       // 2 位
 *     Mid_smilepay = right( int( num1 / num2 * Verify_key ), 4 )
 */
export class SmilePayGateway extends PaymentGateway {
  static provider = 'smilepay';
  static displayName = '速買配 SmilePay';
  static credentialFields = [
    { key: 'dcvc', label: 'Dcvc (商家代號)', required: true },
    { key: 'rvg2c', label: 'Rvg2c (參數加密代號)', required: true, secret: true },
    { key: 'verifyKey', label: 'Verify_key (驗證碼)', required: true, secret: true },
  ];

  get endpoint() {
    // SmilePay 沒有獨立 sandbox 網域，正式商店代碼即可走測試流程；
    // 若申請了測試帳號，仍走同一個 SPPayment.asp。
    return 'https://ssl.smse.com.tw/api/SPPayment.asp';
  }

  async createOrder({ tradeNo, amount, itemName, returnUrl, clientReturnUrl, expiresAt }) {
    const { dcvc, rvg2c } = this.credentials;
    const params = {
      Dcvc: dcvc,
      Rvg2c: rvg2c,
      Od_sob: itemName.slice(0, 60),
      Data_id: tradeNo,
      Pay_zg: 'all', // all = 全部付款方式；可改 3=信用卡 / 4=ATM / 5=超商
      Amount: amount,
      Deadline_date: formatYmdDash(expiresAt),
      Roturl: clientReturnUrl, // 前景導回
      Roturl_status: 'Send_url', // 啟用背景通知（值固定為 Send_url）
      Send_url: returnUrl, // 背景通知 URL
      Verify_value: 1, // 要求回傳 Mid_smilepay 驗證碼
    };

    return {
      mode: 'form_post',
      actionUrl: this.endpoint,
      formFields: params,
    };
  }

  async verifyCallback(body) {
    const tradeNo = String(body.Data_id || '');
    const smseid = String(body.Smseid || '');
    const amount = body.Amount;
    const midReceived = String(body.Mid_smilepay || '');

    if (!tradeNo || !smseid || !midReceived) {
      return { ok: false, tradeNo, status: 'failed', raw: body, ackResponse: '<Roturlstatus>NoData</Roturlstatus>' };
    }

    const expected = calcMidSmilepay(smseid, this.credentials.verifyKey);
    if (!safeEqual(expected, midReceived)) {
      return { ok: false, tradeNo, status: 'failed', raw: body, ackResponse: '<Roturlstatus>VerifyFail</Roturlstatus>' };
    }

    // SmilePay 背景通知抵達 = 已收款。Errcode 0 / 空 表示成功。
    const errcode = String(body.Errcode || '0').trim();
    const status = errcode === '0' || errcode === '' ? 'paid' : 'failed';

    return {
      ok: true,
      tradeNo,
      status,
      // 速買配的 Mid_smilepay 簽章只覆蓋 Smseid，amount/tradeNo 不在簽章內。
      // 回傳 amount 給 webhook 層做訂單金額比對，防 callback 重放至他單。
      amount: Number(amount) || null,
      raw: { ...body },
      // 速買配要求成功時回 <Roturlstatus>RL_OK</Roturlstatus>，否則它會重送
      ackResponse: '<Roturlstatus>RL_OK</Roturlstatus>',
      ackContentType: 'text/xml; charset=utf-8',
    };
  }
}

/**
 * 計算 Mid_smilepay（給 verifyCallback 用，也匯出供測試）
 * Smseid 長度 9~10。VBScript Mid 1-indexed → JS 對應 substr(start-1, len)
 */
export function calcMidSmilepay(smseid, verifyKey) {
  const m = (s, start, len) => s.substr(start - 1, len);
  const num1 = parseInt(m(smseid, 1, 1) + m(smseid, 6, 2) + m(smseid, 3, 2) + m(smseid, 8, 1), 10);
  const num2 = parseInt(m(smseid, 2, 1) + m(smseid, 7, 1), 10);
  if (!Number.isFinite(num1) || !num2) return '';
  const v = Math.floor((num1 / num2) * Number(verifyKey));
  const s = String(v);
  return s.slice(-4);
}

function formatYmdDash(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
