import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const windows = process.platform === 'win32';
const venvPython = path.join(root, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');
const python = () => existsSync(venvPython) ? venvPython : (windows ? 'python' : 'python3');
const children = new Set();
let stopping = false;

function launch(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.on('error', error => {
    console.error(`无法启动 ${path.basename(command)}: ${error.message}`);
    stop(1);
  });
  return child;
}

async function run(command, args) {
  const child = launch(command, args);
  const code = await new Promise(resolve => child.once('exit', (code, signal) => resolve(signal ? 1 : code)));
  if (code !== 0) throw new Error(`命令未通过，退出码 ${code}`);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (windows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

async function main() {
  const mode = process.argv[2];
  if (mode === 'setup') {
    if (!existsSync(venvPython)) await run(python(), ['-m', 'venv', '.venv']);
    await run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt']);
    const npmPath = process.env.npm_execpath;
    if (!npmPath) throw new Error('请通过 npm run setup 调用');
    await run(process.execPath, [npmPath, 'ci', '--prefix', 'frontend']);
    console.log('安装完成。运行 npm run dev；正式本机预览使用 npm run build 后 npm start。');
    return;
  }
  if (mode === 'test') {
    await run(python(), ['-m', 'unittest', 'discover', '-s', 'local_api/tests', '-p', 'test_*.py']);
    return;
  }
  if (!['dev', 'start'].includes(mode)) throw new Error('支持 setup / dev / start / test');
  if (mode === 'start' && !existsSync(path.join(root, 'frontend/dist/index.html'))) {
    throw new Error('请先运行 npm run build');
  }
  const api = launch(python(), ['-m', 'local_api.server']);
  api.once('exit', code => { if (!stopping) stop(code || 1); });
  if (mode === 'dev') {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:8765/api/health', { signal: AbortSignal.timeout(1000) });
        ready = response.ok && (await response.json()).status === 'ok';
      } catch { /* Wait for seed initialization; do not launch the UI early. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (stopping) return;
    if (!ready) throw new Error('本地 API 未能启动，请检查上方错误和 8765 端口');
    const vite = launch(process.execPath, [path.join(root, 'frontend/node_modules/vite/bin/vite.js')], { cwd: path.join(root, 'frontend') });
    vite.once('exit', code => { if (!stopping) stop(code || 1); });
  }
}

main().catch(error => {
  console.error(error.message);
  stop(1);
});
