/**
 * 为外部 CLI 子进程补全 PATH。
 * 打包应用从 Finder/Dock 启动时通常没有 nvm、Homebrew 等终端 PATH。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { getPreferences } from './preferences'

let cachedSshAuthSock: string | null | undefined

/** Finder 启动的应用可能没有终端里的 SSH agent 环境。 */
const getSshAuthSock = (): string | null => {
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK
  if (cachedSshAuthSock !== undefined) return cachedSshAuthSock
  if (process.platform !== 'darwin') {
    cachedSshAuthSock = null
    return null
  }

  try {
    const value = execFileSync('/bin/launchctl', ['getenv', 'SSH_AUTH_SOCK'], {
      encoding: 'utf8',
      timeout: 1_000
    }).trim()

    cachedSshAuthSock = value || null
  } catch {
    cachedSshAuthSock = null
  }

  return cachedSshAuthSock
}

export const getCliEnvironment = (
  executablePath?: string
): NodeJS.ProcessEnv => {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  const currentPath = process.env[pathKey] ?? ''
  const executableDirectory =
    executablePath && isAbsolute(executablePath)
      ? dirname(executablePath)
      : undefined
  const extraPaths = [
    join(homedir(), '.local/bin'),
    join(homedir(), '.local/node/bin'),
    join(homedir(), '.volta/bin'),
    join(homedir(), '.asdf/shims'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ]
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    const localAppData = process.env.LOCALAPPDATA

    if (appData) extraPaths.push(join(appData, 'npm'))
    if (localAppData) extraPaths.push(join(localAppData, 'Programs'))
  }

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

  const sshAuthSock = getSshAuthSock()

  return {
    ...process.env,
    ...(sshAuthSock ? { SSH_AUTH_SOCK: sshAuthSock } : {}),
    [pathKey]: [executableDirectory, currentPath, ...extraPaths]
      .filter(Boolean)
      .join(delimiter)
  }
}

const quoteWindowsArgument = (value: string): string =>
  /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/**
 * 将 npm 在 Windows 上生成的 .cmd/.bat 包装脚本转换为 cmd.exe 调用。
 */
export const getCliInvocation = (
  command: string,
  args: string[]
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } => {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args }
  }

  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      `"${[command, ...args].map(quoteWindowsArgument).join(' ')}"`
    ],
    windowsVerbatimArguments: true
  }
}
