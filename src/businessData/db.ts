// import mysql, { Connection, ConnectionOptions } from 'mysql2/promise'

// const connection = async (configDb: string = ''): Promise<Connection> => {
//   try {
//     const access: ConnectionOptions = {
//       multipleStatements: true,
//       host: process.env[`${configDb ? `${configDb}_` : ''}HOST`],
//       user: process.env[`${configDb ? `${configDb}_` : ''}USER_NAME`],
//       password: process.env[`${configDb ? `${configDb}_` : ''}PASSWORD`],
//       database: process.env[`${configDb ? `${configDb}_` : ''}DB`],
//       decimalNumbers: true, // This option is required to avoid rounding numbers
//       // supportBigNumbers: true,
//       // bigNumberStrings: true,
//     }

//     const con = await mysql.createConnection(access)
//     return con
//   } catch (error) {
//     console.error('Database connection failed:', error)
//     throw error
//   }
// }

// export { connection }

// db.ts
import mysql, { Pool, PoolConnection, PoolOptions } from 'mysql2/promise'

const pools = new Map<string, Pool>()

const connection = async (configDb: string = ''): Promise<PoolConnection> => {
  const key = configDb || 'DEFAULT'
  const portKey = configDb ? `${configDb}_PORT` : 'DB_PORT'
  const defaultPort = process.env.NODE_ENV === 'production' ? 3306 : 3308

  if (!pools.has(key)) {
    const access: PoolOptions = {
      multipleStatements: true,

      host: process.env[`${configDb ? `${configDb}_` : ''}HOST`],
      user: process.env[`${configDb ? `${configDb}_` : ''}USER_NAME`],
      password: process.env[`${configDb ? `${configDb}_` : ''}PASSWORD`],
      database: process.env[`${configDb ? `${configDb}_` : ''}DB`],
      port: Number(process.env[portKey] || defaultPort),

      decimalNumbers: true,

      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000,
    }

    const pool = mysql.createPool(access)
    pools.set(key, pool)
  }

  return pools.get(key)!.getConnection()
}

export { connection }
