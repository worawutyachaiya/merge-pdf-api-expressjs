import os from 'node:os'

import { loadEnvironmentVariables } from '../src/config/env'
import { checkOutputDirectory, getOutputDirectory } from '../src/_workspace/services/merge-pdf/PublicationStorage'

loadEnvironmentVariables()
console.log(`API account: ${os.userInfo().username}`)
console.log(`PDF output folder: ${getOutputDirectory()}`)
checkOutputDirectory()
  .then(() => {
    console.log('PASS: create, rename, read and delete a temporary file. Existing PDF files were not changed.')
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Storage check failed')
    process.exitCode = 1
  })
