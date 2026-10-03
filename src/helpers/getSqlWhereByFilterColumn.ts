import dayjs from 'dayjs'

interface ColumnFilter {
  column: string
  value: string
  columnFns?: string
}

interface TableId {
  table: string
  id: string
  alias?: string
}

export const getSqlWhereByColumnFilters = (columnFilters: ColumnFilter[], tableIds: TableId[]): string => {
  let sqlWhereColumnFilter = ''
  // console.log('columnFilters', columnFilters)
  const parsedFilters = typeof columnFilters === 'string' ? JSON.parse(columnFilters) : columnFilters
  for (const columnFilter of parsedFilters) {
    // console.log('👉 ตรวจ columnFilter:', columnFilter)

    if (
      !columnFilter?.value ||
      (Array.isArray(columnFilter.value) && columnFilter.value.length === 0) ||
      columnFilter.column === 'inuseForSearch' ||
      columnFilter.column === 'INUSE'
    ) {
      // console.log('❌ ข้าม columnFilter:', columnFilter)
      continue
    }

    // console.log('✅ ผ่านเงื่อนไข, tableIds:', tableIds)
    // console.log('asdasdsad', tableIds)

    const tableId = tableIds.find((tableId) => tableId.id === columnFilter.column || tableId.alias === columnFilter.column)
    if (!tableId) continue

    const actualColumn = tableId.id // Always use the real column name for SQL
    const tableStmt = ['CREATE_DATE', 'UPDATE_DATE', 'ESTIMATE_PERIOD_START_DATE', 'ESTIMATE_PERIOD_END_DATE', 'RE_CAL_UPDATE_DATE'].includes(actualColumn)
      ? `DATE(${tableId.table}.${actualColumn})`
      : `${tableId.table}.${actualColumn}`

    let value = columnFilter.value
    if (['CREATE_DATE', 'UPDATE_DATE', 'ESTIMATE_PERIOD_START_DATE', 'ESTIMATE_PERIOD_END_DATE', 'RE_CAL_UPDATE_DATE'].includes(actualColumn)) {
      value = dayjs(value).format('YYYY-MM-DD')
    }

    let columnFns = columnFilter.columnFns || ''
    if (actualColumn === 'INUSE') {
      columnFns = ''
    }

    const operatorMap: Record<string, string> = {
      contains: `LIKE '%${value}%'`,
      startsWith: `LIKE '${value}%'`,
      endsWith: `LIKE '%${value}'`,
      equals: `= '${value}'`,
      notEquals: `!= '${value}'`,
      greaterThan: `> '${value}'`,
      greaterThanOrEqualTo: `>= '${value}'`,
      lessThan: `< '${value}'`,
      lessThanOrEqualTo: `<= '${value}'`,
    }

    const condition = operatorMap[columnFns] || (Array.isArray(value) ? `IN (${value.map((v) => `'${v}'`).join(', ')})` : `IN ('${value}')`)

    sqlWhereColumnFilter += `AND ${tableStmt} ${condition} `
  }

  return sqlWhereColumnFilter
}

export const getSqlWhereByColumnFilters_elysia = (columnFilters: any, tableIds: any) => {
  let sqlWhereColumnFilter = ''

  for (let i = 0; i < columnFilters.length; i++) {
    const columnFilter = columnFilters[i]

    if (!columnFilter?.value || columnFilter.value == '') {
      continue
    }

    const tableId = tableIds.find((tableId: any) => tableId.id === columnFilter.column)

    if (!tableId) {
      continue
    }

    let columnFns = columnFilter.columnFns || ''

    let tableStmt = ''
    if (
      columnFilter.column === 'CREATE_DATE' ||
      columnFilter.column === 'UPDATE_DATE' ||
      columnFilter.column === 'ESTIMATE_PERIOD_START_DATE' ||
      columnFilter.column === 'ESTIMATE_PERIOD_END_DATE' ||
      columnFilter.column === 'RE_CAL_UPDATE_DATE'
    ) {
      tableStmt = `DATE(${tableId.table ? `${tableId.table}.` : ''}${columnFilter.column})`

      const date = new Date(columnFilter.value)
      const formattedDate = date.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })

      columnFilter.value = dayjs(formattedDate).format('YYYY-MM-DD')
    } else {
      tableStmt = `${tableId.table ? `${tableId.table}.` : ''}${!tableId?.alias ? columnFilter.column : tableId.alias}`
    }

    if (columnFilter.column === 'INUSE') {
      columnFns = ''
    }

    switch (columnFns) {
      case 'contains':
        sqlWhereColumnFilter += `AND ${tableStmt} LIKE '%${columnFilter.value}%'`
        break
      case 'startsWith':
        sqlWhereColumnFilter += `AND ${tableStmt} LIKE '${columnFilter.value}%'`
        break
      case 'endsWith':
        sqlWhereColumnFilter += `AND ${tableStmt} LIKE '%${columnFilter.value}'`
        break
      case 'equals':
        sqlWhereColumnFilter += `AND ${tableStmt} = '${columnFilter.value}'`
        break
      case 'notEquals':
        sqlWhereColumnFilter += `AND ${tableStmt} != '${columnFilter.value}'`
        break
      case 'greaterThan':
        sqlWhereColumnFilter += `AND ${tableStmt} > '${columnFilter.value}'`
        break
      case 'greaterThanOrEqualTo':
        sqlWhereColumnFilter += `AND ${tableStmt} >= '${columnFilter.value}'`
        break
      case 'lessThan':
        sqlWhereColumnFilter += `AND ${tableStmt} < '${columnFilter.value}'`
        break
      case 'lessThanOrEqualTo':
        sqlWhereColumnFilter += `AND ${tableStmt} <= '${columnFilter.value}'`
        break
      default:
        sqlWhereColumnFilter += `AND ${tableStmt} IN (${columnFilter.value?.length > 0 ? columnFilter.value : columnFilter.value.join(',')})`
    }
  }

  return sqlWhereColumnFilter
}
// export const getSqlWhereByColumnFilters = (columnFilters: any, tableIds: any) => {
//   let sqlWhereColumnFilter = ''

//   for (let i = 0; i < columnFilters.length; i++) {
//     const columnFilter = columnFilters[i]

//     if (!columnFilter?.value || columnFilter.value == '') {
//       continue
//     }
//     // เช็คว่าถ้า column เป็น 'inuseForSearch' ให้ข้ามไป
//     if (columnFilter?.column === 'inuseForSearch') {
//       continue
//     }

//     const tableId = tableIds.find((tableId: any) => tableId.id === columnFilter.column)

//     if (!tableId) {
//       continue
//     }

//     let columnFns = columnFilter.columnFns || ''

//     let tableStmt = ''
//     if (columnFilter.column === 'CREATE_DATE' || columnFilter.column === 'UPDATE_DATE') {
//       tableStmt = `DATE(${tableId.table ? `${tableId.table}.` : ''}${columnFilter.column})`

//       const date = new Date(columnFilter.value)
//       const formattedDate = date.toLocaleDateString('en-US', {
//         day: 'numeric',
//         month: 'short',
//         year: 'numeric',
//       })

//       columnFilter.value = dayjs(formattedDate).format('YYYY-MM-DD')
//     } else {
//       tableStmt = `${tableId.table ? `${tableId.table}.` : ''}${!tableId?.alias ? columnFilter.column : tableId.alias}`
//     }

//     if (columnFilter.column === 'INUSE') {
//       columnFns = ''
//     }

//     /* Contains | Starts With | Ends With | Equals | Not Equals | Between
//     | Between Inclusive | Greater Than | Greater Then Or Equal To | Less Than | Less Than Or Equal To | Empty | Not Empty */
//     switch (columnFns) {
//       case 'contains':
//         sqlWhereColumnFilter += `AND ${tableStmt} LIKE '%${columnFilter.value}%'`
//         break
//       case 'startsWith':
//         sqlWhereColumnFilter += `AND ${tableStmt} LIKE '${columnFilter.value}%'`
//         break
//       case 'endsWith':
//         sqlWhereColumnFilter += `AND ${tableStmt} LIKE '%${columnFilter.value}'`
//         break
//       case 'equals':
//         sqlWhereColumnFilter += `AND ${tableStmt} = '${columnFilter.value}'`
//         break
//       case 'notEquals':
//         sqlWhereColumnFilter += `AND ${tableStmt} != '${columnFilter.value}'`
//         break
//       case 'greaterThan':
//         sqlWhereColumnFilter += `AND ${tableStmt} > '${columnFilter.value}'`
//         break
//       case 'greaterThanOrEqualTo':
//         sqlWhereColumnFilter += `AND ${tableStmt} >= '${columnFilter.value}'`
//         break
//       case 'lessThan':
//         sqlWhereColumnFilter += `AND ${tableStmt} < '${columnFilter.value}'`
//         break
//       case 'lessThanOrEqualTo':
//         sqlWhereColumnFilter += `AND ${tableStmt} <= '${columnFilter.value}'`
//         break
//       default:
//         sqlWhereColumnFilter += `AND ${tableStmt} IN (${columnFilter.value})`
//     }
//   }

//   return sqlWhereColumnFilter
// }

export const getSqlWhereByColumnFilters_ = (columnFilters: ColumnFilter[], tableIds: TableId[]): string => {
  let isFirstCondition = true // ใช้ตัวแปรตรวจสอบว่าคำสั่งแรกหรือไม่

  return columnFilters.reduce((sqlWhereColumnFilter, columnFilter) => {
    // ข้ามค่าว่างหรือ undefined
    if (!columnFilter?.value) {
      return sqlWhereColumnFilter
    }

    // หา tableId ที่ตรงกับ column
    const tableId = tableIds.find((tableId) => tableId.id === columnFilter.column)
    if (!tableId) {
      return sqlWhereColumnFilter
    }

    let columnFns = columnFilter.columnFns || ''
    let tableStmt = ''

    // จัดการกับ CREATE_DATE และ UPDATE_DATE
    if (['CREATE_DATE', 'UPDATE_DATE', 'ESTIMATE_PERIOD_START_DATE', 'ESTIMATE_PERIOD_END_DATE', 'RE_CAL_UPDATE_DATE'].includes(columnFilter.column)) {
      tableStmt = `DATE(${tableId.table ? `${tableId.table}.` : ''}${columnFilter.column})`

      // แปลงวันที่เป็นรูปแบบที่ถูกต้อง
      columnFilter.value = dayjs(columnFilter.value).format('YYYY-MM-DD')
    } else {
      tableStmt = `${tableId.table ? `${tableId.table}.` : ''}${tableId.alias || columnFilter.column}`
    }

    // กรณีพิเศษสำหรับ INUSE ไม่ต้องใช้ฟังก์ชัน
    if (columnFilter.column === 'INUSE') {
      columnFns = ''
    }

    // Map ของฟังก์ชันที่ใช้ใน SQL Queries
    const operatorMap: Record<string, string> = {
      contains: `LIKE '%${columnFilter.value}%'`,
      startsWith: `LIKE '${columnFilter.value}%'`,
      endsWith: `LIKE '%${columnFilter.value}'`,
      equals: `= '${columnFilter.value}'`,
      notEquals: `!= '${columnFilter.value}'`,
      greaterThan: `> '${columnFilter.value}'`,
      greaterThanOrEqualTo: `>= '${columnFilter.value}'`,
      lessThan: `< '${columnFilter.value}'`,
      lessThanOrEqualTo: `<= '${columnFilter.value}'`,
    }

    // ถ้ามี columnFns ที่ตรงกับ map ให้ใช้ ถ้าไม่มีให้ใช้ IN clause
    const condition = operatorMap[columnFns] || `IN (${columnFilter.value})`

    // เพิ่มเงื่อนไข SQL โดยไม่มี AND ในตัวแรก
    if (isFirstCondition) {
      sqlWhereColumnFilter += `${tableStmt} ${condition} `
      isFirstCondition = false // เปลี่ยนตัวแปรเป็น false หลังจากผ่านตัวแรก
    } else {
      sqlWhereColumnFilter += `AND ${tableStmt} ${condition} `
    }

    return sqlWhereColumnFilter
  }, '')
}
