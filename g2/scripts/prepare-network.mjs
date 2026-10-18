import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const approved = JSON.parse(await readFile(new URL('service-origin.json', root), 'utf8')).origin
export function exactOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('Provide the approved exact HTTPS origin.') }
  if (url.protocol !== 'https:' || url.origin !== value || url.pathname !== '/' ||
      url.username || url.password || url.search || url.hash || url.hostname.includes('*') || value !== approved) {
    throw new Error('Only the approved exact HTTPS service origin is allowed.')
  }
  return value
}
export async function prepareNetwork(value) {
  const origin = exactOrigin(value)
  const manifest = JSON.parse(await readFile(new URL('app.json', root), 'utf8'))
  const network = manifest.permissions.filter(permission => permission.name === 'network')
  if (network.length !== 1 || !Array.isArray(network[0].whitelist) || network[0].whitelist.length !== 0 ||
      manifest.min_app_version !== '2.2.10') throw new Error('Source manifest must have one empty network whitelist and min app 2.2.10.')
  network[0].whitelist = [origin]
  const output = fileURLToPath(new URL('app.network.json', root))
  await writeFile(output, JSON.stringify(manifest, null, 2) + '\n')
  return output
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(await prepareNetwork(process.argv[2])) }
  catch (error) { console.error(error instanceof Error ? error.message : 'Manifest validation failed.'); process.exitCode = 1 }
}
