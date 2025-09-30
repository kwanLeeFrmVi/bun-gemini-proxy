import pino from "pino";

const redactPaths = ["req.headers.authorization", "geminiApiKey", "key", "keys.*.key"];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: redactPaths,
    censor: "[secure]",
  },
  base: undefined,
});

export type Logger = typeof logger;
