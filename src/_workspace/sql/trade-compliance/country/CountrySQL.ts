import mysql from 'mysql2'
import dayjs from 'dayjs'
import { CountrySearchInput } from '@src/_workspace/types/trade-compliance/CountrySearch'

const columnCondition = ({ column, columnFns, value: rawValue }: CountrySearchInput['ColumnFilters'][number]): string => {
  const normalizeValue = (value: string | number | boolean | null): string | number | boolean | null =>
    column.endsWith('_DATE') && typeof value === 'string' && value !== '' && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD') : value
  const value = Array.isArray(rawValue) ? rawValue.map(normalizeValue) : normalizeValue(rawValue)
  const name = column.endsWith('_DATE') ? `DATE(country.${column})` : `country.${column}`
  if (columnFns === 'empty') return `(${name} IS NULL OR ${name} = '')`
  if (columnFns === 'notEmpty') return `(${name} IS NOT NULL AND ${name} <> '')`
  if (value === '' || value === null) return ''
  if (columnFns === 'between' || columnFns === 'betweenInclusive') {
    if (!Array.isArray(value)) return ''
    const inclusive = columnFns === 'betweenInclusive' ? '=' : ''
    return [
      value[0] !== undefined && value[0] !== '' ? `${name} >${inclusive} ${mysql.escape(value[0])}` : '',
      value[1] !== undefined && value[1] !== '' ? `${name} <${inclusive} ${mysql.escape(value[1])}` : '',
    ]
      .filter(Boolean)
      .join(' AND ')
  }
  if (Array.isArray(value)) return value.length ? `${name} IN (${value.map((item) => mysql.escape(item)).join(', ')})` : ''
  switch (columnFns) {
    case 'contains':
      return `${name} LIKE ${mysql.escape(`%${value}%`)}`
    case 'startsWith':
      return `${name} LIKE ${mysql.escape(`${value}%`)}`
    case 'endsWith':
      return `${name} LIKE ${mysql.escape(`%${value}`)}`
    case 'notEquals':
      return `${name} <> ${mysql.escape(value)}`
    case 'greaterThan':
      return `${name} > ${mysql.escape(value)}`
    case 'greaterThanOrEqualTo':
      return `${name} >= ${mysql.escape(value)}`
    case 'lessThan':
      return `${name} < ${mysql.escape(value)}`
    case 'lessThanOrEqualTo':
      return `${name} <= ${mysql.escape(value)}`
    default:
      return `${name} = ${mysql.escape(value)}`
  }
}

export const CountrySQL = {
  search: (query: CountrySearchInput): string => {
    const conditions = query.ColumnFilters.map(columnCondition).filter(Boolean)
    const status = query.SearchFilters.find((filter) => filter.id === 'STATUS')?.value
    const includingCancelled = query.SearchFilters.find((filter) => filter.id === 'INCLUDING_CANCELLED')?.value === true
    if (status === 0 || status === 1 || status === '0' || status === '1') conditions.push(`country.INUSE = ${mysql.escape(Number(status))}`)
    else if (!includingCancelled) conditions.push('country.INUSE = 1')
    for (const filter of query.SearchFilters) {
      if (filter.id === 'STATUS' || filter.id === 'INCLUDING_CANCELLED' || filter.value === '' || filter.value === null) continue
      const condition = columnCondition({
        column: filter.id,
        columnFns: ['COUNTRY_ID', 'INUSE', 'CREATE_DATE', 'UPDATE_DATE'].includes(filter.id) ? 'equals' : 'contains',
        value: filter.value,
      })
      if (condition) conditions.push(condition)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const order = query.Order.length ? query.Order.map((item) => `country.${item.id} ${item.desc ? 'DESC' : 'ASC'}`).join(', ') : 'country.COUNTRY_NAME DESC'
    return `
      SELECT COUNT(*) AS TOTAL_COUNT FROM COUNTRY country ${where};
      SELECT country.COUNTRY_ID, country.COUNTRY_NAME, country.COUNTRY_ALPHA2, country.COUNTRY_ALPHA3
        , country.CREATE_BY
        , DATE_FORMAT(country.CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
        , country.UPDATE_BY
        , DATE_FORMAT(country.UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
        , country.INUSE
      FROM COUNTRY country ${where}
      ORDER BY ${order}, country.COUNTRY_ID ASC
      LIMIT ${mysql.escape(query.Start * query.Limit)}, ${mysql.escape(query.Limit)}
    `
  },
}
