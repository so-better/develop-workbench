/** 粘贴选择记录的来源类型。 */
export type ClipboardHistoryItemType = 'text' | 'image' | 'files'

/** 文件引用，不缓存文件本体。 */
export interface ClipboardHistoryFile {
  /** 文件在本机的绝对路径，仅保存引用。 */
  path: string

  /** 文件名，用于浮层展示。 */
  name: string

  /** 是否为目录，决定使用文件夹还是文件图标。 */
  isDirectory: boolean
}

/** 单条可粘贴内容。 */
export interface ClipboardHistoryItem {
  /** 本地稳定 ID，图片缩略图缓存也以它为键。 */
  id: string

  /** 记录类型，决定粘贴时写回哪种剪贴板格式。 */
  type: ClipboardHistoryItemType

  /** 最近一次复制或使用的时间，ISO 字符串。 */
  createdAt: string
  /** 文本内容；非文本记录为 null。 */
  text: string | null
  /** 图片缓存文件名；非图片记录为 null。 */
  imageFile: string | null
  /** 图片宽度和高度；未知时为 null。 */
  imageWidth: number | null
  imageHeight: number | null
  /** 文件引用；非文件记录为 null。 */
  files: ClipboardHistoryFile[] | null
  /** 文本长度或图片大小，单位字节。 */
  size: number
  /** 图片或文件的内容指纹，用于去重；文本为 null。 */
  contentHash: string | null
}

/** 粘贴选择状态。 */
export interface ClipboardHistoryState {
  /** 按最近使用时间倒序排列的记录。 */
  items: ClipboardHistoryItem[]

  /** 当前全局快捷键的 Electron accelerator。 */
  shortcut: string

  /** 浮层使用的主题，独立窗口需要手动同步。 */
  theme: 'light' | 'dark'
}

/** 设置页只需要快捷键和注册状态，避免传输完整历史。 */
export interface ClipboardHistorySettings {
  shortcut: string
  shortcutRegistered: boolean
}

/** 粘贴结果。 */
export interface ClipboardPasteResult {
  success: boolean
  message: string | null
}
