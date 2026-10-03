import type { NextFunction, Request, Response } from 'express'

import { CalDeMinimisModel } from '@src/_workspace/models/trade-compliance/cal-de-minimis/CalDeMinimisModel'
import {
  calDeMinimisCalculateRequestSchema,
  calDeMinimisProductTypesRequestSchema,
  calDeMinimisSctRevisionsRequestSchema,
  calDeMinimisThresholdSettingsUpdateRequestSchema,
} from '@src/_workspace/routes/trade-compliance/cal-de-minimis/CalDeMinimisValidation'

export const CalDeMinimisController = {
  getProductTypes: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = calDeMinimisProductTypesRequestSchema.parse(req.validatedData)
      res.status(200).json(await CalDeMinimisModel.getProductTypes(validated.query.SEARCH))
    } catch (error: unknown) {
      if (res.headersSent) return next(error)
      res.status(500).json({
        Status: false,
        Message: 'Unable to load De-minimis Product Types',
        ResultOnDb: [],
        MethodOnDb: 'Get De-minimis Product Types',
        TotalCountOnDb: 0,
      })
    }
  },

  getSctRevisions: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = calDeMinimisSctRevisionsRequestSchema.parse(req.validatedData)
      res.status(200).json(await CalDeMinimisModel.getSctRevisions(validated.query.PRODUCT_TYPE_ID))
    } catch (error: unknown) {
      if (res.headersSent) return next(error)
      res.status(500).json({
        Status: false,
        Message: 'Unable to load De-minimis SCT Revisions',
        ResultOnDb: [],
        MethodOnDb: 'Get De-minimis SCT Revisions',
        TotalCountOnDb: 0,
      })
    }
  },

  getThresholdSettings: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json(await CalDeMinimisModel.getThresholdSettings())
    } catch (error: unknown) {
      if (res.headersSent) return next(error)
      res.status(500).json({
        Status: false,
        Message: 'Unable to load De-minimis Settings',
        ResultOnDb: [],
        MethodOnDb: 'Get De-minimis Settings',
        TotalCountOnDb: 0,
      })
    }
  },

  updateThresholdSettings: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = calDeMinimisThresholdSettingsUpdateRequestSchema.parse(req.validatedData)
      res.status(200).json(await CalDeMinimisModel.updateThresholdSettings(validated.body))
    } catch (error: unknown) {
      if (res.headersSent) return next(error)
      res.status(500).json({
        Status: false,
        Message: 'Unable to update De-minimis Settings',
        ResultOnDb: [],
        MethodOnDb: 'Update De-minimis Settings',
        TotalCountOnDb: 0,
      })
    }
  },

  calculate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = calDeMinimisCalculateRequestSchema.parse(req.validatedData)
      res.status(200).json(await CalDeMinimisModel.calculate(validated.body))
    } catch (error: unknown) {
      if (res.headersSent) return next(error)
      res.status(500).json({
        Status: false,
        Message: 'Unable to calculate De-minimis',
        ResultOnDb: [],
        MethodOnDb: 'Calculate De-minimis',
        TotalCountOnDb: 0,
      })
    }
  },
}
