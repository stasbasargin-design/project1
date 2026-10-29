import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {prepareVideoRequest,VIDEO_CONTENT_TYPE} from './media-proxy.mjs';

const ONE_C_TARGET = 'https://1c.eazia.ru';
const ONE_C_SERVICE_PATH = '/aa6_ea_test9/ru/hs/max-service';

export default defineConfig({
  base: "./",
  plugins: [{
    name: 'itus-copy-runtime-files',
    configureServer(server) {
      server.middlewares.use(async(req,res,next)=>{
        if(!req.url?.startsWith('/api/1c/') || String(req.headers['content-type'] || '').split(';')[0]!==VIDEO_CONTENT_TYPE)return next();
        let upload;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20*60*1000);
        try{
          const route=req.url.split('?')[0].slice('/api/1c'.length);
          upload=await prepareVideoRequest(req,route,{signal:controller.signal});
          const headers={'Content-Type':'application/json; charset=utf-8','Content-Length':String(upload.byteLength),'x-itus-request-id':String(req.headers['x-itus-request-id'] || '')};
          if(process.env.ONE_C_TOKEN || req.headers['x-itus-token'])headers['X-ITUS-Token']=process.env.ONE_C_TOKEN || req.headers['x-itus-token'];
          const upstream=await fetch((process.env.ONE_C_TARGET || ONE_C_TARGET+ONE_C_SERVICE_PATH)+route,{method:'POST',headers,body:upload.body,duplex:'half',signal:controller.signal});
          res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type') || 'application/json','Cache-Control':'no-store'});res.end(Buffer.from(await upstream.arrayBuffer()));
        }catch(error){res.writeHead(error.status || 502,{'Content-Type':'application/json','Connection':'close'});res.end(JSON.stringify({success:false,error:{code:error.code || 'VIDEO_PROXY_ERROR',message:error.message}}));}
        finally{clearTimeout(timer);await upload?.cleanup();}
      });
    },
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
