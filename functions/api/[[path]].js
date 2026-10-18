const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'Content-Type':'application/json'}});
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const ub64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function sign(s,k){const key=await crypto.subtle.importKey('raw',enc.encode(k),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(await crypto.subtle.sign('HMAC',key,enc.encode(s)))}
async function pw(p,salt){const k=await crypto.subtle.importKey('raw',enc.encode(p),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},k,256))}
async function mkTok(u,env){const p=b64(enc.encode(JSON.stringify({u:u.username,n:u.name,r:u.role,x:Date.now()+12*36e5})));return p+'.'+await sign(p,env.JWT_SECRET)}
async function verify(req,env){const [p,s]=(req.headers.get('Authorization')||'').slice(7).split('.');if(!p||!s||s!==await sign(p,env.JWT_SECRET))return null;const o=JSON.parse(dec.decode(ub64(p)));return o.x>Date.now()?o:null}
async function saveUser(db,username,name,password,role){const salt=b64(crypto.getRandomValues(new Uint8Array(12)));const h=await pw(password,salt);
  await db.prepare('INSERT INTO users(username,name,role,salt,hash) VALUES(?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET name=excluded.name,role=excluded.role,salt=excluded.salt,hash=excluded.hash').bind(username,name,role,salt,h).run()}

const cl=s=>String(s??'').replace(/[<>"&]/g,'');
const T={teachers:['name','load'],subjects:['code','name','periods'],classes:['name'],rooms:['name'],periods:['label','start','end','is_break'],assignments:['class_id','subject_id','teacher_id','teacher2_id','room_id','periods']};
const REF={teachers:'teacher_id',subjects:'subject_id',classes:'class_id',rooms:'room_id',periods:'period'};

async function checkEntry(db,e){
  const per=await db.prepare('SELECT * FROM periods WHERE id=?').bind(e.period).first();
  if(!per)return 'ไม่พบคาบเรียน';
  if(per.is_break)return 'ไม่สามารถวางคาบในช่วงพัก';
  if(e.day<1||e.day>5)return 'วันไม่ถูกต้อง';
  if(e.teacher2_id&&e.teacher2_id==e.teacher_id)return 'ครูคนที่ 2 ต้องไม่ซ้ำกับครูคนแรก';
  for(const tv of [e.teacher_id,e.teacher2_id]){if(!tv)continue;const r=await db.prepare('SELECT c.name cn FROM entries x JOIN classes c ON c.id=x.class_id WHERE (x.teacher_id=? OR x.teacher2_id=?) AND x.day=? AND x.period=? AND x.id!=?').bind(tv,tv,e.day,e.period,e.id||0).first();if(r)return `ครูมีคาบสอนชนกับชั้น ${r.cn}`}
  for(const [c,v,msg] of [['room_id',e.room_id,'ห้องถูกใช้งานแล้วโดยชั้น'],['class_id',e.class_id,'ชั้นเรียนนี้มีวิชาซ้อนคาบอยู่แล้ว']]){
    if(!v)continue;
    const r=await db.prepare(`SELECT c.name cn FROM entries x JOIN classes c ON c.id=x.class_id WHERE x.${c}=? AND x.day=? AND x.period=? AND x.id!=?`).bind(v,e.day,e.period,e.id||0).first();
    if(r)return `${msg} ${r.cn}`;
  }
}
async function checkSub(db,b){
  const en=await db.prepare('SELECT * FROM entries WHERE id=?').bind(b.entry_id).first();
  if(!en)return 'ไม่พบคาบสอนประจำ';
  if(new Date(b.date+'T00:00:00Z').getUTCDay()!==en.day)return 'วันที่ไม่ตรงกับวันของคาบสอน';
  if(en.teacher_id==b.sub_teacher_id||en.teacher2_id==b.sub_teacher_id)return 'ครูแทนต้องไม่ใช่ครูเจ้าของคาบ';
  if(await db.prepare('SELECT 1 FROM entries WHERE (teacher_id=? OR teacher2_id=?) AND day=? AND period=?').bind(b.sub_teacher_id,b.sub_teacher_id,en.day,en.period).first())return 'ครูแทนมีคาบสอนปกติในช่วงเวลานี้';
  if(await db.prepare("SELECT 1 FROM subs s JOIN entries x ON x.id=s.entry_id WHERE s.status='approved' AND s.date=? AND s.sub_teacher_id=? AND x.period=?").bind(b.date,b.sub_teacher_id,en.period).first())return 'ครูแทนมีรายการสอนแทนอื่นในช่วงเวลานี้';
  if(await db.prepare("SELECT 1 FROM subs WHERE status='approved' AND date=? AND entry_id=?").bind(b.date,b.entry_id).first())return 'คาบนี้มีครูสอนแทนแล้ว';
}

export async function onRequest({request:req,env,params}){
  const db=env.DB,path=[].concat(params.path||[]),m=req.method,p0=path[0];
  try{
    const body=(m=='GET'||m=='DELETE')?{}:await req.json().catch(()=>({}));
    const me={u:'ผู้ใช้งาน',n:'ผู้ใช้งาน',r:'admin'},admin=true,ed=true;
    const audit=(a,d)=>db.prepare('INSERT INTO audit_logs(user,action,detail,at) VALUES(?,?,?,?)').bind(me.u,a,JSON.stringify(d),new Date().toISOString()).run();
    const note=t=>db.prepare('INSERT INTO notifications(text,at) VALUES(?,?)').bind(t,new Date().toISOString()).run();
    const all=async t=>(await db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()).results;

    if(p0=='data'){
      const settings={};for(const s of await all('settings'))settings[s.key]=s.value;
      const o={user:{username:me.u,name:me.n,role:me.r},settings};
      for(const t of [...Object.keys(T),'entries','subs'])o[t]=await all(t).catch(()=>[]);
      o.notifs=(await db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 30').all()).results;
      o.versions=(await db.prepare('SELECT id,name,status,created FROM versions ORDER BY id DESC').all()).results;
      o.audit=(await db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 60').all()).results;
      return J(o);
    }
    if(!ed&&m!='GET')return J({error:'ไม่มีสิทธิ์แก้ไขข้อมูล'},403);

    if(p0=='crud'&&T[path[1]]){
      const t=path[1],cols=T[t];
      if(m=='DELETE'){
        if(REF[t]&&await db.prepare(`SELECT 1 FROM entries WHERE ${REF[t]}=?${t=='teachers'?' OR teacher2_id=?':''}`).bind(...(t=='teachers'?[path[2],path[2]]:[path[2]])).first())return J({error:'ข้อมูลนี้ถูกใช้ในตารางสอนแล้ว ลบไม่ได้'},409);
        await db.prepare(`DELETE FROM ${t} WHERE id=?`).bind(path[2]).run();await audit('delete '+t,{id:path[2]});return J({ok:1});
      }
      const v=cols.map(c=>typeof body[c]=='string'?cl(body[c]):body[c]??null);
      if(body.id)await db.prepare(`UPDATE ${t} SET ${cols.map(c=>c+'=?').join(',')} WHERE id=?`).bind(...v,body.id).run();
      else await db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).bind(...v).run();
      await audit('save '+t,body);return J({ok:1});
    }
    if(p0=='entry'){
      if(m=='DELETE'){
        await db.prepare('DELETE FROM entries WHERE id=?').bind(path[1]).run();
        await db.prepare("UPDATE subs SET status='cancelled' WHERE entry_id=?").bind(path[1]).run();
        await audit('delete entry',{id:path[1]});return J({ok:1});
      }
      const e={id:body.id||0,class_id:+body.class_id,subject_id:+body.subject_id,teacher_id:+body.teacher_id,teacher2_id:body.teacher2_id?+body.teacher2_id:null,room_id:body.room_id?+body.room_id:null,day:+body.day,period:+body.period};
      if(!e.class_id||!e.subject_id||!e.teacher_id)return J({error:'กรุณาเลือกวิชาและครู'},400);
      const err=await checkEntry(db,e);if(err)return J({error:err},409);
      const v=[e.class_id,e.subject_id,e.teacher_id,e.teacher2_id,e.room_id,e.day,e.period];
      if(e.id)await db.prepare('UPDATE entries SET class_id=?,subject_id=?,teacher_id=?,teacher2_id=?,room_id=?,day=?,period=? WHERE id=?').bind(...v,e.id).run();
      else await db.prepare('INSERT INTO entries(class_id,subject_id,teacher_id,teacher2_id,room_id,day,period) VALUES(?,?,?,?,?,?,?)').bind(...v).run();
      await audit('save entry',e);return J({ok:1});
    }
    if(p0=='sub'){
      if(m=='DELETE'){await db.prepare("UPDATE subs SET status='cancelled' WHERE id=?").bind(path[1]).run();await audit('cancel sub',{id:path[1]});await note('ยกเลิกรายการสอนแทน #'+path[1]);return J({ok:1})}
      const err=await checkSub(db,body);if(err)return J({error:err},409);
      await db.prepare("INSERT INTO subs(date,entry_id,sub_teacher_id,reason,status,by,created) VALUES(?,?,?,?, 'approved',?,?)").bind(body.date,body.entry_id,body.sub_teacher_id,cl(body.reason),me.n,new Date().toISOString()).run();
      await audit('add sub',body);const tn=(await db.prepare('SELECT name FROM teachers WHERE id=?').bind(body.sub_teacher_id).first())?.name;await note(`มอบหมายสอนแทน วันที่ ${cl(body.date)} → ครู${tn}`);return J({ok:1});
    }
    if(p0=='users'&&admin&&m=='POST'){
      if(!body.username||!body.password||body.password.length<6)return J({error:'ต้องระบุชื่อผู้ใช้ และรหัสผ่านอย่างน้อย 6 ตัวอักษร'},400);
      await saveUser(db,body.username,body.name||body.username,body.password,['admin','academic','teacher','viewer'].includes(body.role)?body.role:'teacher');
      await audit('save user',{u:body.username,r:body.role});return J({ok:1});
    }
    const EC=['id','class_id','subject_id','teacher_id','teacher2_id','room_id','day','period'];
    const C={teachers:['id','name','load'],subjects:['id','code','name','periods'],classes:['id','name'],rooms:['id','name'],periods:['id','label','start','end','is_break'],entries:EC,subs:['id','date','entry_id','sub_teacher_id','reason','status','by','created'],assignments:['id','class_id','subject_id','teacher_id','teacher2_id','room_id','periods']};
    const put=(t,rows)=>[db.prepare(`DELETE FROM ${t}`),...(rows||[]).map(r=>db.prepare(`INSERT INTO ${t}(${C[t].join(',')}) VALUES(${C[t].map(()=>'?').join(',')})`).bind(...C[t].map(c=>typeof r[c]=='string'?cl(r[c]):r[c]??null)))];
    const dupes=rows=>{const s=new Set();for(const r of rows)for(const [k,v] of [['t',r.teacher_id],['t',r.teacher2_id],['c',r.class_id],['r',r.room_id]]){if(!v)continue;const key=k+v+'|'+r.day+'|'+r.period;if(s.has(key))return true;s.add(key)}return false};
    if(p0=='assignments'&&path[1]=='replace'&&m=='POST'){await db.batch(put('assignments',body.rows));await audit('replace assignments',{n:(body.rows||[]).length});return J({ok:1})}
    if(p0=='entries'&&path[1]=='replace'&&m=='POST'){await db.batch(put('entries',body.rows));await audit('replace entries',{n:(body.rows||[]).length});return J({ok:1})}
    if(p0=='backup'&&m=='GET'){const o={app:'br-smart-timetable',at:new Date().toISOString()};for(const t of Object.keys(C))o[t]=await all(t);o.settings_kv=await all('settings');return J(o)}
    if(p0=='restore'&&m=='POST'){if(body.app!='br-smart-timetable')return J({error:'ไฟล์สำรองไม่ถูกต้อง'},400);await db.batch([...Object.keys(C).flatMap(t=>put(t,body[t])),...(body.settings_kv||[]).filter(r=>r&&r.key&&r.key!='seeded').map(r=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(String(r.key),String(r.value??'')))]);await audit('restore',{at:body.at});await note('กู้คืนข้อมูลจากไฟล์สำรอง');return J({ok:1})}
    if(p0=='version'){
      const id=path[1],step=path[2];
      if(m=='POST'&&!id){const rows=await all('entries');await db.prepare("INSERT INTO versions(name,status,snapshot,created) VALUES(?, 'draft',?,?)").bind(cl(body.name)||'ฉบับร่าง',JSON.stringify(rows),new Date().toISOString()).run();await audit('save version',{name:body.name});return J({ok:1})}
      const v=await db.prepare('SELECT * FROM versions WHERE id=?').bind(id).first();if(!v)return J({error:'ไม่พบฉบับตาราง'},404);
      if(m=='DELETE'){await db.prepare('DELETE FROM versions WHERE id=?').bind(id).run();return J({ok:1})}
      if(step=='restore'){await db.batch(put('entries',JSON.parse(v.snapshot)));await audit('restore version',{id});await note(`กู้คืนตารางจากฉบับ "${v.name}"`);return J({ok:1})}
      if(step=='status'){const nx={draft:'checked',checked:'published',published:'archived'}[v.status];if(!nx)return J({error:'ฉบับนี้เป็นฉบับเก่าแล้ว'},409);
        if(nx=='checked'&&dupes(JSON.parse(v.snapshot)))return J({error:'ฉบับนี้ยังมีข้อขัดแย้ง กรุณาตรวจสอบก่อน'},409);
        if(nx=='published')await db.prepare("UPDATE versions SET status='archived' WHERE status='published'").run();
        await db.prepare('UPDATE versions SET status=? WHERE id=?').bind(nx,id).run();await audit('version '+nx,{id});
        if(nx=='published')await note(`เผยแพร่ตารางสอนฉบับ "${v.name}" แล้ว`);return J({ok:1})}
    }
    if(p0=='notif'&&m=='POST'){await db.prepare('UPDATE notifications SET seen=1').run();return J({ok:1})}
    if(p0=='settings'&&admin&&m=='POST'){
      const up=(k,v)=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,String(v)).run();
      for(const k of ['year','term'])if(body[k])await up(k,cl(body[k]).slice(0,40));
      for(const k of ['school','office','director','academic','printtheme'])if(typeof body[k]=='string')await up(k,cl(body[k]).trim().slice(0,120));
      if(body.showcredit!==undefined)await up('showcredit',body.showcredit?'1':'0');
      if(body.cellopts&&typeof body.cellopts=='object'){let o={};try{o=JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='cellopts'").first())?.value||'{}')||{}}catch(e){}for(const m of ['class','teacher','room'])if(body.cellopts[m]&&typeof body.cellopts[m]=='object'){o[m]=o[m]||{};for(const f of ['subject','code','teacher','class','room'])if(f in body.cellopts[m])o[m][f]=body.cellopts[m][f]?1:0}await up('cellopts',JSON.stringify(o))}
      if(body.homerooms&&typeof body.homerooms=='object'){const o={};for(const [c,a] of Object.entries(body.homerooms)){const ids=[].concat(a||[]).slice(0,2).map(x=>Number.isInteger(+x)&&+x>0?+x:null);if(+c>0)o[+c]=ids}await up('homerooms',JSON.stringify(o))}
      await audit('save settings',Object.keys(body));
      return J({ok:1});
    }
    return J({error:'ไม่พบเมนูนี้ หรือไม่มีสิทธิ์'},404);
  }catch(x){return J({error:'เซิร์ฟเวอร์ผิดพลาด: '+x.message},500)}
}
