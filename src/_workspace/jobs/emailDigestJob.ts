import schedule from 'node-schedule'
import { EmailDigestService } from '@src/_workspace/services/email-settings/EmailDigestService'

export const startEmailDigestJob = () => {
  schedule.scheduleJob({ rule: '* * * * *', tz: 'Asia/Bangkok' }, async () => {
    await EmailDigestService.runDueDigest()
  })
}
