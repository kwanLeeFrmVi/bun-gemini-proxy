/**
 * PM2 Ecosystem Configuration
 *
 * This configuration enables process management for the Gemini-OpenAI Proxy Server.
 * Runs the compiled binary directly (no interpreter needed).
 *
 * Usage:
 *   bunx pm2 start ecosystem.config.js
 *   bunx pm2 restart bun-gemini-proxy
 *   bunx pm2 stop bun-gemini-proxy
 *   bunx pm2 logs bun-gemini-proxy
 */

module.exports = {
  version: '0.0.1',
  apps: [
    {
      name: 'bun-gemini-proxy',
      script: './bin/bun-gemini-proxy-linux-arm64-glibc',
      interpreter: 'none', // Binary executable, no interpreter needed

      // Instance configuration
      instances: 1,
      exec_mode: 'fork', // Use 'cluster' for multiple instances with load balancing

      // Auto-restart configuration
      autorestart: true,
      watch: false, // Set to true during development if you want auto-reload
      max_memory_restart: '500M',

      // Environment variables
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
        // Config file paths (relative to project root)
        PROXY_CONFIG_PATH: './proxy.yaml',
        KEYS_CONFIG_PATH: './keys.yaml',
      },

      // Development environment (use with: pm2 start --env development)
      env_development: {
        NODE_ENV: 'development',
        PORT: 8000,
        watch: true,
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_type: 'raw', // Use raw to avoid double-wrapping pino's JSON output

      // Process control
      kill_timeout: 5000, // Time to wait for graceful shutdown before SIGKILL
      wait_ready: true, // Wait for process.send('ready') before considering app started
      listen_timeout: 10000, // Time to wait for app to be ready

      // Advanced options
      min_uptime: '10s', // Minimum uptime before considering app stable
      max_restarts: 10, // Max number of unstable restarts (within min_uptime)
      restart_delay: 4000, // Delay between automatic restarts
    },
  ],

  // PM2 Deploy Configuration
  // Note: PM2 deploy expects git-based workflow, but we use binary deployment.
  // Use the custom deploy script instead: bun deploy
  //
  // For git-based deployment, configure:
  // deploy: {
  //   production: {
  //     user: 'ec2-user',
  //     host: 'ec2-3-25-69-189.ap-southeast-2.compute.amazonaws.com',
  //     key: '~/.ssh/kwane.pem',
  //     ref: 'origin/main',
  //     repo: 'git@github.com:your-repo/bun-gemini-proxy.git',
  //     path: '/home/ec2-user/bun-gemini-proxy',
  //     'pre-deploy-local': 'bun run build:linux',
  //     'post-deploy': 'pm2 reload ecosystem.config.js --env production',
  //   }
  // }
};