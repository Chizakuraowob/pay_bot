import { ECPayGateway } from './ecpay.js';
import { NewebPayGateway } from './newebpay.js';
import { PayuniGateway } from './payuni.js';
import { SmilePayGateway } from './smilepay.js';
import { MockGateway } from './mock.js';
import { decryptJson } from '../lib/crypto.js';
import { config } from '../config.js';
import { prisma } from '../db/index.js';

const REGISTRY = new Map([
  [ECPayGateway.provider, ECPayGateway],
  [NewebPayGateway.provider, NewebPayGateway],
  [PayuniGateway.provider, PayuniGateway],
  [SmilePayGateway.provider, SmilePayGateway],
  [MockGateway.provider, MockGateway],
]);

export function listProviders() {
  return [...REGISTRY.values()].map((cls) => ({
    provider: cls.provider,
    displayName: cls.displayName,
    credentialFields: cls.credentialFields,
  }));
}

export function getGatewayClass(provider) {
  const cls = REGISTRY.get(provider);
  if (!cls) throw new Error(`unknown provider: ${provider}`);
  return cls;
}

// 從 DB 撈設定 + 解密 + 實例化
export async function loadGateway(providerOrConfigId, { byId = false } = {}) {
  const cfg = byId
    ? await prisma.gatewayConfig.findUnique({ where: { id: providerOrConfigId } })
    : await prisma.gatewayConfig.findUnique({ where: { provider: providerOrConfigId } });
  if (!cfg) throw new Error('gateway config not found');
  if (!cfg.enabled) throw new Error(`gateway ${cfg.provider} is disabled`);
  const credentials = decryptJson(cfg.credentials);
  const Cls = getGatewayClass(cfg.provider);
  return {
    config: cfg,
    instance: new Cls({
      credentials,
      sandbox: cfg.sandbox,
      publicBaseUrl: config.server.publicBaseUrl,
    }),
  };
}

// 列出所有啟用的 gateway（給 /charge 自動補全用）
export async function listEnabledGateways() {
  const rows = await prisma.gatewayConfig.findMany({ where: { enabled: true } });
  return rows.map((r) => ({
    provider: r.provider,
    displayName: r.displayName,
    sandbox: r.sandbox,
  }));
}
