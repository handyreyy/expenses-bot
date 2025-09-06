import pino from "pino";

const isProduction = process.env.VERCEL_ENV === "production";

const transport = isProduction
  ? undefined
  : pino.transport({
      target: "pino-pretty",
      options: { colorize: true },
    });

const logger = pino(
  {
    level: "info",
    base: {
      pid: false,
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  },
  transport
);

export default logger;
