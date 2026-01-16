import { Module } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { BotController } from './bot.controller';
import { BotUpdate } from './bot.update';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [GoogleModule],
  providers: [BotUpdate],
  controllers: [BotController, WebhookController],
})
export class BotModule {}
