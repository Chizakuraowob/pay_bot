import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import * as charge from './commands/charge.js';
import * as admin from './commands/admin.js';

const body = [charge.data.toJSON(), admin.data.toJSON()];

const rest = new REST({ version: '10' }).setToken(config.discord.token);

try {
  if (config.discord.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body },
    );
    logger.info(`registered ${body.length} guild commands to ${config.discord.guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
    logger.info(`registered ${body.length} global commands`);
  }
} catch (e) {
  logger.error(e);
  process.exit(1);
}
