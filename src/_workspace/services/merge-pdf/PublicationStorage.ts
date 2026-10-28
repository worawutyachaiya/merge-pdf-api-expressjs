import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const getOutputDirectory = (): string => {
  const directory = process.env.MERGE_PDF_OUTPUT_DIR?.trim()
  if (!directory) throw new Error('MERGE_PDF_OUTPUT_DIR is required')
  return directory
}

// Translate only between the two configured representations of the same share.
const shareDirectories = () => ({
  linux: process.env.MERGE_PDF_LINUX_MOUNT_DIR?.trim(),
  windows: process.env.MERGE_PDF_WINDOWS_SHARE_DIR?.trim()
})

export const publicationDirectory = (savedPath: string | null | undefined): string => {
  const configured = getOutputDirectory()
  if (!savedPath) return configured
  const { linux, windows } = shareDirectories()
  if (linux && windows) {
    const linuxRoot = path.posix.normalize(linux).replace(/\/$/, '')
    const windowsRoot = path.win32.normalize(windows).replace(/\\$/, '')
    if (path.posix.dirname(savedPath) === linuxRoot && path.win32.normalize(configured).replace(/\\$/, '').toLowerCase() === windowsRoot.toLowerCase()) return configured
    if (path.win32.dirname(savedPath).toLowerCase() === windowsRoot.toLowerCase() && path.posix.normalize(configured).replace(/\/$/, '') === linuxRoot) return configured
  }
  return path.dirname(savedPath)
}

// Return a Windows path only when the saved location is a Windows share or
// is inside the configured Linux mount. Never invent a path for another mount.
export const publicationSharePath = (savedPath: string | null): string | null => {
  if (!savedPath) return null
  if (savedPath.startsWith('\\\\')) return savedPath
  const { linux, windows } = shareDirectories()
  if (!linux || !windows) return null
  const linuxRoot = path.posix.normalize(linux).replace(/\/$/, '')
  if (path.posix.dirname(savedPath) !== linuxRoot) return null
  return path.win32.join(windows, path.posix.basename(savedPath))
}

export class PublicationStorageError extends Error {
  readonly code: string

  constructor(
    readonly directory: string,
    operation: string,
    cause: unknown
  ) {
    const code = (cause as NodeJS.ErrnoException)?.code || 'UNKNOWN'
    const network = directory.startsWith('\\\\')
    const help =
      code === 'ENOENT'
        ? 'The output folder does not exist. Check MERGE_PDF_OUTPUT_DIR.'
        : code === 'EACCES' || code === 'EPERM'
          ? 'The API account needs permission to create, rename and delete files in this folder.'
          : network
            ? 'Open the share in Windows File Explorer and sign in with an account that has write permission.'
            : 'Check the output folder and permissions of the account running the API.'
    super(`Could not ${operation} in PDF output folder (${code}): ${directory}. ${help}`, { cause })
    this.code = code
  }
}

// Use a unique probe to test the same operations that publication requires.
// Never create a missing network folder or change an existing document.
export const checkOutputDirectory = async (directory = getOutputDirectory()): Promise<void> => {
  const token = randomUUID()
  const temporary = path.join(directory, `.merge-pdf-check-${token}.tmp`)
  const renamed = path.join(directory, `.merge-pdf-check-${token}.verified`)
  let ownedPath: string | undefined
  try {
    if (!path.isAbsolute(directory)) throw Object.assign(new Error('Use an absolute output path'), { code: 'INVALID_PATH' })
    if (!(await stat(directory)).isDirectory()) throw Object.assign(new Error('Output must be a directory'), { code: 'ENOTDIR' })
    await writeFile(temporary, token, { flag: 'wx' })
    ownedPath = temporary
    await rename(temporary, renamed)
    ownedPath = renamed
    if ((await readFile(renamed, 'utf8')) !== token) throw Object.assign(new Error('Output verification failed'), { code: 'EIO' })
    await unlink(renamed)
    ownedPath = undefined
  } catch (error) {
    throw new PublicationStorageError(directory, 'verify file access', error)
  } finally {
    if (ownedPath) await unlink(ownedPath).catch(() => undefined)
  }
}

const hash = (bytes: Buffer): Buffer => createHash('sha256').update(bytes).digest()

export const publishPdf = async (directory: string, fileName: string, bytes: Buffer, overwrite = true): Promise<string> => {
  const finalPath = path.join(directory, fileName)
  const temporary = `${finalPath}.${randomUUID()}.tmp`
  let created = false
  try {
    if (!overwrite) {
      const existing = await readFile(finalPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (existing) {
        if (hash(existing).equals(hash(bytes))) return finalPath
        throw Object.assign(new Error('An unrelated file already exists at this path'), { code: 'EEXIST' })
      }
    }
    await writeFile(temporary, bytes, { flag: 'wx' })
    created = true
    await rename(temporary, finalPath)
    created = false
    return finalPath
  } catch (error) {
    const existing = await readFile(finalPath).catch(() => null)
    if (existing && hash(existing).equals(hash(bytes))) return finalPath
    throw new PublicationStorageError(directory, 'save merged PDF', error)
  } finally {
    if (created) await unlink(temporary).catch(() => undefined)
  }
}
