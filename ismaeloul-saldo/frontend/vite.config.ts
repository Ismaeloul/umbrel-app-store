import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // El backend sirve dist/ tal cual: assets bajo /assets y el resto al index.
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
    // En desarrollo el frontend habla con el backend por el mismo camino
    // relativo /api que en produccion. Nunca hay un host escrito a mano.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
