import { EmbedBuilder } from 'discord.js';
import { getClient } from './client.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const LEVEL_META = {
  info: { color: 0x3498db, emoji: 'ℹ️' },
  success: { color: 0x2ecc71, emoji: '✅' },
  warn: { color: 0xf1c40f, emoji: '⚠️' },
  error: { color: 0xe74c3c, emoji: '❌' },
};

// 把訂單 / 系統事件鏡射到 Discord log 頻道。失敗不阻塞主流程。
export async function notifyChannel({ level = 'info', title, fields = [], description }) {
  const channelId = config.discord.logChannelId;
  if (!channelId) return;
  const client = getClient();
  if (!client) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const meta = LEVEL_META[level] || LEVEL_META.info;
    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle(`${meta.emoji} ${title}`)
      .setTimestamp();
    if (description) embed.setDescription(description);
    if (fields.length) embed.addFields(fields);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn({ err: err.message }, 'notifyChannel failed');
  }
}

const STATUS_LABEL = {
  pending: '⏳ 待付款',
  paid: '✅ 已付款',
  failed: '❌ 失敗',
  expired: '⌛ 已過期',
  cancelled: '🚫 已取消',
};

export function orderFields(order) {
  return [
    { name: '訂單', value: `\`${order.tradeNo}\``, inline: true },
    { name: '金額', value: `NT$ ${order.amount.toLocaleString()}`, inline: true },
    { name: '金流', value: order.provider, inline: true },
    { name: '付款者', value: order.payerId ? `<@${order.payerId}>` : '不指定', inline: true },
    { name: '開立者', value: order.creatorId ? `<@${order.creatorId}>` : '-', inline: true },
    { name: '狀態', value: STATUS_LABEL[order.status] || order.status, inline: true },
  ];
}
