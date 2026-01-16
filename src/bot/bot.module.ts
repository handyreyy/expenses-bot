import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { BotController } from './bot.controller';
import { BotUpdate } from './bot.update';
import { WebhookController } from './webhook.controller';

import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [GoogleModule, GeminiModule],
  providers: [BotUpdate],
  controllers: [BotController, WebhookController],
})
export class BotModule {}
