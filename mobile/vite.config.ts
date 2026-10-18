import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: '127.0.0.1', port: 5176, proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true,
    rewrite: path => path.replace(/^\/api/, '/v1') } } },
  build: { target: 'esnext', rollupOptions: { input: ['index.html', 'visualizations.html'] } },
})
