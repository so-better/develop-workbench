import { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'
import {
  ArrowLeftOutlined,
  LinkOutlined,
  ReloadOutlined,
  SendOutlined
} from '@ant-design/icons'
import { Alert, App, Button, Empty, Skeleton, Tag, Tooltip } from 'antd'
import type { RichTextContent } from '../../../types/rich-text'
import type {
  WeeklyReportField,
  WeeklyReportState
} from '../../../types/weekly-report'
import RichTextEditor from './RichTextEditor'

interface WeeklyReportProps {
  onBack: () => void
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '周报加载失败'

const toDraft = (field: WeeklyReportField): RichTextContent => ({
  html: field.html,
  text: field.text,
  delta: { ops: [] }
})

/**
 * 飞书个人工作周报。
 * 使用内嵌浏览器登录态读取和提交 OA 汇报接口。
 */
export default function WeeklyReport({
  onBack
}: WeeklyReportProps): JSX.Element {
  const { message, modal } = App.useApp()
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
      setError(getErrorMessage(loadError))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
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
          message.error(getErrorMessage(submitError))
          throw submitError
        } finally {
          setSubmitting(false)
        }
      }
    })
  }

  return (
    <div className="weekly-report-page">
      <header className="weekly-report-header">
        <div className="weekly-report-header-main">
          <Button
            type="text"
            size="small"
            className="weekly-report-back"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
          >
            返回需求
          </Button>

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
              onClick={() => void window.electron.openEmbeddedBrowser(reportUrl)}
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
            onClick={() => void load()}
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
                  void window.electron.openEmbeddedBrowser(
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
          </section>
        ) : null}
      </main>
    </div>
  )
}
