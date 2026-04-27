import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../../db/index.js';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

// 簡單記憶體 rate limit：同 IP 連續失敗 5 次 → 鎖 10 分鐘
const failures = new Map(); // ip → { count, lockedUntil }
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 10 * 60 * 1000;

function checkRate(ip) {
  const now = Date.now();
  const f = failures.get(ip);
  if (!f) return { ok: true };
  if (f.lockedUntil && f.lockedUntil > now) return { ok: false, retryAfter: Math.ceil((f.lockedUntil - now) / 1000) };
  if (f.firstAt && now - f.firstAt > WINDOW_MS) {
    failures.delete(ip);
    return { ok: true };
  }
  return { ok: true };
}

function recordFailure(ip) {
  const now = Date.now();
  const f = failures.get(ip) || { count: 0, firstAt: now };
  f.count += 1;
  if (!f.firstAt) f.firstAt = now;
  if (f.count >= MAX_FAILS) f.lockedUntil = now + LOCK_MS;
  failures.set(ip, f);
}

function clearFailure(ip) {
  failures.delete(ip);
}

export async function adminAuthRoutes(fastify) {
  fastify.post('/api/admin/login', async (req, reply) => {
    const ip = req.ip || 'unknown';
    const rate = checkRate(ip);
    if (!rate.ok) {
      reply.code(429).header('retry-after', String(rate.retryAfter));
      return { error: `登入失敗次數過多，請於 ${Math.ceil(rate.retryAfter / 60)} 分鐘後再試` };
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body' };
    }
    const { username, password } = parsed.data;
    const user = await prisma.adminUser.findUnique({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      recordFailure(ip);
      reply.code(401);
      return { error: '帳號或密碼錯誤' };
    }
    clearFailure(ip);
    await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = await reply.jwtSign({ uid: user.id, u: user.username }, { expiresIn: '7d' });
    reply.setCookie('admin_token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60,
    });
    return { ok: true, username: user.username };
  });

  fastify.post('/api/admin/logout', async (_req, reply) => {
    reply.clearCookie('admin_token', { path: '/' });
    return { ok: true };
  });

  fastify.get('/api/admin/me', { preHandler: requireAdmin }, async (req) => {
    return { username: req.adminUser.u };
  });
}

export async function requireAdmin(req, reply) {
  try {
    const token = req.cookies?.admin_token;
    if (!token) throw new Error('no token');
    const payload = await req.jwtVerify({ onlyCookie: false }).catch(async () => {
      // fallback: 手動驗 cookie token
      return req.server.jwt.verify(token);
    });
    req.adminUser = payload;
  } catch {
    reply.code(401);
    throw new Error('unauthorized');
  }
}
