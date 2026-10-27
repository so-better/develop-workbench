import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BugOutlined,
  FileTextOutlined,
  GlobalOutlined,
  MessageOutlined,
  ProjectOutlined,
  RightOutlined,
  TeamOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { App, Input, Modal, Spin, Tag } from 'antd'
import type { InputRef } from 'antd'
import type { MeegleMyDefects } from '../../../../types/defects'
import type {
  LarkChatSearchResult,
  LarkDocSearchResult,
  LarkMessageSearchResult
} from '../../../../types/lark'
import type { MeegleMyRequirements } from '../../../../types/requirements'
import type { SiteState } from '../../../../types/sites'
import { getErrorMessage } from '../../../../utils'

type QuickAccessType = 'requirement' | 'defect' | 'site' | 'document' | 'message' | 'chat'

const QUICK_ACCESS_TYPE_META: Record<
  QuickAccessType,
  { label: string; color: string }
> = {
  requirement: { label: '需求', color: '#1677ff' },
  defect: { label: '缺陷', color: '#d92d20' },
  message: { label: '消息', color: '#06b6d4' },
  chat: { label: '群聊', color: '#d97706' },
  site: { label: '站点', color: '#15803d' },
  document: { label: '文档', color: '#7c3aed' }
}

interface QuickAccessItem {
  id: string
  type: QuickAccessType
  title: string
  subtitle: string
  meta?: string
  url: string
  appUrl?: string | null
  siteId?: string
}

/** 只展示日期部分，避免搜索结果里的时间信息过长。 */
const formatDate = (value: string | null | undefined): string | null =>
  value?.trim() ? value.slice(0, 10) : null

interface QuickAccessGroup {
  key: QuickAccessType
  label: string
  icon: JSX.Element
  items: QuickAccessItem[]
}

const MAX_RESULTS_PER_GROUP = 8

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

/** 群聊描述如果是需求链接，转成可读的需求 ID。 */
const formatChatDescription = (description: string | null): string | undefined => {
  if (!description) return undefined

  const match = description.match(/\/(?:story|issue)\/detail\/(\d+)/i)

  return match ? `关联需求 ${match[1]}` : description
}

/**
 * 全局快速访问。
 * 搜索站点、需求、缺陷和飞书云文档，结果统一用内置浏览器打开。
 */
export default function QuickAccess(): JSX.Element {
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [sites, setSites] = useState<SiteState | null>(null)
  const [sitesLoading, setSitesLoading] = useState(false)
  const [sitesError, setSitesError] = useState<string | null>(null)
  const [requirements, setRequirements] = useState<MeegleMyRequirements | null>(null)
  const [defects, setDefects] = useState<MeegleMyDefects | null>(null)
  const [requirementsLoading, setRequirementsLoading] = useState(false)
  const [defectsLoading, setDefectsLoading] = useState(false)
  const [requirementsError, setRequirementsError] = useState<string | null>(null)
  const [defectsError, setDefectsError] = useState<string | null>(null)
  const [docs, setDocs] = useState<LarkDocSearchResult[]>([])
  const [messages, setMessages] = useState<LarkMessageSearchResult[]>([])
  const [chats, setChats] = useState<LarkChatSearchResult[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [chatsLoading, setChatsLoading] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [chatsError, setChatsError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [browserVisible, setBrowserVisible] = useState(false)
  const inputRef = useRef<InputRef>(null)
  const docsRequestRef = useRef(0)
  const messagesRequestRef = useRef(0)
  const chatsRequestRef = useRef(0)
  const requirementsRequestRef = useRef(0)
  const defectsRequestRef = useRef(0)

  /** 打开弹窗时读取本地站点。 */
  useEffect(() => {
    if (!open) return

    let mounted = true

    setSitesLoading(true)
    setSitesError(null)

    window.electron
      .getSiteState()
      .then((state) => {
        if (mounted) setSites(state)
      })
      .catch((error) => {
        if (mounted) setSitesError(getErrorMessage(error, '读取站点失败'))
      })
      .finally(() => {
        if (mounted) setSitesLoading(false)
      })

    return () => {
      mounted = false
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

  /** 防抖后的关键词变化时搜索全部需求。 */
  useEffect(() => {
    if (!open) return

    const keyword = searchKeyword.trim()
    const requestId = ++requirementsRequestRef.current

    if (!keyword) {
      setRequirements(null)
      setRequirementsError(null)
      setRequirementsLoading(false)
      return
    }

    setRequirementsLoading(true)
    setRequirementsError(null)

    window.electron
      .searchRequirements(keyword)
      .then((results) => {
        if (requestId !== requirementsRequestRef.current) return
        setRequirements(results)
      })
      .catch((error) => {
        if (requestId !== requirementsRequestRef.current) return
        setRequirements(null)
        setRequirementsError(getErrorMessage(error, '搜索需求失败'))
      })
      .finally(() => {
        if (requestId === requirementsRequestRef.current) {
          setRequirementsLoading(false)
        }
      })
  }, [open, searchKeyword])

  /** 防抖后的关键词变化时搜索全部缺陷。 */
  useEffect(() => {
    if (!open) return

    const keyword = searchKeyword.trim()
    const requestId = ++defectsRequestRef.current

    if (!keyword) {
      setDefects(null)
      setDefectsError(null)
      setDefectsLoading(false)
      return
    }

    setDefectsLoading(true)
    setDefectsError(null)

    window.electron
      .searchDefects(keyword)
      .then((results) => {
        if (requestId !== defectsRequestRef.current) return
        setDefects(results)
      })
      .catch((error) => {
        if (requestId !== defectsRequestRef.current) return
        setDefects(null)
        setDefectsError(getErrorMessage(error, '搜索缺陷失败'))
      })
      .finally(() => {
        if (requestId === defectsRequestRef.current) setDefectsLoading(false)
      })
  }, [open, searchKeyword])

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
      setChats([])
      setChatsError(null)
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

  /** 防抖后的关键词变化时搜索飞书群聊。 */
  useEffect(() => {
    if (!open) return

    const keyword = searchKeyword.trim()
    const requestId = ++chatsRequestRef.current

    if (!keyword) {
      setChats([])
      setChatsError(null)
      setChatsLoading(false)
      return
    }

    setChatsLoading(true)
    setChatsError(null)

    window.electron
      .searchLarkChats(keyword)
      .then((results) => {
        if (requestId !== chatsRequestRef.current) return
        setChats(results)
      })
      .catch((error) => {
        if (requestId !== chatsRequestRef.current) return
        setChats([])
        setChatsError(getErrorMessage(error, '搜索飞书群聊失败'))
      })
      .finally(() => {
        if (requestId === chatsRequestRef.current) setChatsLoading(false)
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

  /** 底部状态栏等外部入口通过事件打开快速访问。 */
  useEffect(() => {
    const handleOpen = (): void => {
      if (browserVisible) {
        window.electron.closeEmbeddedBrowser().catch(() => undefined)
      }

      setOpen(true)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }

    window.addEventListener('quick-access:open', handleOpen)

    return () => window.removeEventListener('quick-access:open', handleOpen)
  }, [browserVisible])

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
      setChats([])
      setChatsError(null)
      setRequirements(null)
      setDefects(null)
      setRequirementsError(null)
      setDefectsError(null)
    }
  }, [open])

  const keyword = searchKeyword.trim().toLocaleLowerCase()

  const groups = useMemo<QuickAccessGroup[]>(() => {
    if (!keyword) return []

    const requirementData = requirements
    const requirementResults = requirementData
      ? requirementData.groups
          .flatMap((group) => group.requirements)
          .slice(0, MAX_RESULTS_PER_GROUP)
          .map((requirement) => ({
            id: `requirement:${requirement.id}`,
            type: 'requirement' as const,
            title: requirement.name,
            subtitle: [
              requirement.status,
              requirement.priority,
              requirement.iterationName,
              requirementData.project.name
            ]
              .filter(Boolean)
              .join(' · '),
            meta: [
              requirement.owners.map((owner) => owner.name).join('、'),
              formatDate(requirement.updatedAt)
                ? `更新于 ${formatDate(requirement.updatedAt)}`
                : null
            ]
              .filter(Boolean)
              .join(' · '),
            url: getRequirementUrl(requirementData, requirement.id)
          }))
      : []

    const defectData = defects
    const defectResults = defectData
      ? defectData.defects
          .slice(0, MAX_RESULTS_PER_GROUP)
          .map((defect) => ({
            id: `defect:${defect.id}`,
            type: 'defect' as const,
            title: defect.name,
            subtitle: [
              defect.status,
              defect.priority,
              defect.severity,
              defect.iterationName
            ]
              .filter(Boolean)
              .join(' · '),
            meta: [
              defect.owners.map((owner) => owner.name).join('、'),
              formatDate(defect.updatedAt) ? `更新于 ${formatDate(defect.updatedAt)}` : null
            ]
              .filter(Boolean)
              .join(' · '),
            url: getDefectUrl(defectData, defect.id)
          }))
      : []

    const siteData = sites
    const siteResults = siteData
      ? siteData.sites
          .filter((site) =>
            matchesKeyword([site.name, site.url, site.tags.join(' '), site.env], keyword)
          )
          .slice(0, MAX_RESULTS_PER_GROUP)
          .map((site) => ({
            id: `site:${site.id}`,
            type: 'site' as const,
            title: site.name,
            subtitle: site.url,
            meta: [site.env ? `环境：${site.env}` : null, site.tags.join('、')]
              .filter(Boolean)
              .join(' · '),
            url: site.url,
            siteId: site.id
          }))
      : []

    const chatResults = chats.map((chat) => ({
      id: `chat:${chat.id}`,
      type: 'chat' as const,
      title: chat.name,
      subtitle: chat.external ? '外部群' : '内部群',
      meta: formatChatDescription(chat.description),
      url: chat.url,
      appUrl: chat.appUrl
    }))

    const messageResults = messages.map((message) => ({
      id: `message:${message.id}`,
      type: 'message' as const,
      title: message.title || message.chatName,
      subtitle: [message.chatName, message.senderName, message.createdAt]
        .filter(Boolean)
        .join(' · '),
      meta: message.title !== message.content ? message.content : undefined,
      url: message.url,
      appUrl: message.appUrl
    }))

    const documents = docs
      .slice(0, MAX_RESULTS_PER_GROUP)
      .map((document) => ({
        id: `document:${document.id}`,
        type: 'document' as const,
        title: document.title,
        subtitle: [document.type, document.owner, formatDate(document.updatedAt)]
          .filter(Boolean)
          .join(' · '),
        meta: document.summary ?? undefined,
        url: document.url
      }))

    return [
      { key: 'requirement' as const, label: '需求', icon: <ProjectOutlined />, items: requirementResults },
      { key: 'defect' as const, label: '缺陷', icon: <BugOutlined />, items: defectResults },
      { key: 'chat' as const, label: '飞书群聊', icon: <TeamOutlined />, items: chatResults },
      { key: 'message' as const, label: '飞书消息', icon: <MessageOutlined />, items: messageResults },
      { key: 'site' as const, label: '站点', icon: <GlobalOutlined />, items: siteResults },
      { key: 'document' as const, label: '飞书云文档', icon: <FileTextOutlined />, items: documents }
    ].filter((group) => group.items.length > 0)
  }, [chats, defects, docs, keyword, messages, requirements, sites])

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
    } catch (error) {
      message.error(getErrorMessage(error, '打开链接失败'))
    }
  }

  // 弹窗打开时统一处理上下选择和回车，避免输入框吞掉按键。
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((current) =>
          flatItems.length > 0 ? (current + 1) % flatItems.length : 0
        )
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((current) =>
          flatItems.length > 0
            ? (current - 1 + flatItems.length) % flatItems.length
            : 0
        )
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const item = flatItems[activeIndex]

        if (item) void handleOpen(item)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [activeIndex, flatItems, handleOpen, open])

  let itemIndex = -1

  return (
    <Modal
      open={open}
      width={760}
      centered
      footer={null}
      closable={false}
      className="quick-access-modal"
      onCancel={() => setOpen(false)}
      afterOpenChange={(visible) => {
        if (visible) window.requestAnimationFrame(() => inputRef.current?.focus())
      }}
    >
      <div className="quick-access">
        <div className="quick-access-heading">
          <div>
            <strong>快速访问</strong>
            <span>跨需求、缺陷、站点、飞书群聊/消息和云文档搜索</span>
          </div>
          <kbd>Esc</kbd>
        </div>

        <div className="quick-access-search">
          <Input
            ref={inputRef}
            size="large"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索需求、缺陷、站点、飞书群聊、消息和文档"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="quick-access-body">
          {sitesError ? <div className="quick-access-hint is-error">{sitesError}</div> : null}
          {requirementsError ? (
            <div className="quick-access-hint is-error">{requirementsError}</div>
          ) : null}
          {defectsError ? (
            <div className="quick-access-hint is-error">{defectsError}</div>
          ) : null}

          {!keyword ? (
            <div className="quick-access-empty">输入关键词开始搜索</div>
          ) : sitesLoading ||
            requirementsLoading ||
            defectsLoading ||
            docsLoading ||
            messagesLoading ||
            chatsLoading ? (
            <div className="quick-access-loading">
              <Spin size="small" />
              <span>正在搜索...</span>
            </div>
          ) : null}

          {keyword && groups.length > 0 ? (
            <div className="quick-access-results">
              {groups.map((group) => (
                <section className={`quick-access-group is-${group.key}`} key={group.key}>
                  <div className="quick-access-group-title">
                    <span className="quick-access-group-icon">{group.icon}</span>
                    <span>{group.label}</span>
                    <span className="quick-access-group-count">{group.items.length}</span>
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
                          <span className="quick-access-item-title-row">
                            <Tag
                              className="quick-access-type-tag"
                              color={QUICK_ACCESS_TYPE_META[item.type].color}
                              bordered={false}
                            >
                              {QUICK_ACCESS_TYPE_META[item.type].label}
                            </Tag>
                            <strong>{item.title}</strong>
                          </span>
                          <span>{item.subtitle}</span>
                          {item.meta ? (
                            <span className="quick-access-item-meta">{item.meta}</span>
                          ) : null}
                        </span>
                        <RightOutlined />
                      </a>
                    )
                  })}
                </section>
              ))}
            </div>
          ) : null}

          {keyword &&
          !sitesLoading &&
          !requirementsLoading &&
          !defectsLoading &&
          !docsLoading &&
          !messagesLoading &&
          !chatsLoading &&
          groups.length === 0 ? (
            <div className="quick-access-empty">没有找到匹配内容</div>
          ) : null}

          {docsError ? <div className="quick-access-hint is-error">{docsError}</div> : null}
          {messagesError ? <div className="quick-access-hint is-error">{messagesError}</div> : null}
        {chatsError ? <div className="quick-access-hint is-error">{chatsError}</div> : null}
        </div>

        <div className="quick-access-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd>选择</span>
          <span><kbd>Enter</kbd>打开</span>
          <span><kbd>Esc</kbd>关闭</span>
        </div>
      </div>
    </Modal>
  )
}
