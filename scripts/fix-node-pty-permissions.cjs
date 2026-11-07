/**
 * 确保 node-pty 的 spawn-helper 具有可执行权限。
 * npm 安装的预编译文件可能丢失可执行位，导致 posix_spawnp failed。
 */
const { chmodSync, existsSync } = require('node:fs')
const { join } = require('node:path')

if (process.platform === 'win32') process.exit(0)

const root = join(__dirname, '..', 'node_modules', 'node-pty')
const candidates = [
  join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
  join(root, 'build', 'Release', 'spawn-helper'),
  join(root, 'build', 'Debug', 'spawn-helper')
]

for (const file of candidates) {
  if (!existsSync(file)) continue

  try {
    chmodSync(file, 0o755)
  } catch (error) {
    console.warn(`无法设置 ${file} 的执行权限：${error.message}`)
  }
}
