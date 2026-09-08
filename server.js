/**
 * 游戏道具担保交易平台 - 后端服务
 * 零依赖：仅使用 Node.js 内置模块
 * 功能：实名注册 / 卖家入驻审核 / 商品发布 / 担保交易(资金托管) / 纠纷仲裁 / 钱包
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUB_DIR = path.join(ROOT, 'public');
// 支持环境变量配置（云上挂载持久化卷，本地默认 ROOT/uploads）
const UP_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DB_FILE = path.join(DATA_DIR, 'data.json');
const SECRET = process.env.SECRET || 'game-trade-escrow-platform-secret-2026';
const CAT_NAME = { account: '游戏账号', skin: '游戏皮肤', item: '游戏道具', coin: '游戏货币' };

/* ---------------- 真实支付 ---------------- */
// 配置优先级：环境变量 > pay.config.js 文件 > 演示模式
let payCfg = {};
try {
  payCfg = require('./pay.config.js');
} catch (e) {
  console.log('[支付] 未找到 pay.config.js，尝试使用环境变量注入');
  payCfg = {
    alipay: {
      appId: process.env.ALIPAY_APP_ID || '',
      privateKey: (process.env.ALIPAY_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || '',
      notifyUrl: process.env.PAY_NOTIFY_URL || '',
      returnUrl: process.env.PAY_RETURN_URL || '',
      signType: 'RSA2',
      charset: 'utf-8',
      gateway: 'https://openapi.alipay.com/gateway.do'
    },
    wechat: {}
  };
}
let alipay, wechatpay;
try {
  alipay = require('./lib/alipay.js');
  wechatpay = require('./lib/wechatpay.js');
} catch (e) { console.log('[支付] SDK加载失败，将使用演示模式:', e.message); }
// 判断是否已配置真实支付
const PAY_READY = {
  alipay: !!(payCfg.alipay && payCfg.alipay.appId && payCfg.alipay.privateKey && payCfg.alipay.alipayPublicKey && payCfg.alipay.notifyUrl),
  wechat: !!(payCfg.wechat && payCfg.wechat.appId && payCfg.wechat.mchId && payCfg.wechat.apiKey && payCfg.wechat.privateKey && payCfg.wechat.notifyUrl)
};
payCfg.demo = !PAY_READY.alipay && !PAY_READY.wechat;
console.log(`[支付] 支付宝:${PAY_READY.alipay ? '已接入' : '演示'}  微信:${PAY_READY.wechat ? '已接入' : '演示'}  演示模式:${payCfg.demo}`);

if (!fs.existsSync(UP_DIR)) fs.mkdirSync(UP_DIR, { recursive: true });

/* ---------------- 数据存储（JSON 文件库） ---------------- */
let db;
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = null; }
  }
  if (!db || !db.users) {
    db = { users: [], products: [], orders: [], txns: [], seq: { u: 1, p: 1, o: 1, t: 1 } };
    seed();
    saveDb();
  }
}
function saveDb() { fs.writeFileSync(DB_FILE, JSON.stringify(db)); }
function nextId(kind) { return kind + (db.seq[kind]++); }
function orderNo() { return 'T' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100); }

/* ---------------- 密码 / Token ---------------- */
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(8).toString('hex');
  const hash = crypto.pbkdf2Sync(pw, salt, 12000, 32, 'sha256').toString('hex');
  return salt + ':' + hash;
}
function verifyPw(pw, stored) {
  const [salt, hash] = String(stored).split(':');
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
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 60 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}
/* 读取原始请求体（用于微信回调，保持原文字符串用于验签） */
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
/* 读取表单数据（支付宝回调为 application/x-www-form-urlencoded） */
function readForm(req) {
  return new Promise((resolve, reject) => {
    readRaw(req).then(raw => {
      try { resolve(querystring.parse(raw)); } catch (e) { reject(e); }
    }).catch(reject);
  });
}

/* 标记订单已付款（资金进入平台托管） */
function markOrderPaid(o) {
  if (o.status !== 'pending_pay') return false;
  o.status = 'paid';
  o.paidAt = Date.now();
  o.timeline.push({ at: Date.now(), text: '买家付款成功，资金已由平台托管，等待卖家发货' });
  const p = db.products.find(x => x.id === o.productId);
  if (p) p.status = 'sold';
  return true;
}

/* 网关支付成功回调处理（支付宝/微信异步通知） */
function handleGatewayPaid(outTradeNo, channel, tradeNo) {
  // 充值订单：R 开头
  if (outTradeNo && outTradeNo.startsWith('R')) {
    const r = (db.recharges || []).find(x => x.no === outTradeNo);
    if (!r) { console.warn('[充值回调] 记录不存在:', outTradeNo); return false; }
    if (r.status !== 'pending') { console.log('[充值回调] 已处理，跳过:', outTradeNo); return true; }
    const u = db.users.find(x => x.id === r.userId);
    if (u) {
      u.balance = Number((u.balance + r.amount).toFixed(2));
      addTxn(u.id, 'recharge', r.amount, `账户充值(${channel})`, tradeNo);
    }
    r.status = 'paid';
    r.tradeNo = tradeNo;
    r.paidAt = Date.now();
    saveDb();
    console.log(`[充值回调] ${channel} 充值成功 ${outTradeNo} 金额:${r.amount} 流水:${tradeNo}`);
    return true;
  }

  // 交易订单：T 开头
  const o = db.orders.find(x => x.no === outTradeNo);
  if (!o) { console.warn('[支付回调] 订单不存在:', outTradeNo); return false; }
  if (o.status !== 'pending_pay') {
    console.log('[支付回调] 订单已处理，跳过:', outTradeNo, o.status);
    return true; // 幂等：已处理过则直接返回成功
  }
  // 在线支付不扣买家余额（钱从支付宝/微信直接到平台托管账户）
  addTxn(o.buyerId, 'gateway_pay', -o.price, `在线支付(${channel})-资金托管于平台`, tradeNo);
  o.gatewayTradeNo = tradeNo;
  o.payChannel = channel;
  markOrderPaid(o);
  saveDb();
  console.log(`[支付回调] ${channel} 支付成功 订单:${outTradeNo} 金额:${o.price} 流水:${tradeNo}`);
  return true;
}
function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}
function addTxn(userId, type, amount, note, ref) {
  const u = db.users.find(x => x.id === userId);
  const t = {
    id: nextId('t'), userId, type, amount: Number(amount.toFixed(2)),
    balance: u ? Number(u.balance.toFixed(2)) : 0,
    note: note || '', ref: ref || '', at: Date.now()
  };
  db.txns.push(t);
  return t;
}
function maskName(name) {
  if (!name) return '用户';
  if (name.length <= 1) return name + '**';
  return name[0] + '*'.repeat(Math.max(1, name.length - 1));
}
function sellerStats(sellerId) {
  const done = db.orders.filter(o => o.sellerId === sellerId && o.status === 'completed').length;
  const selling = db.products.filter(p => p.sellerId === sellerId && p.status === 'on').length;
  return { done, selling };
}
function productView(p) {
  const seller = db.users.find(u => u.id === p.sellerId);
  const st = sellerStats(p.sellerId);
  return {
    ...p,
    seller: seller ? { id: seller.id, name: maskName(seller.realName), verified: true, done: st.done, createdAt: seller.createdAt } : null
  };
}

/* ---------------- 种子数据 ---------------- */
function t2i(prompt, size) {
  return 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=' +
    encodeURIComponent(prompt) + '&image_size=' + (size || 'square');
}
function seed() {
  const admin = {
    id: nextId('u'), phone: '13800000000', password: hashPw('admin123'),
    realName: '平台管理员', idCard: '110101199001011234', role: 'admin',
    sellerStatus: 'none', balance: 0, createdAt: Date.now()
  };
  const seller = {
    id: nextId('u'), phone: '13900000001', password: hashPw('seller123'),
    realName: '张伟', idCard: '310104199203051234', role: 'user',
    sellerStatus: 'approved', balance: 0,
    sellerInfo: { contact: 'QQ:88888888', mainGames: '王者荣耀,原神,英雄联盟', experience: '5年游戏交易经验，累计成交3000+单，零纠纷。', appliedAt: Date.now() - 86400000 * 30, approvedAt: Date.now() - 86400000 * 29 },
    createdAt: Date.now() - 86400000 * 60
  };
  const buyer = {
    id: nextId('u'), phone: '13900000002', password: hashPw('buyer123'),
    realName: '李娜', idCard: '440106199507124567', role: 'user',
    sellerStatus: 'none', balance: 6000, createdAt: Date.now() - 86400000 * 20
  };
  addTxn(buyer.id, 'recharge', 6000, '演示账户初始充值', 'SEED');
  db.users.push(admin, seller, buyer);

  const demos = [
    { category: 'account', game: '王者荣耀', title: '【秒换绑】王者V10账号 3水晶 212皮肤 满铭文 国服印记', price: 2880,
      desc: '一手自玩号，贵族V10，3颗荣耀水晶（武则天/天鹅之梦/星空梦想），212款皮肤含多款限定传说，满铭文页。支持官方换绑，提供实名信息，包售后7天。',
      img: 'luxury mobile game account showcase, rare legendary skins collection, golden crown and crystal, vibrant fantasy splash art, premium UI banner' },
    { category: 'account', game: '原神', title: '原神 60级毕业号 满命胡桃+雷神+钟离 20黄 深渊满星', price: 1680,
      desc: '冒险等阶60，满命胡桃专武、二命雷神、钟离、万叶、神里绫华等20个五星，深境螺旋常驻满星。邮箱未实名可换绑，送邮箱。',
      img: 'anime open world adventure game characters collection, hero lineup of fantasy warriors, glowing elemental effects, beautiful key visual' },
    { category: 'skin', game: '英雄联盟', title: 'LOL 龙的传人/至臻皮肤账号 艾欧尼亚 全英雄 200+皮肤', price: 520,
      desc: '艾欧尼亚大区，含龙瞎龙的传人李青、多款至臻皮肤，全英雄，段位铂金。秒改手机/密保，支持验货后付款。',
      img: 'rare golden dragon skin weapon cosmetic, league fantasy game art, glowing melee blade, dark background splash art' },
    { category: 'item', game: 'CS2', title: 'CS2 饰品 蝴蝶刀 | 多普勒 (崭新出厂) 秒发', price: 2350,
      desc: '蝴蝶刀 多普勒 崭新出厂，磨损0.00x，蓝顶配色。Steam 报价直发，全程录屏，支持担保交易。',
      img: 'butterfly knife doppler sapphire blue gemstone, counter strike style weapon skin, glowing blue blade on dark stand, studio render' },
    { category: 'coin', game: '梦幻西游', title: '梦幻西游 游戏币 1000万金币 全服可发 量大优惠', price: 268,
      desc: '梦幻西游全服游戏币，1000万金币=268元，批量购买更优惠。游戏内当面交易/摊位交易，全程截图录屏。',
      img: 'pile of shiny gold coins and treasure, chinese fantasy mmo game currency, glowing golden ingots, rich treasure hoard' },
    { category: 'coin', game: '地下城与勇士', title: 'DNF 金币 1亿 跨六大区 当面交易 秒发货', price: 198,
      desc: '跨六大区1亿金币，拍卖行/当面交易均可，5分钟内发货。长期出金，信誉商家，欢迎工作室合作。',
      img: 'fantasy dungeon game gold coins stack, action rpg game currency, shiny golden coins with red gem, dark dungeon background' },
  ];
  demos.forEach((d, i) => {
    db.products.push({
      id: nextId('p'), sellerId: seller.id, category: d.category, game: d.game,
      title: d.title, desc: d.desc, price: d.price,
      images: [t2i(d.img, 'square'), t2i(d.img + ' wide banner', 'landscape_4_3')],
      status: 'on', views: 100 + i * 37, createdAt: Date.now() - 86400000 * (i + 1)
    });
  });
}

/* ---------------- 业务接口 ---------------- */
async function handleApi(req, res, pathname, url) {
  const me = authUser(req);
  // 支付回调是表单/原始格式，不走 JSON 解析
  const isNotify = pathname.startsWith('/api/pay/');
  const body = (!isNotify && ['POST', 'PUT'].includes(req.method)) ? await readBody(req) : {};
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]
  const needLogin = () => { if (!me) { json(res, 401, { error: '请先登录' }); return true; } return false; };
  const needAdmin = () => { if (!me || me.role !== 'admin') { json(res, 403, { error: '无管理员权限' }); return true; } return false; };

  // ---- 认证 ----
  if (pathname === '/api/register' && req.method === 'POST') {
    const { phone, password, realName, idCard } = body;
    if (!/^1\d{10}$/.test(phone || '')) return json(res, 400, { error: '手机号格式不正确' });
    if (!password || password.length < 6) return json(res, 400, { error: '密码至少6位' });
    if (!realName || !/^[\u4e00-\u9fa5·]{2,20}$/.test(realName)) return json(res, 400, { error: '请输入真实姓名（2-20位中文）' });
    if (!/^\d{17}[\dXx]$/.test(idCard || '')) return json(res, 400, { error: '身份证号格式不正确（18位）' });
    if (db.users.some(u => u.phone === phone)) return json(res, 400, { error: '该手机号已注册' });
    const u = {
      id: nextId('u'), phone, password: hashPw(password), realName, idCard,
      role: 'user', sellerStatus: 'none', balance: 0, createdAt: Date.now()
    };
    db.users.push(u); saveDb();
    return json(res, 200, { token: sign(u), user: publicUser(u) });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    const { phone, password } = body;
    const u = db.users.find(x => x.phone === phone);
    if (!u || !verifyPw(password || '', u.password)) return json(res, 400, { error: '手机号或密码错误' });
    return json(res, 200, { token: sign(u), user: publicUser(u) });
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    if (needLogin()) return;
    return json(res, 200, { user: publicUser(me) });
  }

  // ---- 文件/图片/视频上传 ----
  if (pathname === '/api/upload' && req.method === 'POST') {
    if (needLogin()) return;
    const { dataUrl, kind } = body;
    const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return json(res, 400, { error: '文件格式错误' });
    const mime = m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 30 * 1024 * 1024) return json(res, 400, { error: '文件不能超过30MB' });
    const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
    const ext = extMap[mime] || (kind === 'video' ? 'mp4' : 'jpg');
    if (kind === 'video' && !mime.startsWith('video/')) return json(res, 400, { error: '请上传视频文件' });
    if (kind === 'image' && !mime.startsWith('image/')) return json(res, 400, { error: '请上传图片文件' });
    const fname = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UP_DIR, fname), buf);
    return json(res, 200, { url: '/uploads/' + fname });
  }

  // ---- 卖家入驻 ----
  if (pathname === '/api/seller/apply' && req.method === 'POST') {
    if (needLogin()) return;
    if (me.sellerStatus === 'pending') return json(res, 400, { error: '入驻申请审核中，请耐心等待' });
    if (me.sellerStatus === 'approved') return json(res, 400, { error: '您已是认证卖家' });
    const { contact, mainGames, experience } = body;
    if (!contact || contact.length < 3) return json(res, 400, { error: '请填写联系方式（QQ/微信）' });
    if (!mainGames) return json(res, 400, { error: '请填写主营游戏' });
    me.sellerStatus = 'pending';
    me.sellerInfo = { contact, mainGames, experience: experience || '', appliedAt: Date.now() };
    saveDb();
    return json(res, 200, { ok: true, user: publicUser(me) });
  }

  // ---- 商品 ----
  if (pathname === '/api/products' && req.method === 'GET') {
    const category = url.searchParams.get('category');
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    let list = db.products.filter(p => p.status === 'on');
    if (category && category !== 'all') list = list.filter(p => p.category === category);
    if (q) list = list.filter(p => (p.title + p.game + p.desc).toLowerCase().includes(q));
    list.sort((a, b) => b.createdAt - a.createdAt);
    return json(res, 200, { list: list.map(productView) });
  }

  if (pathname === '/api/products' && req.method === 'POST') {
    if (needLogin()) return;
    if (me.sellerStatus !== 'approved') return json(res, 403, { error: '请先完成卖家入驻并通过审核' });
    const { category, game, title, desc, price, images } = body;
    if (!['account', 'skin', 'item', 'coin'].includes(category)) return json(res, 400, { error: '请选择商品分类' });
    if (!game || !title) return json(res, 400, { error: '请填写游戏名称和商品标题' });
    if (!(price > 0) || price > 999999) return json(res, 400, { error: '请输入正确的价格' });
    if (!Array.isArray(images) || images.length === 0) return json(res, 400, { error: '请至少上传一张商品图片' });
    const p = {
      id: nextId('p'), sellerId: me.id, category, game: String(game).slice(0, 30),
      title: String(title).slice(0, 60), desc: String(desc || '').slice(0, 2000),
      price: Number(Number(price).toFixed(2)), images: images.slice(0, 9),
      status: 'on', views: 0, createdAt: Date.now()
    };
    db.products.push(p); saveDb();
    return json(res, 200, { ok: true, product: productView(p) });
  }

  if (seg[1] === 'products' && seg[2] && seg[2] !== 'my' && req.method === 'GET' && !seg[3]) {
    const p = db.products.find(x => x.id === seg[2]);
    if (!p) return json(res, 404, { error: '商品不存在' });
    p.views++; saveDb();
    return json(res, 200, { product: productView(p) });
  }

  if (pathname === '/api/my/products' && req.method === 'GET') {
    if (needLogin()) return;
    const list = db.products.filter(p => p.sellerId === me.id).sort((a, b) => b.createdAt - a.createdAt);
    return json(res, 200, { list: list.map(p => ({ ...p, orderCount: db.orders.filter(o => o.productId === p.id).length })) });
  }

  if (seg[1] === 'products' && seg[3] === 'off' && req.method === 'POST') {
    if (needLogin()) return;
    const p = db.products.find(x => x.id === seg[2]);
    if (!p) return json(res, 404, { error: '商品不存在' });
    if (p.sellerId !== me.id && me.role !== 'admin') return json(res, 403, { error: '无权操作' });
    p.status = p.status === 'on' ? 'off' : 'on';
    saveDb();
    return json(res, 200, { ok: true, status: p.status });
  }

  // ---- 订单：创建 / 支付（资金托管） / 发货 / 确认收货 ----
  if (pathname === '/api/orders' && req.method === 'POST') {
    if (needLogin()) return;
    const p = db.products.find(x => x.id === body.productId);
    if (!p || p.status !== 'on') return json(res, 400, { error: '商品不存在或已下架' });
    if (p.sellerId === me.id) return json(res, 400, { error: '不能购买自己的商品' });
    if (db.orders.some(o => o.productId === p.id && o.buyerId === me.id && ['pending_pay', 'paid', 'delivered', 'disputed'].includes(o.status)))
      return json(res, 400, { error: '您已有该商品的进行中订单' });
    const o = {
      id: nextId('o'), no: orderNo(), productId: p.id, buyerId: me.id, sellerId: p.sellerId,
      price: p.price, status: 'pending_pay', method: null,
      item: { title: p.title, image: p.images[0], game: p.game, category: p.category },
      delivery: null, dispute: null, timeline: [{ at: Date.now(), text: '买家下单，等待付款' }],
      createdAt: Date.now()
    };
    db.orders.push(o); saveDb();
    return json(res, 200, { ok: true, order: o });
  }

  if (pathname === '/api/my/orders' && req.method === 'GET') {
    if (needLogin()) return;
    const role = url.searchParams.get('role') || 'buyer';
    const field = role === 'seller' ? 'sellerId' : 'buyerId';
    const list = db.orders.filter(o => o[field] === me.id).sort((a, b) => b.createdAt - a.createdAt);
    return json(res, 200, { list, counterparty: role === 'seller' ? '买家' : '卖家' });
  }

  if (seg[1] === 'orders' && seg[2] && req.method === 'GET') {
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (!me || (me.role !== 'admin' && me.id !== o.buyerId && me.id !== o.sellerId)) return json(res, 403, { error: '无权查看' });
    const buyer = db.users.find(u => u.id === o.buyerId);
    const seller = db.users.find(u => u.id === o.sellerId);
    return json(res, 200, {
      order: o,
      buyer: buyer ? { id: buyer.id, name: maskName(buyer.realName), phone: me.id === o.sellerId || me.role === 'admin' ? buyer.phone : '' } : null,
      seller: seller ? { id: seller.id, name: maskName(seller.realName), contact: (me.id === o.buyerId || me.role === 'admin') && o.status !== 'pending_pay' ? (seller.sellerInfo && seller.sellerInfo.contact) || '' : '' } : null
    });
  }

  if (seg[1] === 'orders' && seg[3] === 'pay' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (o.buyerId !== me.id) return json(res, 403, { error: '无权操作' });
    if (o.status !== 'pending_pay') return json(res, 400, { error: '订单状态不允许付款' });
    const method = ['balance', 'alipay', 'wechat'].includes(body.method) ? body.method : 'balance';
    o.method = method;

    // ① 余额支付：直接扣余额并完成托管
    if (method === 'balance') {
      if (me.balance < o.price) return json(res, 400, { error: '余额不足，请先充值或选择在线支付' });
      me.balance = Number((me.balance - o.price).toFixed(2));
      addTxn(me.id, 'pay_escrow', -o.price, '担保交易付款-资金托管于平台', o.no);
      markOrderPaid(o);
      saveDb();
      return json(res, 200, { ok: true, paid: true, order: o });
    }

    // ② 支付宝手机网站支付
    if (method === 'alipay') {
      if (!PAY_READY.alipay) return json(res, 400, { error: '支付宝未配置，请使用余额支付或联系管理员' });
      const payUrl = alipay.wapPayUrl(payCfg.alipay, {
        outTradeNo: o.no, subject: '游戏商品担保交易-' + o.item.title.slice(0, 40),
        totalAmount: o.price, body: o.item.game + '/' + CAT_NAME[o.item.category]
      });
      o.payChannel = 'alipay';
      saveDb();
      return json(res, 200, { ok: true, paid: false, channel: 'alipay', payUrl });
    }

    // ③ 微信支付（JSAPI 或 H5）
    if (method === 'wechat') {
      if (!PAY_READY.wechat) return json(res, 400, { error: '微信支付未配置，请使用余额支付或联系管理员' });
      const inWechat = /MicroMessenger/i.test(req.headers['user-agent'] || '');
      o.payChannel = 'wechat';
      try {
        if (inWechat) {
          // 微信内：JSAPI 支付（需 openid，演示环境用商户号占位）
          const prepay = await wechatpay.jsapiOrder(payCfg.wechat, {
            outTradeNo: o.no, subject: '游戏商品担保交易', totalAmount: o.price,
            openid: body.openid || me.wechatOpenid || ''
          });
          const payParams = wechatpay.buildJsapiPayParams(payCfg.wechat, prepay.prepay_id);
          saveDb();
          return json(res, 200, { ok: true, paid: false, channel: 'wechat', type: 'jsapi', payParams });
        } else {
          // 微信外：H5 支付，返回 mweb_url
          const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || '127.0.0.1';
          const r = await wechatpay.h5Order(payCfg.wechat, {
            outTradeNo: o.no, subject: '游戏商品担保交易', totalAmount: o.price, clientIp
          });
          saveDb();
          return json(res, 200, { ok: true, paid: false, channel: 'wechat', type: 'h5', mwebUrl: r.h5_url });
        }
      } catch (e) {
        return json(res, 500, { error: '微信支付下单失败：' + e.message });
      }
    }
  }

  /* ---------- 支付回调（支付宝） ---------- */
  if (pathname === '/api/pay/alipay/notify' && req.method === 'POST') {
    const params = await readForm(req);
    // 演示模式（未配置支付宝）跳过验签；生产环境必须配置公钥严格验签
    if (PAY_READY.alipay && !alipay.verifyNotify(params, payCfg.alipay.alipayPublicKey)) {
      console.warn('[支付宝回调] 验签失败:', JSON.stringify(params).slice(0, 200));
      res.writeHead(400); return res.end('fail');
    }
    const outTradeNo = params.out_trade_no;
    const tradeStatus = params.trade_status;
    if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
      handleGatewayPaid(outTradeNo, 'alipay', params.trade_no);
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('success');
  }

  /* ---------- 支付回调（微信） ---------- */
  if (pathname === '/api/pay/wechat/notify' && req.method === 'POST') {
    const raw = await readRaw(req);
    const headers = req.headers;
    // 验签：需要微信平台证书公钥，未配置时跳过验签（生产环境必须配置）
    const platformCert = payCfg.wechat.platformPublicKey;
    if (platformCert && !wechatpay.verifyNotify(headers, raw, platformCert)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ code: 'FAIL', message: '签名验证失败' }));
    }
    let body;
    try { body = JSON.parse(raw); } catch (e) { res.writeHead(400); return res.end('bad json'); }
    try {
      const resource = wechatpay.decryptResource(payCfg.wechat.apiKey, body.resource);
      if (resource.trade_state === 'SUCCESS') {
        handleGatewayPaid(resource.out_trade_no, 'wechat', resource.transaction_id);
      }
    } catch (e) { console.error('[微信回调解密失败]', e.message); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ code: 'SUCCESS', message: '成功' }));
  }

  /* ---------- 前端主动查询支付结果（轮询） ---------- */
  if (seg[1] === 'orders' && seg[3] === 'pay-status' && req.method === 'GET') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (o.buyerId !== me.id) return json(res, 403, { error: '无权操作' });
    return json(res, 200, { status: o.status, order: o });
  }

  if (seg[1] === 'orders' && seg[3] === 'cancel' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (o.buyerId !== me.id) return json(res, 403, { error: '无权操作' });
    if (o.status !== 'pending_pay') return json(res, 400, { error: '订单已付款，无法取消' });
    o.status = 'closed';
    o.timeline.push({ at: Date.now(), text: '买家取消订单' });
    const p = db.products.find(x => x.id === o.productId);
    if (p && p.status === 'sold') p.status = 'on';
    saveDb();
    return json(res, 200, { ok: true });
  }

  if (seg[1] === 'orders' && seg[3] === 'deliver' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (o.sellerId !== me.id) return json(res, 403, { error: '只有卖家可以发货' });
    if (o.status !== 'paid') return json(res, 400, { error: '当前状态不能发货' });
    const { desc, images } = body;
    if (!desc || desc.length < 2) return json(res, 400, { error: '请填写发货说明（账号交接方式/道具发放记录）' });
    o.delivery = { desc, images: Array.isArray(images) ? images : [], at: Date.now() };
    o.status = 'delivered';
    o.timeline.push({ at: Date.now(), text: '卖家已移交商品/账号并提交发货凭证，等待买家确认收货' });
    saveDb();
    return json(res, 200, { ok: true, order: o });
  }

  if (seg[1] === 'orders' && seg[3] === 'confirm' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (o.buyerId !== me.id) return json(res, 403, { error: '只有买家可以确认收货' });
    if (o.status !== 'delivered') return json(res, 400, { error: '当前状态不能确认收货' });
    // 平台打款给卖家（托管资金解冻）
    const seller = db.users.find(u => u.id === o.sellerId);
    seller.balance = Number((seller.balance + o.price).toFixed(2));
    addTxn(seller.id, 'sale', o.price, '担保交易-买家确认收货，平台打款', o.no);
    o.status = 'completed';
    o.completedAt = Date.now();
    o.timeline.push({ at: Date.now(), text: '买家确认收货，平台已将托管款项打给卖家，交易完成' });
    saveDb();
    return json(res, 200, { ok: true, order: o });
  }

  // ---- 纠纷仲裁 ----
  if (seg[1] === 'orders' && seg[3] === 'dispute' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[2]);
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (me.id !== o.buyerId && me.id !== o.sellerId) return json(res, 403, { error: '无权操作' });
    if (!['paid', 'delivered'].includes(o.status)) return json(res, 400, { error: '当前状态不能申请仲裁' });
    const { reason, images, video } = body;
    if (!reason || reason.length < 5) return json(res, 400, { error: '请详细描述纠纷原因（至少5个字）' });
    o.dispute = {
      by: me.id, byRole: me.id === o.buyerId ? 'buyer' : 'seller',
      reason, images: Array.isArray(images) ? images : [], video: video || null,
      status: 'open', result: null, note: '', at: Date.now()
    };
    o.status = 'disputed';
    o.timeline.push({ at: Date.now(), text: (me.id === o.buyerId ? '买家' : '卖家') + '发起纠纷仲裁申请，平台客服将人工审核凭证' });
    saveDb();
    return json(res, 200, { ok: true, order: o });
  }

  // ---- 钱包 ----
  if (pathname === '/api/wallet' && req.method === 'GET') {
    if (needLogin()) return;
    const txns = db.txns.filter(t => t.userId === me.id).sort((a, b) => b.at - a.at).slice(0, 100);
    return json(res, 200, { balance: me.balance, txns });
  }
  if (pathname === '/api/wallet/recharge' && req.method === 'POST') {
    if (needLogin()) return;
    const amount = Number(body.amount);
    if (!(amount > 0) || amount > 50000) return json(res, 400, { error: '充值金额不正确' });
    const method = ['balance', 'alipay', 'wechat'].includes(body.method) ? body.method : 'alipay';

    // 余额支付（其实没必要，但保留兼容）
    if (method === 'balance') {
      return json(res, 400, { error: '不能用余额充值余额' });
    }

    // 生成充值订单号 R 开头，与订单 T 开头区分
    const rechargeNo = 'R' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100);
    const recharge = {
      no: rechargeNo, userId: me.id, amount: Number(amount.toFixed(2)),
      status: 'pending', channel: method, createdAt: Date.now()
    };
    if (!db.recharges) db.recharges = [];
    db.recharges.push(recharge);

    if (method === 'alipay') {
      if (!PAY_READY.alipay) return json(res, 400, { error: '支付宝未配置' });
      const payUrl = alipay.wapPayUrl(payCfg.alipay, {
        outTradeNo: rechargeNo, subject: '游易达账户充值', totalAmount: amount, body: '钱包余额充值'
      });
      saveDb();
      return json(res, 200, { ok: true, paid: false, channel: 'alipay', payUrl, rechargeNo });
    }
    if (method === 'wechat') {
      if (!PAY_READY.wechat) return json(res, 400, { error: '微信支付未配置' });
      const inWechat = /MicroMessenger/i.test(req.headers['user-agent'] || '');
      try {
        if (inWechat) {
          const prepay = await wechatpay.jsapiOrder(payCfg.wechat, {
            outTradeNo: rechargeNo, subject: '游易达账户充值', totalAmount: amount,
            openid: body.openid || me.wechatOpenid || ''
          });
          const payParams = wechatpay.buildJsapiPayParams(payCfg.wechat, prepay.prepay_id);
          saveDb();
          return json(res, 200, { ok: true, paid: false, channel: 'wechat', type: 'jsapi', payParams, rechargeNo });
        } else {
          const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || '127.0.0.1';
          const r = await wechatpay.h5Order(payCfg.wechat, {
            outTradeNo: rechargeNo, subject: '游易达账户充值', totalAmount: amount, clientIp
          });
          saveDb();
          return json(res, 200, { ok: true, paid: false, channel: 'wechat', type: 'h5', mwebUrl: r.h5_url, rechargeNo });
        }
      } catch (e) { return json(res, 500, { error: '微信支付下单失败：' + e.message }); }
    }
  }

  /* 充值状态查询（前端轮询） */
  if (pathname === '/api/wallet/recharge/status' && req.method === 'GET') {
    if (needLogin()) return;
    const no = url.searchParams.get('no');
    const r = (db.recharges || []).find(x => x.no === no && x.userId === me.id);
    if (!r) return json(res, 404, { error: '充值记录不存在' });
    return json(res, 200, { status: r.status, balance: me.balance });
  }
  if (pathname === '/api/wallet/withdraw' && req.method === 'POST') {
    if (needLogin()) return;
    const amount = Number(body.amount);
    if (!(amount > 0)) return json(res, 400, { error: '提现金额不正确' });
    if (amount > me.balance) return json(res, 400, { error: '余额不足' });
    me.balance = Number((me.balance - amount).toFixed(2));
    addTxn(me.id, 'withdraw', -amount, '提现申请（1-3个工作日到账）', '');
    saveDb();
    return json(res, 200, { ok: true, balance: me.balance });
  }

  /* ============ 管理员后台 ============ */
  if (seg[1] === 'admin') {
    if (needAdmin()) return;

    if (pathname === '/api/admin/overview' && req.method === 'GET') {
      return json(res, 200, {
        users: db.users.filter(u => u.role !== 'admin').length,
        products: db.products.length,
        onSale: db.products.filter(p => p.status === 'on').length,
        orders: db.orders.length,
        escrow: db.orders.filter(o => ['paid', 'delivered', 'disputed'].includes(o.status)).reduce((s, o) => s + o.price, 0),
        pendingSellers: db.users.filter(u => u.sellerStatus === 'pending').length,
        openDisputes: db.orders.filter(o => o.status === 'disputed').length
      });
    }

    if (pathname === '/api/admin/sellers' && req.method === 'GET') {
      const list = db.users.filter(u => u.sellerStatus && u.sellerStatus !== 'none')
        .map(u => ({ id: u.id, name: maskName(u.realName), realName: u.realName, phone: u.phone, idCard: u.idCard,
          status: u.sellerStatus, sellerInfo: u.sellerInfo, balance: u.balance, createdAt: u.createdAt }))
        .sort((a, b) => (b.sellerInfo && b.sellerInfo.appliedAt || b.createdAt) - (a.sellerInfo && a.sellerInfo.appliedAt || a.createdAt));
      return json(res, 200, { list });
    }

    if (seg[2] === 'sellers' && seg[4] === 'audit' && req.method === 'POST') {
      const u = db.users.find(x => x.id === seg[3]);
      if (!u) return json(res, 404, { error: '用户不存在' });
      if (u.sellerStatus !== 'pending') return json(res, 400, { error: '该申请已处理' });
      if (body.approve) {
        u.sellerStatus = 'approved';
        u.sellerInfo = u.sellerInfo || {};
        u.sellerInfo.approvedAt = Date.now();
        u.sellerInfo.auditNote = body.note || '';
      } else {
        u.sellerStatus = 'rejected';
        u.sellerInfo = u.sellerInfo || {};
        u.sellerInfo.rejectReason = body.reason || '资料不完整';
      }
      saveDb();
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/disputes' && req.method === 'GET') {
      const list = db.orders.filter(o => o.dispute).sort((a, b) => b.dispute.at - a.dispute.at);
      return json(res, 200, { list });
    }

    if (seg[2] === 'disputes' && seg[4] === 'arbitrate' && req.method === 'POST') {
      const o = db.orders.find(x => x.id === seg[3]);
      if (!o || !o.dispute) return json(res, 404, { error: '纠纷不存在' });
      if (o.status !== 'disputed') return json(res, 400, { error: '该纠纷已处理' });
      const ruling = body.ruling === 'seller' ? 'seller' : 'buyer';
      const buyer = db.users.find(u => u.id === o.buyerId);
      const seller = db.users.find(u => u.id === o.sellerId);
      if (ruling === 'seller') {
        // 卖家胜诉：平台打款给卖家
        seller.balance = Number((seller.balance + o.price).toFixed(2));
        addTxn(seller.id, 'sale', o.price, '仲裁判定卖家胜诉，平台打款', o.no);
        o.status = 'completed';
        o.completedAt = Date.now();
        o.timeline.push({ at: Date.now(), text: '平台仲裁完成：判定卖家胜诉，托管款项已打给卖家' });
      } else {
        // 买家胜诉（骗号/虚假发货）：全额退款
        buyer.balance = Number((buyer.balance + o.price).toFixed(2));
        addTxn(buyer.id, 'refund', o.price, '仲裁判定买家胜诉（' + (body.note || '卖家违规') + '），全额退款', o.no);
        o.status = 'refunded';
        o.refundedAt = Date.now();
        const p = db.products.find(x => x.id === o.productId);
        if (p) p.status = 'off';
        o.timeline.push({ at: Date.now(), text: '平台仲裁完成：判定买家胜诉，托管款项已全额退回买家，商品下架' });
        if (body.banSeller) {
          seller.sellerStatus = 'banned';
          o.timeline.push({ at: Date.now(), text: '卖家因违规被封禁卖家资格' });
        }
      }
      o.dispute.status = 'closed';
      o.dispute.result = ruling;
      o.dispute.note = body.note || '';
      o.dispute.handledAt = Date.now();
      saveDb();
      return json(res, 200, { ok: true, order: o });
    }

    if (pathname === '/api/admin/products' && req.method === 'GET') {
      const list = db.products.sort((a, b) => b.createdAt - a.createdAt).map(p => {
        const s = db.users.find(u => u.id === p.sellerId);
        return { ...p, sellerName: s ? maskName(s.realName) : '' };
      });
      return json(res, 200, { list });
    }
  }

  json(res, 404, { error: '接口不存在' });
}

/* ---------------- 静态资源 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.ico': 'image/x-icon'
};
function serveFile(fp, res, fallback) {
  fs.readFile(fp, (err, data) => {
    if (err) {
      if (fallback) return serveFile(path.join(PUB_DIR, 'index.html'), res, false);
      res.writeHead(404); return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    if (p.startsWith('/api/')) return await handleApi(req, res, p, u);
    if (p.startsWith('/uploads/')) {
      const fp = path.join(UP_DIR, path.basename(p));
      return serveFile(fp, res, false);
    }
    // 前端静态资源 + SPA 回退
    let fp = path.join(PUB_DIR, p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!fp.startsWith(PUB_DIR)) fp = path.join(PUB_DIR, 'index.html');
    serveFile(fp, res, p !== '/' && !path.extname(p));
  } catch (e) {
    console.error(e);
    json(res, 500, { error: '服务器错误: ' + e.message });
  }
});

loadDb();
server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  游戏担保交易平台已启动');
  console.log('  访问地址: http://localhost:' + PORT);
  console.log('  管理员: 13800000000 / admin123');
  console.log('  演示卖家: 13900000001 / seller123');
  console.log('  演示买家: 13900000002 / buyer123');
  console.log('==============================================');
});
