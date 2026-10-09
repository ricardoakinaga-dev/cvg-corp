import { pathToFileURL } from 'node:url';
const moduleAt=p=>import(pathToFileURL(`${process.cwd()}/${p}`).href);
const {CvgStore}=await moduleAt('packages/domain/src/index.ts');
const {ContextBuilder}=await moduleAt('packages/agent-context/src/index.ts');
const {MockModelProvider}=await moduleAt('packages/model-adapters/src/index.ts');
const {EmbeddedAgentRuntime}=await moduleAt('packages/embedded-agent-runtime/src/index.ts');
const {createRuntime}=await moduleAt('apps/api/src/app.ts');
const marker='SyntheticOnlyNeverARealCredential123!';
const prompt=`Analise esta anotação de teste: password=${marker}`;
const built=new ContextBuilder().build({systemInstructions:'Synthetic audit.',agentProfile:{name:'audit',version:'1',digest:'a'.repeat(64),instructions:'Use approved data.',allowedTools:[],allowedSkills:[],allowedDataClasses:['D0','D2']},actor:{actorId:'audit',roles:['admin'],organizationId:'synthetic',unitId:null,workspaceId:null,purpose:'OPERATIONS'},task:{objective:prompt,state:'ACTIVE',completedObjectives:[],pendingObjectives:[]},toolContracts:[],conversation:[{role:'user',content:prompt,turn:0}],retrieval:[],criticalBusinessContext:[],tokenBudget:1000,maxUntrustedItems:4});
console.log(JSON.stringify({probe:'SECRET_TASK_CONTEXT',sanitized:built.sanitized,quarantined:built.quarantined,markerItems:built.items.filter(i=>i.content.includes(marker)).map(i=>({kind:i.kind,trust:i.trust,dataClass:i.dataClass}))}));
const store=new CvgStore({bootstrapPassword:'Synthetic-Audit-Password-123!'});
const model=new MockModelProvider();let calls=0,received=false;
const original=model.complete.bind(model);
model.complete=async request=>{calls++;received=request.messages.some(m=>m.content.includes(marker));return original(request);};
const agent=new EmbeddedAgentRuntime({store,modelProvider:model});
const runtime=await createRuntime({store,agentRuntime:agent,config:{nodeEnv:'test',storageMode:'memory',demoMode:false,secretProvider:'none',agentRuntimeMode:'embedded'}});
try{
 const login=await runtime.app.inject({method:'POST',url:'/api/v1/auth/login',payload:{login:store.getUser(store.bootstrapCredentials.userId).login,password:'Synthetic-Audit-Password-123!'}});
 if(login.statusCode!==200)throw new Error(`login status ${login.statusCode}`);
 const data=login.json().data,ctx=data.contexts[0];
 const cookie=login.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
 const result=await runtime.app.inject({method:'POST',url:'/api/v1/ai/turns',headers:{cookie,'x-csrf-token':data.csrfToken,'x-cvg-unit-id':ctx.unit.id,'x-cvg-workspace-id':ctx.workspace.id},payload:{sessionId:null,prompt,purpose:'OPERATIONS',patientId:null,encounterId:null,requestedTool:null,approvalId:null,idempotencyKey:'audit-context-synthetic-only'}});
 console.log(JSON.stringify({probe:'SECRET_HTTP_TO_MODEL_AND_STORE',httpStatus:result.statusCode,turnStatus:result.json().data?.turn?.status??null,providerCalls:calls,providerReceivedMarker:received,storedPromptContainsMarker:store.snapshot().aiTurns.some(t=>t.prompt.includes(marker)),scope:'real authenticated HTTP and embedded runtime; synthetic in-memory model observer; no network or real credentials'}));
}finally{await runtime.app.close();}
