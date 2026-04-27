import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PayuniGateway } from '../src/gateways/payuni.js';

const gw = new PayuniGateway({
  credentials: {
    merchantId: 'M0001',
    hashKey: 'a'.repeat(32),
    hashIv: 'b'.repeat(16),
  },
  sandbox: true,
  publicBaseUrl: 'http://localhost',
});

test('createOrder returns form_post with EncryptInfo + HashInfo', async () => {
  const r = await gw.createOrder({
    tradeNo: 'TX0001',
    amount: 100,
    itemName: 'Hi',
    returnUrl: 'https://e.x/n',
    clientReturnUrl: 'https://e.x/r',
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(r.mode, 'form_post');
  assert.equal(r.formFields.MerID, 'M0001');
  assert.ok(r.formFields.EncryptInfo);
  assert.match(r.formFields.HashInfo, /^[0-9A-F]{64}$/);
});

test('HashInfo = SHA256("HashKey=...&{EncryptInfo}&HashIV=...").upper()', async () => {
  const r = await gw.createOrder({
    tradeNo: 'TX0002',
    amount: 200,
    itemName: 'X',
    returnUrl: 'https://e.x/n',
    clientReturnUrl: 'https://e.x/r',
    expiresAt: new Date(Date.now() + 60_000),
  });
  const expected = crypto
    .createHash('sha256')
    .update(`HashKey=${'a'.repeat(32)}&${r.formFields.EncryptInfo}&HashIV=${'b'.repeat(16)}`)
    .digest('hex')
    .toUpperCase();
  assert.equal(r.formFields.HashInfo, expected);
});

test('verifyCallback with mismatched HashInfo → ok=false', async () => {
  const r = await gw.verifyCallback({ EncryptInfo: 'AAAA', HashInfo: 'not-real' });
  assert.equal(r.ok, false);
});

test('verifyCallback with valid signature and SUCCESS → status=paid', async () => {
  const hashKey = 'a'.repeat(32);
  const hashIv = 'b'.repeat(16);
  const inner = JSON.stringify({
    Status: 'SUCCESS',
    Message: 'success',
    Result: { MerTradeNo: 'TXOK', TradeAmt: 100, TradeStatus: '1' },
  });
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(hashKey, 'utf8'), Buffer.from(hashIv, 'utf8'));
  const enc = Buffer.concat([cipher.update(inner, 'utf8'), cipher.final()]).toString('base64');
  const sha = crypto.createHash('sha256').update(`HashKey=${hashKey}&${enc}&HashIV=${hashIv}`).digest('hex').toUpperCase();
  const r = await gw.verifyCallback({ EncryptInfo: enc, HashInfo: sha });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'paid');
  assert.equal(r.tradeNo, 'TXOK');
});

test('verifyCallback with valid signature but Status!=SUCCESS → status=failed', async () => {
  const hashKey = 'a'.repeat(32);
  const hashIv = 'b'.repeat(16);
  const inner = JSON.stringify({ Status: 'FAIL', Result: { MerTradeNo: 'TXFAIL', TradeStatus: '0' } });
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(hashKey, 'utf8'), Buffer.from(hashIv, 'utf8'));
  const enc = Buffer.concat([cipher.update(inner, 'utf8'), cipher.final()]).toString('base64');
  const sha = crypto.createHash('sha256').update(`HashKey=${hashKey}&${enc}&HashIV=${hashIv}`).digest('hex').toUpperCase();
  const r = await gw.verifyCallback({ EncryptInfo: enc, HashInfo: sha });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'failed');
  assert.equal(r.tradeNo, 'TXFAIL');
});
