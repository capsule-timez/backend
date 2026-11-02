import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { storage } from '../src/lib/storage';
import { generateToken } from '../src/lib/token';
import { generateAccessToken } from '../src/lib/accessToken';

async function main() {
 const run = randomUUID();
 const users: string[] = [];
 const objects: string[] = [];
 const server = createApp().listen(0, '127.0.0.1');
 await once(server, 'listening');
 const address = server.address();
 assert.ok(address && typeof address !== 'string');
 const base = `http://127.0.0.1:${address.port}/api`;
 const checks: string[] = [];
 try {
  await prisma.$connect();
  for (const name of ['Owner','Other']) {
   const user=await prisma.user.create({data:{name:`Integration ${name}`,email:`integration-${name}-${run}@example.com`,passhash:'integration-no-login'}});
   users.push(user.id);
  }
  const access=generateAccessToken();
  const capsule=await prisma.capsule.create({data:{creatorId:users[0]!,titleContent:'Original',textContent:'Original text',recipientEmail:'integration@example.com',scheduleDate:new Date(Date.now()+86400000),token:access.hash}});
  const key=`integration-tests/${run}/test.txt`;
  objects.push(key);
  const content=Buffer.from('Capsule integration test');
  await storage.putObject(key,content,'text/plain');
  await prisma.capsuleFile.create({data:{capsuleId:capsule.id,fileName:'test.txt',mimeType:'text/plain',fileSize:content.length,objectKey:key}});
  const patch=(body:unknown,user=users[0],id=capsule.id)=>fetch(`${base}/capsules/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${generateToken(user)}`}:{})},body:JSON.stringify(body)});
  const updated=await patch({title:'Edited'});
  assert.equal(updated.status,200);
  const body=await updated.json();
  assert.equal(body.title,'Edited'); assert.equal(body.text,'Original text');
  assert.equal(body.files.length,1); assert.equal('objectKey' in body.files[0],false);
  assert.equal((await prisma.capsule.findUniqueOrThrow({where:{id:capsule.id}})).titleContent,'Edited');
  const newDate=new Date(Date.now()+172800000).toISOString();
  assert.equal((await patch({text:'Edited text',recipientEmail:'edited@example.com',scheduleDate:newDate})).status,200);
  const stored=await prisma.capsule.findUniqueOrThrow({where:{id:capsule.id}});
  assert.equal(stored.scheduleDate.toISOString(),newDate); assert.equal(stored.textContent,'Edited text'); assert.equal(stored.recipientEmail,'edited@example.com');
  assert.equal((await patch({title:'Forbidden'},users[1])).status,404);
  assert.equal((await patch({title:'Missing'},users[0],randomUUID())).status,404);
  assert.equal((await patch({title:'No auth'},'')).status,401);
  for(const invalid of [{title:''},{text:''},{recipientEmail:'bad'},{scheduleDate:'2020-01-01T00:00:00Z'},{}]){
   const response=await patch(invalid); assert.equal(response.status,422);
   const error=await response.json(); assert.equal(error.code,'VALIDATION_ERROR'); assert.ok(error.details.length);
  }
  checks.push('PATCH: persistence, partial/all fields, attachment, 401/404/422');
  const open=()=>fetch(`${base}/public/capsules/${access.token}`);
  const missing=await fetch(`${base}/public/capsules/unknown-${run}`);
  assert.equal(missing.status,404); const missingBody=await missing.json();
  for(const status of ['SCHEDULED','FAILED','SENT'] as const){
   await prisma.capsule.update({where:{id:capsule.id},data:{status,sentAt:status==='SENT'?new Date():null}});
   const response=await open();
   if(status!=='SENT'){
    assert.equal(response.status,404); assert.deepEqual(await response.json(),missingBody);
   }else{
    assert.equal(response.status,200); const publicBody=await response.json();
    assert.deepEqual(Object.keys(publicBody).sort(),['creatorName','files','sentAt','text','title']);
    assert.equal(publicBody.creatorName,'Integration Owner'); assert.equal(publicBody.title,'Edited'); assert.equal(publicBody.text,'Edited text'); assert.ok(publicBody.sentAt);
    assert.equal(JSON.stringify(publicBody).includes(access.hash),false); assert.equal('objectKey' in publicBody.files[0],false);
    const url=new URL(publicBody.files[0].downloadUrl); assert.ok(url.searchParams.get('X-Amz-Signature')); assert.ok(Date.parse(publicBody.files[0].downloadUrlExpiresAt)>Date.now());
    const download=await fetch(url); assert.equal(download.status,200); assert.equal(await download.text(),content.toString());
    url.searchParams.set('X-Amz-Signature','0'.repeat(64)); assert.equal((await fetch(url)).status,403);
   }
   if(status!=='SCHEDULED'){
    const conflict=await patch({title:'Forbidden'}); assert.equal(conflict.status,409); assert.equal((await conflict.json()).code,'CAPSULE_NOT_EDITABLE');
   }
  }
  checks.push('PATCH: SENT/FAILED return 409');
  checks.push('Public GET: SENT 200, unknown/SCHEDULED/FAILED identical 404');
  checks.push('MinIO: real signed download 200, tampered signature 403, no internal fields');
  console.log(JSON.stringify({result:'PASS',checks},null,2));
 }finally{
  for(const key of objects) await storage.removeObject(key);
  await prisma.capsule.deleteMany({where:{creatorId:{in:users}}});
  await prisma.user.deleteMany({where:{id:{in:users}}});
  server.close(); await once(server,'close'); await prisma.$disconnect();
  console.log('Integration fixtures cleaned up.');
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
