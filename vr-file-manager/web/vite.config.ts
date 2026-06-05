import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    allowedHosts: ['nickel.home'],
    proxy: {
      '/api': 'http://localhost:3001',
      '/thumbs': 'http://localhost:3001',
    },
  },
});
