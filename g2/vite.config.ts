import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: true, port: 5173 },
  preview: { allowedHosts: ['timothylggram.tail51e140.ts.net'] },
  build: { target: 'esnext' },
})
