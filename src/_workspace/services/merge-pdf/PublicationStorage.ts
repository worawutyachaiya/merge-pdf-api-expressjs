import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const defaultShare = '\\\\192.168.14.35\\C12_PM-Support\\MergePDF_TEST'

export const getOutputDirectory = (): string => process.env.MERGE_PDF_OUTPUT_DIR || process.env.MERGE_PDF_DEVELOPMENT_SHARE || defaultShare

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

export const publishPdf = async (directory: string, fileName: string, bytes: Buffer): Promise<string> => {
  const finalPath = path.join(directory, fileName)
  const temporary = `${finalPath}.${randomUUID()}.tmp`
  let created = false
  try {
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
