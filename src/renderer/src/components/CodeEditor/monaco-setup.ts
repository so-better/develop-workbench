import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

/**
 * Monaco 本地 worker 配置。
 * 使用 Vite 打包的 worker，避免运行时从 CDN 下载。
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') return new jsonWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }

    return new editorWorker()
  }
}

loader.config({ monaco })

// 使用应用配色覆盖 Monaco 默认主题。
monaco.editor.defineTheme('workbench-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#fbfcfe',
    'editor.foreground': '#172033',
    'editorGutter.background': '#fbfcfe',
    'editorLineNumber.foreground': '#98a2b3',
    'editorLineNumber.activeForeground': '#475467',
    'editorCursor.foreground': '#1677ff',
    'editor.selectionBackground': '#dbeafe',
    'editor.inactiveSelectionBackground': '#e8f2ff',
    'editor.lineHighlightBackground': '#f3f6fb',
    'editorIndentGuide.background1': '#e8edf5',
    'editorIndentGuide.activeBackground1': '#cbd5e1',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#e8edf5',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.border': '#e8edf5',
    'editorSuggestWidget.selectedBackground': '#eaf3ff',
    'editorHoverWidget.background': '#ffffff',
    'editorHoverWidget.border': '#e8edf5',
    'editorBracketMatch.background': '#eaf3ff',
    'editorBracketMatch.border': '#1677ff'
  }
})

monaco.editor.defineTheme('workbench-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#18191c',
    'editor.foreground': '#e6e7e9',
    'editorGutter.background': '#18191c',
    'editorLineNumber.foreground': '#6b7280',
    'editorLineNumber.activeForeground': '#d1d5db',
    'editorCursor.foreground': '#4096ff',
    'editor.selectionBackground': '#1f3b5c',
    'editor.inactiveSelectionBackground': '#1a2a40',
    'editor.lineHighlightBackground': '#222328',
    'editorIndentGuide.background1': '#2a2a2a',
    'editorIndentGuide.activeBackground1': '#404040',
    'editorWidget.background': '#26272c',
    'editorWidget.border': '#34363c',
    'editorSuggestWidget.background': '#26272c',
    'editorSuggestWidget.border': '#34363c',
    'editorSuggestWidget.selectedBackground': '#1f3b5c',
    'editorHoverWidget.background': '#26272c',
    'editorHoverWidget.border': '#34363c',
    'editorBracketMatch.background': '#1f3b5c',
    'editorBracketMatch.border': '#4096ff'
  }
})

// TypeScript / JavaScript 使用常见的前端编译配置。
monaco.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  moduleResolution:
    monaco.typescript.ModuleResolutionKind.NodeJs,
  jsx: monaco.typescript.JsxEmit.ReactJSX,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  skipLibCheck: true,
  strict: true,
  noEmit: true
})

monaco.typescript.javascriptDefaults.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.ESNext,
  moduleResolution:
    monaco.typescript.ModuleResolutionKind.NodeJs,
  jsx: monaco.typescript.JsxEmit.ReactJSX,
  allowJs: true,
  checkJs: true,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  noEmit: true
})

monaco.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  trailingCommas: 'error',
  schemas: []
})
