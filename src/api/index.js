import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyFormBody from '@fastify/formbody';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { webhookRoutes } from './routes/webhook.js';
import { payRoutes } from './routes/pay.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { adminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildApi() {
  const app = Fastify({ logger: false, trustProxy: true });

  await app.register(fastifyCors, { origin: false });
  await app.register(fastifyFormBody);
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: config.security.jwtSecret,
    cookie: { cookieName: 'admin_token', signed: false },
  });
  await app.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/admin/',
    redirect: true,
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/', async (_req, reply) => reply.redirect('/admin/'));
  app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));

  await app.register(webhookRoutes);
  await app.register(payRoutes);
  await app.register(adminAuthRoutes);
  await app.register(adminRoutes);

  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err }, 'api error');
    if (!reply.sent) {
      reply.code(err.statusCode || 500).send({ error: err.message });
    }
  });

  return app;
}

export async function startApi() {
  const app = await buildApi();
  await app.listen({ host: config.server.host, port: config.server.port });
  logger.info(`api listening on http://${config.server.host}:${config.server.port}`);
  return app;
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startApi().catch((e) => {
    logger.error(e);
    process.exit(1);
  });
}
