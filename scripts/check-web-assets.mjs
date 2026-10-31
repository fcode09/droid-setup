import { readFile } from 'node:fs/promises';
const index = await readFile(
  new URL('../dist/droid-setup/browser/index.html', import.meta.url),
  'utf8',
);
// Tauri gives static inline styles a CSP nonce. That would disable unsafe-inline
// for Angular's runtime-inserted component styles, leaving the packaged UI unstyled.
if (/<style\b/i.test(index)) {
  throw new Error(
    'Inline production CSS breaks Tauri component styling. Keep optimization.styles.inlineCritical=false.',
  );
}
if (!/rel=["']stylesheet["']/i.test(index))
  throw new Error('Production stylesheet link is missing.');
console.log('Production CSS is compatible with the Tauri asset CSP.');
