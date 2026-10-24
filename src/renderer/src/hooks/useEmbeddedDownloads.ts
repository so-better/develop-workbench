import { useEffect, useMemo, useState } from 'react'
import type { EmbeddedBrowserDownload } from '../../../types/embedded-browser'

/**
 * 订阅内嵌浏览器下载列表。
 * 下载状态由主进程维护，面板关闭后仍会继续更新。
 */
export const useEmbeddedDownloads = (): {
  downloads: EmbeddedBrowserDownload[]
  activeCount: number
} => {
  const [downloads, setDownloads] = useState<EmbeddedBrowserDownload[]>([])

  useEffect(() => {
    let mounted = true

    window.electron
      .getEmbeddedBrowserDownloads()
      .then((items) => {
        if (mounted) setDownloads(items)
      })
      .catch(() => undefined)

    const unsubscribe = window.electron.onEmbeddedBrowserDownloads((items) => {
      setDownloads(items)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const activeCount = useMemo(
    () => downloads.filter((item) => item.status === 'progressing').length,
    [downloads]
  )

  return { downloads, activeCount }
}
