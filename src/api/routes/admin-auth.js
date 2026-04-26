import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../../db/index.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function adminAuthRoutes(fastify) {
  fastify.post('/api/admin/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid body' };
    }
    const { username, password } = parsed.data;
    const user = await prisma.adminUser.findUnique({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      reply.code(401);
      return { error: '帳號或密碼錯誤' };
    }
    await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = await reply.jwtSign({ uid: user.id, u: user.username }, { expiresIn: '7d' });
    reply.setCookie('admin_token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
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
