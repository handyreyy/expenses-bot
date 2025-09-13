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

const { client_secret, client_id, redirect_uris } = credentials.web as {
  client_secret: string;
  client_id: string;
  redirect_uris: string[];
};

function pickRedirectUri(): string {
  const base = process.env.SERVER_URL || ""; // ex: https://.../api
  const wanted = base ? `${base.replace(/\/$/, "")}/oauth2callback` : undefined;
  const chosen =
    (wanted && redirect_uris?.find((u) => u === wanted)) || redirect_uris?.[0];
  if (!chosen) {
    logger.fatal("FATAL: Tidak menemukan redirect_uri yang valid.");
    process.exit(1);
  }
  return chosen;
}

const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  pickRedirectUri()
);

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
  const authClient = new google.auth.OAuth2(
    client_id,
    client_secret,
    pickRedirectUri()
  );
  const { tokens } = await authClient.getToken(code);
  authClient.setCredentials(tokens);
  return { authClient, tokens };
}

export function generateAuthUrl(telegramId: number): string {
  (oauth2Client as any).redirectUri = pickRedirectUri();
  return oauth2Client.generateAuthUrl({
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
  const userRef = db.collection("users").doc(String(telegramId));
  await userRef.set(data, { merge: true });
}

export async function getUserData(
  telegramId: number
): Promise<{ spreadsheetId: string; tokens: any } | null> {
  const userRef = db.collection("users").doc(String(telegramId));
  const docSnap = await userRef.get();
  return docSnap.exists
    ? (docSnap.data() as { spreadsheetId: string; tokens: any })
    : null;
}

export async function getAuthenticatedClient(
  telegramId: number
): Promise<OAuth2Client | null> {
  const userData = await getUserData(telegramId);
  if (!userData?.tokens) return null;
  const client = new google.auth.OAuth2(
    client_id,
    client_secret,
    pickRedirectUri()
  );
  client.setCredentials(userData.tokens);
  return client;
}

// Tambahan: util untuk reset otentikasi user
export async function clearUserData(telegramId: number) {
  await db.collection("users").doc(String(telegramId)).delete();
}
