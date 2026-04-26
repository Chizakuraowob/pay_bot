import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = config.security.encryptionKey;
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('ENCRYPTION_KEY must be 32-byte hex (64 chars)');
  }
  return Buffer.from(hex, 'hex');
}

// 回傳 "iv:tag:cipher" 三段 hex
export function encryptJson(obj) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function decryptJson(blob) {
  const key = getKey();
  const [ivHex, tagHex, encHex] = blob.split(':');
  if (!ivHex || !tagHex || !encHex) throw new Error('invalid encrypted blob');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

// 隨機 trade no（綠界上限 20 字元，英數字）
export function genTradeNo(prefix = 'P') {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  // 例 P + 8碼 + 8碼 = 17 碼
  return `${prefix}${ts}${rand}`.slice(0, 20);
}
