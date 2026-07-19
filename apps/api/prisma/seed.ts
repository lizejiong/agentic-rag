import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed the application database.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main(): Promise<void> {
  try {
    await prisma.authorizationState.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, revision: 0n },
    });
  } finally {
    await prisma.$disconnect();
  }
}

void main();
