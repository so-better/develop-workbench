/**
 * macOS 未配置 Developer ID 时，为整个 .app 做 ad-hoc 签名。
 * Electron 主程序只有 linker ad-hoc 签名，Gatekeeper 会把它判定为“已损坏”。
 */
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { join } = require('node:path')

const execFileAsync = promisify(execFile)

module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  await execFileAsync(
    'codesign',
    ['--force', '--deep', '--sign', '-', appPath],
    { maxBuffer: 1024 * 1024 * 8 }
  )
  await execFileAsync('codesign', ['--verify', '--deep', '--strict', appPath], {
    maxBuffer: 1024 * 1024
  })
  console.log(`ad-hoc signed: ${appPath}`)
}
