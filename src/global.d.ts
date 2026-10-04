import type { DesktopApi } from './services/contracts.ts';

declare global {
  interface Window { talkcrm?: DesktopApi }
}
export {};
