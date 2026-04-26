import crypto from 'node:crypto';
import { PaymentGateway } from './base.js';

/**
 * 綠界 ECPay AIO Checkout V5
 * 文件：https://developers.ecpay.com.tw/?p=2856
 */
export class ECPayGateway extends PaymentGateway {
  static provider = 'ecpay';
  static displayName = '綠界 ECPay';
  static credentialFields = [
    { key: 'merchantId', label: 'MerchantID', required: true },
    { key: 'hashKey', label: 'HashKey', required: true, secret: true },
    { key: 'hashIv', label: 'HashIV', required: true, secret: true },
  ];

  get endpoint() {
    return this.sandbox
      ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
      : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
  }

  async createOrder({ tradeNo, amount, itemName, returnUrl, clientReturnUrl }) {
    const { merchantId } = this.credentials;
    // 綠界要求格式 YYYY/MM/DD HH:mm:ss
    const tradeDate = formatTradeDate(new Date());

    const params = {
      MerchantID: merchantId,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: tradeDate,
      PaymentType: 'aio',
      TotalAmount: String(amount),
      TradeDesc: encodeURIComponent('Discord Order'),
      ItemName: itemName.slice(0, 200),
      ReturnURL: returnUrl,
      ClientBackURL: clientReturnUrl,
      OrderResultURL: clientReturnUrl,
      ChoosePayment: 'ALL',
      EncryptType: '1',
    };
    params.CheckMacValue = this._calcCheckMacValue(params);

    return {
      mode: 'form_post',
      actionUrl: this.endpoint,
      formFields: params,
    };
  }

  async verifyCallback(body) {
    const received = body.CheckMacValue;
    const copy = { ...body };
    delete copy.CheckMacValue;
    const calc = this._calcCheckMacValue(copy);
    if (!received || received !== calc) {
      return { ok: false, tradeNo: body.MerchantTradeNo, status: 'failed', raw: body, ackResponse: '0|InvalidMac' };
    }
    const status = body.RtnCode === '1' || body.RtnCode === 1 ? 'paid' : 'failed';
    return {
      ok: true,
      tradeNo: body.MerchantTradeNo,
      status,
      raw: body,
      ackResponse: '1|OK',
    };
  }

  _calcCheckMacValue(params) {
    const { hashKey, hashIv } = this.credentials;
    // 1. 依 key A-Z 排序
    const keys = Object.keys(params).sort((a, b) => a.localeCompare(b));
    const joined = keys.map((k) => `${k}=${params[k]}`).join('&');
    // 2. 前後加 HashKey / HashIV
    const raw = `HashKey=${hashKey}&${joined}&HashIV=${hashIv}`;
    // 3. URL encode (.NET style) → 小寫
    const encoded = ecpayUrlEncode(raw).toLowerCase();
    // 4. SHA256 → 大寫
    return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
  }
}

function formatTradeDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 綠界要求 .NET style URL encode：encodeURIComponent + 還原幾個保留字元
function ecpayUrlEncode(s) {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/%21/g, '!')
    .replace(/%2A/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2D/g, '-')
    .replace(/%5F/g, '_')
    .replace(/%2E/g, '.');
}
