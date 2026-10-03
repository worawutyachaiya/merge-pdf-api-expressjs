import { getSqlWhereByColumnFilters } from './getSqlWhereByFilterColumn'

export default function getSqlWhere_elysia(body: any, tableIds: any, orderByDefault: string = 'UPDATE_DATE') {
  body.Start = Number(body.Start) * Number(body.Limit)

  let orderBy = body.Order.length
    ? body.Order.filter((item: any) => item.id !== 'inuseForSearch')
        .map(
          (item: any) =>
            `${tableIds.find((i: any) => i.id === item.id)?.table ? tableIds.find((i: any) => i.id === item.id)?.table + '.' : ''}${item.id} ${item.desc ? 'DESC' : 'ASC'}`
        )
        .join(', ')
    : `${tableIds.find((i: any) => i.id === orderByDefault)?.table ? tableIds.find((i: any) => i.id === orderByDefault)?.table + '.' : ''}${orderByDefault} DESC`

  const inuseForSearchOrder = body.Order.find((item: any) => item.id === 'inuseForSearch')

  if (typeof inuseForSearchOrder?.desc !== 'undefined') {
    orderBy = orderBy.length ? (orderBy += ` ,  inuseForSearch ${inuseForSearchOrder.desc ? 'DESC' : 'ASC'}`) : ` inuseForSearch ${inuseForSearchOrder.desc ? 'DESC' : 'ASC'}`
  }

  body.Order = orderBy

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

  body.sqlWhere = searchFilters

  const sqlWhereColumnFilter = body.ColumnFilters.length ? getSqlWhereByColumnFilters(body.ColumnFilters, tableIds) : ''

  if (body.sqlWhere || sqlWhereColumnFilter) {
    body.sqlWhere = `WHERE ${body.sqlWhere} ${body.sqlWhere && sqlWhereColumnFilter ? 'AND' : ''} ${sqlWhereColumnFilter}`
  }

  const inuseForSearch = body.SearchFilters.find((item: any) => item.id === 'inuseForSearch')
  body.sqlHaving = ''

  if (typeof inuseForSearch?.value !== 'undefined' && inuseForSearch.value !== '') {
    body.sqlHaving = ` HAVING inuseForSearch = ${inuseForSearch?.value}`
  }
}
