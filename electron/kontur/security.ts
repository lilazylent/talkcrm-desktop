export class KonturError extends Error {constructor(public readonly code:string,message:string,public readonly status?:number){super(message);}}
export function normalizeTalkDomain(value:unknown):string {
  if(typeof value!=='string'||value.length>200)throw new KonturError('domain','Укажите адрес рабочего пространства Толка.');
  let domain=value.trim().toLowerCase();if(domain.startsWith('https://')){const u=new URL(domain);if(u.pathname!=='/'||u.search||u.hash||u.username||u.password||u.port)throw new KonturError('domain','Укажите адрес пространства без пути.');domain=u.hostname;}
  if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ktalk\.ru$/.test(domain)||domain==='app.ktalk.ru')throw new KonturError('domain','Укажите адрес вашего пространства вида company.ktalk.ru.');
  return domain;
}
export const authHosts=['passport.skbkontur.ru','identity.kontur.ru','auth.kontur.ru','auth-gateway.kontur.ru','app.ktalk.ru','oauth.yandex.ru','passport.yandex.ru','passport.yandex.com'];
export function allowedTalkLogin(url:string,domain:string):boolean {try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&[normalizeTalkDomain(domain),...authHosts].includes(u.hostname);}catch{return false;}}
export function sourceRecordingUrl(value:unknown,domain:string):string|null {if(typeof value!=='string')return null;try{const u=new URL(value,`https://${normalizeTalkDomain(domain)}`);return u.protocol==='https:'&&u.hostname===domain&&!u.username&&!u.password&&!u.port&&/^\/recordings\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname)&&!u.search&&!u.hash?u.href:null;}catch{return null;}}
export function sourceKey(value:unknown):string {if(typeof value!=='string'||!value||value.length>250||!/^[a-zA-Z0-9_-]+$/.test(value))throw new KonturError('schema','Формат данных Толка изменился. Обновление остановлено.');return value;}
export const safeKonturMessage=(error:unknown):string=>error instanceof KonturError?error.message:'Не удалось обновить встречи. Сохранённые данные доступны.';
