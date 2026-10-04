export type KonturMode = 'api' | 'session';
export type ArtifactState = 'not_available' | 'processing' | 'ready' | 'failed';
export type ArtifactType = 'recording' | 'transcript' | 'summary' | 'protocol';
export interface TalkParticipant { externalId: string|null; displayName: string; email: string|null; phone?:string|null; role: string|null; organizer: boolean|null }
export interface TranscriptSegment { id: string; meetingId: string; recordingId: string; sequence: number; externalId: string|null; speakerId: string|null; speakerName: string; startMs: number|null; endMs: number|null; text: string }
export interface TalkArtifact { suppressed?: boolean; recordingId: string; type: ArtifactType; state: ArtifactState; externalId: string|null; version: string|null; generatedAt: string|null; text: string|null; sections: Array<{type:string|null;text:string;timestampMs:number|null;version:string|null}>; sourceUrl: string|null }
export interface TalkImport { meetingExternalId: string|null; recordingExternalId: string; title: string; startedAt: string|null; endedAt: string|null; durationSeconds: number|null; organizer: string|null; sourceCreatedAt: string|null; sourceUpdatedAt: string|null; participants: TalkParticipant[]; artifacts: TalkArtifact[]; segments: Omit<TranscriptSegment,'id'|'meetingId'|'sequence'>[] }
export interface KonturAccount { id: string; domain: string; mode: KonturMode; externalUserId: string|null; displayName: string|null; state: 'connected'|'disconnected'|'needs_login'|'syncing'|'failed'; lastSyncAt: string|null; error: string|null; meetingCount: number }
export interface KonturConnectInput { mode: KonturMode; domain: string; apiKey?: string }
export interface KonturResult { ok: boolean; message: string }
export interface KonturProgress { completed: number; total: number; message: string }
export interface MeetingArtifacts { participants: TalkParticipant[]; artifacts: TalkArtifact[] }
export interface TranscriptPage { segments: TranscriptSegment[]; total: number; offset: number }
export const artifactLabel = (state:ArtifactState):string=>({not_available:'Недоступно',processing:'Готовится',ready:'Готово',failed:'Ошибка подготовки'})[state];
export function formatTimestamp(ms:number|null):string { if(ms===null)return '—'; const seconds=Math.floor(ms/1000);const fraction=ms%1000;return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}${fraction?'.'+Math.floor(fraction).toString().padStart(3,'0'):''}`; }
