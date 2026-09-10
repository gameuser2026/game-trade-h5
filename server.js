/**
 * 币易商城 - 自营商品交易平台（扫码付款 + 截图确认）
 * 零依赖：仅使用 Node.js 内置模块
 * 功能：商品管理(后台) / 下单 / 收款码收款 / 付款凭证上传确认 / 发货收货 / 在线客服 / 币安实盘交易(本人API Key)
 * 说明：货款通过卖家收款码线下扫码收取，平台仅做订单与凭证管理，不接入任何第三方支付通道
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUB_DIR = path.join(ROOT, 'public');
const UP_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DB_FILE = path.join(DATA_DIR, 'data.json');
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');
const SECRET = process.env.SECRET || 'biyi-mall-secret-2026';

if (!fs.existsSync(UP_DIR)) fs.mkdirSync(UP_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PAY_CHANNELS = {
  alipay: { name: '支付宝', icon: '🅰️', color: '#1677ff' },
  wechat: { name: '微信支付', icon: '💚', color: '#16b364' }
};

/* ---------------- 数据存储 ---------------- */
let db;
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = null; }
  }
  if (!db || !db.users) {
    db = {
      users: [], products: [], orders: [],
      supportConvs: [], supportMsgs: [],
      paycodes: { alipay: { img: '', name: '', account: '' }, wechat: { img: '', name: '', account: '' } },
      seq: { u: 1, p: 1, o: 1, c: 1, m: 1 }
    };
    seed();
    saveDb();
  }
  ['users', 'products', 'orders', 'supportConvs', 'supportMsgs'].forEach(k => { if (!db[k]) db[k] = []; });
  if (!db.paycodes) db.paycodes = { alipay: { img: '', name: '', account: '' }, wechat: { img: '', name: '', account: '' } };
  if (!db.seq) db.seq = {};
  ['u', 'p', 'o', 'c', 'm'].forEach(k => { if (!db.seq[k]) db.seq[k] = 1; });
}
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function nextId(k) { return k + (db.seq[k]++); }
function orderNo() { return 'M' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100); }

/* ---------------- 密码 / Token ---------------- */
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(8).toString('hex');
  const hash = crypto.pbkdf2Sync(pw, salt, 12000, 32, 'sha256').toString('hex');
  return salt + ':' + hash;
}
function verifyPw(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.pbkdf2Sync(pw, salt, 12000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}
function sign(u) {
  const payload = Buffer.from(JSON.stringify({ uid: u.id, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function authUser(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (s !== expect) return null;
  try {
    const data = JSON.parse(Buffer.from(p, 'base64url').toString());
    return db.users.find(u => u.id === data.uid) || null;
  } catch (e) { return null; }
}

/* ---------------- 工具 ---------------- */
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 8 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('invalid json')); } });
    req.on('error', reject);
  });
}
function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}
function maskName(name) {
  if (!name) return '用户';
  if (name.length <= 1) return name + '**';
  return name[0] + '*'.repeat(Math.max(1, name.length - 1));
}
// dataURL 图片保存到 uploads，返回 /uploads/xxx 路径；失败返回 null
function saveDataUrlImage(data) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 100 || buf.length > 6 * 1024 * 1024) return null;
  const name = 'img_' + crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UP_DIR, name), buf);
  return '/uploads/' + name;
}

/* ---------------- 种子数据 ---------------- */
function seed() {
  const mk = (phone, pw, name, role) => {
    const u = {
      id: nextId('u'), phone, password: hashPw(pw), realName: name, role: role || 'user',
      lastContact: null, createdAt: Date.now() - 86400000 * 20
    };
    db.users.push(u);
    return u;
  };
  const admin = mk('13800000000', 'admin123', '平台管理员', 'admin');
  admin.createdAt = Date.now() - 86400000 * 90;
  mk('13900000001', 'seller123', '张伟');
  mk('13700000004', 'merchant123', '王芳');
  mk('13900000002', 'buyer123', '李娜');

  // 演示商品（图片位于 uploads/，由启动脚本生成；缺失时前端显示占位底色）
  const demo = [
    { t: '无线蓝牙耳机 半入耳式 超长续航', c: '数码', price: 129, stock: 50, img: 'prod_earbuds.jpg', d: '· 蓝牙5.3，开盖即连\n· 单次续航6小时，配合充电仓24小时\n· 智能降噪，通话清晰\n· 一年质保，7天无理由退换' },
    { t: '316不锈钢保温杯 500ml 大容量', c: '生活', price: 59, stock: 80, img: 'prod_cup.jpg', d: '· 316食品级不锈钢内胆\n· 保温12小时/保冷24小时\n· 一键弹盖，单手可开\n· 磨砂手感，防滑耐磨' },
    { t: '铝合金桌面手机支架 可折叠', c: '数码', price: 29.9, stock: 200, img: 'prod_stand.jpg', d: '· 航空铝合金，稳固不晃\n· 角度随意调，追剧直播神器\n· 折叠后仅卡片大小，便携出行\n· 硅胶防滑垫，不伤手机' },
    { t: '声波电动牙刷 软毛深层清洁', c: '生活', price: 99, stock: 60, img: 'prod_brush.jpg', d: '· 每分钟42000次声波震动\n· 5档清洁模式，敏感牙适用\n· 30天超长续航，USB快充\n· IPX7防水，全身水洗\n· 赠2支原装刷头' },
    { t: '迷你手持小风扇 USB充电 夏季神器', c: '生活', price: 39.9, stock: 150, img: 'prod_fan.jpg', d: '· 三档风力，一键调节\n· 2000mAh电池，续航8小时\n· 手持/台式两用，带底座\n· 静音电机，办公室可用' },
    { t: '三合一快充数据线 1.2米 尼龙编织', c: '数码', price: 12.9, stock: 500, img: 'prod_cable.jpg', d: '· Type-C/苹果/安卓三接口\n· 60W快充，充电不减速\n· 尼龙编织线材，耐折10000次\n· 一线三用，出门只需一根' }
  ];
  demo.forEach((d, i) => {
    db.products.push({
      id: nextId('p'), title: d.t, category: d.c, price: d.price, stock: d.stock, sales: Math.floor(Math.random() * 300 + 20),
      images: fs.existsSync(path.join(UP_DIR, d.img)) ? ['/uploads/' + d.img] : [],
      desc: d.d, status: 'on', createdAt: Date.now() - 86400000 * (i + 1)
    });
  });
}

/* ---------------- 视图 ---------------- */
function productView(p) {
  return { ...p, soldout: p.stock <= 0 };
}
function orderView(o, me) {
  const ch = PAY_CHANNELS[o.payChannel];
  const isAdmin = me && me.role === 'admin';
  const isBuyer = me && me.id === o.userId;
  const v = {
    id: o.id, no: o.no, status: o.status,
    item: o.item, total: o.total,
    contact: o.contact,
    payChannel: o.payChannel || '', payChannelName: ch ? ch.name : '',
    payShot: isBuyer || isAdmin ? (o.payShot || '') : '',
    shipCompany: o.shipCompany || '', shipNo: o.shipNo || '',
    timeline: o.timeline || [], createdAt: o.createdAt
  };
  if (isAdmin) { v.userName = maskName((db.users.find(u => u.id === o.userId) || {}).realName); v.userPhone = (db.users.find(u => u.id === o.userId) || {}).phone || ''; }
  return v;
}

/* ================= 业务接口 ================= */
async function handleApi(req, res, pathname, url) {
  const me = authUser(req);
  const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
  const seg = pathname.split('/').filter(Boolean);
  const needLogin = () => { if (!me) { json(res, 401, { error: '请先登录' }); return true; } return false; };
  const needAdmin = () => { if (!me || me.role !== 'admin') { json(res, 403, { error: '无管理员权限' }); return true; } return false; };

  /* ---------- 认证 ---------- */
  if (pathname === '/api/register' && req.method === 'POST') {
    const phone = String(body.phone || '').trim();
    const realName = String(body.realName || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return json(res, 400, { error: '手机号格式不正确' });
    if (!body.password || body.password.length < 6) return json(res, 400, { error: '密码至少6位' });
    if (!realName || realName.length < 2) return json(res, 400, { error: '请输入姓名（2位以上）' });
    if (db.users.some(u => u.phone === phone)) return json(res, 400, { error: '该手机号已注册' });
    const u = { id: nextId('u'), phone, password: hashPw(body.password), realName, role: 'user', lastContact: null, createdAt: Date.now() };
    db.users.push(u); saveDb();
    return json(res, 200, { token: sign(u), user: publicUser(u) });
  }
  if (pathname === '/api/login' && req.method === 'POST') {
    const phone = String(body.phone || '').trim();
    const u = db.users.find(x => x.phone === phone);
    if (!u || !verifyPw(body.password || '', u.password)) return json(res, 400, { error: '手机号或密码错误' });
    return json(res, 200, { token: sign(u), user: publicUser(u) });
  }
  if (pathname === '/api/me' && req.method === 'GET') {
    if (needLogin()) return;
    return json(res, 200, { user: publicUser(me) });
  }

  /* ---------- 商品 ---------- */
  if (pathname === '/api/products' && req.method === 'GET') {
    const kw = String(url.searchParams.get('kw') || '').trim().toLowerCase();
    const cat = String(url.searchParams.get('cat') || '').trim();
    let list = db.products.filter(p => p.status === 'on');
    if (cat && cat !== '全部') list = list.filter(p => p.category === cat);
    if (kw) list = list.filter(p => p.title.toLowerCase().includes(kw));
    list = list.sort((a, b) => b.sales - a.sales).map(productView);
    const cats = ['全部', ...Array.from(new Set(db.products.filter(p => p.status === 'on').map(p => p.category)))];
    return json(res, 200, { list, cats });
  }
  if (seg[1] === 'products' && seg[2] && !seg[3] && req.method === 'GET') {
    const p = db.products.find(x => x.id === seg[2] && x.status === 'on');
    if (!p) return json(res, 404, { error: '商品不存在或已下架' });
    return json(res, 200, { product: productView(p) });
  }

  /* ---------- 收款码（买家付款页读取） ---------- */
  if (pathname === '/api/paycodes' && req.method === 'GET') {
    if (needLogin()) return;
    return json(res, 200, { paycodes: db.paycodes });
  }

  /* ---------- 订单（买家） ---------- */
  if (pathname === '/api/orders' && req.method === 'POST') {
    if (needLogin()) return;
    const p = db.products.find(x => x.id === body.productId && x.status === 'on');
    if (!p) return json(res, 400, { error: '商品不存在或已下架' });
    const qty = Math.floor(Number(body.qty));
    if (!(qty > 0) || qty > 99) return json(res, 400, { error: '购买数量不正确' });
    if (p.stock < qty) return json(res, 400, { error: `库存不足（仅剩 ${p.stock} 件）` });
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const address = String(body.address || '').trim();
    if (!name) return json(res, 400, { error: '请填写收货人姓名' });
    if (!/^1[3-9]\d{9}$/.test(phone)) return json(res, 400, { error: '请填写正确的联系电话' });
    if (address.length < 5) return json(res, 400, { error: '请填写详细收货地址' });
    p.stock -= qty;
    me.lastContact = { name, phone, address };
    const o = {
      id: nextId('o'), no: orderNo(), userId: me.id,
      item: { productId: p.id, title: p.title, image: (p.images && p.images[0]) || '', price: p.price, qty },
      total: Math.round(p.price * qty * 100) / 100,
      contact: { name, phone, address },
      status: 'pending_pay', payChannel: '', payShot: '',
      shipCompany: '', shipNo: '',
      timeline: [{ at: Date.now(), text: '订单创建成功，请扫码付款后上传付款凭证' }],
      createdAt: Date.now()
    };
    db.orders.push(o); saveDb();
    return json(res, 200, { ok: true, order: orderView(o, me) });
  }
  if (pathname === '/api/orders' && req.method === 'GET') {
    if (needLogin()) return;
    const list = db.orders.filter(o => o.userId === me.id).sort((a, b) => b.createdAt - a.createdAt).map(o => orderView(o, me));
    return json(res, 200, { list });
  }
  if (seg[1] === 'orders' && seg[2] && !seg[3] && req.method === 'GET') {
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (!me || (me.role !== 'admin' && me.id !== o.userId)) return json(res, 403, { error: '无权查看' });
    return json(res, 200, { order: orderView(o, me) });
  }
  // 上传付款凭证
  if (seg[1] === 'orders' && seg[3] === 'pay' && req.method === 'POST') {
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (!me || me.id !== o.userId) return json(res, 403, { error: '无权操作' });
    if (o.status !== 'pending_pay') return json(res, 400, { error: '当前订单状态无需上传凭证' });
    const channel = PAY_CHANNELS[body.channel] ? body.channel : '';
    if (!channel) return json(res, 400, { error: '请选择付款方式' });
    const img = saveDataUrlImage(body.image);
    if (!img) return json(res, 400, { error: '付款截图格式不正确（需为图片）' });
    o.payChannel = channel; o.payShot = img;
    o.status = 'pending_confirm';
    o.timeline.push({ at: Date.now(), text: `买家已上传${PAY_CHANNELS[channel].name}付款凭证，等待平台确认收款` });
    saveDb();
    return json(res, 200, { ok: true, order: orderView(o, me) });
  }
  // 买家取消（仅待付款）
  if (seg[1] === 'orders' && seg[3] === 'cancel' && req.method === 'POST') {
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (!me || me.id !== o.userId) return json(res, 403, { error: '无权操作' });
    if (o.status !== 'pending_pay') return json(res, 400, { error: '订单已付款，不能取消，请联系客服处理' });
    const p = db.products.find(x => x.id === o.item.productId);
    if (p) p.stock += o.item.qty;
    o.status = 'cancelled';
    o.timeline.push({ at: Date.now(), text: '买家取消订单，库存已释放' });
    saveDb();
    return json(res, 200, { ok: true, order: orderView(o, me) });
  }
  // 买家确认收货
  if (seg[1] === 'orders' && seg[3] === 'receive' && req.method === 'POST') {
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (!me || me.id !== o.userId) return json(res, 403, { error: '无权操作' });
    if (o.status !== 'shipped') return json(res, 400, { error: '订单尚未发货' });
    o.status = 'completed'; o.completedAt = Date.now();
    const p = db.products.find(x => x.id === o.item.productId);
    if (p) p.sales += o.item.qty;
    o.timeline.push({ at: Date.now(), text: '买家确认收货，交易完成' });
    saveDb();
    return json(res, 200, { ok: true, order: orderView(o, me) });
  }

  /* ---------- 在线客服（用户侧） ---------- */
  if (pathname === '/api/support/conversation' && req.method === 'GET') {
    if (needLogin()) return;
    const conv = db.supportConvs.find(c => c.userId === me.id);
    let messages = [];
    if (conv) {
      db.supportMsgs.forEach(m => { if (m.convId === conv.id && m.from === 'admin') m.userRead = true; });
      messages = db.supportMsgs.filter(m => m.convId === conv.id).sort((a, b) => a.at - b.at);
      saveDb();
    }
    return json(res, 200, { conv: conv ? { id: conv.id, status: conv.status } : null, messages });
  }
  if (pathname === '/api/support/messages' && req.method === 'POST') {
    if (needLogin()) return;
    const content = String(body.content || '').trim().slice(0, 1000);
    if (!content) return json(res, 400, { error: '请输入消息内容' });
    let conv = db.supportConvs.find(c => c.userId === me.id);
    if (!conv) {
      conv = { id: nextId('c'), userId: me.id, status: 'open', createdAt: Date.now(), lastAt: Date.now(), lastMsg: '' };
      db.supportConvs.push(conv);
      db.supportMsgs.push({
        id: nextId('m'), convId: conv.id, from: 'admin', at: Date.now(),
        content: '您好，这里是币易商城官方客服。下单、付款、发货、售后问题都可以咨询～', userRead: false
      });
    }
    const m = { id: nextId('m'), convId: conv.id, from: 'user', content, at: Date.now(), adminRead: false };
    db.supportMsgs.push(m);
    conv.lastAt = Date.now(); conv.lastMsg = content; conv.status = 'open';
    saveDb();
    const messages = db.supportMsgs.filter(x => x.convId === conv.id).sort((a, b) => a.at - b.at);
    return json(res, 200, { ok: true, convId: conv.id, message: m, messages });
  }

  /* ================= 管理员后台 ================= */
  if (seg[1] === 'admin') {
    if (needAdmin()) return;

    if (pathname === '/api/admin/overview' && req.method === 'GET') {
      const cnt = s => db.orders.filter(o => o.status === s).length;
      const revenue = db.orders.filter(o => o.status === 'completed').reduce((s, o) => s + o.total, 0);
      return json(res, 200, {
        users: db.users.filter(u => u.role !== 'admin').length,
        products: db.products.length,
        onSale: db.products.filter(p => p.status === 'on').length,
        ordersTotal: db.orders.length,
        pendingConfirm: cnt('pending_confirm'),
        pendingShip: cnt('pending_ship'),
        shipped: cnt('shipped'),
        revenue: Math.round(revenue * 100) / 100
      });
    }

    /* ---- 商品管理 ---- */
    if (pathname === '/api/admin/products' && req.method === 'GET') {
      const list = db.products.slice().sort((a, b) => b.createdAt - a.createdAt).map(productView);
      return json(res, 200, { list });
    }
    function validateProduct(body) {
      const title = String(body.title || '').trim();
      const category = String(body.category || '其他').trim() || '其他';
      const price = Math.round(Number(body.price) * 100) / 100;
      const stock = Math.floor(Number(body.stock));
      const desc = String(body.desc || '').trim().slice(0, 3000);
      let images = Array.isArray(body.images) ? body.images.slice(0, 5) : [];
      if (title.length < 2 || title.length > 60) return { error: '商品标题需2-60字' };
      if (!(price > 0) || price > 999999) return { error: '请输入正确的售价' };
      if (!(stock >= 0) || stock > 999999) return { error: '请输入正确的库存' };
      const imgs = [];
      for (const it of images) {
        if (String(it).startsWith('/uploads/')) { imgs.push(it); continue; }
        const saved = saveDataUrlImage(it);
        if (!saved) return { error: '商品图片格式不正确（需为图片文件）' };
        imgs.push(saved);
      }
      return { title, category, price, stock, desc, images: imgs };
    }
    if (pathname === '/api/admin/products' && req.method === 'POST') {
      const v = validateProduct(body);
      if (v.error) return json(res, 400, { error: v.error });
      const p = { id: nextId('p'), ...v, sales: 0, status: 'on', createdAt: Date.now() };
      db.products.push(p); saveDb();
      return json(res, 200, { ok: true, product: productView(p) });
    }
    if (seg[2] === 'products' && seg[3] && seg[4] === 'toggle' && req.method === 'POST') {
      const p = db.products.find(x => x.id === seg[3]);
      if (!p) return json(res, 404, { error: '商品不存在' });
      p.status = p.status === 'on' ? 'off' : 'on';
      saveDb();
      return json(res, 200, { ok: true, status: p.status });
    }
    if (seg[2] === 'products' && seg[3] && req.method === 'PUT') {
      const p = db.products.find(x => x.id === seg[3]);
      if (!p) return json(res, 404, { error: '商品不存在' });
      const v = validateProduct({ ...p, ...body, images: Array.isArray(body.images) ? body.images : p.images });
      if (v.error) return json(res, 400, { error: v.error });
      Object.assign(p, v);
      saveDb();
      return json(res, 200, { ok: true, product: productView(p) });
    }
    if (seg[2] === 'products' && seg[3] && req.method === 'DELETE') {
      const i = db.products.findIndex(x => x.id === seg[3]);
      if (i < 0) return json(res, 404, { error: '商品不存在' });
      const ordered = db.orders.some(o => o.item.productId === seg[3] && !['cancelled'].includes(o.status));
      if (ordered) return json(res, 400, { error: '该商品有订单记录，不能删除，请下架即可' });
      db.products.splice(i, 1); saveDb();
      return json(res, 200, { ok: true });
    }

    /* ---- 订单管理 ---- */
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      const st = String(url.searchParams.get('status') || '');
      let list = db.orders.slice().sort((a, b) => b.createdAt - a.createdAt);
      if (st) list = list.filter(o => o.status === st);
      return json(res, 200, { list: list.map(o => orderView(o, me)) });
    }
    // 确认收款：pending_confirm -> pending_ship
    if (seg[2] === 'orders' && seg[4] === 'confirm' && req.method === 'POST') {
      const o = db.orders.find(x => x.id === seg[3]);
      if (!o) return json(res, 404, { error: '订单不存在' });
      if (o.status !== 'pending_confirm') return json(res, 400, { error: '该订单不在待确认状态' });
      o.status = 'pending_ship';
      o.timeline.push({ at: Date.now(), text: '平台已确认收到货款，等待发货' });
      saveDb();
      return json(res, 200, { ok: true, order: orderView(o, me) });
    }
    // 退回凭证：pending_confirm -> pending_pay（收款码金额不符/未到账等）
    if (seg[2] === 'orders' && seg[4] === 'reject' && req.method === 'POST') {
      const o = db.orders.find(x => x.id === seg[3]);
      if (!o) return json(res, 404, { error: '订单不存在' });
      if (o.status !== 'pending_confirm') return json(res, 400, { error: '该订单不在待确认状态' });
      const reason = String(body.reason || '付款凭证审核未通过，请重新上传').slice(0, 200);
      o.status = 'pending_pay'; o.payShot = ''; o.payChannel = '';
      o.timeline.push({ at: Date.now(), text: '付款凭证被退回：' + reason });
      saveDb();
      return json(res, 200, { ok: true, order: orderView(o, me) });
    }
    // 发货：pending_ship -> shipped
    if (seg[2] === 'orders' && seg[4] === 'ship' && req.method === 'POST') {
      const o = db.orders.find(x => x.id === seg[3]);
      if (!o) return json(res, 404, { error: '订单不存在' });
      if (o.status !== 'pending_ship') return json(res, 400, { error: '该订单不在待发货状态' });
      const company = String(body.company || '').trim();
      const no = String(body.no || '').trim();
      if (!company) return json(res, 400, { error: '请填写快递公司' });
      if (!no) return json(res, 400, { error: '请填写快递单号' });
      o.shipCompany = company; o.shipNo = no;
      o.status = 'shipped'; o.shippedAt = Date.now();
      o.timeline.push({ at: Date.now(), text: `已发货：${company} ${no}，请买家注意查收` });
      saveDb();
      return json(res, 200, { ok: true, order: orderView(o, me) });
    }
    // 取消订单（待付款/待确认可取消，退库存）
    if (seg[2] === 'orders' && seg[4] === 'cancel' && req.method === 'POST') {
      const o = db.orders.find(x => x.id === seg[3]);
      if (!o) return json(res, 404, { error: '订单不存在' });
      if (!['pending_pay', 'pending_confirm'].includes(o.status)) return json(res, 400, { error: '已发货订单不能取消' });
      const p = db.products.find(x => x.id === o.item.productId);
      if (p) p.stock += o.item.qty;
      o.status = 'cancelled';
      o.timeline.push({ at: Date.now(), text: '平台取消订单' + (o.payShot ? '（货款线下联系买家退回）' : '') + '，库存已释放' });
      saveDb();
      return json(res, 200, { ok: true, order: orderView(o, me) });
    }

    /* ---- 收款码管理 ---- */
    if (pathname === '/api/admin/paycodes' && req.method === 'POST') {
      const channel = PAY_CHANNELS[body.channel] ? body.channel : '';
      if (!channel) return json(res, 400, { error: '收款方式不正确' });
      if (body.img !== undefined && body.img !== '') {
        const img = saveDataUrlImage(body.img);
        if (!img) return json(res, 400, { error: '收款码图片格式不正确（需为图片）' });
        db.paycodes[channel].img = img;
      }
      if (body.name !== undefined) db.paycodes[channel].name = String(body.name).trim().slice(0, 30);
      if (body.account !== undefined) db.paycodes[channel].account = String(body.account).trim().slice(0, 50);
      saveDb();
      return json(res, 200, { ok: true, paycodes: db.paycodes });
    }

    /* ---- 用户 ---- */
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const kw = String(url.searchParams.get('kw') || '').trim().toLowerCase();
      let list = db.users.map(u => ({
        id: u.id, realName: u.realName, name: maskName(u.realName), phone: u.phone,
        role: u.role, orderCount: db.orders.filter(o => o.userId === u.id).length,
        createdAt: u.createdAt
      }));
      if (kw) list = list.filter(u => (u.phone || '').includes(kw) || (u.realName || '').includes(kw));
      list.sort((a, b) => b.createdAt - a.createdAt);
      return json(res, 200, { list });
    }

    /* ---- 客服 ---- */
    if (pathname === '/api/admin/support/conversations' && req.method === 'GET') {
      const list = db.supportConvs.map(c => {
        const u = db.users.find(x => x.id === c.userId);
        const unread = db.supportMsgs.filter(m => m.convId === c.id && m.from === 'user' && !m.adminRead).length;
        return {
          id: c.id, userId: c.userId,
          userName: u ? maskName(u.realName) : '用户',
          userPhone: u ? u.phone : '',
          status: c.status, lastAt: c.lastAt, lastMsg: c.lastMsg || '', unread
        };
      }).sort((a, b) => b.lastAt - a.lastAt);
      return json(res, 200, { list });
    }
    if (seg[2] === 'support' && seg[3] === 'conversations' && seg[4] && !seg[5] && req.method === 'GET') {
      const c = db.supportConvs.find(x => x.id === seg[4]);
      if (!c) return json(res, 404, { error: '会话不存在' });
      db.supportMsgs.forEach(m => { if (m.convId === c.id && m.from === 'user') m.adminRead = true; });
      saveDb();
      const u = db.users.find(x => x.id === c.userId);
      const messages = db.supportMsgs.filter(m => m.convId === c.id).sort((a, b) => a.at - b.at);
      return json(res, 200, {
        conv: { id: c.id, userId: c.userId, userName: u ? u.realName : '用户', userPhone: u ? u.phone : '', status: c.status },
        messages
      });
    }
    if (seg[2] === 'support' && seg[3] === 'conversations' && seg[4] && seg[5] === 'messages' && req.method === 'POST') {
      const c = db.supportConvs.find(x => x.id === seg[4]);
      if (!c) return json(res, 404, { error: '会话不存在' });
      const content = String(body.content || '').trim().slice(0, 1000);
      if (!content) return json(res, 400, { error: '请输入回复内容' });
      const m = { id: nextId('m'), convId: c.id, from: 'admin', content, at: Date.now(), userRead: false };
      db.supportMsgs.push(m);
      c.lastAt = Date.now(); c.lastMsg = content; c.status = 'open';
      saveDb();
      return json(res, 200, { ok: true, message: m });
    }
  }

  /* ---------- 币安实盘交易（仅本人 API Key，不涉及第三方资金） ---------- */
  const BIN_HOSTS = {
    main: 'api.binance.com',
    test: 'testnet.binance.vision'
  };
  function loadKeys() {
    try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch (e) { return null; }
  }
  function saveKeys(k) { fs.writeFileSync(KEYS_FILE, JSON.stringify(k, null, 2)); }
  function binSign(query, secret) {
    return crypto.createHmac('sha256', secret).update(query).digest('hex');
  }
  function binRequest(host, bpath, method, params, keys, isPublic) {
    return new Promise((resolve, reject) => {
      const qs = params ? Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
      const fullPath = isPublic ? `${bpath}${qs ? '?' + qs : ''}`
        : `${bpath}?${qs}&timestamp=${Date.now()}&recvWindow=10000`;
      const headers = {};
      if (!isPublic) { headers['X-MBX-APIKEY'] = keys.apiKey; fullPath += '&signature=' + binSign(fullPath.split('?')[1], keys.secret); }
      const opts = { hostname: host, port: 443, path: fullPath, method, headers, timeout: 8000 };
      const rq = https.request(opts, r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => {
          try { resolve({ code: r.statusCode, data: JSON.parse(d) }); }
          catch (e) { resolve({ code: r.statusCode, data: null, raw: d }); }
        });
      });
      rq.on('timeout', () => rq.destroy(new Error('timeout')));
      rq.on('error', reject);
      rq.end();
    });
  }
  if (pathname === '/api/binance/keys' && req.method === 'POST') {
    if (needLogin()) return;
    const apiKey = String(body.apiKey || '').trim();
    const secret = String(body.secret || '').trim();
    const net = body.net === 'main' ? 'main' : 'test';
    if (!apiKey || apiKey.length < 20) return json(res, 400, { error: 'API Key 格式不正确' });
    if (!secret || secret.length < 20) return json(res, 400, { error: 'Secret Key 格式不正确' });
    saveKeys({ apiKey, secret, net, savedAt: Date.now() });
    return json(res, 200, { ok: true, net });
  }
  if (pathname === '/api/binance/keys' && req.method === 'GET') {
    if (needLogin()) return;
    const k = loadKeys();
    return json(res, 200, { configured: !!k, net: k ? k.net : null, apiKeyTail: k ? k.apiKey.slice(-6) : null });
  }
  if (pathname === '/api/binance/keys' && req.method === 'DELETE') {
    if (needLogin()) return;
    try { fs.unlinkSync(KEYS_FILE); } catch (e) {}
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/binance/account' && req.method === 'GET') {
    if (needLogin()) return;
    const k = loadKeys(); if (!k) return json(res, 400, { error: '请先配置 API Key' });
    const host = BIN_HOSTS[k.net] || BIN_HOSTS.test;
    const r = await binRequest(host, '/api/v3/account', 'GET', {}, k, false);
    if (r.code !== 200) return json(res, 400, { error: (r.data && r.data.msg) || '请求失败 ' + r.code, raw: r.raw });
    const balances = (r.data.balances || []).filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    return json(res, 200, { balances, net: k.net, canTrade: r.data.canTrade });
  }
  if (pathname === '/api/binance/order' && req.method === 'POST') {
    if (needLogin()) return;
    const k = loadKeys(); if (!k) return json(res, 400, { error: '请先配置 API Key' });
    const host = BIN_HOSTS[k.net] || BIN_HOSTS.test;
    const symbol = String(body.symbol || '').toUpperCase();
    const side = body.side === 'sell' ? 'SELL' : 'BUY';
    const type = body.type === 'market' ? 'MARKET' : 'LIMIT';
    const quantity = String(body.quantity || '');
    if (!symbol || symbol.length < 5) return json(res, 400, { error: '请输入正确的交易对，如 BTCUSDT' });
    if (!quantity || Number(quantity) <= 0) return json(res, 400, { error: '请输入交易数量' });
    const params = { symbol, side, type, quantity };
    if (type === 'LIMIT') {
      const price = String(body.price || '');
      if (!price || Number(price) <= 0) return json(res, 400, { error: '限价单请输入委托价格' });
      params.price = price; params.timeInForce = 'GTC';
    }
    const r = await binRequest(host, '/api/v3/order', 'POST', params, k, false);
    if (r.code !== 200) return json(res, 400, { error: (r.data && r.data.msg) || '下单失败 ' + r.code, raw: r.raw });
    return json(res, 200, { ok: true, order: { id: r.data.orderId, status: r.data.status, symbol: r.data.symbol, side: r.data.side, type: r.data.type, price: r.data.price, quantity: r.data.origQty, executed: r.data.executedQty } });
  }
  if (seg[1] === 'binance' && seg[2] === 'order' && seg[3] && seg[4] === 'cancel' && req.method === 'POST') {
    if (needLogin()) return;
    const k = loadKeys(); if (!k) return json(res, 400, { error: '请先配置 API Key' });
    const host = BIN_HOSTS[k.net] || BIN_HOSTS.test;
    const symbol = String(body.symbol || '').toUpperCase();
    const orderId = seg[3];
    const r = await binRequest(host, '/api/v3/order', 'DELETE', { symbol, orderId }, k, false);
    if (r.code !== 200) return json(res, 400, { error: (r.data && r.data.msg) || '撤单失败 ' + r.code });
    return json(res, 200, { ok: true, status: r.data.status });
  }
  if (pathname === '/api/binance/orders' && req.method === 'GET') {
    if (needLogin()) return;
    const k = loadKeys(); if (!k) return json(res, 400, { error: '请先配置 API Key' });
    const host = BIN_HOSTS[k.net] || BIN_HOSTS.test;
    const symbol = String(url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const [openR, hisR] = await Promise.all([
      binRequest(host, '/api/v3/openOrders', 'GET', { symbol }, k, false),
      binRequest(host, '/api/v3/myTrades', 'GET', { symbol, limit: 30 }, k, false)
    ]);
    const open = openR.code === 200 ? openR.data : [];
    const history = hisR.code === 200 ? hisR.data : [];
    return json(res, 200, { open, history, net: k.net });
  }
  if (seg[1] === 'binance' && seg[2] === 'ticker' && seg[3] && req.method === 'GET') {
    if (needLogin()) return;
    const k = loadKeys();
    const host = k ? (BIN_HOSTS[k.net] || BIN_HOSTS.test) : BIN_HOSTS.test;
    const symbol = String(seg[3]).toUpperCase();
    const r = await binRequest(host, '/api/v3/ticker/24hr', 'GET', { symbol }, null, true);
    if (r.code !== 200) return json(res, 400, { error: '行情获取失败 ' + r.code });
    const d = r.data;
    return json(res, 200, { symbol: d.symbol, price: parseFloat(d.lastPrice), change: parseFloat(d.priceChangePercent), high: parseFloat(d.highPrice), low: parseFloat(d.lowPrice), vol: parseFloat(d.quoteVolume) });
  }

  json(res, 404, { error: '接口不存在' });
}

/* ---------------- 静态资源 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
function serveFile(fp, res, fallback) {
  fs.readFile(fp, (err, data) => {
    if (err) {
      if (fallback) return serveFile(path.join(PUB_DIR, 'index.html'), res, false);
      res.writeHead(404); return res.end('Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache, must-revalidate'
    });
    res.end(data);
  });
}

async function handler(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    if (p.startsWith('/api/')) return await handleApi(req, res, p, u);
    if (p.startsWith('/uploads/')) {
      const fp = path.join(UP_DIR, path.basename(p));
      return serveFile(fp, res, false);
    }
    let fp = path.join(PUB_DIR, p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!fp.startsWith(PUB_DIR)) fp = path.join(PUB_DIR, 'index.html');
    serveFile(fp, res, p !== '/' && !path.extname(p));
  } catch (e) {
    console.error(e);
    json(res, 500, { error: '服务器错误: ' + e.message });
  }
}

loadDb();
module.exports = handler;
module.exports.handler = handler;

if (require.main === module) {
  const probe = http.request({ port: PORT, host: '127.0.0.1', method: 'GET', path: '/', timeout: 1000 }, () => {
    console.error('[启动中止] 端口 ' + PORT + ' 已有服务在运行，请先结束旧的 node 进程。');
    process.exit(1);
  });
  probe.on('error', () => {
    const server = http.createServer(handler);
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') { console.error('[启动中止] 端口 ' + PORT + ' 被占用。'); process.exit(1); }
      else throw e;
    });
    server.listen(PORT, () => {
      console.log('==============================================');
      console.log('  币易商城 · 自营商品交易平台已启动');
      console.log('  访问地址: http://localhost:' + PORT);
      console.log('  管理员: 13800000000 / admin123');
      console.log('  演示用户: 13900000002 / buyer123');
      console.log('==============================================');
    });
  });
  probe.end();
}
