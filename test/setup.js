// 預先設定 env，讓 src/config.js 載入時不會炸
// 用法：node --test --import ./test/setup.js test/
process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DISCORD_CLIENT_ID ||= 'test-client';
process.env.PUBLIC_BASE_URL ||= 'http://localhost:3000';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.JWT_SECRET ||= 'b'.repeat(64);
process.env.DATABASE_URL ||= 'file:../data/test.db';
