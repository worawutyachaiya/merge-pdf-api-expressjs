module.exports = {
  apps: [
    {
      name: 'trade-compliance-web-api-7097-expressjs-uat',
      script: 'npm',
      args: 'run start:uat',
      env: {
        NODE_ENV: 'uat',
      },
      out_file: '/dev/null',
      error_file: '/dev/null',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
