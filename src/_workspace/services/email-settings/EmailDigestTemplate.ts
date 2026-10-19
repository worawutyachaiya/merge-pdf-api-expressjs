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
    <td style="border-bottom:1px solid #e5e7eb;padding:11px 10px;text-align:center;color:#4b5563">${index + 1}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:11px 10px;font-weight:bold;color:#1f2937">${escapeHtml(item.JOB_CODE)}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:11px 10px;color:#374151">${escapeHtml(item.OUTPUT_FILE_NAME)}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:11px 10px;white-space:nowrap;color:#374151">${escapeHtml(formatBangkokDate(item.PUBLISHED_AT))}</td>
    <td style="border-bottom:1px solid #e5e7eb;padding:11px 10px;word-break:break-all">
      <a href="${escapeHtml(toFileUrl(item.NETWORK_PATH))}" style="color:#176b52;font-weight:bold;text-decoration:underline">เปิดไฟล์ PDF</a>
      <div style="margin-top:4px;color:#6b7280;font-size:12px">${escapeHtml(item.NETWORK_PATH)}</div>
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
    `<div style="margin:0;background:#f5f6f7;padding:24px 12px;font-family:Arial,'Leelawadee UI',Tahoma,sans-serif;color:#24292f">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:900px;margin:0 auto;background:#ffffff;border:1px solid #d9dee3">
      <tr><td style="height:4px;background:#176b52;font-size:0;line-height:0">&nbsp;</td></tr>
      <tr><td style="padding:24px 28px 18px;border-bottom:1px solid #e5e7eb">
        <div style="font-size:20px;font-weight:bold;color:#1f2937">แจ้งนำส่งเอกสารใบขนขาเข้า</div>
        <div style="margin-top:5px;font-size:13px;color:#6b7280">Import Customs Declaration Documents</div>
      </td></tr>
      <tr><td style="padding:22px 28px 8px;font-size:14px;line-height:1.7">
        <p style="margin:0 0 10px;font-weight:bold">เรียน เจ้าหน้าที่บัญชีที่เกี่ยวข้อง</p>
        <p style="margin:0">โปรดตรวจสอบเอกสาร PDF ใบขนขาเข้าที่บันทึกไว้บน Server Share ตามรายการด้านล่าง</p>
        <p style="margin:4px 0 0;color:#6b7280">Please review the import customs declaration PDFs saved to the Server Share.</p>
      </td></tr>
      <tr><td style="padding:16px 28px 20px">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8f9fa">
          <tr>
            <td style="padding:12px 14px;border:1px solid #e5e7eb;font-size:13px">
              <strong style="color:#4b5563">วันที่นำส่ง / Submission date</strong><br>
              <span style="display:inline-block;margin-top:4px;color:#1f2937">${escapeHtml(submissionDate)}</span>
            </td>
            <td style="padding:12px 14px;border:1px solid #e5e7eb;font-size:13px">
              <strong style="color:#4b5563">จำนวนเอกสาร / Total documents</strong><br>
              <span style="display:inline-block;margin-top:4px;color:#1f2937">${items.length}</span>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 28px">
        <div style="margin:0 0 10px;font-size:14px;font-weight:bold;color:#1f2937">รายการเอกสาร / Document details</div>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f1f3f5;color:#374151">
            <th style="border-top:1px solid #d9dee3;border-bottom:1px solid #d9dee3;padding:10px 8px;text-align:center">ลำดับ</th>
            <th style="border-top:1px solid #d9dee3;border-bottom:1px solid #d9dee3;padding:10px 8px;text-align:left">เลขที่เอกสาร</th>
            <th style="border-top:1px solid #d9dee3;border-bottom:1px solid #d9dee3;padding:10px 8px;text-align:left">ชื่อไฟล์ PDF</th>
            <th style="border-top:1px solid #d9dee3;border-bottom:1px solid #d9dee3;padding:10px 8px;text-align:left">วันที่บันทึก</th>
            <th style="border-top:1px solid #d9dee3;border-bottom:1px solid #d9dee3;padding:10px 8px;text-align:left">เอกสารบน Server Share</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </td></tr>
      <tr><td style="padding:22px 28px 24px;font-size:13px;line-height:1.6;color:#4b5563">
        ขอบคุณค่ะ<br>Thank you.
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
