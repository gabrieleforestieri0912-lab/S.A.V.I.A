module.exports = {
  apps: [
    {
      name: "savia-bot",
      script: "./src/index.ts",
      interpreter: "npx",
      interpreter_args: "tsx",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 3000,
      max_memory_restart: "400M",
      exp_backoff_restart_delay: 100,
      kill_timeout: 5000,
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
