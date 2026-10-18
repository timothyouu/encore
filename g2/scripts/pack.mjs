import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { prepareNetwork } from './prepare-network.mjs'

const root = new URL('../', import.meta.url)
const origin = process.argv[2]
function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: fileURLToPath(root), stdio: 'inherit', env })
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? 'signal'}).`)
}
try {
  await prepareNetwork(origin)
  const binary = fileURLToPath(new URL('node_modules/.bin/evenhub', root))
  if (!existsSync(binary)) throw new Error('Local Even Hub CLI missing; no package will be installed automatically.')
  const revision = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: fileURLToPath(root), encoding: 'utf8' })
  if (revision.status !== 0) throw new Error('Cannot determine source revision for package identity.')
  const buildId = `${revision.stdout.trim()}-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`
  const env = { ...process.env, VITE_ENCORE_API_ORIGIN: origin, VITE_ENCORE_BUILD_ID: buildId }
  run('npm', ['run', 'build'], env)
  run(binary, ['pack', 'app.network.json', 'dist'], env)
  const packageBytes = await readFile(new URL('out.ehpk', root))
  const sha256 = createHash('sha256').update(packageBytes).digest('hex')
  const sidecar = { buildId, sourceRevision: revision.stdout.trim(), serviceOrigin: origin,
    packageFile: 'out.ehpk', bytes: packageBytes.length, sha256 }
  await writeFile(new URL('package-build.json', root), JSON.stringify(sidecar, null, 2) + '\n')
  console.log(`G2 package ${buildId}: ${packageBytes.length} bytes SHA-256 ${sha256}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Packaging failed.')
  process.exitCode = 1
}
