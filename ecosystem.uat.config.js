module.exports = {
  apps: [
    {
      name: 'merge-pdf-web-api-7105-expressjss-uat',
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
