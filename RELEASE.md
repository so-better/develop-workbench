# 发布流程

本文档用于发布 AI 研发工作台新版本。每次发布按下面顺序执行即可。

## 发布助手强制规则

每次发布必须由发布助手自动完成版本号推荐，并等待用户确认：

1. 自动读取当前版本号
2. 根据本次变更生成一个推荐版本号
3. 给出推荐理由
4. 暂停并明确询问用户是否确认
5. 用户确认前，禁止修改版本号、执行构建或上传安装包
6. 用户确认后，再自动更新 `package.json` 和 `package-lock.json`

不要默认直接执行 `npm version patch`，也不要自行跳过确认。

## 发布前确认

- 当前分支为 `main`
- 工作区已提交，`git status` 没有未提交改动
- 本地已安装依赖：`npm ci`
- 同时准备 macOS 和 Windows 安装包
- 更新目录中的文件名必须保持不变：
  - `develop-workbench-<版本>-mac.dmg`
  - `develop-workbench-<版本>-mac.zip`
  - `develop-workbench-<版本>-win.exe`
  - `develop-workbench-<版本>-win.zip`

## 1. 版本号推荐与确认

### 1.1 读取当前版本

```bash
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "当前版本：${CURRENT_VERSION}"
```

### 1.2 生成推荐版本

发布助手必须根据本次实际变更推荐一个明确版本号，并在询问前说明理由。

推荐规则：

| 变更类型 | 推荐版本 | 示例 |
| --- | --- | --- |
| Bug 修复、样式调整、文案、内部重构、小优化 | patch | `0.1.1 -> 0.1.2` |
| 新增功能、新页面、新工具、新集成，向后兼容 | minor | `0.1.1 -> 0.2.0` |
| 破坏性变更、数据不兼容、重大结构调整 | major | `0.1.1 -> 1.0.0` |

推荐输出格式：

```text
当前版本：0.2.3
推荐版本：0.3.0（minor）
推荐理由：本次新增了 XXX 功能，属于向后兼容的新能力。
是否确认发布 0.3.0？
```

### 1.3 必须询问用户

发布助手必须暂停并等待用户明确确认。

用户确认前禁止：

- 执行 `npm version`
- 修改 `package.json` / `package-lock.json`
- 执行构建
- 上传安装包

### 1.4 确认后自动更新版本号

只有用户确认推荐版本后，才执行：

```bash
RECOMMENDED_VERSION="0.3.0" # 替换为用户确认后的版本号
npm version "${RECOMMENDED_VERSION}" --no-git-tag-version
```

确认 `package.json` 和 `package-lock.json` 中的版本一致：

```bash
node -p "require('./package.json').version"
```

## 2. 类型检查

```bash
npm run typecheck
```

## 3. 构建安装包

macOS 使用 macOS 机器构建：

```bash
npm run dist:mac
```

Windows 使用 Windows 机器构建：

```bash
npm run dist:win
```

发布时禁止使用 `npm run dist`。

必须分别在对应机器构建两个平台的安装包：

- macOS 机器：`npm run dist:mac`
- Windows 机器：`npm run dist:win`

两个平台都构建完成并检查通过后，才能上传发布。

说明：

- `dist:*` 会自动执行 `clean:release`、类型检查和 `electron-vite build`
- 构建完成后产物在 `release/`
- `release/` 已被 `.gitignore` 忽略，不要提交安装包
- 每个版本必须同时提供 macOS 和 Windows 包，否则另一平台的更新检查可能无法拿到安装包

## 4. 检查产物

```bash
VERSION=$(node -p "require('./package.json').version")
ls -lh release/develop-workbench-${VERSION}-*
```

必须确认存在：

```text
release/develop-workbench-<版本>-mac.dmg
release/develop-workbench-<版本>-mac.zip
release/develop-workbench-<版本>-win.exe
release/develop-workbench-<版本>-win.zip
```

检查点：

- 文件名前缀和版本号正确
- 文件大小不是 0
- 不要手动改名
- 新旧版本号不同
- macOS 包可以正常安装和启动
- Windows 包可以正常安装和启动

## 5. 上传到飞书更新目录

更新目录：

```text
https://gaor4awyz1u.feishu.cn/drive/folder/DITBfJjUXlmHofd1x2HczjVSnzb
```

目录 token：

```text
DITBfJjUXlmHofd1x2HczjVSnzb
```

### 5.1 清空更新目录

上传前必须先清空飞书更新目录。该目录只存放当前发布版本的安装包，清空后重新上传，避免旧版本和同名重复文件干扰更新检查。

先确认目录内容：

```bash
lark-cli drive files list \
  --folder-token DITBfJjUXlmHofd1x2HczjVSnzb \
  --page-size 200 \
  --page-all \
  --format table
```

确认目录只包含可删除的更新包后，执行清空：

```bash
lark-cli drive files list \
  --folder-token DITBfJjUXlmHofd1x2HczjVSnzb \
  --page-size 200 \
  --page-all \
  --format json \
  -q '.data.files[] | [.token, .type] | @tsv' |
while IFS=$'\t' read -r token type; do
  if [ -z "$token" ]; then
    continue
  fi

  lark-cli drive +delete \
    --file-token "$token" \
    --type "$type" \
    --yes \
    --format json
done
```

再次检查目录必须为空：

```bash
lark-cli drive files list \
  --folder-token DITBfJjUXlmHofd1x2HczjVSnzb \
  --page-size 200 \
  --page-all \
  --format table
```

### 5.2 上传新版本安装包

目录为空后，逐个上传：

```bash
VERSION=$(node -p "require('./package.json').version")

lark-cli drive +upload \
  --file "release/develop-workbench-${VERSION}-mac.dmg" \
  --folder-token DITBfJjUXlmHofd1x2HczjVSnzb \
  --name "develop-workbench-${VERSION}-mac.dmg" \
  --format json

lark-cli drive +upload \
  --file "release/develop-workbench-${VERSION}-mac.zip" \
  --folder-token DITBfJjUXlmHofd1x2HczjVSnzb \
  --name "develop-workbench-${VERSION}-mac.zip" \
  --format json

lark-cli drive +upload \
  --file "release/develop-workbench-${VERSION}-win.exe" \
  --folder-token DITBfJjUXlmHofd1x2HczjVSnzb \
  --name "develop-workbench-${VERSION}-win.exe" \
  --format json

lark-cli drive +upload \
  --file "release/develop-workbench-${VERSION}-win.zip" \
  --folder-token DITBfJjUXlmHofd1x2HczjVSnzb \
  --name "develop-workbench-${VERSION}-win.zip" \
  --format json
```

如果 `lark-cli` 未登录，先在应用设置中完成飞书登录，或执行：

```bash
lark-cli auth login
```

## 6. 上传后验证

再次查看飞书目录：

```bash
lark-cli drive files list \
  --folder-token DITBfJjUXlmHofd1x2HczjVSnzb \
  --page-size 200 \
  --page-all \
  --format table
```

确认：

- 四个新文件都在目录中
- 版本号与 `package.json` 一致
- 没有重复文件名
- macOS 和 Windows 包都已上传
- 文件名可被更新规则识别：
  `^develop-workbench-<版本>-(mac|win)\.(dmg|zip|exe)$`

## 7. 提交版本变更

```bash
VERSION=$(node -p "require('./package.json').version")

git add package.json package-lock.json
git commit -m "chore: release v${VERSION}"
git push
```

如果本次发布还包含代码改动，先把代码改动单独提交，再提交版本号变更。

## 8. 更新服端到端验证

在旧版本应用中验证：

1. 启动旧版本
2. 等待自动检查更新，或在设置中手动检查
3. 确认能检测到新版本
4. 开始下载
5. 在下载管理中确认进度和完成状态
6. 点击安装更新，确认能打开安装包并退出应用
7. 安装完成后重新打开，确认版本号已更新

也可以手动安装新包验证：

- macOS 安装 `develop-workbench-<版本>-mac.dmg`
- Windows 安装 `develop-workbench-<版本>-win.exe`

## 常见问题

### 检查不到新版本

确认：

- `package.json` 版本已提升
- 飞书目录中存在更高语义化版本的安装包
- 文件名完全匹配 `develop-workbench-<版本>-<mac|win>.<dmg|zip|exe>`
- 当前平台对应的包已上传
- 飞书目录 token 仍为 `DITBfJjUXlmHofd1x2HczjVSnzb`

### 只有 mac 包，没有 win 包

不要发布。补 Windows 包后再上传，否则 Windows 客户端可能检测到新版本但拿不到可下载包。

### 安装了旧版本

删除飞书目录中的同名旧版本文件后重新上传，或使用 `--file-token` 覆盖，再重新检查更新。

### 构建前 release 目录有旧文件

`dist:mac` 和 `dist:win` 会自动执行清理脚本：

```bash
npm run clean:release
```

该脚本只清理旧版本产物和中间目录，不删除当前版本产物。

## 每次发布最短流程

```bash
# 1. 读取当前版本并生成推荐版本
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "当前版本：${CURRENT_VERSION}"
# 必须等待用户确认推荐版本后再执行：
# RECOMMENDED_VERSION="<用户确认后的版本号>"
# npm version "${RECOMMENDED_VERSION}" --no-git-tag-version
# VERSION=$(node -p "require('./package.json').version")

# 2. 检查并构建
# macOS 机器执行
npm run typecheck
npm run dist:mac

# Windows 机器执行
npm run typecheck
npm run dist:win

# 3. 检查产物
ls -lh release/develop-workbench-${VERSION}-*

# 4. 先清空飞书更新目录，再上传四个安装包
# 目录 token: DITBfJjUXlmHofd1x2HczjVSnzb
# 清空命令见“5.1 清空更新目录”
# develop-workbench-<版本>-mac.dmg
# develop-workbench-<版本>-mac.zip
# develop-workbench-<版本>-win.exe
# develop-workbench-<版本>-win.zip

# 5. 提交版本变更
git add package.json package-lock.json
git commit -m "chore: release v${VERSION}"
git push
