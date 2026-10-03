import compression from 'compression'
import cors from 'cors'
import express, { Request, Response } from 'express'

import Routers from './_workspace/Routes'
import { loadEnvironmentVariables } from './config/env'

import { errorHandler } from './middlewares/errorHandler'
import { notFoundHandler } from './middlewares/notFoundHandler'

// * Load environment variables
loadEnvironmentVariables()

// * Create express app
const app = express()
const PORT = process.env.PORT || 3000
const prefix = `/api/${process.env.APPLICATION_URL || ''}`

// * Middleware

app.use(compression())
app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ limit: '100mb', extended: true }))
app.use(cors())

// * Routes
app.get('/', (req: Request, res: Response) => {
  res.send(`
🐱 Server is running
  - URL               : http://localhost:${PORT}${prefix}
  - Environment       : ${process.env.NODE_ENV}
  - Port              : ${PORT}
  - Application       : ${process.env.APPLICATION_NAME}
  `)
})

app.get(prefix, (req: Request, res: Response) => {
  res.send(`
🐱 Server is running
  - URL               : http://localhost:${PORT}${prefix}
  - Environment       : ${process.env.NODE_ENV}
  - Port              : ${PORT}
  - Application       : ${process.env.APPLICATION_NAME}
  `)
})

app.use(prefix, Routers)

// * Error Handling
// 404 handler
app.all(/.*/, notFoundHandler)
// 500 handler
app.use(errorHandler)

// * Start server
app.listen(PORT, () => {
  console.log(`
🐱 Server is running
  - URL               : http://localhost:${PORT}${prefix}
  - Environment       : ${process.env.NODE_ENV}
  - Port              : ${PORT}
  - DB                : ${process.env.DB}
  - Master Data DB    : ${process.env.MASTER_DATA_DB}
  `)
})
