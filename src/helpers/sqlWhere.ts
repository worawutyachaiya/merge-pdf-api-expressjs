import { getSqlWhereByColumnFilters } from './getSqlWhereByFilterColumn'

export default function getSqlWhere(body: any, tableIds: any) {
  // คำนวณ Start และ Limit

  body.Start = Number(body.Start) * Number(body.Limit)

  // สร้างคำสั่ง ORDER BY

  let orderBy = body.Order.length
    ? body.Order.filter((item: any) => item.id !== 'inuseForSearch')
        .map((item: any) => {
          const tableEntry = tableIds.find((i: any) => i.id === item.id || i.alias === item.id)

          if (!tableEntry) return ''

          const actualId = tableEntry.id // ใช้ id จริง ไม่ใช่ alias
          return `${tableEntry.table}.${actualId} ${item.desc ? 'DESC' : 'ASC'}`
        })
        .filter(Boolean)
        .join(', ')
    : `${tableIds.find((i: any) => i.id === 'UPDATE_DATE')?.table}.UPDATE_DATE DESC`

  const inuseForSearchOrder = body.Order.find((item: any) => item.id === 'inuseForSearch')

  if (typeof inuseForSearchOrder?.desc !== 'undefined') {
    orderBy = orderBy.length ? (orderBy += ` ,  inuseForSearch ${inuseForSearchOrder.desc ? 'DESC' : 'ASC'}`) : ` inuseForSearch ${inuseForSearchOrder.desc ? 'DESC' : 'ASC'}`
  }
  // else {
  //   orderBy = orderBy.length ? (orderBy += ` ,  UPDATE_DATE DESC`) : ` UPDATE_DATE ASC`
  // }

  body.Order = orderBy

  // สร้างคำสั่ง Search Where
  const searchFilters = body.SearchFilters.filter((item: any) => item.value !== '')
    .map((item: any) => {
      // const id = item.id === 'inuseForSearch' ? 'INUSE' : item.id
      const id = item.id === 'inuseForSearch' ? 'inuseForSearch' : item.id
      const dataItem = tableIds.find((i: any) => i.id === id)

      if (!dataItem) return '' // กรองตัวกรองที่ไม่มีใน tableIds

      const value = dataItem.Fns === 'LIKE' ? `%${item.value}%` : item.value
      return `${dataItem.table}.${id} ${dataItem.Fns} '${value}'`
    })
    .filter(Boolean) // กรองค่าที่เป็น string ว่างออก
    .join(' AND ')

  body.sqlWhere = searchFilters

  // console.log('body.sqlWhere', body.sqlWhere)

  // console.log('body.sqlWhere', body.sqlWhere)

  // console.log('body.sqlWhere', body.sqlWhere)

  // สร้างคำสั่ง Column Where
  const sqlWhereColumnFilter = body.ColumnFilters.length ? getSqlWhereByColumnFilters(body.ColumnFilters, tableIds) : ''

  // รวมคำสั่ง WHERE
  if (body.sqlWhere || sqlWhereColumnFilter) {
    if (body.sqlWhere.length > 0 && sqlWhereColumnFilter !== '') {
      body.sqlWhere = `WHERE ${body.sqlWhere} ${sqlWhereColumnFilter}`
    } else if (body.sqlWhere.length > 0 && sqlWhereColumnFilter === '') {
      body.sqlWhere = `WHERE ${body.sqlWhere} `
    } else if (body.sqlWhere.length === 0 && sqlWhereColumnFilter !== '') {
      const newSqlWhereColumnFilter = sqlWhereColumnFilter.substring(4)

      body.sqlWhere = `WHERE ${newSqlWhereColumnFilter}`
    } else {
      body.sqlWhere = 'WHERE INUSE = 1'
    }
  }

  // สร้างคำสั่ง inuseForSearch
  const inuseForSearch = body.SearchFilters.find((item: any) => item.id === 'inuseForSearch')
  const columnFilterInuseForSearch = body.ColumnFilters.find((item: any) => item.column === 'inuseForSearch')

  body.sqlHaving = ''

  if (typeof inuseForSearch?.value !== 'undefined' && inuseForSearch.value !== '') {
    // console.log('เข้า')

    body.sqlHaving = ` HAVING inuseForSearch = ${inuseForSearch?.value}`
  } else if (columnFilterInuseForSearch?.value && Array.isArray(columnFilterInuseForSearch.value) && columnFilterInuseForSearch.value.length > 0) {
    const values = columnFilterInuseForSearch.value.map((v: any) => `'${v}'`).join(', ') // แปลง array เป็น string '2', '3'
    body.sqlHaving = `HAVING inuseForSearch IN (${values})`
  }
}
