import { randomUUID } from 'node:crypto'
import { renameSync } from 'node:fs'
import { rename } from 'node:fs/promises'

const getBackupPath = (filePath: string): string =>
  `${filePath}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`

export const backupCorruptStore = async (filePath: string): Promise<void> => {
  try {
    await rename(filePath, getBackupPath(filePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

export const backupCorruptStoreSync = (filePath: string): void => {
  try {
    renameSync(filePath, getBackupPath(filePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}
