const { existsSync, readFileSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const releaseDir = join(root, 'release')

if (!existsSync(releaseDir)) process.exit(0)

const currentVersionMarker = `-${packageJson.version}-`
const intermediateDirectories = new Set([
  'mac',
  'mac-arm64',
  'mac-universal',
  'win-unpacked',
  'win-ia32-unpacked',
  'win-arm64-unpacked',
  'linux-unpacked',
  'linux-arm64-unpacked'
])

for (const entry of readdirSync(releaseDir)) {
  const target = join(releaseDir, entry)
  const isArtifact = entry.startsWith(`${packageJson.name}-`)
  const isOldArtifact = isArtifact && !entry.includes(currentVersionMarker)
  const isIntermediate = intermediateDirectories.has(entry)

  if (!isOldArtifact && !isIntermediate) continue

  rmSync(target, { recursive: true, force: true })
}
