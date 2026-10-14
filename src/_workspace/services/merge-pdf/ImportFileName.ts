export const isImportCode = (code: string): boolean => /^I\d{2}-(0[1-9]|1[0-2])\d{2,}$/.test(code)

export class FileSequenceInactiveError extends Error {}

export const getImportPrefix = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: '2-digit',
    month: '2-digit',
  }).formatToParts(date)
  return `I${parts.find((part) => part.type === 'year')!.value}-${parts.find((part) => part.type === 'month')!.value}`
}
