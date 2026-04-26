import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptJson, decryptJson, genTradeNo } from '../src/lib/crypto.js';

test('encrypt/decrypt round-trip', () => {
  const obj = { secret: 'hello', n: 42, deep: { ok: true } };
  const blob = encryptJson(obj);
  assert.match(blob, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  assert.deepEqual(decryptJson(blob), obj);
});

test('encrypt produces different ciphertext each time (random IV)', () => {
  const obj = { x: 1 };
  const a = encryptJson(obj);
  const b = encryptJson(obj);
  assert.notEqual(a, b);
});

test('decryptJson rejects tampered ciphertext', () => {
  const blob = encryptJson({ x: 1 });
  const [iv, tag, ct] = blob.split(':');
  // 翻轉 ciphertext 最後一個字元
  const flipped = ct.slice(0, -1) + (ct.endsWith('0') ? '1' : '0');
  const bad = `${iv}:${tag}:${flipped}`;
  assert.throws(() => decryptJson(bad));
});

test('decryptJson rejects bad blob format', () => {
  assert.throws(() => decryptJson('not-a-blob'));
});

test('genTradeNo produces 1-20 char alnum', () => {
  for (let i = 0; i < 50; i++) {
    const t = genTradeNo();
    assert.ok(t.length > 0 && t.length <= 20, `length ${t.length} out of range`);
    assert.match(t, /^[A-Z0-9]+$/);
  }
});

test('genTradeNo respects prefix', () => {
  assert.ok(genTradeNo('X').startsWith('X'));
});
