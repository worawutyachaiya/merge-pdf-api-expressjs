import { createHash } from 'node:crypto'
import { lstat, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getOutputDirectory } from './PublicationStorage'

export interface DeletionFile {
  OUTPUT_FILE_NAME: string
  NETWORK_PATH: string | null
  OUTPUT_SHA256: Buffer
}

// Rows arrive newest first: several publication versions can share one path.
export const removePublishedPdfs = async (files: DeletionFile[]): Promise<() => Promise<void>> => {
  const directory = path.resolve(getOutputDirectory())
  const unique = new Map<string, DeletionFile>()
  for (const file of files) {
    if (!file.NETWORK_PATH) continue
    const target = path.resolve(file.NETWORK_PATH)
    if (path.dirname(target) !== directory || path.basename(target) !== file.OUTPUT_FILE_NAME || path.extname(target).toLowerCase() !== '.pdf') {
      throw new Error('The saved PDF path is outside the configured output folder. Contact your administrator.')
    }
    if (!unique.has(target)) unique.set(target, file)
  }
  const candidates: { target: string; bytes: Buffer }[] = []
  for (const [target, file] of unique) {
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!info) continue
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('The saved PDF is not a regular file')
    const bytes = await readFile(target)
    if (!createHash('sha256').update(bytes).digest().equals(file.OUTPUT_SHA256)) {
      throw new Error('The shared PDF was changed outside this application. Reload or contact your administrator before deleting.')
    }
    candidates.push({ target, bytes })
  }
  const removed: typeof candidates = []
  const restore = async (): Promise<void> => {
    for (const file of removed) await writeFile(file.target, file.bytes, { flag: 'wx' })
  }
  try {
    for (const file of candidates) {
      await unlink(file.target)
      removed.push(file)
    }
  } catch (error) {
    await restore()
    throw error
  }
  return restore
}
