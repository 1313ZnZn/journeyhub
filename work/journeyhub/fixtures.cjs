const fs=require('node:fs'),crypto=require('node:crypto');
const tag='jhverify-'+crypto.randomBytes(5).toString('hex');
const f={tag,users:['travelerA','travelerB','staff'].map((role,i)=>({role,id:crypto.randomUUID(),email:tag+'-'+i+'@example.invalid',password:crypto.randomBytes(24).toString('base64url')+'a1'})),product:tag+'-product',session:tag+'-session'};
fs.writeFileSync('test-fixtures.json',JSON.stringify(f));
const q=s=>"'"+s.replaceAll("'","''")+"'";
let sql='BEGIN;\n';
for(const u of f.users){
sql+=`INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES('00000000-0000-0000-0000-000000000000',${q(u.id)},'authenticated','authenticated',${q(u.email)},extensions.crypt(${q(u.password)},extensions.gen_salt('bf')),now(),'','','','','{"provider":"email","providers":["email"]}','{"display_name":"JourneyHub verification"}',now(),now());\n`;
sql+=`INSERT INTO auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) VALUES(${q(u.id)},${q(u.id)},jsonb_build_object('sub',${q(u.id)},'email',${q(u.email)},'email_verified',true),'email',now(),now());\n`;
}
sql+=`INSERT INTO journey_hub.staff(staff_id,display_name,role,venue_id,pin_hash,auth_user_id) VALUES('VT-9999','Verification Staff','coordinator','silom-hub','disabled',${q(f.users[2].id)});\n`;
sql+=`INSERT INTO journey_hub.products(product_id,store_id,name,price_thb) VALUES(${q(f.product)},'rf','Verification product',100); INSERT INTO journey_hub.inventory(product_id,stock) VALUES(${q(f.product)},1);\n`;
sql+=`INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity) VALUES(${q(f.session)},'craft',now()+interval '3 days',now()+interval '3 days 2 hours',1);\nCOMMIT;`;
fs.writeFileSync('test-fixtures.sql',sql);
console.log('Prepared isolated verification fixtures.');
