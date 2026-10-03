import { FecEccnModel } from '@src/_workspace/models/trade-compliance/fec-eccn/FecEccnModel'
import { ResponseI } from '@src/types/ResponseI'
import { Request, Response } from 'express'

export const FecEccnController = {
  search: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = (await FecEccnModel.search(dataItem)) as any
      return res.status(200).json({
        Status: true,
        ResultOnDb: result?.[1] ?? [],
        TotalCountOnDb: result?.[0]?.[0]?.TOTAL_COUNT ?? 0,
        MethodOnDb: 'Search FEC_ECCN',
        Message: 'Search Data Success'
      } as ResponseI)
    } catch (error: any) {
      return res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Search FEC_ECCN',
        Message: error.message
      } as ResponseI)
    }
  },

  create: async (req: Request, res: Response) => {
    let dataItem

    if (!req.body || Object.entries(req.body).length === 0) {
      dataItem = req.query
    } else {
      dataItem = req.body
    }

    const result = await FecEccnModel.create(dataItem)
    return res.status(200).json(result as ResponseI)
  },

  update: async (req: Request, res: Response) => {
    let dataItem

    if (!req.body || Object.entries(req.body).length === 0) {
      dataItem = req.query
    } else {
      dataItem = req.body
    }

    const result = await FecEccnModel.update(dataItem)
    return res.status(200).json(result as ResponseI)
  },

  delete: async (req: Request, res: Response) => {
    let dataItem

    if (!req.body || Object.entries(req.body).length === 0) {
      dataItem = req.query
    } else {
      dataItem = req.body
    }

    const result = await FecEccnModel.delete(dataItem)
    return res.status(200).json(result as ResponseI)
  }
}
