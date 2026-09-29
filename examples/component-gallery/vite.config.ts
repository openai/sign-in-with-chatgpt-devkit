import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { includeThirdPartyNotices } from '../../scripts/vite-notices.mjs';

export default defineConfig(({ command }) => ({
  plugins: [react(), includeThirdPartyNotices()],
  base: './',
  publicDir: command === 'serve' ? 'public' : false,
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: { target: 'es2022' },
}));
