import * as admin from "firebase-admin";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import logger from "../logger";

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  logger.fatal(
    "FATAL ERROR: Environment variable 'FIREBASE_SERVICE_ACCOUNT_JSON' gak ditemuin. Pastiin lu udah set di Vercel."
  );
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

if (!process.env.GOOGLE_CREDENTIALS_JSON) {
  logger.fatal(
    "FATAL ERROR: Environment variable 'GOOGLE_CREDENTIALS_JSON' gak ditemuin. Pastiin lu udah set di Vercel."
  );
  process.exit(1);
}
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

if (!credentials || !credentials.web) {
  logger.fatal("FATAL ERROR: GOOGLE_CREDENTIALS_JSON salah format!");
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

export function createNewAuthenticatedClient(code: string) {
  const authClient = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
  return authClient.getToken(code).then(({ tokens }) => {
    authClient.setCredentials(tokens);
    return { authClient, tokens };
  });
}

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
