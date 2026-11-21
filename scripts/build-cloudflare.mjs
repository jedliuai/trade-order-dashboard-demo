import { cp, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const frontend = new URL('../frontend/', import.meta.url);
const output = new URL('../.wrangler/trial-ui/', import.meta.url);
const cwd = fileURLToPath(frontend);
const env = { ...process.env, VITE_CLOUD_TRIAL: 'true', VITE_PUBLIC_DEMO: 'false' };
const options = { cwd, env, stdio: 'inherit', windowsHide: true };
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b'], options);
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', fileURLToPath(output), '--emptyOutDir'], options);
// Only publish these known assets alongside Vite's compiled application.
await mkdir(new URL('brand/', output), { recursive: true });
for (const file of ['icons.svg', 'favicon.svg', 'brand/trade-tracker-app-icon.svg', 'brand/trade-tracker-mark.svg']) {
  await cp(new URL('public/' + file, frontend), new URL(file, output));
}
