module.exports = {
  apps: [
    {
      name: 'trade-compliance-web-api-7097-expressjs',
      script: 'npm',
      args: 'run start:prod',
      env: {
        NODE_ENV: 'production',
      },
      out_file: '/dev/null', // Prevent output logs
      error_file: '/dev/null', // Prevent error logs
      log_date_format: 'YYYY-MM-DD HH:mm:ss', // Optional: Disable timestamps
    },
  ],
}
