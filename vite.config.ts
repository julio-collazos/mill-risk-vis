import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/terrascope-wms': {
        target: 'https://services.terrascope.be/wms/v2',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/terrascope-wms/, '')
      },
      '/gfw-tiles': {
        target: 'https://tiles.globalforestwatch.org',
        changeOrigin: true,
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/gfw-tiles/, '')
      },
    }
  }
})
