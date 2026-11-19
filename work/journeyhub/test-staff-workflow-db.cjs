/* Real PostgreSQL (PGlite), isolated in memory. No hosted writes or real orders.
   Run: node work/journeyhub/test-staff-workflow-db.cjs */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
const unified=process.argv.includes('--unified');
async function run(){
 const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE service_role;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;CREATE SCHEMA journey_hub;SET search_path=journey_hub,public;`);
 let schema=read('original.sql').split('-- Starter data (matches')[0];schema=schema.slice(schema.indexOf('CREATE TABLE venues'));
 await db.exec(schema);
 await db.exec(`ALTER TABLE venues ADD COLUMN city text DEFAULT 'Bangkok',ADD COLUMN time_zone text DEFAULT 'Asia/Bangkok';ALTER TABLE experiences ADD COLUMN details jsonb DEFAULT '{}',ADD COLUMN demo_owner_id uuid;ALTER TABLE sessions ADD COLUMN demo_owner_id uuid;`);
 await db.exec(read('backend.sql'));
 await db.exec(read('feature3.sql'));
 await db.exec(read('supabase/migrations/20261116083047_staff_approval_workflow.sql'));
 // Independent test records only: three activity kinds and separate role identities.
 const users=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'];
 for(const id of users)await db.query('INSERT INTO auth.users VALUES($1)',[id]);
 await db.exec(`INSERT INTO venues(venue_id,name,kind,area)VALUES('test-venue','TEST venue','workshop_venue','TEST'),('other','TEST other','workshop_venue','TEST');
 INSERT INTO staff(staff_id,display_name,role,venue_id,pin_hash,auth_user_id)VALUES
 ('TC-1001','TEST Coordinator','coordinator','test-venue','disabled','${users[0]}'),('TM-1002','TEST Manager','duty_manager','test-venue','disabled','${users[1]}'),('TH-1003','TEST Host','host','test-venue','disabled','${users[2]}');
 INSERT INTO experiences(experience_id,venue_id,name,kind,price_thb,duration_min,material_cost_thb) VALUES('craft','test-venue','TEST Thai Craft Lab','Workshop',1400,150,250),('food','test-venue','TEST Food walk','Food',900,120,NULL),('culture','test-venue','TEST Museum walk','Culture',450,90,NULL),('other','other','TEST out of scope','Culture',450,90,NULL);
 INSERT INTO travelers(traveler_id,display_name,auth_user_id)VALUES('${users[3]}','TEST Independent Traveler','${users[3]}');`);
 const auth=async i=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[users[i]]);
 const command=async payload=>(await db.query("select journey_hub.plan_command($1::jsonb) result",[JSON.stringify(payload)])).rows[0].result;
 const snapshot=async()=>(await db.query('select journey_hub.snapshot() result')).rows[0].result;
 const assertions=[];const pass=s=>{assertions.push(s);console.log('PASS '+s);};
 if(unified){
  await db.exec(read('supabase/migrations/20261119071829_unified_staff_capabilities.sql'));
  assert.deepEqual((await db.query('select distinct role from journey_hub.staff')).rows,[{role:'duty_manager'}]);
  assert.equal((await db.query('select count(*)::int n from journey_hub.staff_role_backup_20261119')).rows[0].n,3);
  await db.exec("INSERT INTO staff(staff_id,display_name,role,pin_hash) VALUES('TN-1004','TEST future staff','host','disabled')");
  assert.equal((await db.query("select role from staff where staff_id='TN-1004'")).rows[0].role,'duty_manager');
  await db.exec("UPDATE staff SET role='coordinator' WHERE staff_id='TN-1004'");
  assert.equal((await db.query("select role from staff where staff_id='TN-1004'")).rows[0].role,'duty_manager');
  await assert.rejects(db.exec("UPDATE staff SET role='admin' WHERE staff_id='TN-1004'"),/Invalid staff role/);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('select * from journey_hub.staff_role_backup_20261119'),/permission denied/);
  await assert.rejects(db.query("INSERT INTO journey_hub.staff(staff_id,display_name,role,pin_hash) VALUES('TX-9999','Forbidden','host','disabled')"),/permission denied|row-level security/);
  await db.exec('RESET ROLE');
  for(let i=0;i<3;i++){await auth(i);assert((await snapshot()).planningSettings.other,'All staff can plan across venues');}
  pass('Existing and future staff normalized; invalid roles, client self-provisioning and backup access denied; cross-venue planning identical');
 }
 const date=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
 const assumptions={bookingRate:.8,cancellationRate:.1,attendanceRate:.95,hostRate:.5,materialCost:100,basis:'TEST explicit assumptions'};
 const published=[];
 for(const [i,exp]of ['craft','food','culture'].entries()){
  const author=unified?i:0,reviewer=unified?(i+1)%3:1;
  await auth(author);let p=await command({action:'create',exp});const first=p.id;
  assert.equal((await command({action:'create',exp})).id,first,'Repeated blank draft returns same ID');
  p=await command({action:'save',id:p.id,version:p.version,date,startTime:`${10+i}:00`,cap:4,price:exp==='craft'?1400:450,promo:50,reason:'TEST independent session',assumptions});
  p=await command({action:'submit',id:p.id,version:p.version});
  if(unified)await assert.rejects(command({action:'approve',id:p.id,version:p.version}),/different authorized Duty Manager/);
  await auth(reviewer);assert((await snapshot()).sessionPlans.some(x=>x.plan_id===first&&x.status==='submitted'));
  if(i===0){await assert.rejects(command({action:'return',id:p.id,version:p.version,returnReason:''}),/Explain/);p=await command({action:'return',id:p.id,version:p.version,returnReason:'TEST please revise capacity'});await auth(0);assert.equal((await snapshot()).sessionPlans.find(x=>x.plan_id===first).return_reason,'TEST please revise capacity');p=await command({action:'revise',id:p.id,version:p.version});p=await command({action:'submit',id:p.id,version:p.version});await auth(1);pass('Return → revise → resubmit with retained reason and fresh version');}
  const submittedVersion=p.version;await assert.rejects(command({action:'approve',id:p.id,version:p.version-1}),/Plan changed/);
  p=await command({action:'approve',id:p.id,version:p.version});assert(p.createdSessionId);
  assert.equal((await command({action:'approve',id:p.id,version:submittedVersion})).createdSessionId,p.createdSessionId);
  const s=(await db.query('select * from journey_hub.sessions where session_id=$1',[p.createdSessionId])).rows[0];assert.equal(s.experience_id,exp);assert.equal(s.capacity,4);assert.equal((Date.parse(s.ends_at)-Date.parse(s.starts_at))/60000,[150,120,90][i]);
  published.push(s);pass(`${exp}: persistent draft → manager list → atomic publication, correct activity/duration, repeat publication idempotent`);
 }
 await auth(1);let own=await command({action:'create',exp:'craft'});own=await command({action:'save',id:own.id,version:own.version,date,startTime:'18:00',cap:4,price:1400,promo:0,reason:'TEST manager own draft',assumptions});own=await command({action:'submit',id:own.id,version:own.version});await assert.rejects(command({action:'approve',id:own.id,version:own.version}),/different authorized Duty Manager/);pass('Backend blocks manager self-approval');

 await auth(2);
 if(unified){
  assert((await snapshot()).sessionPlans.some(x=>x.plan_id===own.id));
  assert((await command({action:'create',exp:'other'})).id);
  await assert.rejects(command({action:'save',id:own.id,version:own.version}),/Only the owner/);
  pass('Former Host sees all plans and plans other venues; owner-only draft editing retained');
 }else{
 await auth(2);assert.equal((await snapshot()).sessionPlans.length,0);let host=await command({action:'create',exp:'food'});assert(host.id);await assert.rejects(command({action:'create',exp:'other'}),/authorized scope/);await assert.rejects(command({action:'save',id:own.id,version:own.version}),/authorized scope/);pass('Host assigned-venue planning and owner isolation');
 }
 await auth(0);let draft=await command({action:'create',exp:'culture'});await assert.rejects(command({action:'save',id:draft.id,version:draft.version,date:'2020-01-01',startTime:'10:00',cap:4,price:100,promo:0,reason:'TEST expired'}),/Needs rescheduling/);
 await db.query("update journey_hub.session_plans set session_date='2020-01-01',status='submitted',reason='TEST expired',submitted_by='TC-1001' where plan_id=$1",[draft.id]);await auth(1);await assert.rejects(command({action:'approve',id:draft.id,version:draft.version}),/Needs rescheduling/);pass('Expired save and approval blocked at database boundary');
 const duplicate=await command({action:'duplicate',id:own.id});const d=(await snapshot()).sessionPlans.find(x=>x.plan_id===duplicate.id);assert.equal(d.status,'draft');assert.equal(d.approved_by,null);assert.equal(d.submitted_by,null);assert.equal(d.events.length,1);assert.equal(d.return_reason,null);pass('Duplicate has fresh identity and approval history');
 await auth(3);assert.equal((await snapshot()).sessionPlans.length,0);await assert.rejects(command({action:'create',exp:'craft'}),/Staff access required/);
 for(const [i,s]of published.entries()){
  // Exercise the real existing relational capacity trigger, not a fake success response.
  const bid='TEST-BOOK-'+i,code=['ABC234','ABC235','ABC236'][i];await db.query("INSERT INTO journey_hub.bookings(booking_id,session_id,traveler_id,guest_name,guests,channel,unit_price_thb,checkin_code)VALUES($1,$2,$3,'TEST Traveler',2,'app',$4,$5)",[bid,s.session_id,users[3],s.price_thb,code]);
  const snap=await snapshot();assert(snap.bookings.some(b=>b.booking_id===bid));assert.equal(snap.sessions.find(x=>x.session_id===s.session_id).seats_taken,2);
  await auth(1);const staff=await snapshot();assert(staff.bookings.some(b=>b.booking_id===bid&&b.session_id===s.session_id));assert.equal(staff.liveMetrics.find(x=>x.experience_id===s.experience_id).confirmed,2);await auth(3);
 }
 await assert.rejects(db.query("INSERT INTO journey_hub.bookings(booking_id,session_id,guest_name,guests,channel,unit_price_thb,checkin_code)VALUES('TEST-OVER',$1,'TEST Overbook',3,'app',100,'XYZ234')",[published[0].session_id]),/seats left/);pass('Three independent bookings update same IDs, roster, capacity and live metrics; overbooking blocked');
 await db.query("update journey_hub.bookings set status='cancelled' where booking_id='TEST-BOOK-0'");assert.equal((await snapshot()).sessions.find(x=>x.session_id===published[0].session_id).seats_taken,0);pass('Cancellation restores capacity without deleting the session');
 await db.exec('SET ROLE anon');assert.equal((await db.query('select public.journeyhub_snapshot() result')).rows.length,1);await assert.rejects(db.query("select journey_hub.plan_command('{}')"),/permission denied/);await db.exec('RESET ROLE');pass('Invoker snapshot RPC still accessible; private command helper denied');
 fs.mkdirSync(path.join(__dirname,'../../outputs/staff-workflow'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../../outputs/staff-workflow/db-results.json'),JSON.stringify({environment:'Isolated in-memory PostgreSQL; no cloud writes',passed:assertions,limitations:['Booking inserts test relational flow, not hosted wallet/Edge Functions/Auth UI','Hosted separate-account acceptance pending migration approval']},null,2));
 }finally{await db.close();}
}
run().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1;});
