import { app, ipcMain } from 'electron'
import { getPreferences, updatePreferences } from './preferences'
import type { AutoStartState } from '../types/auto-start'

/**
 * 开机自启。
 * 通过系统登录项注册，开关状态由操作系统维护；
 * 应用偏好只保留一个标记，用于“默认开启”仅执行一次。
 */
const isPlatformSupported = (): boolean =>
  process.platform === 'darwin' || process.platform === 'win32'

const getState = (): AutoStartState => {
  if (!isPlatformSupported()) {
    return {
      supported: false,
      enabled: false,
      reason: '当前系统不支持开机自启'
    }
  }

  // 开发模式下登录项指向 Electron 本体，打包安装后才有意义。
  if (!app.isPackaged) {
    return {
      supported: false,
      enabled: false,
      reason: '开发模式下不可用，安装打包版本后生效'
    }
  }

  try {
    return {
      supported: true,
      enabled: app.getLoginItemSettings().openAtLogin
    }
  } catch {
    return {
      supported: true,
      enabled: false,
      reason: '读取系统登录项失败，请重试'
    }
  }
}

/** 记录已完成初始化；偏好写入失败不影响系统登录项操作。 */
const markInitialized = (): void => {
  try {
    updatePreferences({ autoStartInitialized: true })
  } catch {
    // 写入失败时下次启动会再次尝试初始化，不阻塞当前操作。
  }
}

const setEnabled = (enabled: boolean): AutoStartState => {
  const state = getState()

  if (!state.supported) {
    throw new Error(state.reason ?? '当前环境不支持开机自启')
  }

  app.setLoginItemSettings({ openAtLogin: enabled })
  markInitialized()

  return getState()
}

/**
 * 首次安装后默认开启一次。
 * 之后完全以系统登录项状态为准，用户关闭后不会被重新打开。
 */
const applyDefaultEnabled = (): void => {
  if (!isPlatformSupported() || !app.isPackaged) return
  if (getPreferences().autoStartInitialized) return

  try {
    app.setLoginItemSettings({ openAtLogin: true })
  } catch {
    // 系统调用失败时保留标记为未初始化，下次启动再重试。
    return
  }

  markInitialized()
}

/** 注册开机自启 IPC。 */
export const initializeAutoStart = (): void => {
  applyDefaultEnabled()

  ipcMain.handle('auto-start:get', () => getState())
  ipcMain.handle('auto-start:set', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('参数错误')

    return setEnabled(enabled)
  })
}
