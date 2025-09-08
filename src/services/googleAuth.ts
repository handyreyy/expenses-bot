// src/services/googleAuth.ts
import * as admin from "firebase-admin";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import logger from "../logger";

/**
 * Validasi ENV dasar
 */
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  logger.fatal(
    "FATAL: 'FIREBASE_SERVICE_ACCOUNT_JSON' tidak ditemukan. Set di Vercel Project Settings → Environment Variables."
  );
  process.exit(1);
}
if (!process.env.GOOGLE_CREDENTIALS_JSON) {
  logger.fatal(
    "FATAL: 'GOOGLE_CREDENTIALS_JSON' tidak ditemukan. Set di Vercel Project Settings → Environment Variables."
  );
  process.exit(1);
}

// Parse kredensial
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

/**
 * Inisialisasi Firebase Admin
 */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

/**
 * Ambil nilai penting dari OAuth2 Web Client
 */
if (!credentials?.web) {
  logger.fatal(
    "FATAL: GOOGLE_CREDENTIALS_JSON salah format (tidak ada properti 'web')."
  );
  process.exit(1);
}
const { client_secret, client_id, redirect_uris } = credentials.web as {
  client_secret: string;
  client_id: string;
  redirect_uris: string[];
};

/**
 * Pilih redirectUri berdasarkan SERVER_URL (ex: https://app.vercel.app/api)
 * - wanted = `${SERVER_URL}/oauth2callback`
 * - fallback = redirect_uris[0]
 */
function pickRedirectUri(): string {
  const base = process.env.SERVER_URL || ""; // e.g. https://expenses-bot-rho.vercel.app/api
  const wanted = base ? `${base.replace(/\/$/, "")}/oauth2callback` : undefined;

  const chosen =
    (wanted && redirect_uris?.find((u) => u === wanted)) || redirect_uris?.[0];

  if (!chosen) {
    logger.fatal("FATAL: Tidak menemukan redirect_uri yang valid.");
    process.exit(1);
  }
  return chosen;
}

// Client utama yang dipakai untuk generate URL auth
const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  pickRedirectUri()
);

// Scopes yang diperlukan
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
];

/**
 * Untuk exchange authorization code → tokens
 * (Dipakai di /oauth2callback)
 */
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

/**
 * Generate URL OAuth (dipakai saat user /start dan belum terhubung)
 * - state diisi telegramId agar bisa mengidentifikasi user saat callback
 */
export function generateAuthUrl(telegramId: number): string {
  // Pastikan oauth2Client selalu pakai redirectUri yang tepat (runtime cold start aman)
  (oauth2Client as any).redirectUri = pickRedirectUri();

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: String(telegramId),
  });
}

/**
 * (Opsional) kalau butuh manual exchange tanpa state handling
 */
export async function getTokensFromCode(code: string): Promise<any> {
  // Pastikan redirect match
  (oauth2Client as any).redirectUri = pickRedirectUri();

  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Simpan & ambil data user (Firestore)
 */
export async function saveUserData(
  telegramId: number,
  data: { spreadsheetId: string; tokens: any }
) {
  const userRef = db.collection("users").doc(String(telegramId));
  await userRef.set(data, { merge: true });
  logger.info({ user_id: telegramId }, "User data saved to Firestore.");
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

/**
 * Buat OAuth2Client dari tokens user agar bisa akses Google APIs
 */
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
