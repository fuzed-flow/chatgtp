import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/', // <--- THIS IS THE MAGIC LINE
  plugins: [
    react(),
     // THE FIX: This forces Cloud Shell to send .jsx files as Javascript
    {
      name: 'cloud-shell-mime-fix',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url.includes('.jsx')) {
            res.setHeader('Content-Type', 'application/javascript');
          }
          next();
        });
      }
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000, 
    strictPort: true,
    hmr: {
      clientPort: 443,
    }
  }
});