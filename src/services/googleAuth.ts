// src/services/googleAuth.ts

import fs from "fs";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import path from "path";
import logger from "../logger";

// --- KONEKSI KE FIREBASE PAKE KUNCI ADMIN DARI BRANKAS VERCEL ---
import * as admin from "firebase-admin";

// ==========================================================
// PERBAIKAN UTAMA: BACA KUNCI DARI ENVIRONMENT VARIABLE
// ==========================================================
// Cek dulu, kalo gak ada kuncinya, langsung matiin server
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  logger.fatal(
    "FATAL ERROR: Environment variable 'FIREBASE_SERVICE_ACCOUNT_JSON' gak ditemuin. Pastiin lu udah set di Vercel."
  );
  process.exit(1);
}

// Ubah teks satu baris jadi objek JSON lagi
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
// ==========================================================

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// --- BACA CREDENTIALS.JSON (INI CARANYA MASIH SAMA) ---
function loadJsonFile(fileName: string) {
  const filePath = path.join(process.cwd(), fileName);
  try {
    const rawData = fs.readFileSync(filePath, "utf8");
    return JSON.parse(rawData);
  } catch (error) {
    logger.fatal(`FATAL ERROR: Gagal baca file '${fileName}'.`);
    process.exit(1);
  }
}
const credentials = loadJsonFile("credentials.json");
// -----------------------------------------------------------

if (!credentials || !credentials.web) {
  logger.fatal("FATAL ERROR: File credentials.json salah format!");
  process.exit(1);
}

const { client_secret, client_id, redirect_uris } = credentials.web;
const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
];

// ... Sisa file ini biarkan sama persis ...
export function generateAuthUrl(telegramId: number): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: String(telegramId),
  });
}

export async function getTokensFromCode(code: string): Promise<any> {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

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

  if (docSnap.exists) {
    return docSnap.data() as { spreadsheetId: string; tokens: any };
  } else {
    return null;
  }
}

export async function getAuthenticatedClient(
  telegramId: number
): Promise<OAuth2Client | null> {
  const userData = await getUserData(telegramId);
  if (!userData || !userData.tokens) {
    return null;
  }

  const client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
  client.setCredentials(userData.tokens);
  return client;
}
