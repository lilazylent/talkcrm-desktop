// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allowedLoginUrl, cookieBundle, browserCredentialKey } from '../electron/amocrm/browserPolicy.ts';
import { AmoClient } from '../electron/amocrm/client.ts';
import { Transport } from '../electron/amocrm/transport.ts';

describe('employee browser boundary',()=>{
  it('allows only HTTPS official navigation without embedded credentials',()=>{
    expect(allowedLoginUrl('https://samosale.amocrm.ru/leads/','samosale.amocrm.ru')).toBe(true);
    expect(allowedLoginUrl('https://www.amocrm.ru/','samosale.amocrm.ru')).toBe(true);
    for(const url of ['http://samosale.amocrm.ru','https://evil.amocrm.ru','https://amocrm.ru.evil.com','https://a:b@samosale.amocrm.ru','file:///C:/secret','https://samosale.amocrm.ru:444/'])expect(allowedLoginUrl(url,'samosale.amocrm.ru')).toBe(false);
  });
  it('validates the domain and each cookie rather than trusting saved JSON',()=>{
    const data={domain:'samosale.amocrm.ru',cookies:[{name:'session',value:'COOKIE_SENTINEL',domain:'.amocrm.ru',path:'/',secure:true,httpOnly:true,sameSite:'lax'}]};
    expect(cookieBundle(data,'samosale.amocrm.ru').cookies).toHaveLength(1);
    expect(()=>cookieBundle(data,'other.amocrm.ru')).toThrow();
    expect(()=>cookieBundle({...data,cookies:[{...data.cookies[0],domain:'.evil.com'}]},data.domain)).toThrow();
    expect(()=>cookieBundle({...data,cookies:[{...data.cookies[0],name:'bad\r\nname'}]},data.domain)).toThrow();
    expect(()=>cookieBundle({...data,cookies:[]},data.domain)).toThrow();
    expect(browserCredentialKey('1_samosale')).toBe('amocrm:1_samosale:browser');
  });
  it('reads through the cookie transport without tokens or OAuth retries',async()=>{
    const calls:RequestInit[]=[];const client=new AmoClient('samosale.amocrm.ru',null,new Transport(async(_url,options)=>{calls.push(options!);return new Response('{}',{status:401});},async()=>{}));
    await expect(client.get('/api/v4/account')).rejects.toMatchObject({status:401});
    expect(calls).toHaveLength(1);expect(calls[0].method).toBe('GET');expect(calls[0].headers).not.toHaveProperty('Authorization');
  });
});
