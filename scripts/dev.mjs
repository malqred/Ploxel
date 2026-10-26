// Режим разработки: Vite-сервер + сборка main/preload + запуск Electron.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { context } from 'esbuild';
import electronPath from 'electron';

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const port = server.config.server.port;
server.printUrls();

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning'
};

let child = null;
const startElectron = () => {
  if (child) child.kill();
  child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, PLOXEL_DEV_SERVER: String(port) }
  });
  child.on('close', () => process.exit(0));
};

const restartPlugin = {
  name: 'restart',
  setup(b) {
    b.onEnd((r) => {
      if (r.errors.length === 0) startElectron();
    });
  }
};

const ctxs = await Promise.all([
  context({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist/main/main.js', plugins: [restartPlugin] }),
  context({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist/main/preload.js' })
]);
await Promise.all(ctxs.map((c) => c.watch()));