import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Alert, Button, Form, Input, Modal, Popconfirm, Spin, Tooltip, theme } from 'antd'
import { DeleteOutlined, EditOutlined, LinkOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { RequirementLink, RequirementLinkInput, RequirementLinkScope } from '../../../../types/requirement-links'
import { normalizeRequirementLinkUrl } from '../../../../types/requirement-links'
import { getErrorMessage } from '../../../../utils'
import { extractRequirementLinks } from './extract-links'
import './requirement-links.css'

interface Props extends RequirementLinkScope {
  description: string | null
  documentUrl: string | null
}

/**
 * 自动发现和手动添加共用一个列表，主进程负责合并与持久化。
 * 父组件以空间和需求作为 key，切换需求时重新挂载，隔离列表和编辑表单状态。
 */
export default function RequirementLinks({ projectKey, requirementId, description, documentUrl }: Props): JSX.Element {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const [links, setLinks] = useState<RequirementLink[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState<RequirementLink | 'new' | null>(null)
  const [form] = Form.useForm<RequirementLinkInput>()
  // 扫描与人工操作共享序号，仅让最新请求更新列表，防止旧响应覆盖新结果。
  const revision = useRef(0)
  const alive = useRef(true)
  // ref 同步加锁，覆盖 React 更新 saving 前连续点击提交的时间窗口。
  const busy = useRef(false)
  // 仅显式点击扫描时恢复排除的地址；后续自动刷新和错误重试不沿用此标记。
  const restoreOnScan = useRef(false)
  const scope = useMemo(() => ({ projectKey, requirementId }), [projectKey, requirementId])
  // 手动扫描与失败重试也重新解析当前内容，不请求远端需求或链接目标。
  const discovered = useMemo(() => extractRequirementLinks(description, documentUrl), [description, documentUrl, retry])

  useEffect(() => {
    alive.current = true
    // IPC 可能在切换需求后才完成；卸载时同时失效请求序号和组件存活标记。
    return () => { alive.current = false; revision.current++ }
  }, [])

  useEffect(() => {
    const request = ++revision.current
    setLoading(true)
    // scan 同时返回本地已有链接，描述为空时也能恢复手动添加的记录。
    const restoreDeleted = restoreOnScan.current
    restoreOnScan.current = false
    window.electron.scanRequirementLinks(scope, discovered, restoreDeleted).then((result) => {
      if (alive.current && revision.current === request) { setLinks(result); setError('') }
    }).catch((reason) => {
      if (alive.current && revision.current === request) setError(getErrorMessage(reason))
    }).finally(() => {
      if (alive.current && revision.current === request) setLoading(false)
    })
  }, [scope, discovered, retry])

  /** 等待落盘成功再更新列表、关闭表单，失败时保留输入供用户重试。 */
  const mutate = async (operation: () => Promise<RequirementLink[]>): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    const request = ++revision.current
    // 保存接替列表请求后，旧扫描已失效；立即结束它的加载态，失败也不会卡住。
    setLoading(false)
    try {
      const result = await operation()
      if (alive.current) {
        if (revision.current === request) { setLinks(result); setError(''); setLoading(false) }
        setEditing(null)
      }
    } catch (reason) {
      if (alive.current) message.error(getErrorMessage(reason))
    } finally {
      busy.current = false
      if (alive.current) setSaving(false)
    }
  }
  const handleSave = (link: RequirementLinkInput): Promise<void> => {
    if (!editing) return Promise.resolve()
    return mutate(() => editing === 'new'
      ? window.electron.addRequirementLink(scope, link)
      : window.electron.updateRequirementLink(scope, editing.id, link))
  }
  const handleRemove = (id: string): Promise<void> =>
    mutate(() => window.electron.removeRequirementLink(scope, id))

  const openEditor = (link: RequirementLink | 'new'): void => {
    form.setFieldsValue(link === 'new' ? { name: '', url: '' } : link)
    setEditing(link)
  }
  const openLink = (url: string): void => {
    void window.electron.openEmbeddedBrowser(url).then((result) => {
      if (result === false) message.error('无法打开该链接')
    }).catch((reason) => message.error(getErrorMessage(reason)))
  }

  return (
    <section className="requirement-repo-section requirement-links-section">
      <div className="requirement-repo-heading">
        <div className="requirement-repo-heading-title"><h2>相关链接</h2><span className="requirement-repo-count">{links.length} 个链接</span></div>
        <div className="requirement-repo-heading-actions">
          {/* 保持文字按钮形态，仅设置语义色；禁用时沿用组件默认颜色。 */}
            <Tooltip title="重新扫描当前需求内容，恢复其中已删除的链接">
              <Button type="text" style={{ color: loading || saving ? undefined : token.colorSuccess }} size="small" icon={<ReloadOutlined />} loading={loading} disabled={loading || saving} onClick={() => { restoreOnScan.current = true; setRetry((value) => value + 1) }}>自动扫描</Button>
            </Tooltip>
          <Button type="text" style={{ color: loading || saving || error ? undefined : token.colorPrimary }} size="small" icon={<PlusOutlined />} disabled={loading || saving || !!error} onClick={() => openEditor('new')}>添加链接</Button>
        </div>
      </div>
      {error ? <Alert type="error" showIcon message="相关链接读取失败" description={error} action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>重试</Button>} /> : null}
      {loading ? <Spin size="small" /> : null}
      {!loading && !error && !links.length ? <p className="requirement-links-empty">暂无相关链接</p> : null}
      <ul className="requirement-links-list">
        {links.map((link) => (
          <li key={link.id} className="requirement-links-row">
            <a className="requirement-links-target" href={link.url} title={link.url} onClick={(event) => { event.preventDefault(); openLink(link.url) }}>
              <span className="requirement-links-icon" aria-hidden="true"><LinkOutlined /></span>
              <span className="requirement-links-text">
                <span className="requirement-links-name">{link.name}</span>
                {/* 仅精简显示，打开和悬停提示仍使用完整地址。 */}
                <span className="requirement-links-url">{link.url.replace(/^https?:\/\//i, '')}</span>
              </span>
            </a>
            <div className="requirement-links-actions">
              <Tooltip title="编辑链接">
                <Button type="text" size="small" aria-label={`编辑 ${link.name}`} icon={<EditOutlined />} disabled={loading || saving || !!error} onClick={() => openEditor(link)} />
              </Tooltip>
              <Popconfirm title="删除这个链接？" onConfirm={() => handleRemove(link.id)} disabled={loading || saving || !!error}>
                <Tooltip title="删除链接">
                  <Button type="text" size="small" danger aria-label={`删除 ${link.name}`} icon={<DeleteOutlined />} disabled={loading || saving || !!error} />
                </Tooltip>
              </Popconfirm>
            </div>
          </li>
        ))}
      </ul>
      <Modal title={editing === 'new' ? '添加链接' : '编辑链接'} open={editing !== null} confirmLoading={saving} closable={!saving} maskClosable={!saving} keyboard={!saving} cancelButtonProps={{ disabled: saving }} onCancel={() => setEditing(null)} onOk={() => form.submit()} okText="保存" cancelText="取消">
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: '请输入链接名称' }, { max: 200 }]}><Input placeholder="请输入链接名称，如接口文档、测试环境" maxLength={200} autoFocus /></Form.Item>
          <Form.Item name="url" label="地址" rules={[{ required: true, message: '请输入链接地址' }, { validator: async (_rule, value: string) => { if (value) { try { normalizeRequirementLinkUrl(value) } catch { throw new Error('请输入有效的 HTTP 或 HTTPS 链接') } } } }, { max: 8192 }]}><Input placeholder="https://" /></Form.Item>
        </Form>
      </Modal>
    </section>
  )
}
