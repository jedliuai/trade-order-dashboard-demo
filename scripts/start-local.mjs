import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = 'http://127.0.0.1:8765/';
const python = path.join(root, '.venv', 'Scripts', 'python.exe');

export function findEdge(env = process.env, exists = existsSync) {
  return [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA]
    .filter(Boolean).map(base => path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    .find(exists);
}

export function newestSource(folder) {
  if (!existsSync(folder)) return 0;
  return readdirSync(folder, { withFileTypes: true }).reduce((latest, item) => {
    const full = path.join(folder, item.name);
    return Math.max(latest, item.isDirectory() ? newestSource(full) : statSync(full).mtimeMs);
  }, 0);
}

function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 && !signal ? resolve() : reject(Error(`Command failed (${signal || code}).`)));
  });
}

async function health() {
  try {
    const response = await fetch(new URL('api/health', url), { signal: AbortSignal.timeout(1000) });
    const body = await response.json();
    if (body.app !== 'trade-order-dashboard-demo' || body.mode !== 'local' || !response.ok) {
      throw Error('Port 8765 is in use by another or older service. Close that service and try again.');
    }
    return true;
  } catch (error) {
    if (error.message?.startsWith('Port 8765')) throw error;
    if (error.name === 'SyntaxError') throw Error('Port 8765 is in use by another service.');
    return false;
  }
}

export async function main() {
  if (process.platform !== 'win32') throw Error('Use npm start on this platform. This launcher opens Microsoft Edge on Windows.');
  const edge = findEdge();
  if (!edge) throw Error('Microsoft Edge was not found. Install Edge and try again.');
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(npmCli)) throw Error('npm was not found next to Node.js. Repair your Node.js installation.');
  if (!existsSync(python) || !existsSync(path.join(root, 'frontend/node_modules/vite'))) {
    console.log('Preparing the local demo (first launch needs internet for dependencies)...');
    await run(process.execPath, [npmCli, 'run', 'setup']);
  }
  const index = path.join(root, 'frontend/dist/index.html');
  const sourceTime = Math.max(newestSource(path.join(root, 'frontend/src')),
    newestSource(path.join(root, 'frontend/public')), statSync(path.join(root, 'frontend/package.json')).mtimeMs);
  // A public build must never turn this local launcher into a read-only preview.
  let localBuild = false;
  try { localBuild = JSON.parse(readFileSync(path.join(root, 'frontend/dist/build-mode.json'), 'utf8')).mode === 'local'; } catch { /* Rebuild outputs created before the launcher. */ }
  const needsBuild = !existsSync(index) || sourceTime > statSync(index).mtimeMs || !localBuild;
  if (needsBuild) {
    console.log('Building the latest local interface...');
    await run(process.execPath, [npmCli, 'run', 'build'], { env: { ...process.env, VITE_PUBLIC_DEMO: 'false' } });
  }
  const open = async () => {
    const browser = spawn(edge, [url], { detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { browser.once('spawn', resolve); browser.once('error', reject); });
    browser.unref();
  };
  if (await health()) {
    await open();
    console.log(`Local demo is already running: ${url}`);
    return;
  }
  console.log(`Starting local SQLite demo: ${url}`);
  console.log('Keep this window open. Press Ctrl+C or close it to stop the service.');
  const server = spawn(python, ['-m', 'local_api.server'], { cwd: root, stdio: 'inherit', windowsHide: true });
  let exited = false;
  let stopping = false;
  const done = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('exit', (code, signal) => { exited = true; code === 0 || signal === 'SIGINT' || stopping ? resolve() : reject(Error(`Local server exited (${signal || code}).`)); });
  });
  // Attach immediately so a startup error is never an unhandled rejection.
  done.catch(() => {});
  const stop = () => { stopping = true; if (!exited) server.kill('SIGINT'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !exited; attempt++) {
      if (await health()) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw Error('Local server did not become ready. Check the messages above.');
    await open();
    await done;
  } finally {
    stop();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
