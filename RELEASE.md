# 发布流程

本文档用于发布 AI 研发工作台新版本。每次发布按下面顺序执行即可。

## 发布助手强制规则

每次发布必须使用 **ask question 模式**（`question` 工具）询问版本号，并等待用户选择：

1. 自动读取当前版本号
2. 计算 patch、minor、major 三个候选版本
3. 使用 `question` 工具让用户选择，选项顺序固定为：
   - patch（小版本）
   - minor（大版本）
   - major（最大版本）
   - 自定义输入（由 `question` 工具自动提供，不要重复添加「其他」选项）
4. 用户选择前，禁止修改版本号、执行构建或上传安装包
5. 用户选择后，按用户确认的版本号执行发布

不要只用普通文本询问版本号，也不要默认执行 `npm version patch`。

## 发布前确认

- 本地已安装依赖：`npm ci`
- 已更新根目录 `CHANGELOG.md`，添加当前版本的更新内容
- 同时准备 macOS 和 Windows 安装包
- 更新目录中的文件名必须保持不变：
  - `develop-workbench-<版本>-mac.dmg`
  - `develop-workbench-<版本>-mac.zip`
  - `develop-workbench-<版本>-win.exe`
  - `develop-workbench-<版本>-win.zip`

## 1. 版本号选择与确认

版本变更是每次发布的强制步骤，不可跳过。

### 1.1 读取当前版本

```bash
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "当前版本：${CURRENT_VERSION}"
```

### 1.2 生成候选版本

发布助手先根据当前版本计算三个候选：

- patch：小版本，例如 `0.2.3 -> 0.2.4`
- minor：大版本，例如 `0.2.3 -> 0.3.0`
- major：最大版本，例如 `0.2.3 -> 1.0.0`

版本选项按 **patch → minor → major** 的顺序展示，优先小版本。可以说明本次变更对各候选版本的影响，但必须由用户选择，不能自行决定或跳过询问。

### 1.3 必须使用 question 工具询问

发布助手必须调用 `question` 工具，提供如下选项（版本号按当前版本计算）：

```text
问题：选择本次发布版本
选项：
1. 0.2.4（patch / 小版本）
2. 0.3.0（minor / 大版本）
3. 1.0.0（major / 最大版本）
```

`question` 工具默认会提供「自定义输入」入口，不要额外添加「其他」或「自定义」选项。

用户选择前禁止：

- 执行 `npm version`
- 修改 `package.json` / `package-lock.json`
- 修改 `CHANGELOG.md`
- 执行构建
- 上传安装包

### 1.4 用户选择后自动更新版本号

只有用户通过 `question` 工具选择版本后，才执行：

```bash
RELEASE_VERSION="0.2.4" # 替换为用户选择的版本号
node scripts/set-version.cjs "${RELEASE_VERSION}"
```

确认 `package.json` 和 `package-lock.json` 中的版本一致：

```bash
node -p "require('./package.json').version"
```

### 1.5 维护 CHANGELOG

应用底部的“更新日志”入口会展示根目录 `CHANGELOG.md` 的内容。

每次发布前，必须由 AI 根据本次实际变更更新 `CHANGELOG.md`：

```md
## 0.3.0

### 新增

- 新增 XXX 功能

### 优化

- 优化 XXX 流程

### 修复

- 修复 XXX 问题

## 0.2.0

...
```

要求：

- 发布时由 AI 根据本次实际变更创建或更新 `CHANGELOG.md`
- 不要添加 `# 更新日志` 这类一级标题，弹窗已经显示标题
- 新版本必须新增到文件顶部
- 保留历史版本，不要清空已有更新日志
- 版本号必须与本次确认后的 `package.json` 版本一致
- 内容必须来自本次实际变更，不能编造
- 更新内容按“新增 / 优化 / 修复”分类
- 没有更新 `CHANGELOG.md` 时，更新日志入口看不到本次版本内容

## 2. 类型检查

```bash
npm run typecheck
```

## 3. 构建安装包

按顺序在同一台机器构建两个平台的安装包：

```bash
npm run dist:mac
npm run dist:win
```

发布时禁止使用 `npm run dist`。

先构建 macOS 包，再构建 Windows 包；两个平台都构建完成并检查通过后，才能上传发布。

说明：

- `dist:*` 会自动执行 `clean:release`、类型检查和 `electron-vite build`
- 构建完成后产物在 `release/`
- `release/` 是构建产物，不要上传到源码仓库
- 每个版本必须同时提供 macOS 和 Windows 包，否则另一平台的更新检查可能无法拿到安装包
- mac 构建默认使用固定自签名证书签名；只有未配置证书时才通过 `afterPack` 做整包 ad-hoc 签名。首次打开仍可能需要右键打开或在系统设置中允许。

### macOS 固定自签名证书

为避免每次升级后辅助功能/自动化权限失效，构建机需要使用固定的自签名证书签名，而不是临时 ad-hoc 签名：

1. 在构建机钥匙串中保留一张名为 `Develop Workbench Self Signed` 的 Code Signing 证书，并确保 `security find-identity -v -p codesigning` 能看到它
2. `electron-builder.yml` 的 `mac.identity` 固定指向该证书；配置了证书时 `after-pack` 会跳过 ad-hoc 签名
3. 证书私钥只保存在构建机或密码管理器，不要提交到仓库；证书重建后所有用户需要重新授权一次
4. 从 ad-hoc 切换到固定证书后的第一个版本，用户需要重新授权一次；之后升级不再失效

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

## 7. 更新端到端验证

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
# 1. 读取当前版本并计算 patch / minor / major
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "当前版本：${CURRENT_VERSION}"
# 必须使用 question 工具让用户选择版本，选项顺序为 patch / minor / major，
# 自定义输入由 question 工具自动提供。
# 用户选择后再执行：
# RELEASE_VERSION="<用户选择的版本号>"
# node scripts/set-version.cjs "${RELEASE_VERSION}"
# VERSION=$(node -p "require('./package.json').version")
# 同时在根目录 CHANGELOG.md 顶部添加该版本的更新内容

# 2. 检查并构建（按顺序执行）
npm run typecheck
npm run dist:mac
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
