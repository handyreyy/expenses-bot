import { config as dotenv } from "dotenv";
import logger from "./logger";
dotenv();

export const NODE_ENV =
  process.env.VERCEL_ENV || process.env.NODE_ENV || "development";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    logger.fatal(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

export const SERVER_URL = reqEnv("SERVER_URL").replace(/\/$/, "");

export const TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET || "local-dev-secret";

export const WEBHOOK_PATH = `/telegraf/${TELEGRAM_WEBHOOK_SECRET}`;

export const GOOGLE_CREDENTIALS = JSON.parse(reqEnv("GOOGLE_CREDENTIALS_JSON"));
export const GOOGLE_CLIENT_ID = GOOGLE_CREDENTIALS?.web?.client_id as string;
export const GOOGLE_CLIENT_SECRET = GOOGLE_CREDENTIALS?.web
  ?.client_secret as string;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  logger.fatal(
    "GOOGLE_CREDENTIALS_JSON.web must contain client_id & client_secret"
  );
  process.exit(1);
}

export function getRedirectUri(): string {
  return `${SERVER_URL}/oauth2callback`;
}
