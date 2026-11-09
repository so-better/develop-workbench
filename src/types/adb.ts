/**
 * ADB 工具类型。
 */

/** ADB 路径来源。 */
export type AdbPathSource = 'settings' | 'environment' | 'auto'

/** ADB 可执行文件状态。 */
export interface AdbInfo {
  /** 当前使用的 ADB 路径。 */
  path: string | null

  /** 路径来源。 */
  source: AdbPathSource | null

  /** adb version 解析出的版本号。 */
  version: string | null

  /** 当前路径是否可用。 */
  available: boolean
}

/** ADB 设备连接状态。 */
export type AdbDeviceState =
  | 'device'
  | 'offline'
  | 'unauthorized'
  | 'no permissions'
  | 'unknown'

/** 一台 ADB 设备。 */
export interface AdbDevice {
  /** 设备序列号。 */
  serial: string

  /** 连接状态。 */
  state: AdbDeviceState

  /** 原始状态文本。 */
  stateLabel: string

  /** 设备型号。 */
  model: string | null

  /** 产品名。 */
  product: string | null

  /** device 字段。 */
  device: string | null

  /** ADB transport ID。 */
  transportId: string | null

  /** 是否为模拟器。 */
  emulator: boolean

  /** 页面展示名称。 */
  label: string
}

/** 一条 ADB 执行结果。 */
export interface AdbCommandResult {
  /** 实际执行的命令文本，用于输出面板。 */
  command: string

  /** 标准输出。 */
  stdout: string

  /** 标准错误。 */
  stderr: string
}

/** 应用基础信息。 */
export interface AdbAppInfo {
  /** 包名。 */
  packageName: string

  /** 应用版本名。 */
  versionName: string | null

  /** 应用版本号。 */
  versionCode: string | null

  /** targetSdk。 */
  targetSdk: string | null

  /** minSdk。 */
  minSdk: string | null

  /** 是否为 debuggable 包。 */
  debuggable: boolean

  /** 当前是否在运行。 */
  running: boolean

  /** 当前进程 ID。 */
  pid: string | null
}

/** 应用权限项。 */
export interface AdbPermissionInfo {
  /** 权限完整名称。 */
  name: string

  /** 当前是否已授予。 */
  granted: boolean
}

/** 录屏结果。 */
export interface AdbScreenRecordResult {
  /** 本地保存路径。 */
  filePath: string

  /** 文件所在目录。 */
  directory: string
}

/** 录屏启动结果。 */
export interface AdbScreenRecordStartResult {
  /** 录屏会话 ID。 */
  sessionId: string
}

/** 录屏结束事件。 */
export interface AdbScreenRecordFinishedEvent {
  /** 录屏会话 ID。 */
  sessionId: string

  /** 成功时的文件信息；失败时为空。 */
  result: AdbScreenRecordResult | null

  /** 失败原因；成功时为空。 */
  error: string | null
}

/** PageSpy 调试房间。 */
export interface PageSpyRoomInfo {
  /** PageSpy 调试页面地址。 */
  url: string

  /** 房间 address。 */
  address: string

  /** 房间名称。 */
  name: string | null

  /** 房间标题，通常包含账号和设备信息。 */
  title: string | null
}

/** adb reverse 列表项。 */
export interface AdbReverseEntry {
  /** 原始输出行。 */
  raw: string

  /** 解析出的端口；无法解析时为空。 */
  port: number | null
}

/** 截图结果。 */
export interface AdbScreenshotResult {
  /** PNG data URL。 */
  dataUrl: string

  /** 本地保存路径。 */
  filePath: string

  /** 文件所在目录。 */
  directory: string
}
