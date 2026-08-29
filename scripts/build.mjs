import { spawn } from 'node:child_process';
import { lstat, mkdtemp, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Publish only a complete build. Avoid recursive deletion of an active Windows
// output directory; old output is recoverable in an ignored project-local backup directory.
export async function publishBuild(frontendRoot, compile) {
  const root = await realpath(frontendRoot);
  const target = path.join(root, 'dist');
  const staging = await mkdtemp(path.join(root, '.tmp-build-'));
  await compile(staging);
  const index = await lstat(path.join(staging, 'index.html'));
  if (!index.isFile() || index.isSymbolicLink()) throw Error('构建缺少有效 index.html');
  let previous = null;
  try {
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('dist 必须是项目内的普通文件夹');
    if (await realpath(target) !== target) throw Error('拒绝移动项目外的 dist');
    // Keep the backup on the same drive for reliable, non-copying directory rename.
    previous = await mkdtemp(path.join(root, '.tmp-build-previous-'));
    await rename(target, path.join(previous, 'dist'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await rename(staging, target);
  } catch (error) {
    if (previous) await rename(path.join(previous, 'dist'), target);
    throw error;
  }
  return previous;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../frontend/', import.meta.url));
  publishBuild(root, staging => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', staging, '--emptyOutDir=false'], {
      cwd: root, stdio: 'inherit', windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 && !signal ? resolve() : reject(Error(`Vite 构建失败（${signal || code}）`)));
  })).then(backup => {
    if (backup) console.log(`已保留上一版构建：${path.basename(backup)}（忽略 Git，可在停止服务后手工清理）`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
