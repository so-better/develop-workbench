/**
 * 为外部 CLI 子进程补全 PATH。
 * 打包应用从 Finder/Dock 启动时通常没有 nvm、Homebrew 等终端 PATH。
 */
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { getPreferences } from './preferences'

export const getCliEnvironment = (
  executablePath?: string
): NodeJS.ProcessEnv => {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  const currentPath = process.env[pathKey] ?? ''
  const extraPaths = [
    ...(executablePath ? [dirname(executablePath)] : []),
    join(homedir(), '.local/bin'),
    join(homedir(), '.local/node/bin'),
    join(homedir(), '.volta/bin'),
    join(homedir(), '.asdf/shims'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ]
  const nvmRoot = join(homedir(), '.nvm/versions/node')

  try {
    for (const version of readdirSync(nvmRoot)) {
      extraPaths.push(join(nvmRoot, version, 'bin'))
    }
  } catch {
    // 未安装 nvm 时忽略。
  }

  const preferences = getPreferences()

  for (const cliPath of [preferences.larkCliPath, preferences.meegleCliPath]) {
    if (cliPath) extraPaths.push(dirname(cliPath))
  }

  return {
    ...process.env,
    [pathKey]: [currentPath, ...extraPaths].filter(Boolean).join(delimiter)
  }
}
