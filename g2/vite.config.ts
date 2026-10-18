import { defineConfig } from 'vite'

// The simulator stays on loopback; the existing HTTPS preview uses its
// separately authenticated device backend and exact WebView Origin.
function apiProxy(port: number) {
  const target = `http://127.0.0.1:${port}`
  return { '/api': target, '/v1': target, '/health': target }
}

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: apiProxy(8788) },
  preview: { host: '127.0.0.1', allowedHosts: ['timothylggram.tail51e140.ts.net'], proxy: apiProxy(8799) },
  build: { target: 'esnext' },
})
