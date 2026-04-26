import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { prisma } from '../../db/index.js';
import { listEnabledGateways } from '../../gateways/index.js';
import { genTradeNo } from '../../lib/crypto.js';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { notifyChannel, orderFields } from '../notifier.js';

export const data = new SlashCommandBuilder()
  .setName('charge')
  .setDescription('開立付款連結')
  .addIntegerOption((o) =>
    o.setName('amount').setDescription('金額 (TWD)').setMinValue(1).setMaxValue(1000000).setRequired(true),
  )
  .addStringOption((o) =>
    o.setName('item').setDescription('品項名稱').setMaxLength(100).setRequired(true),
  )
  .addStringOption((o) =>
    o.setName('gateway').setDescription('金流').setRequired(true).setAutocomplete(true),
  )
  .addUserOption((o) =>
    o.setName('payer').setDescription('指定付款者（可選）').setRequired(false),
  );

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'gateway') return;
  const gateways = await listEnabledGateways();
  const q = String(focused.value || '').toLowerCase();
  const choices = gateways
    .filter((g) => !q || g.provider.includes(q) || g.displayName.toLowerCase().includes(q))
    .slice(0, 25)
    .map((g) => ({
      name: `${g.displayName}${g.sandbox ? ' (測試)' : ''}`,
      value: g.provider,
    }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const amount = interaction.options.getInteger('amount', true);
  const item = interaction.options.getString('item', true);
  const provider = interaction.options.getString('gateway', true);
  const payer = interaction.options.getUser('payer');
  const expireMins = interaction.options.getInteger('expire') || config.orderExpireMinutes;

  const gw = await prisma.gatewayConfig.findUnique({ where: { provider } });
  if (!gw || !gw.enabled) {
    return interaction.reply({ content: `金流 \`${provider}\` 未啟用。請到後台設定。`, ephemeral: true });
  }

  const tradeNo = genTradeNo();
  const expiresAt = new Date(Date.now() + expireMins * 60_000);

  const order = await prisma.order.create({
    data: {
      tradeNo,
      amount,
      itemName: item,
      provider,
      gatewayId: gw.id,
      guildId: interaction.guildId || '',
      channelId: interaction.channelId,
      creatorId: interaction.user.id,
      payerId: payer?.id || null,
      expiresAt,
    },
  });

  const payUrl = `${config.server.publicBaseUrl}/pay/${order.id}`;

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('💳 付款請求')
    .setDescription(payer ? `<@${payer.id}> 請進行付款` : '請點擊下方按鈕付款')
    .addFields(
      { name: '品項', value: item, inline: true },
      { name: '金額', value: `NT$ ${amount.toLocaleString()}`, inline: true },
      { name: '金流', value: gw.displayName + (gw.sandbox ? ' (測試)' : ''), inline: true },
      { name: '付款者', value: payer ? `<@${payer.id}>` : '不指定', inline: true },
      { name: '開立者', value: `<@${interaction.user.id}>`, inline: true },
      { name: '有效期限', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true },
      { name: '訂單編號', value: `\`${tradeNo}\``, inline: false },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('前往付款').setURL(payUrl),
  );

  await interaction.reply({ embeds: [embed], components: [row] });
  const sent = await interaction.fetchReply();

  // 監測訊息
  const monitor = await interaction.followUp({
    content: `🟡 監測中… \`${tradeNo}\``,
    embeds: [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle('⏳ 等待付款')
        .setDescription(`狀態：**pending**\n訂單：\`${tradeNo}\``)
        .setTimestamp(),
    ],
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { embedMessageId: sent.id, monitorMessageId: monitor.id },
  });

  logger.info({ orderId: order.id, tradeNo, amount, provider }, 'order created');

  notifyChannel({
    level: 'info',
    title: '新訂單建立',
    fields: orderFields({ ...order, payerId: payer?.id || null, creatorId: interaction.user.id }),
  }).catch(() => {});
}
