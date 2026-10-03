import { NextFunction, Request, Response } from 'express'
import { ZodSchema } from 'zod'

export const validate =
  <T extends ZodSchema>(schema: T) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedData = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
        headers: req.headers,
      })
      req.validatedData = validatedData
      next()
    } catch (err) {
      const errorResponse = (err as any).errors ? (err as any).errors : 'Invalid request'
      return res.status(400).json({
        error: errorResponse,
      })
    }
  }
