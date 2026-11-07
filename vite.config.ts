import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import branding from './branding.json';

const manifest = JSON.stringify({ name: branding.name, short_name: branding.shortName, description: branding.description, lang: 'en', start_url: '/', scope: '/', display: 'standalone', background_color: '#1e1e1e', theme_color: branding.themeColor, icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] });
function brandPlugin(): Plugin {
  const escape = (text: string) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return {
    name: 'application-brand',
    transformIndexHtml(html) { return html.replaceAll('__APP_NAME__', escape(branding.name)).replaceAll('__APP_DESCRIPTION__', escape(branding.description)).replaceAll('__APP_THEME__', escape(branding.themeColor)); },
    configureServer(server) { server.middlewares.use((request, response, next) => { if (request.url?.split('?')[0] !== '/manifest.webmanifest') return next(); response.setHeader('Content-Type', 'application/manifest+json'); response.end(manifest); }); },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest }); },
  };
}

export default defineConfig({
  plugins: [brandPlugin(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/codemirror/') || id.includes('/node_modules/@codemirror/')) return 'editor';
          if (id.includes('/node_modules/lucide-react/')) return 'icons';
          if (id.includes('/node_modules/marked/') || id.includes('/node_modules/dompurify/')) return 'markdown';
        },
      },
    },
  },
  server: {
    watch: { ignored: ['**/.local/**', '**/data/**', '**/LAB/RUN/**'] },
    proxy: {
      '/api': 'http://127.0.0.1:4317',
    },
  },
});
