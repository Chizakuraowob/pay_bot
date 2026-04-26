import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { prisma } from '../../db/index.js';
import { config } from '../../config.js';

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('管理指令（僅限授權者）')
  .addSubcommandGroup((g) =>
    g
      .setName('gateway')
      .setDescription('金流商管理')
      .addSubcommand((s) => s.setName('list').setDescription('列出所有金流商'))
      .addSubcommand((s) =>
        s
          .setName('enable')
          .setDescription('啟用金流商')
          .addStringOption((o) =>
            o.setName('provider').setDescription('provider 代號').setRequired(true).setAutocomplete(true),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('disable')
          .setDescription('停用金流商')
          .addStringOption((o) =>
            o.setName('provider').setDescription('provider 代號').setRequired(true).setAutocomplete(true),
          ),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('order')
      .setDescription('訂單管理')
      .addSubcommand((s) =>
        s
          .setName('list')
          .setDescription('列出最近訂單')
          .addStringOption((o) =>
            o
              .setName('status')
              .setDescription('狀態篩選')
              .addChoices(
                { name: 'pending', value: 'pending' },
                { name: 'paid', value: 'paid' },
                { name: 'failed', value: 'failed' },
                { name: 'expired', value: 'expired' },
                { name: 'cancelled', value: 'cancelled' },
              ),
          )
          .addIntegerOption((o) =>
            o.setName('take').setDescription('筆數 (預設 10)').setMinValue(1).setMaxValue(25),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('cancel')
          .setDescription('取消 pending 訂單')
          .addStringOption((o) => o.setName('trade_no').setDescription('訂單編號').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('info')
          .setDescription('查詢單筆訂單')
          .addStringOption((o) => o.setName('trade_no').setDescription('訂單編號').setRequired(true)),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('log')
      .setDescription('系統紀錄')
      .addSubcommand((s) =>
        s
          .setName('tail')
          .setDescription('查最近 log')
          .addStringOption((o) =>
            o
              .setName('level')
              .setDescription('level 篩選')
              .addChoices(
                { name: 'info', value: 'info' },
                { name: 'warn', value: 'warn' },
                { name: 'error', value: 'error' },
              ),
          )
          .addIntegerOption((o) =>
            o.setName('take').setDescription('筆數 (預設 10)').setMinValue(1).setMaxValue(25),
          ),
      ),
  )
  .addSubcommand((s) => s.setName('stats').setDescription('看訂單統計'));

function isAuthorized(userId) {
  const ids = config.discord.adminUserIds;
  return ids.length > 0 && ids.includes(userId);
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'provider') return;
  const rows = await prisma.gatewayConfig.findMany({ select: { provider: true, displayName: true } });
  const q = String(focused.value || '').toLowerCase();
  const choices = rows
    .filter((g) => !q || g.provider.includes(q))
    .slice(0, 25)
    .map((g) => ({ name: `${g.displayName} (${g.provider})`, value: g.provider }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  if (!isAuthorized(interaction.user.id)) {
    return interaction.reply({ content: '⛔ 你沒有管理權限。', ephemeral: true });
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'gateway') return handleGateway(interaction, sub);
  if (group === 'order') return handleOrder(interaction, sub);
  if (group === 'log') return handleLog(interaction, sub);
  if (sub === 'stats') return handleStats(interaction);
}

async function handleGateway(interaction, sub) {
  if (sub === 'list') {
    const rows = await prisma.gatewayConfig.findMany({ orderBy: { createdAt: 'asc' } });
    if (!rows.length) return interaction.reply({ content: '尚無金流設定。', ephemeral: true });
    const embed = new EmbedBuilder()
      .setTitle('💳 金流商列表')
      .setColor(0x3498db)
      .addFields(
        rows.map((g) => ({
          name: `${g.enabled ? '🟢' : '⚪'} ${g.displayName} (${g.provider})`,
          value: `沙箱：${g.sandbox ? '是' : '否'}`,
          inline: false,
        })),
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'enable' || sub === 'disable') {
    const provider = interaction.options.getString('provider', true);
    const exists = await prisma.gatewayConfig.findUnique({ where: { provider } });
    if (!exists) {
      return interaction.reply({ content: `找不到金流 \`${provider}\`。`, ephemeral: true });
    }
    const updated = await prisma.gatewayConfig.update({
      where: { provider },
      data: { enabled: sub === 'enable' },
    });
    return interaction.reply({
      content: `✅ \`${updated.provider}\` 已${sub === 'enable' ? '啟用' : '停用'}。`,
      ephemeral: true,
    });
  }
}

async function handleOrder(interaction, sub) {
  if (sub === 'list') {
    const status = interaction.options.getString('status');
    const take = interaction.options.getInteger('take') || 10;
    const where = status ? { status } : {};
    const rows = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take });
    if (!rows.length) return interaction.reply({ content: '無符合訂單。', ephemeral: true });
    const lines = rows.map(
      (o) =>
        `\`${o.tradeNo}\` ${statusEmoji(o.status)} NT$${o.amount.toLocaleString()} · ${o.itemName} · <t:${Math.floor(o.createdAt.getTime() / 1000)}:R>`,
    );
    const embed = new EmbedBuilder()
      .setTitle(`📋 訂單列表${status ? ` (${status})` : ''}`)
      .setColor(0x3498db)
      .setDescription(lines.join('\n'));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'info') {
    const tradeNo = interaction.options.getString('trade_no', true);
    const order = await prisma.order.findUnique({ where: { tradeNo } });
    if (!order) return interaction.reply({ content: `找不到 \`${tradeNo}\`。`, ephemeral: true });
    const embed = new EmbedBuilder()
      .setTitle(`📦 ${tradeNo}`)
      .setColor(0x3498db)
      .addFields(
        { name: '狀態', value: `${statusEmoji(order.status)} ${order.status}`, inline: true },
        { name: '金額', value: `NT$ ${order.amount.toLocaleString()}`, inline: true },
        { name: '金流', value: order.provider, inline: true },
        { name: '品項', value: order.itemName, inline: false },
        { name: '付款者', value: order.payerId ? `<@${order.payerId}>` : '不指定', inline: true },
        { name: '開立者', value: `<@${order.creatorId}>`, inline: true },
        {
          name: '建立時間',
          value: `<t:${Math.floor(order.createdAt.getTime() / 1000)}:f>`,
          inline: false,
        },
      );
    if (order.paidAt) {
      embed.addFields({
        name: '付款時間',
        value: `<t:${Math.floor(order.paidAt.getTime() / 1000)}:f>`,
        inline: false,
      });
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'cancel') {
    const tradeNo = interaction.options.getString('trade_no', true);
    const order = await prisma.order.findUnique({ where: { tradeNo } });
    if (!order) return interaction.reply({ content: `找不到 \`${tradeNo}\`。`, ephemeral: true });
    if (order.status !== 'pending') {
      return interaction.reply({
        content: `\`${tradeNo}\` 狀態為 ${order.status}，無法取消。`,
        ephemeral: true,
      });
    }
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'cancelled' },
    });
    const { updateOrderMessages } = await import('../messages.js');
    updateOrderMessages(updated).catch(() => {});
    return interaction.reply({ content: `🚫 已取消 \`${tradeNo}\`。`, ephemeral: true });
  }
}

async function handleLog(interaction, sub) {
  if (sub === 'tail') {
    const level = interaction.options.getString('level');
    const take = interaction.options.getInteger('take') || 10;
    const where = level ? { level } : {};
    const rows = await prisma.paymentLog.findMany({ where, orderBy: { createdAt: 'desc' }, take });
    if (!rows.length) return interaction.reply({ content: '無 log。', ephemeral: true });
    const lines = rows.map(
      (l) =>
        `${levelEmoji(l.level)} \`${l.event}\` ${l.message?.slice(0, 80) || ''} · <t:${Math.floor(l.createdAt.getTime() / 1000)}:R>`,
    );
    const embed = new EmbedBuilder()
      .setTitle(`📜 最近 log${level ? ` (${level})` : ''}`)
      .setColor(0x3498db)
      .setDescription(lines.join('\n').slice(0, 4000));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleStats(interaction) {
  const [pending, paid, failed, expired, cancelled, total, revenue] = await Promise.all([
    prisma.order.count({ where: { status: 'pending' } }),
    prisma.order.count({ where: { status: 'paid' } }),
    prisma.order.count({ where: { status: 'failed' } }),
    prisma.order.count({ where: { status: 'expired' } }),
    prisma.order.count({ where: { status: 'cancelled' } }),
    prisma.order.count(),
    prisma.order.aggregate({ where: { status: 'paid' }, _sum: { amount: true } }),
  ]);
  const embed = new EmbedBuilder()
    .setTitle('📊 訂單統計')
    .setColor(0x3498db)
    .addFields(
      { name: '⏳ pending', value: String(pending), inline: true },
      { name: '✅ paid', value: String(paid), inline: true },
      { name: '❌ failed', value: String(failed), inline: true },
      { name: '⌛ expired', value: String(expired), inline: true },
      { name: '🚫 cancelled', value: String(cancelled), inline: true },
      { name: '📦 total', value: String(total), inline: true },
      { name: '💰 已收金額', value: `NT$ ${(revenue._sum.amount || 0).toLocaleString()}`, inline: false },
    );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

function statusEmoji(s) {
  return { pending: '⏳', paid: '✅', failed: '❌', expired: '⌛', cancelled: '🚫' }[s] || '•';
}
function levelEmoji(l) {
  return { info: 'ℹ️', warn: '⚠️', error: '❌' }[l] || '•';
}
