import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECPayGateway } from '../src/gateways/ecpay.js';

const gw = new ECPayGateway({
  credentials: { merchantId: '2000132', hashKey: '5294y06JbISpM5x9', hashIv: 'v77hoKGq4kWxNNIS' },
  sandbox: true,
  publicBaseUrl: 'http://localhost',
});

test('CheckMacValue is deterministic', () => {
  const params = {
    MerchantID: '2000132',
    MerchantTradeNo: 'T0001',
    MerchantTradeDate: '2024/01/01 00:00:00',
    PaymentType: 'aio',
    TotalAmount: '100',
    TradeDesc: 'Hi',
    ItemName: 'X',
    ReturnURL: 'https://example.com/n',
    ChoosePayment: 'ALL',
    EncryptType: '1',
  };
  const a = gw._calcCheckMacValue({ ...params });
  const b = gw._calcCheckMacValue({ ...params });
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9A-F]+$/);
});

test('CheckMacValue is order-independent (alphabetical sort)', () => {
  const a = gw._calcCheckMacValue({ A: '1', B: '2', C: '3' });
  const b = gw._calcCheckMacValue({ C: '3', A: '1', B: '2' });
  assert.equal(a, b);
});

test('createOrder returns form_post with all required fields and a valid mac', async () => {
  const r = await gw.createOrder({
    tradeNo: 'TEST0001',
    amount: 250,
    itemName: 'unit-test',
    returnUrl: 'https://example.com/notify',
    clientReturnUrl: 'https://example.com/return',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  assert.equal(r.mode, 'form_post');
  assert.ok(r.actionUrl.includes('payment-stage.ecpay.com.tw'));
  for (const k of ['MerchantID', 'MerchantTradeNo', 'MerchantTradeDate', 'TotalAmount', 'CheckMacValue']) {
    assert.ok(r.formFields[k], `missing ${k}`);
  }
  // CheckMacValue 應由其他欄位算出
  const mac = r.formFields.CheckMacValue;
  const others = { ...r.formFields };
  delete others.CheckMacValue;
  assert.equal(gw._calcCheckMacValue(others), mac);
});

test('verifyCallback: paid + valid mac → ok=true status=paid', async () => {
  const body = {
    MerchantID: '2000132',
    MerchantTradeNo: 'T0001',
    RtnCode: '1',
    RtnMsg: 'Succeeded',
    PaymentDate: '2024/01/01 00:00:00',
    TradeAmt: '100',
  };
  body.CheckMacValue = gw._calcCheckMacValue(body);
  const r = await gw.verifyCallback(body);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'paid');
  assert.equal(r.tradeNo, 'T0001');
  assert.equal(r.ackResponse, '1|OK');
});

test('verifyCallback: tampered mac → ok=false', async () => {
  const body = {
    MerchantID: '2000132',
    MerchantTradeNo: 'T0001',
    RtnCode: '1',
    CheckMacValue: 'wrong',
  };
  const r = await gw.verifyCallback(body);
  assert.equal(r.ok, false);
});

test('verifyCallback: RtnCode != 1 → status=failed', async () => {
  const body = {
    MerchantID: '2000132',
    MerchantTradeNo: 'T0001',
    RtnCode: '10100073',
    RtnMsg: 'Fail',
  };
  body.CheckMacValue = gw._calcCheckMacValue(body);
  const r = await gw.verifyCallback(body);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'failed');
});
