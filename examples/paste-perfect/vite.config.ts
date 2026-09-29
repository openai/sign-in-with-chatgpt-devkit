import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { includeThirdPartyNotices } from '../../scripts/vite-notices.mjs';

export default defineConfig({
  plugins: [react(), includeThirdPartyNotices()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022' },
});
