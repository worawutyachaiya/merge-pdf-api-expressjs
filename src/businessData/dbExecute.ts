// import { createPool } from './db'

// export const MySQLExecute = {
//   // For SELECT
//   search: async (query: string, configDb: string = '') => {
//     const pool = await createPool(configDb)
//     try {
//       const [rows] = await pool.query(query)
//       return rows
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       console.error('Error Query:', query)
//       throw error
//     }
//   },

//   searchList: async (sqlList: string[], configDb: string = '') => {
//     const pool = await createPool(configDb)
//     const listRowData = []
//     try {
//       for (let i = 0; i < sqlList.length; i++) {
//         const sql = sqlList[i]
//         try {
//           const [rows] = await pool.query(sql)
//           listRowData.push(rows)
//         } catch (innerError) {
//           console.error('Error in Query:', sql)
//           throw innerError
//         }
//       }
//       return listRowData
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       throw error
//     }
//   },

//   // For INSERT, UPDATE, DELETE, TRUNCATE, etc.
//   execute: async (query: string, configDb: string = '') => {
//     const pool = await createPool(configDb)
//     try {
//       const [ResultSetHeader] = await pool.query(query)
//       return ResultSetHeader
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       console.error('Error Query:', query)
//       throw error
//     }
//   },

//   executeList: async (sqlList: string[], configDb: string = '') => {
//     const pool = await createPool(configDb)
//     const listResultSetHeader = []
//     const connection = await pool.getConnection()
//     try {
//       await connection.beginTransaction()

//       for (let i = 0; i < sqlList.length; i++) {
//         const sql = sqlList[i]
//         try {
//           const [ResultSetHeader] = await connection.query(sql)
//           listResultSetHeader.push(ResultSetHeader)
//         } catch (innerError) {
//           console.error('Error in Query:', sql)
//           throw innerError
//         }
//       }

//       await connection.commit()
//       return listResultSetHeader
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       if (connection) await connection.rollback()
//       throw error
//     } finally {
//       if (connection) connection.release()
//     }
//   },

//   // For Stored Procedure
//   callProcedure: async (query: string, args: any[] = [], configDb: string = '') => {
//     const pool = await createPool(configDb)
//     try {
//       const [rows] = await pool.query(query, args)
//       return rows
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       console.error('Error Query:', query)
//       console.error('Error Arguments:', args)
//       throw error
//     }
//   },
// }

// import { connection } from './db'

// export const MySQLExecute = {
//   // For SELECT
//   search: async (query: string, configDb: string = '') => {
//     let conn = null
//     try {
//       conn = await connection(configDb)
//       const [rows] = await conn.query(query)
//       return rows
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       console.error('Error Query:', query)
//       throw error
//     } finally {
//       if (conn) await conn.end()
//     }
//   },

//   searchList: async (sqlList: string[], configDb: string = '') => {
//     let conn = null
//     let listRowData = []
//     try {
//       conn = await connection(configDb)

//       for (let i = 0; i < sqlList.length; i++) {
//         const sql = sqlList[i]
//         try {
//           const [rows] = await conn.query(sql)
//           listRowData.push(rows)
//         } catch (innerError) {
//           console.error('Error in Query:', sql)
//           throw innerError
//         }
//       }

//       return listRowData
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       throw error
//     } finally {
//       if (conn) await conn.end()
//     }
//   },

//   // For INSERT, UPDATE, DELETE, TRUNCATE, etc.
//   execute: async (query: string, configDb: string = '') => {
//     let conn = null
//     try {
//       conn = await connection(configDb)
//       const [ResultSetHeader] = await conn.query(query)
//       return ResultSetHeader
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       console.error('Error Query:', query)
//       throw error
//     } finally {
//       if (conn) await conn.end()
//     }
//   },

//   executeList: async (sqlList: string[], configDb: string = '') => {
//     let conn = null
//     let listResultSetHeader = []
//     try {
//       conn = await connection(configDb)
//       await conn.beginTransaction()

//       for (let i = 0; i < sqlList.length; i++) {
//         const sql = sqlList[i]
//         try {
//           const [ResultSetHeader] = await conn.query(sql)
//           listResultSetHeader.push(ResultSetHeader)
//         } catch (innerError) {
//           console.error('Error in Query:', sql)
//           throw innerError
//         }
//       }

//       await conn.commit()
//       return listResultSetHeader
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       if (conn) await conn.rollback()
//       throw error
//     } finally {
//       if (conn) await conn.end()
//     }
//   },

//   // For Stored Procedure
//   callProcedure: async (query: string, args: any[] = [], configDb: string = '') => {
//     let conn = null
//     try {
//       conn = await connection(configDb)
//       const [rows] = await conn.query(query, args)
//       return rows
//     } catch (error: any) {
//       console.error('Error Message:', error.message)
//       console.error('Error Query:', query)
//       console.error('Error Arguments:', args)
//       throw error
//     } finally {
//       if (conn) await conn.end()
//     }
//   },
// }

// MySQLExecute.ts
import { connection } from './db'
import type { PoolConnection, QueryResult } from 'mysql2/promise'

export const MySQLExecute = {
  // Parameterized operations for binary content and new features. SQL and values are never logged.
  queryParams: async <T extends QueryResult>(sql: string, values: readonly unknown[] = [], configDb = ''): Promise<T> => {
    const conn = await connection(configDb)
    try {
      const [rows] = await conn.query<T>(sql, [...values])
      return rows
    } finally {
      conn.release()
    }
  },

  withTransaction: async <T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> => {
    const conn = await connection()
    try {
      await conn.beginTransaction()
      const result = await work(conn)
      await conn.commit()
      return result
    } catch (error: unknown) {
      await conn.rollback()
      throw error
    } finally {
      conn.release()
    }
  },
  // SELECT
  search: async (query: string, configDb: string = '') => {
    let conn: any = null
    try {
      conn = await connection(configDb)
      const [rows] = await conn.query(query)
      return rows
    } catch (error: any) {
      console.error('Error Message:', error.message)
      console.error('Error Query:', query)
      throw error
    } finally {
      if (conn) conn.release()
    }
  },

  searchList: async (sqlList: string[], configDb: string = '') => {
    let conn: any = null
    const listRowData: any[] = []
    try {
      conn = await connection(configDb)

      for (let i = 0; i < sqlList.length; i++) {
        const sql = sqlList[i]
        try {
          const [rows] = await conn.query(sql)
          listRowData.push(rows)
        } catch (innerError) {
          console.error('Error in Query:', sql)
          throw innerError
        }
      }

      return listRowData
    } finally {
      if (conn) conn.release()
    }
  },

  // INSERT / UPDATE / DELETE
  execute: async (query: string, configDb: string = '') => {
    let conn: any = null
    try {
      conn = await connection(configDb)
      const [result] = await conn.query(query)
      return result
    } catch (error: any) {
      console.error('Error Message:', error.message)
      console.error('Error Query:', query)
      throw error
    } finally {
      if (conn) conn.release()
    }
  },

  executeList: async (sqlList: string[], configDb: string = '') => {
    let conn: any = null
    const listResult: any[] = []
    try {
      conn = await connection(configDb)
      await conn.beginTransaction()

      for (let i = 0; i < sqlList.length; i++) {
        const sql = sqlList[i]
        try {
          const [result] = await conn.query(sql)
          listResult.push(result)
        } catch (innerError) {
          console.error('Error in Query:', sql)
          throw innerError
        }
      }

      await conn.commit()
      return listResult
    } catch (error) {
      if (conn) await conn.rollback()
      throw error
    } finally {
      if (conn) conn.release()
    }
  },

  // Stored Procedure
  callProcedure: async (query: string, args: any[] = [], configDb: string = '') => {
    let conn: any = null
    try {
      conn = await connection(configDb)
      const [rows] = await conn.query(query, args)
      return rows
    } catch (error: any) {
      console.error('Error Message:', error.message)
      console.error('Error Query:', query)
      console.error('Error Arguments:', args)
      throw error
    } finally {
      if (conn) conn.release()
    }
  },
}
