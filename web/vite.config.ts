import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // Production static server (`npm run preview`). It sits behind Caddy, which
  // forwards the original Host; Vite blocks unknown hosts by default
  // (DNS-rebinding protection), so every hostname the tunnel serves must be
  // listed here or the browser gets a blank 403 from Vite rather than the app.
  preview: {
    host: true,
    port: 5173,
    allowedHosts: ['books.nebulys.net', 'books.doogster.com'],
  },
});
