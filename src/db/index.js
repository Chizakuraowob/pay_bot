import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

export async function disconnectDb() {
  await prisma.$disconnect();
}
