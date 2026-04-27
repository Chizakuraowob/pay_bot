import { z } from 'zod';
import { prisma } from '../../db/index.js';
import { encryptJson, decryptJson } from '../../lib/crypto.js';
import { listProviders, getGatewayClass } from '../../gateways/index.js';
import { requireAdmin } from './admin-auth.js';

export async function adminRoutes(fastify) {
  fastify.addHook('preHandler', requireAdmin);

  // ===== Gateway providers (可用的金流類型) =====
  fastify.get('/api/admin/providers', async () => {
    return listProviders();
  });

  // ===== Gateway configs =====
  fastify.get('/api/admin/gateways', async () => {
    const rows = await prisma.gatewayConfig.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(maskGateway);
  });

  fastify.get('/api/admin/gateways/:id', async (req, reply) => {
    const row = await prisma.gatewayConfig.findUnique({ where: { id: req.params.id } });
    if (!row) {
      reply.code(404);
      return { error: 'not found' };
    }
    return maskGateway(row);
  });

  const upsertSchema = z.object({
    provider: z.string().min(1),
    displayName: z.string().min(1),
    enabled: z.boolean().optional(),
    sandbox: z.boolean().optional(),
    credentials: z.record(z.string()),
  });

  fastify.post('/api/admin/gateways', async (req, reply) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }
    const { provider, displayName, enabled, sandbox, credentials } = parsed.data;
    const Cls = safeGetClass(provider);
    if (!Cls) {
      reply.code(400);
      return { error: `unknown provider ${provider}` };
    }
    validateCredentials(Cls, credentials);
    const blob = encryptJson(credentials);
    const row = await prisma.gatewayConfig.upsert({
      where: { provider },
      update: {
        displayName,
        enabled: enabled ?? false,
        sandbox: sandbox ?? true,
        credentials: blob,
      },
      create: {
        provider,
        displayName,
        enabled: enabled ?? false,
        sandbox: sandbox ?? true,
        credentials: blob,
      },
    });
    return maskGateway(row);
  });

  fastify.patch('/api/admin/gateways/:id', async (req, reply) => {
    const row = await prisma.gatewayConfig.findUnique({ where: { id: req.params.id } });
    if (!row) {
      reply.code(404);
      return { error: 'not found' };
    }
    const body = req.body || {};
    const data = {};
    if ('displayName' in body) data.displayName = String(body.displayName);
    if ('enabled' in body) data.enabled = !!body.enabled;
    if ('sandbox' in body) data.sandbox = !!body.sandbox;
    if (body.credentials && typeof body.credentials === 'object') {
      const Cls = safeGetClass(row.provider);
      // 合併現有的，允許局部更新
      const current = decryptJson(row.credentials);
      const merged = { ...current, ...body.credentials };
      validateCredentials(Cls, merged);
      data.credentials = encryptJson(merged);
    }
    const updated = await prisma.gatewayConfig.update({ where: { id: row.id }, data });
    return maskGateway(updated);
  });

  fastify.delete('/api/admin/gateways/:id', async (req) => {
    await prisma.gatewayConfig.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  // ===== Orders =====
  fastify.get('/api/admin/orders', async (req) => {
    const { status, q, take = '50', skip = '0' } = req.query || {};
    const where = {};
    if (status) where.status = String(status);
    if (q) {
      where.OR = [
        { tradeNo: { contains: String(q) } },
        { itemName: { contains: String(q) } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(take), 200),
        skip: Number(skip),
      }),
      prisma.order.count({ where }),
    ]);
    return { rows, total };
  });

  fastify.get('/api/admin/orders/:id', async (req, reply) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { logs: { orderBy: { createdAt: 'desc' } } },
    });
    if (!order) {
      reply.code(404);
      return { error: 'not found' };
    }
    return order;
  });

  // ===== Chargers (開單授權白名單) =====
  fastify.get('/api/admin/chargers', async () => {
    return await prisma.charger.findMany({ orderBy: { createdAt: 'desc' } });
  });

  const chargerSchema = z.object({
    userId: z.string().regex(/^\d{15,25}$/, 'invalid Discord user id'),
    username: z.string().max(64).optional(),
  });

  fastify.post('/api/admin/chargers', async (req, reply) => {
    const parsed = chargerSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.flatten() };
    }
    const { userId, username } = parsed.data;
    const row = await prisma.charger.upsert({
      where: { userId },
      update: { username: username ?? null },
      create: { userId, username: username ?? null, addedBy: req.adminUser?.u || 'web' },
    });
    return row;
  });

  fastify.delete('/api/admin/chargers/:userId', async (req) => {
    await prisma.charger.deleteMany({ where: { userId: req.params.userId } });
    return { ok: true };
  });

  // ===== Logs =====
  fastify.get('/api/admin/logs', async (req) => {
    const { level, take = '100' } = req.query || {};
    const where = {};
    if (level) where.level = String(level);
    const rows = await prisma.paymentLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(take), 500),
    });
    return rows;
  });

  // ===== Stats =====
  fastify.get('/api/admin/stats', async () => {
    const [pending, paid, failed, expired, total] = await Promise.all([
      prisma.order.count({ where: { status: 'pending' } }),
      prisma.order.count({ where: { status: 'paid' } }),
      prisma.order.count({ where: { status: 'failed' } }),
      prisma.order.count({ where: { status: 'expired' } }),
      prisma.order.count(),
    ]);
    const revenue = await prisma.order.aggregate({
      where: { status: 'paid' },
      _sum: { amount: true },
    });
    return {
      orders: { pending, paid, failed, expired, total },
      revenue: revenue._sum.amount || 0,
    };
  });
}

function safeGetClass(provider) {
  try { return getGatewayClass(provider); } catch { return null; }
}

function validateCredentials(Cls, creds) {
  for (const f of Cls.credentialFields) {
    if (f.required && !creds[f.key]) {
      throw new Error(`missing credential field: ${f.key}`);
    }
  }
}

function maskGateway(row) {
  let creds = {};
  try {
    creds = decryptJson(row.credentials);
  } catch {}
  const Cls = safeGetClass(row.provider);
  const masked = {};
  if (Cls) {
    for (const f of Cls.credentialFields) {
      const v = creds[f.key];
      masked[f.key] = v ? (f.secret ? maskSecret(v) : v) : '';
    }
  } else {
    for (const [k, v] of Object.entries(creds)) masked[k] = maskSecret(String(v));
  }
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.displayName,
    enabled: row.enabled,
    sandbox: row.sandbox,
    credentials: masked,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function maskSecret(s) {
  if (!s) return '';
  if (s.length <= 4) return '*'.repeat(s.length);
  return s.slice(0, 2) + '*'.repeat(Math.max(s.length - 4, 4)) + s.slice(-2);
}
