import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const envFile = process.env.INFRA_ENV_FILE ?? 'infra/compose/.env';
const composeFile = 'infra/compose/compose.yaml';
const expectedServices = [
  'postgres',
  'elasticsearch',
  'neo4j',
  'redis',
  'minio',
];

if (!existsSync(envFile)) {
  console.error(
    `Infrastructure environment file is missing: ${envFile}\n` +
      'Copy infra/compose/.env.example to infra/compose/.env and try again.',
  );
  process.exit(1);
}

const result = spawnSync(
  process.platform === 'win32' ? 'docker.exe' : 'docker',
  [
    'compose',
    '--env-file',
    envFile,
    '-f',
    composeFile,
    'ps',
    '--format',
    'json',
    ...expectedServices,
  ],
  { encoding: 'utf8' },
);

if (result.status !== 0) {
  console.error(
    `Unable to inspect infrastructure.\n${result.stderr.trim()}\n` +
      'Start Docker and run pnpm infra:up.',
  );
  process.exit(result.status ?? 1);
}

const output = result.stdout.trim();
const parseRows = () => {
  if (!output) return [];
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
};

let rows;
try {
  rows = parseRows();
} catch (error) {
  console.error(`Docker Compose returned invalid JSON: ${error.message}`);
  process.exit(1);
}

const byService = new Map(rows.map((row) => [row.Service, row]));
const failures = [];

for (const service of expectedServices) {
  const row = byService.get(service);
  if (!row) {
    failures.push(`${service}: container is missing`);
    continue;
  }
  if (row.State !== 'running') {
    failures.push(`${service}: state is ${row.State ?? 'unknown'}`);
    continue;
  }
  if (row.Health !== 'healthy') {
    failures.push(`${service}: health is ${row.Health || 'not configured'}`);
  }
}

if (failures.length > 0) {
  console.error(
    `Infrastructure is not healthy:\n${failures.map((item) => `- ${item}`).join('\n')}\n` +
      'Inspect details with pnpm infra:ps.',
  );
  process.exit(1);
}

console.log(`Infrastructure is healthy: ${expectedServices.join(', ')}`);
