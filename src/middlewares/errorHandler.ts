import { ResponseI } from '@src/types/ResponseI'
import { Request, Response, NextFunction } from 'express'

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  const statusCode = res.statusCode ? res.statusCode : 500

  res.status(statusCode).json({
    Status: false,
    Message: err.message || 'Unknown error',
    ResultOnDb: [],
    MethodOnDb: 'Error Handler',
    TotalCountOnDb: 0,
  } as ResponseI)
}
