import { ipcMain } from 'electron'
import { getPreferences, updatePreferences } from './preferences'
import type { ProductGuideState } from '../types/product-guide'

/** 当前内置产品手册版本；内容有明显更新时递增。 */
const PRODUCT_GUIDE_VERSION = 5

/**
 * 注册产品手册状态 IPC。
 * 使用 preferences.json 保存已读版本，避免依赖渲染进程的 localStorage。
 */
export const initializeProductGuide = (): void => {
  ipcMain.handle('product-guide:get-state', (): ProductGuideState => ({
    currentVersion: PRODUCT_GUIDE_VERSION,
    seenVersion: getPreferences().productGuideSeenVersion ?? 0
  }))

  ipcMain.handle('product-guide:mark-seen', () => {
    updatePreferences({ productGuideSeenVersion: PRODUCT_GUIDE_VERSION })
  })
}
