import { CommonService } from '@src/_workspace/services/Common/Common'

export const CommonModel = {
  GetByLikeMonthShortNameEnglish: async (dataItem: any) => CommonService.GetByLikeMonthShortNameEnglish(dataItem),
  GetYearNow: async () => CommonService.GetYearNow(),
}
