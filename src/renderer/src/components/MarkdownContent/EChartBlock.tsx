import { useEffect, useRef, useState } from 'react'
import type { ECharts } from 'echarts'
import { useTheme } from '../../theme/ThemeProvider'

interface EChartBlockProps {
  optionText: string
}

/**
 * 兼容模型偶尔输出的非标准写法。
 * 正常情况下代码块内已经是纯 JSON。
 */
const parseOptionText = (text: string): Record<string, unknown> => {
  let source = text.replace(/^\uFEFF/, '').trim()
  source = source.replace(/^```(?:echarts|echart|chart|json)?\s*/i, '')
  source = source.replace(/\s*```$/, '')
  source = source.replace(/^(?:(?:const|let|var)\s+)?option\s*=\s*/i, '')
  source = source.replace(/;\s*$/, '').trim()

  const parsed = JSON.parse(source) as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ECharts option 必须是 JSON 对象')
  }

  const record = parsed as Record<string, unknown>

  if (
    record.option &&
    typeof record.option === 'object' &&
    !Array.isArray(record.option)
  ) {
    return record.option as Record<string, unknown>
  }

  return record
}

/** 渲染 ECharts JSON 配置，失败时显示错误信息。 */
export default function EChartBlock({
  optionText
}: EChartBlockProps): JSX.Element {
  const { isDark } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ECharts | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let observer: ResizeObserver | null = null

    const render = async (): Promise<void> => {
      try {
        const option = parseOptionText(optionText)
        const echarts = await import('echarts')

        if (!active || !containerRef.current) return

        chartRef.current?.dispose()
        const chart = echarts.init(
          containerRef.current,
          isDark ? 'dark' : undefined,
          { renderer: 'canvas' }
        )
        chart.setOption(
          { backgroundColor: 'transparent', ...option },
          { notMerge: true }
        )
        chartRef.current = chart
        setError(null)
        observer = new ResizeObserver(() => chart.resize())
        observer.observe(containerRef.current)
      } catch (renderError) {
        if (active) {
          setError(renderError instanceof Error ? renderError.message : '图表配置无效')
        }
      }
    }

    render()

    return () => {
      active = false
      observer?.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [isDark, optionText])

  if (error) {
    return <pre className="ai-diagram-error">{`ECharts 渲染失败：${error}`}</pre>
  }

  return <div ref={containerRef} className="ai-echart" />
}
