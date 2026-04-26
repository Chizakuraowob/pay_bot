import readline from 'node:readline';
import bcrypt from 'bcrypt';
import { prisma } from '../src/db/index.js';
import { config } from '../src/config.js';

function ask(rl, q, { silent = false } = {}) {
  return new Promise((resolve) => {
    if (!silent) {
      rl.question(q, (a) => resolve(a));
      return;
    }
    // 隱藏輸入（密碼）
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(q);
    let buf = '';
    const onData = (ch) => {
      const s = ch.toString('utf8');
      for (const c of s) {
        if (c === '\n' || c === '\r') {
          stdout.write('\n');
          stdin.removeListener('data', onData);
          stdin.pause();
          stdin.setRawMode(false);
          resolve(buf);
          return;
        }
        if (c === '\u0003') process.exit(0);
        if (c === '\u007f') {
          if (buf.length) {
            buf = buf.slice(0, -1);
            stdout.write('\b \b');
          }
        } else {
          buf += c;
          stdout.write('*');
        }
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const username = (await ask(rl, `Username [${config.admin.username}]: `)) || config.admin.username;
  const pw = await ask(rl, 'Password: ', { silent: true });
  const pw2 = await ask(rl, 'Confirm:  ', { silent: true });
  rl.close();
  if (!pw || pw !== pw2) {
    console.error('密碼為空或不一致');
    process.exit(1);
  }
  const hash = await bcrypt.hash(pw, 12);
  const existing = await prisma.adminUser.findUnique({ where: { username } });
  if (existing) {
    await prisma.adminUser.update({ where: { id: existing.id }, data: { passwordHash: hash } });
    console.log(`已更新管理員 ${username} 的密碼`);
  } else {
    await prisma.adminUser.create({ data: { username, passwordHash: hash } });
    console.log(`已建立管理員 ${username}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
