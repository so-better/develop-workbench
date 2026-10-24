import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import LinkPreview from './LinkPreview'
import MarkdownImage from './MarkdownImage'

/**
 * 飞书导出的图片地址可能包含换行，导致 Markdown 图片语法失效。
 * 只处理确实跨行的图片地址，避免影响代码块中的示例。
 */
const normalizeMarkdownImages = (content: string): string =>
  content.replace(
    /(!\[[^\]]*\]\()([\s\S]*?)\)/g,
    (match, prefix: string, destination: string) => {
      if (!/[\r\n]/.test(destination)) return match

      return `${prefix}${destination.replace(/\s*[\r\n]+\s*/g, '')})`
    }
  )

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
          },
          img: ({ src, alt, title }) => (
            <MarkdownImage src={src} alt={alt} title={title} />
          )
        }}
      >
        {normalizeMarkdownImages(content)}
      </ReactMarkdown>
    </div>
  )
}
