import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const root = fileURLToPath(new URL('../', import.meta.url));
const windows = process.platform === 'win32';
const venvPython = path.join(root, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
    ...options
  });
  if (result.error) {
    console.error(`无法启动 ${path.basename(command)}: ${result.error.message}`);
    process.exit(result.status ?? 1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const asOf = shanghaiToday();
const python = existsSync(venvPython) ? venvPython : (windows ? 'python' : 'python3');
const output = path.join(root, 'frontend', 'public', '.cloudflare-demo');

run(python, [
  path.join(root, 'scripts', 'build_public_demo.py'),
  '--output', output,
  '--as-of', asOf
]);

const buildEnvironment = {
  ...process.env,
  VITE_PUBLIC_DEMO: 'true',
  VITE_PUBLIC_DEMO_AS_OF_DATE: asOf
};
const npmArguments = ['--prefix', 'frontend', 'run', 'build'];
if (process.env.npm_execpath) {
  run(process.execPath, [process.env.npm_execpath, ...npmArguments], { env: buildEnvironment });
} else {
  run(windows ? 'npm.cmd' : 'npm', npmArguments, { env: buildEnvironment });
}

console.log(`Cloudflare 演示构建完成，截止日期：${asOf}`);
