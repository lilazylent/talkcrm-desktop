import type {Meeting} from './models.ts';
import type {TalkParticipant, TalkArtifact, TranscriptSegment} from './kontur.ts';

export type MatchConfidence = 'high'|'medium'|'low';
export interface MatchEvidence {
  type: string; strength: 'strong'|'medium'|'weak'; source: 'participant'|'title'|'retelling'|'transcript'|'crm';
  sourceRecordId: string|null; transcriptSegmentId: string|null; timestampMs: number|null; description: string;
}
export interface MatchCandidate {
  key: string; crmAccountId: string; clientId: string; contactId: number|null; companyId: number|null; dealId: string|null;
  clientLabel: string; contactLabel: string|null; companyLabel: string|null; dealLabel: string|null; stageLabel: string|null;
  score: number; confidence: MatchConfidence; clientConfidence: MatchConfidence; dealConfidence: MatchConfidence|null;
  needsReview: boolean; evidence: MatchEvidence[];
}
export interface MeetingCrmLink {
  meetingId: string; status: 'unlinked'|'proposed'|'confirmed'|'needs_review'; confirmed: MatchCandidate|null;
  candidates: MatchCandidate[]; confirmedByUser: string|null; confirmedAt: string|null; matchMethod: 'manual'|'candidate'|null;
  updatedAt: string; warning: string|null;
}
export interface MatchSelection {clientId: string; dealId: string|null; contactId?:number|null; candidateKey?:string}
export interface MatchInput {meeting: Pick<Meeting,'id'|'title'|'startedAt'>; participants: Array<TalkParticipant & {recordingId?:string;phone?:string|null}>; artifacts: TalkArtifact[]; segments: TranscriptSegment[]}
export const confidenceLabel = (value:MatchConfidence):string=>({high:'Высокая уверенность',medium:'Средняя уверенность',low:'Низкая уверенность'})[value];
export const emptyCrmLink = (meetingId:string):MeetingCrmLink=>({meetingId,status:'unlinked',confirmed:null,candidates:[],confirmedByUser:null,confirmedAt:null,matchMethod:null,updatedAt:'',warning:null});
export function meetingCrmLabel(meeting:Meeting):string {const link=meeting.crmLink;return link?.confirmed?`${link.confirmed.clientLabel}${link.confirmed.dealLabel?' · '+link.confirmed.dealLabel:' · Без сделки'}`:link?.candidates.length?'Найдена возможная сделка':'Нужно выбрать клиента';}
