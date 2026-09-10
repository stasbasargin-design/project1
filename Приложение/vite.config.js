import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ONE_C_TARGET = 'https://1c.eazia.ru';
const ONE_C_SERVICE_PATH = '/aa6_ea_test9/ru/hs/max-service';

export default defineConfig({
  base: "./",
  plugins: [{
    name: 'itus-copy-runtime-files',
    closeBundle() {
      const out = resolve('dist');
      mkdirSync(resolve(out, 'config'), { recursive: true });
      mkdirSync(resolve(out, 'assets'), { recursive: true });
      cpSync(resolve('config', 'itus.config.js'), resolve(out, 'config', 'itus.config.js'));
      cpSync(resolve('assets'), resolve(out, 'assets'), { recursive: true });
    }
  }],
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: true,
    proxy: {
      '/api/1c': {
        target: ONE_C_TARGET,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => `${ONE_C_SERVICE_PATH}${path.replace(/^\/api\/1c/, '')}`,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const targetPath = `${ONE_C_SERVICE_PATH}${req.url.replace(/^\/api\/1c/, '')}`;
            console.log(`[ИТУС → 1С] ${req.method} ${req.url} → ${ONE_C_TARGET}${targetPath}`);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log(`[1С → ИТУС] ${proxyRes.statusCode} ${req.method} ${req.url}`);
          });
          proxy.on('error', (error, req) => {
            console.error(`[Ошибка proxy 1С] ${req.method} ${req.url}: ${error.message}`);
          });
        }
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
