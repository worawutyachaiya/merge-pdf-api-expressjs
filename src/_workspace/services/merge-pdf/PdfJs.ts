import path from 'node:path'

// Preserve native ESM import in this CommonJS project (PDF.js uses top-level await).
const importPdfJs = new Function('return import("pdfjs-dist/legacy/build/pdf.mjs")') as () => Promise<typeof import('pdfjs-dist')>
let modulePromise: ReturnType<typeof importPdfJs> | undefined
const assets = path.dirname(require.resolve('pdfjs-dist/package.json')).replace(/\\/g, '/') + '/'

export const loadPdfJs = async (bytes: Buffer) => {
  const { getDocument } = await (modulePromise ??= importPdfJs())
  return getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: assets + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assets + 'standard_fonts/',
    wasmUrl: assets + 'wasm/',
  })
}
