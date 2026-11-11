import { useEffect, useRef, useState } from 'react'
import { App, Avatar, Form, Input, Modal, Select } from 'antd'
import type {
  LocalRequirementInput,
  LocalRequirementPerson,
  LocalRequirementPriority,
  LocalRequirementStatus
} from '../../../../types/local-requirements'
import type {
  MeegleRequirement,
  MeegleRequirementOwner
} from '../../../../types/requirements'
import { getErrorMessage } from '../../../../utils'

/** 可选的所属迭代。 */
export interface LocalRequirementVersionOption {
  /** 分组稳定键。 */
  key: string

  /** 展示名称。 */
  label: string

  /** Meegle 迭代 ID；未规划时为 null。 */
  iterationId: string | null

  /** 迭代名称；未规划时为 null。 */
  iterationName: string | null

  /** 迭代日期。 */
  iterationDate: string | null
}

interface LocalRequirementModalProps {
  /** 是否打开弹窗。 */
  open: boolean

  /** 当前编辑的需求；新建时为 null。 */
  initialRequirement: MeegleRequirement | null

  /** 可选择的迭代列表。 */
  versions: LocalRequirementVersionOption[]

  /** 可选择的产线列表。 */
  productLines: string[]

  /** 是否正在保存。 */
  saving: boolean

  /** 关闭弹窗。 */
  onCancel: () => void

  /** 提交表单。 */
  onSubmit: (input: LocalRequirementInput) => Promise<void> | void
}

interface LocalRequirementFormValues {
  name: string
  versionKey: string
  status: LocalRequirementStatus
  priority: LocalRequirementPriority | null
  productManagerKey: string | null | undefined
  productLine: string | null
  description: string
}

const getPersonKey = (person: MeegleRequirementOwner | null): string | null =>
  person?.userKey || person?.email || person?.name || null

const toLocalPerson = (
  person: MeegleRequirementOwner | null
): LocalRequirementPerson | null =>
  person
    ? {
        name: person.name,
        email: person.email,
        avatarUrl: person.avatarUrl,
        userKey: person.userKey
      }
    : null

const STATUS_OPTIONS: Array<{ value: LocalRequirementStatus; label: string }> = [
  { value: '待处理', label: '待处理' },
  { value: '进行中', label: '进行中' },
  { value: '待测试', label: '待测试' },
  { value: '已完成', label: '已完成' },
  { value: '已取消', label: '已取消' }
]

const PRIORITY_OPTIONS: Array<{
  value: LocalRequirementPriority
  label: string
}> = [
  { value: 'P0', label: 'P0' },
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' }
]

const getInitialVersionKey = (
  versions: LocalRequirementVersionOption[],
  requirement: MeegleRequirement | null
): string => {
  if (!requirement) return versions[0]?.key ?? 'unplanned'

  const matched = versions.find((version) => {
    if (requirement.iterationId) {
      return version.iterationId === requirement.iterationId
    }

    if (requirement.iterationName) {
      return version.iterationName === requirement.iterationName
    }

    return version.key === 'unplanned'
  })

  return matched?.key ?? versions[0]?.key ?? 'unplanned'
}

/**
 * 新建或编辑本地临时需求。
 */
export default function LocalRequirementModal({
  open,
  initialRequirement,
  versions,
  productLines,
  saving,
  onCancel,
  onSubmit
}: LocalRequirementModalProps): JSX.Element {
  const { message } = App.useApp()
  const [form] = Form.useForm<LocalRequirementFormValues>()
  const [personOptions, setPersonOptions] = useState<MeegleRequirementOwner[]>([])
  const [personSearching, setPersonSearching] = useState(false)
  const personSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const personSearchRequestRef = useRef(0)

  useEffect(() => {
    if (!open) return

    const initialPerson = initialRequirement?.productManagers[0] ?? null

    if (personSearchTimerRef.current) {
      clearTimeout(personSearchTimerRef.current)
      personSearchTimerRef.current = null
    }

    personSearchRequestRef.current += 1
    setPersonOptions(initialPerson ? [initialPerson] : [])
    setPersonSearching(false)
    form.setFieldsValue({
      name: initialRequirement?.name ?? '',
      versionKey: getInitialVersionKey(versions, initialRequirement),
      status:
        initialRequirement?.status === '进行中' ||
        initialRequirement?.status === '待测试' ||
        initialRequirement?.status === '已完成' ||
        initialRequirement?.status === '已取消'
          ? initialRequirement.status
          : '待处理',
      priority:
        initialRequirement?.priority === 'P0' ||
        initialRequirement?.priority === 'P1' ||
        initialRequirement?.priority === 'P2'
          ? initialRequirement.priority
          : null,
      productManagerKey: getPersonKey(initialPerson),
      productLine:
        initialRequirement?.productLines[
          initialRequirement.productLines.length - 1
        ] ?? null,
      description: initialRequirement?.description ?? ''
    })
  }, [form, initialRequirement, open, versions])

  useEffect(() => {
    if (open) return

    if (personSearchTimerRef.current) {
      clearTimeout(personSearchTimerRef.current)
      personSearchTimerRef.current = null
    }

    personSearchRequestRef.current += 1
    setPersonSearching(false)
  }, [open])

  useEffect(
    () => () => {
      if (personSearchTimerRef.current) {
        clearTimeout(personSearchTimerRef.current)
      }

      personSearchRequestRef.current += 1
    },
    []
  )

  /** 防抖搜索产品负责人。 */
  const handlePersonSearch = (keyword: string): void => {
    const query = keyword.trim()
    const requestId = personSearchRequestRef.current + 1

    personSearchRequestRef.current = requestId

    if (personSearchTimerRef.current) {
      clearTimeout(personSearchTimerRef.current)
      personSearchTimerRef.current = null
    }

    if (!query) {
      setPersonSearching(false)
      return
    }

    personSearchTimerRef.current = setTimeout(() => {
      personSearchTimerRef.current = null
      setPersonSearching(true)

      window.electron
        .searchRequirementUsers(query)
        .then((owners) => {
          if (personSearchRequestRef.current !== requestId) return

          setPersonOptions((current) => {
            const merged = new Map(
              current.flatMap((owner) => {
                const key = getPersonKey(owner)
                return key ? [[key, owner] as const] : []
              })
            )

            for (const owner of owners) {
              const key = getPersonKey(owner)
              if (key) merged.set(key, owner)
            }

            return Array.from(merged.values())
          })
        })
        .catch((error) => {
          if (personSearchRequestRef.current !== requestId) return
          message.error(getErrorMessage(error, '搜索产品失败'))
        })
        .finally(() => {
          if (personSearchRequestRef.current === requestId) {
            setPersonSearching(false)
          }
        })
    }, 300)
  }

  const handleSubmit = async (): Promise<void> => {
    const values = await form
      .validateFields()
      .catch(() => null)

    if (!values) return

    const version =
      versions.find((item) => item.key === values.versionKey) ??
      versions[0] ?? {
        key: 'unplanned',
        label: '未规划迭代',
        iterationId: null,
        iterationName: null,
        iterationDate: null
      }
    const productManager = values.productManagerKey
      ? personOptions.find(
          (person) => getPersonKey(person) === values.productManagerKey
        ) ?? initialRequirement?.productManagers[0] ?? null
      : null

    await onSubmit({
      name: values.name.trim(),
      description: values.description?.trim() || null,
      status: values.status,
      priority: values.priority ?? null,
      productManager: toLocalPerson(productManager),
      productLine: values.productLine ?? null,
      iterationId: version.iterationId,
      iterationName: version.iterationName,
      iterationDate: version.iterationDate
    })
  }

  return (
    <Modal
      open={open}
      title={initialRequirement ? '编辑临时需求' : '新建临时需求'}
      okText={initialRequirement ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => handleSubmit()}
      forceRender
    >
      <Form
        form={form}
        layout="vertical"
        className="local-requirement-form"
        disabled={saving}
      >
        <Form.Item
          label="需求名称"
          name="name"
          rules={[
            { required: true, whitespace: true, message: '请输入需求名称' },
            { max: 160, message: '需求名称不能超过 160 个字符' }
          ]}
        >
          <Input placeholder="例如：临时修复登录页样式" maxLength={160} />
        </Form.Item>

        <Form.Item
          label="所属版本"
          name="versionKey"
          rules={[{ required: true, message: '请选择所属版本' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={versions.map((version) => ({
              value: version.key,
              label: version.label
            }))}
            placeholder="选择现有迭代"
          />
        </Form.Item>

        <Form.Item label="产线" name="productLine">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="可选，选择产线"
            options={productLines.map((line) => ({
              value: line,
              label: line
            }))}
          />
        </Form.Item>

        <Form.Item label="产品" name="productManagerKey">
          <Select
            showSearch
            allowClear
            filterOption={false}
            placeholder="可选，搜索姓名或邮箱"
            loading={personSearching}
            onSearch={handlePersonSearch}
            notFoundContent={personSearching ? '搜索中...' : '未找到产品'}
            options={personOptions.flatMap((person) => {
              const key = getPersonKey(person)

              return key ? [{ value: key, label: person.name }] : []
            })}
            optionRender={(option) => {
              const person = personOptions.find(
                (item) => getPersonKey(item) === String(option.value)
              )

              if (!person) return option.label

              return (
                <span className="requirement-node-owner-option">
                  <Avatar size={24} src={person.avatarUrl ?? undefined}>
                    {person.name.slice(0, 1)}
                  </Avatar>
                  <span className="requirement-node-owner-option-copy">
                    <span className="requirement-node-owner-option-name">
                      {person.name}
                    </span>
                    {person.email ? (
                      <span className="requirement-node-owner-option-email">
                        {person.email}
                      </span>
                    ) : null}
                  </span>
                </span>
              )
            }}
            labelRender={(props) => {
              const person = personOptions.find(
                (item) => getPersonKey(item) === String(props.value)
              )

              if (!person) return props.label

              return (
                <span className="requirement-node-owner-tag-label">
                  <Avatar size={16} src={person.avatarUrl ?? undefined}>
                    {person.name.slice(0, 1)}
                  </Avatar>
                  <span>{person.name}</span>
                </span>
              )
            }}
          />
        </Form.Item>

        <Form.Item label="状态" name="status">
          <Select options={STATUS_OPTIONS} />
        </Form.Item>

        <Form.Item label="优先级" name="priority">
          <Select
            allowClear
            placeholder="未设置"
            options={PRIORITY_OPTIONS}
          />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input.TextArea
            rows={6}
            maxLength={8000}
            placeholder="补充临时需求的背景、目标或验收标准"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
