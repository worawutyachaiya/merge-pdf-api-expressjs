import { EarStatusModel } from '@src/_workspace/models/trade-compliance/ear-status/EarStatusModel'
import { ResponseI } from '@src/types/ResponseI'
import { Request, Response } from 'express'

export const EarStatusController = {
  search: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = (await EarStatusModel.search(dataItem)) as any

      res.status(200).json({
        Status: true,
        ResultOnDb: result?.[1] ?? [],
        TotalCountOnDb: result?.[0]?.[0]?.TOTAL_COUNT ?? 0,
        MethodOnDb: 'Search EAR Status',
        Message: 'Search Data Success',
      } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Search EAR Status',
        Message: error.message,
      } as ResponseI)
    }
  },
}
