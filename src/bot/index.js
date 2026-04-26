import { Client, GatewayIntentBits, Events, Collection } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { getClient, setClient } from './client.js';
import * as charge from './commands/charge.js';
import * as admin from './commands/admin.js';

export { getClient };

const commands = new Collection();
commands.set(charge.data.name, charge);
commands.set(admin.data.name, admin);

export async function startBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info(`bot logged in as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const cmd = commands.get(interaction.commandName);
        if (!cmd) return;
        await cmd.execute(interaction);
      } else if (interaction.isAutocomplete()) {
        const cmd = commands.get(interaction.commandName);
        if (!cmd?.autocomplete) return;
        await cmd.autocomplete(interaction);
      }
    } catch (err) {
      logger.error({ err }, 'interaction error');
      if (interaction.isRepliable() && !interaction.replied) {
        try {
          await interaction.reply({ content: `⚠️ 錯誤：${err.message}`, ephemeral: true });
        } catch {}
      }
    }
  });

  await client.login(config.discord.token);
  setClient(client);
  return client;
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBot().catch((e) => {
    logger.error(e);
    process.exit(1);
  });
}
