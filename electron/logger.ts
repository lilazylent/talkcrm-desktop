import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warning' | 'error';
export class LocalLogger {
  private readonly filePath: string;
  constructor(directory: string) { fs.mkdirSync(directory, { recursive: true }); this.filePath = path.join(directory, 'talkcrm.log'); }
  write(level: LogLevel, message: string): void {
    const safe = message.replace(/(token|password|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]');
    fs.appendFileSync(this.filePath, `${new Date().toISOString()} [${level}] ${safe}\n`);
  }
}
