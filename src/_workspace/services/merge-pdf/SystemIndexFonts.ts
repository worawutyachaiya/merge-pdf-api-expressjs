import { readFile } from 'node:fs/promises'
import path from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { systemFontFamilies, type SystemFontFamily } from './TextFormatting'

type Face = { file: string; postscriptName: string }

const families: Record<SystemFontFamily, { label: string; faces: Face[] }> = {
  tahoma: {
    label: 'Tahoma',
    faces: [
      { file: 'tahoma.ttf', postscriptName: 'Tahoma' },
      { file: 'tahomabd.ttf', postscriptName: 'Tahoma-Bold' },
    ],
  },
  'ms-gothic': {
    label: 'MS Gothic',
    faces: [{ file: 'msgothic.ttc', postscriptName: 'MS-Gothic' }],
  },
  'comic-sans-ms': {
    label: 'Comic Sans MS',
    faces: [
      { file: 'comic.ttf', postscriptName: 'ComicSansMS' },
      { file: 'comicbd.ttf', postscriptName: 'ComicSansMS-Bold' },
      { file: 'comici.ttf', postscriptName: 'ComicSansMS-Italic' },
      { file: 'comicz.ttf', postscriptName: 'ComicSansMS-BoldItalic' },
    ],
  },
  'angsana-new': {
    label: 'Angsana New',
    faces: ['', '-Bold', '-Italic', '-BoldItalic'].map(suffix => ({ file: 'angsana.ttc', postscriptName: `AngsanaNew${suffix}` })),
  },
  'times-new-roman': {
    label: 'Times New Roman',
    faces: [
      { file: 'times.ttf', postscriptName: 'TimesNewRomanPSMT' },
      { file: 'timesbd.ttf', postscriptName: 'TimesNewRomanPS-BoldMT' },
      { file: 'timesi.ttf', postscriptName: 'TimesNewRomanPS-ItalicMT' },
      { file: 'timesbi.ttf', postscriptName: 'TimesNewRomanPS-BoldItalicMT' },
    ],
  },
}

type EmbeddableFont = ReturnType<typeof fontkit.create> & {
  'OS/2'?: { fsType?: Record<'noEmbedding' | 'viewOnly' | 'noSubsetting' | 'bitmapOnly', boolean> }
}
type LoadedFace = { bytes: Buffer; font: EmbeddableFont }
const fileCache = new Map<string, Promise<Buffer>>()
const faceCache = new Map<string, Promise<LoadedFace>>()

export const loadSystemIndexFont = (family: SystemFontFamily, variant: number): Promise<LoadedFace> => {
  const configured = families[family]
  const face = configured.faces[variant]
  const directory = process.env.MERGE_PDF_SYSTEM_FONT_DIR?.trim() ||
    (process.platform === 'win32' ? path.join(process.env.WINDIR ?? 'C:/Windows', 'Fonts') : undefined)
  if (!directory || !face) return Promise.reject(new Error(`The selected ${configured.label} font style is not installed on the PDF server.`))
  const file = path.resolve(directory, face.file)
  const cacheKey = `${file}:${face.postscriptName}`
  const cached = faceCache.get(cacheKey)
  if (cached) return cached

  let bytes = fileCache.get(file)
  if (!bytes) {
    bytes = readFile(file).catch(() => {
      fileCache.delete(file)
      throw new Error(`The selected ${configured.label} font style is not installed on the PDF server.`)
    })
    fileCache.set(file, bytes)
  }
  const pending = bytes.then((data) => {
    const font = (face.file.endsWith('.ttc') ? fontkit.create(data, face.postscriptName) : fontkit.create(data)) as EmbeddableFont
    const flags = font['OS/2']?.fsType
    // The exported PDF is editable and embeds a subset of the selected face.
    if (font.postscriptName !== face.postscriptName || !flags ||
        flags.noEmbedding || flags.viewOnly || flags.noSubsetting || flags.bitmapOnly)
      throw new Error(`${configured.label} cannot be embedded as an editable PDF font on this server.`)
    return { bytes: data, font }
  }).catch(error => {
    faceCache.delete(cacheKey)
    throw error
  })
  faceCache.set(cacheKey, pending)
  return pending
}

export const availableSystemIndexFonts = async () =>
  Promise.all(systemFontFamilies.map(async family => {
    const variants = await Promise.allSettled(families[family].faces.map((_, variant) => loadSystemIndexFont(family, variant)))
    return { family, variants: variants.flatMap((result, variant) => result.status === 'fulfilled' ? [variant] : []) }
  }))
