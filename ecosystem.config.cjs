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
      name: 'cloudflared',
      script: 'cloudflared',
      args: 'tunnel run saungstream',
      // Set to false by default, user can enable it if they have cloudflared installed
      autorestart: true,
      watch: false
    }
  ],
};
