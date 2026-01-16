import { GoogleGenAI } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

export interface ParsedTransaction {
  type: 'Pemasukan' | 'Pengeluaran';
  category: string;
  amount: number;
  date: string; // YYYY-MM-DD
  description: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private geminiClient!: GoogleGenAI;
  private groqClient!: Groq;
  private primaryModel = 'gemini-3-flash-preview';
  private fallbackModel = 'llama-3.1-8b-instant';

  constructor(private readonly configService: ConfigService) {
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    const groqKey = this.configService.get<string>('GROQ_API_KEY');

    if (geminiKey) {
        this.geminiClient = new GoogleGenAI({ apiKey: geminiKey });
    } else {
        this.logger.warn('GEMINI_API_KEY missing. Parsing might fail if Groq is also missing.');
    }

    if (groqKey) {
        this.groqClient = new Groq({ apiKey: groqKey });
    } else {
        this.logger.warn('GROQ_API_KEY missing. Fallback will not work.');
    }
  }

  async parseTransaction(
    text: string,
    currentDate: Date = new Date(),
    options?: { forceType?: 'Pemasukan' | 'Pengeluaran' }
  ): Promise<ParsedTransaction | null> {
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

    // 1. Try Gemini
    if (this.geminiClient) {
        try {
            const response = await this.geminiClient.models.generateContent({
                model: this.primaryModel,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: { responseMimeType: 'application/json' }
            });
            return this.processResponse(response.text, 'Gemini');
        } catch (error: any) {
            this.handleError('Gemini', error);
        }
    }

    // 2. Fallback to Groq
    if (this.groqClient) {
        try {
            this.logger.log('Switching to Groq (Fallback)...');
            const response = await this.groqClient.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: this.fallbackModel,
                response_format: { type: 'json_object' }
            });
            return this.processResponse(response.choices[0]?.message?.content, 'Groq');
        } catch (error: any) {
             this.handleError('Groq', error);
        }
    }

    return null;
  }

  async chat(prompt: string): Promise<string> {
      const systemPrompt = `
        You are Kubera, a friendly, witty, and helpful financial assistant bot for Indonesian users.
        Style: Casual, friendly, using Indonesian slang (gaul) appropriately but polite. Use emojis ✨.
        
        Knowledge about your specific capabilities/commands:
        - /pemasukan [date] [amount] [desc] : Record income.
        - /catat [date] [category] [amount] [desc] : Record expense.
        - /total [month/year] : Show total balance.
        - /riwayat [month/year] : Show distinct transaction history.
        - /laporan : Get link to Google Sheet.
        - /budget set [category] [amount] : Set monthly budget.
        - /budget : Check budget status.
        - /undo : Delete last transaction of current month.
        - /relink : Reconnect Google Account.
        
        If user asks "How to...", explained based on these commands.
        Respond naturally.
      `;

      // 1. Try Gemini
      if (this.geminiClient) {
          try {
            const response = await this.geminiClient.models.generateContent({
                model: this.primaryModel,
                contents: [
                    { role: 'user', parts: [{ text: `${systemPrompt}\nUser: ${prompt}` }] }
                ],
            });
            return response.text || '';
          } catch(e) {
              this.handleError('Gemini Chat', e);
          }
      }

      // 2. Fallback to Groq
      if (this.groqClient) {
          try {
            this.logger.log('Switching to Groq Chat (Fallback)...');
            const response = await this.groqClient.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                model: this.fallbackModel,
            });
            return response.choices[0]?.message?.content || '';
          } catch(e) {
              this.handleError('Groq Chat', e);
          }
      }

      return 'Maaf, otak saya lagi error semua nih. 🤯';
  }

  private processResponse(text: string | undefined | null, source: string): ParsedTransaction | null {
      if (!text) return null;
      try {
          const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleanText);
          if (!parsed.amount || !parsed.category || !parsed.type) return null;
          
          this.logger.log(`Parsed successfully with ${source}`);
          return parsed as ParsedTransaction;
      } catch (e) {
          this.logger.warn(`${source} returned invalid JSON: ${text.substring(0, 50)}...`);
          return null;
      }
  }

  private handleError(source: string, error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      // Suppress common "Empty response" or "429" if we have a fallback
      if (msg.includes('429')) {
          this.logger.warn(`${source} Rate Limit Exceeded.`);
      } else {
          this.logger.error(`${source} Error: ${msg}`);
      }
  }
}
