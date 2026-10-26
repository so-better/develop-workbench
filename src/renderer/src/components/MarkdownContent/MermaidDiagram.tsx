import { useEffect, useId, useRef, useState } from 'react'
import { useTheme } from '../../theme/ThemeProvider'

interface MermaidDiagramProps {
  chart: string
}

/** 渲染 Mermaid 图表，失败时回退为源码。 */
export default function MermaidDiagram({
  chart
}: MermaidDiagramProps): JSX.Element {
  const { isDark } = useTheme()
  const reactId = useId()
  const renderId = useRef(`mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const render = async (): Promise<void> => {
      try {
        const mermaid = (await import('mermaid')).default

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'default'
        })

        const result = await mermaid.render(renderId.current, chart)

        if (active) {
          setSvg(result.svg)
          setError(null)
        }
      } catch (renderError) {
        if (active) {
          setSvg('')
          setError(renderError instanceof Error ? renderError.message : '图表渲染失败')
        }
      }
    }

    render()

    return () => {
      active = false
    }
  }, [chart, isDark])

  if (error) {
    return <pre className="ai-diagram-error">{error}</pre>
  }

  if (!svg) {
    return <div className="ai-diagram-loading">正在渲染图表...</div>
  }

  return (
    <div
      className="ai-mermaid"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
