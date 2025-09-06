// src/services/googleAuth.ts

import fs from "fs";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import path from "path";
import logger from "../logger";

// --- KONEKSI KE FIREBASE ---
import { initializeApp } from "firebase/app";
// TAMBAHIN 'setLogLevel' DI SINI
import {
  doc,
  getDoc,
  getFirestore,
  setDoc,
  setLogLevel,
} from "firebase/firestore";

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG!);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==========================================================
// TAMBAHIN INI BUAT NYURUH FIREBASE DIEM
// ==========================================================
// Cuma tampilin log kalo ada error beneran
setLogLevel("error");
// ==========================================================

let credentials;
const credentialsPath = path.join(__dirname, "..", "..", "credentials.json");

try {
  const rawData = fs.readFileSync(credentialsPath, "utf8");
  credentials = JSON.parse(rawData);
} catch (error) {
  logger.fatal(
    "FATAL ERROR: File 'credentials.json' tidak dapat dibaca atau ditemukan."
  );
  process.exit(1);
}

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

// --- FUNGSI BARU DENGAN FIRESTORE ---
export async function saveUserData(
  telegramId: number,
  data: { spreadsheetId: string; tokens: any }
) {
  const userRef = doc(db, "users", String(telegramId));
  await setDoc(userRef, data, { merge: true });
  logger.info({ user_id: telegramId }, "User data saved to Firestore.");
}

export async function getUserData(
  telegramId: number
): Promise<{ spreadsheetId: string; tokens: any } | null> {
  const userRef = doc(db, "users", String(telegramId));
  const docSnap = await getDoc(userRef);

  if (docSnap.exists()) {
    return docSnap.data() as { spreadsheetId: string; tokens: any };
  } else {
    return null;
  }
}
// -------------------------------------

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
