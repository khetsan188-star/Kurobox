const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json;charset=UTF-8', 'cache-control': 'no-store' } });
const text = (data, status = 200) => new Response(data, { status, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
const uid = (prefix='id') => `${prefix}_${crypto.randomUUID()}`;

function b64(bytes) { let s=''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
function randomToken(n=32) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64(a); }
async function sha256(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return b64(new Uint8Array(h)); }
async function hashPassword(password, salt) { return sha256(`${salt}:${password}`); }
function passwordRecord(password) { const salt = randomToken(16); return hashPassword(password, salt).then(hash => `${salt}$${hash}`); }
async function verifyPassword(password, record) { const [salt, hash] = String(record).split('$'); return hash && await hashPassword(password, salt) === hash; }
function cors(r) { r.headers.set('Access-Control-Allow-Origin','*'); r.headers.set('Access-Control-Allow-Headers','Content-Type, Authorization, X-Admin-Key'); r.headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS'); return r; }
async function body(request) { try { return await request.json(); } catch { return {}; } }
async function auth(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > datetime('now')`).bind(token).first();
  return row || null;
}
function weighted(rows) {
  const available = rows.filter(r => Number(r.stock) > 0);
  const total = available.reduce((a,r)=>a+Number(r.probability),0);
  if (!total) return null;
  const r = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * total;
  let acc=0; for (const row of available) { acc += Number(row.probability); if (r < acc) return row; }
  return available.at(-1);
}

async function api(request, env) {
  const url = new URL(request.url), path=url.pathname;
  if (request.method === 'OPTIONS') return cors(new Response(null,{status:204}));
  try {
    if (path === '/api/health') return cors(json({ok:true,service:'KuroBox Business API',time:new Date().toISOString()}));

    if (path === '/api/boxes' && request.method === 'GET') {
      const boxes = await env.DB.prepare(`SELECT * FROM boxes WHERE active=1 ORDER BY created_at DESC`).all();
      const out=[];
      for (const b of boxes.results) {
        const rewards = await env.DB.prepare(`SELECT id,name,rarity,probability,stock,image FROM rewards WHERE box_id=? ORDER BY probability DESC`).bind(b.id).all();
        out.push({...b,rewards:rewards.results});
      }
      return cors(json({boxes:out}));
    }

    if (path === '/api/auth/register' && request.method === 'POST') {
      const {email,name,password}=await body(request);
      if (!email || !name || !password || String(password).length < 8) return cors(json({error:'Email, nama, dan password minimal 8 karakter wajib diisi.'},400));
      const exists=await env.DB.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').bind(String(email).trim()).first();
      if (exists) return cors(json({error:'Email sudah terdaftar.'},409));
      const id=uid('usr'), record=await passwordRecord(String(password));
      await env.DB.prepare('INSERT INTO users (id,email,name,password_hash,coins) VALUES (?,?,?,?,0)').bind(id,String(email).trim().toLowerCase(),String(name).trim(),record).run();
      const token=randomToken(32), exp=new Date(Date.now()+1000*60*60*24*30).toISOString();
      await env.DB.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').bind(token,id,exp).run();
      return cors(json({token,user:{id,email:String(email).trim().toLowerCase(),name:String(name).trim(),coins:0}} ,201));
    }

    if (path === '/api/auth/login' && request.method === 'POST') {
      const {email,password}=await body(request); const u=await env.DB.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').bind(String(email||'').trim()).first();
      if (!u || !(await verifyPassword(String(password||''),u.password_hash))) return cors(json({error:'Email atau password salah.'},401));
      const token=randomToken(32), exp=new Date(Date.now()+1000*60*60*24*30).toISOString();
      await env.DB.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').bind(token,u.id,exp).run();
      return cors(json({token,user:{id:u.id,email:u.email,name:u.name,coins:u.coins,role:u.role}}));
    }

    const user=await auth(request,env);
    if (path === '/api/me' && request.method === 'GET') return cors(user ? json({user:{id:user.id,email:user.email,name:user.name,coins:user.coins,role:user.role}}) : json({user:null},401));

    if (path === '/api/inventory' && request.method === 'GET') {
      if (!user) return cors(json({error:'Login diperlukan.'},401));
      const rows=await env.DB.prepare(`SELECT i.id,i.status,i.created_at,r.name,r.rarity,r.image,b.name AS box_name FROM inventory i JOIN rewards r ON r.id=i.reward_id JOIN boxes b ON b.id=r.box_id WHERE i.user_id=? ORDER BY i.created_at DESC`).bind(user.id).all();
      return cors(json({inventory:rows.results}));
    }

    if (path === '/api/gacha' && request.method === 'POST') {
      if (!user) return cors(json({error:'Login diperlukan.'},401));
      const {boxId}=await body(request); if (!boxId) return cors(json({error:'boxId wajib.'},400));
      const box=await env.DB.prepare('SELECT * FROM boxes WHERE id=? AND active=1').bind(boxId).first(); if(!box) return cors(json({error:'Box tidak ditemukan.'},404));
      const debit=await env.DB.prepare('UPDATE users SET coins=coins-? WHERE id=? AND coins>=?').bind(box.price_coins,user.id,box.price_coins).run();
      if (!debit.meta?.changes) return cors(json({error:'Koin tidak cukup.',required:box.price_coins},402));
      const rewards=(await env.DB.prepare('SELECT * FROM rewards WHERE box_id=? AND stock>0').bind(boxId).all()).results;
      const reward=weighted(rewards);
      if (!reward) { await env.DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(box.price_coins,user.id).run(); return cors(json({error:'Stok hadiah habis.'},409)); }
      const stock=await env.DB.prepare('UPDATE rewards SET stock=stock-1 WHERE id=? AND stock>0').bind(reward.id).run();
      if (!stock.meta?.changes) { await env.DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(box.price_coins,user.id).run(); return cors(json({error:'Hadiah baru saja habis, coba lagi.'},409)); }
      const logId=uid('gacha'), invId=uid('inv');
      await env.DB.batch([
        env.DB.prepare('INSERT INTO gacha_logs (id,user_id,box_id,reward_id,cost_coins) VALUES (?,?,?,?,?)').bind(logId,user.id,boxId,reward.id,box.price_coins),
        env.DB.prepare('INSERT INTO inventory (id,user_id,reward_id,gacha_log_id) VALUES (?,?,?,?)').bind(invId,user.id,reward.id,logId),
        env.DB.prepare('INSERT INTO coin_ledger (id,user_id,amount,type,reference_id,note) VALUES (?,?,?,?,?,?)').bind(uid('ledger'),user.id,-box.price_coins,'gacha',logId,`Gacha ${box.name}`)
      ]);
      const fresh=await env.DB.prepare('SELECT coins FROM users WHERE id=?').bind(user.id).first();
      return cors(json({success:true,coins:fresh.coins,reward:{id:reward.id,name:reward.name,rarity:reward.rarity,image:reward.image},logId}));
    }

    if (path === '/api/topup/request' && request.method === 'POST') {
      if (!user) return cors(json({error:'Login diperlukan.'},401));
      const {coins,amountIdr}=await body(request); const c=Number(coins), a=Number(amountIdr);
      if(!Number.isInteger(c)||c<1||!Number.isInteger(a)||a<1) return cors(json({error:'Jumlah top up tidak valid.'},400));
      const id=uid('topup'); await env.DB.prepare('INSERT INTO topup_requests (id,user_id,coins,amount_idr) VALUES (?,?,?,?)').bind(id,user.id,c,a).run();
      return cors(json({success:true,id,status:'pending',message:'Permintaan dibuat. Hubungkan endpoint ini ke payment gateway/QRIS sebelum produksi.'},201));
    }

    if (path.startsWith('/api/admin/')) {
      const key=request.headers.get('X-Admin-Key')||''; if(!env.ADMIN_KEY || key!==env.ADMIN_KEY) return cors(json({error:'Admin unauthorized.'},401));
      if (path === '/api/admin/stats' && request.method === 'GET') {
        const [u,g,i,p]=await Promise.all([env.DB.prepare('SELECT COUNT(*) c FROM users').first(),env.DB.prepare('SELECT COUNT(*) c FROM gacha_logs').first(),env.DB.prepare('SELECT COUNT(*) c FROM inventory').first(),env.DB.prepare("SELECT COUNT(*) c FROM topup_requests WHERE status='pending'").first()]);
        return cors(json({users:u.c,gacha:g.c,inventory:i.c,pendingTopups:p.c}));
      }
      if (path === '/api/admin/approve-topup' && request.method === 'POST') {
        const {id,paymentReference}=await body(request); const t=await env.DB.prepare("SELECT * FROM topup_requests WHERE id=? AND status='pending'").bind(id).first(); if(!t) return cors(json({error:'Top up tidak ditemukan.'},404));
        await env.DB.batch([
          env.DB.prepare("UPDATE topup_requests SET status='approved',payment_reference=?,reviewed_at=datetime('now') WHERE id=?").bind(paymentReference||'',id),
          env.DB.prepare('UPDATE users SET coins=coins+? WHERE id=?').bind(t.coins,t.user_id),
          env.DB.prepare('INSERT INTO coin_ledger (id,user_id,amount,type,reference_id,note) VALUES (?,?,?,?,?,?)').bind(uid('ledger'),t.user_id,t.coins,'topup',id,'Top up disetujui admin')
        ]);
        return cors(json({success:true}));
      }
    }

    return cors(json({error:'Not found'},404));
  } catch (e) { console.error(e); return cors(json({error:'Server error',detail:String(e?.message||e)},500)); }
}

export default { async fetch(request,env,ctx) { const url=new URL(request.url); if(url.pathname.startsWith('/api/')) return api(request,env); return env.ASSETS.fetch(request); } };
