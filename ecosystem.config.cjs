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
  ],
};
