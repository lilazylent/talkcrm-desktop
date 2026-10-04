import type { ConnectInput } from '../../src/domain/crm.ts';
import type { SecureCredentialStore } from '../../src/services/contracts.ts';
import { CrmError, normalizeDomain, record } from './security.ts';
import { Transport } from './transport.ts';
export interface CredentialBundle { domain: string; clientId: string; clientSecret: string; redirectUri: string; accessToken: string; refreshToken: string; expiresAt: number }
export const credentialKey = (accountId: string): string => `amocrm:${accountId}:oauth`;
export function validateConnect(value: unknown): ConnectInput {
  const input = record(value);
  for (const key of ['domain','clientId','clientSecret','redirectUri','code']) if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 12000) throw new CrmError('input','Заполните все поля подключения.');
  let redirect: URL; try { redirect = new URL(input.redirectUri as string); } catch { throw new CrmError('input','Укажите Redirect URI из настроек интеграции.'); }
  if (!['https:','http:'].includes(redirect.protocol) || redirect.username || redirect.password || redirect.hash) throw new CrmError('input','Укажите Redirect URI из настроек интеграции.');
  return {domain:normalizeDomain(input.domain as string),clientId:(input.clientId as string).trim(),clientSecret:(input.clientSecret as string).trim(),redirectUri:(input.redirectUri as string).trim(),code:(input.code as string).trim()};
}
export class OAuthSession {
  private refreshing: Promise<string> | null = null;
  private blocked = false;
  constructor(private bundle: CredentialBundle, private readonly store: SecureCredentialStore, private readonly accountId: string, private readonly transport: Transport, private readonly onExpiry: (expires: number) => Promise<void> = async () => {}) {}
  static async exchange(input: ConnectInput, transport: Transport): Promise<CredentialBundle> {
    const dto = await transport.request(new URL(`https://${normalizeDomain(input.domain)}/oauth2/access_token`),undefined,{client_id:input.clientId,client_secret:input.clientSecret,redirect_uri:input.redirectUri,grant_type:'authorization_code',code:input.code});
    return OAuthSession.parse(dto,{domain:input.domain,clientId:input.clientId,clientSecret:input.clientSecret,redirectUri:input.redirectUri});
  }
  private static parse(value: unknown, base: Omit<CredentialBundle,'accessToken'|'refreshToken'|'expiresAt'>): CredentialBundle {
    const dto = record(value);
    if (typeof dto.access_token !== 'string' || !dto.access_token || typeof dto.refresh_token !== 'string' || !dto.refresh_token || typeof dto.expires_in !== 'number' || dto.expires_in <= 0) throw new CrmError('oauth_format','Не удалось получить токены amoCRM. Подключите аккаунт заново.');
    return {...base,accessToken:dto.access_token,refreshToken:dto.refresh_token,expiresAt:Date.now()+dto.expires_in*1000};
  }
  async token(): Promise<string> { return this.bundle.expiresAt <= Date.now()+60000 ? this.refresh() : this.bundle.accessToken; }
  async refresh(rejectedToken?: string): Promise<string> {
    if(this.blocked)throw new CrmError('oauth_uncertain','Обновление авторизации не завершилось. Подключите amoCRM заново.');
    if (this.refreshing) return this.refreshing;
    if (rejectedToken && rejectedToken !== this.bundle.accessToken) return this.bundle.accessToken;
    this.refreshing = (async () => {
      const b = this.bundle;
      const dto = await this.transport.request(new URL(`https://${b.domain}/oauth2/access_token`),undefined,{client_id:b.clientId,client_secret:b.clientSecret,redirect_uri:b.redirectUri,grant_type:'refresh_token',refresh_token:b.refreshToken});
      const rotated = OAuthSession.parse(dto,b);
      // Persist the complete rotated pair before publishing it to waiting requests.
      await this.store.set(credentialKey(this.accountId),JSON.stringify(rotated)); this.bundle = rotated;
      await this.onExpiry(rotated.expiresAt).catch(()=>{}); return rotated.accessToken;
    })();
    try { return await this.refreshing; } catch(error){this.blocked=true;if(error instanceof CrmError&&error.status===401)throw error;throw new CrmError('oauth_uncertain','Обновление авторизации не завершилось. Подключите amoCRM заново.');} finally { this.refreshing = null; }
  }
}
