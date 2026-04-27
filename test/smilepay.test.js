import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SmilePayGateway, calcMidSmilepay } from '../src/gateways/smilepay.js';

const gw = new SmilePayGateway({
  credentials: { dcvc: '9999', rvg2c: 'RVG', verifyKey: '1234' },
  sandbox: false,
  publicBaseUrl: 'http://localhost',
});

test('createOrder returns form_post with required SmilePay fields', async () => {
  const r = await gw.createOrder({
    tradeNo: 'TX0001',
    amount: 500,
    itemName: '測試品項',
    returnUrl: 'https://e.x/webhook/smilepay',
    clientReturnUrl: 'https://e.x/pay/return',
    expiresAt: new Date('2030-01-15T00:00:00Z'),
  });
  assert.equal(r.mode, 'form_post');
  assert.equal(r.formFields.Dcvc, '9999');
  assert.equal(r.formFields.Rvg2c, 'RVG');
  assert.equal(r.formFields.Data_id, 'TX0001');
  assert.equal(r.formFields.Amount, 500);
  assert.equal(r.formFields.Roturl_status, 'Send_url');
  assert.equal(r.formFields.Send_url, 'https://e.x/webhook/smilepay');
});

test('calcMidSmilepay matches documented formula', () => {
  // Smseid=1234567890, verifyKey=1000
  // num1 = "1" + "67" + "34" + "8" = "167348"
  // num2 = "2" + "7" = "27"
  // floor(167348 / 27 * 1000) = 6198074
  // last 4 = "8074"
  const got = calcMidSmilepay('1234567890', 1000);
  assert.equal(got, '8074');
});

test('verifyCallback rejects body without Smseid / Mid_smilepay', async () => {
  const r = await gw.verifyCallback({ Data_id: 'X', Amount: '100' });
  assert.equal(r.ok, false);
});

test('verifyCallback rejects bad Mid_smilepay', async () => {
  const r = await gw.verifyCallback({
    Data_id: 'TX',
    Amount: '100',
    Smseid: '1234567890',
    Mid_smilepay: '0000',
  });
  assert.equal(r.ok, false);
});

test('verifyCallback accepts valid Mid_smilepay → status=paid', async () => {
  const smseid = '1234567890';
  const mid = calcMidSmilepay(smseid, gw.credentials.verifyKey);
  const r = await gw.verifyCallback({
    Data_id: 'TXOK',
    Amount: '100',
    Smseid: smseid,
    Mid_smilepay: mid,
    Errcode: '0',
  });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'paid');
  assert.equal(r.tradeNo, 'TXOK');
  assert.equal(r.amount, 100);
  assert.match(r.ackResponse, /<Roturlstatus>RL_OK<\/Roturlstatus>/);
});

test('verifyCallback with Errcode != 0 → status=failed', async () => {
  const smseid = '1234567890';
  const mid = calcMidSmilepay(smseid, gw.credentials.verifyKey);
  const r = await gw.verifyCallback({
    Data_id: 'TXBAD',
    Amount: '100',
    Smseid: smseid,
    Mid_smilepay: mid,
    Errcode: '99',
  });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'failed');
});
