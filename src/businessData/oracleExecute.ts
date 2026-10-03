import oracledb from 'oracledb'

export const OracleExecute = {
  search: async <T>(query: string): Promise<T[]> => {
    let connection: oracledb.Connection | undefined

    try {
      connection = await oracledb.getConnection({
        user: process.env.PRONES_USER,
        password: process.env.PRONES_PASSWORD,
        connectString: process.env.PRONES_CONNECTION_STRING,
      })

      const result = await connection.execute<T>(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })
      return (result.rows || []) as T[]
    } finally {
      await connection?.close()
    }
  },
}
