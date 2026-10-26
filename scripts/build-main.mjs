import { build } from 'esbuild';
import { rmSync } from 'node:fs';

const outdir = 'dist/main';
if (process.argv.includes('--clean')) rmSync(outdir, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' }
};

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: `${outdir}/main.js` });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: `${outdir}/preload.js` });
console.log('[build-main] готово');