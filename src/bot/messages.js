import { EmbedBuilder } from 'discord.js';
import { getClient } from './client.js';
import { logger } from '../lib/logger.js';

const STATUS_META = {
  pending: { color: 0x95a5a6, emoji: '⏳', title: '等待付款' },
  paid:    { color: 0x2ecc71, emoji: '✅', title: '付款完成' },
  failed:  { color: 0xe74c3c, emoji: '❌', title: '付款失敗' },
  expired: { color: 0x7f8c8d, emoji: '⌛', title: '已過期' },
  cancelled: { color: 0x7f8c8d, emoji: '🚫', title: '已取消' },
};

function buildMonitorEmbed(order) {
  const meta = STATUS_META[order.status] || STATUS_META.pending;
  const e = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${meta.emoji} ${meta.title}`)
    .setDescription(
      [
        `狀態：**${STATUS_META[order.status]?.title || order.status}**`,
        `訂單：\`${order.tradeNo}\``,
        `金額：NT$ ${order.amount.toLocaleString()}`,
        order.paidAt ? `付款時間：<t:${Math.floor(new Date(order.paidAt).getTime() / 1000)}:f>` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setTimestamp();
  return e;
}

const STATUS_PREFIX = {
  pending: '🟡 監測中…',
  paid: '🟢 完成',
  failed: '🔴 失敗',
  expired: '⚪ 過期',
  cancelled: '⚪ 取消',
};

export async function updateMonitorMessage(order) {
  const client = getClient();
  if (!client) {
    logger.warn('discord client not ready, skip monitor edit');
    return;
  }
  if (!order.channelId || !order.monitorMessageId) {
    logger.warn(
      { orderId: order.id, channelId: order.channelId, monitorMessageId: order.monitorMessageId },
      'updateMonitorMessage: missing channelId or monitorMessageId',
    );
    return;
  }
  logger.info({ orderId: order.id, monitorMessageId: order.monitorMessageId }, 'updateMonitorMessage: editing');
  try {
    const channel = await client.channels.fetch(order.channelId);
    if (!channel?.isTextBased()) {
      logger.warn({ orderId: order.id }, 'updateMonitorMessage: channel not text-based');
      return;
    }
    const msg = await channel.messages.fetch(order.monitorMessageId);
    await msg.edit({
      content: `${STATUS_PREFIX[order.status] || ''} \`${order.tradeNo}\``,
      embeds: [buildMonitorEmbed(order)],
    });
    logger.info({ orderId: order.id, status: order.status }, 'updateMonitorMessage: edit ok');
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'failed to edit monitor message');
  }
}

const TERMINAL = new Set(['paid', 'failed', 'expired', 'cancelled']);

function buildCompletionEmbed(order) {
  const meta = STATUS_META[order.status] || STATUS_META.failed;
  const fields = [
    { name: '品項', value: order.itemName, inline: true },
    { name: '金額', value: `NT$ ${order.amount.toLocaleString()}`, inline: true },
    { name: '付款者', value: order.payerId ? `<@${order.payerId}>` : '不指定', inline: true },
    { name: '訂單編號', value: `\`${order.tradeNo}\``, inline: false },
  ];
  if (order.paidAt) {
    fields.push({
      name: '付款時間',
      value: `<t:${Math.floor(new Date(order.paidAt).getTime() / 1000)}:f>`,
      inline: false,
    });
  }
  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${meta.emoji} ${meta.title}`)
    .addFields(fields)
    .setTimestamp();
}

// 終態：刪掉舊的 embed + monitor 訊息，發一則新的完成訊息
async function replaceWithCompletionMessage(order) {
  const client = getClient();
  if (!client) {
    logger.warn({ orderId: order.id }, 'replaceWithCompletionMessage: client not ready');
    return;
  }
  if (!order.channelId) {
    logger.warn({ orderId: order.id }, 'replaceWithCompletionMessage: no channelId');
    return;
  }
  try {
    const channel = await client.channels.fetch(order.channelId);
    if (!channel?.isTextBased()) {
      logger.warn({ orderId: order.id }, 'replaceWithCompletionMessage: channel not text-based');
      return;
    }

    for (const msgId of [order.embedMessageId, order.monitorMessageId].filter(Boolean)) {
      try {
        const old = await channel.messages.fetch(msgId);
        await old.delete();
        logger.info({ orderId: order.id, msgId }, 'deleted old message');
      } catch (e) {
        logger.warn({ orderId: order.id, msgId, msg: e.message }, 'delete old failed (ignored)');
      }
    }

    await channel.send({ embeds: [buildCompletionEmbed(order)] });
    logger.info({ orderId: order.id, status: order.status }, 'posted completion message');
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'replaceWithCompletionMessage: failed');
  }
}

// webhook 用：終態 → 刪舊發新；非終態 → 編輯監測訊息
export async function updateOrderMessages(order) {
  if (TERMINAL.has(order.status)) {
    await replaceWithCompletionMessage(order);
  } else {
    await updateMonitorMessage(order);
  }
}
