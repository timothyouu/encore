// Startup and error trail shown on the phone, since the WebView console is not
// visible during on-glasses testing. Also mirrored to console for the simulator.
const MAX_LINES = 30

const lines: string[] = []

export function status(message: string, level: 'info' | 'error' = 'info') {
  const time = new Date().toLocaleTimeString([], { hour12: false })
  lines.push(`${time}  ${level === 'error' ? '✖ ' : ''}${message}`)
  if (lines.length > MAX_LINES) lines.shift()
  ;(level === 'error' ? console.error : console.log)(`[encore] ${message}`)

  // Absent outside a browser (unit tests).
  const app = typeof document === 'undefined' ? null : document.getElementById('app')
  if (app) app.textContent = lines.join('\n')
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', event => status(`uncaught: ${event.message}`, 'error'))
  window.addEventListener('unhandledrejection', event => status(`unhandled: ${String(event.reason)}`, 'error'))
}
