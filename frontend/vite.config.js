import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { searchForWorkspaceRoot } from 'vite'

// The source is on a Windows drive bind-mounted into a Linux container: inotify events don't cross that
// boundary, so the dev server polls. CHOKIDAR_USEPOLLING is also set in docker-compose.yml.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Help imports ../../docs/user/README.md, which sits outside the frontend root (/docs/user in the container).
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../docs/user'] },
    watch: { usePolling: true, interval: 500 },
    proxy: {
      '/api': { target: process.env.VITE_BACKEND_URL || 'http://localhost:8000', changeOrigin: true },
      '/docs': { target: process.env.VITE_BACKEND_URL || 'http://localhost:8000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.js'],
  },
})
