import crypto from 'node:crypto';
import { prisma } from '../src/db/index.js';
import { encryptJson } from '../src/lib/crypto.js';

const secret = process.env.MOCK_SECRET || crypto.randomBytes(16).toString('hex');

const credentials = encryptJson({ secret });

const row = await prisma.gatewayConfig.upsert({
  where: { provider: 'mock' },
  update: {
    enabled: true,
    sandbox: true,
    credentials,
  },
  create: {
    provider: 'mock',
    displayName: '🧪 Mock (測試用)',
    enabled: true,
    sandbox: true,
    credentials,
  },
});

console.log(`mock gateway 已建立 / 更新（id=${row.id}）`);
console.log(`secret = ${secret}`);
console.log('在 /charge gateway 選 "mock" 即可測試');
await prisma.$disconnect();
