import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('android-helper/manifest.json', root), 'utf8'));
for (const [path, expected] of Object.entries(manifest.files)) {
  const actual = createHash('sha256')
    .update(await readFile(new URL(path, root)))
    .digest('hex');
  if (actual !== expected)
    throw new Error(
      `UI reader source/artifact mismatch: ${path}. Rebuild the reviewed helper before packaging.`,
    );
}
console.log('Verified temporary Android UI reader source and DEX.');
