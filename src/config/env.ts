// src/config/env.ts
import dotenv from 'dotenv'
import fs from 'fs'

export const loadEnvironmentVariables = () => {
  dotenv.config({ path: './.env' })

  const envFile = (() => {
    switch (process.env.NODE_ENV) {
      case 'development':
        return './.env.development'
      case 'production':
        return './.env.production'
      case 'azure':
        return './.env.azure'
      case 'sit':
        return './.env.sit'
      case 'uat':
        return './.env.uat'
      default:
        throw new Error('NODE_ENV not found !!!')
    }
  })()

  if (!fs.existsSync(envFile)) {
    throw new Error(`.env file not found at: ${envFile}`)
  }

  dotenv.config({ path: envFile, override: true })
}
