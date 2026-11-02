const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const version = process.argv[2]

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('版本号格式不正确，应类似 0.1.2')
  process.exit(1)
}

const root = join(__dirname, '..')
const packagePath = join(root, 'package.json')
const lockPath = join(root, 'package-lock.json')

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
packageJson.version = version
writeJson(packagePath, packageJson)

if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  lock.version = version

  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = version
  }

  writeJson(lockPath, lock)
}

console.log(`版本号已更新为 ${version}`)
