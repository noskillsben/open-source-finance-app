import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The source is on a Windows drive bind-mounted into a Linux container: inotify events don't cross that
// boundary, so the dev server polls. CHOKIDAR_USEPOLLING is also set in docker-compose.yml.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    watch: { usePolling: true, interval: 500 },
    proxy: {
      '/api': { target: process.env.VITE_BACKEND_URL || 'http://localhost:8000', changeOrigin: true },
      '/docs': { target: process.env.VITE_BACKEND_URL || 'http://localhost:8000', changeOrigin: true },
    },
  },
})
