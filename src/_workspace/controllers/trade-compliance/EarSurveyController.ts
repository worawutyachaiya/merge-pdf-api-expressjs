import { EarSurveyModel } from '@src/_workspace/models/trade-compliance/EarSurveyModel'
import { ResponseI } from '@src/types/ResponseI'
import { Request, Response } from 'express'

export const EarSurveyController = {
  getManufacturingItemByCode: async (req: Request, res: Response) => {
    try {
      const itemCode = String(req.query.ITEM_CODE ?? '').trim()
      if (!itemCode || itemCode.length > 100) {
        res.status(400).json({
          Status: false,
          ResultOnDb: [],
          TotalCountOnDb: 0,
          MethodOnDb: 'Get Manufacturing Item',
          Message: 'ITEM_CODE is required and must not exceed 100 characters',
        } as ResponseI)
        return
      }
      const result = await EarSurveyModel.getManufacturingItemByCode(itemCode)
      res.status(200).json({
        Status: true,
        ResultOnDb: result,
        TotalCountOnDb: result.length,
        MethodOnDb: 'Get Manufacturing Item',
        Message: 'Search Data Success',
      } as ResponseI)
    } catch {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Get Manufacturing Item',
        Message: 'Unable to search Manufacturing Item',
      } as ResponseI)
    }
  },
  search: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = (await EarSurveyModel.search(dataItem)) as any
      res.status(200).json({
        Status: true,
        ResultOnDb: result?.[1] ?? [],
        TotalCountOnDb: result?.[0]?.[0]?.TOTAL_COUNT ?? 0,
        MethodOnDb: 'Search EAR Survey',
        Message: 'Search Data Success',
      } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Search EAR Survey',
        Message: error.message,
      } as ResponseI)
    }
  },

  searchPreTrade: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = (await EarSurveyModel.searchPreTrade(dataItem)) as any
      res.status(200).json({
        Status: true,
        ResultOnDb: result?.[1] ?? [],
        TotalCountOnDb: result?.[0]?.[0]?.TOTAL_COUNT ?? 0,
        MethodOnDb: 'Search Pre-trade EAR Survey',
        Message: 'Search Data Success',
      } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Search Pre-trade EAR Survey',
        Message: error.message,
      } as ResponseI)
    }
  },

  getByEarSurveyHeaderId: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const earSurveyHeaderId = Number(dataItem?.EAR_SURVEY_HEADER_ID)

      if (!Number.isInteger(earSurveyHeaderId) || earSurveyHeaderId <= 0) {
        res.status(400).json({
          Status: false,
          ResultOnDb: [],
          TotalCountOnDb: 0,
          MethodOnDb: 'Get EAR Survey Detail',
          Message: 'EAR_SURVEY_HEADER_ID is invalid',
        } as ResponseI)
        return
      }

      const result = await EarSurveyModel.getByEarSurveyHeaderId(earSurveyHeaderId)
      res.status(200).json({
        Status: true,
        ResultOnDb: result ? [result] : [],
        TotalCountOnDb: result ? 1 : 0,
        MethodOnDb: 'Get EAR Survey Detail',
        Message: result ? 'Get Data Success' : 'EAR Survey was not found',
      } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Get EAR Survey Detail',
        Message: error.message,
      } as ResponseI)
    }
  },

  createByImportFile: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = await EarSurveyModel.createByImportFile(dataItem)
      res.status(200).json({ ...result, MethodOnDb: 'Import EAR Survey' } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Import EAR Survey',
        Message: error.message,
      } as ResponseI)
    }
  },

  createPreTradeByImportFile: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = await EarSurveyModel.createPreTradeByImportFile(dataItem)
      res.status(200).json({ ...result, MethodOnDb: 'Import Pre-trade EAR Survey' } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Import Pre-trade EAR Survey',
        Message: error.message,
      } as ResponseI)
    }
  },

  cancelPreTrade: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = await EarSurveyModel.cancelPreTrade(dataItem)
      res.status(200).json({ ...result, MethodOnDb: 'Cancel Pre-trade EAR Survey' } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Cancel Pre-trade EAR Survey',
        Message: error.message,
      } as ResponseI)
    }
  },

  activatePreTrade: async (req: Request, res: Response) => {
    try {
      let dataItem

      if (!req.body || Object.entries(req.body).length === 0) {
        dataItem = req.query
      } else {
        dataItem = req.body
      }

      const result = await EarSurveyModel.activatePreTrade(dataItem)
      res.status(200).json({ ...result, MethodOnDb: 'Activate Pre-trade EAR Survey' } as ResponseI)
    } catch (error: any) {
      res.status(500).json({
        Status: false,
        ResultOnDb: [],
        TotalCountOnDb: 0,
        MethodOnDb: 'Activate Pre-trade EAR Survey',
        Message: error.message,
      } as ResponseI)
    }
  },
}
