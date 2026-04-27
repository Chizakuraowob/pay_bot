import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { prisma } from '../db/index.js';
import { listProviders, getGatewayClass } from '../gateways/index.js';
import { encryptJson, decryptJson } from '../lib/crypto.js';
import { isAuthorized } from './commands/admin.js';
import { logger } from '../lib/logger.js';

// customId 命名空間：admin:<section>[:<action>[:<arg>]]
const NS = 'admin';

// ===== 入口 =====

export async function dispatchAdmin(interaction) {
  if (!isAuthorized(interaction.user.id)) {
    return safeReply(interaction, { content: '⛔ 你沒有管理權限。' });
  }

  const id = interaction.customId || '';
  if (!id.startsWith(`${NS}:`)) return;
  const parts = id.split(':'); // [admin, section, action?, ...args]
  const [, section, action, ...args] = parts;

  try {
    if (section === 'home') return updateView(interaction, await renderMainMenu());

    if (section === 'gw') return await handleGateway(interaction, action, args);
    if (section === 'order') return await handleOrder(interaction, action, args);
    if (section === 'log') return await handleLog(interaction, action, args);
    if (section === 'stats') return await updateView(interaction, await renderStats());
    if (section === 'chg') return await handleCharger(interaction, action, args);
  } catch (err) {
    logger.error({ err, customId: id }, 'admin-ui dispatch error');
    await safeReply(interaction, { content: `⚠️ 錯誤：${err.message}` });
  }
}

// ===== 主選單 =====

export async function renderMainMenu() {
  const [gwCount, enabledCount, orderCount, pendingCount, chargerCount] = await Promise.all([
    prisma.gatewayConfig.count(),
    prisma.gatewayConfig.count({ where: { enabled: true } }),
    prisma.order.count(),
    prisma.order.count({ where: { status: 'pending' } }),
    prisma.charger.count().catch(() => 0),
  ]);

  const embed = new EmbedBuilder()
    .setTitle('🛠️ 管理面板')
    .setColor(0x3498db)
    .setDescription('請選擇要管理的項目（此訊息僅你可見）')
    .addFields(
      { name: '💳 金流商', value: `共 ${gwCount} 筆 / 啟用 ${enabledCount}`, inline: true },
      { name: '📋 訂單', value: `共 ${orderCount} 筆 / 待付 ${pendingCount}`, inline: true },
      { name: '👥 開單授權', value: `額外授權 ${chargerCount} 人`, inline: true },
    )
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    btn(`${NS}:gw`, '💳 金流商管理', ButtonStyle.Primary),
    btn(`${NS}:order`, '📋 訂單管理', ButtonStyle.Primary),
    btn(`${NS}:chg`, '👥 開單者管理', ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    btn(`${NS}:log`, '📜 系統紀錄', ButtonStyle.Secondary),
    btn(`${NS}:stats`, '📊 統計', ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

// ===== 金流商 =====

async function handleGateway(interaction, action, args) {
  // 入口：admin:gw  → 列表
  if (!action) return updateView(interaction, await renderGatewayList());

  // admin:gw:add  → 顯示 provider 選單
  if (action === 'add') {
    if (interaction.isStringSelectMenu()) {
      const provider = interaction.values[0];
      return interaction.showModal(buildGatewayModal(provider, null));
    }
    return updateView(interaction, renderProviderPicker());
  }

  // admin:gw:save:<provider>  → modal submit
  if (action === 'save') {
    const provider = args[0];
    return await saveGatewayFromModal(interaction, provider);
  }

  // admin:gw:view:<provider>
  if (action === 'view') {
    const provider = args[0];
    return updateView(interaction, await renderGatewayView(provider));
  }

  // admin:gw:viewsel  ← 來自金流列表 select menu
  if (action === 'viewsel' && interaction.isStringSelectMenu()) {
    const provider = interaction.values[0];
    return updateView(interaction, await renderGatewayView(provider));
  }

  // admin:gw:toggle:<provider>
  if (action === 'toggle') {
    const provider = args[0];
    const row = await prisma.gatewayConfig.findUnique({ where: { provider } });
    if (!row) return updateView(interaction, await renderGatewayList(`找不到 ${provider}`));
    await prisma.gatewayConfig.update({ where: { provider }, data: { enabled: !row.enabled } });
    return updateView(interaction, await renderGatewayView(provider));
  }

  // admin:gw:sandbox:<provider>
  if (action === 'sandbox') {
    const provider = args[0];
    const row = await prisma.gatewayConfig.findUnique({ where: { provider } });
    if (!row) return updateView(interaction, await renderGatewayList(`找不到 ${provider}`));
    await prisma.gatewayConfig.update({ where: { provider }, data: { sandbox: !row.sandbox } });
    return updateView(interaction, await renderGatewayView(provider));
  }

  // admin:gw:edit:<provider>  → 開憑證編輯 modal
  if (action === 'edit') {
    const provider = args[0];
    const row = await prisma.gatewayConfig.findUnique({ where: { provider } });
    if (!row) return updateView(interaction, await renderGatewayList(`找不到 ${provider}`));
    return interaction.showModal(buildGatewayModal(provider, row));
  }

  // admin:gw:delete:<provider>  → 二次確認
  if (action === 'delete') {
    const provider = args[0];
    return updateView(interaction, renderDeleteConfirm(provider));
  }

  // admin:gw:delconfirm:<provider>
  if (action === 'delconfirm') {
    const provider = args[0];
    await prisma.gatewayConfig.deleteMany({ where: { provider } });
    return updateView(interaction, await renderGatewayList(`🗑️ 已刪除 ${provider}`));
  }
}

async function renderGatewayList(notice) {
  const rows = await prisma.gatewayConfig.findMany({ orderBy: { createdAt: 'asc' } });

  const embed = new EmbedBuilder()
    .setTitle('💳 金流商管理')
    .setColor(0x3498db)
    .setDescription(
      [
        notice ? `> ${notice}` : null,
        rows.length
          ? rows.map((g) => `${g.enabled ? '🟢' : '⚪'} **${g.displayName}** \`${g.provider}\`${g.sandbox ? ' · 沙箱' : ''}`).join('\n')
          : '_尚無設定。點下方「新增金流」開始。_',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );

  const components = [];
  if (rows.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${NS}:gw:viewsel`)
          .setPlaceholder('選擇要管理的金流商…')
          .addOptions(
            rows.slice(0, 25).map((g) => ({
              label: `${g.displayName} (${g.provider})`,
              value: g.provider,
              description: `${g.enabled ? '啟用中' : '停用中'} · ${g.sandbox ? '沙箱' : '正式'}`,
            })),
          ),
      ),
    );
  }
  components.push(
    new ActionRowBuilder().addComponents(
      btn(`${NS}:gw:add`, '➕ 新增金流', ButtonStyle.Success),
      btn(`${NS}:gw`, '🔄 重新整理', ButtonStyle.Secondary),
      btn(`${NS}:home`, '⬅️ 返回', ButtonStyle.Secondary),
    ),
  );
  return { embeds: [embed], components };
}

function renderProviderPicker() {
  const providers = listProviders();
  const embed = new EmbedBuilder()
    .setTitle('➕ 新增金流')
    .setColor(0x2ecc71)
    .setDescription('選擇要新增的金流類型，下一步會跳出表單填入憑證。');
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${NS}:gw:add`)
      .setPlaceholder('選擇金流類型…')
      .addOptions(
        providers.map((p) => ({ label: p.displayName, value: p.provider, description: p.provider })),
      ),
  );
  const back = new ActionRowBuilder().addComponents(
    btn(`${NS}:gw`, '⬅️ 返回', ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row, back] };
}

async function renderGatewayView(provider) {
  const Cls = getGatewayClass(provider);
  const row = await prisma.gatewayConfig.findUnique({ where: { provider } });

  const embed = new EmbedBuilder()
    .setTitle(`💳 ${Cls.displayName}`)
    .setColor(row?.enabled ? 0x2ecc71 : 0x95a5a6)
    .addFields(
      { name: '代號', value: `\`${provider}\``, inline: true },
      { name: '狀態', value: row?.enabled ? '🟢 啟用' : '⚪ 停用', inline: true },
      { name: '環境', value: row?.sandbox ? '🧪 沙箱' : '🟢 正式', inline: true },
    );

  if (row) {
    const creds = safeDecrypt(row.credentials);
    const lines = Cls.credentialFields.map((f) => {
      const v = creds[f.key];
      return `• ${f.label}：${v ? (f.secret ? maskSecret(v) : v) : '_(未設定)_'}`;
    });
    embed.addFields({ name: '憑證', value: lines.join('\n') || '_(無)_', inline: false });
  } else {
    embed.setDescription('_尚未設定，點下方「填入憑證」建立。_');
  }

  const buttons = [];
  if (row) {
    buttons.push(btn(`${NS}:gw:toggle:${provider}`, row.enabled ? '⏸️ 停用' : '▶️ 啟用', row.enabled ? ButtonStyle.Secondary : ButtonStyle.Success));
    buttons.push(btn(`${NS}:gw:sandbox:${provider}`, row.sandbox ? '切換為正式' : '切換為沙箱', ButtonStyle.Secondary));
    buttons.push(btn(`${NS}:gw:edit:${provider}`, '✏️ 編輯憑證', ButtonStyle.Primary));
    buttons.push(btn(`${NS}:gw:delete:${provider}`, '🗑️ 刪除', ButtonStyle.Danger));
  } else {
    buttons.push(btn(`${NS}:gw:edit:${provider}`, '➕ 填入憑證', ButtonStyle.Success));
  }
  const action = new ActionRowBuilder().addComponents(...buttons.slice(0, 5));
  const back = new ActionRowBuilder().addComponents(btn(`${NS}:gw`, '⬅️ 返回列表', ButtonStyle.Secondary));
  return { embeds: [embed], components: [action, back] };
}

function renderDeleteConfirm(provider) {
  const embed = new EmbedBuilder()
    .setTitle(`🗑️ 確認刪除 ${provider}`)
    .setColor(0xe74c3c)
    .setDescription('刪除後會清掉憑證設定。已產生的歷史訂單不會被刪除。\n\n確定要刪除嗎？');
  const row = new ActionRowBuilder().addComponents(
    btn(`${NS}:gw:delconfirm:${provider}`, '✅ 確認刪除', ButtonStyle.Danger),
    btn(`${NS}:gw:view:${provider}`, '取消', ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

function buildGatewayModal(provider, existing) {
  const Cls = getGatewayClass(provider);
  const modal = new ModalBuilder()
    .setCustomId(`${NS}:gw:save:${provider}`)
    .setTitle(`${existing ? '編輯' : '新增'} ${Cls.displayName}`);

  // 第一行：顯示名稱
  const nameInput = new TextInputBuilder()
    .setCustomId('displayName')
    .setLabel('顯示名稱')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50)
    .setValue(existing?.displayName || Cls.displayName);

  // 第二行：sandbox
  const sandboxInput = new TextInputBuilder()
    .setCustomId('sandbox')
    .setLabel('使用沙箱？(yes / no)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3)
    .setValue(existing ? (existing.sandbox ? 'yes' : 'no') : 'yes');

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(sandboxInput),
  );

  // 憑證欄位（最多再加 3 個，符合 modal 5 行上限）
  for (const f of Cls.credentialFields.slice(0, 3)) {
    const input = new TextInputBuilder()
      .setCustomId(`cred_${f.key}`)
      .setLabel(`${f.label}${existing && f.secret ? '（留空=保留現值）' : ''}`)
      .setStyle(f.secret ? TextInputStyle.Short : TextInputStyle.Short)
      .setRequired(!existing && !!f.required)
      .setMaxLength(200);
    if (existing && !f.secret) {
      const creds = safeDecrypt(existing.credentials);
      if (creds[f.key]) input.setValue(String(creds[f.key]));
    }
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

async function saveGatewayFromModal(interaction, provider) {
  const Cls = getGatewayClass(provider);
  const displayName = interaction.fields.getTextInputValue('displayName').trim();
  const sandboxRaw = interaction.fields.getTextInputValue('sandbox').trim().toLowerCase();
  const sandbox = ['y', 'yes', 'true', '1', '是'].includes(sandboxRaw);

  const existing = await prisma.gatewayConfig.findUnique({ where: { provider } });
  const currentCreds = existing ? safeDecrypt(existing.credentials) : {};
  const merged = { ...currentCreds };
  for (const f of Cls.credentialFields.slice(0, 3)) {
    const v = interaction.fields.getTextInputValue(`cred_${f.key}`).trim();
    if (v) merged[f.key] = v;
  }

  // 必填驗證
  for (const f of Cls.credentialFields) {
    if (f.required && !merged[f.key]) {
      return safeReply(interaction, {
        content: `⚠️ 缺少必填欄位：${f.label}`,
      });
    }
  }

  await prisma.gatewayConfig.upsert({
    where: { provider },
    update: { displayName, sandbox, credentials: encryptJson(merged) },
    create: {
      provider,
      displayName,
      enabled: existing?.enabled ?? false,
      sandbox,
      credentials: encryptJson(merged),
    },
  });

  return updateView(interaction, await renderGatewayView(provider));
}

// ===== 訂單 =====

async function handleOrder(interaction, action, args) {
  if (!action) return updateView(interaction, await renderOrderList('pending'));

  if (action === 'list' || action === 'refresh') {
    const status = args[0] || 'pending';
    return updateView(interaction, await renderOrderList(status));
  }

  if (action === 'select' && interaction.isStringSelectMenu()) {
    const tradeNo = interaction.values[0];
    return updateView(interaction, await renderOrderView(tradeNo));
  }

  if (action === 'view') {
    const tradeNo = args[0];
    return updateView(interaction, await renderOrderView(tradeNo));
  }

  if (action === 'cancel') {
    const tradeNo = args[0];
    return updateView(interaction, renderCancelConfirm(tradeNo));
  }

  if (action === 'cancelconfirm') {
    const tradeNo = args[0];
    const order = await prisma.order.findUnique({ where: { tradeNo } });
    if (!order) return updateView(interaction, await renderOrderList('pending', `找不到 ${tradeNo}`));
    if (order.status !== 'pending') {
      return updateView(interaction, await renderOrderView(tradeNo));
    }
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'cancelled' },
    });
    const { updateOrderMessages } = await import('./messages.js');
    updateOrderMessages(updated).catch(() => {});
    return updateView(interaction, await renderOrderView(tradeNo));
  }
}

const ORDER_STATUSES = ['pending', 'paid', 'failed', 'expired', 'cancelled'];

async function renderOrderList(status, notice) {
  const rows = await prisma.order.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });

  const embed = new EmbedBuilder()
    .setTitle(`📋 訂單管理 — ${statusLabel(status)}`)
    .setColor(0x3498db)
    .setDescription(
      [
        notice ? `> ${notice}` : null,
        rows.length
          ? rows
              .slice(0, 15)
              .map(
                (o) =>
                  `\`${o.tradeNo}\` ${statusEmoji(o.status)} ${statusLabel(o.status)} · NT$${o.amount.toLocaleString()} · ${o.itemName.slice(0, 30)} · <t:${Math.floor(o.createdAt.getTime() / 1000)}:R>`,
              )
              .join('\n')
          : '_無資料_',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );

  const components = [];
  if (rows.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${NS}:order:select`)
          .setPlaceholder('查詢單筆訂單…')
          .addOptions(
            rows.slice(0, 25).map((o) => ({
              label: `${o.tradeNo} · NT$${o.amount.toLocaleString()}`,
              value: o.tradeNo,
              description: `${o.status} · ${o.itemName.slice(0, 50)}`,
            })),
          ),
      ),
    );
  }

  // 狀態切換 buttons（5 個剛好一行）
  const statusRow = new ActionRowBuilder().addComponents(
    ...ORDER_STATUSES.map((s) =>
      btn(`${NS}:order:list:${s}`, `${statusEmoji(s)} ${statusLabel(s)}`, s === status ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
  const nav = new ActionRowBuilder().addComponents(
    btn(`${NS}:order:refresh:${status}`, '🔄 重新整理', ButtonStyle.Secondary),
    btn(`${NS}:home`, '⬅️ 返回', ButtonStyle.Secondary),
  );
  components.push(statusRow, nav);
  return { embeds: [embed], components };
}

async function renderOrderView(tradeNo) {
  const order = await prisma.order.findUnique({ where: { tradeNo } });
  if (!order) {
    return renderOrderList('pending', `找不到 ${tradeNo}`);
  }
  const Cls = safeProviderClass(order.provider);
  const embed = new EmbedBuilder()
    .setTitle(`📦 ${order.tradeNo}`)
    .setColor(0x3498db)
    .addFields(
      { name: '狀態', value: `${statusEmoji(order.status)} ${statusLabel(order.status)}`, inline: true },
      { name: '金額', value: `NT$ ${order.amount.toLocaleString()}`, inline: true },
      { name: '金流', value: Cls?.displayName || order.provider, inline: true },
      { name: '品項', value: order.itemName, inline: false },
      { name: '付款者', value: order.payerId ? `<@${order.payerId}>` : '未指定', inline: true },
      { name: '開立者', value: `<@${order.creatorId}>`, inline: true },
      { name: '建立時間', value: `<t:${Math.floor(order.createdAt.getTime() / 1000)}:f>`, inline: false },
    );
  if (order.paidAt) {
    embed.addFields({
      name: '付款時間',
      value: `<t:${Math.floor(order.paidAt.getTime() / 1000)}:f>`,
      inline: false,
    });
  }

  const buttons = [];
  if (order.status === 'pending') {
    buttons.push(btn(`${NS}:order:cancel:${tradeNo}`, '🚫 取消訂單', ButtonStyle.Danger));
  }
  buttons.push(btn(`${NS}:order:list:${order.status}`, '⬅️ 返回列表', ButtonStyle.Secondary));
  buttons.push(btn(`${NS}:home`, '🏠 主選單', ButtonStyle.Secondary));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };
}

function renderCancelConfirm(tradeNo) {
  const embed = new EmbedBuilder()
    .setTitle(`🚫 確認取消 ${tradeNo}`)
    .setColor(0xe74c3c)
    .setDescription('取消後 Discord 訊息會更新成「已取消」。確定？');
  const row = new ActionRowBuilder().addComponents(
    btn(`${NS}:order:cancelconfirm:${tradeNo}`, '✅ 確認取消', ButtonStyle.Danger),
    btn(`${NS}:order:view:${tradeNo}`, '不取消', ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

// ===== Log =====

const LOG_LEVELS = ['all', 'info', 'warn', 'error'];

async function handleLog(interaction, action, args) {
  let level = 'all';
  if (action === 'level' || action === 'refresh') level = args[0] || 'all';
  return updateView(interaction, await renderLogTail(level));
}

async function renderLogTail(level = 'all') {
  const where = level && level !== 'all' ? { level } : {};
  const rows = await prisma.paymentLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 15 });

  const lines = rows.length
    ? rows
        .map(
          (l) =>
            `${levelEmoji(l.level)} \`${l.event}\` ${(l.message || '').slice(0, 70)} · <t:${Math.floor(l.createdAt.getTime() / 1000)}:R>`,
        )
        .join('\n')
    : '_無 log_';

  const embed = new EmbedBuilder()
    .setTitle(`📜 系統紀錄 — ${levelLabel(level)}`)
    .setColor(0x3498db)
    .setDescription(lines.slice(0, 4000));

  const levelRow = new ActionRowBuilder().addComponents(
    ...LOG_LEVELS.map((lv) =>
      btn(`${NS}:log:level:${lv}`, `${lv === 'all' ? '🌐 全部' : `${levelEmoji(lv)} ${levelLabel(lv)}`}`, lv === level ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
  const nav = new ActionRowBuilder().addComponents(
    btn(`${NS}:log:refresh:${level}`, '🔄 重新整理', ButtonStyle.Secondary),
    btn(`${NS}:home`, '⬅️ 返回', ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [levelRow, nav] };
}

// ===== 統計 =====

async function renderStats() {
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
      { name: '⏳ 等待支付', value: String(pending), inline: true },
      { name: '✅ 支付成功', value: String(paid), inline: true },
      { name: '❌ 付款失敗', value: String(failed), inline: true },
      { name: '⌛ 支付過期', value: String(expired), inline: true },
      { name: '🚫 支付取消', value: String(cancelled), inline: true },
      { name: '📦 總開單數', value: String(total), inline: true },
      { name: '💰 已收金額', value: `NT$ ${(revenue._sum.amount || 0).toLocaleString()}`, inline: false },
    );
  const row = new ActionRowBuilder().addComponents(
    btn(`${NS}:stats`, '🔄 重新整理', ButtonStyle.Secondary),
    btn(`${NS}:home`, '⬅️ 返回', ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

// ===== 開單者管理 =====

async function handleCharger(interaction, action, args) {
  // 入口：admin:chg
  if (!action) return updateView(interaction, await renderChargerList());

  // admin:chg:add ← UserSelectMenu submit
  if (action === 'add' && interaction.isUserSelectMenu?.()) {
    const userIds = interaction.values || [];
    const adminId = interaction.user.id;
    let added = 0;
    for (const uid of userIds) {
      const user = interaction.users?.get(uid);
      const username = user ? (user.globalName || user.username) : null;
      try {
        await prisma.charger.upsert({
          where: { userId: uid },
          update: { username },
          create: { userId: uid, username, addedBy: adminId },
        });
        added++;
      } catch (e) {
        logger.warn({ err: e, uid }, 'add charger failed');
      }
    }
    return updateView(interaction, await renderChargerList(`✅ 已新增 ${added} 位開單者`));
  }

  // admin:chg:remove:<userId>
  if (action === 'remove') {
    const uid = args[0];
    return updateView(interaction, await renderRemoveConfirm(uid));
  }

  // admin:chg:rmconfirm:<userId>
  if (action === 'rmconfirm') {
    const uid = args[0];
    await prisma.charger.deleteMany({ where: { userId: uid } });
    return updateView(interaction, await renderChargerList(`🗑️ 已移除 <@${uid}>`));
  }

  // admin:chg:select ← StringSelectMenu of existing chargers
  if (action === 'select' && interaction.isStringSelectMenu()) {
    const uid = interaction.values[0];
    return updateView(interaction, await renderRemoveConfirm(uid));
  }
}

async function renderChargerList(notice) {
  const rows = await prisma.charger.findMany({ orderBy: { createdAt: 'desc' } }).catch(() => []);

  const embed = new EmbedBuilder()
    .setTitle('👥 開單者管理')
    .setColor(0x3498db)
    .setDescription(
      [
        notice ? `> ${notice}` : null,
        '`DISCORD_ADMIN_USER_IDS` 中的管理員永遠擁有開單權限。下列為**額外授權**的開單者。',
        rows.length
          ? rows
              .map((c) => `• <@${c.userId}>${c.username ? ` (${c.username})` : ''} · 由 <@${c.addedBy}> 授權 · <t:${Math.floor(c.createdAt.getTime() / 1000)}:R>`)
              .join('\n')
          : '_目前無額外授權_',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );

  const components = [];
  // 用 UserSelectMenu 直接挑 Discord 使用者
  components.push(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`${NS}:chg:add`)
        .setPlaceholder('選擇要授權開單的使用者…（可多選）')
        .setMinValues(1)
        .setMaxValues(10),
    ),
  );

  // 已授權的列表 → 點選即進入移除確認
  if (rows.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${NS}:chg:select`)
          .setPlaceholder('選擇要移除的開單者…')
          .addOptions(
            rows.slice(0, 25).map((c) => ({
              label: c.username || c.userId,
              value: c.userId,
              description: `userId: ${c.userId}`,
            })),
          ),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      btn(`${NS}:chg`, '🔄 重新整理', ButtonStyle.Secondary),
      btn(`${NS}:home`, '⬅️ 返回', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

async function renderRemoveConfirm(userId) {
  const c = await prisma.charger.findUnique({ where: { userId } }).catch(() => null);
  const embed = new EmbedBuilder()
    .setTitle('🗑️ 確認移除開單授權')
    .setColor(0xe74c3c)
    .setDescription(`確定要撤銷 <@${userId}>${c?.username ? ` (${c.username})` : ''} 的開單權限？\n\n撤銷後該使用者就無法使用 \`/charge\`，但歷史訂單不會受影響。`);
  const row = new ActionRowBuilder().addComponents(
    btn(`${NS}:chg:rmconfirm:${userId}`, '✅ 確認移除', ButtonStyle.Danger),
    btn(`${NS}:chg`, '取消', ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

// ===== helpers =====

function btn(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

async function updateView(interaction, payload) {
  // ModalSubmit 來自 ephemeral message-component → isFromMessage()=true 才能 update
  if (interaction.isModalSubmit && interaction.isModalSubmit()) {
    if (interaction.isFromMessage && interaction.isFromMessage()) {
      return interaction.update(payload);
    }
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
  if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
    return interaction.update(payload);
  }
  // 從 slash command 進來時這個函式不會被叫到（execute 自己 reply），保險起見：
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (e) {
    logger.warn({ err: e }, 'safeReply failed');
  }
}

function safeDecrypt(blob) {
  try {
    return decryptJson(blob);
  } catch {
    return {};
  }
}

function maskSecret(s) {
  if (!s) return '';
  if (s.length <= 4) return '*'.repeat(s.length);
  return s.slice(0, 2) + '*'.repeat(Math.max(s.length - 4, 4)) + s.slice(-2);
}

function statusEmoji(s) {
  return { pending: '⏳', paid: '✅', failed: '❌', expired: '⌛', cancelled: '🚫' }[s] || '•';
}

function statusLabel(s) {
  return { pending: '待付款', paid: '已付款', failed: '失敗', expired: '已過期', cancelled: '已取消' }[s] || s;
}

function levelEmoji(l) {
  return { info: 'ℹ️', warn: '⚠️', error: '❌' }[l] || '•';
}

function levelLabel(l) {
  return { all: '全部', info: '資訊', warn: '警告', error: '錯誤' }[l] || l;
}

function safeProviderClass(provider) {
  try {
    return getGatewayClass(provider);
  } catch {
    return null;
  }
}
