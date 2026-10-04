import { CrmError, normalizeDomain, record } from './security.ts';
export const browserCredentialKey=(id:string)=>`amocrm:${id}:browser`;
const loginHosts=(domain:string)=>new Set([normalizeDomain(domain),'amocrm.ru','www.amocrm.ru','auth.amocrm.ru']);
const hasControl=(value:string)=>Array.from(value).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127);
export function allowedLoginUrl(value:string,domain:string):boolean{
  try{const url=new URL(value);return url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&loginHosts(domain).has(url.hostname);}catch{return false;}
}
export interface SavedCookie {name:string;value:string;domain:string;path:string;secure:boolean;httpOnly:boolean;sameSite:'unspecified'|'no_restriction'|'lax'|'strict';expirationDate?:number;hostOnly?:boolean}
export interface CookieBundle {domain:string;cookies:SavedCookie[]}
export function cookieBundle(value:unknown,domain:string):CookieBundle{
  const invalid=()=>new CrmError('browser_missing','Сессия браузера недоступна. Войдите в amoCRM заново.');
  const dto=record(value);if(dto.domain!==normalizeDomain(domain)||!Array.isArray(dto.cookies)||!dto.cookies.length||dto.cookies.length>200)throw invalid();
  const cookies=dto.cookies.map(value=>{
    const c=record(value);const host=typeof c.domain==='string'?c.domain.replace(/^\./,''):'';
    if(!loginHosts(domain).has(host)||typeof c.name!=='string'||!c.name||c.name.length>256||/[\s;=]/.test(c.name)||hasControl(c.name)||typeof c.value!=='string'||c.value.length>16384||hasControl(c.value)||typeof c.path!=='string'||!c.path.startsWith('/')||c.path.length>2048||hasControl(c.path)||typeof c.secure!=='boolean'||typeof c.httpOnly!=='boolean'||!['unspecified','no_restriction','lax','strict'].includes(String(c.sameSite))||(c.expirationDate!==undefined&&(typeof c.expirationDate!=='number'||!Number.isFinite(c.expirationDate)))||(c.hostOnly!==undefined&&typeof c.hostOnly!=='boolean'))throw invalid();
    return{name:c.name,value:c.value,domain:c.domain as string,path:c.path,secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite as SavedCookie['sameSite'],...(c.expirationDate===undefined?{}:{expirationDate:c.expirationDate as number}),...(c.hostOnly===undefined?{}:{hostOnly:c.hostOnly as boolean})};
  });return{domain,cookies};
}
