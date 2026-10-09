import { pathToFileURL } from 'node:url';
import { createHash, createHmac } from 'node:crypto';
const root=process.cwd();
const moduleAt=p=>import(pathToFileURL(`${root}/${p}`).href);
const {CvgStore}=await moduleAt('packages/domain/src/index.ts');
const {passwordHasher}=await moduleAt('packages/auth/src/index.ts');
const {createRuntime}=await moduleAt('apps/api/src/app.ts');
const {cvgConfigSchema}=await moduleAt('packages/config/src/index.ts');
const {assertIntegrationCallbackAllowed}=await moduleAt('packages/agent-policy/src/index.ts');
const {EnvironmentSecretProvider,verifyMessagingCallback}=await moduleAt('packages/integrations/src/index.ts');
const secret='JBSWY3DPEHPK3PXP'; // synthetic fixture, never a deployed credential
function code(){let acc=0,bits=0,bytes=[];for(const c of secret){acc=(acc<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((acc>>>bits)&255);}}const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();const o=h[h.length-1]&15;return String((h.readUInt32BE(o)&0x7fffffff)%1000000).padStart(6,'0');}
const store=new CvgStore({bootstrapPassword:'Synthetic-Audit-Password-123!'});
const uid=store.bootstrapCredentials.userId;
store.configureMfaFactor(uid,'audit.synthetic.totp');
const rotatedDigest=await passwordHasher.hash('Synthetic-Rotated-Password-456!');
let block=false,enteredResolve,releaseResolve;
const entered=new Promise(r=>enteredResolve=r),release=new Promise(r=>releaseResolve=r);
const runtime=await createRuntime({store,config:{nodeEnv:'test',storageMode:'memory',demoMode:false,secretProvider:'none',agentRuntimeMode:'disabled',authMfaMode:'optional'},mfaSecretResolver:{resolve:async ref=>{if(ref!=='audit.synthetic.totp')return null;if(block){enteredResolve();await release;}return secret;}}});
try {
 const login=await runtime.app.inject({method:'POST',url:'/api/v1/auth/login',payload:{login:store.getUser(uid).login,password:'Synthetic-Audit-Password-123!'}});
 if(login.statusCode!==202)throw new Error(`synthetic login expected202 got${login.statusCode}`);
 const challengeId=login.json().data.challengeId;
 const beforeVersion=store.getUser(uid).security.credentialVersion;
 block=true;
 const pending=runtime.app.inject({method:'POST',url:'/api/v1/auth/mfa/verify',payload:{challengeId,code:code()}}).then(r=>r);
 const timer=setTimeout(()=>releaseResolve(),3000);timer.unref();
 await entered;
 store.rotatePassword(uid,rotatedDigest,null);
 releaseResolve();
 const verified=await pending;
 clearTimeout(timer);
 const sessionCookie=verified.cookies.find(c=>c.name==='cvg_session');
 const persisted=sessionCookie?store.findSession(createHash('sha256').update(sessionCookie.value).digest('hex')):undefined;
 console.log(JSON.stringify({probe:'MFA_ROTATION_DURING_RESOLVER',loginStatus:login.statusCode,challengeCredentialVersion:beforeVersion,currentCredentialVersion:store.getUser(uid).security.credentialVersion,verifyStatus:verified.statusCode,sessionAcceptedAfterRotation:!!persisted,newSessionCredentialVersion:persisted?.credentialVersion??null,scope:'real HTTP handler via app.inject; isolated memory; rotation via actual domain method; no PostgreSQL or network'}));
}finally{releaseResolve();await runtime.app.close();}
const common={nodeEnv:'production',host:'0.0.0.0',webOrigin:'https://audit.example.test',releaseSha:'1'.repeat(40),releaseArtifactDigest:'sha256:'+'2'.repeat(64),demoMode:false,trustProxy:true,trustedProxyIps:['127.0.0.1'],storageMode:'postgres',databaseUrl:'postgresql://cvg_runtime@127.0.0.1/synthetic_never_connected',secretProvider:'docker',authMfaMode:'required',rateLimitBackend:'distributed',agentRuntimeMode:'disabled',deepseekRuntimeEnabled:false};
const parsed=cvgConfigSchema.safeParse(common);
console.log(JSON.stringify({probe:'PRODUCTION_AI_DISABLED_CONFIG',accepted:parsed.success,issues:parsed.success?[]:parsed.error.issues.map(i=>({path:i.path,message:i.message})),scope:'pure schema parse; no database or provider'}));
const keyProvider=new EnvironmentSecretProvider({CVG_SECRET_AUDIT_PROVIDER_A:'synthetic-provider-a-shared-key-only'});
const rawBody=JSON.stringify({provider:'provider-b',eventType:'delivery.confirmed',payload:{synthetic:true}});
const ref='audit.provider.a';
const signature=createHmac('sha256','synthetic-provider-a-shared-key-only').update(rawBody).digest('hex');
let policyAccepted=true;try{assertIntegrationCallbackAllowed({operation:'integration.inbox',provider:'provider-b',signatureAlgorithm:'HMAC-SHA256',signatureKeyRef:ref,signature,rawBody});}catch{policyAccepted=false;}
console.log(JSON.stringify({probe:'CALLBACK_KEY_PROVIDER_BINDING',targetProvider:'provider-b',signingKeyFor:'provider-a',policyAccepted,hmacAccepted:verifyMessagingCallback(rawBody,signature,await keyProvider.resolve(ref)),scope:'actual policy and secret-provider/HMAC components; HTTP-to-SQL path inspected only'}));
