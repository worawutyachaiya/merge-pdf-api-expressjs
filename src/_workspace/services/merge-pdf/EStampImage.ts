import sharp from 'sharp'

export const prepareTiffEStamp = async (fileName: string, bytes: Buffer) => {
  if (!/\.tiff?$/i.test(fileName)) throw new Error('Select a TIFF image for this conversion.')
  const source = sharp(bytes, { limitInputPixels: 16_777_216, page: 0, pages: 1 })
  const metadata = await source.metadata()
  // Some TIFF-named files are PNGs internally. Trust the decoded format so
  // their existing alpha channel survives the direct image-to-PNG conversion.
  if (!['tiff', 'png', 'jpeg'].includes(metadata.format ?? '') || !metadata.width || !metadata.height)
    throw new Error('The selected TIFF image is damaged or unsupported.')
  const { data, info } = await source
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .png({ palette: false })
    .toBuffer({ resolveWithObject: true })
  if (data.length > 2 * 1024 * 1024) throw new Error('The converted E-stamp image exceeds 2 MB.')
  return { image: `data:image/png;base64,${data.toString('base64')}`, width: info.width, height: info.height }
}
