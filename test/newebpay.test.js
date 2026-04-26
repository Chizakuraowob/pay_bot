import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NewebPayGateway } from '../src/gateways/newebpay.js';

const gw = new NewebPayGateway({
  credentials: {
    merchantId: 'MS123',
    hashKey: 'a'.repeat(32), // 32 bytes for AES-256
    hashIv: 'b'.repeat(16),  // 16 bytes for CBC iv
  },
  sandbox: true,
  publicBaseUrl: 'http://localhost',
});

test('createOrder produces TradeInfo + TradeSha', async () => {
  const r = await gw.createOrder({
    tradeNo: 'T0001',
    amount: 100,
    itemName: 'Hi',
    returnUrl: 'https://e.x/n',
    clientReturnUrl: 'https://e.x/r',
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(r.mode, 'form_post');
  assert.ok(r.formFields.TradeInfo);
  assert.match(r.formFields.TradeSha, /^[0-9A-F]{64}$/);
  assert.equal(r.formFields.MerchantID, 'MS123');
});

test('TradeSha = SHA256("HashKey=...&{TradeInfo}&HashIV=...").upper()', async () => {
  const r = await gw.createOrder({
    tradeNo: 'T0002',
    amount: 200,
    itemName: 'X',
    returnUrl: 'https://e.x/n',
    clientReturnUrl: 'https://e.x/r',
    expiresAt: new Date(Date.now() + 60_000),
  });
  const expected = crypto
    .createHash('sha256')
    .update(`HashKey=${'a'.repeat(32)}&${r.formFields.TradeInfo}&HashIV=${'b'.repeat(16)}`)
    .digest('hex')
    .toUpperCase();
  assert.equal(r.formFields.TradeSha, expected);
});

test('verifyCallback with mismatched TradeSha → ok=false', async () => {
  const r = await gw.verifyCallback({ TradeInfo: 'deadbeef', TradeSha: 'not-the-real-hash' });
  assert.equal(r.ok, false);
});

test('verifyCallback with valid signature and SUCCESS → status=paid', async () => {
  // 自己加密一筆假的 callback 資料
  const hashKey = 'a'.repeat(32);
  const hashIv = 'b'.repeat(16);
  const inner = JSON.stringify({
    Status: 'SUCCESS',
    Result: { MerchantOrderNo: 'TX', Amt: 100 },
  });
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(hashKey, 'utf8'), Buffer.from(hashIv, 'utf8'));
  const enc = Buffer.concat([cipher.update(inner, 'utf8'), cipher.final()]).toString('hex');
  const sha = crypto.createHash('sha256').update(`HashKey=${hashKey}&${enc}&HashIV=${hashIv}`).digest('hex').toUpperCase();
  const r = await gw.verifyCallback({ TradeInfo: enc, TradeSha: sha });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'paid');
  assert.equal(r.tradeNo, 'TX');
});
