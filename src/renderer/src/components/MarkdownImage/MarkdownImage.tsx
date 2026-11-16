import { useEffect, useState } from 'react'
import { Button, Image } from 'antd'
import './MarkdownImage.css'

interface MarkdownImageProps {
  src?: string
  alt?: string
  title?: string
}

const REMOTE_IMAGE_HOSTS = [
  'feishu.cn',
  'larksuite.com',
  'feishucdn.com',
  'larksuitecdn.com'
]

/**
 * 判断图片是否需要走主进程的飞书登录态代理。
 */
const isRemoteImage = (src: string): boolean => {
  try {
    const url = new URL(src)

    return (
      url.protocol === 'https:' &&
      REMOTE_IMAGE_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    )
  } catch {
    return false
  }
}

/**
 * Markdown 图片。
 * 飞书图片通过主进程代理加载，避免渲染进程缺少登录 Cookie 导致 401。
 */
export default function MarkdownImage({
  src,
  alt = '',
  title
}: MarkdownImageProps): JSX.Element | null {
  const remote = Boolean(src && isRemoteImage(src))
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(
    remote ? null : src ?? null
  )
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true

    setFailed(false)

    if (!src) {
      setResolvedSrc(null)
      return
    }

    if (!isRemoteImage(src)) {
      setResolvedSrc(src)
      return
    }

    setResolvedSrc(null)

    window.electron
      .getMarkdownImage(src)
      .then((dataUrl) => {
        if (!active) return

        if (dataUrl) {
          setResolvedSrc(dataUrl)
        } else {
          setFailed(true)
        }
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
    }
  }, [reloadKey, src])

  if (!src) return null

  if (failed) {
    return (
      <span className="markdown-image-error">
        图片加载失败
        <Button
          type="link"
          size="small"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          重试
        </Button>
      </span>
    )
  }

  if (!resolvedSrc) {
    return (
      <span className="markdown-image-loading" role="status">
        图片加载中…
      </span>
    )
  }

  return (
    <Image
      src={resolvedSrc}
      alt={alt}
      title={title}
      className="markdown-image"
      wrapperClassName="markdown-image-wrapper"
      loading="lazy"
      decoding="async"
      preview={{
        mask: '查看图片',
        destroyOnHidden: true,
        zIndex: 1300
      }}
      onError={() => setFailed(true)}
    />
  )
}
