export type SyncState = 'idle' | 'running' | 'success' | 'partial_error' | 'failed';
export interface CrmAccount { id: string; externalId: number; domain: string; name: string; currentUserId: number; authorized: boolean; expiresAt: number; lastSyncAt: string | null; state: SyncState; error: string | null; currency?:string|null; authMode?:'oauth'|'browser' }
export interface CrmRecord { id: number; name?: string; updated_at?: number; created_at?: number; [key: string]: unknown }
export interface CrmCache { account: CrmAccount | null; contacts: CrmRecord[]; companies: CrmRecord[]; pipelines: CrmRecord[]; notes: CrmRecord[]; fields: { entity: string; definition: CrmRecord }[]; leads?: CrmRecord[]; relations?: CrmRelation[]; taskTypes?: CrmRecord[]; contactNotes?: CrmRecord[]; companyNotes?: CrmRecord[]; fieldGroups?: CrmFieldGroup[]; editableNotes?: string[] }
export interface CrmFieldGroup { entity: string; id: string; name: string; sort: number }
export interface ConnectInput { domain: string; clientId: string; clientSecret: string; redirectUri: string; code: string }
export interface SyncProgress { state: SyncState; stage: string; completed: number; total: number | null }
export interface CrmResult { ok: boolean; message: string }
export interface CrmRelation { leadId: number; entityId: number; entityType: 'contacts' | 'companies'; primary: boolean }
export interface SyncBatch { account: CrmAccount; leads: CrmRecord[]; contacts: CrmRecord[]; companies: CrmRecord[]; pipelines: CrmRecord[]; relations: CrmRelation[]; tasks?: CrmRecord[]; notes?: CrmRecord[]; fields?: CrmCache['fields']; taskTypes?: CrmRecord[]; contactNotes?: CrmRecord[]; companyNotes?: CrmRecord[]; fieldGroups?: CrmFieldGroup[]; warnings: string[] }
