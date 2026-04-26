import { prisma } from '../../db/index.js';
import { loadGateway } from '../../gateways/index.js';
import { updateOrderMessages } from '../../bot/messages.js';
import { notifyChannel, orderFields } from '../../bot/notifier.js';
import { logger } from '../../lib/logger.js';

export async function webhookRoutes(fastify) {
  fastify.post('/webhook/:provider', async (req, reply) => {
    const { provider } = req.params;
    const body = req.body || {};
    logger.info({ provider, keys: Object.keys(body) }, 'callback received');

    let gateway;
    try {
      ({ instance: gateway } = await loadGateway(provider));
    } catch (e) {
      logger.warn({ provider, msg: e.message }, 'gateway load failed');
      await prisma.paymentLog.create({
        data: { level: 'error', event: 'gateway_load_error', provider, message: e.message, payload: JSON.stringify(body) },
      });
      reply.code(400);
      return 'invalid gateway';
    }

    const result = await gateway.verifyCallback(body);
    if (!result.ok) {
      logger.warn({ provider, tradeNo: result.tradeNo, ack: result.ackResponse }, 'callback verify failed');
      await prisma.paymentLog.create({
        data: {
          level: 'warn',
          event: 'callback_verify_failed',
          provider,
          message: 'signature mismatch or invalid body',
          payload: JSON.stringify(body),
        },
      });
      reply.code(400);
      return result.ackResponse;
    }

    const order = await prisma.order.findUnique({ where: { tradeNo: result.tradeNo } });
    if (!order) {
      logger.warn({ provider, tradeNo: result.tradeNo }, 'order not found');
      await prisma.paymentLog.create({
        data: { level: 'warn', event: 'order_not_found', provider, message: result.tradeNo, payload: JSON.stringify(result.raw) },
      });
      reply.header('content-type', 'text/plain');
      return result.ackResponse;
    }

    // idempotent — 已經是終態就不重編輯
    if (['paid', 'failed', 'expired', 'cancelled'].includes(order.status)) {
      logger.info({ orderId: order.id, tradeNo: order.tradeNo, status: order.status }, 'callback duplicate (terminal status), skipping edit');
      await prisma.paymentLog.create({
        data: { level: 'info', orderId: order.id, event: 'callback_duplicate', provider, message: `already ${order.status}` },
      });
      reply.header('content-type', 'text/plain');
      return result.ackResponse;
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: result.status,
        paidAt: result.status === 'paid' ? new Date() : null,
        gatewayPayload: JSON.stringify(result.raw),
      },
    });

    await prisma.paymentLog.create({
      data: {
        level: 'info',
        orderId: order.id,
        event: 'callback_processed',
        provider,
        message: `status=${result.status}`,
        payload: JSON.stringify(result.raw),
      },
    });

    logger.info({ orderId: updated.id, tradeNo: updated.tradeNo, status: updated.status }, 'order updated, editing messages');
    // 編輯 Discord 訊息（embed + 監測訊息）
    updateOrderMessages(updated).catch((e) => logger.error({ err: e }, 'edit messages error'));

    // 鏡射到 log 頻道
    const titleByStatus = {
      paid: '✅ 付款完成',
      failed: '❌ 付款失敗',
      expired: '⌛ 訂單過期',
      cancelled: '🚫 訂單取消',
    };
    const levelByStatus = { paid: 'success', failed: 'error', expired: 'warn', cancelled: 'warn' };
    notifyChannel({
      level: levelByStatus[updated.status] || 'info',
      title: titleByStatus[updated.status] || `狀態更新: ${updated.status}`,
      fields: orderFields(updated),
    }).catch(() => {});

    reply.header('content-type', 'text/plain');
    return result.ackResponse;
  });
}
