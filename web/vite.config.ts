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
  // forwards the original Host (books.doogster.com); Vite blocks unknown hosts
  // by default (DNS-rebinding protection), so allow the deployment host.
  preview: {
    host: true,
    port: 5173,
    allowedHosts: ['books.doogster.com'],
  },
});
