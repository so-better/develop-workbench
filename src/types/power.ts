/** 当前应用支持的电源管理平台。 */
export type PowerPlatform = 'darwin' | 'win32' | 'unsupported'

/** 可切换的电源能力。 */
export type PowerSettingKey = 'runtime' | 'lid' | 'lock'

/** 电源设置状态。 */
export interface PowerSettingsState {
  /** 当前平台。 */
  platform: PowerPlatform

  /** 平台展示名称。 */
  platformLabel: string

  /** 是否支持修改系统电源策略。 */
  supportsSystemSettings: boolean

  /** 当前设备是否支持合盖电源策略。 */
  lidSupported: boolean

  /** 应用运行期间是否保持系统唤醒。 */
  runtimeKeepAwake: boolean

  /** 合盖后是否禁止系统睡眠。 */
  lidSleepDisabled: boolean

  /** 锁屏后是否禁止系统睡眠。 */
  lockScreenSleepDisabled: boolean
}
