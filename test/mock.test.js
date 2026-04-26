import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockGateway, signMock } from '../src/gateways/mock.js';

const gw = new MockGateway({
  credentials: { secret: 'top-secret' },
  sandbox: true,
  publicBaseUrl: 'http://localhost:3000',
});

test('createOrder returns redirect to /_dev/mock-pay/:tradeNo', async () => {
  const r = await gw.createOrder({ tradeNo: 'TX001' });
  assert.equal(r.mode, 'redirect');
  assert.equal(r.paymentUrl, 'http://localhost:3000/_dev/mock-pay/TX001');
});

test('signMock is deterministic for the same inputs', () => {
  const a = signMock('s', { tradeNo: 'A', status: 'paid', nonce: 'n' });
  const b = signMock('s', { tradeNo: 'A', status: 'paid', nonce: 'n' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('signMock differs across status / nonce / secret', () => {
  const base = signMock('s', { tradeNo: 'A', status: 'paid', nonce: 'n' });
  assert.notEqual(base, signMock('s', { tradeNo: 'A', status: 'failed', nonce: 'n' }));
  assert.notEqual(base, signMock('s', { tradeNo: 'A', status: 'paid', nonce: 'n2' }));
  assert.notEqual(base, signMock('s2', { tradeNo: 'A', status: 'paid', nonce: 'n' }));
});

test('verifyCallback ok with valid HMAC', async () => {
  const tradeNo = 'TX001';
  const status = 'paid';
  const nonce = 'abc';
  const sig = signMock('top-secret', { tradeNo, status, nonce });
  const r = await gw.verifyCallback({ tradeNo, status, nonce, sig });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'paid');
  assert.equal(r.tradeNo, 'TX001');
});

test('verifyCallback rejects bad sig', async () => {
  const r = await gw.verifyCallback({ tradeNo: 'X', status: 'paid', nonce: 'n', sig: 'wrong' });
  assert.equal(r.ok, false);
});

test('verifyCallback rejects invalid status', async () => {
  const tradeNo = 'X';
  const sig = signMock('top-secret', { tradeNo, status: 'haxxor', nonce: 'n' });
  const r = await gw.verifyCallback({ tradeNo, status: 'haxxor', nonce: 'n', sig });
  assert.equal(r.ok, false);
});

test('verifyCallback rejects empty body', async () => {
  const r = await gw.verifyCallback({});
  assert.equal(r.ok, false);
});
