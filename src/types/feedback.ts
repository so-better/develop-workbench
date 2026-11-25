/**
 * 应用内反馈附件图片。
 * 渲染进程传 data URL，主进程写入临时文件后通过 Lark CLI 发送。
 */
export interface FeedbackImageInput {
  /** 文件名，用于生成临时文件。 */
  name: string

  /** 图片 data URL，支持 png/jpeg/webp。 */
  dataUrl: string
}

/** 反馈诊断信息。 */
export interface FeedbackDiagnostic {
  label: string
  value: string
}

/** 提交到反馈群的完整反馈内容。 */
export interface FeedbackSubmission {
  /** 提交人显示名。 */
  submitter: string

  /** 问题描述。 */
  description: string

  /** 自动收集的环境信息。 */
  diagnostics: FeedbackDiagnostic[]

  /** 附带的图片。 */
  images: FeedbackImageInput[]
}

/** 反馈附带的系统信息。 */
export interface FeedbackSystemInfo {
  platform: string
  arch: string
  osType: string
  osRelease: string
  cpuModel: string
  cpuCount: number
  totalMemory: number
  freeMemory: number
}

/** 反馈发送结果。 */
export interface FeedbackSendResult {
  /** 成功发送的图片数量。 */
  sentImages: number

  /** 发送失败的图片数量。 */
  failedImages: number
}
