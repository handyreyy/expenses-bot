import { GoogleGenAI } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ParsedTransaction {
  type: 'Pemasukan' | 'Pengeluaran';
  category: string;
  amount: number;
  date: string; // YYYY-MM-DD
  description: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private client: GoogleGenAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY is not set. NLP features will be disabled.');
    }
    // Initialize the new GoogleGenAI client
    this.client = new GoogleGenAI({ apiKey: apiKey || '' });
  }

  async parseTransaction(
    text: string,
    currentDate: Date = new Date(),
    options?: { forceType?: 'Pemasukan' | 'Pengeluaran' }
  ): Promise<ParsedTransaction | null> {
    if (!this.configService.get<string>('GEMINI_API_KEY')) {
        return null; 
    }

    const typeInstruction = options?.forceType 
        ? `1. FORCE Type to "${options.forceType}". Do not infer.` 
        : `1. Identify if it is "Pemasukan" (Income) or "Pengeluaran" (Expense). Default to "Pengeluaran" if ambiguous.`;

    const prompt = `
      You are a financial assistant. Parse the following user input into a structured JSON transaction.
      
      Current Date: ${currentDate.toLocaleString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric'
      })}
      
      User Input: "${text}"
      
      Rules:
      ${typeInstruction}
      2. Extract the Amount (in IDR number format). Handle "k", "rb", "ribu", "rebu", "jt", "juta" suffixes (e.g., 50k = 50000, 10 rebu = 10000).
      3. Extract the Category (short, 1-2 words).
      4. Extract the Description.
      5. Extract the Date in "YYYY-MM-DD HH:mm:ss" format. 
         - If relative date (e.g. "kemarin"), use that date with CURRENT time.
         - If specific time mentioned (e.g. "tadi pagi", "barusan"), estimate the time. "Tadi pagi" = 08:00, "Siang" = 12:00, "Sore" = 16:00, "Malam" = 20:00.
         - If NO date/time mentioned, use Current Date & Time.
      
      Output strictly in this JSON format (no markdown, no code blocks):
      {
        "type": "Pemasukan" | "Pengeluaran",
        "category": "string",
        "amount": number,
        "date": "YYYY-MM-DD HH:mm:ss",
        "description": "string"
      }
    `;

    try {
      // Use the new generateContent structure
      const response = await this.client.models.generateContent({
        model: 'gemini-3-flash-preview', 
        contents: [
            {
                role: 'user',
                parts: [{ text: prompt }]
            }
        ],
        config: {
            responseMimeType: 'application/json', // Force JSON output mode!
        }
      });
      
      const responseText = response.text;
      if (!responseText) throw new Error('Empty response from AI');

      // Clean up just in case, but responseMimeType should handle it
      const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanText);
      
      if (!parsed.amount || !parsed.category || !parsed.type) {
        throw new Error('Incomplete data parsed');
      }

      return parsed as ParsedTransaction;
    } catch (error) {
      this.logger.error('Failed to parse with Gemini (@google/genai)', error);
      return null;
    }
  }
}
