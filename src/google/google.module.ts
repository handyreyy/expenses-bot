import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GoogleAuthService } from './google-auth.service';
import { GoogleSheetService } from './google-sheet.service';

@Module({
  imports: [ConfigModule],
  providers: [GoogleAuthService, GoogleSheetService],
  exports: [GoogleAuthService, GoogleSheetService],
})
export class GoogleModule {}
