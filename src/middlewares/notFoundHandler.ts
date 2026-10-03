import { ResponseI } from '@src/types/ResponseI'
import { Request, Response, NextFunction } from 'express'

export const notFoundHandler = (req: Request, res: Response, _next: NextFunction) => {
  res.status(404).send({
    Status: false,
    Message: '404 Not Found',
    ResultOnDb: [],
    MethodOnDb: req.method,
    TotalCountOnDb: 0,
  } as ResponseI)
}
