/**
 * 富文本编辑器使用的 Delta 结构。
 */
export interface RichTextDelta {
  ops: Array<Record<string, unknown>>
}

/**
 * 富文本编辑器的完整内容。
 */
export interface RichTextContent {
  html: string
  text: string
  delta: RichTextDelta
}
