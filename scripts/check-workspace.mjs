import { existsSync } from 'node:fs';

const requiredFiles = [
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'packages/contracts/package.json',
  'services/ai/pyproject.toml',
];

const missingFiles = requiredFiles.filter((file) => !existsSync(file));

if (missingFiles.length > 0) {
  console.error(`Missing workspace files:\n${missingFiles.join('\n')}`);
  process.exit(1);
}

console.log('Workspace structure is complete.');
