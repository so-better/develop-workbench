import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  HolderOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
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
  Tag,
  Tooltip
} from 'antd'
import type { InputRef } from 'antd'
import type { SiteEnv, SiteInput, SiteLink } from '../../../../types/sites'
import RobotMark from '../../components/RobotMark/RobotMark'
import { useAiChatDialog } from '../../hooks/useAiChatDialog'
import { getErrorMessage, normalizeHttpUrl } from '../../../../utils'

interface SiteFormValues {
  name: string
  url: string
  tags?: string[]
  env?: SiteEnv | null
}

const SITE_TAG_COLORS: Record<string, string> = {
  飞书文档: '#2f54eb',
  飞书表格: '#13c2c2',
  业务系统: '#079455',
  技术平台: '#d48806',
  开发工具: '#1677ff',
  调试工具: '#722ed1',
  'CI/CD': '#d4380d',
  监控告警: '#d92d20',
  数据平台: '#d46b08',
  外部工具: '#c41d7f'
}

const SITE_ENV_OPTIONS: Array<{ value: SiteEnv; label: string }> = [
  { value: 'prod', label: '生产（prod）' },
  { value: 'test', label: '测试（test）' },
  { value: 'staging', label: '预发（staging）' },
  { value: 'dev', label: '开发（dev）' },
  { value: 'gray', label: '灰度（gray）' }
]

const SITE_ENV_TAG_COLORS: Record<SiteEnv, string> = {
  prod: '#1677ff',
  test: '#079455',
  staging: '#dc6803',
  dev: '#7c3aed',
  gray: '#667085'
}

const DEFAULT_SITE_TAGS = [
  '飞书文档',
  '飞书表格',
  '业务系统',
  '技术平台',
  '开发工具',
  '调试工具',
  'CI/CD',
  '监控告警',
  '数据平台',
  '外部工具'
]

const DEFAULT_SITE_THEME_COLOR = '#1677ff'

const getSiteThemeColor = (site: SiteLink): string => {
  for (const tag of site.tags) {
    const color = SITE_TAG_COLORS[tag]

    if (color) return color
  }

  return DEFAULT_SITE_THEME_COLOR
}

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
  const accent = getSiteThemeColor(site)

  return (
    <article
      className="site-card"
      style={{ '--site-accent': accent } as CSSProperties}
    >
      <span className="site-card-accent" aria-hidden="true" />
      <button
        type="button"
        className="site-card-main"
        title={`打开 ${site.name}`}
        onClick={onOpen}
      >
        <span className="site-card-copy">
          <span className="site-card-title">
            {site.env ? (
              <Tooltip title={`环境：${site.env}`}>
                <span
                  className="site-env-badge"
                  style={
                    {
                      '--site-env-color': SITE_ENV_TAG_COLORS[site.env],
                      borderColor: `${SITE_ENV_TAG_COLORS[site.env]}55`,
                      backgroundColor: `${SITE_ENV_TAG_COLORS[site.env]}12`
                    } as CSSProperties
                  }
                >
                  {site.env.toUpperCase()}
                </span>
              </Tooltip>
            ) : null}
            <Tooltip title={site.name}>
              <strong>{site.name}</strong>
            </Tooltip>
            <LinkOutlined className="site-card-link-icon" />
          </span>
          {site.tags.length > 0 ? (
            <span className="site-card-tags">
              {site.tags.map((tag) => (
                <Tag key={tag} color={SITE_TAG_COLORS[tag]}>
                  {tag}
                </Tag>
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
    </article >
  )
}

interface SortableSiteCardProps extends Omit<SiteCardProps, 'dragHandle'> { }

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
  const { openAiDialog } = useAiChatDialog()
  const [form] = Form.useForm<SiteFormValues>()
  const [sites, setSites] = useState<SiteLink[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSite, setEditingSite] = useState<SiteLink | null>(null)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
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

  const siteLoadVersion = useRef(0)
  const loadSites = useCallback(async (showLoading = true): Promise<void> => {
    const version = ++siteLoadVersion.current
    if (showLoading) setLoading(true)

    setError(null)

    try {
      const state = await window.electron.getSiteState()
      if (version !== siteLoadVersion.current) return
      setSites(state.sites)
    } catch (loadError) {
      if (version !== siteLoadVersion.current) return
      setError(getErrorMessage(loadError, '站点加载失败'))
    } finally {
      if (version === siteLoadVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSites()
    return () => { siteLoadVersion.current += 1 }
  }, [loadSites])

  useEffect(() => {
    const handleSitesChanged = (): void => {
      loadSites(false)
    }

    window.addEventListener('sites:changed', handleSitesChanged)

    return () => window.removeEventListener('sites:changed', handleSitesChanged)
  }, [loadSites])

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
      [site.name, site.url, site.tags.join(' '), site.env ?? ''].some((value) =>
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

    window.electron
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
      tags: [],
      env: null
    })
    setModalOpen(true)
  }

  const openEdit = (site: SiteLink): void => {
    setEditingSite(site)
    form.setFieldsValue({
      name: site.name,
      url: site.url,
      tags: site.tags,
      env: site.env
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
      tags: values.tags ?? [],
      env: values.env ?? null
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

  const handleRefreshSites = async (): Promise<void> => {
    setRefreshing(true)

    try {
      await loadSites(false)
    } finally {
      setRefreshing(false)
    }
  }

  const handleAiAnalyze = (): void => {
    openAiDialog({
      title: 'AI 站点优化建议',
      autoStart: true,
      prompt: [
        '请先调用 listSites 工具读取我保存的全部站点。',
        '如果只凭站点列表无法判断当前业务场景，可以调用 getWeeklyWorkItems 获取本周需求和已解决缺陷作为线索；不要为站点分析逐条调用 executeShell。',
        '',
        '分析目标：',
        '- 结合飞书、Meegle、业务系统、代码仓库、CI/CD、测试、监控告警、数据平台等研发场景，判断现有站点覆盖是否合理。',
        '- 推荐值得补充的站点或工具入口，并说明对应的工作场景和用途。',
        '- 对已有站点提出可执行的优化建议，而不是简单罗列。',
        '',
        '请按以下结构输出：',
        '1. 当前站点概览：按用途和环境归类，指出覆盖较完整的场景和明显缺失的场景。',
        '2. 建议新增站点：按场景分组，每项给出建议名称、用途、建议标签、环境；只有能从已知信息确认 URL 时才给具体链接，否则写“需补充链接”，不要编造。',
        '3. 已有站点优化：优先列出重复、命名不清晰、标签不准确、环境缺失或 URL 异常的站点，并给出具体修改建议。',
        '4. 标签体系建议：尽量沿用现有标签；确实需要新增标签时说明原因，不要制造过多同义标签。',
        '5. 排序与常用入口建议：结合打开次数和最近打开时间，给出常用站点和排序优化建议。',
        '6. 下一步：按优先级列出最值得先处理的 3-5 项。',
        '',
        '分析完成后，请先询问我是否需要执行新增、删除或更新站点，并列出建议的变更。',
        '不要直接调用 addSite、updateSite 或 deleteSite。只有我明确确认后，才根据我的确认调用对应工具。',
        '没有确认时只输出分析结果和建议。'
      ].join('\n')
    })
  }

  return (
    <div className="sites-page">
      <header className="sites-header">
        <div className="sites-heading">
          <span className="sites-eyebrow">快捷入口 / 站点</span>
          <h1>站点</h1>
          <p>把日常使用的系统、文档和工具集中到一个地方。</p>
        </div>
      </header>

      <main className="sites-content">
        {error ? (
          <Alert
            className="sites-error"
            type={sites.length > 0 ? 'warning' : 'error'}
            showIcon
            message={
              sites.length > 0
                ? '刷新站点失败，当前展示上次同步结果'
                : '无法读取站点配置'
            }
            description={error}
            action={
              <Button size="small" onClick={() => loadSites()}>
                重试
              </Button>
            }
          />
        ) : null}

        {loading && sites.length === 0 ? (
          <div className="sites-loading">
            <Spin />
          </div>
        ) : sites.length === 0 ? (
          error ? null : <div className="sites-empty">
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
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="sites-toolbar-actions">
                <Button
                  icon={<ReloadOutlined />}
                  loading={refreshing}
                  onClick={() => handleRefreshSites()}
                >
                  刷新
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreate}
                >
                  新增站点
                </Button>
                <Button
                  type="primary"
                  ghost
                  icon={<RobotMark />}
                  onClick={handleAiAnalyze}
                >
                  AI 优化建议
                </Button>
              </div>
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
          <Form.Item
            label="环境"
            name="env"
            extra="不设置表示不区分环境"
          >
            <Select
              allowClear
              placeholder="不区分环境"
              options={SITE_ENV_OPTIONS}
            />
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
