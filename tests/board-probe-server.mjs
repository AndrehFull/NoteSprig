import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Separate test entry: no debug APIs or probe route are included in the production bundle.
const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 4316, strictPort: true, headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:4316; worker-src 'self' blob:; frame-src 'none'" }, proxy: { '/api': { target: 'http://127.0.0.1:4318', changeOrigin: true, configure(proxy) { proxy.on('proxyReq', (request) => request.setHeader('Origin', 'http://127.0.0.1:4318')); } } } } });
await server.listen();
console.log('Board probe ready');
const close = async () => { await server.close(); process.exit(0); };
process.once('SIGINT', close); process.once('SIGTERM', close);
