module.exports = {
  apps: [
    {
      name: 'saungstream',
      script: 'server.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ngrok',
      script: 'ngrok',
      args: 'http 3000',
      env: {
        NGROK_AUTHTOKEN: 'YOUR_NGROK_AUTHTOKEN_HERE'
      },
      // Set to false by default, user can enable it if they have ngrok installed
      autorestart: true,
      watch: false
    }
  ],
};
