import type { CaptureEndpoints } from '../../mobile/src/capture.ts'
import serviceOrigin from '../service-origin.json' with { type: 'json' }

export const CURRENT_SERVICE_ORIGIN: string = serviceOrigin.origin

// The exact package origin comes from the pack script. Missing configuration
// keeps local Demo usable; a production package always supplies this value.
export function serviceForOrigin(value: string | undefined): { origin: string; endpoints: CaptureEndpoints } | null {
  if (!value) return null
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Invalid packaged service origin.') }
  if (url.protocol !== 'https:' || url.origin !== value || url.pathname !== '/' ||
      url.username || url.password || url.search || url.hash || url.hostname.includes('*') ||
      value !== CURRENT_SERVICE_ORIGIN) throw new Error('G2 service origin is not the approved exact HTTPS origin.')
  return { origin: value, endpoints: { upload: `${value}/api/recordings`,
    analysis: `${value}/api/analyze`, coaching: `${value}/api/coach` } }
}
