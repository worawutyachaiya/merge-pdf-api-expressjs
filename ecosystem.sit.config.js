module.exports = {
  apps: [
    {
      name: 'trade-compliance-web-api-7097-expressjs-sit',
      script: 'npm',
      args: 'run start:sit',
      env: {
        NODE_ENV: 'sit',
      },
    },
  ],
}
