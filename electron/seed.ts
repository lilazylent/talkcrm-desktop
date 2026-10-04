import type { Database } from 'sql.js';

const iso = (days: number, hour = 11): string => {
  const value = new Date();
  value.setHours(hour, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value.toISOString();
};

const insert = (db: Database, table: string, row: Record<string, string | number | null>): void => {
  const keys = Object.keys(row);
  const statement = db.prepare(`INSERT OR IGNORE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`);
  statement.run(keys.map(key => row[key]));
  statement.free();
};

export function seedDemo(db: Database, transaction = true): void {
  const seeded = db.exec("SELECT value FROM app_settings WHERE key='demo_seed_version'");
  if (seeded.length) return;
  const now = new Date().toISOString();
  if (transaction) db.run('BEGIN TRANSACTION');
  try {
    insert(db, 'users', { id: 'user-1', display_name: 'Алексей Смирнов', created_at: now, updated_at: now });
    const clients = [
      ['c1', 'Ирина Волкова', 'ООО Север', '+7 900 000-11-21', 'irina@sever.example', 'Алексей Смирнов'],
      ['c2', 'Максим Орлов', 'Студия Маяк', '+7 900 000-11-22', 'max@mayak.example', 'Алексей Смирнов'],
      ['c3', 'Елена Белова', 'Альфа Логистика', '+7 900 000-11-23', 'elena@alfa.example', 'Мария Петрова'],
      ['c4', 'Павел Климов', 'ТехПром', '+7 900 000-11-24', 'pavel@techprom.example', 'Мария Петрова'],
      ['c5', 'Анна Корнеева', 'Бюро Линия', '+7 900 000-11-25', 'anna@line.example', 'Алексей Смирнов'],
      ['c6', 'Сергей Лебедев', 'Ферма Родник', '+7 900 000-11-26', 'sergey@rodnik.example', 'Мария Петрова'],
      ['c7', 'Ольга Миронова', 'Клиника Баланс', '+7 900 000-11-27', 'olga@balance.example', 'Алексей Смирнов'],
      ['c8', 'Дмитрий Соколов', 'Городские решения', '+7 900 000-11-28', 'dmitry@city.example', 'Мария Петрова']
    ];
    clients.forEach(([id, name, company_name, phone, email, responsible_name]) => insert(db, 'clients', { id, external_id: null, source: 'demo', name, company_name, phone, email, responsible_name, created_at: now, updated_at: now }));
    const deals: Array<[string, string, string, string, string, number]> = [
      ['d1','c1','Внедрение CRM для отдела продаж','Переговоры','Алексей Смирнов',780000],
      ['d2','c2','Автоматизация заявок','Согласование','Алексей Смирнов',420000],
      ['d3','c3','Единая воронка продаж','Квалификация','Мария Петрова',960000],
      ['d4','c4','Пилот аналитики','Переговоры','Мария Петрова',315000],
      ['d5','c5','CRM для проектной команды','Новый запрос','Алексей Смирнов',280000],
      ['d6','c6','Автоматизация повторных продаж','Согласование','Мария Петрова',530000],
      ['d7','c7','Клиентский сервис','Переговоры','Алексей Смирнов',650000],
      ['d8','c8','Интеграция обращений','Квалификация','Мария Петрова',390000],
      ['d9','c1','Дополнительные лицензии','Новый запрос','Алексей Смирнов',120000],
      ['d10','c3','Настройка отчётности','Успешно реализовано','Мария Петрова',210000]
    ];
    deals.forEach(([id,client_id,title,stage_name,responsible_name,amount]) => insert(db, 'deals', { id, external_id: null, client_id, title, pipeline_name: 'Основные продажи', stage_name, responsible_name, amount, currency: 'RUB', created_at: now, updated_at: now }));
    const transcript = (person: string, need: string) => JSON.stringify([
      { time: '00:42', speaker: 'Алексей', text: `Расскажите, как сейчас устроен процесс и что хотелось бы изменить.` },
      { time: '01:08', speaker: person, text: `Сейчас ${need}. Хотим видеть общую картину по клиентам и не терять договорённости.` },
      { time: '03:16', speaker: 'Алексей', text: 'Какие команды будут работать в системе и когда планируете запуск?' },
      { time: '04:02', speaker: person, text: 'Начнём с отдела продаж. Решение хотим принять в этом месяце.' }
    ]);
    const meetings: Array<[string,string | null,string | null,string,number,number,string,string]> = [
      ['m1','d1','c1','Обсуждение внедрения CRM',-1,43,'linked','Согласовали пилот на отдел продаж. Клиент ждёт план внедрения и расчёт стоимости.'],
      ['m2','d2','c2','Демонстрация рабочего пространства',0,37,'linked','Показали карточку клиента и задачи. Отправить презентацию и примеры сценариев.'],
      ['m3','d3','c3','Первичная встреча с Альфа Логистика',-3,51,'review','Обсудили единую воронку и отчётность. Нужно подтвердить привязку к сделке.'],
      ['m4','d4','c4','Пилот: цели и критерии',-5,29,'linked','Зафиксировали критерии успешного пилота и состав участников.'],
      ['m5','d5','c5','Знакомство с командой',-6,34,'linked','Команда ищет простой процесс для проектов и заявок.'],
      ['m6','d6','c6','Повторная встреча по бюджету',-8,46,'linked','Обсудили бюджет на квартал и этапы запуска.'],
      ['m7','d7','c7','Сервис для клиентов клиники',-10,39,'linked','Нужны напоминания, история обращений и единый профиль клиента.'],
      ['m8',null,null,'Встреча с новым контактом',-2,22,'unlinked','Контакт оставил запрос на демонстрацию. Требуется найти клиента и сделку.']
    ];
    meetings.forEach(([id, deal_id, client_id, title, day, minutes, matching_status, summary]) => insert(db, 'meetings', { id, external_id: null, deal_id, client_id, title, started_at: iso(day, 14), duration_seconds: minutes * 60, participants_json: JSON.stringify(client_id ? ['Алексей Смирнов', clients.find(c => c[0] === client_id)?.[1]] : ['Алексей Смирнов', 'Новый контакт']), summary, transcript: transcript(client_id ? clients.find(c => c[0] === client_id)?.[1] ?? 'Клиент' : 'Клиент', 'заявки ведутся в таблицах'), recording_url: null, matching_status, created_at: now, updated_at: now }));
    const tasks: Array<[string,string | null,string | null,string,number,number]> = [
      ['t1','d1','c1','Отправить план внедрения',-1,0],['t2','d2','c2','Выслать презентацию и кейсы',0,0],
      ['t3','d3','c3','Уточнить состав команды',0,0],['t4','d4','c4','Подготовить критерии пилота',1,0],
      ['t5','d5','c5','Согласовать демонстрацию',2,0],['t6','d6','c6','Обновить коммерческое предложение',3,0],
      ['t7','d7','c7','Отправить схему клиентского пути',-2,0],['t8','d8','c8','Позвонить Дмитрию',4,0],
      ['t9','d1','c1','Назначить техническую встречу',5,0],['t10','d10','c3','Поблагодарить за встречу',-4,1]
    ];
    tasks.forEach(([id,deal_id,client_id,title,day,completed]) => insert(db, 'tasks', { id, external_id: null, deal_id, client_id, title, due_at: iso(day, 16), completed, created_at: now, updated_at: now }));
    [['amo','amoCRM'],['talk','Контур.Толк'],['ai','AI']].forEach(([id,type]) => insert(db, 'integrations', { id, type, enabled: 0, status: type === 'AI' ? 'Не настроено' : 'Не подключено', account_label: null, last_sync_at: null, created_at: now, updated_at: now }));
    const fields = ['Потребность','Текущая ситуация','Основная проблема','ЛПР','Бюджет','Срок','Возражения','Договорённости','Следующий шаг'];
    insert(db, 'templates', { id: 'first', title: 'Первичная встреча', description: 'Собрать контекст и договориться о следующем шаге', fields_json: JSON.stringify(fields.map((title, index) => ({ key: `field_${index + 1}`, title }))) });
    insert(db, 'templates', { id: 'repeat', title: 'Повторная встреча', description: 'Проверить прогресс и закрепить решения', fields_json: JSON.stringify(['Итоги прошлого контакта','Новые вводные','Решение','Возражения','Договорённости','Следующий шаг'].map((title, index) => ({ key: `field_${index + 1}`, title }))) });
    db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('demo_seed_version', '1'), ('notifications', 'on'), ('demo_mode', 'on')");
    if (transaction) db.run('COMMIT');
  } catch (error) { if (transaction) db.run('ROLLBACK'); throw error; }
}
