export interface ResponseI {
  Message: string
  MethodOnDb: string
  ResultOnDb: Array<any> | {}
  Status: boolean
  TotalCountOnDb: number
}
