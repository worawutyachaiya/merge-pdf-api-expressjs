import { EccnModel } from '@src/_workspace/models/trade-compliance/eccn/EccnModel'
import { ResponseI } from '@src/types/ResponseI'
import { Request, Response } from 'express'

export const EccnController = {
  search: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = (await EccnModel.search(dataItem)) as any

      res.status(200).json({
        Status: true,
        ResultOnDb: result?.[1] ?? [],
        TotalCountOnDb: result?.[0]?.[0]?.TOTAL_COUNT ?? 0,
        MethodOnDb: 'Search ECCN',
        Message: 'Search Data Success',
      } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Search ECCN',
        Message: error.message,
      } as ResponseI)
    }
  },
  getHsCodeRelationsByEccnId: async (req: Request, res: Response) => {
    try {
      const eccnId = Number(req.body?.ECCN_ID ?? req.query?.ECCN_ID)
      if (!Number.isInteger(eccnId) || eccnId <= 0) {
        return res.status(400).json({
          Status: false,
          ResultOnDb: [],
          TotalCountOnDb: 0,
          MethodOnDb: 'Get HS Code by ECCN ID',
          Message: 'ECCN_ID is required',
        } as ResponseI)
      }
      const result = (await EccnModel.getHsCodeRelationsByEccnId(eccnId)) as any[]
      return res.status(200).json({
        Status: true,
        ResultOnDb: result ?? [],
        TotalCountOnDb: result?.length ?? 0,
        MethodOnDb: 'Get HS Code by ECCN ID',
        Message: 'Get Data Success',
      } as ResponseI)
    } catch (error: any) {
      return res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Get HS Code by ECCN ID',
        Message: error.message,
      } as ResponseI)
    }
  },
}
