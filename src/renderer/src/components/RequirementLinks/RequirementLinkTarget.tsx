import { useEffect, useState } from 'react'
import { FileTextOutlined, LinkOutlined } from '@ant-design/icons'
import type { RequirementLink } from '../../../../types/requirement-links'
import type { LinkPreview } from '../../../../types/link-preview'

interface Props {
  link: RequirementLink
  onOpen: (url: string) => void
}

const isFeishuLink = (url: string): boolean => {
  try {
    const { hostname } = new URL(url)
    return ['feishu.cn', 'larksuite.com'].some((host) => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

/** 飞书预览标题替代名称展示，失败时回退到保存的名称；不回写链接记录。 */
export default function RequirementLinkTarget({ link, onOpen }: Props): JSX.Element {
  const [result, setResult] = useState<{ url: string; preview: LinkPreview } | null>(null)
  const isFeishu = isFeishuLink(link.url)
  // 地址变化后的首帧也必须隐藏旧预览，不能只依赖 effect 中清空状态。
  const preview = result?.url === link.url ? result.preview : null

  useEffect(() => {
    let cancelled = false
    setResult(null)
    if (isFeishu) {
      // 主进程已有缓存、请求去重及并发限制；权限或网络失败时退回原地址。
      window.electron.getLinkPreview(link.url).then((value) => {
        if (!cancelled) setResult({ url: link.url, preview: value })
      }).catch(() => undefined)
    }
    return () => { cancelled = true }
  }, [link.url, isFeishu])

  const title = preview?.title?.trim() || link.name

  return (
    <a
      className="requirement-links-target"
      href={link.url}
      title={preview?.title ? `${preview.title}\n${link.url}` : link.url}
      onClick={(event) => { event.preventDefault(); onOpen(link.url) }}
    >
      <span className="requirement-links-icon" aria-hidden="true">
        {isFeishu ? <FileTextOutlined /> : <LinkOutlined />}
      </span>
      <span className="requirement-links-text">
        <span className="requirement-links-name">{title}</span>
        <span className="requirement-links-url">{link.url.replace(/^https?:\/\//i, '')}</span>
      </span>
    </a>
  )
}
