import {CvgStore} from './packages/domain/src/index.ts';
const store=new CvgStore({bootstrapPassword:'synthetic-password-123'});
const user=[...store.users.values()].find(x=>x.id.endsWith('000004'))!;
const opt=store.contextOptions(user.id)[0]!;
const session=store.createSession(user.id,'synthetic-role-probe','synthetic-csrf',60);
const c=store.resolveContext(user.id,{unitId:opt.unit.id,workspaceId:opt.workspace.id},'test','role-probe',null,null,session.id);
for (const method of ['listStock','listMedicationOrders','listBeds','listHospitalEpisodes','listEncounters'] as const) {
 try{store[method](c);console.log(method,'ALLOWED')}catch(e){console.log(method,(e as {code:string}).code)}
}
