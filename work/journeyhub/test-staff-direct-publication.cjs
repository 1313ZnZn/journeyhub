/* Isolated PostgreSQL: two former roles, direct publication, real command booking.
   No hosted writes, credentials, real orders or payments. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
async function run(){
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE service_role;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;CREATE SCHEMA journey_hub;SET search_path=journey_hub,public;`);
 let schema=read('original.sql').split('-- Starter data (matches')[0];await db.exec(schema.slice(schema.indexOf('CREATE TABLE venues')));
 await db.exec(`ALTER TABLE venues ADD COLUMN city text DEFAULT 'Bangkok',ADD COLUMN time_zone text DEFAULT 'Asia/Bangkok';ALTER TABLE experiences ADD COLUMN details jsonb DEFAULT '{}',ADD COLUMN demo_owner_id uuid;ALTER TABLE sessions ADD COLUMN demo_owner_id uuid;`);
 await db.exec(read('backend.sql'));await db.exec(read('feature3.sql'));
 await db.exec(read('supabase/migrations/20261116083047_staff_approval_workflow.sql'));
 const users=[randomUUID(),randomUUID(),randomUUID()];for(const id of users)await db.query('INSERT INTO auth.users VALUES($1)',[id]);
 await db.exec(`INSERT INTO venues(venue_id,name,kind,area)VALUES('test','TEST venue','workshop_venue','TEST'),('expanded','TEST other venue','workshop_venue','TEST');
 INSERT INTO staff(staff_id,display_name,role,venue_id,pin_hash,auth_user_id)VALUES
 ('TC-1001','TEST Coordinator','coordinator','test','disabled','${users[0]}'),('TH-1002','TEST Host','host','expanded','disabled','${users[1]}');
 INSERT INTO experiences(experience_id,venue_id,name,kind,price_thb,duration_min,material_cost_thb)VALUES
 ('craft','test','TEST Thai Craft Lab','Workshop',1400,150,250),('museum','expanded','TEST Expanded Museum','Culture',450,90,100);
 INSERT INTO travelers(traveler_id,display_name,auth_user_id)VALUES('${users[2]}','TEST Traveler','${users[2]}');`);
 const auth=async i=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[i===null?'':users[i]]);
 const command=async payload=>(await db.query('select journey_hub.plan_command($1::jsonb) r',[JSON.stringify(payload)])).rows[0].r;
 const snapshot=async()=>(await db.query('select journey_hub.snapshot() r')).rows[0].r;
 const row=async id=>(await db.query('select * from session_plans where plan_id=$1',[id])).rows[0];
 const date=new Date(Date.now()+20*86400000).toISOString().slice(0,10);
 const assumptions={bookingRate:.8,cancellationRate:.1,attendanceRate:.95,hostRate:.5,materialCost:100,basis:'TEST explicit forecast assumptions'};
 await db.exec(read('supabase/migrations/20261119071829_unified_staff_capabilities.sql'));
 const save=async(p,extras={})=>command({action:'save',id:p.id,version:p.version,date,startTime:'12:00',cap:4,price:450,promo:0,reason:'TEST direct publication',assumptions,...extras});
 // Prepare legacy states using the old workflow, including a real published link.
 await auth(0);let pending=await command({action:'create',exp:'craft'});pending=await save(pending,{startTime:'18:00'});pending=await command({action:'submit',id:pending.id,version:pending.version});
 await auth(1);let returned=await command({action:'create',exp:'museum'});returned=await save(returned,{startTime:'18:00'});returned=await command({action:'submit',id:returned.id,version:returned.version});
 await auth(0);returned=await command({action:'return',id:returned.id,version:returned.version,returnReason:'TEST preserve review reason'});
 let historic=await command({action:'create',exp:'craft'});historic=await save(historic,{startTime:'19:00'});historic=await command({action:'submit',id:historic.id,version:historic.version});
 await auth(1);historic=await command({action:'approve',id:historic.id,version:historic.version});const before=await row(historic.id);
 await db.exec(read('supabase/migrations/20261119073922_staff_direct_publication.sql'));
 for(const id of [pending.id,returned.id]){const p=await row(id);assert.equal(p.status,'draft');assert.equal(p.reason,'TEST direct publication');assert.deepEqual(p.assumptions,assumptions);}
 assert.equal((await row(returned.id)).return_reason,'TEST preserve review reason');
 const after=await row(historic.id);assert.equal(after.created_session_id,before.created_session_id);assert.equal(after.status,'approved');assert.equal(after.approved_by,before.approved_by);assert(after.published_at);assert.equal(after.published_by,before.approved_by);
 console.log('PASS migration retains pending/returned content and history, preserves published session IDs and metadata');
 // Another Staff member edits a migrated draft; optimistic concurrency still works.
 await auth(1);let shared=await row(pending.id);await assert.rejects(save({id:pending.id,version:shared.version-1}),/Plan changed/);shared=await save({id:pending.id,version:shared.version},{startTime:'17:00'});assert.equal(shared.status,'draft');
 const published=[];
 for(const [i,exp]of ['craft','museum'].entries()){
  await auth(i);let p=await command({action:'create',exp});p=await save(p,{startTime:'10:00',price:i?450:1400});
  await assert.rejects(command({action:'publish',id:p.id,version:p.version-1}),/Plan changed/);
  const draftVersion=p.version;
  p=await command({action:'publish',id:p.id,version:p.version});assert(p.createdSessionId);
  const stored=await row(p.id);assert.equal(stored.published_by,['TC-1001','TH-1002'][i]);assert(stored.published_at);assert.equal(stored.created_by,stored.published_by);
  assert.equal((await command({action:'publish',id:p.id,version:draftVersion})).createdSessionId,p.createdSessionId);
  assert.equal((await db.query('select count(*)::int n from plan_events where plan_id=$1 and message like $2',[p.id,'Session published%'])).rows[0].n,1);
  await assert.rejects(save(p),/Only drafts/);
  let duplicate=await command({action:'duplicate',id:p.id});const d=await row(duplicate.id);assert.equal(d.status,'draft');assert.equal(d.published_by,null);assert.equal(d.created_session_id,null);
  duplicate=await save(duplicate,{startTime:'10:00',price:i?450:1400});
  await assert.rejects(command({action:'publish',id:duplicate.id,version:duplicate.version}),/already exists/);
  await auth(2);const snap=await snapshot(),slot=snap.sessions.find(s=>s.session_id===p.createdSessionId);
  assert.equal(slot.experience_id,exp);assert.equal(slot.price_thb,i?450:1400);assert.equal(slot.capacity,4);assert.equal((Date.parse(slot.ends_at)-Date.parse(slot.starts_at))/60000,i?90:150);
  const request=randomUUID();const book=async()=> (await db.query("select public.journeyhub_command('book',$1::jsonb,$2::uuid) r",[JSON.stringify({sessionId:slot.session_id,guests:2}),request])).rows[0].r;
  const booking=await book();assert(booking.id);assert.equal((await book()).id,booking.id);
  const booked=(await snapshot()).bookings.find(b=>b.booking_id===booking.id);assert.equal(booked.session_id,slot.session_id);assert.equal(booked.guests,2);assert.equal(booked.unit_price_thb,slot.price_thb);
  assert.equal((await snapshot()).sessions.find(s=>s.session_id===slot.session_id).seats_taken,2);
  for(const employee of [0,1]){await auth(employee);const s=await snapshot();assert(s.bookings.some(b=>b.booking_id===booking.id&&b.session_id===slot.session_id));assert.equal(s.sessions.find(s=>s.session_id===slot.session_id).seats_taken,2);assert.equal(s.liveMetrics.find(m=>m.experience_id===exp).confirmed,2);}
  published.push(p);
  console.log('PASS '+exp+': same-account draft -> publish -> persisted traveler slot -> idempotent booking -> both staff rosters, capacity and live statistics');
 }
 await auth(0);let invalid=await command({action:'create',exp:'museum'});
 await assert.rejects(save(invalid,{cap:41}),/capacity/);await assert.rejects(save(invalid,{price:0}),/positive price/);await assert.rejects(save(invalid,{date:'2020-01-01'}),/Needs rescheduling/);
 invalid=await save(invalid,{startTime:'16:00',assumptions:{}});await assert.rejects(command({action:'publish',id:invalid.id,version:invalid.version}),/forecast assumptions/);
 await auth(2);assert.equal((await snapshot()).sessionPlans.length,0);await assert.rejects(command({action:'publish',id:invalid.id,version:invalid.version}),/Staff access required/);
 await auth(null);await assert.rejects(command({action:'publish',id:invalid.id,version:invalid.version}),/Staff access required/);
 await db.exec('SET ROLE anon');await assert.rejects(db.query("select journey_hub.plan_command('{}')"),/permission denied/);await db.exec('RESET ROLE');
 console.log('PASS date, capacity, price, assumptions, immutable publication, stale versions, duplicate slots and traveler/anonymous access controls');
 }finally{await db.close();}
}
run().catch(e=>{console.error(e.stack,e.where||'');process.exitCode=1;});
