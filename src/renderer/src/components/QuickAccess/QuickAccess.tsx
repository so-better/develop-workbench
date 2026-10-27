import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BugOutlined,
  FileTextOutlined,
  GlobalOutlined,
  MessageOutlined,
  ProjectOutlined,
  RightOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { App, Input, Modal, Spin } from 'antd'
import type { InputRef } from 'antd'
import type { MeegleMyDefects } from '../../../../types/defects'
import type { LarkDocSearchResult, LarkMessageSearchResult } from '../../../../types/lark'
import type { MeegleMyRequirements } from '../../../../types/requirements'
import type { SiteState } from '../../../../types/sites'
import { getErrorMessage } from '../../../../utils'

type QuickAccessType = 'requirement' | 'defect' | 'site' | 'document' | 'message'

interface QuickAccessItem {
  id: string
  type: QuickAccessType
  title: string
  subtitle: string
  url: string
  appUrl?: string | null
  siteId?: string
}

interface QuickAccessGroup {
  key: QuickAccessType
  label: string
  icon: JSX.Element
  items: QuickAccessItem[]
}

interface BaseData {
  requirements: MeegleMyRequirements | null
  defects: MeegleMyDefects | null
  sites: SiteState | null
}

interface BaseCache extends BaseData {
  expiresAt: number
}

const BASE_CACHE_TTL_MS = 60_000
const MAX_RESULTS_PER_GROUP = 8
let baseCache: BaseCache | null = null

const matchesKeyword = (values: Array<string | null | undefined>, keyword: string): boolean =>
  values.some((value) => value?.toLocaleLowerCase().includes(keyword) ?? false)

const getRequirementUrl = (data: MeegleMyRequirements, id: string): string =>
  `https://project.feishu.cn/${encodeURIComponent(
    data.project.key
  )}/story/detail/${encodeURIComponent(id)}`

const getDefectUrl = (data: MeegleMyDefects, id: string): string =>
  `https://project.feishu.cn/${encodeURIComponent(
    data.project.key
  )}/issue/detail/${encodeURIComponent(id)}`

/**
 * 全局快速访问。
 * 搜索站点、需求、缺陷和飞书云文档，结果统一用内置浏览器打开。
 */
export default function QuickAccess(): JSX.Element {
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [baseData, setBaseData] = useState<BaseData | null>(null)
  const [baseLoading, setBaseLoading] = useState(false)
  const [baseError, setBaseError] = useState<string | null>(null)
  const [docs, setDocs] = useState<LarkDocSearchResult[]>([])
  const [messages, setMessages] = useState<LarkMessageSearchResult[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [browserVisible, setBrowserVisible] = useState(false)
  const inputRef = useRef<InputRef>(null)
  const docsRequestRef = useRef(0)
  const messagesRequestRef = useRef(0)

  /** 首次打开或缓存过期时加载基础数据。 */
  useEffect(() => {
    if (!open) return

    if (baseCache && baseCache.expiresAt > Date.now()) {
      setBaseData({
        requirements: baseCache.requirements,
        defects: baseCache.defects,
        sites: baseCache.sites
      })
      return
    }

    let cancelled = false

    setBaseLoading(true)
    setBaseError(null)

    Promise.allSettled([
      window.electron.getMyRequirements(),
      window.electron.getMyDefects(null),
      window.electron.getSiteState()
    ])
      .then(([requirements, defects, sites]) => {
        if (cancelled) return

        const next: BaseData = {
          requirements: requirements.status === 'fulfilled' ? requirements.value : null,
          defects: defects.status === 'fulfilled' ? defects.value : null,
          sites: sites.status === 'fulfilled' ? sites.value : null
        }

        if (requirements.status === 'fulfilled' && defects.status === 'fulfilled' && sites.status === 'fulfilled') {
          baseCache = {
            ...next,
            expiresAt: Date.now() + BASE_CACHE_TTL_MS
          }
        } else {
          setBaseError('部分数据读取失败，请稍后重试')
        }

        setBaseData(next)
      })
      .catch((error) => {
        if (!cancelled) setBaseError(getErrorMessage(error, '读取快速访问数据失败'))
      })
      .finally(() => {
        if (!cancelled) setBaseLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open])

  // 输入防抖：本地过滤和飞书文档搜索都使用稳定的关键词。
  useEffect(() => {
    if (!open) return

    const timer = window.setTimeout(() => {
      setSearchKeyword(query)
    }, 300)

    return () => window.clearTimeout(timer)
  }, [open, query])

  /** 防抖后的关键词变化时搜索飞书文档。 */
  useEffect(() => {
    if (!open) return

    const keyword = searchKeyword.trim()
    const requestId = ++docsRequestRef.current

    if (!keyword) {
      setDocs([])
      setDocsError(null)
      setDocsLoading(false)
      return
    }

    setDocsLoading(true)
    setDocsError(null)

    window.electron
      .searchLarkDocs(keyword)
      .then((results) => {
        if (requestId !== docsRequestRef.current) return
        setDocs(results)
      })
      .catch((error) => {
        if (requestId !== docsRequestRef.current) return
        setDocs([])
        setDocsError(getErrorMessage(error, '搜索飞书文档失败'))
      })
      .finally(() => {
        if (requestId === docsRequestRef.current) setDocsLoading(false)
      })
  }, [open, searchKeyword])

  /** 防抖后的关键词变化时搜索飞书消息。 */
  useEffect(() => {
    if (!open) return

    const keyword = searchKeyword.trim()
    const requestId = ++messagesRequestRef.current

    if (!keyword) {
      setMessages([])
      setMessagesError(null)
      setMessagesLoading(false)
      return
    }

    setMessagesLoading(true)
    setMessagesError(null)

    window.electron
      .searchLarkMessages(keyword)
      .then((results) => {
        if (requestId !== messagesRequestRef.current) return
        setMessages(results)
      })
      .catch((error) => {
        if (requestId !== messagesRequestRef.current) return
        setMessages([])
        setMessagesError(getErrorMessage(error, '搜索飞书消息失败'))
      })
      .finally(() => {
        if (requestId === messagesRequestRef.current) setMessagesLoading(false)
      })
  }, [open, searchKeyword])

  // 快速访问和浏览器面板不同时存在于最上层，打开快速访问时先关闭浏览器。
  useEffect(() => {
    let mounted = true

    window.electron
      .getEmbeddedBrowserState()
      .then((state) => {
        if (mounted) setBrowserVisible(Boolean(state?.visible))
      })
      .catch(() => undefined)

    const unsubscribe = window.electron.onEmbeddedBrowserState((state) => {
      setBrowserVisible(state.visible)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  /** Cmd/Ctrl+K 打开快速访问；浏览器已打开时优先关闭浏览器。 */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        event.stopImmediatePropagation()

        if (browserVisible) {
          window.electron.closeEmbeddedBrowser().catch(() => undefined)
        }

        setOpen(true)
        window.requestAnimationFrame(() => inputRef.current?.focus())
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [browserVisible])

  /** 浏览器打开时 Esc 关闭浏览器，否则关闭快速访问。 */
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      event.stopImmediatePropagation()

      if (browserVisible) {
        window.electron.closeEmbeddedBrowser().catch(() => undefined)
      } else {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [browserVisible, open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSearchKeyword('')
      setActiveIndex(0)
      setDocs([])
      setDocsError(null)
      setMessages([])
      setMessagesError(null)
    }
  }, [open])

  const keyword = searchKeyword.trim().toLocaleLowerCase()

  const groups = useMemo<QuickAccessGroup[]>(() => {
    if (!keyword) return []

    const requirementData = baseData?.requirements ?? null
    const requirements = requirementData
      ? requirementData.groups
          .flatMap((group) => group.requirements)
          .filter((requirement) =>
            matchesKeyword(
              [
                requirement.name,
                requirement.id,
                requirement.status,
                requirement.priority,
                requirement.owners.map((owner) => owner.name).join(' ')
              ],
              keyword
            )
          )
          .slice(0, MAX_RESULTS_PER_GROUP)
          .map((requirement) => ({
            id: `requirement:${requirement.id}`,
            type: 'requirement' as const,
            title: requirement.name,
            subtitle: [
              requirement.status,
              requirement.priority,
              requirementData.project.name
            ]
              .filter(Boolean)
              .join(' · '),
            url: getRequirementUrl(requirementData, requirement.id)
          }))
      : []

    const defectData = baseData?.defects ?? null
    const defects = defectData
      ? defectData.defects
          .filter((defect) =>
            matchesKeyword(
              [defect.name, defect.id, defect.status, defect.priority, defect.severity],
              keyword
            )
          )
          .slice(0, MAX_RESULTS_PER_GROUP)
          .map((defect) => ({
            id: `defect:${defect.id}`,
            type: 'defect' as const,
            title: defect.name,
            subtitle: [defect.status, defect.priority, defect.severity].filter(Boolean).join(' · '),
            url: getDefectUrl(defectData, defect.id)
          }))
      : []

    const siteData = baseData?.sites ?? null
    const sites = siteData
      ? siteData.sites
          .filter((site) =>
            matchesKeyword([site.name, site.url, site.tags.join(' '), site.env], keyword)
          )
          .slice(0, MAX_RESULTS_PER_GROUP)
          .map((site) => ({
            id: `site:${site.id}`,
            type: 'site' as const,
            title: site.name,
            subtitle: [site.url, site.env, site.tags.join(' ')].filter(Boolean).join(' · '),
            url: site.url,
            siteId: site.id
          }))
      : []

    const messageResults = messages.map((message) => ({
      id: `message:${message.id}`,
      type: 'message' as const,
      title: message.content || message.chatName,
      subtitle: [message.chatName, message.senderName, message.createdAt]
        .filter(Boolean)
        .join(' · '),
      url: message.url,
      appUrl: message.appUrl
    }))

    const documents = docs
      .slice(0, MAX_RESULTS_PER_GROUP)
      .map((document) => ({
        id: `document:${document.id}`,
        type: 'document' as const,
        title: document.title,
        subtitle: [document.type, document.owner, document.summary].filter(Boolean).join(' · '),
        url: document.url
      }))

    return [
      { key: 'requirement' as const, label: '需求', icon: <ProjectOutlined />, items: requirements },
      { key: 'defect' as const, label: '缺陷', icon: <BugOutlined />, items: defects },
      { key: 'message' as const, label: '飞书消息', icon: <MessageOutlined />, items: messageResults },
      { key: 'site' as const, label: '站点', icon: <GlobalOutlined />, items: sites },
      { key: 'document' as const, label: '飞书云文档', icon: <FileTextOutlined />, items: documents }
    ].filter((group) => group.items.length > 0)
  }, [baseData, docs, keyword, messages])

  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, groups.length])

  useEffect(() => {
    document
      .querySelector('.quick-access-item.is-active')
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleOpen = async (item: QuickAccessItem): Promise<void> => {
    try {
      if (item.appUrl) {
        try {
          await window.electron.openExternalUrl(item.appUrl)
          setOpen(false)
          return
        } catch {
          // 飞书客户端不可用时回退到内置浏览器。
        }
      }

      const opened = await window.electron.openEmbeddedBrowser(item.url, {
        navigation: true
      })

      if (!opened) return

      if (item.siteId) {
        await window.electron.recordSiteOpen(item.siteId).catch(() => undefined)
      }

      setOpen(false)
    } catch (error) {
      message.error(getErrorMessage(error, '打开链接失败'))
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) =>
        flatItems.length > 0 ? (current + 1) % flatItems.length : 0
      )
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) =>
        flatItems.length > 0
          ? (current - 1 + flatItems.length) % flatItems.length
          : 0
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = flatItems[activeIndex]

      if (item) void handleOpen(item)
    }
  }

  let itemIndex = -1

  return (
    <Modal
      open={open}
      title="快速访问"
      width={760}
      centered
      footer={null}
      className="quick-access-modal"
      onCancel={() => setOpen(false)}
      afterOpenChange={(visible) => {
        if (visible) window.requestAnimationFrame(() => inputRef.current?.focus())
      }}
    >
      <div className="quick-access">
        <Input
          ref={inputRef}
          size="large"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索站点、需求、缺陷、飞书消息、云文档"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        {baseError ? <div className="quick-access-hint is-error">{baseError}</div> : null}

        {!keyword ? (
          <div className="quick-access-empty">输入关键词开始搜索</div>
        ) : baseLoading || docsLoading || messagesLoading ? (
          <div className="quick-access-loading">
            <Spin size="small" />
            <span>正在搜索...</span>
          </div>
        ) : null}

        {keyword && groups.length > 0 ? (
          <div className="quick-access-results">
            {groups.map((group) => (
              <section className="quick-access-group" key={group.key}>
                <div className="quick-access-group-title">
                  {group.icon}
                  <span>{group.label}</span>
                </div>
                {group.items.map((item) => {
                  itemIndex += 1
                  const index = itemIndex

                  return (
                    <a
                      key={item.id}
                      className={`quick-access-item${index === activeIndex ? ' is-active' : ''}`}
                      href={item.url}
                      onClick={(event) => {
                        event.preventDefault()
                        void handleOpen(item)
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <span className="quick-access-item-copy">
                        <strong>{item.title}</strong>
                        <span>{item.subtitle}</span>
                      </span>
                      <RightOutlined />
                    </a>
                  )
                })}
              </section>
            ))}
          </div>
        ) : null}

        {keyword && !baseLoading && !docsLoading && !messagesLoading && groups.length === 0 ? (
          <div className="quick-access-empty">没有找到匹配内容</div>
        ) : null}

        {docsError ? <div className="quick-access-hint is-error">{docsError}</div> : null}
        {messagesError ? <div className="quick-access-hint is-error">{messagesError}</div> : null}

        <div className="quick-access-footer">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </Modal>
  )
}
