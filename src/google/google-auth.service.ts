import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

export interface UserData {
  spreadsheetId: string;
  tokens: any;
}

@Injectable()
export class GoogleAuthService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAuthService.name);
  private db!: admin.firestore.Firestore;
  private readonly scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    const serviceAccountJson = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!serviceAccountJson) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not found');
    }
    
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
      });
    }
    this.db = admin.firestore();
  }

  private getRedirectUri(): string {
    const serverUrl = this.configService.get<string>('SERVER_URL');
    if (!serverUrl) throw new Error('SERVER_URL not set');
    return `${serverUrl.replace(/\/$/, '')}/oauth2callback`;
  }

  private getCredentials() {
    const json = this.configService.get<string>('GOOGLE_CREDENTIALS_JSON');
    if (!json) throw new Error('GOOGLE_CREDENTIALS_JSON not found');
    const parsed = JSON.parse(json);
    return parsed.web;
  }

  private createOAuthClient(): OAuth2Client {
    const creds = this.getCredentials();
    return new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      this.getRedirectUri(),
    );
  }

  generateAuthUrl(telegramId: number): string {
    const client = this.createOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: this.scopes,
      state: String(telegramId),
    });
  }

  async createNewAuthenticatedClient(code: string): Promise<{
    authClient: OAuth2Client;
    tokens: any;
  }> {
    const authClient = this.createOAuthClient();
    const { tokens } = await authClient.getToken(code);
    authClient.setCredentials(tokens);
    return { authClient, tokens };
  }

  async saveUserData(telegramId: number, data: UserData) {
    await this.db
      .collection('users')
      .doc(String(telegramId))
      .set(data, { merge: true });
  }

  async getUserData(telegramId: number): Promise<UserData | null> {
    const snap = await this.db.collection('users').doc(String(telegramId)).get();
    return snap.exists ? (snap.data() as UserData) : null;
  }

  async clearUserData(telegramId: number) {
    await this.db.collection('users').doc(String(telegramId)).set(
      { tokens: null },
      { merge: true },
    );
  }

  async getAuthenticatedClient(telegramId: number): Promise<OAuth2Client | null> {
    const userData = await this.getUserData(telegramId);
    if (!userData?.tokens) return null;
    
    const client = this.createOAuthClient();
    client.setCredentials(userData.tokens);

    // Auto-refresh handling
    client.on('tokens', async (tokens) => {
      this.logger.log(`Refreshing tokens for user ${telegramId}`);
      // Fetch latest data to ensure we don't overwrite/lose refresh_token if not present in new event
      const currentData = await this.getUserData(telegramId);
      if (currentData && currentData.tokens) {
         const newTokens = { ...currentData.tokens, ...tokens };
         await this.saveUserData(telegramId, { ...currentData, tokens: newTokens });
      }
    });

    return client;
  }
}
