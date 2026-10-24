import { randomUUID } from 'node:crypto'
import { rename } from 'node:fs/promises'

export const backupCorruptStore = async (filePath: string): Promise<void> => {
  const backupPath = `${filePath}.corrupt-${Date.now()}-${randomUUID().slice(0, 8)}`

  try {
    await rename(filePath, backupPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}
