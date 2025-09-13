// src/services/googleAuth.ts
import * as admin from "firebase-admin";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import logger from "../logger";

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  logger.fatal("FATAL: FIREBASE_SERVICE_ACCOUNT_JSON tidak ditemukan.");
  process.exit(1);
}
if (!process.env.GOOGLE_CREDENTIALS_JSON) {
  logger.fatal("FATAL: GOOGLE_CREDENTIALS_JSON tidak ditemukan.");
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

if (!credentials?.web) {
  logger.fatal("FATAL: GOOGLE_CREDENTIALS_JSON salah format (tanpa 'web').");
  process.exit(1);
}

const { client_secret, client_id } = credentials.web as {
  client_secret: string;
  client_id: string;
};

// === Redirect URI SELALU dari SERVER_URL (/api) ===
export function getRedirectUri(): string {
  const base = (process.env.SERVER_URL || "").replace(/\/$/, ""); // ex: https://.../api
  if (!base) {
    logger.fatal(
      "FATAL: SERVER_URL belum di-set. Contoh: https://<domain>/api"
    );
    process.exit(1);
  }
  return `${base}/oauth2callback`;
}

function newOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(client_id, client_secret, getRedirectUri());
}

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
];

export async function createNewAuthenticatedClient(code: string): Promise<{
  authClient: OAuth2Client;
  tokens: any;
}> {
  const authClient = newOAuthClient();
  const { tokens } = await authClient.getToken(code);
  authClient.setCredentials(tokens);
  return { authClient, tokens };
}

export function generateAuthUrl(telegramId: number): string {
  const client = newOAuthClient(); // PENTING: jangan reuse instance lama
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: String(telegramId),
  });
}

export async function saveUserData(
  telegramId: number,
  data: { spreadsheetId: string; tokens: any }
) {
  await db
    .collection("users")
    .doc(String(telegramId))
    .set(data, { merge: true });
}

export async function getUserData(
  telegramId: number
): Promise<{ spreadsheetId: string; tokens: any } | null> {
  const snap = await db.collection("users").doc(String(telegramId)).get();
  return snap.exists
    ? (snap.data() as { spreadsheetId: string; tokens: any })
    : null;
}

export async function getAuthenticatedClient(
  telegramId: number
): Promise<OAuth2Client | null> {
  const userData = await getUserData(telegramId);
  if (!userData?.tokens) return null;
  const client = newOAuthClient();
  client.setCredentials(userData.tokens);
  return client;
}

export async function clearUserData(telegramId: number) {
  await db.collection("users").doc(String(telegramId)).delete();
}
