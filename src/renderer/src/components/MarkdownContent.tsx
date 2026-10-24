import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import LinkPreview from './LinkPreview'

interface MarkdownContentProps {
  /** Markdown 原文。 */
  content: string

  /** 额外样式类。 */
  className?: string
}

/**
 * 统一的 Markdown 渲染组件。
 * 关闭原始 HTML，链接统一交给应用内浏览器打开。
 */
export default function MarkdownContent({
  content,
  className
}: MarkdownContentProps): JSX.Element {
  return (
    <div className={`markdown-content${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href && /^https?:\/\//i.test(href)) {
              return <LinkPreview href={href} fallback={children} />
            }

            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
