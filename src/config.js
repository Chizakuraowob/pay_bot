import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: process.env.DISCORD_GUILD_ID || null,
    logChannelId: process.env.DISCORD_LOG_CHANNEL_ID || null,
    adminUserIds: (process.env.DISCORD_ADMIN_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT || 3000),
    publicBaseUrl: required('PUBLIC_BASE_URL').replace(/\/$/, ''),
  },
  security: {
    encryptionKey: required('ENCRYPTION_KEY'),
    jwtSecret: required('JWT_SECRET'),
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
  },
  // 訂單預設過期時間（分鐘）
  orderExpireMinutes: Number(process.env.ORDER_EXPIRE_MINUTES || 30),
};
