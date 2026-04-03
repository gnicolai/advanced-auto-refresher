import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(repoRoot, 'i18n');
const targetRoot = path.join(repoRoot, '_locales');

async function syncLocales() {
  const localeDirs = await readdir(sourceRoot, { withFileTypes: true });

  for (const entry of localeDirs) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourceFile = path.join(sourceRoot, entry.name, 'messages.json');
    const targetDir = path.join(targetRoot, entry.name);
    const targetFile = path.join(targetDir, 'messages.json');

    const raw = await readFile(sourceFile, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = `${JSON.stringify(parsed, null, 2)}\n`;

    await writeFile(sourceFile, normalized, 'utf8');
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetFile, normalized, 'utf8');
  }
}

syncLocales()
  .then(() => {
    console.log('Synced locale files from i18n to _locales using UTF-8.');
  })
  .catch((error) => {
    console.error('Locale sync failed:', error);
    process.exitCode = 1;
  });
