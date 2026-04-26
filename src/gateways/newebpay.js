import crypto from 'node:crypto';
import { PaymentGateway } from './base.js';

/**
 * 藍新 NewebPay MPG
 * 文件：https://www.newebpay.com/website/Page/content/download_api
 */
export class NewebPayGateway extends PaymentGateway {
  static provider = 'newebpay';
  static displayName = '藍新 NewebPay';
  static credentialFields = [
    { key: 'merchantId', label: 'MerchantID', required: true },
    { key: 'hashKey', label: 'HashKey', required: true, secret: true },
    { key: 'hashIv', label: 'HashIV', required: true, secret: true },
  ];

  get endpoint() {
    return this.sandbox
      ? 'https://ccore.newebpay.com/MPG/mpg_gateway'
      : 'https://core.newebpay.com/MPG/mpg_gateway';
  }

  async createOrder({ tradeNo, amount, itemName, returnUrl, clientReturnUrl, expiresAt }) {
    const { merchantId, hashKey, hashIv } = this.credentials;

    const data = {
      MerchantID: merchantId,
      RespondType: 'JSON',
      TimeStamp: Math.floor(Date.now() / 1000),
      Version: '2.0',
      MerchantOrderNo: tradeNo,
      Amt: amount,
      ItemDesc: itemName.slice(0, 50),
      // 訂單有效時間（毫秒 → 分鐘差距），藍新用 ExpireDate / ExpireTime
      ExpireDate: formatYmd(expiresAt),
      ReturnURL: clientReturnUrl,
      NotifyURL: returnUrl,
      ClientBackURL: clientReturnUrl,
      // 啟用所有付款方式
      CREDIT: 1,
      VACC: 1,
    };

    const tradeInfo = aesEncrypt(toQueryString(data), hashKey, hashIv);
    const tradeSha = crypto
      .createHash('sha256')
      .update(`HashKey=${hashKey}&${tradeInfo}&HashIV=${hashIv}`)
      .digest('hex')
      .toUpperCase();

    return {
      mode: 'form_post',
      actionUrl: this.endpoint,
      formFields: {
        MerchantID: merchantId,
        TradeInfo: tradeInfo,
        TradeSha: tradeSha,
        Version: '2.0',
      },
    };
  }

  async verifyCallback(body) {
    const { hashKey, hashIv } = this.credentials;
    const encrypted = body.TradeInfo;
    const receivedSha = body.TradeSha;
    if (!encrypted) {
      return { ok: false, tradeNo: '', status: 'failed', raw: body, ackResponse: 'invalid' };
    }
    const expectedSha = crypto
      .createHash('sha256')
      .update(`HashKey=${hashKey}&${encrypted}&HashIV=${hashIv}`)
      .digest('hex')
      .toUpperCase();
    if (receivedSha !== expectedSha) {
      return { ok: false, tradeNo: '', status: 'failed', raw: body, ackResponse: 'sha mismatch' };
    }
    let decoded;
    try {
      const json = aesDecrypt(encrypted, hashKey, hashIv);
      decoded = JSON.parse(json);
    } catch (e) {
      return { ok: false, tradeNo: '', status: 'failed', raw: body, ackResponse: 'decrypt error' };
    }
    const result = decoded.Result || {};
    const status = decoded.Status === 'SUCCESS' ? 'paid' : 'failed';
    return {
      ok: true,
      tradeNo: result.MerchantOrderNo || '',
      status,
      raw: decoded,
      ackResponse: '1|OK',
    };
  }
}

function toQueryString(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function formatYmd(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// 藍新 AES-256-CBC + PKCS7
function aesEncrypt(plain, key, iv) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('hex');
}

function aesDecrypt(hex, key, iv) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'));
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()]).toString('utf8');
}
