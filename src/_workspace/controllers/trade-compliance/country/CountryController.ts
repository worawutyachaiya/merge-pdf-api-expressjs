import { CountryModel } from '@src/_workspace/models/trade-compliance/country/CountryModel'
import { ResponseI } from '@src/types/ResponseI'
import { Request, Response } from 'express'
import { ZodError } from 'zod'

export const CountryController = {
  search: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = (await CountryModel.search(dataItem)) as any

      res.status(200).json({
        Status: true,
        ResultOnDb: result?.[1] ?? [],
        TotalCountOnDb: result?.[0]?.[0]?.TOTAL_COUNT ?? 0,
        MethodOnDb: 'Search Country',
        Message: 'Search Data Success',
      } as ResponseI)
    } catch (error: unknown) {
      res.status(error instanceof ZodError ? 400 : 500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Search Country',
        Message: error instanceof ZodError ? 'Invalid country search filters, sorting or pagination.' : 'Unable to search countries.',
      } as ResponseI)
    }
  },
}
