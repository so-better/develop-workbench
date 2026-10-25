import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip
} from 'antd'
import type { TableProps } from 'antd'
import {
  DeleteOutlined,
  CopyOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { Repository, RepositoryState } from '../../../../types/repository'

interface CloneFormValues {
  url: string
  directoryName?: string
}

/**
 * 代码仓库配置。
 * 数据存储在应用 userData 目录，本地代码目录不会被删除或移动。
 */
export default function RepositorySettings(): JSX.Element {
  const { message } = App.useApp()
  const [state, setState] = useState<RepositoryState | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectingRoot, setSelectingRoot] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [cloneLogs, setCloneLogs] = useState<string[]>([])
  const [cloneProgress, setCloneProgress] = useState<number | null>(null)
  const [cancelRequesting, setCancelRequesting] = useState(false)
  const [cloneForm] = Form.useForm<CloneFormValues>()
  const cloneLogRef = useRef<HTMLDivElement>(null)
  const cancelRequestedRef = useRef(false)

  /**
   * 读取仓库根目录和仓库列表。
   */
  const loadState = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setLoading(true)

      try {
        setState(await window.electron.refreshRootRepositories())
      } catch {
        if (!silent) message.error('读取代码仓库配置失败')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [message]
  )

  useEffect(() => {
    loadState()

    const handleWindowFocus = (): void => {
      loadState(true)
    }

    window.addEventListener('focus', handleWindowFocus)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [loadState])

  useEffect(() => {
    const unsubscribeProgress = window.electron.onRepositoryCloneProgress((progress) => {
      setCloneProgress(progress.percent)
      setCloneLogs((current) => [...current, progress.message].slice(-80))
    })
    const unsubscribeChanged = window.electron.onRepositoriesChanged((next) => {
      setState(next)
    })

    return () => {
      unsubscribeProgress()
      unsubscribeChanged()
    }
  }, [])

  useEffect(() => {
    if (!cloneLogRef.current) return

    cloneLogRef.current.scrollTop = cloneLogRef.current.scrollHeight
  }, [cloneLogs])

  const root = state?.root ?? null
  const filteredRepositories = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const repositories = state?.repositories ?? []

    if (!keyword) return repositories

    return repositories.filter(
      (repository) =>
        repository.name.toLowerCase().includes(keyword) ||
        repository.localPath.toLowerCase().includes(keyword) ||
        repository.remoteUrl?.toLowerCase().includes(keyword)
    )
  }, [query, state])

  /**
   * 设置代码根目录。
   */
  const handleSelectRoot = async (): Promise<void> => {
    setSelectingRoot(true)

    try {
      const selectedPath = await window.electron.selectDirectory('选择代码根目录', root ?? undefined)

      if (!selectedPath) return

      setState(await window.electron.setRepositoryRoot(selectedPath))
      message.success('代码根目录已保存并完成扫描')
    } catch {
      message.error('保存代码根目录失败')
    } finally {
      setSelectingRoot(false)
    }
  }

  /**
   * 清除代码根目录，不删除仓库和本地文件。
   */
  const handleClearRoot = async (): Promise<void> => {
    try {
      setState(await window.electron.clearRepositoryRoot())
      message.success('代码根目录已清除')
    } catch {
      message.error('清除代码根目录失败')
    }
  }

  /**
   * 打开 Git 克隆弹窗。
   */
  const openClone = (): void => {
    if (!root) {
      message.warning('请先选择代码根目录')
      return
    }

    cloneForm.setFieldsValue({
      url: '',
      directoryName: ''
    })
    setCloneLogs([])
    setCloneProgress(null)
    setCancelRequesting(false)
    cancelRequestedRef.current = false
    setCloneOpen(true)
  }

  /**
   * 将 Git 仓库克隆到配置的根目录。
   */
  const handleClone = async (): Promise<void> => {
    let values: CloneFormValues

    try {
      values = await cloneForm.validateFields()
    } catch {
      return
    }

    setCloning(true)
    setCloneLogs([])
    setCloneProgress(0)
    setCancelRequesting(false)
    cancelRequestedRef.current = false

    try {
      setState(await window.electron.cloneRepository(values))
      setCloneOpen(false)
      cloneForm.resetFields()
      message.success('仓库已克隆')
    } catch {
      if (cancelRequestedRef.current) {
        message.info('已取消克隆')
      } else {
        message.error('克隆仓库失败，请检查 Git 地址、权限和目录')
      }
    } finally {
      setCloning(false)
      setCancelRequesting(false)
    }
  }

  /**
   * 请求主进程终止当前 Git 克隆进程。
   */
  const handleCancelClone = async (): Promise<void> => {
    cancelRequestedRef.current = true
    setCancelRequesting(true)

    try {
      await window.electron.cancelRepositoryClone()
    } catch {
      cancelRequestedRef.current = false
      setCancelRequesting(false)
      message.error('取消克隆失败')
    }
  }

  /**
   * 切换仓库是否接入轻舟。
   */
  const handleQingzhouChange = async (repository: Repository, checked: boolean): Promise<void> => {
    setUpdatingId(repository.id)

    try {
      setState(
        await window.electron.updateRepository(repository.id, {
          qingzhouEnabled: checked
        })
      )
      message.success(checked ? '已标记为接入轻舟' : '已取消轻舟接入')
    } catch {
      message.error('更新仓库配置失败')
    } finally {
      setUpdatingId(null)
    }
  }

  /**
   * 移除仓库元数据，不删除本地代码。
   */
  const handleRemove = async (repositoryId: string): Promise<void> => {
    setDeletingId(repositoryId)

    try {
      setState(await window.electron.removeRepository(repositoryId))
      message.success('仓库已移除，本地文件未删除')
    } catch {
      message.error('移除仓库失败')
    } finally {
      setDeletingId(null)
    }
  }

  /**
   * 复制分支名称到系统剪贴板。
   */
  const handleCopyBranch = async (branch: string): Promise<void> => {
    try {
      await window.electron.copyText(branch)
      message.success('分支名已复制')
    } catch {
      message.error('复制失败')
    }
  }

  /**
   * 渲染可省略、可悬浮查看、可复制的分支单元格。
   */
  const renderBranch = (branch: string | null): JSX.Element | string => {
    if (!branch) return '-'

    return (
      <div className="repository-branch-cell">
        <Tooltip title={branch}>
          <span className="repository-branch-text">{branch}</span>
        </Tooltip>
        <Button
          type="text"
          size="small"
          className="repository-copy-button"
          icon={<CopyOutlined />}
          aria-label={`复制分支 ${branch}`}
          title="复制分支名"
          onClick={() => handleCopyBranch(branch)}
        />
      </div>
    )
  }

  const columns: TableProps<Repository>['columns'] = [
    {
      title: '仓库',
      dataIndex: 'name',
      key: 'name',
      width: 320,
      fixed: 'left',
      render: (_, repository) => (
        <div className="repository-name-cell">
          <strong>{repository.name}</strong>
          <div className="repository-path-line">
            <span className="repository-path-text" title={repository.localPath}>
              {repository.localPath}
            </span>
            {!repository.available ? (
              <Tag color="red" bordered={false}>
                路径不存在
              </Tag>
            ) : null}
          </div>
        </div>
      )
    },
    {
      title: '主分支',
      dataIndex: 'defaultBranch',
      key: 'defaultBranch',
      width: 120,
      render: (branch: string | null) => renderBranch(branch)
    },
    {
      title: '当前分支',
      dataIndex: 'currentBranch',
      key: 'currentBranch',
      width: 'clamp(120px, 15vw, 200px)',
      render: (branch: string | null) => renderBranch(branch)
    },
    {
      title: '轻舟',
      dataIndex: 'qingzhouEnabled',
      key: 'qingzhouEnabled',
      width: 80,
      render: (_, repository) => (
        <Switch
          size="small"
          checked={repository.qingzhouEnabled}
          loading={updatingId === repository.id}
          onChange={(checked) => handleQingzhouChange(repository, checked)}
        />
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 70,
      fixed: 'right',
      render: (_, repository) => (
        <Popconfirm
          title="移除这个仓库？"
          description="只移除配置，不会删除本地代码。"
          okText="移除"
          cancelText="取消"
          onConfirm={() => handleRemove(repository.id)}
        >
          <Button
            type="text"
            size="small"
            danger
            loading={deletingId === repository.id}
            icon={<DeleteOutlined />}
            aria-label={`移除 ${repository.name}`}
          />
        </Popconfirm>
      )
    }
  ]

  if (loading) {
    return (
      <div className="settings-loading">
        <Spin />
      </div>
    )
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>代码仓库</h3>
        <p>维护本地代码仓库、根目录和轻舟接入标记。</p>
      </div>

      <div className="repository-section">
        <label className="repository-field-label" htmlFor="repository-root">
          代码根目录
        </label>
        <div className="repository-path-row">
          <Input
            id="repository-root"
            value={root ?? ''}
            readOnly
            placeholder="请选择代码根目录"
          />
          {root ? (
            <Popconfirm
              title="更换代码根目录？"
              description="更换后会清空当前所有仓库配置，但不会删除本地代码。"
              okText="继续"
              cancelText="取消"
              onConfirm={() => handleSelectRoot()}
            >
              <Button variant="filled" icon={<FolderOpenOutlined />} loading={selectingRoot}>
                选择目录
              </Button>
            </Popconfirm>
          ) : (
            <Button
              type="primary"
              icon={<FolderOpenOutlined />}
              loading={selectingRoot}
              onClick={() => handleSelectRoot()}
            >
              选择目录
            </Button>
          )}
          {root ? (
            <Popconfirm
              title="清除代码根目录？"
              description="会同时清除所有仓库配置，但不会删除本地代码。"
              okText="清除"
              cancelText="取消"
              onConfirm={() => handleClearRoot()}
            >
              <Button danger>清除</Button>
            </Popconfirm>
          ) : null}
        </div>
        <p className="settings-help">扫描和克隆都会使用这个目录。</p>
      </div>

      <div className="repository-toolbar">
        <Input
          className="repository-search"
          prefix={<SearchOutlined />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索仓库名称或路径"
          allowClear
        />
        <div className="repository-toolbar-actions">
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            disabled={!root}
            onClick={openClone}
          >
            从 Git 克隆
          </Button>
        </div>
      </div>

      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={filteredRepositories}
        pagination={false}
        scroll={{ x: 900, y: 320 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={root ? '根目录下还没有扫描到仓库' : '还没有选择代码根目录'}
            />
          )
        }}
      />

      <Modal
        title="从 Git 克隆"
        open={cloneOpen}
        okText="克隆"
        cancelText="取消"
        confirmLoading={cloning}
        cancelButtonProps={{ disabled: cloning }}
        closable={!cloning}
        keyboard={!cloning}
        maskClosable={!cloning}
        onCancel={() => {
          if (!cloning) {
            setCloneOpen(false)
            cloneForm.resetFields()
          }
        }}
        onOk={() => handleClone()}
      >
        <p className="settings-help repository-clone-target">
          克隆到：{root ?? '-'}
        </p>
        <Form form={cloneForm} layout="vertical" requiredMark={false} disabled={cloning}>
          <Form.Item
            label="Git 仓库地址"
            name="url"
            rules={[{ required: true, message: '请输入 Git 仓库地址' }]}
          >
            <Input placeholder="git@host:group/repository.git" spellCheck={false} />
          </Form.Item>
          <Form.Item label="目录名" name="directoryName">
            <Input placeholder="留空则根据仓库地址生成" spellCheck={false} />
          </Form.Item>
        </Form>

        {cloning ? (
          <div className="repository-clone-progress">
            <div className="repository-clone-progress-head">
              <span>正在克隆仓库</span>
              <div className="repository-clone-progress-actions">
                <span>{cloneProgress !== null ? `${cloneProgress}%` : ''}</span>
                <Button
                  type="text"
                  danger
                  size="small"
                  className="repository-clone-cancel"
                  loading={cancelRequesting}
                  onClick={() => handleCancelClone()}
                >
                  取消克隆
                </Button>
              </div>
            </div>
            <Progress
              percent={cloneProgress ?? 0}
              size="small"
              status="active"
              showInfo={false}
            />
          </div>
        ) : null}

        {cloneLogs.length > 0 ? (
          <div className="repository-clone-log" ref={cloneLogRef}>
            {cloneLogs.map((line, index) => (
              <div key={`${index}-${line}`}>{line}</div>
            ))}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
