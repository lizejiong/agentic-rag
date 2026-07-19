import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { argon2id, hash } from 'argon2';

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

    const bootstrapUsername = process.env['BOOTSTRAP_ADMIN_USERNAME']?.trim().toLowerCase();
    const bootstrapPassword = process.env['BOOTSTRAP_ADMIN_PASSWORD'];

    if (Boolean(bootstrapUsername) !== Boolean(bootstrapPassword)) {
      throw new Error(
        'BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must be configured together.',
      );
    }
    if (bootstrapPassword && bootstrapPassword.length < 12) {
      throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters.');
    }

    if (
      (await prisma.user.count()) === 0 &&
      bootstrapUsername &&
      bootstrapPassword
    ) {
      await prisma.user.create({
        data: {
          username: bootstrapUsername,
          displayName: 'Administrator',
          passwordHash: await hash(bootstrapPassword, {
            type: argon2id,
            memoryCost: 19_456,
            timeCost: 2,
            parallelism: 1,
          }),
          role: 'ADMIN',
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
