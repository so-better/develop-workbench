import { Button, Input } from 'antd'

interface ExecutablePathFieldProps {
  /** 输入框 id。 */
  id: string

  /** 字段标题。 */
  label: string

  /** 当前输入值。 */
  value: string

  /** 输入占位文案。 */
  placeholder: string

  /** 底部说明。 */
  help?: string

  /** 是否禁用输入和操作。 */
  disabled?: boolean

  /** 是否正在自动检测。 */
  detecting?: boolean

  /** 选择按钮文案。 */
  chooseLabel?: string

  /** 检测按钮文案。 */
  detectLabel?: string

  /** 输入变化。 */
  onChange: (value: string) => void

  /** 失焦或回车时保存。 */
  onSave: () => void

  /** 选择文件。 */
  onChoose: () => void

  /** 自动检测。 */
  onDetect: () => void
}

/**
 * 可执行文件路径输入控件。
 * 统一 Lark、Meegle、Git 和 IDE 的路径编辑与操作布局。
 */
export default function ExecutablePathField({
  id,
  label,
  value,
  placeholder,
  help,
  disabled = false,
  detecting = false,
  chooseLabel = '选择文件',
  detectLabel = '自动检测',
  onChange,
  onSave,
  onChoose,
  onDetect
}: ExecutablePathFieldProps): JSX.Element {
  return (
    <div className="lark-path-field">
      <label htmlFor={id}>{label}</label>
      <div className="lark-path-controls">
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onSave}
          onPressEnter={onSave}
        />
        <Button
          variant="filled"
          disabled={disabled || detecting}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onChoose}
        >
          {chooseLabel}
        </Button>
        <Button
          variant="filled"
          disabled={disabled}
          loading={detecting}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onDetect}
        >
          {detectLabel}
        </Button>
      </div>
      {help ? <p className="settings-help">{help}</p> : null}
    </div>
  )
}
