import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
const userData=path.join(process.env.APPDATA!,'TalkCRM Desktop');
const file=path.join(userData,'talkcrm.sqlite');
const out=path.join(process.cwd(),'docs','validation');
const SQL=await initSqlJs();const db=new SQL.Database(new Uint8Array(fs.readFileSync(file)));
const values=(sql:string)=>db.exec(sql)[0]?.values??[];
const report={migrations:values('SELECT version,name FROM schema_migrations ORDER BY version'),profile:values('SELECT * FROM users'),settings:values('SELECT key,value FROM app_settings ORDER BY key'),counts:Object.fromEntries(['clients','deals','meetings','tasks','templates'].map(table=>[table,values(`SELECT COUNT(*) FROM ${table}`)[0][0]]))};db.close();
fs.mkdirSync(out,{recursive:true});
if(process.argv.includes('--before')){fs.writeFileSync(path.join(out,'upgrade-before.json'),JSON.stringify(report,null,2));console.log('Phase 1 baseline captured without modifying database.');}
else{const before=JSON.parse(fs.readFileSync(path.join(out,'upgrade-before.json'),'utf8')) as typeof report;if(JSON.stringify(before.profile)!==JSON.stringify(report.profile)||JSON.stringify(before.counts)!==JSON.stringify(report.counts)||before.settings.some(([key,value])=>!report.settings.some(([k,v])=>k===key&&v===value))||!report.migrations.some(([version])=>version===2))throw new Error('Upgrade did not preserve Phase 1 data');fs.writeFileSync(path.join(out,'upgrade-after.json'),JSON.stringify({...report,preserved:true},null,2));console.log('Migration 002 verified: profile, existing settings and all Phase 1 entity counts preserved.');}
