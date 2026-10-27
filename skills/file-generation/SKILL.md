---
name: file-generation
description: 本地文件生成、命名和保存规范
keywords:
  - file
  - 文件
  - 生成
  - 导出
  - csv
  - markdown
  - html
---

# 文件生成

- 文本文件使用 saveLocalFile：Markdown、TXT、CSV、JSON、HTML、XML、YAML、SVG、日志，以及 Word(docx) 和 PDF。
- 生成 Word/PDF 时，saveLocalFile 的 content 使用 Markdown。
- 表格数据使用 saveExcel，rows 是二维字符串数组，首行作为表头。
- 演示文稿使用 savePowerPoint，提供标题和每页要点。
- 文件名要包含语义和正确扩展名，避免特殊字符和空格。
- 生成文件后，界面会提供下载按钮。
- 用户点击下载后可选择本机保存路径。
- 生成成功后告诉用户可以点击下载，不要编造本机路径，也不要提及应用内保存位置。
- 内容必须完整、可直接打开，不使用“待补充”或占位符。
