/**
 * 内置 IDE 预设标识。
 */
export type IdePresetId =
  | 'qoder'
  | 'vscode'
  | 'cursor'
  | 'trae'
  | 'webstorm'
  | 'intellij'
  | 'pycharm'
  | 'goland'
  | 'clion'
  | 'android-studio'
  | 'xcode'
  | 'sublime'
  | 'zed'
  | 'fleet'
  | 'visual-studio'

/**
 * IDE 预设定义。
 */
export interface IdePreset {
  /** 预设 ID。 */
  id: IdePresetId

  /** 显示名称。 */
  name: string

  /** 默认启动参数，{path} 替换为仓库路径。 */
  args: string[]
}

/**
 * 内置 IDE 预设。
 * 这里只定义展示和参数，具体命令由主进程按平台探测。
 */
export const IDE_PRESETS: IdePreset[] = [
  { id: 'qoder', name: 'Qoder', args: ['--add', '{path}'] },
  { id: 'vscode', name: 'Visual Studio Code', args: ['{path}', '--reuse-window'] },
  { id: 'cursor', name: 'Cursor', args: ['{path}', '--reuse-window'] },
  { id: 'trae', name: 'Trae', args: ['{path}', '--reuse-window'] },
  { id: 'webstorm', name: 'WebStorm', args: ['{path}'] },
  { id: 'intellij', name: 'IntelliJ IDEA', args: ['{path}'] },
  { id: 'pycharm', name: 'PyCharm', args: ['{path}'] },
  { id: 'goland', name: 'GoLand', args: ['{path}'] },
  { id: 'clion', name: 'CLion', args: ['{path}'] },
  { id: 'android-studio', name: 'Android Studio', args: ['{path}'] },
  { id: 'xcode', name: 'Xcode', args: ['{path}'] },
  { id: 'sublime', name: 'Sublime Text', args: ['{path}'] },
  { id: 'zed', name: 'Zed', args: ['{path}'] },
  { id: 'fleet', name: 'JetBrains Fleet', args: ['{path}'] },
  { id: 'visual-studio', name: 'Visual Studio', args: ['{path}'] }
]

/**
 * 外部 IDE 启动配置。
 */
export interface IdeConfig {
  /** 内置 IDE 预设。 */
  preset: IdePresetId

  /** 显示名称。 */
  name: string

  /** 可执行文件路径或 PATH 中的命令。 */
  command: string

  /** 启动参数，每行一个；{path} 会替换为仓库路径。 */
  args: string[]
}

/**
 * 判断是否为内置 IDE 预设。
 */
export const isIdePresetId = (value: unknown): value is IdePresetId =>
  IDE_PRESETS.some((preset) => preset.id === value)

/**
 * IDE 配置状态。
 */
export interface IdeConfigState {
  /** 已保存的配置。 */
  config: IdeConfig | null

  /** 命令当前是否可用。 */
  available: boolean
}
