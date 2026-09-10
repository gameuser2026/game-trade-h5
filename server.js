/**
 * 币易 BiYiEx - 数字资产交易平台（模拟盘 / 演示版）
 * 零依赖：仅使用 Node.js 内置模块
 * 功能：行情模拟 / 现货交易(模拟撮合) / 法币C2C担保交易 / 商家入驻审核 / 多币种钱包 / 纠纷仲裁 / 在线客服
 * 说明：全部行情与资产均为模拟数据，不接入真实区块链与支付通道
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
const SECRET = process.env.SECRET || 'biyiex-demo-exchange-secret-2026';

if (!fs.existsSync(UP_DIR)) fs.mkdirSync(UP_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- 币种配置 ---------------- */
const COIN_CONF = {
  BTC:  { name: '比特币',   icon: '₿', color: '#f7931a', prec: 6,  base: 68920,  c2c: true  },
  ETH:  { name: '以太坊',   icon: 'Ξ', color: '#627eea', prec: 4,  base: 3562.4, c2c: true  },
  SOL:  { name: 'Solana',  icon: '◎', color: '#9945ff', prec: 3,  base: 158.62, c2c: false },
  BNB:  { name: 'BNB',     icon: '◆', color: '#f0b90b', prec: 4,  base: 612.8,  c2c: false },
  XRP:  { name: '瑞波币',   icon: '✕', color: '#25a0e8', prec: 4,  base: 0.6234, c2c: false },
  DOGE: { name: '狗狗币',   icon: 'Ð', color: '#c2a633', prec: 0,  base: 0.1582, c2c: false },
  ADA:  { name: '艾达币',   icon: '₳', color: '#3468d1', prec: 2,  base: 0.4521, c2c: false },
  TRX:  { name: '波场币',   icon: 'T', color: '#ef0027', prec: 4,  base: 0.1286, c2c: false },
  USDT: { name: '泰达币',   icon: '₮', color: '#26a17b', prec: 2,  base: 1,     c2c: true, quote: true }
};
const ALL_COINS = Object.keys(COIN_CONF);
const SPOT_COINS = ALL_COINS.filter(c => !COIN_CONF[c].quote);
const PAY_METHODS = {
  alipay: { name: '支付宝', icon: '🅰️', color: '#1677ff' },
  wechat: { name: '微信',   icon: '💚', color: '#16b364' },
  bank:   { name: '银行卡', icon: '🏦', color: '#f5a623' }
};
const SPOT_FEE = 0.001; // 现货手续费 0.1%

/* ---------------- 数据存储 ---------------- */
let db;
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = null; }
  }
  if (!db || !db.users) {
    db = {
      users: [], ads: [], orders: [], txns: [],
      spotOrders: [], spotFills: [],
      supportConvs: [], supportMsgs: [],
      markets: {}, trades: {},
      seq: { u: 1, a: 1, o: 1, t: 1, s: 1, f: 1, c: 1, m: 1 },
      rate: 7.21
    };
    seed();
    saveDb();
  }
  ['ads', 'orders', 'txns', 'spotOrders', 'spotFills', 'supportConvs', 'supportMsgs'].forEach(k => { if (!db[k]) db[k] = []; });
  ['markets', 'trades'].forEach(k => { if (!db[k]) db[k] = {}; });
  if (!db.seq) db.seq = {};
  ['u', 'a', 'o', 't', 's', 'f', 'c', 'm'].forEach(k => { if (!db.seq[k]) db.seq[k] = 1; });
  if (!db.rate) db.rate = 7.21;
  initMarkets();
}
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function nextId(k) { return k + (db.seq[k]++); }
function orderNo(prefix) { return prefix + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100); }

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
    req.on('data', c => { size += c.length; if (size > 5 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; } chunks.push(c); });
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
function round(n, prec) { const f = Math.pow(10, prec == null ? 8 : prec); return Math.round(n * f) / f; }
function coinBal(u, c) { return (u.coins && u.coins[c]) || 0; }
function addCoin(u, c, amount) {
  if (!u.coins) u.coins = {};
  const prec = COIN_CONF[c] ? COIN_CONF[c].prec : 8;
  u.coins[c] = round(coinBal(u, c) + amount, prec);
  return u.coins[c];
}
function addTxn(userId, type, coin, amount, note, ref) {
  const u = db.users.find(x => x.id === userId);
  const t = {
    id: nextId('t'), userId, type, coin: coin || 'USDT', amount: round(amount, 8),
    bal: u ? coinBal(u, coin) : 0, note: note || '', ref: ref || '', at: Date.now()
  };
  db.txns.push(t);
  return t;
}
function cnyRate() { return db.rate || 7.21; }

/* ---------------- 行情引擎（模拟） ---------------- */
function initMarkets() {
  SPOT_COINS.forEach(c => {
    if (db.markets[c]) return;
    const conf = COIN_CONF[c];
    const hist = [];
    let p = conf.base * (1 - 0.012);
    for (let i = 0; i < 60; i++) {
      p = p * (1 + (Math.random() - 0.48) * 0.004);
      hist.push(round(p, pricePrec(p)));
    }
    const now = round(p, pricePrec(p));
    db.markets[c] = {
      price: now, open: hist[0] || now, high: Math.max(...hist, now), low: Math.min(...hist, now),
      vol: round(500 + Math.random() * 9000, 2), history: hist
    };
    db.trades[c] = seedTrades(c, now);
  });
}
function pricePrec(p) { return p >= 1000 ? 1 : (p >= 10 ? 2 : (p >= 1 ? 3 : 5)); }
function seedTrades(c, price) {
  const arr = [];
  for (let i = 0; i < 18; i++) {
    arr.push({
      price: round(price * (1 + (Math.random() - 0.5) * 0.002), pricePrec(price)),
      amount: round((0.01 + Math.random() * 2) * (price > 5000 ? 0.05 : 1), 4),
      side: Math.random() > 0.5 ? 'buy' : 'sell', at: Date.now() - i * 9000
    });
  }
  return arr;
}
function marketTick() {
  try {
    if (!liveFresh()) {
      // 真实行情不可用：随机游走模拟兜底
      SPOT_COINS.forEach(c => {
        const m = db.markets[c];
        if (!m) return;
        const drift = (Math.random() - 0.5) * 0.0035;
        m.price = round(m.price * (1 + drift), pricePrec(m.price));
        m.high = Math.max(m.high, m.price);
        m.low = Math.min(m.low, m.price);
        m.vol = round(m.vol + Math.random() * 12, 2);
        m.history.push(m.price);
        if (m.history.length > 90) m.history.shift();
        if (Math.random() > 0.35) {
          db.trades[c].unshift({
            price: round(m.price * (1 + (Math.random() - 0.5) * 0.0008), pricePrec(m.price)),
            amount: round(0.005 + Math.random() * 1.5, 4),
            side: drift >= 0 ? 'buy' : 'sell', at: Date.now()
          });
          db.trades[c] = db.trades[c].slice(0, 30);
        }
      });
      if (!live.rate) db.rate = round(db.rate * (1 + (Math.random() - 0.5) * 0.0006), 4);
    }
    matchSpotEngine();
    saveDb();
  } catch (e) { console.error('[行情引擎]', e.message); }
}
function ticker(c) {
  const m = db.markets[c];
  const conf = COIN_CONF[c];
  const change = m ? round((m.price - m.open) / m.open * 100, 2) : 0;
  return {
    symbol: c, name: conf.name, icon: conf.icon, color: conf.color, prec: conf.prec,
    price: m ? m.price : conf.base, open: m ? m.open : conf.base,
    high: m ? m.high : conf.base, low: m ? m.low : conf.base,
    change, vol: m ? m.vol : 0,
    cny: m ? round(m.price * cnyRate(), pricePrec(m.price * cnyRate())) : 0,
    spark: m ? m.history.slice(-30) : []
  };
}
function allTickers() {
  return SPOT_COINS.map(c => ticker(c))
    .concat([{ symbol: 'USDT', name: '泰达币', icon: '₮', color: '#26a17b', prec: 2, price: 1, open: 1, high: 1, low: 1, change: 0, vol: 0, cny: round(cnyRate(), 4), spark: [] }]);
}
function orderBook(symbol) {
  const m = db.markets[symbol];
  const price = m ? m.price : COIN_CONF[symbol].base;
  const prec = pricePrec(price);
  const asks = [], bids = [];
  let baseAmt = price > 5000 ? 0.3 : price > 100 ? 3 : 800;
  for (let i = 1; i <= 9; i++) {
    asks.push({ price: round(price * (1 + i * 0.0004 + Math.random() * 0.0002), prec), amount: round(baseAmt * (0.2 + Math.random()) / i * 2, 4) });
    bids.push({ price: round(price * (1 - i * 0.0004 - Math.random() * 0.0002), prec), amount: round(baseAmt * (0.2 + Math.random()) / i * 2, 4) });
  }
  return { asks: asks.sort((a, b) => a.price - b.price), bids, price };
}

/* ---------------- 真实行情引擎（OKX 公开接口，失败自动回退模拟） ----------------
   仅拉取公开行情数据（价格/盘口/成交流），不接入任何交易与资金通道；
   账户余额与下单成交仍为模拟盘。网络不通时自动退回随机游走模拟行情。 */
const https = require('https');
function httpGetJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (BiYiEx Demo)', 'Accept': 'application/json' },
      timeout: timeoutMs
    }, r => {
      let d = '';
      r.on('data', c => { d += c; if (d.length > 16 * 1024 * 1024) req.destroy(); });
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const live = { source: 'sim', tickerAt: 0, rate: null, rateAt: 0, books: {}, inflight: {} };
const OKX_PAIR = { BTC: 'BTC-USDT', ETH: 'ETH-USDT', SOL: 'SOL-USDT', BNB: 'BNB-USDT', XRP: 'XRP-USDT', DOGE: 'DOGE-USDT', ADA: 'ADA-USDT', TRX: 'TRX-USDT' };
const BIN_PAIR = c => c + 'USDT';
function liveFresh() { return live.source !== 'sim' && Date.now() - live.tickerAt < 20000; }

async function fetchOkxTickers() {
  const j = await httpGetJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
  if (!j || j.code !== '0' || !Array.isArray(j.data)) throw new Error('okx tickers bad');
  const map = {}; j.data.forEach(t => { map[t.instId] = t; });
  const out = {};
  for (const c of SPOT_COINS) {
    const t = map[OKX_PAIR[c]];
    if (!t) continue;
    out[c] = {
      price: parseFloat(t.last), open: parseFloat(t.open24h),
      high: parseFloat(t.high24h), low: parseFloat(t.low24h),
      vol: parseFloat(t.volCcy24h) || 0
    };
  }
  if (!Object.keys(out).length) throw new Error('okx empty');
  return { source: 'okx', data: out };
}
async function fetchBinanceTickers() {
  const j = await httpGetJson('https://data-api.binance.vision/api/v3/ticker/24hr');
  if (!Array.isArray(j)) throw new Error('binance tickers bad');
  const map = {}; j.forEach(t => { map[t.symbol] = t; });
  const out = {};
  for (const c of SPOT_COINS) {
    const t = map[BIN_PAIR(c)];
    if (!t) continue;
    out[c] = {
      price: parseFloat(t.lastPrice), open: parseFloat(t.openPrice),
      high: parseFloat(t.highPrice), low: parseFloat(t.lowPrice),
      vol: parseFloat(t.quoteVolume) || 0
    };
  }
  if (!Object.keys(out).length) throw new Error('binance empty');
  return { source: 'binance', data: out };
}
async function fetchHistory(source, c) {
  try {
    if (source === 'okx') {
      const j = await httpGetJson(`https://www.okx.com/api/v5/market/candles?instId=${OKX_PAIR[c]}&bar=15m&limit=90`);
      if (j && j.code === '0' && Array.isArray(j.data))
        return j.data.map(k => parseFloat(k[4])).reverse();
    } else {
      const j = await httpGetJson(`https://data-api.binance.vision/api/v3/klines?symbol=${BIN_PAIR(c)}&interval=15m&limit=90`);
      if (Array.isArray(j)) return j.map(k => parseFloat(k[4]));
    }
  } catch (e) { /* 忽略，保留已有历史 */ }
  return null;
}

let histReady = false;
function applyLiveTickers(source, data) {
  live.source = source; live.tickerAt = Date.now();
  SPOT_COINS.forEach(c => {
    const t = data[c];
    const m = db.markets[c];
    if (!t || !(t.price > 0) || !m) return;
    const pp = pricePrec(t.price);
    m.price = round(t.price, pp);
    m.open = round(t.open > 0 ? t.open : t.price, pp);
    m.high = round(t.high > 0 ? t.high : t.price, pp);
    m.low = round(t.low > 0 ? t.low : t.price, pp);
    m.vol = round(t.vol, 2);
    m.live = true;
    m.history.push(m.price);
    if (m.history.length > 90) m.history.shift();
  });
  if (!histReady) {
    histReady = true;
    SPOT_COINS.forEach(async c => {
      const h = await fetchHistory(live.source, c);
      if (h && h.length && db.markets[c])
        db.markets[c].history = h.filter(p => p > 0).slice(-90).map(p => round(p, pricePrec(p)));
    });
  }
}

function bookPrec(p) { return p >= 1000 ? 2 : pricePrec(p); } // 盘口保留足够精度，避免相邻价位被四舍五入合并
function normBook(asks, bids, price) {
  const pp = bookPrec(price);
  const norm = arr => {
    const map = new Map();
    arr.forEach(x => {
      const pr = round(parseFloat(x[0]), pp), am = round(parseFloat(x[1]), 4);
      if (pr <= 0 || am <= 0) return;
      map.set(pr, round((map.get(pr) || 0) + am, 4)); // 同价位聚合
    });
    return Array.from(map, ([p, a]) => ({ price: p, amount: a })).slice(0, 12);
  };
  const askList = norm(asks).sort((a, b) => a.price - b.price);
  const bidList = norm(bids).sort((a, b) => b.price - a.price);
  // 中间价取真实最优买卖档均值，取不到再用最新成交价
  const mid = (askList[0] && bidList[0]) ? round((askList[0].price + bidList[0].price) / 2, pp) : price;
  return { asks: askList, bids: bidList, price: mid };
}
async function fetchLiveBook(c) {
  try {
    if (live.source === 'okx') {
      const [bj, tj] = await Promise.all([
        httpGetJson(`https://www.okx.com/api/v5/market/books?instId=${OKX_PAIR[c]}&sz=20`),
        httpGetJson(`https://www.okx.com/api/v5/market/trades?instId=${OKX_PAIR[c]}&limit=30`)
      ]);
      if (!bj || bj.code !== '0' || !bj.data || !bj.data[0]) throw new Error('okx book bad');
      const d = bj.data[0];
      const price = db.markets[c] ? db.markets[c].price : parseFloat((d.asks[0] || d.bids[0] || [])[0]);
      const trades = ((tj && tj.code === '0' && tj.data) || []).map(t => ({
        price: round(parseFloat(t.px), pricePrec(price)), amount: round(parseFloat(t.sz), 4),
        side: t.side === 'buy' ? 'buy' : 'sell', at: parseInt(t.ts) || Date.now()
      }));
      return { book: normBook(d.asks, d.bids, price), trades, ts: Date.now() };
    } else if (live.source === 'binance') {
      const [bj, tj] = await Promise.all([
        httpGetJson(`https://data-api.binance.vision/api/v3/depth?symbol=${BIN_PAIR(c)}&limit=20`),
        httpGetJson(`https://data-api.binance.vision/api/v3/trades?symbol=${BIN_PAIR(c)}&limit=30`)
      ]);
      if (!bj || !Array.isArray(bj.bids)) throw new Error('binance book bad');
      const price = db.markets[c] ? db.markets[c].price : parseFloat((bj.asks[0] || bj.bids[0] || [])[0]);
      const trades = (Array.isArray(tj) ? tj : []).map(t => ({
        price: round(parseFloat(t.price), bookPrec(price)), amount: round(parseFloat(t.qty), 4),
        side: t.isBuyerMaker ? 'sell' : 'buy', at: t.time || Date.now()
      })).sort((a, b) => b.at - a.at);
      return { book: normBook(bj.asks, bj.bids, price), trades, ts: Date.now() };
    }
  } catch (e) { /* 该币种盘口拉取失败，回退模拟盘口 */ }
  return null;
}
async function getLiveBook(c) {
  const cached = live.books[c];
  if (cached && Date.now() - cached.ts < 4000) return cached;
  if (!liveFresh()) return cached || null;
  if (!live.inflight[c]) {
    live.inflight[c] = fetchLiveBook(c).then(r => {
      delete live.inflight[c];
      if (r) live.books[c] = r;
      return r;
    }).catch(() => { delete live.inflight[c]; return null; });
  }
  return live.inflight[c];
}

async function fetchLiveRate() {
  try {
    const j = await httpGetJson('https://api.frankfurter.app/latest?from=USD&to=CNY');
    const r = j && j.rates && parseFloat(j.rates.CNY);
    if (r > 0) { live.rate = round(r, 4); live.rateAt = Date.now(); db.rate = live.rate; }
  } catch (e) { /* 汇率接口失败，沿用当前汇率 */ }
}
async function liveLoop() {
  try {
    let res = null;
    // OKX 连续失败时退避 5 分钟（国内网络常不可达），期间直连 Binance 公开行情
    if (Date.now() >= (live.okxRetryAt || 0)) {
      try {
        res = await fetchOkxTickers();
        live.okxFails = 0;
      } catch (e1) {
        live.okxFails = (live.okxFails || 0) + 1;
        if (live.okxFails >= 2) live.okxRetryAt = Date.now() + 5 * 60000;
        res = null;
      }
    }
    if (!res) {
      try { res = await fetchBinanceTickers(); } catch (e2) { res = null; }
    }
    if (res) {
      applyLiveTickers(res.source, res.data);
      if (Date.now() - live.rateAt > 30 * 60000) fetchLiveRate();
    }
    // 拉取失败：不改动 live.source，由 liveFresh() 判定超时后自动回退模拟
  } catch (e) { /* 网络异常，下轮重试 */ }
}

/* ---------------- 现货撮合引擎（模拟） ---------------- */
function fillSpot(o, fillPrice) {
  const u = db.users.find(x => x.id === o.userId);
  if (!u) { o.status = 'canceled'; return; }
  const cost = round(o.amount * fillPrice, 8);
  const fee = round(cost * SPOT_FEE, 8);
  if (o.side === 'buy') {
    if (coinBal(u, 'USDT') < cost + fee) { o.status = 'canceled'; o.cancelReason = '可用 USDT 不足'; return; }
    addCoin(u, 'USDT', -(cost + fee));
    addCoin(u, o.symbol, o.amount);
    addTxn(u.id, 'spot_buy', o.symbol, o.amount, `现货买入${o.symbol} @${fillPrice}（手续费${round(fee, 2)} USDT）`, o.id);
    addTxn(u.id, 'spot_fee', 'USDT', -fee, `现货手续费`, o.id);
  } else {
    if (coinBal(u, o.symbol) < o.amount) { o.status = 'canceled'; o.cancelReason = `可用 ${o.symbol} 不足`; return; }
    addCoin(u, o.symbol, -o.amount);
    addCoin(u, 'USDT', cost - fee);
    addTxn(u.id, 'spot_sell', 'USDT', cost - fee, `现货卖出${o.symbol} @${fillPrice}（手续费${round(fee, 2)} USDT）`, o.id);
  }
  o.status = 'filled'; o.fillPrice = fillPrice; o.filledAt = Date.now(); o.remain = 0;
  db.spotFills.unshift({
    id: nextId('f'), userId: o.userId, symbol: o.symbol, side: o.side,
    price: fillPrice, amount: o.amount, fee, at: Date.now()
  });
  if (db.spotFills.length > 200) db.spotFills.length = 200;
}
function matchSpotEngine() {
  db.spotOrders.forEach(o => {
    if (o.status !== 'open') return;
    const m = db.markets[o.symbol];
    if (!m) return;
    if (o.side === 'buy' && m.price <= o.price) fillSpot(o, m.price);
    else if (o.side === 'sell' && m.price >= o.price) fillSpot(o, m.price);
  });
}

/* ---------------- C2C 订单超时自动取消 ---------------- */
function sweepC2cOrders() {
  const now = Date.now();
  db.orders.forEach(o => {
    if (o.kind !== 'c2c') return;
    if (o.status === 'pending_pay' && o.payDeadline && now > o.payDeadline) {
      const seller = db.users.find(u => u.id === o.sellerId);
      if (seller) addCoin(seller, o.asset, o.amount);
      addTxn(o.sellerId, 'c2c_unlock', o.asset, o.amount, '超时未付款，托管货币自动退回', o.no);
      const ad = db.ads.find(a => a.id === o.adId);
      if (ad) ad.locked = Math.max(0, (ad.locked || 0) - o.amount);
      o.status = 'closed';
      o.timeline.push({ at: now, text: '买家超时未付款，订单自动取消，托管货币退回卖家' });
    }
  });
}

/* ---------------- 种子数据 ---------------- */
function seed() {
  const mk = (phone, pw, name, idCard, role, merchantStatus, coins) => {
    const u = {
      id: nextId('u'), phone, password: hashPw(pw), realName: name, idCard,
      role: role || 'user', merchantStatus: merchantStatus || 'none', coins: {},
      payAccounts: {
        alipay: name + '@163.com（支付宝实名账户）',
        wechat: 'wx_' + phone.slice(-4),
        bank: '中国工商银行 6222 **** **** ' + phone.slice(-4) + '（' + name + '）'
      },
      createdAt: Date.now() - 86400000 * 20
    };
    Object.entries(coins || {}).forEach(([c, v]) => (u.coins[c] = v));
    db.users.push(u);
    return u;
  };

  const admin = mk('13800000000', 'admin123', '平台管理员', '110101199001011234', 'admin', 'none',
    { USDT: 1000000, BTC: 20, ETH: 200 });
  admin.createdAt = Date.now() - 86400000 * 90;

  const m1 = mk('13900000001', 'seller123', '张伟', '310104199203051234', 'user', 'approved',
    { USDT: 158600, BTC: 1.2, ETH: 12 });
  m1.merchantInfo = { contact: 'QQ:88888888 / 微信:zhangwei888', experience: '5年币商经验，累计成交8000+单，闪电放行，零纠纷。', appliedAt: Date.now() - 86400000 * 300, approvedAt: Date.now() - 86400000 * 299 };
  m1.createdAt = Date.now() - 86400000 * 60;

  const m2 = mk('13700000004', 'merchant123', '王芳', '440305199404041234', 'user', 'approved',
    { USDT: 86300, BTC: 0.5 });
  m2.merchantInfo = { contact: '微信:wfang2024', experience: '3年OTC商家，支持支付宝/微信/银行卡，7×24小时在线。', appliedAt: Date.now() - 86400000 * 200, approvedAt: Date.now() - 86400000 * 199 };
  m2.createdAt = Date.now() - 86400000 * 45;

  const buyer = mk('13900000002', 'buyer123', '李娜', '440106199507124567', 'user', 'none',
    { USDT: 1520.5, BTC: 0.015, ETH: 0.3 });
  addTxn(buyer.id, 'deposit', 'USDT', 1520.5, '演示账户初始资产（模拟充值）', 'SEED');

  // C2C 广告
  const ads = [
    { userId: m1.id, side: 'sell', asset: 'USDT', price: 7.22, total: 50000, minCny: 100, maxCny: 50000, payMethods: ['alipay', 'wechat', 'bank'], terms: '老牌认证商家，5年OTC经验。支持支付宝、微信、银行卡转账，付款后请及时点击"我已付款"，看到账后秒放行。大额交易优先银行卡，工作时间9:00-24:00。' },
    { userId: m1.id, side: 'sell', asset: 'USDT', price: 7.25, total: 30000, minCny: 500, maxCny: 20000, payMethods: ['alipay'], terms: '支付宝专享通道，到账快。请务必使用本人实名支付宝付款，非实名/第三方付款不放币。' },
    { userId: m2.id, side: 'sell', asset: 'USDT', price: 7.20, total: 20000, minCny: 200, maxCny: 30000, payMethods: ['wechat', 'bank'], terms: '7×24小时在线，微信/银行卡均可。新手第一次交易可全程指导，放心下单。' },
    { userId: m1.id, side: 'buy', asset: 'USDT', price: 7.15, total: 20000, minCny: 500, maxCny: 10000, payMethods: ['wechat', 'bank'], terms: '高价收USDT！打款速度快，支持微信、银行卡。请先放币到平台担保再收款，安全无忧。' },
    { userId: m2.id, side: 'buy', asset: 'USDT', price: 7.13, total: 10000, minCny: 300, maxCny: 8000, payMethods: ['alipay', 'wechat'], terms: '收购USDT，支付宝/微信秒打款，金额越大价格越好。' }
  ];
  ads.forEach((a, i) => {
    db.ads.push({
      id: nextId('a'), ...a, filled: 0, locked: 0,
      status: 'on', views: 80 + i * 53, platform: false,
      createdAt: Date.now() - 86400000 * (i + 1)
    });
  });
}

/* ---------------- 广告视图 ---------------- */
function adView(a) {
  const u = db.users.find(x => x.id === a.userId);
  const conf = COIN_CONF[a.asset] || COIN_CONF.USDT;
  const done = db.orders.filter(o => o.adId === a.id && o.status === 'completed').length;
  const isPlatform = a.platform === true || (!!u && u.role === 'admin');
  return {
    ...a,
    available: round((a.total || 0) - (a.filled || 0) - (a.locked || 0), conf.prec),
    coinName: conf.name, coinIcon: conf.icon,
    merchant: u ? { id: u.id, name: maskName(u.realName), done, verified: true } : null,
    isPlatform
  };
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
    const { password, realName, idCard } = body;
    if (!/^1[3-9]\d{9}$/.test(phone)) return json(res, 400, { error: '手机号格式不正确' });
    if (!password || password.length < 6) return json(res, 400, { error: '密码至少6位' });
    if (!realName || !/^[一-龥·]{2,20}$/.test(realName)) return json(res, 400, { error: '请输入真实姓名（2-20位中文）' });
    if (!/^\d{17}[\dXx]$/.test(idCard || '')) return json(res, 400, { error: '身份证号格式不正确（18位）' });
    if (db.users.some(u => u.phone === phone)) return json(res, 400, { error: '该手机号已注册' });
    const u = {
      id: nextId('u'), phone, password: hashPw(password), realName, idCard,
      role: 'user', merchantStatus: 'none', coins: {},
      payAccounts: { alipay: '', wechat: '', bank: '' }, createdAt: Date.now()
    };
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

  /* ---------- 行情 ---------- */
  if (pathname === '/api/markets' && req.method === 'GET') {
    sweepC2cOrders();
    return json(res, 200, { list: allTickers(), rate: cnyRate(), source: liveFresh() ? live.source : 'sim', at: Date.now() });
  }
  if (seg[1] === 'markets' && seg[2] && req.method === 'GET') {
    const symbol = String(seg[2]).toUpperCase();
    if (!COIN_CONF[symbol]) return json(res, 404, { error: '交易对不存在' });
    let book = null, tradesOut = [];
    if (symbol !== 'USDT') {
      const lb = await getLiveBook(symbol);
      if (lb) { book = lb.book; tradesOut = (lb.trades || []).slice(0, 20); }
      else { book = orderBook(symbol); tradesOut = (db.trades[symbol] || []).slice(0, 20); }
    }
    return json(res, 200, {
      ticker: symbol === 'USDT' ? { symbol: 'USDT', name: '泰达币', price: 1, cny: cnyRate(), change: 0, history: [] } : ticker(symbol),
      book,
      trades: tradesOut,
      rate: cnyRate(),
      source: liveFresh() ? live.source : 'sim'
    });
  }

  /* ---------- 商家入驻 ---------- */
  if (pathname === '/api/merchant/apply' && req.method === 'POST') {
    if (needLogin()) return;
    if (me.merchantStatus === 'pending') return json(res, 400, { error: '入驻申请审核中，请耐心等待' });
    if (me.merchantStatus === 'approved') return json(res, 400, { error: '您已是认证商家' });
    const { contact, experience, payMethods } = body;
    if (!contact || contact.length < 3) return json(res, 400, { error: '请填写联系方式（QQ/微信）' });
    if (!Array.isArray(payMethods) || payMethods.length === 0) return json(res, 400, { error: '请至少选择一种收款方式' });
    const bad = payMethods.find(p => !PAY_METHODS[p]);
    if (bad) return json(res, 400, { error: '收款方式不正确' });
    me.merchantStatus = 'pending';
    me.merchantInfo = { contact, payMethods, experience: experience || '', appliedAt: Date.now() };
    saveDb();
    return json(res, 200, { ok: true, user: publicUser(me) });
  }

  /* ---------- C2C 广告 ---------- */
  if (pathname === '/api/ads' && req.method === 'GET') {
    sweepC2cOrders();
    const side = url.searchParams.get('side') || 'sell';
    const asset = String(url.searchParams.get('asset') || 'USDT').toUpperCase();
    const pay = url.searchParams.get('pay') || '';
    let list = db.ads.filter(a => a.status === 'on' && a.side === side && a.asset === asset);
    if (pay) list = list.filter(a => (a.payMethods || []).includes(pay));
    list = list.map(adView).filter(a => a.available > 0.00000001);
    list.sort((a, b) => side === 'sell' ? a.price - b.price : b.price - a.price);
    return json(res, 200, { list });
  }

  if (pathname === '/api/ads' && req.method === 'POST') {
    if (needLogin()) return;
    if (me.merchantStatus !== 'approved' && me.role !== 'admin') return json(res, 403, { error: '请先完成商家入驻并通过审核' });
    const ad = validateAd(body, me);
    if (ad.error) return json(res, 400, { error: ad.error });
    if (ad.side === 'sell' && coinBal(me, ad.asset) < ad.total)
      return json(res, 400, { error: `账户 ${ad.asset} 余额不足，发布出售广告需要持有对应货币（当前持有 ${coinBal(me, ad.asset)}）` });
    const rec = {
      id: nextId('a'), userId: me.id, side: ad.side, asset: ad.asset, price: ad.price,
      total: ad.total, filled: 0, locked: 0, minCny: ad.minCny, maxCny: ad.maxCny,
      payMethods: ad.payMethods, terms: ad.terms, status: 'on', views: 0,
      platform: me.role === 'admin', createdAt: Date.now()
    };
    db.ads.push(rec); saveDb();
    return json(res, 200, { ok: true, ad: adView(rec) });
  }

  if (seg[1] === 'ads' && seg[2] && seg[2] !== 'my' && req.method === 'GET' && !seg[3]) {
    const a = db.ads.find(x => x.id === seg[2]);
    if (!a) return json(res, 404, { error: '广告不存在' });
    a.views++; saveDb();
    const u = db.users.find(x => x.id === a.userId);
    return json(res, 200, {
      ad: adView(a),
      merchant: u ? {
        id: u.id, name: maskName(u.realName), phone: '',
        payAccounts: me ? u.payAccounts : null,
        merchantInfo: u.merchantInfo || null
      } : null
    });
  }

  if (pathname === '/api/my/ads' && req.method === 'GET') {
    if (needLogin()) return;
    const list = db.ads.filter(a => a.userId === me.id).sort((a, b) => b.createdAt - a.createdAt).map(adView);
    return json(res, 200, { list });
  }

  if (seg[1] === 'ads' && seg[3] === 'toggle' && req.method === 'POST') {
    if (needLogin()) return;
    const a = db.ads.find(x => x.id === seg[2]);
    if (!a) return json(res, 404, { error: '广告不存在' });
    if (a.userId !== me.id && me.role !== 'admin') return json(res, 403, { error: '无权操作' });
    a.status = a.status === 'on' ? 'off' : 'on';
    saveDb();
    return json(res, 200, { ok: true, status: a.status });
  }

  if (seg[1] === 'ads' && seg[2] && req.method === 'PUT') {
    if (needLogin()) return;
    const a = db.ads.find(x => x.id === seg[2]);
    if (!a) return json(res, 404, { error: '广告不存在' });
    if (a.userId !== me.id && me.role !== 'admin') return json(res, 403, { error: '无权操作' });
    const v = validateAd({ ...a, ...body }, me);
    if (v.error) return json(res, 400, { error: v.error });
    const busy = (a.locked || 0) > 0;
    if (!busy) {
      if (v.side === 'sell' && coinBal(db.users.find(u => u.id === a.userId), a.asset) + (a.locked || 0) < v.total)
        return json(res, 400, { error: '可用货币余额不足，无法调大广告数量' });
      a.total = v.total;
    }
    a.side = v.side; a.asset = v.asset; a.price = v.price; a.minCny = v.minCny; a.maxCny = v.maxCny;
    a.payMethods = v.payMethods; a.terms = v.terms;
    saveDb();
    return json(res, 200, { ok: true, ad: adView(a) });
  }

  if (seg[1] === 'ads' && seg[2] && req.method === 'DELETE') {
    if (needLogin()) return;
    const i = db.ads.findIndex(x => x.id === seg[2]);
    if (i < 0) return json(res, 404, { error: '广告不存在' });
    const a = db.ads[i];
    if (a.userId !== me.id && me.role !== 'admin') return json(res, 403, { error: '无权操作' });
    const busy = db.orders.some(o => o.adId === a.id && ['pending_pay', 'paid', 'disputed'].includes(o.status));
    if (busy) return json(res, 400, { error: '该广告有进行中的订单，不能删除，请先下架' });
    db.ads.splice(i, 1); saveDb();
    return json(res, 200, { ok: true });
  }

  /* ---------- C2C 订单 ---------- */
  if (pathname === '/api/c2c/orders' && req.method === 'POST') {
    if (needLogin()) return;
    sweepC2cOrders();
    const a = db.ads.find(x => x.id === body.adId);
    if (!a || a.status !== 'on') return json(res, 400, { error: '广告不存在或已下架' });
    if (a.userId === me.id) return json(res, 400, { error: '不能与自己的广告交易' });
    const conf = COIN_CONF[a.asset];
    const price = Number(a.price);
    let amount = Number(body.amount || 0);   // 货币数量
    let cny = Number(body.cny || 0);        // 法币金额
    if (!(amount > 0) && !(cny > 0)) return json(res, 400, { error: '请输入购买数量或金额' });
    if (!(amount > 0)) amount = round(cny / price, conf.prec);
    if (!(cny > 0)) cny = round(amount * price, 2);
    else amount = round(cny / price, conf.prec);
    if (cny < a.minCny - 0.01) return json(res, 400, { error: `单笔最低交易额 ¥${a.minCny}` });
    if (cny > a.maxCny + 0.01) return json(res, 400, { error: `单笔最高交易额 ¥${a.maxCny}` });
    const available = (a.total || 0) - (a.filled || 0) - (a.locked || 0);
    if (amount > available + 1e-8) return json(res, 400, { error: `广告剩余可交易量不足（仅剩 ${available} ${a.asset}）` });
    if (db.orders.some(o => o.adId === a.id && [o.buyerId, o.sellerId].includes(me.id) && ['pending_pay', 'paid', 'disputed'].includes(o.status)))
      return json(res, 400, { error: '您与该广告已有进行中的订单' });

    // 广告方向：sell=商家卖币（我是买家）；buy=商家收币（我是卖家）
    const sellerId = a.side === 'sell' ? a.userId : me.id;
    const buyerId = a.side === 'sell' ? me.id : a.userId;
    const seller = db.users.find(u => u.id === sellerId);
    if (coinBal(seller, a.asset) < amount) return json(res, 400, { error: '卖方账户货币不足，请换一个广告' });

    // 平台托管：卖家货币立即锁定
    addCoin(seller, a.asset, -amount);
    addTxn(sellerId, 'c2c_lock', a.asset, -amount, 'C2C交易担保锁定', '');
    a.locked = round((a.locked || 0) + amount, conf.prec);

    const o = {
      id: nextId('o'), kind: 'c2c', no: orderNo('C'), adId: a.id,
      asset: a.asset, amount, cny, price,
      sellerId, buyerId, adSide: a.side,
      payMethod: (a.payMethods || [])[0] || 'bank',
      status: 'pending_pay', dispute: null,
      payDeadline: Date.now() + 20 * 60 * 1000,
      timeline: [{ at: Date.now(), text: '订单创建，货币已由平台托管，等待买家付款' }],
      createdAt: Date.now()
    };
    db.orders.push(o); saveDb();
    return json(res, 200, { ok: true, order: c2cOrderView(o) });
  }

  if (pathname === '/api/c2c/orders' && req.method === 'GET') {
    if (needLogin()) return;
    sweepC2cOrders();
    const role = url.searchParams.get('role') === 'seller' ? 'seller' : 'buyer';
    const field = role === 'seller' ? 'sellerId' : 'buyerId';
    const list = db.orders.filter(o => o.kind === 'c2c' && o[field] === me.id)
      .sort((x, y) => y.createdAt - x.createdAt).map(c2cOrderView);
    return json(res, 200, { list });
  }

  if (seg[1] === 'c2c' && seg[2] === 'orders' && seg[3] && req.method === 'GET') {
    const o = db.orders.find(x => x.id === seg[3] && x.kind === 'c2c');
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (!me || (me.role !== 'admin' && me.id !== o.buyerId && me.id !== o.sellerId)) return json(res, 403, { error: '无权查看' });
    const buyer = db.users.find(u => u.id === o.buyerId);
    const seller = db.users.find(u => u.id === o.sellerId);
    const ad = db.ads.find(a => a.id === o.adId);
    return json(res, 200, {
      order: c2cOrderView(o),
      ad: ad ? adView(ad) : null,
      buyer: { id: buyer.id, name: maskName(buyer.realName) },
      seller: { id: seller.id, name: maskName(seller.realName) },
      // 收款信息：仅买家在付款阶段可见（C2C 法币线下转账）
      payInfo: (me.id === o.buyerId || me.role === 'admin') && seller.payAccounts
        ? { method: o.payMethod, account: seller.payAccounts[o.payMethod] || '（商家未设置该收款方式，请联系商家）', name: seller.realName }
        : null
    });
  }

  if (seg[1] === 'c2c' && seg[2] === 'orders' && seg[4] === 'mark-paid' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[3] && x.kind === 'c2c');
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (o.buyerId !== me.id) return json(res, 403, { error: '只有买家可以操作' });
    if (o.status !== 'pending_pay') return json(res, 400, { error: '当前状态不能标记付款' });
    o.status = 'paid'; o.paidAt = Date.now();
    o.timeline.push({ at: Date.now(), text: '买家已标记付款，等待卖家确认收款并放行货币' });
    saveDb();
    return json(res, 200, { ok: true, order: c2cOrderView(o) });
  }

  if (seg[1] === 'c2c' && seg[2] === 'orders' && seg[4] === 'release' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[3] && x.kind === 'c2c');
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (o.sellerId !== me.id) return json(res, 403, { error: '只有卖家可以放行货币' });
    if (o.status !== 'paid') return json(res, 400, { error: '当前状态不能放行' });
    const buyer = db.users.find(u => u.id === o.buyerId);
    addCoin(buyer, o.asset, o.amount);
    addTxn(o.buyerId, 'c2c_buy', o.asset, o.amount, `C2C买入${o.asset}到账（订单${o.no}）`, o.no);
    const ad = db.ads.find(a => a.id === o.adId);
    if (ad) { ad.filled = round((ad.filled || 0) + o.amount, COIN_CONF[o.asset].prec); ad.locked = Math.max(0, (ad.locked || 0) - o.amount); }
    o.status = 'completed'; o.completedAt = Date.now();
    o.timeline.push({ at: Date.now(), text: '卖家确认收款，平台已将托管货币放行给买家，交易完成' });
    saveDb();
    return json(res, 200, { ok: true, order: c2cOrderView(o) });
  }

  if (seg[1] === 'c2c' && seg[2] === 'orders' && seg[4] === 'cancel' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[3] && x.kind === 'c2c');
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (o.buyerId !== me.id && o.sellerId !== me.id) return json(res, 403, { error: '无权操作' });
    if (o.status !== 'pending_pay') return json(res, 400, { error: '订单已付款，不能取消，请走申诉流程' });
    const seller = db.users.find(u => u.id === o.sellerId);
    addCoin(seller, o.asset, o.amount);
    addTxn(o.sellerId, 'c2c_unlock', o.asset, o.amount, '订单取消，托管货币退回', o.no);
    const ad = db.ads.find(a => a.id === o.adId);
    if (ad) ad.locked = Math.max(0, (ad.locked || 0) - o.amount);
    o.status = 'closed';
    o.timeline.push({ at: Date.now(), text: (o.buyerId === me.id ? '买家' : '卖家') + '取消订单，托管货币退回卖家' });
    saveDb();
    return json(res, 200, { ok: true, order: c2cOrderView(o) });
  }

  if (seg[1] === 'c2c' && seg[2] === 'orders' && seg[4] === 'dispute' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.orders.find(x => x.id === seg[3] && x.kind === 'c2c');
    if (!o) return json(res, 404, { error: '订单不存在' });
    if (me.id !== o.buyerId && me.id !== o.sellerId) return json(res, 403, { error: '无权操作' });
    if (!['pending_pay', 'paid'].includes(o.status)) return json(res, 400, { error: '当前状态不能申诉' });
    const reason = String(body.reason || '').trim();
    if (reason.length < 5) return json(res, 400, { error: '请详细描述申诉原因（至少5个字）' });
    o.dispute = {
      by: me.id, byRole: me.id === o.buyerId ? 'buyer' : 'seller',
      reason, status: 'open', result: null, note: '', at: Date.now()
    };
    o.status = 'disputed';
    o.timeline.push({ at: Date.now(), text: (me.id === o.buyerId ? '买家' : '卖家') + '发起申诉，平台客服将介入仲裁，托管货币暂冻' });
    saveDb();
    return json(res, 200, { ok: true, order: c2cOrderView(o) });
  }

  /* ---------- 现货交易 ---------- */
  if (pathname === '/api/spot/orders' && req.method === 'POST') {
    if (needLogin()) return;
    const symbol = String(body.symbol || '').toUpperCase();
    const side = body.side === 'sell' ? 'sell' : 'buy';
    const type = body.type === 'limit' ? 'limit' : 'market';
    const amount = Number(body.amount);
    if (!COIN_CONF[symbol] || COIN_CONF[symbol].quote) return json(res, 400, { error: '交易对不存在' });
    if (!(amount > 0)) return json(res, 400, { error: '请输入交易数量' });
    const m = db.markets[symbol];
    const price = type === 'limit' ? Number(body.price) : m.price;
    if (!(price > 0)) return json(res, 400, { error: '请输入委托价格' });
    const amt = round(amount, COIN_CONF[symbol].prec);
    const cost = round(amt * price, 8);
    if (side === 'buy' && coinBal(me, 'USDT') < cost * (1 + SPOT_FEE))
      return json(res, 400, { error: '可用 USDT 不足' });
    if (side === 'sell' && coinBal(me, symbol) < amt)
      return json(res, 400, { error: `可用 ${symbol} 不足` });
    const o = {
      id: nextId('s'), kind: 'spot', userId: me.id, symbol, side, type,
      price: round(price, pricePrec(price)), amount: amt, remain: amt,
      status: 'open', createdAt: Date.now()
    };
    db.spotOrders.push(o);
    if (type === 'market') fillSpot(o, m.price);
    else matchSpotEngine();
    saveDb();
    return json(res, 200, { ok: true, order: o });
  }

  if (pathname === '/api/spot/orders' && req.method === 'GET') {
    if (needLogin()) return;
    const open = db.spotOrders.filter(o => o.userId === me.id && o.status === 'open').sort((a, b) => b.createdAt - a.createdAt);
    const history = db.spotFills.filter(f => f.userId === me.id).slice(0, 30);
    return json(res, 200, { open, history });
  }

  if (seg[1] === 'spot' && seg[2] === 'orders' && seg[3] && seg[4] === 'cancel' && req.method === 'POST') {
    if (needLogin()) return;
    const o = db.spotOrders.find(x => x.id === seg[3]);
    if (!o || o.userId !== me.id) return json(res, 404, { error: '委托不存在' });
    if (o.status !== 'open') return json(res, 400, { error: '该委托已成交' });
    o.status = 'canceled'; o.cancelReason = '用户撤单';
    saveDb();
    return json(res, 200, { ok: true });
  }

  /* ---------- 钱包 ---------- */
  if (pathname === '/api/wallet' && req.method === 'GET') {
    if (needLogin()) return;
    const rate = cnyRate();
    const coins = ALL_COINS.map(c => {
      const bal = coinBal(me, c);
      const t = c === 'USDT' ? 1 : (db.markets[c] ? db.markets[c].price : COIN_CONF[c].base);
      return { coin: c, name: COIN_CONF[c].name, icon: COIN_CONF[c].icon, color: COIN_CONF[c].color,
        balance: bal, usdValue: round(bal * t, 2), cnyValue: round(bal * t * rate, 2) };
    }).filter(x => x.balance > 0 || x.coin === 'USDT');
    const totalCny = coins.reduce((s, x) => s + x.cnyValue, 0);
    const txns = db.txns.filter(t => t.userId === me.id).sort((a, b) => b.at - a.at).slice(0, 100);
    return json(res, 200, { coins, totalCny: round(totalCny, 2), txns, rate });
  }

  if (pathname === '/api/wallet/deposit' && req.method === 'POST') {
    if (needLogin()) return;
    const coin = String(body.coin || 'USDT').toUpperCase();
    const amount = Number(body.amount);
    if (!COIN_CONF[coin]) return json(res, 400, { error: '币种不存在' });
    if (!(amount > 0)) return json(res, 400, { error: '充值数量不正确' });
    const amt = round(amount, COIN_CONF[coin].prec);
    addCoin(me, coin, amt);
    const txid = '0x' + crypto.randomBytes(16).toString('hex');
    addTxn(me.id, 'deposit', coin, amt, `模拟充值到账（${coin}链上转账，演示环境）`, txid);
    saveDb();
    return json(res, 200, { ok: true, txid, balance: coinBal(me, coin) });
  }

  if (pathname === '/api/wallet/withdraw' && req.method === 'POST') {
    if (needLogin()) return;
    const coin = String(body.coin || 'USDT').toUpperCase();
    const amount = Number(body.amount);
    const addr = String(body.address || '').trim();
    if (!COIN_CONF[coin]) return json(res, 400, { error: '币种不存在' });
    if (!(amount > 0)) return json(res, 400, { error: '提现数量不正确' });
    if (addr.length < 10) return json(res, 400, { error: '请输入正确的提现地址' });
    if (coinBal(me, coin) < amount) return json(res, 400, { error: '可用余额不足' });
    const amt = round(amount, COIN_CONF[coin].prec);
    addCoin(me, coin, -amt);
    const txid = '0x' + crypto.randomBytes(16).toString('hex');
    addTxn(me.id, 'withdraw', coin, -amt, `模拟提现至 ${addr.slice(0, 10)}…（演示环境）`, txid);
    saveDb();
    return json(res, 200, { ok: true, txid, balance: coinBal(me, coin) });
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
        content: '您好，这里是币易BiYiEx官方客服。请问有什么可以帮您？（行情交易、法币C2C、充提、纠纷申诉都可咨询）', userRead: false
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
      sweepC2cOrders();
      const escrowUsdt = db.orders.filter(o => o.kind === 'c2c' && ['pending_pay', 'paid', 'disputed'].includes(o.status))
        .reduce((s, o) => s + (o.asset === 'USDT' ? o.amount : o.amount * (db.markets[o.asset] ? db.markets[o.asset].price : 0)), 0);
      return json(res, 200, {
        users: db.users.filter(u => u.role !== 'admin').length,
        ads: db.ads.length,
        onSale: db.ads.filter(a => a.status === 'on').length,
        orders: db.orders.filter(o => o.kind === 'c2c').length,
        escrowUsdt: round(escrowUsdt, 2),
        escrowCny: round(escrowUsdt * cnyRate(), 2),
        spotVol: round(db.spotFills.reduce((s, f) => s + f.amount * f.price, 0), 2),
        pendingMerchants: db.users.filter(u => u.merchantStatus === 'pending').length,
        openDisputes: db.orders.filter(o => o.status === 'disputed').length,
        quoteSource: liveFresh() ? live.source : 'sim'
      });
    }

    if (pathname === '/api/admin/merchants' && req.method === 'GET') {
      const list = db.users.filter(u => u.merchantStatus && u.merchantStatus !== 'none')
        .map(u => ({
          id: u.id, name: maskName(u.realName), realName: u.realName, phone: u.phone, idCard: u.idCard,
          status: u.merchantStatus, merchantInfo: u.merchantInfo,
          usdt: coinBal(u, 'USDT'), adCount: db.ads.filter(a => a.userId === u.id).length,
          createdAt: u.createdAt
        }))
        .sort((a, b) => (b.merchantInfo && b.merchantInfo.appliedAt || b.createdAt) - (a.merchantInfo && a.merchantInfo.appliedAt || a.createdAt));
      return json(res, 200, { list });
    }

    if (seg[2] === 'merchants' && seg[4] === 'audit' && req.method === 'POST') {
      const u = db.users.find(x => x.id === seg[3]);
      if (!u) return json(res, 404, { error: '用户不存在' });
      if (u.merchantStatus !== 'pending') return json(res, 400, { error: '该申请已处理' });
      if (body.approve) {
        u.merchantStatus = 'approved';
        u.merchantInfo = u.merchantInfo || {};
        u.merchantInfo.approvedAt = Date.now();
        u.merchantInfo.auditNote = body.note || '';
      } else {
        u.merchantStatus = 'rejected';
        u.merchantInfo = u.merchantInfo || {};
        u.merchantInfo.rejectReason = body.reason || '资料不完整';
      }
      saveDb();
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/disputes' && req.method === 'GET') {
      const list = db.orders.filter(o => o.kind === 'c2c' && o.dispute)
        .map(o => ({ ...c2cOrderView(o),
          buyerName: (db.users.find(u => u.id === o.buyerId) || {}).realName || '',
          sellerName: (db.users.find(u => u.id === o.sellerId) || {}).realName || '' }))
        .sort((a, b) => b.dispute.at - a.dispute.at);
      return json(res, 200, { list });
    }

    if (seg[2] === 'disputes' && seg[4] === 'arbitrate' && req.method === 'POST') {
      const o = db.orders.find(x => x.id === seg[3] && x.kind === 'c2c');
      if (!o || !o.dispute) return json(res, 404, { error: '纠纷不存在' });
      if (o.status !== 'disputed') return json(res, 400, { error: '该纠纷已处理' });
      // ruling: buyer=判买方胜诉（货币放行给买家）；seller=判卖方胜诉（货币退回卖家）
      const ruling = body.ruling === 'seller' ? 'seller' : 'buyer';
      const buyer = db.users.find(u => u.id === o.buyerId);
      const seller = db.users.find(u => u.id === o.sellerId);
      const ad = db.ads.find(a => a.id === o.adId);
      if (ruling === 'buyer') {
        addCoin(buyer, o.asset, o.amount);
        addTxn(o.buyerId, 'c2c_buy', o.asset, o.amount, '仲裁判定买方胜诉，托管货币放行', o.no);
        if (ad) { ad.filled = round((ad.filled || 0) + o.amount, COIN_CONF[o.asset].prec); ad.locked = Math.max(0, (ad.locked || 0) - o.amount); }
        o.status = 'completed'; o.completedAt = Date.now();
        o.timeline.push({ at: Date.now(), text: '平台仲裁完成：判定买方胜诉，托管货币已放行给买方' });
        if (body.banMerchant) {
          seller.merchantStatus = 'banned';
          if (ad) ad.status = 'off';
          o.timeline.push({ at: Date.now(), text: '商家因违规被封禁商家资格，广告已下架' });
        }
      } else {
        addCoin(seller, o.asset, o.amount);
        addTxn(o.sellerId, 'c2c_unlock', o.asset, o.amount, '仲裁判定卖方胜诉，托管货币退回', o.no);
        if (ad) ad.locked = Math.max(0, (ad.locked || 0) - o.amount);
        o.status = 'closed';
        o.timeline.push({ at: Date.now(), text: '平台仲裁完成：判定卖方胜诉，托管货币已退回卖方' });
      }
      o.dispute.status = 'closed';
      o.dispute.result = ruling;
      o.dispute.note = body.note || '';
      o.dispute.handledAt = Date.now();
      saveDb();
      return json(res, 200, { ok: true, order: c2cOrderView(o) });
    }

    if (pathname === '/api/admin/ads' && req.method === 'GET') {
      const list = db.ads.sort((a, b) => b.createdAt - a.createdAt).map(a => {
        const s = db.users.find(u => u.id === a.userId);
        return { ...adView(a), merchantName: s ? maskName(s.realName) : '' };
      });
      return json(res, 200, { list });
    }

    if (pathname === '/api/admin/ads' && req.method === 'POST') {
      const v = validateAd(body, me);
      if (v.error) return json(res, 400, { error: v.error });
      if (v.side === 'sell' && coinBal(me, v.asset) < v.total)
        return json(res, 400, { error: `平台账户 ${v.asset} 余额不足` });
      const rec = {
        id: nextId('a'), userId: me.id, side: v.side, asset: v.asset, price: v.price,
        total: v.total, filled: 0, locked: 0, minCny: v.minCny, maxCny: v.maxCny,
        payMethods: v.payMethods, terms: v.terms, status: 'on', views: 0,
        platform: true, createdAt: Date.now()
      };
      db.ads.push(rec); saveDb();
      return json(res, 200, { ok: true, ad: adView(rec) });
    }

    if (seg[2] === 'ads' && seg[3] && req.method === 'PUT') {
      const a = db.ads.find(x => x.id === seg[3]);
      if (!a) return json(res, 404, { error: '广告不存在' });
      const v = validateAd({ ...a, ...body }, me);
      if (v.error) return json(res, 400, { error: v.error });
      a.side = v.side; a.asset = v.asset; a.price = v.price; a.minCny = v.minCny; a.maxCny = v.maxCny;
      a.payMethods = v.payMethods; a.terms = v.terms;
      if (body.status) a.status = body.status === 'on' ? 'on' : 'off';
      saveDb();
      return json(res, 200, { ok: true, ad: adView(a) });
    }

    if (seg[2] === 'ads' && seg[3] && req.method === 'DELETE') {
      const i = db.ads.findIndex(x => x.id === seg[3]);
      if (i < 0) return json(res, 404, { error: '广告不存在' });
      const busy = db.orders.some(o => o.adId === seg[3] && ['pending_pay', 'paid', 'disputed'].includes(o.status));
      if (busy) return json(res, 400, { error: '该广告有进行中的订单，不能删除，请先下架' });
      db.ads.splice(i, 1); saveDb();
      return json(res, 200, { ok: true });
    }

    /* ---- 用户资产管理 ---- */
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const kw = String(url.searchParams.get('kw') || '').trim().toLowerCase();
      let list = db.users.map(u => {
        const rate = cnyRate();
        const usdtValue = ALL_COINS.reduce((s, c) => {
          const t = c === 'USDT' ? 1 : (db.markets[c] ? db.markets[c].price : COIN_CONF[c].base);
          return s + coinBal(u, c) * t;
        }, 0);
        return {
          id: u.id, realName: u.realName, name: maskName(u.realName), phone: u.phone,
          role: u.role, merchantStatus: u.merchantStatus || 'none',
          usdt: round(coinBal(u, 'USDT'), 2), cnyValue: round(usdtValue * rate, 2),
          orderCount: db.orders.filter(o => o.kind === 'c2c' && (o.buyerId === u.id || o.sellerId === u.id)).length,
          createdAt: u.createdAt
        };
      });
      if (kw) list = list.filter(u => (u.phone || '').toLowerCase().includes(kw) || (u.realName || '').toLowerCase().includes(kw) || u.id.toLowerCase().includes(kw));
      list.sort((a, b) => b.createdAt - a.createdAt);
      return json(res, 200, { list });
    }

    if (seg[2] === 'users' && seg[4] === 'balance' && req.method === 'POST') {
      const u = db.users.find(x => x.id === seg[3]);
      if (!u) return json(res, 404, { error: '用户不存在' });
      if (u.role === 'admin') return json(res, 400, { error: '不能调整管理员账户' });
      const coin = String(body.coin || 'USDT').toUpperCase();
      if (!COIN_CONF[coin]) return json(res, 400, { error: '币种不存在' });
      const amount = Number(body.amount);
      if (!isFinite(amount) || amount === 0) return json(res, 400, { error: '数量不正确（正数增加 / 负数扣减）' });
      if (Math.abs(amount) > 10000000) return json(res, 400, { error: '单次调整数量过大' });
      const newBal = round(coinBal(u, coin) + amount, COIN_CONF[coin].prec);
      if (newBal < 0) return json(res, 400, { error: `扣减失败：该用户 ${coin} 余额仅 ${coinBal(u, coin)}` });
      const remark = String(body.remark || '').trim().slice(0, 100);
      addCoin(u, coin, amount);
      addTxn(u.id, 'admin_adjust', coin, amount, `管理员${amount > 0 ? '增加' : '扣减'}资产${remark ? '：' + remark : ''}`, 'ADMIN:' + me.id);
      saveDb();
      console.log(`[资产调整] ${me.phone} -> ${u.phone}(${u.id}) ${amount > 0 ? '+' : ''}${amount} ${coin} => ${newBal}`);
      return json(res, 200, { ok: true, balance: newBal });
    }

    if (seg[2] === 'users' && seg[4] === 'txns' && req.method === 'GET') {
      const u = db.users.find(x => x.id === seg[3]);
      if (!u) return json(res, 404, { error: '用户不存在' });
      const txns = db.txns.filter(t => t.userId === u.id).sort((a, b) => b.at - a.at).slice(0, 100);
      return json(res, 200, { user: { id: u.id, realName: u.realName, phone: u.phone, coins: u.coins || {} }, txns });
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
    if (seg[2] === 'support' && seg[3] === 'conversations' && seg[4] && req.method === 'GET') {
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
  function binRequest(host, path, method, params, keys, isPublic) {
    return new Promise((resolve, reject) => {
      const qs = params ? Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
      const fullPath = isPublic ? `${path}${qs ? '?' + qs : ''}`
        : `${path}?${qs}&timestamp=${Date.now()}&recvWindow=10000`;
      const headers = {};
      if (!isPublic) { headers['X-MBX-APIKEY'] = keys.apiKey; fullPath += '&signature=' + binSign(fullPath.split('?')[1], keys.secret); }
      const opts = { hostname: host, port: 443, path: fullPath, method, headers, timeout: 8000 };
      const req = https.request(opts, r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => {
          try { resolve({ code: r.statusCode, data: JSON.parse(d) }); }
          catch (e) { resolve({ code: r.statusCode, data: null, raw: d }); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  // 保存 / 删除 API Key（仅存本机，不返回 secret）
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
  // 账户余额
  if (pathname === '/api/binance/account' && req.method === 'GET') {
    if (needLogin()) return;
    const k = loadKeys(); if (!k) return json(res, 400, { error: '请先配置 API Key' });
    const host = BIN_HOSTS[k.net] || BIN_HOSTS.test;
    const r = await binRequest(host, '/api/v3/account', 'GET', {}, k, false);
    if (r.code !== 200) return json(res, 400, { error: (r.data && r.data.msg) || '请求失败 ' + r.code, raw: r.raw });
    const balances = (r.data.balances || []).filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    return json(res, 200, { balances, net: k.net, canTrade: r.data.canTrade });
  }
  // 下单
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
  // 撤单
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
  // 当前委托 + 成交历史
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
  // 实盘行情（用已配置的主机）
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

/* ---- 广告参数校验（发布/编辑共用） ---- */
function validateAd(body, me) {
  const side = body.side === 'buy' ? 'buy' : 'sell';
  const asset = String(body.asset || 'USDT').toUpperCase();
  if (!COIN_CONF[asset] || !COIN_CONF[asset].c2c) return { error: '该币种暂不支持法币交易' };
  const price = Number(body.price);
  const total = Number(body.total);
  const minCny = Number(body.minCny);
  const maxCny = Number(body.maxCny);
  if (!(price > 0) || price > 10000000) return { error: '请输入正确的单价' };
  if (!(total > 0)) return { error: '请输入广告数量' };
  if (!(minCny > 0) || !(maxCny > 0) || minCny > maxCny) return { error: '请输入正确的交易额上下限' };
  if (maxCny > total * price * 1.0001) return { error: '交易额上限不能超过广告总价值' };
  let payMethods = Array.isArray(body.payMethods) ? body.payMethods : [];
  if (payMethods.length === 0) payMethods = ['bank'];
  if (payMethods.some(p => !PAY_METHODS[p])) return { error: '收款方式不正确' };
  return {
    side, asset, price: round(price, 4), total: round(total, COIN_CONF[asset].prec),
    minCny: round(minCny, 2), maxCny: round(maxCny, 2),
    payMethods, terms: String(body.terms || '').slice(0, 500)
  };
}

/* ---- C2C 订单视图 ---- */
function c2cOrderView(o) {
  const conf = COIN_CONF[o.asset] || COIN_CONF.USDT;
  const ad = db.ads ? db.ads.find(a => a.id === o.adId) : null;
  return {
    ...o,
    coinName: conf.name, coinIcon: conf.icon,
    payMethodName: PAY_METHODS[o.payMethod] ? PAY_METHODS[o.payMethod].name : o.payMethod,
    payMethodIcon: PAY_METHODS[o.payMethod] ? PAY_METHODS[o.payMethod].icon : '🏦',
    remainSec: o.status === 'pending_pay' && o.payDeadline ? Math.max(0, Math.floor((o.payDeadline - Date.now()) / 1000)) : 0,
    adSideText: o.adSide === 'sell' ? '出售' : '收购'
  };
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
setInterval(marketTick, 4000);
// 真实行情：启动即拉取一次，之后每 5 秒刷新；失败自动回退模拟
liveLoop();
setInterval(liveLoop, 5000);
fetchLiveRate();
setInterval(fetchLiveRate, 30 * 60000);
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
      console.log('  币易 BiYiEx 数字资产交易平台（模拟盘）已启动');
      console.log('  访问地址: http://localhost:' + PORT);
      console.log('  管理员: 13800000000 / admin123');
      console.log('  认证商家: 13900000001 / seller123');
      console.log('  普通用户: 13900000002 / buyer123');
      console.log('==============================================');
    });
  });
  probe.end();
}
