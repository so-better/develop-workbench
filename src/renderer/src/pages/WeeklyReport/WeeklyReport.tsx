import { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'
import {
  LinkOutlined,
  ReloadOutlined,
  SendOutlined
} from '@ant-design/icons'
import { Alert, App, Button, Empty, Skeleton, Tag, Tooltip } from 'antd'
import type { RichTextContent } from '../../../../types/rich-text'
import type {
  WeeklyReportField,
  WeeklyReportState
} from '../../../../types/weekly-report'
import { getErrorMessage, isRecord } from '../../../../utils'
import RichTextEditor from '../../components/RichTextEditor/RichTextEditor'
import RobotMark from '../../components/RobotMark/RobotMark'
import { useAiChatDialog } from '../../hooks/useAiChatDialog'

const toDraft = (field: WeeklyReportField): RichTextContent => ({
  html: field.html,
  text: field.text,
  delta: { ops: [] }
})

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** 把 AI 返回的纯文本转成富文本编辑器可回填的 HTML。 */
const textToHtml = (text: string): string => {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let listItems: string[] = []

  const flushParagraph = (): void => {
    if (!paragraph.length) return

    blocks.push(`<p>${paragraph.map(escapeHtml).join('<br>')}</p>`)
    paragraph = []
  }

  const flushList = (): void => {
    if (!listType || !listItems.length) return

    blocks.push(
      `<${listType}>${listItems
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')}</${listType}>`
    )
    listType = null
    listItems = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const unordered = /^[-*+]\s+(.*)$/.exec(trimmed)
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed)

    if (unordered || ordered) {
      flushParagraph()
      const nextType = unordered ? 'ul' : 'ol'

      if (listType !== nextType) {
        flushList()
        listType = nextType
      }

      listItems.push((unordered ?? ordered)?.[1] ?? '')
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()

  return blocks.join('')
}

/**
 * 飞书个人工作周报。
 * 使用内嵌浏览器登录态读取和提交 OA 汇报接口。
 */
export default function WeeklyReport(): JSX.Element {
  const { message, modal } = App.useApp()
  const { openAiDialog } = useAiChatDialog()
  const [state, setState] = useState<WeeklyReportState | null>(null)
  const [drafts, setDrafts] = useState<Record<string, RichTextContent>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (showLoading = true): Promise<void> => {
    if (showLoading) setLoading(true)

    setError(null)

    try {
      const next = await window.electron.getWeeklyReport()
      setState(next)
      setDrafts(
        Object.fromEntries(
          next.fields
            .filter((field) => field.component === 'text')
            .map((field) => [field.id, toDraft(field)])
        )
      )
    } catch (loadError) {
      setError(getErrorMessage(loadError, '周报加载失败'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const textFields =
    state?.fields.filter((field) => field.component === 'text') ?? []

  const reportUrl = state?.reportId
    ? `https://oa.feishu.cn/report/record/detail?reportId=${encodeURIComponent(
        state.reportId
      )}&editMode=true`
    : state
      ? `https://oa.feishu.cn/report/record/detail?ruleId=${encodeURIComponent(
          state.ruleId
        )}&editMode=true`
      : 'https://oa.feishu.cn/report/record/entry'

  const handleSubmit = (): void => {
    if (!state || submitting) return

    const missing = textFields.find(
      (field) => field.required && !(drafts[field.id]?.text ?? '').trim()
    )

    if (missing) {
      message.warning(`请填写「${missing.title}」`)
      return
    }

    modal.confirm({
      title: '提交飞书周报',
      content: `确认提交「${state.ruleName}」？提交后会按飞书汇报规则发送给汇报对象。`,
      okText: '提交',
      cancelText: '取消',
      onOk: async () => {
        setSubmitting(true)

        try {
          const next = await window.electron.submitWeeklyReport({
            ruleId: state.ruleId,
            fields: textFields.map((field) => {
              const draft = drafts[field.id]

              return {
                id: field.id,
                html: draft?.html ?? '',
                text: draft?.text ?? '',
                delta: draft?.delta ?? { ops: [] }
              }
            })
          })

          setState(next)
          setDrafts(
            Object.fromEntries(
              next.fields
                .filter((field) => field.component === 'text')
                .map((field) => [field.id, toDraft(field)])
            )
          )
          message.success('周报已提交到飞书')
        } catch (submitError) {
          message.error(getErrorMessage(submitError, '提交周报失败'))
          throw submitError
        } finally {
          setSubmitting(false)
        }
      }
    })
  }

  const applyGeneratedReport = (
    content: string,
    tools: import('../../../../types/ai').AiToolCall[]
  ): void => {
    const hasShellRead = tools.some(
      (tool) => tool.name === 'executeShell' && tool.state === 'result'
    )

    if (!hasShellRead) {
      throw new Error('AI 尚未通过 executeShell 读取工作数据，请先重新生成')
    }

    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')

    if (start < 0 || end <= start) {
      throw new Error('AI 返回内容不是有效的 JSON，无法回填周报')
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(content.slice(start, end + 1))
    } catch {
      throw new Error('AI 返回内容不是有效的 JSON，无法回填周报')
    }

    if (!isRecord(parsed)) {
      throw new Error('AI 返回内容格式不正确，无法回填周报')
    }

    const source = isRecord(parsed.fields) ? parsed.fields : parsed
    const updates: Array<{ id: string; text: string }> = []

    for (const field of textFields) {
      const value = source[field.id] ?? source[field.title]

      if (typeof value !== 'string' || !value.trim()) continue

      updates.push({ id: field.id, text: value.trim() })
    }

    if (!updates.length) {
      throw new Error('AI 返回内容没有匹配到周报字段')
    }

    setDrafts((current) => {
      const next = { ...current }

      for (const update of updates) {
        next[update.id] = {
          html: textToHtml(update.text),
          text: update.text,
          delta: { ops: [] }
        }
      }

      return next
    })
  }

  const handleGenerate = (): void => {
    if (!state || textFields.length === 0) return

    const fieldMeta = textFields
      .map(
        (field) =>
          `- ${field.id}: ${field.title}${field.required ? '（必填）' : ''}`
      )
      .join('\n')

    openAiDialog({
      title: 'AI 生成周报',
      autoStart: true,
      applyLabel: '回填周报',
      prompt: [
        '请使用 executeShell 直接调用本机 lark-cli / meegle，自行读取我本周的工作内容和负责的需求。',
        '需要时先用 --help / inspect 探查命令，不要假设 CLI 参数。',
        '读取范围包括本周有更新的需求、当前进行中的工作和必要的飞书数据。',
        '',
        '然后根据工具实际返回的数据生成本周周报。',
        '',
        '输出要求：',
        '- 只输出一个 JSON 对象，不要代码块、解释或额外字段。',
        '- JSON 的键必须使用下面提供的字段 id，值是纯文本。',
        '- 所有字段都要生成；没有依据时写“暂无可提供的信息”，不要编造。',
        '- 使用第一人称，内容具体，尽量包含结果、进度、风险和协作信息。',
        '- 本周工作按需求或项目归类，下周计划要可执行。',
        '- 如果 CLI 读取失败或数据不足，明确说明，不要用猜测补全。',
        '',
        '可回填字段：',
        fieldMeta
      ].join('\n'),
      onApplyResult: applyGeneratedReport
    })
  }

  return (
    <div className="weekly-report-page">
      <header className="weekly-report-header">
        <div className="weekly-report-header-main">
          <div className="weekly-report-heading">
            <span className="weekly-report-eyebrow">飞书汇报 / 个人工作周报</span>
            <div className="weekly-report-title-row">
              <h1>{state?.ruleName ?? '个人工作周报'}</h1>
              {state ? (
                <Tag
                  bordered={false}
                  color={state.submitted ? 'green' : 'blue'}
                  className="weekly-report-status"
                >
                  {state.submitted ? '本周已提交' : '待提交'}
                </Tag>
              ) : null}
            </div>
            <p>
              {state?.submitted
                ? '本周周报已提交，修改后可以重新提交。'
                : '填写本周工作内容，提交后会直接同步到飞书汇报。'}
            </p>
          </div>
        </div>

        <div className="weekly-report-header-actions">
          <Tooltip title={reportUrl}>
            <Button
              type="text"
              size="small"
              className="weekly-report-header-link"
              icon={<LinkOutlined />}
              onClick={() => window.electron.openEmbeddedBrowser(reportUrl)}
            >
              飞书周报
            </Button>
          </Tooltip>
          <Button
            type="text"
            size="small"
            className="weekly-report-header-refresh"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => load()}
          >
            刷新
          </Button>
        </div>
      </header>

      <main className="weekly-report-content">
        {error ? (
          <Alert
            className="weekly-report-error"
            type="error"
            showIcon
            message="无法读取飞书周报"
            description={error}
            action={
              <Button
                size="small"
                onClick={() =>
                  window.electron.openEmbeddedBrowser(
                    'https://oa.feishu.cn/report/record/entry'
                  )
                }
              >
                打开飞书周报
              </Button>
            }
          />
        ) : loading && !state ? (
          <div className="weekly-report-loading">
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : state ? (
          <section className="weekly-report-card">
            <div className="weekly-report-meta">
              <span>汇报规则：{state.ruleName}</span>
              <span>
                {state.submittedAt
                  ? `最近提交：${dayjs(state.submittedAt).format('YYYY-MM-DD HH:mm')}`
                  : '本周尚未提交'}
              </span>
            </div>

            {textFields.length > 0 ? (
              <div className="weekly-report-fields">
                {textFields.map((field) => (
                  <section className="weekly-report-field" key={field.id}>
                    <div className="weekly-report-field-heading">
                      <label>
                        {field.title}
                        {field.required ? <em>*</em> : null}
                      </label>
                      <span>
                        {(drafts[field.id]?.text ?? '').length} 字
                      </span>
                    </div>
                    <RichTextEditor
                      minHeight={field.title.includes('计划') ? 150 : 190}
                      value={drafts[field.id]?.html ?? ''}
                      placeholder={`填写${field.title}`}
                      onChange={(content) =>
                        setDrafts((current) => ({
                          ...current,
                          [field.id]: content
                        }))
                      }
                    />
                  </section>
                ))}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前周报没有可填写的文本字段"
              />
            )}

            <div className="weekly-report-submit-bar">
              <span>提交后会按飞书汇报规则通知对应汇报对象。</span>
              <div className="weekly-report-submit-actions">
                <Button
                  icon={<RobotMark />}
                  disabled={textFields.length === 0}
                  onClick={handleGenerate}
                >
                  AI 生成
                </Button>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={submitting}
                  disabled={textFields.length === 0}
                  onClick={handleSubmit}
                >
                  提交周报
                </Button>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  )
}
