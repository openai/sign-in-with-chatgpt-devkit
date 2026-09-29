import { build } from 'esbuild';

// Bundle the local SDK and its JavaScript dependencies into the signed archive.
// CommonJS dependencies still need Node's built-in require in this ESM bundle.
await build({ entryPoints: ['electron/main.ts'], bundle: true, platform: 'node', format: 'esm', external: ['electron'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  outfile: 'dist-electron/main.js' });
await build({ entryPoints: ['electron/preload.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  outfile: 'dist-electron/preload.cjs' });
