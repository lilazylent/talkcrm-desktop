import fs from 'node:fs';
import {hasMatching,recalculateLinks,confirmLink,unlinkMeeting} from './matching/persistence.ts';
import type {MatchSelection} from '../src/domain/matching.ts';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { seedDemo } from './seed.ts';
import type {KonturAccount,TalkImport,MeetingArtifacts,TranscriptPage} from '../src/domain/kontur.ts';
import {konturAccount,saveKonturAccount,putKonturMeetings,konturMeetings,meetingArtifacts,transcriptPage} from './konturPersistence.ts';
import type { CrmAccount, SyncBatch } from '../src/domain/crm.ts';
import { accountFromRow, beginSync, commitSync, crmSnapshot, execute, query, saveAccount } from './crmPersistence.ts';
import type { AppRepository } from '../src/services/contracts.ts';
import type { AppSnapshot, Client, Deal, Integration, Meeting, Task, UserProfile, CrmTemplate, MatchingStatus } from '../src/domain/models.ts';

type Row = Record<string, string | number | null>;
const str = (row: Row, key: string): string => String(row[key]);
const nullable = (row: Row, key: string): string | null => row[key] === null ? null : String(row[key]);
const rows = (db: Database, sql: string): Row[] => {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map(values => Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))) as Row[];
};

export class SqliteRepository implements AppRepository {
  private db: Database | null = null;
  private sql: SqlJsStatic | null = null;
  constructor(private readonly filePath: string, private readonly migrationsPath: string, private readonly appRoot: string, private readonly version = '0.2.0') {}

  async initialize(): Promise<void> {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const projectRequire = createRequire(path.join(this.appRoot, 'package.json'));
    this.sql ??= await initSqlJs({ locateFile: file => projectRequire.resolve(`sql.js/dist/${file}`) });
    this.db = fs.existsSync(this.filePath) ? new this.sql.Database(new Uint8Array(fs.readFileSync(this.filePath))) : new this.sql.Database();
    this.db.run('PRAGMA foreign_keys = ON');
    this.migrate();
    seedDemo(this.db);
    this.db.run("UPDATE sync_runs SET state='failed',finished_at=datetime('now'),warnings_json='[\"Синхронизация прервана закрытием приложения\"]' WHERE state='running'");
    this.db.run("UPDATE crm_accounts SET state='failed',error='Предыдущая синхронизация прервана. Повторите её.' WHERE state='running'");
    if(query(this.db,"SELECT name FROM sqlite_master WHERE type='table' AND name='kontur_accounts'").length){
      this.db.run("UPDATE kontur_accounts SET state='failed',error='Синхронизация прервана. Обновите встречи.' WHERE state='syncing'");
      this.db.run("UPDATE integration_sync_runs SET state='failed',finished_at=datetime('now'),error='Синхронизация прервана' WHERE state='running'");
    }
    this.persist();
  }

  private get database(): Database { if (!this.db) throw new Error('Database is not initialized'); return this.db; }
  private migrate(): void {
    const db = this.database;
    db.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const files = fs.readdirSync(this.migrationsPath).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    for (const file of files) {
      const version = Number(file.split('_')[0]);
      if (rows(db, `SELECT version FROM schema_migrations WHERE version=${version}`).length) continue;
      db.run('BEGIN TRANSACTION');
      try {
        db.exec(fs.readFileSync(path.join(this.migrationsPath, file), 'utf8'));
        const statement = db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)');
        statement.run([version, file, new Date().toISOString()]);
        statement.free();
        db.run('COMMIT');
      } catch (error) { db.run('ROLLBACK'); throw error; }
    }
  }

  private persist(): void {
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, Buffer.from(this.database.export()));
    fs.renameSync(temporary, this.filePath);
  }

  async snapshot(): Promise<AppSnapshot> {
    const db = this.database;
    const profileRow = rows(db, 'SELECT * FROM users LIMIT 1')[0];
    if (!profileRow) throw new Error('User profile missing');
    const profile: UserProfile = { id: str(profileRow,'id'), displayName: str(profileRow,'display_name'), createdAt: str(profileRow,'created_at'), updatedAt: str(profileRow,'updated_at') };
    const clients: Client[] = rows(db, 'SELECT * FROM clients ORDER BY company_name, name').map(r => ({ id: str(r,'id'), externalId: nullable(r,'external_id'), source: str(r,'source'), name: str(r,'name'), companyName: nullable(r,'company_name'), phone: nullable(r,'phone'), email: nullable(r,'email'), responsibleName: nullable(r,'responsible_name'), createdAt: str(r,'created_at'), updatedAt: str(r,'updated_at') }));
    const deals: Deal[] = rows(db, 'SELECT * FROM deals ORDER BY created_at DESC, id').map(r => ({ id: str(r,'id'), externalId: nullable(r,'external_id'), clientId: str(r,'client_id'), title: str(r,'title'), pipelineName: nullable(r,'pipeline_name'), stageName: str(r,'stage_name'), responsibleName: nullable(r,'responsible_name'), amount: r.amount === null ? null : Number(r.amount), currency: nullable(r,'currency'), createdAt: str(r,'created_at'), updatedAt: str(r,'updated_at') }));
    const meetings: Meeting[] = rows(db, "SELECT * FROM meetings WHERE source='demo' ORDER BY started_at DESC").map(r => ({ id: str(r,'id'), externalId: nullable(r,'external_id'), dealId: nullable(r,'deal_id'), clientId: nullable(r,'client_id'), title: str(r,'title'), startedAt: str(r,'started_at'), durationSeconds: r.duration_seconds === null ? null : Number(r.duration_seconds), participants: JSON.parse(str(r,'participants_json')) as string[], summary: nullable(r,'summary'), transcript: r.transcript ? JSON.parse(str(r,'transcript')) as Meeting['transcript'] : [], recordingUrl: nullable(r,'recording_url'), matchingStatus: str(r,'matching_status') as MatchingStatus, createdAt: str(r,'created_at'), updatedAt: str(r,'updated_at') }));
    const tasks: Task[] = rows(db, 'SELECT * FROM tasks ORDER BY completed, due_at').map(r => ({ id: str(r,'id'), externalId: nullable(r,'external_id'), dealId: nullable(r,'deal_id'), clientId: nullable(r,'client_id'), title: str(r,'title'), dueAt: nullable(r,'due_at'), completed: r.completed === 1, createdAt: str(r,'created_at'), updatedAt: str(r,'updated_at') }));
    const integrations: Integration[] = rows(db, 'SELECT * FROM integrations').map(r => ({ id: str(r,'id'), type: str(r,'type'), enabled: r.enabled === 1, status: str(r,'status'), accountLabel: nullable(r,'account_label'), lastSyncAt: nullable(r,'last_sync_at'), createdAt: str(r,'created_at'), updatedAt: str(r,'updated_at') }));
    const settings = Object.fromEntries(rows(db, 'SELECT * FROM app_settings').map(r => [str(r,'key'), str(r,'value')]));
    const templates: CrmTemplate[] = rows(db, 'SELECT * FROM templates ORDER BY id').map(r => ({ id: str(r,'id'), title: str(r,'title'), description: str(r,'description'), fields: JSON.parse(str(r,'fields_json')) as CrmTemplate['fields'] }));
    const account = this.getCrmAccount(); const crm = crmSnapshot(db,account);
    const real = settings.data_mode === 'amocrm';
    const kontur=this.getKonturAccount();
    return { profile, clients: real ? crm.clients : kontur?[]:clients, deals: real ? crm.deals : kontur?[]:deals, meetings: kontur?konturMeetings(db,kontur):real?[]:meetings.filter(m=>!m.source||m.source==='demo'), tasks: real ? crm.tasks : kontur?[]:tasks, integrations, settings, templates, crm: {account,contacts:crm.contacts,companies:crm.companies,pipelines:crm.pipelines,notes:crm.notes,fields:crm.fields,leads:crm.leads,relations:crm.relations},kontur, version: this.version, databaseLocation: this.filePath };
  }

  async setTaskCompleted(id: string, completed: boolean): Promise<void> {
    if (typeof id !== 'string' || typeof completed !== 'boolean' || id.startsWith('amocrm:')) throw new Error('CRM tasks are read-only');
    const statement = this.database.prepare('UPDATE tasks SET completed=?, updated_at=? WHERE id=?');
    statement.run([completed ? 1 : 0, new Date().toISOString(), id]); statement.free();
    if (this.database.getRowsModified() === 0) throw new Error('Task not found');
    this.persist();
  }
  async updateProfile(displayName: string): Promise<void> {
    if (typeof displayName !== 'string') throw new Error('Invalid display name');
    const value = displayName.trim();
    if (!value || value.length > 100) throw new Error('Invalid display name');
    const statement = this.database.prepare('UPDATE users SET display_name=?, updated_at=? WHERE id=?');
    statement.run([value, new Date().toISOString(), 'user-1']); statement.free(); this.persist();
  }
  async setSetting(key: string, value: string): Promise<void> {
    if (!(key === 'notifications' && ['on','off'].includes(value)) && !(key === 'data_mode' && ['demo','amocrm'].includes(value))) throw new Error('Invalid setting');
    const statement = this.database.prepare('UPDATE app_settings SET value=? WHERE key=?');
    statement.run([value, key]); statement.free(); this.persist();
  }
  async resetDemo(): Promise<void> {
    const db=this.database; db.run('BEGIN');
    try { db.run("DELETE FROM meetings WHERE source='demo'; DELETE FROM tasks WHERE source='demo'; DELETE FROM deals WHERE source='demo'; DELETE FROM clients WHERE source='demo'; DELETE FROM app_settings WHERE key='demo_seed_version'"); seedDemo(db,false); db.run('COMMIT'); this.persist(); } catch(error){db.run('ROLLBACK');throw error;}
  }
  private konturTransaction(action:()=>void):void {
    const before=this.database.export();
    try {this.database.run('BEGIN');action();this.database.run('COMMIT');this.persist();}
    catch(error){this.database.close();this.db=new this.sql!.Database(before);this.db.run('PRAGMA foreign_keys=ON');throw error;}
  }
  getKonturAccount():KonturAccount|null{return konturAccount(this.database);}
  ownsKonturMeeting(id:string):boolean{const a=this.getKonturAccount();return !!a&&query(this.database,"SELECT id FROM meetings WHERE id=? AND account_id=? AND source='kontur_talk'",[id,a.id]).length===1;}
  async startKonturSync(accountId:string):Promise<string>{const id=randomUUID();this.konturTransaction(()=>{execute(this.database,'INSERT INTO integration_sync_runs VALUES(?,?,?,?,?,?,?,?)',[id,'kontur_talk',accountId,'running',new Date().toISOString(),null,0,null]);execute(this.database,"UPDATE kontur_accounts SET state='syncing',error=NULL WHERE id=?",[accountId]);});return id;}
  async finishKonturSync(id:string,state:string,count:number,error:string|null):Promise<void>{this.konturTransaction(()=>execute(this.database,'UPDATE integration_sync_runs SET state=?,finished_at=?,meeting_count=?,error=? WHERE id=?',[state,new Date().toISOString(),count,error,id]));}
  async connectKontur(account:KonturAccount):Promise<void>{this.konturTransaction(()=>saveKonturAccount(this.database,account));}
  async commitKonturMeetings(account:KonturAccount,items:TalkImport[]):Promise<void>{this.konturTransaction(()=>{putKonturMeetings(this.database,account,items);this.recalculateMatching();});}
  getMeetingArtifacts(id:string):MeetingArtifacts{return meetingArtifacts(this.database,id);}
  getTranscriptPage(id:string,offset:number,limit:number,search:string):TranscriptPage{return transcriptPage(this.database,id,offset,limit,search);}
  async disconnectKontur(purge:boolean):Promise<void>{const a=this.getKonturAccount();if(!a)return;this.konturTransaction(()=>{if(purge){execute(this.database,"DELETE FROM meetings WHERE source='kontur_talk' AND account_id=?",[a.id]);execute(this.database,'DELETE FROM integration_sync_runs WHERE account_id=?',[a.id]);}execute(this.database,"UPDATE kontur_accounts SET state='disconnected',error=NULL WHERE id=?",[a.id]);});}
  getCrmAccount(): CrmAccount|null { const setting=query(this.database,"SELECT value FROM app_settings WHERE key='active_crm_account'")[0]; if(!setting)return null;const row=query(this.database,'SELECT * FROM crm_accounts WHERE id=?',[String(setting.value)])[0];return row?accountFromRow(row):null; }
  async connectAccount(account:CrmAccount):Promise<void>{saveAccount(this.database,account);execute(this.database,"INSERT INTO app_settings(key,value) VALUES('active_crm_account',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[account.id]);execute(this.database,"UPDATE app_settings SET value='amocrm' WHERE key='data_mode'");this.persist();}
  async setCrmExpiry(expiresAt:number):Promise<void>{const account=this.getCrmAccount();if(account){execute(this.database,'UPDATE crm_accounts SET expires_at=? WHERE id=?',[expiresAt,account.id]);this.persist();}}
  async startSync():Promise<string>{const account=this.getCrmAccount();if(!account)throw new Error('No account');const id=beginSync(this.database,account.id);this.persist();return id;}
  async commitCrmSync(batch:SyncBatch,runId:string):Promise<void>{
    const before=this.database.export();
    try{commitSync(this.database,batch,runId);this.recalculateMatching();this.persist();}catch(error){this.database.close();this.db=new this.sql!.Database(before);this.db.run('PRAGMA foreign_keys=ON');throw error;}
  }
  async failSync(runId:string,message:string,unauthorized=false):Promise<void>{const account=this.getCrmAccount();if(!account)return;execute(this.database,'UPDATE crm_accounts SET state=?,error=?,authorized=? WHERE id=?',['failed',message,unauthorized?0:account.authorized?1:0,account.id]);execute(this.database,'UPDATE sync_runs SET state=?,finished_at=?,warnings_json=? WHERE id=?',['failed',new Date().toISOString(),JSON.stringify([message]),runId]);this.persist();}
  async disconnectAccount(purge:boolean):Promise<void>{const account=this.getCrmAccount();if(!account)return;const db=this.database;db.run('BEGIN');try{if(purge){for(const table of ['crm_entities','crm_relations','crm_fields','sync_runs'])execute(db,`DELETE FROM ${table} WHERE account_id=?`,[account.id]);execute(db,'DELETE FROM crm_accounts WHERE id=?',[account.id]);db.run("DELETE FROM app_settings WHERE key='active_crm_account'; UPDATE app_settings SET value='demo' WHERE key='data_mode'");}else execute(db,"UPDATE crm_accounts SET authorized=0,state='idle',error=NULL WHERE id=?",[account.id]);db.run('COMMIT');this.persist();}catch(error){db.run('ROLLBACK');throw error;}}
  private recalculateMatching(id?:string):number{return hasMatching(this.database)?recalculateLinks(this.database,this.getCrmAccount(),this.getKonturAccount(),id):0;}
  async findMeetingClients(id?:string):Promise<AppSnapshot>{if(id&&!this.ownsKonturMeeting(id))throw new Error('Invalid meeting');this.konturTransaction(()=>{recalculateLinks(this.database,this.getCrmAccount(),this.getKonturAccount(),id,!id);});return this.snapshot();}
  async confirmMeetingClient(id:string,selection:MatchSelection):Promise<AppSnapshot>{if(!this.ownsKonturMeeting(id))throw new Error('Invalid meeting');this.konturTransaction(()=>confirmLink(this.database,id,selection,this.getCrmAccount()));return this.snapshot();}
  async unlinkMeetingClient(id:string):Promise<AppSnapshot>{if(!this.ownsKonturMeeting(id))throw new Error('Invalid meeting');this.konturTransaction(()=>unlinkMeeting(this.database,id,this.getCrmAccount()));return this.snapshot();}
  getTranscriptLocation(id:string,segmentId:string):number{if(typeof segmentId!=='string'||segmentId.length>100)throw new Error('Invalid segment');const segment=query(this.database,'SELECT recording_id,sequence FROM transcript_segments WHERE meeting_id=? AND id=?',[id,segmentId])[0];if(!segment)throw new Error('Segment unavailable');return Number(query(this.database,'SELECT COUNT(*) AS n FROM transcript_segments WHERE meeting_id=? AND (recording_id<? OR (recording_id=? AND sequence<?))',[id,segment.recording_id,segment.recording_id,segment.sequence])[0].n);}
  close(): void { this.db?.close(); this.db = null; }
}
