import type { AiProvider, AmoCrmAdapter, KonturTalkAdapter } from './contracts.ts';
import type {TalkImport} from '../domain/kontur.ts';
import type { Client, Deal, Meeting } from '../domain/models.ts';

export class MockAmoCrmAdapter implements AmoCrmAdapter {
  readonly kind = 'amoCRM';
  async fetchClients(): Promise<Client[]> { return []; }
  async fetchDeals(): Promise<Deal[]> { return []; }
}
export class MockKonturTalkAdapter implements KonturTalkAdapter {
  async identify(){return{externalUserId:null,displayName:null};}
  async fetchMeetings(): Promise<TalkImport[]> { return []; }
}
export class MockAiProvider implements AiProvider {
  readonly kind = 'AI';
  async summarize(meeting: Meeting): Promise<string> { void meeting; throw new Error('AI is not available in Phase 1'); }
}
