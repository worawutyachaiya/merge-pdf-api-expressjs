export const EarStatusSQL = {
  search: async (dataItem: any) => `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM EAR_SURVEY_STATUS status
    ${dataItem.sqlWhere};

    SELECT
        status.EAR_SURVEY_STATUS_ID
      , status.EAR_SURVEY_STATUS_CODE
      , status.EAR_SURVEY_STATUS_NAME
      , status.CREATE_BY
      , DATE_FORMAT(status.CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
      , status.UPDATE_BY
      , DATE_FORMAT(status.UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
      , status.INUSE
    FROM EAR_SURVEY_STATUS status
    ${dataItem.sqlWhere}
    ORDER BY ${dataItem.Order}
    ${dataItem.sqlLimit}
  `,
}
