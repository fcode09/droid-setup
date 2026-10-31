import { readFile, writeFile, mkdir, mkdtemp, chmod, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const platform = process.platform === 'win32' ? 'windows' : process.platform;
if (!['linux', 'windows'].includes(platform) || process.arch !== 'x64') {
  throw new Error('This release supports Linux x64 and Windows x64 only.');
}
const manifest = JSON.parse(await readFile(join(root, 'scripts/adb-manifest.json'), 'utf8'))[
  platform
];
const destination = join(root, 'src-tauri/resources/adb');
const selected =
  platform === 'windows'
    ? [
        'adb.exe',
        'AdbWinApi.dll',
        'AdbWinUsbApi.dll',
        'libwinpthread-1.dll',
        'NOTICE.txt',
        'source.properties',
      ]
    : ['adb', 'lib64/libc++.so', 'NOTICE.txt', 'source.properties'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Reuse only verified files: a marker alone cannot authorize altered binaries.
try {
  const receipt = JSON.parse(await readFile(join(destination, 'receipt.json'), 'utf8'));
  if (
    receipt.archiveSha256 === manifest.sha256 &&
    receipt.platform === platform &&
    (
      await Promise.all(
        selected.map(
          async (name) => sha256(await readFile(join(destination, name))) === manifest.files[name],
        ),
      )
    ).every(Boolean)
  ) {
    console.log(`Verified bundled ADB for ${platform}.`);
    process.exit(0);
  }
} catch {
  /* Prepare an absent or invalid bundle from the pinned official archive. */
}
console.log(`Downloading pinned Android Platform-Tools for ${platform} from Google…`);
const response = await fetch(manifest.url, {
  redirect: 'error',
  signal: AbortSignal.timeout(120000),
});
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (sha256(bytes) !== manifest.sha256)
  throw new Error('Archive checksum mismatch. Refusing to package changed tools.');
const archive = unzipSync(bytes, {
  filter: (entry) => selected.includes(entry.name.replace(/^platform-tools\//, '')),
});
await mkdir(join(root, 'src-tauri/resources'), { recursive: true });
const stage = await mkdtemp(join(root, 'src-tauri/resources/adb-staging-'));
try {
  for (const name of selected) {
    const data = archive[`platform-tools/${name}`];
    if (!data || sha256(data) !== manifest.files[name])
      throw new Error(`Missing or altered archive entry: ${name}`);
    const target = join(stage, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, data);
  }
  if (platform === 'linux') await chmod(join(stage, 'adb'), 0o755);
  await writeFile(
    join(stage, 'receipt.json'),
    JSON.stringify({ platform, archiveSha256: manifest.sha256, source: manifest.url }, null, 2),
  );
  await rm(destination, { recursive: true, force: true });
  await rename(stage, destination);
  console.log(`Bundled ADB is ready. No system ADB was used.`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
