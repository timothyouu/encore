import type { Glasses } from './glasses'
import type { Take } from './recorder'
import { status } from './status'

const URL_KEY = 'encore.uploadUrl'
const UPLOAD_TIMEOUT_MS = 30000

// Dev servers may preset a URL (e.g. `VITE_ENCORE_UPLOAD_URL=… npm run dev`)
// so the simulator can upload without typing; a saved value always wins.
const DEV_DEFAULT_URL: string = import.meta.env.DEV ? (import.meta.env.VITE_ENCORE_UPLOAD_URL ?? '') : ''

export async function loadUploadUrl(glasses: Glasses): Promise<string> {
  try {
    return (await glasses.readStorage(URL_KEY)) || DEV_DEFAULT_URL
  } catch {
    return DEV_DEFAULT_URL
  }
}

export function saveUploadUrl(glasses: Glasses, url: string) {
  return glasses.writeStorage(URL_KEY, url)
}

export function isValidUploadUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

// `reason` is a short, plain sentence for the glasses; details go to the phone log.
export type UploadResult = { ok: true } | { ok: false; reason: string }

function failed(reason: string, detail: string): UploadResult {
  status(`upload failed: ${detail}`, 'error')
  return { ok: false, reason }
}

// POSTs one take as multipart: `audio` (WAV) plus `metadata` (JSON), matching
// the analysis contract's "multipart audio + attempt metadata" (spec §8).
// The API service is expected to make the recording available to mobile/.
export async function uploadTake(url: string, take: Take): Promise<UploadResult> {
  if (!isValidUploadUrl(url)) return failed('No upload URL is set on the phone.', 'no upload URL set')

  const { wav, ...rest } = take
  const metadata = {
    ...rest,
    captureSource: 'g2',
    encoding: `pcm_s${take.format.bitsPerSample}le`,
    sampleRate: take.format.sampleRate,
    channels: take.format.channels,
  }
  const form = new FormData()
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), `${take.attemptId}.wav`)
  form.append('metadata', JSON.stringify(metadata))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(url, { method: 'POST', body: form, signal: controller.signal })
    if (!response.ok) return failed(`The server answered ${response.status}.`, `HTTP ${response.status} from ${url}`)
    status(`uploaded ${take.attemptId} (${Math.round(wav.length / 1024)} KB)`)
    return { ok: true }
  } catch (error) {
    // CORS rejections and an unreachable host both surface here as network errors.
    if (controller.signal.aborted) return failed('The upload timed out.', `timed out after ${UPLOAD_TIMEOUT_MS / 1000}s`)
    return failed("Can't reach the server.", `${String(error)} (unreachable host or missing CORS headers) at ${url}`)
  } finally {
    clearTimeout(timer)
  }
}
