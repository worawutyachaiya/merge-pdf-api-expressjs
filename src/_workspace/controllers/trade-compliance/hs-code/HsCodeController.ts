import { HsCodeModel } from '@src/_workspace/models/trade-compliance/hs-code/HsCodeModel'
import { ResponseI } from '@src/types/ResponseI'
import { Request, Response } from 'express'

export const HsCodeController = {
  search: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = (await HsCodeModel.search(dataItem)) as any

      res.status(200).json({
        Status: true,
        ResultOnDb: result?.[1] ?? [],
        TotalCountOnDb: result?.[0]?.[0]?.TOTAL_COUNT ?? 0,
        MethodOnDb: 'Search HS Code',
        Message: 'Search Data Success',
      } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Search HS Code',
        Message: error.message,
      } as ResponseI)
    }
  },
  getEccnRelationsByHsCodeId: async (req: Request, res: Response) => {
    try {
      const hsCodeId = Number(req.body?.HS_CODE_ID ?? req.query?.HS_CODE_ID)
      if (!Number.isInteger(hsCodeId) || hsCodeId <= 0) {
        return res.status(400).json({
          Status: false,
          ResultOnDb: [],
          TotalCountOnDb: 0,
          MethodOnDb: 'Get ECCN by HS Code ID',
          Message: 'HS_CODE_ID is required',
        } as ResponseI)
      }
      const result = (await HsCodeModel.getEccnRelationsByHsCodeId(hsCodeId)) as any[]
      return res.status(200).json({
        Status: true,
        ResultOnDb: result ?? [],
        TotalCountOnDb: result?.length ?? 0,
        MethodOnDb: 'Get ECCN by HS Code ID',
        Message: 'Get Data Success',
      } as ResponseI)
    } catch (error: any) {
      return res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Get ECCN by HS Code ID',
        Message: error.message,
      } as ResponseI)
    }
  },
}
