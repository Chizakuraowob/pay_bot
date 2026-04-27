import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { renderMainMenu } from '../admin-ui.js';

export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('開啟管理面板（僅限授權者）');

export function isAuthorized(userId) {
  const ids = config.discord.adminUserIds;
  return ids.length > 0 && ids.includes(userId);
}

export async function execute(interaction) {
  if (!isAuthorized(interaction.user.id)) {
    return interaction.reply({ content: '⛔ 你沒有管理權限。', flags: MessageFlags.Ephemeral });
  }
  const view = await renderMainMenu();
  return interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
}
