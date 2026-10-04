import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App.tsx';
import type { AppSnapshot } from '../src/domain/models.ts';
import type { DesktopApi } from '../src/services/contracts.ts';
import demo from '../public/demo-preview.json';
import { batchFixture } from './crmFixture.ts';
import { mapWorkspace } from '../electron/amocrm/mapping.ts';

let snapshot: AppSnapshot;
beforeEach(() => {
  snapshot = structuredClone(demo) as AppSnapshot;
  window.location.hash = '#/';
  const api: DesktopApi = {
    findMeetingClients:vi.fn(async()=>snapshot),confirmMeetingClient:vi.fn(async()=>snapshot),unlinkMeetingClient:vi.fn(async()=>snapshot),getTranscriptLocation:vi.fn(async()=>0),
    openKontur:vi.fn(async()=>({ok:true,message:'Окно открыто'})),connectKontur:vi.fn(async()=>({ok:true,message:'Подключено'})),syncKontur:vi.fn(async()=>({ok:true,message:'Обновлено'})),disconnectKontur:vi.fn(async()=>({ok:true,message:'Отключено'})),getMeetingArtifacts:vi.fn(async()=>({participants:[],artifacts:[]})),getTranscriptPage:vi.fn(async(_id,offset)=>({segments:[],total:0,offset})),openTalkRecording:vi.fn(async()=>({ok:true,message:'Открыто'})),onKonturProgress:()=>()=>{},
    getSnapshot: vi.fn(async () => snapshot),
    setTaskCompleted: vi.fn(async (id, completed) => { snapshot = { ...snapshot, tasks: snapshot.tasks.map(task => task.id === id ? { ...task, completed } : task) }; return snapshot; }),
    updateProfile: vi.fn(async displayName => { snapshot = { ...snapshot, profile: { ...snapshot.profile, displayName } }; return snapshot; }),
    setSetting: vi.fn(async (key, value) => { snapshot = { ...snapshot, settings: { ...snapshot.settings, [key]: value } }; return snapshot; }),
    resetDemo: vi.fn(async () => snapshot),
    connectCrm:vi.fn(async()=>({ok:true,message:'Подключено'})),openCrmBrowser:vi.fn(async()=>({ok:true,message:'Окно открыто'})),verifyCrmBrowser:vi.fn(async()=>({ok:true,message:'Доступно'})),syncCrm:vi.fn(async()=>({ok:true,message:'Обновлено'})),disconnectCrm:vi.fn(async()=>({ok:true,message:'Отключено'})),onSyncProgress:()=>()=>{}
  };
  window.talkcrm = api;
});
afterEach(() => { cleanup(); delete window.talkcrm; });

describe('critical pages', () => {
  it('shows real meeting artifacts without invented CRM links and searches transcript locally',async()=>{
    snapshot.kontur={id:'fixture',domain:'test.ktalk.ru',mode:'session',externalUserId:'u1',displayName:'Тест',state:'connected',lastSyncAt:null,error:null,meetingCount:1};snapshot.meetings=[{...snapshot.meetings[0],id:'talk:test',source:'kontur_talk',title:'Внутренняя встреча',clientId:null,dealId:null,transcript:[],summary:null,artifactStates:{transcript:'ready',summary:'ready',protocol:'not_available'}}];
    window.talkcrm!.getMeetingArtifacts=vi.fn(async()=>({participants:[],artifacts:[{recordingId:'r1',type:'protocol' as const,state:'not_available' as const,externalId:null,version:null,generatedAt:null,text:null,sections:[],sourceUrl:null}]}));window.talkcrm!.getTranscriptPage=vi.fn(async(_id,offset)=>({segments:[{id:'s1',meetingId:'talk:test',recordingId:'r1',sequence:0,externalId:null,speakerId:null,speakerName:'Дмитрий',startMs:42123,endMs:45234,text:'Исходная реплика'}],total:1,offset}));window.location.hash='#/meetings/talk:test';render(<App/>);await screen.findByRole('heading',{name:'Внутренняя встреча'});expect(screen.getByText('Нужно выбрать клиента')).toBeTruthy();expect(screen.getAllByRole('tab')).toHaveLength(5);fireEvent.click(screen.getByRole('tab',{name:'Транскрипция'}));expect(await screen.findByText('Исходная реплика')).toBeTruthy();expect(screen.getByText('00:42.123–00:45.234')).toBeTruthy();fireEvent.change(screen.getByLabelText('Поиск по транскрипции'),{target:{value:'РЕПЛИКА'}});await waitFor(()=>expect(window.talkcrm!.getTranscriptPage).toHaveBeenLastCalledWith('talk:test',0,100,'РЕПЛИКА'));expect(window.talkcrm!.syncKontur).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('tab',{name:'Протокол'}));expect(await screen.findByText('В Толке пока нет доступного протокола.')).toBeTruthy();
  });
  it('defaults to employee sign-in and verifies only after opening the browser',async()=>{
    window.location.hash='#/settings';render(<App/>);await screen.findByRole('heading',{name:'Настройки'});fireEvent.click(screen.getAllByRole('button',{name:'Подключить'})[0]);
    expect(screen.queryByLabelText('Секретный ключ')).toBeNull();const verify=screen.getByRole('button',{name:'Проверить доступ и загрузить'}) as HTMLButtonElement;expect(verify.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Домен аккаунта'),{target:{value:'samosale.amocrm.ru'}});fireEvent.submit(screen.getByRole('button',{name:'Открыть окно входа'}).closest('form')!);
    await waitFor(()=>expect(verify.disabled).toBe(false));expect(window.talkcrm?.openCrmBrowser).toHaveBeenCalledWith('samosale.amocrm.ru');expect(window.talkcrm?.syncCrm).not.toHaveBeenCalled();fireEvent.click(verify);await waitFor(()=>expect(window.talkcrm?.syncCrm).toHaveBeenCalledOnce());
  });
  it('keeps failed employee verification visible without running sync',async()=>{
    window.talkcrm!.verifyCrmBrowser=vi.fn(async()=>({ok:false,message:'Сессия недоступна'}));window.location.hash='#/settings';render(<App/>);await screen.findByRole('heading',{name:'Настройки'});fireEvent.click(screen.getAllByRole('button',{name:'Подключить'})[0]);fireEvent.change(screen.getByLabelText('Домен аккаунта'),{target:{value:'test'}});fireEvent.submit(screen.getByRole('button',{name:'Открыть окно входа'}).closest('form')!);const verify=screen.getByRole('button',{name:'Проверить доступ и загрузить'}) as HTMLButtonElement;await waitFor(()=>expect(verify.disabled).toBe(false));fireEvent.click(verify);await waitFor(()=>expect(screen.getAllByText('Сессия недоступна').length).toBeGreaterThan(0));expect(window.talkcrm?.syncCrm).not.toHaveBeenCalled();expect(screen.getByRole('heading',{name:'Вход сотрудника в amoCRM'})).toBeTruthy();
  });
  const realData=()=>{const b=batchFixture();const crm={account:b.account,contacts:b.contacts,companies:b.companies,pipelines:b.pipelines,notes:b.notes??[],fields:b.fields??[],leads:b.leads,relations:b.relations};snapshot={...snapshot,...mapWorkspace(b.account,b.leads,crm,b.relations,b.tasks??[]),meetings:[],crm,settings:{...snapshot.settings,data_mode:'amocrm'}};};
  it('shows a real connection wizard with masked sensitive inputs',async()=>{window.location.hash='#/settings';render(<App/>);await screen.findByRole('heading',{name:'Настройки'});fireEvent.click(screen.getAllByRole('button',{name:'Подключить'})[0]);fireEvent.click(screen.getByRole('button',{name:'Через интеграцию'}));fireEvent.click(screen.getByRole('button',{name:'Ввести данные'}));expect((screen.getByLabelText('Секретный ключ') as HTMLInputElement).type).toBe('password');expect((screen.getByLabelText('Код авторизации') as HTMLInputElement).type).toBe('password');expect(screen.queryByLabelText('Пароль')).toBeNull();});
  it('clears secret fields on submission and invokes sync after connection',async()=>{window.location.hash='#/settings';render(<App/>);await screen.findByRole('heading',{name:'Настройки'});fireEvent.click(screen.getAllByRole('button',{name:'Подключить'})[0]);fireEvent.click(screen.getByRole('button',{name:'Через интеграцию'}));fireEvent.click(screen.getByRole('button',{name:'Ввести данные'}));for(const [label,value] of [['Домен аккаунта','test'],['ID интеграции','id'],['Секретный ключ','SECRET'],['Redirect URI','https://example.com'],['Код авторизации','CODE']])fireEvent.change(screen.getByLabelText(label),{target:{value}});fireEvent.submit(screen.getByRole('button',{name:'Подключить и загрузить'}).closest('form')!);expect((screen.getByLabelText('Секретный ключ') as HTMLInputElement).value).toBe('');await waitFor(()=>expect(window.talkcrm?.syncCrm).toHaveBeenCalledTimes(1));});
  it('shows cached CRM notes, fields and separate linked contacts in workspace',async()=>{realData();window.location.hash='#/clients/amocrm:1_test:company:30';render(<App/>);await screen.findByRole('heading',{name:'Тестовая компания',level:1});expect(screen.getByText('Согласован пилот. Следующий шаг — договор.')).toBeTruthy();expect(screen.getByText('Пилот на 5 сотрудников')).toBeTruthy();expect(screen.getByRole('heading',{name:'Связанные контакты и компании'})).toBeTruthy();expect(screen.queryByText('Открыть встречу')).toBeNull();});
  it('disables CRM task completion controls',async()=>{realData();window.location.hash='#/tasks';render(<App/>);const checkbox=await screen.findByRole('checkbox',{name:'Статус задачи: Отправить предложение'});expect((checkbox as HTMLInputElement).disabled).toBe(true);expect(window.talkcrm?.setTaskCompleted).not.toHaveBeenCalled();});
  it('keeps real mode meetings empty and exposes pipeline filter',async()=>{realData();window.location.hash='#/meetings';render(<App/>);await screen.findByRole('heading',{name:'Встречи'});expect(screen.getByText('Встречи появятся после подключения Контур.Толк.')).toBeTruthy();fireEvent.click(screen.getByRole('link',{name:'Сделки'}));await screen.findByRole('heading',{name:'Сделки'});expect(screen.getByLabelText('Фильтр по воронке')).toBeTruthy();expect(screen.queryByLabelText('Фильтр по менеджеру')).toBeNull();});
  it('renders dashboard values and navigates to clients', async () => {
    render(<App/>);
    expect(await screen.findByRole('heading', { name: 'Главная' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Клиенты' }));
    expect(await screen.findByRole('heading', { name: 'Клиенты' })).toBeTruthy();
    expect(screen.getByText('ООО Север')).toBeTruthy();
  });

  it('filters clients locally and opens a client workspace', async () => {
    window.location.hash = '#/clients';
    render(<App/>);
    const input = await screen.findByPlaceholderText('Компания, контакт или менеджер');
    fireEvent.change(input, { target: { value: 'Север' } });
    expect(screen.getByText('ООО Север')).toBeTruthy();
    expect(screen.queryByText('Студия Маяк')).toBeNull();
    fireEvent.click(screen.getByText('ООО Север'));
    expect(await screen.findByRole('heading', { name: 'ООО Север' })).toBeTruthy();
    expect(screen.getByText('Открыть встречу')).toBeTruthy();
  });

  it('shows a meeting transcript and updates task completion', async () => {
    window.location.hash = '#/meetings/m1';
    render(<App/>);
    expect(await screen.findByRole('heading', { name: 'Обсуждение внедрения CRM' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Транскрипция' }));
    expect(screen.getByText('00:42')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Задачи' }));
    const checkbox = (await screen.findByText('Отправить план внедрения')).closest('.task-row')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    await waitFor(() => expect(snapshot.tasks.find(task => task.id === 't1')?.completed).toBe(true));
  });
});

