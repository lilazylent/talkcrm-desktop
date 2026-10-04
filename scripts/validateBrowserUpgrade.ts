import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
const root=process.cwd();const SQL=await initSqlJs();
function inspect(file:string){const db=new SQL.Database(new Uint8Array(fs.readFileSync(file)));const values=(sql:string)=>db.exec(sql)[0]?.values??[];const result={migrations:values('SELECT version FROM schema_migrations ORDER BY version'),profile:values('SELECT * FROM users'),settings:values('SELECT key,value FROM app_settings ORDER BY key'),counts:Object.fromEntries(['clients','deals','meetings','tasks','templates','crm_accounts','crm_entities','crm_fields','crm_relations'].map(table=>[table,values(`SELECT COUNT(*) FROM ${table}`)[0][0]]))};db.close();return result;}
const before=inspect(path.join(root,'release','phase2','existing-0.2.0.sqlite'));const after=inspect(path.join(process.env.APPDATA!,'TalkCRM Desktop','talkcrm.sqlite'));
if(JSON.stringify(before.profile)!==JSON.stringify(after.profile)||JSON.stringify(before.settings)!==JSON.stringify(after.settings)||JSON.stringify(before.counts)!==JSON.stringify(after.counts)||!after.migrations.some(([version])=>version===3))throw new Error('Browser upgrade did not preserve data');
fs.writeFileSync(path.join(root,'docs','validation','browser-upgrade.json'),JSON.stringify({preserved:true,before,after},null,2));console.log('Migration 003 verified: profile, settings, demo and CRM counts preserved.');
