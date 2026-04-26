// pm2 設定。pm2 預設讀 .cjs；專案是 ESM，所以這個 config 用 CommonJS。
module.exports = {
  apps: [
    {
      name: 'pay-discord-bot',
      script: 'src/index.js',
      node_args: '--enable-source-maps',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/out.log',
      error_file: 'logs/err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
