import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const path = value => fileURLToPath(new URL(value, import.meta.url));
export default defineConfig({
  root: path('./'), base: '/sms-preview/', plugins: [react()],
  resolve: { alias: [
    { find: '@/api/supabaseClient', replacement: path('./mockDb.js') },
    { find: '@/lib/AuthContext', replacement: path('./mockAuth.js') },
    { find: '@', replacement: path('../../../src') },
  ] },
  css: { postcss: path('../../../') },
  build: { outDir: path('../../../dist/sms-preview'), emptyOutDir: true },
});
