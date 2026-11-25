const { copyFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')

const source = path.resolve(__dirname, '../src/assets/excel-fonts')
const destination = path.resolve(__dirname, '../dist/assets/excel-fonts')

mkdirSync(destination, { recursive: true })
for (const file of ['OFL.txt', 'Sarabun-Regular.ttf', 'Sarabun-Bold.ttf', 'Sarabun-Italic.ttf', 'Sarabun-BoldItalic.ttf']) {
  copyFileSync(path.join(source, file), path.join(destination, file))
}
