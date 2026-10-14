import type { DigestRecipientRow, DigestItemRow } from '@src/_workspace/types/email-settings/EmailSettings'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)

const formatBangkokDate = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`
}

const formatSubmissionDate = (date: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date
}

const toFileUrl = (networkPath: string): string => {
  const normalized = networkPath.replace(/\\/g, '/')
  if (normalized.startsWith('//')) {
    const [server, ...segments] = normalized.slice(2).split('/')
    return `file://${server}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
  }
  const segments = normalized.replace(/^\/+/, '').split('/')
  return `file:///${segments.map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment))).join('/')}`
}

export const sendDigestEmail = async (recipient: DigestRecipientRow, items: DigestItemRow[], date: string): Promise<void> => {
  const url = process.env.MERGE_PDF_MAIL_API_URL
  if (!url) throw new Error('MERGE_PDF_MAIL_API_URL is required')
  const submissionDate = formatSubmissionDate(date)
  const rows = items
    .map(
      (item, index) => `<tr>
    <td style="border:1px solid #d7e5df;padding:10px;text-align:center;color:#334155">${index + 1}</td>
    <td style="border:1px solid #d7e5df;padding:10px;font-weight:bold;color:#073b2b">${escapeHtml(item.JOB_CODE)}</td>
    <td style="border:1px solid #d7e5df;padding:10px">${escapeHtml(item.OUTPUT_FILE_NAME)}</td>
    <td style="border:1px solid #d7e5df;padding:10px;white-space:nowrap">${escapeHtml(formatBangkokDate(item.PUBLISHED_AT))}</td>
    <td style="border:1px solid #d7e5df;padding:10px;word-break:break-all">
      <a href="${escapeHtml(toFileUrl(item.NETWORK_PATH))}" style="color:#087f5b;font-weight:bold;text-decoration:underline">เปิดไฟล์ / Open PDF</a>
      <div style="margin-top:5px;color:#64748b;font-size:12px">${escapeHtml(item.NETWORK_PATH)}</div>
    </td>
  </tr>`
    )
    .join('')
  const form = new FormData()
  form.set('To', recipient.RECIPIENT_EMAIL)
  form.set('CC', '')
  form.set('Subject', `[Merge PDF] เอกสารใบขนขาเข้า / Import PDFs - ${submissionDate}`)
  form.set(
    'BodyHtml',
    `<div style="margin:0;background:#f3f7f5;padding:24px;font-family:Arial,'Leelawadee UI',Tahoma,sans-serif;color:#24332d">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:920px;margin:0 auto;
      background:#fff;border:1px solid #dce9e2;border-radius:10px;overflow:hidden">
      <tr><td style="background:#087f5b;padding:22px 28px;color:#fff">
        <div style="font-size:21px;font-weight:bold">แจ้งเอกสารใบขนขาเข้า</div>
        <div style="margin-top:4px;font-size:14px;letter-spacing:1px">IMPORT CUSTOMS DECLARATION DOCUMENTS</div>
      </td></tr>
      <tr><td style="padding:24px 28px 12px">
        <p style="margin:0 0 12px;font-size:16px;font-weight:bold">เรียน เจ้าหน้าที่บัญชีที่เกี่ยวข้อง</p>
        <p style="margin:0 0 4px;color:#52615a">Dear Accounting Team,</p>
        <p style="margin:18px 0 5px;line-height:1.6">โปรดตรวจสอบเอกสาร PDF ใบขนขาเข้าที่บันทึกไว้บน Server Share ตามรายการด้านล่าง</p>
        <p style="margin:0;color:#52615a;line-height:1.6">Please review the import customs declaration PDFs saved to the Server Share.</p>
      </td></tr>
      <tr><td style="padding:8px 28px 20px">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#eaf7f1;border:1px solid #c8e7d7;border-radius:7px">
          <tr><td style="padding:13px 16px;color:#385247">
            <strong>สรุปนำส่งวันที่ / Submission date:</strong> ${escapeHtml(submissionDate)}
            <span style="padding:0 10px;color:#9bb8aa">|</span>
            <strong>จำนวนเอกสาร / Total documents:</strong> ${items.length}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 28px 28px">
        <div style="margin:0 0 10px;font-size:16px;font-weight:bold;color:#073b2b">รายละเอียดเอกสาร / Document details</div>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#d9f0e5;color:#073b2b">
            <th style="border:1px solid #c6ded3;padding:10px;text-align:center">ลำดับ<br>No.</th>
            <th style="border:1px solid #c6ded3;padding:10px;text-align:left">เลขที่เอกสาร<br>Document No.</th>
            <th style="border:1px solid #c6ded3;padding:10px;text-align:left">ชื่อไฟล์ PDF<br>PDF file</th>
            <th style="border:1px solid #c6ded3;padding:10px;text-align:left">วันที่บันทึก<br>Completed at</th>
            <th style="border:1px solid #c6ded3;padding:10px;text-align:left">เอกสารบน Server Share<br>Server Share document</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin:18px 0 0;color:#52615a;line-height:1.6">ขอบคุณค่ะ<br>Thank you.</p>
      </td></tr>
    </table>
  </div>`
  )
  const response = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Mail API returned HTTP ${response.status}`)
  if (response.headers.get('content-type')?.includes('application/json')) {
    const result: unknown = await response.json()
    if (result && typeof result === 'object' && (('Status' in result && result.Status === false) || ('success' in result && result.success === false))) {
      throw new Error('Mail API reported unsuccessful delivery')
    }
  }
}
