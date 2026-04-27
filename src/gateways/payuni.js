import crypto from 'node:crypto';
import { PaymentGateway } from './base.js';

/**
 * 統一金流 PAYUNi  Web ATM / 信用卡 / 超商 / ATM 整合付款
 * 文件：https://www.payuni.com.tw/docs/web/
 *
 * 加解密：AES-256-CBC + PKCS7 → base64
 * 簽章：SHA256("HashKey={hashKey}&{EncryptInfo}&HashIV={hashIv}").upper()
 */
export class PayuniGateway extends PaymentGateway {
  static provider = 'payuni';
  static displayName = '統一金流 PAYUNi';
  static credentialFields = [
    { key: 'merchantId', label: 'MerID (商店代號)', required: true },
    { key: 'hashKey', label: 'HashKey (32 bytes)', required: true, secret: true },
    { key: 'hashIv', label: 'HashIV (16 bytes)', required: true, secret: true },
  ];

  get endpoint() {
    return this.sandbox
      ? 'https://sandbox-api.payuni.com.tw/api/upp'
      : 'https://api.payuni.com.tw/api/upp';
  }

  async createOrder({ tradeNo, amount, itemName, returnUrl, clientReturnUrl, expiresAt }) {
    const { merchantId, hashKey, hashIv } = this.credentials;

    const data = {
      MerID: merchantId,
      MerTradeNo: tradeNo,
      TradeAmt: amount,
      ProdDesc: itemName.slice(0, 50),
      Timestamp: Math.floor(Date.now() / 1000),
      ReturnURL: clientReturnUrl,
      NotifyURL: returnUrl,
      BackURL: clientReturnUrl,
      ExpireDate: formatYmd(expiresAt),
      // 啟用所有付款方式
      API1: 1, // 信用卡
      API2: 1, // ATM
      API3: 1, // 超商代碼
    };

    const encryptInfo = aesEncrypt(toQueryString(data), hashKey, hashIv);
    const hashInfo = crypto
      .createHash('sha256')
      .update(`HashKey=${hashKey}&${encryptInfo}&HashIV=${hashIv}`)
      .digest('hex')
      .toUpperCase();

    return {
      mode: 'form_post',
      actionUrl: this.endpoint,
      formFields: {
        MerID: merchantId,
        Version: '1.0',
        EncryptInfo: encryptInfo,
        HashInfo: hashInfo,
      },
    };
  }

  async verifyCallback(body) {
    const { hashKey, hashIv } = this.credentials;
    const encrypted = body.EncryptInfo;
    const receivedHash = body.HashInfo;
    if (!encrypted) {
      return { ok: false, tradeNo: '', status: 'failed', raw: body, ackResponse: 'invalid' };
    }
    const expectedHash = crypto
      .createHash('sha256')
      .update(`HashKey=${hashKey}&${encrypted}&HashIV=${hashIv}`)
      .digest('hex')
      .toUpperCase();
    if (receivedHash !== expectedHash) {
      return { ok: false, tradeNo: '', status: 'failed', raw: body, ackResponse: 'hash mismatch' };
    }
    let decoded;
    try {
      const text = aesDecrypt(encrypted, hashKey, hashIv);
      decoded = parseDecoded(text);
    } catch (e) {
      return { ok: false, tradeNo: '', status: 'failed', raw: body, ackResponse: 'decrypt error' };
    }

    const result = decoded.Result || decoded;
    const tradeNo = result.MerTradeNo || decoded.MerTradeNo || '';
    // PAYUNi 成功：Status=SUCCESS / Message=success / TradeStatus=1
    const ok =
      decoded.Status === 'SUCCESS' ||
      result.TradeStatus === '1' ||
      result.TradeStatus === 1;
    return {
      ok: true,
      tradeNo,
      status: ok ? 'paid' : 'failed',
      raw: decoded,
      ackResponse: 'OK',
    };
  }
}

function toQueryString(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function parseDecoded(text) {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  // querystring fallback
  const out = {};
  for (const part of t.split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

function formatYmd(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function aesEncrypt(plain, key, iv) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

function aesDecrypt(b64, key, iv) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(Buffer.from(b64, 'base64')), decipher.final()]).toString('utf8');
}
