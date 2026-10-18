export type PcmFormat = {
  sampleRate: number
  channels: number
  bitsPerSample: number
}

// Wraps raw PCM chunks in a canonical 44-byte RIFF/WAVE header. The samples
// are copied untouched: the header must describe the format the glasses
// actually sent, never a relabelled one (spec §5).
export function pcmToWav(chunks: Uint8Array[], format: PcmFormat): Uint8Array<ArrayBuffer> {
  const dataBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const blockAlign = (format.channels * format.bitsPerSample) / 8
  const wav = new Uint8Array(44 + dataBytes)
  const view = new DataView(wav.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i)
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, format.channels, true)
  view.setUint32(24, format.sampleRate, true)
  view.setUint32(28, format.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, format.bitsPerSample, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (const chunk of chunks) {
    wav.set(chunk, offset)
    offset += chunk.length
  }
  return wav
}
