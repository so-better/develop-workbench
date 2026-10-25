import { useEffect, useState } from 'react'
import { FileTextOutlined, LinkOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import type { LinkPreview as LinkPreviewData } from '../../../types/link-preview'

interface LinkPreviewProps {
  /** 链接地址。 */
  href: string

  /** 链接原文，元数据加载失败时作为标题。 */
  fallback: ReactNode
}

/**
 * 行内链接预览。
 * 飞书链接显示文档图标和标题，普通链接显示网页图标和标题。
 */
export default function LinkPreview({ href, fallback }: LinkPreviewProps): JSX.Element {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null)

  useEffect(() => {
    let cancelled = false

    window.electron
      .getLinkPreview(href)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [href])

  const fallbackText =
    typeof fallback === 'string' || typeof fallback === 'number'
      ? String(fallback).trim()
      : ''
  const title = preview?.title || fallback || href
  const accessibleTitle = preview?.title?.trim() || fallbackText || href

  return (
    <a
      className="link-preview-inline"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={accessibleTitle}
      title={accessibleTitle}
    >
      <span className="link-preview-inline-icon">
        {preview?.isFeishu ? <FileTextOutlined /> : <LinkOutlined />}
      </span>
      <span className="link-preview-inline-title">{title}</span>
    </a>
  )
}
