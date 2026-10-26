import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  HolderOutlined,
  LinkOutlined,
  PlusOutlined,
  SearchOutlined,
  StarOutlined
} from '@ant-design/icons'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tooltip
} from 'antd'
import type { InputRef } from 'antd'
import type { SiteInput, SiteLink } from '../../../../types/sites'
import { getErrorMessage, normalizeHttpUrl } from '../../../../utils'

interface SiteFormValues {
  name: string
  url: string
  tags?: string[]
}

const SITE_TAG_TONES: Record<string, string> = {
  飞书文档: 'blue',
  飞书表格: 'teal',
  第三方网站: 'gray',
  公司平台: 'purple',
  业务系统: 'green',
  自研内部系统: 'orange'
}

const getSiteTagTone = (tag: string): string => SITE_TAG_TONES[tag] ?? 'gray'

const DEFAULT_SITE_TAGS = [
  '飞书文档',
  '飞书表格',
  '第三方网站',
  '公司平台',
  '业务系统',
  '自研内部系统'
]

const FREQUENT_CLICK_THRESHOLD = 2
const FREQUENT_SITE_LIMIT = 8
const getSiteTimestamp = (value: string | null): number =>
  value ? new Date(value).getTime() : 0

const getSiteDisplayUrl = (url: string): string =>
  url.replace(/^https?:\/\//i, '').replace(/\/$/, '')

interface SiteCardProps {
  site: SiteLink
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
  dragHandle?: ReactNode
}

/**
 * 单个站点卡片。
 */
function SiteCard({
  site,
  onOpen,
  onEdit,
  onRemove,
  dragHandle
}: SiteCardProps): JSX.Element {
  return (
    <article className="site-card">
      <button
        type="button"
        className="site-card-main"
        title={`打开 ${site.name}`}
        onClick={onOpen}
      >
        <span className="site-card-copy">
          <span className="site-card-title">
            <Tooltip title={site.name}>
              <strong>{site.name}</strong>
            </Tooltip>
            <LinkOutlined className="site-card-link-icon" />
          </span>
          {site.tags.length > 0 ? (
            <span className="site-card-tags">
              {site.tags.map((tag) => (
                <span
                  className={`site-card-tag is-${getSiteTagTone(tag)}`}
                  title={tag}
                  key={tag}
                >
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
      <div className="site-card-footer">
        <button
          type="button"
          className="site-card-url-button"
          onClick={onOpen}
        >
          <span>{getSiteDisplayUrl(site.url)}</span>
        </button>
        <div className="site-card-actions">
          {dragHandle}
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={`编辑 ${site.name}`}
            onClick={onEdit}
          />
          <Popconfirm
            title="删除这个站点？"
            okText="删除"
            cancelText="取消"
            onConfirm={onRemove}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={`删除 ${site.name}`}
            />
          </Popconfirm>
        </div>
      </div>
    </article>
  )
}

interface SortableSiteCardProps extends Omit<SiteCardProps, 'dragHandle'> {}

/**
 * 可拖拽的站点卡片。
 */
function SortableSiteCard({
  site,
  onOpen,
  onEdit,
  onRemove
}: SortableSiteCardProps): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: site.id })

  return (
    <div
      ref={setNodeRef}
      className="site-sortable-card"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : undefined
      }}
    >
      <SiteCard
        site={site}
        onOpen={onOpen}
        onEdit={onEdit}
        onRemove={onRemove}
        dragHandle={
          <Tooltip title="拖拽排序">
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="site-card-drag-handle"
              aria-label="拖拽排序"
              {...attributes}
              {...listeners}
            >
              <HolderOutlined />
            </button>
          </Tooltip>
        }
      />
    </div>
  )
}

/**
 * 站点快捷入口。
 * 用户维护常用系统地址，点击后统一使用应用内浏览器打开。
 */
export default function SitesPage(): JSX.Element {
  const { message } = App.useApp()
  const [form] = Form.useForm<SiteFormValues>()
  const [sites, setSites] = useState<SiteLink[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSite, setEditingSite] = useState<SiteLink | null>(null)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<InputRef>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeWidth, setActiveWidth] = useState<number | undefined>()
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const loadSites = useCallback(async (showLoading = true): Promise<void> => {
    if (showLoading) setLoading(true)

    setError(null)

    try {
      const state = await window.electron.getSiteState()
      setSites(state.sites)
    } catch (loadError) {
      setError(getErrorMessage(loadError, '站点加载失败'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSites()
  }, [loadSites])

  useEffect(() => {
    const handleSitesChanged = (): void => {
      loadSites(false)
    }

    window.addEventListener('sites:changed', handleSitesChanged)

    return () => window.removeEventListener('sites:changed', handleSitesChanged)
  }, [loadSites])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const page = document.querySelector<HTMLElement>('.sites-page')

      if (!page || page.offsetParent === null) return

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === 'k'
      ) {
        event.preventDefault()
        searchInputRef.current?.focus()
        return
      }

      if (
        event.key === 'Escape' &&
        searchInputRef.current?.input === document.activeElement
      ) {
        event.preventDefault()
        setSearch('')
        searchInputRef.current?.blur()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  /**
   * 打开站点，并记录一次打开频率。
   */
  const handleOpenSite = async (site: SiteLink): Promise<void> => {
    try {
      const opened = await window.electron.openEmbeddedBrowser(site.url)

      if (!opened) return

      const next = await window.electron.recordSiteOpen(site.id)
      setSites(next.sites)
    } catch {
      // 打开和统计失败不阻断站点访问。
    }
  }

  const filteredSites = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()

    if (!keyword) return sites

    return sites.filter((site) =>
      [site.name, site.url, site.tags.join(' ')].some((value) =>
        value.toLocaleLowerCase().includes(keyword)
      )
    )
  }, [search, sites])

  const canReorder = search.trim().length === 0
  const activeSite = activeId
    ? sites.find((site) => site.id === activeId) ?? null
    : null

  const handleDragStart = (event: DragStartEvent): void => {
    setActiveId(String(event.active.id))
    setActiveWidth(event.active.rect.current.initial?.width)
  }

  const handleDragCancel = (): void => {
    setActiveId(null)
    setActiveWidth(undefined)
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event

    setActiveId(null)
    setActiveWidth(undefined)

    if (!over || active.id === over.id) return

    const fromIndex = sites.findIndex((site) => site.id === String(active.id))
    const targetIndex = sites.findIndex((site) => site.id === String(over.id))

    if (fromIndex < 0 || targetIndex < 0) return

    const next = arrayMove(sites, fromIndex, targetIndex)
    setSites(next)

    void window.electron
      .reorderSites(next.map((site) => site.id))
      .then((state) => setSites(state.sites))
      .catch(async (saveError: unknown) => {
        message.error(getErrorMessage(saveError, '保存站点失败'))
        await loadSites(false)
      })
  }

  const frequentSites = useMemo(
    () =>
      filteredSites
        .filter((site) => site.clickCount >= FREQUENT_CLICK_THRESHOLD)
        .sort((left, right) => {
          const countDiff = right.clickCount - left.clickCount

          if (countDiff !== 0) return countDiff

          return (
            getSiteTimestamp(right.lastOpenedAt) -
            getSiteTimestamp(left.lastOpenedAt)
          )
        })
        .slice(0, FREQUENT_SITE_LIMIT),
    [filteredSites]
  )

  const openCreate = (): void => {
    setEditingSite(null)
    form.setFieldsValue({
      name: '',
      url: '',
      tags: []
    })
    setModalOpen(true)
  }

  const openEdit = (site: SiteLink): void => {
    setEditingSite(site)
    form.setFieldsValue({
      name: site.name,
      url: site.url,
      tags: site.tags
    })
    setModalOpen(true)
  }

  const closeModal = (): void => {
    setModalOpen(false)
    setEditingSite(null)
    form.resetFields()
  }

  const handleSave = async (): Promise<void> => {
    let values: SiteFormValues

    try {
      values = await form.validateFields()
    } catch {
      return
    }

    const input: SiteInput = {
      name: values.name.trim(),
      url: normalizeHttpUrl(values.url, '站点 URL'),
      tags: values.tags ?? []
    }

    setSaving(true)

    try {
      const next = editingSite
        ? await window.electron.updateSite(editingSite.id, input)
        : await window.electron.addSite(input)

      setSites(next.sites)
      closeModal()
      message.success(editingSite ? '站点已更新' : '站点已添加')
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '保存站点失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (site: SiteLink): Promise<void> => {
    try {
      const next = await window.electron.removeSite(site.id)
      setSites(next.sites)
      message.success('站点已删除')
    } catch (removeError) {
      message.error(getErrorMessage(removeError, '删除站点失败'))
    }
  }

  return (
    <div className="sites-page">
      <header className="sites-header">
        <div className="sites-heading">
          <span className="sites-eyebrow">快捷入口 / 站点</span>
          <h1>站点</h1>
          <p>把日常使用的系统、文档和工具集中到一个地方。</p>
        </div>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={openCreate}
        >
          新增站点
        </Button>
      </header>

      <main className="sites-content">
        {error ? (
          <Alert
            className="sites-error"
            type="error"
            showIcon
            message="无法读取站点配置"
            description={error}
            action={
              <Button size="small" onClick={() => loadSites()}>
                重试
              </Button>
            }
          />
        ) : loading ? (
          <div className="sites-loading">
            <Spin />
          </div>
        ) : sites.length === 0 ? (
          <div className="sites-empty">
            <div className="sites-empty-visual" aria-hidden="true">
              <GlobalOutlined />
            </div>
            <h2>还没有配置站点</h2>
            <p>把日常使用的系统、文档和工具集中到这里，之后可以一键打开。</p>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={openCreate}
            >
              添加第一个站点
            </Button>
            <span className="sites-empty-hint">支持 http/https 地址</span>
          </div>
        ) : (
          <>
            <div className="sites-toolbar">
              <Input
                ref={searchInputRef}
                allowClear
                className="sites-search"
                prefix={<SearchOutlined />}
                placeholder="搜索站点、URL 或标签"
                aria-label="搜索站点"
                aria-keyshortcuts="Meta+K Control+K"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            {filteredSites.length === 0 ? (
              <div className="sites-no-results">
                <SearchOutlined />
                <h2>没有找到匹配站点</h2>
                <p>试试其他名称、URL 或标签。</p>
                <Button type="text" size="small" onClick={() => setSearch('')}>
                  清空搜索
                </Button>
              </div>
            ) : (
              <div className="sites-sections">
                {frequentSites.length > 0 ? (
                  <section className="sites-section">
                    <div className="sites-section-heading">
                      <h2>
                        <StarOutlined className="sites-section-icon is-favorite" />
                        常用站点
                      </h2>
                      <span className="sites-section-count">
                        共 {frequentSites.length} 个
                      </span>
                    </div>
                    <div className="sites-grid">
                      {frequentSites.map((site) => (
                        <SiteCard
                          key={`frequent-${site.id}`}
                          site={site}
                          onOpen={() => handleOpenSite(site)}
                          onEdit={() => openEdit(site)}
                          onRemove={() => handleRemove(site)}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="sites-section">
                  {frequentSites.length > 0 ? (
                    <div className="sites-section-heading">
                      <h2>
                        <AppstoreOutlined className="sites-section-icon" />
                        全部站点
                      </h2>
                      <span className="sites-section-count">
                        共 {filteredSites.length} 个
                      </span>
                    </div>
                  ) : null}
                  {canReorder ? (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragStart={handleDragStart}
                      onDragCancel={handleDragCancel}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={filteredSites.map((site) => site.id)}
                        strategy={rectSortingStrategy}
                      >
                        <div className="sites-grid">
                          {filteredSites.map((site) => (
                            <SortableSiteCard
                              key={site.id}
                              site={site}
                              onOpen={() => handleOpenSite(site)}
                              onEdit={() => openEdit(site)}
                              onRemove={() => handleRemove(site)}
                            />
                          ))}
                        </div>
                      </SortableContext>
                      <DragOverlay>
                        {activeSite ? (
                          <div
                            className="site-drag-overlay"
                            style={{ width: activeWidth ?? 280 }}
                          >
                            <SiteCard
                              site={activeSite}
                              onOpen={() => undefined}
                              onEdit={() => undefined}
                              onRemove={() => undefined}
                            />
                          </div>
                        ) : null}
                      </DragOverlay>
                    </DndContext>
                  ) : (
                    <div className="sites-grid">
                      {filteredSites.map((site) => (
                        <SiteCard
                          key={site.id}
                          site={site}
                          onOpen={() => handleOpenSite(site)}
                          onEdit={() => openEdit(site)}
                          onRemove={() => handleRemove(site)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </main>

      <Modal
        title={editingSite ? '编辑站点' : '新增站点'}
        open={modalOpen}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        forceRender
        onOk={() => handleSave()}
        onCancel={closeModal}
      >
        <Form form={form} layout="vertical" className="site-form">
          <Form.Item
            label="名称"
            name="name"
            rules={[
              { required: true, whitespace: true, message: '请输入站点名称' }
            ]}
          >
            <Input placeholder="例如：云效、监控平台" maxLength={60} />
          </Form.Item>
          <Form.Item
            label="URL"
            name="url"
            extra="仅支持 http/https 地址"
            rules={[
              { required: true, whitespace: true, message: '请输入站点 URL' },
              {
                validator: async (_rule, value: string) => {
                  if (!value?.trim()) return

                  try {
                    normalizeHttpUrl(value, '站点 URL')
                  } catch (urlError) {
                    throw new Error(getErrorMessage(urlError))
                  }
                }
              }
            ]}
          >
            <Input placeholder="https://example.com" spellCheck={false} />
          </Form.Item>
          <Form.Item label="标签" name="tags">
            <Select
              mode="tags"
              placeholder="选择或输入标签"
              options={DEFAULT_SITE_TAGS.map((tag) => ({
                value: tag,
                label: tag
              }))}
              tokenSeparators={[',', '，']}
              maxTagCount="responsive"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
