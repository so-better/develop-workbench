import { useState } from 'react'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'
import { App } from 'antd'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useTheme } from '../../theme/ThemeProvider'

interface CodeBlockProps {
  code: string
  language: string
}

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  text: 'text',
  plaintext: 'text'
}

/** 带复制按钮的代码块。 */
export default function CodeBlock({
  code,
  language
}: CodeBlockProps): JSX.Element {
  const { message } = App.useApp()
  const { isDark } = useTheme()
  const [copied, setCopied] = useState(false)
  const resolvedLanguage = LANGUAGE_ALIASES[language] ?? (language || 'text')

  const handleCopy = async (): Promise<void> => {
    try {
      await window.electron.copyText(code)
      setCopied(true)
      message.success('代码已复制')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      message.error('复制失败')
    }
  }

  return (
    <div className="ai-code-block">
      <div className="ai-code-block-toolbar">
        <span>{resolvedLanguage}</span>
        <button
          type="button"
          className="ai-code-block-copy"
          onClick={handleCopy}
          aria-label="复制代码"
        >
          {copied ? <CheckOutlined /> : <CopyOutlined />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <SyntaxHighlighter
        language={resolvedLanguage}
        style={isDark ? oneDark : oneLight}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '10px 12px',
          fontSize: '12px',
          lineHeight: 1.6,
          background: isDark ? '#18191c' : '#fbfcfe'
        }}
        codeTagProps={{
          style: {
            fontFamily:
              '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace'
          }
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
