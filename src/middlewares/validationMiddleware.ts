import { NextFunction, Request, Response } from 'express'
import { z, ZodError } from 'zod'

import { ResponseI } from '@src/types/ResponseI'
import { StatusCodes } from 'http-status-codes'

export function validateData(schema: z.ZodObject<any, any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body)
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.errors.map((issue: any) => ({
          message: `${issue.path.join('.')} is ${issue.message}`,
        }))
        res.status(StatusCodes.BAD_REQUEST).json({
          Status: false,
          Message: 'Invalid data',
          ResultOnDb: errorMessages,
          MethodOnDb: 'validateData',
          TotalCountOnDb: 0,
        } as ResponseI)
      } else {
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal Server Error' })
      }
    }
  }
}
