module.exports = {
  apps: [
    {
      name: 'merge-pdf-web-api-7105-expressjs-sit',
      script: 'npm',
      args: 'run start:sit',
      env: {
        NODE_ENV: 'sit',
      },
    },
  ],
}
