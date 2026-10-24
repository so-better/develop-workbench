import { useEffect, useRef } from 'react'
import { Spin } from 'antd'
import Editor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useTheme } from '../theme/ThemeProvider'
import '../monaco-setup'

export type CodeEditorLanguage =
  | 'json'
  | 'typescript'
  | 'ts'
  | 'javascript'
  | 'js'
  | 'xml'
  | 'html'
  | 'css'
  | 'scss'
  | 'less'
  | 'markdown'
  | 'yaml'
  | 'yml'
  | 'sql'
  | 'shell'
  | 'sh'
  | 'powershell'
  | 'plaintext'
  | 'text'

const LANGUAGE_ALIASES: Partial<Record<CodeEditorLanguage, string>> = {
  ts: 'typescript',
  js: 'javascript',
  yml: 'yaml',
  sh: 'shell',
  text: 'plaintext'
}

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language?: CodeEditorLanguage
  height?: number | string
  readOnly?: boolean
  className?: string
  options?: editor.IStandaloneEditorConstructionOptions
  onSave?: () => void
}

export default function CodeEditor({
  value,
  onChange,
  language = 'plaintext',
  height = 320,
  readOnly = false,
  className,
  options,
  onSave
}: CodeEditorProps): JSX.Element {
  const { isDark } = useTheme()
  const onSaveRef = useRef(onSave)
  const resolvedLanguage = LANGUAGE_ALIASES[language] ?? language

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const handleMount: OnMount = (editorInstance, monaco) => {
    editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => onSaveRef.current?.()
    )
  }

  return (
    <div
      className={`code-editor${className ? ` ${className}` : ''}`}
      style={{ height }}
    >
      <Editor
        value={value}
        language={resolvedLanguage}
        theme={isDark ? 'workbench-dark' : 'workbench-light'}
        height="100%"
        loading={
          <div className="code-editor-loading">
            <Spin size="small" />
          </div>
        }
        onMount={handleMount}
        onChange={(next) => onChange(next ?? '')}
        options={{
          readOnly,
          ariaLabel: '代码编辑器',
          fontFamily:
            '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 12.5,
          lineHeight: 20,
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: 'off',
          tabSize: 2,
          insertSpaces: true,
          formatOnPaste: true,
          formatOnType: true,
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          padding: { top: 10, bottom: 10 },
          renderLineHighlight: 'line',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            useShadows: false
          },
          stickyScroll: { enabled: false },
          smoothScrolling: true,
          contextmenu: true,
          ...options
        }}
      />
    </div>
  )
}
