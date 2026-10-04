import path from 'node:path';
import { SqliteRepository } from '../electron/repository.ts';
import { batchFixture, accountFixture } from '../tests/crmFixture.ts';
const root=process.cwd();const folder=path.join(root,'release','phase2-qa-profile');const repo=new SqliteRepository(path.join(folder,'talkcrm.sqlite'),path.join(root,'migrations'),root);
await repo.initialize();await repo.connectAccount({...accountFixture,authorized:false});const batch=batchFixture();batch.account.authorized=false;await repo.commitCrmSync(batch,await repo.startSync());repo.close();console.log('Synthetic read-only CRM cache prepared in isolated QA profile.');
