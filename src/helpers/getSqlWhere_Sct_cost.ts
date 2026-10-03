import { getSqlWhereByColumnFilters } from './getSqlWhereByFilterColumn'

export default function getSqlWhere_Sct_Cost(body: any, tableIds: any, orderByDefault: string = 'UPDATE_DATE') {
  // console.log(body)
  const searchFilters = body.SearchFilters.filter((item: any) => item.value !== '')
    .map((item: any) => {
      const dataItem = tableIds.find((i: any) => i.id === item.id)
      if (!dataItem) return ''
      let value

      // = dataItem.Fns === 'LIKE' ? `%${item.value}%` : item.value
      if (dataItem.Fns === 'IN' && item.value.length === 0) {
        return ''
      }

      switch (dataItem.Fns) {
        case 'IN':
          value = `(${item.value.join(', ')})`
          break
        case 'LIKE':
          value = `'%${item.value}%'`
          break
        default:
          value = `'${item.value}'`
          break
      }
      return `${dataItem.table ? dataItem.table + '.' : ''}${item.id} ${dataItem.Fns} ${value}`
    })
    .filter(Boolean)
    .join(' AND ')

  body.Sct_Cost = searchFilters

  const sqlWhereColumnFilter = body.ColumnFilters.length ? getSqlWhereByColumnFilters(body.ColumnFilters, tableIds) : ''

  if (body.Sct_Cost || sqlWhereColumnFilter) {
    body.Sct_Cost = ` ${body.Sct_Cost} ${body.Sct_Cost && sqlWhereColumnFilter ? 'AND' : ''} ${sqlWhereColumnFilter}`
  }
}
