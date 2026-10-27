/**
 * 设置弹窗中的功能分类。
 */
export type SettingsSection =
  | 'lark-cli'
  | 'meegle'
  | 'git'
  | 'ide'
  | 'repositories'
  | 'ai'
  | 'skills'
  | 'cleanup'
  | 'app-info'

/** 设置弹窗默认打开的第一个分类。 */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'lark-cli'
