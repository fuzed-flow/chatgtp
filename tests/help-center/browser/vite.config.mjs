import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const path = value => fileURLToPath(new URL(value, import.meta.url));
export default defineConfig({
  root: path('./'), plugins: [react()],
  resolve: { alias: [
    { find: '@/api/supabaseClient', replacement: path('./mockDb.js') },
    { find: '@/lib/AuthContext', replacement: path('./mockAuth.jsx') },
    { find: '@', replacement: path('../../../src') },
  ] },
  build: { rollupOptions: { input: { index: path('./index.html'), widget: path('./widget.html') } } },
  css: { postcss: path('../../../') },
});
