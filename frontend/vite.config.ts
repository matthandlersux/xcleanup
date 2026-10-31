import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3002,
    strictPort: true,
    // allow requests forwarded by `tailscale serve` (nickel.<tailnet>.ts.net)
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
});
