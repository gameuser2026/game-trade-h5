/* ========== 币易 BiYiEx 数字资产交易平台（模拟盘）前端 ========== */
const C2C_COINS = ['USDT', 'BTC', 'ETH'];
const PAY_ICONS = { alipay: '🅰️ 支付宝', wechat: '💚 微信', bank: '🏦 银行卡' };
const OSTATUS = {
  pending_pay: '待买家付款', paid: '待卖家放行', completed: '已完成',
  disputed: '平台仲裁中', closed: '已取消', refunded: '已退款'
};
const TXN_NAME = {
  deposit: '充币', withdraw: '提币',
  spot_buy: '现货买入', spot_sell: '现货卖出', spot_fee: '现货手续费',
  c2c_lock: 'C2C担保锁定', c2c_unlock: '担保货币退回', c2c_buy: 'C2C买入到账',
  admin_adjust: '管理员调账'
};

const state = { token: localStorage.getItem('token') || '', user: null };
const $view = () => document.getElementById('view');

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmt(n, dp) {
  if (n == null || isNaN(n)) return '--';
  const v = Number(n);
  if (dp == null) dp = v >= 1000 ? 2 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6;
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtCountdown(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
function chgCls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : ''; }
function chgTxt(v) { return (v > 0 ? '+' : '') + fmt(v, 2) + '%'; }
function spark(data, w, h, color) {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data), max = Math.max(...data), rng = (max - min) || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1) * w).toFixed(1)},${(h - 2 - (v - min) / rng * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function toast(msg, ms) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms || 1800);
}
function showModal(html, center) {
  const m = document.getElementById('modal');
  m.className = 'modal-mask' + (center ? ' center' : '');
  m.innerHTML = `<div class="modal"><div class="modal-wrap"><button class="m-close" data-act="close-modal">×</button>${html}</div></div>`;
  m.style.display = 'flex';
}
function closeModal() { document.getElementById('modal').style.display = 'none'; }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const r = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}
async function loadMe() {
  if (!state.token) { state.user = null; return null; }
  try { state.user = (await api('/api/me')).user; }
  catch (e) { state.token = ''; localStorage.removeItem('token'); state.user = null; }
  return state.user;
}
function requireLogin() {
  if (!state.user) { location.hash = '#/login'; toast('请先登录'); return false; }
  return true;
}

/* 页面轮询统一管理 */
let _timer = null;
function stopPoll() { if (_timer) { clearInterval(_timer); _timer = null; } }
let _chatTimer = null;
function stopChatPoll() { if (_chatTimer) { clearInterval(_chatTimer); _chatTimer = null; } }

/* ---------- 路由 ---------- */
const routes = [
  [/^#\/markets$/, renderMarkets],
  [/^#\/trade$/, renderTrade],
  [/^#\/c2c$/, renderC2c],
  [/^#\/c2c-orders$/, renderC2cOrders],
  [/^#\/c2c-order\/(\w+)$/, renderC2cOrder],
  [/^#\/ad-publish$/, renderAdPublish],
  [/^#\/my-ads$/, renderMyAds],
  [/^#\/merchant$/, renderMerchantApply],
  [/^#\/wallet$/, renderWallet],
  [/^#\/support$/, renderSupport],
  [/^#\/admin$/, renderAdmin],
  [/^#\/me$/, renderMe],
  [/^#\/login$/, renderLogin],
  [/^#\/register$/, renderRegister],
  [/^#\/live$/, renderLive]
];
async function router() {
  closeModal();
  stopPoll();
  stopChatPoll();
  window.scrollTo(0, 0);
  const hash = location.hash || '#/markets';
  const path = hash.split('?')[0];
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      setTab(hash);
      try { await fn(...m.slice(1)); }
      catch (e) { $view().innerHTML = `<div class="empty"><div class="big">😵</div>${esc(e.message)}</div>`; }
      return;
    }
  }
  location.hash = '#/markets';
}
function setTab(hash) {
  const p = hash.split('?')[0];
  const map = {
    '#/markets': 'markets', '#/trade': 'trade',
    '#/c2c': 'c2c', '#/c2c-orders': 'c2c', '#/c2c-order': 'c2c', '#/ad-publish': 'c2c', '#/my-ads': 'c2c', '#/merchant': 'c2c',
    '#/wallet': 'wallet', '#/me': 'me', '#/support': 'me', '#/admin': 'me'
  };
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === map[p]));
}
window.addEventListener('hashchange', router);

/* ================= 行情首页 ================= */
async function renderMarkets() {
  $view().innerHTML = `
    <div class="ex-banner">
      <div class="eb-row">
        <div class="eb-logo">◆</div>
        <div><div class="eb-name">币易 <span>BiYiEx</span></div><div class="eb-sub">数字资产交易平台 · 模拟盘</div></div>
        <div class="eb-rate" id="ebRate">USDT/CNY --</div>
      </div>
      <div class="eb-quick">
        <a href="#/c2c?side=sell" class="eq buy">🪙 买币<span>人民币买USDT</span></a>
        <a href="#/c2c?side=buy" class="eq sell">💵 卖币<span>USDT换人民币</span></a>
        <a href="#/trade" class="eq trade">📊 现货<span>币币交易</span></a>
      </div>
    </div>
    <div class="searchbar">🔍<input id="mkSearch" placeholder="搜索币种名称 / 简称，如 BTC、比特币"></div>
    <div class="mk-head"><span class="col-name">名称</span><span class="col-spark"></span><span class="col-price">最新价</span><span class="col-chg">24h涨跌</span></div>
    <div id="mkList" class="mk-list"><div class="empty">加载中...</div></div>
    <div id="srcTip" class="muted" style="text-align:center;padding:14px 0 26px">行情加载中…</div>`;

  let kw = '';
  document.getElementById('mkSearch').addEventListener('input', e => { kw = e.target.value.trim().toLowerCase(); paint(); });

  let cache = [];
  function paint() {
    const list = cache.filter(t => !kw || t.symbol.toLowerCase().includes(kw) || t.name.includes(kw));
    document.getElementById('mkList').innerHTML = list.length ? list.map(t => `
      <div class="mk-row" data-sym="${t.symbol}">
        <div class="col-name"><div class="coin-ic" style="background:${t.color}1a;color:${t.color}">${t.icon}</div>
          <div><div class="cn">${t.symbol === 'USDT' ? 'USDT' : t.symbol + '/USDT'}</div><div class="csub">${esc(t.name)}</div></div></div>
        <div class="col-spark">${t.spark && t.spark.length ? spark(t.spark, 56, 24, t.change >= 0 ? '#16b364' : '#f53f3f') : '<span class="muted" style="font-size:11px">法币</span>'}</div>
        <div class="col-price"><div class="cp">${t.symbol === 'USDT' ? '¥' + fmt(t.cny, 4) : fmt(t.price)}</div>
          <div class="csub">${t.symbol === 'USDT' ? '1 USDT' : '≈¥' + fmt(t.cny)}</div></div>
        <div class="col-chg"><span class="chg ${chgCls(t.change)}">${t.symbol === 'USDT' ? 'USD' : chgTxt(t.change)}</span></div>
      </div>`).join('') : '<div class="empty">没有匹配的币种</div>';
    document.querySelectorAll('.mk-row').forEach(el => el.onclick = () => location.hash = el.dataset.sym === 'USDT' ? '#/c2c?side=sell&asset=USDT' : '#/trade?symbol=' + el.dataset.sym);
  }
  async function load() {
    try {
      const d = await api('/api/markets');
      cache = d.list;
      document.getElementById('ebRate').textContent = 'USDT/CNY ' + fmt(d.rate, 4);
      const tip = document.getElementById('srcTip');
      if (tip) tip.innerHTML = d.source === 'okx'
        ? '🟢 <b>实时行情 · 数据来源 OKX 欧易</b> · 每5秒刷新 · 交易为模拟盘'
        : d.source === 'binance'
          ? '🟢 <b>实时行情 · 数据来源 Binance</b> · 每5秒刷新 · 交易为模拟盘'
          : '🟡 实时行情接口暂不可用，当前显示<b>模拟行情</b> · 交易为模拟盘';
      paint();
    } catch (e) { /* ignore */ }
  }
  await load();
  _timer = setInterval(load, 4000);
}

/* ================= 现货交易 ================= */
async function renderTrade() {
  if (!(await loadMe()) || !state.user) { location.hash = '#/login'; return; }
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  let symbol = (params.get('symbol') || 'BTC').toUpperCase();
  let side = 'buy';            // buy=买入 / sell=卖出
  let ordType = 'limit';       // limit=限价 / market=市价
  let bookTab = 'book';

  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>
      <span id="pairName" class="pair-name" style="cursor:pointer">-- ⌄</span>
      <span id="srcBadge" class="src-badge">行情…</span></div>
    <div class="trade-head">
      <div class="th-price"><div class="thp" id="thPrice">--</div>
        <div class="thp-cny" id="thCny">≈¥--</div></div>
      <div class="th-stats" id="thStats"></div>
    </div>
    <div class="chart-box" id="chartBox"></div>

    <div class="trade-tabs">
      <div class="tt-seg">
        <button class="tt ${side === 'buy' ? 'on buy' : ''}" id="ttBuy">买入</button>
        <button class="tt ${side === 'sell' ? 'on sell' : ''}" id="ttSell">卖出</button>
      </div>
      <div class="tt-type">
        <button class="ty ${ordType === 'limit' ? 'on' : ''}" id="tyLimit">限价</button>
        <button class="ty ${ordType === 'market' ? 'on' : ''}" id="tyMarket">市价</button>
      </div>
    </div>

    <div class="book-tabs">
      <button class="bt-on" id="btBook">盘口</button>
      <button id="btTrades">成交记录</button>
    </div>
    <div id="bookBox" class="book-box"></div>

    <div class="trade-form card">
      <div id="fPriceRow" class="f-row"><label>委托价格</label>
        <div class="f-in"><input id="fPrice" type="number" inputmode="decimal" placeholder="0.00"><span>USDT</span></div></div>
      <div class="f-row"><label>交易数量</label>
        <div class="f-in"><input id="fAmount" type="number" inputmode="decimal" placeholder="0.00"><span id="fCoin">${symbol}</span></div></div>
      <div class="f-row avail" id="fAvail">可用 --</div>
      <div class="pct-row">
        ${[25, 50, 75, 100].map(p => `<button class="pct" data-pct="${p}">${p}%</button>`).join('')}
      </div>
      <div class="f-est" id="fEst">交易额 ≈ 0.00 USDT（含 0.1% 手续费）</div>
      <button class="btn block trade-btn ${side}" id="fSubmit">买入 ${symbol}</button>
    </div>

    <div class="card" style="margin-bottom:90px">
      <div class="oo-head"><b id="ooTitle">当前委托</b><span class="muted" id="ooSwitch" style="cursor:pointer">查看历史成交 ›</span></div>
      <div id="ooBox"><div class="muted" style="padding:14px 0;text-align:center">加载中...</div></div>
    </div>`;

  document.getElementById('pairName').onclick = () => {
    showModal(`<h3 style="margin-bottom:12px">选择交易对</h3>
      <div class="sym-list">
        ${['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'TRX'].map(s => `
          <div class="sym-item" data-pick="${s}"><b>${s}/USDT</b><span class="muted" id="pick-${s}"></span></div>`).join('')}
      </div>`, true);
    api('/api/markets').then(d => {
      d.list.forEach(t => { const el = document.getElementById('pick-' + t.symbol); if (el) { el.textContent = fmt(t.price); el.classList.add(t.change >= 0 ? 'up' : 'down'); } });
      document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => { closeModal(); location.hash = '#/trade?symbol=' + el.dataset.pick; });
    });
  };

  document.getElementById('ttBuy').onclick = () => { side = 'buy'; syncForm(); };
  document.getElementById('ttSell').onclick = () => { side = 'sell'; syncForm(); };
  document.getElementById('tyLimit').onclick = () => { ordType = 'limit'; syncForm(); };
  document.getElementById('tyMarket').onclick = () => { ordType = 'market'; syncForm(); };
  document.getElementById('btBook').onclick = () => { bookTab = 'book'; syncBook(); };
  document.getElementById('btTrades').onclick = () => { bookTab = 'trades'; syncBook(); };
  document.querySelectorAll('.pct').forEach(b => b.onclick = () => {
    const p = Number(b.dataset.pct) / 100;
    if (!last) return;
    if (ordType === 'market') {
      const price = last.price;
      const avail = side === 'buy' ? bal.USDT / price : (bal[symbol] || 0);
      document.getElementById('fAmount').value = fmt(avail * p, 6).replace(/,/g, '');
    } else {
      const price = Number(document.getElementById('fPrice').value) || last.price;
      const avail = side === 'buy' ? bal.USDT / price : (bal[symbol] || 0);
      document.getElementById('fAmount').value = fmt(avail * p, 6).replace(/,/g, '');
    }
    syncEst();
  });
  document.getElementById('fPrice').oninput = syncEst;
  document.getElementById('fAmount').oninput = syncEst;
  document.getElementById('fSubmit').onclick = async () => {
    const amount = Number(document.getElementById('fAmount').value);
    const price = Number(document.getElementById('fPrice').value);
    try {
      const r = await api('/api/spot/orders', {
        method: 'POST',
        body: { symbol, side, type: ordType, amount, price: ordType === 'limit' ? price : undefined }
      });
      toast(ordType === 'market' || r.order.status === 'filled' ? '成交成功' : '限价委托已提交');
      document.getElementById('fAmount').value = '';
      await loadWallet(); await loadOrders();
    } catch (e) { toast(e.message); }
  };

  let last = null, bal = { USDT: 0 }, bookData = null, showHistory = false;
  document.getElementById('ooSwitch').onclick = () => { showHistory = !showHistory; syncOrders(); };

  function syncForm() {
    document.getElementById('ttBuy').className = 'tt ' + (side === 'buy' ? 'on buy' : '');
    document.getElementById('ttSell').className = 'tt ' + (side === 'sell' ? 'on sell' : '');
    document.getElementById('tyLimit').classList.toggle('on', ordType === 'limit');
    document.getElementById('tyMarket').classList.toggle('on', ordType === 'market');
    document.getElementById('fPriceRow').style.display = ordType === 'limit' ? '' : 'none';
    document.getElementById('fCoin').textContent = symbol;
    const btn = document.getElementById('fSubmit');
    btn.textContent = (side === 'buy' ? '买入 ' : '卖出 ') + symbol;
    btn.className = 'btn block trade-btn ' + side;
    syncEst();
  }
  function syncEst() {
    const price = ordType === 'market' ? (last ? last.price : 0) : Number(document.getElementById('fPrice').value) || 0;
    const amt = Number(document.getElementById('fAmount').value) || 0;
    const est = price * amt;
    document.getElementById('fEst').textContent = side === 'buy'
      ? `交易额 ≈ ${fmt(est, 2)} USDT（含 0.1% 手续费）`
      : `预计获得 ≈ ${fmt(est * 0.999, 2)} USDT（扣 0.1% 手续费）`;
  }
  function syncBook() {
    document.getElementById('btBook').className = bookTab === 'book' ? 'bt-on' : '';
    document.getElementById('btTrades').className = bookTab === 'trades' ? 'bt-on' : '';
    const box = document.getElementById('bookBox');
    if (!bookData) { box.innerHTML = '<div class="muted" style="padding:12px;text-align:center">加载中...</div>'; return; }
    if (bookTab === 'book') {
      const rows = [];
      bookData.book.asks.slice(0, 6).reverse().forEach(l => rows.push(bookRow(l, 'ask')));
      rows.push(`<div class="book-spread"><b class="${chgCls(bookData.ticker.change)}">${fmt(bookData.book.price)}</b><span class="muted">≈¥${fmt(bookData.ticker.cny)}</span></div>`);
      bookData.book.bids.slice(0, 6).forEach(l => rows.push(bookRow(l, 'bid')));
      box.innerHTML = rows.join('');
    } else {
      box.innerHTML = `<div class="trd-row trd-h"><span>价格(USDT)</span><span>数量</span><span>方向</span></div>` +
        (bookData.trades || []).slice(0, 12).map(t => `
          <div class="trd-row"><span class="${t.side === 'buy' ? 'up' : 'down'}">${fmt(t.price)}</span><span>${fmt(t.amount, 4)}</span>
          <span class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? '买' : '卖'}</span></div>`).join('');
    }
  }
  function bookRow(l, kind) {
    const maxAmt = Math.max(...bookData.book.asks.concat(bookData.book.bids).map(x => x.amount));
    const pct = Math.min(100, l.amount / maxAmt * 100);
    return `<div class="book-row ${kind}">
      <span class="bp">${fmt(l.price)}</span><span class="ba">${fmt(l.amount, 4)}</span>
      <div class="bbar" style="width:${pct}%;background:${kind === 'ask' ? 'rgba(245,63,63,.12)' : 'rgba(22,179,100,.12)'}"></div></div>`;
  }

  async function loadWallet() {
    try {
      const w = await api('/api/wallet');
      bal = { USDT: 0 };
      w.coins.forEach(c => { bal[c.coin] = c.balance; });
    } catch (e) { bal = { USDT: 0 }; }
    document.getElementById('fAvail').textContent = side === 'buy'
      ? `可用 ${fmt(bal.USDT, 2)} USDT`
      : `可用 ${fmt(bal[symbol] || 0)} ${symbol}`;
  }
  async function loadMarket() {
    const d = await api('/api/markets/' + symbol);
    last = d.ticker; bookData = d;
    document.getElementById('pairName').textContent = symbol + '/USDT ⌄';
    const sb = document.getElementById('srcBadge');
    if (sb) {
      sb.textContent = d.source === 'okx' ? '🟢 OKX实时' : d.source === 'binance' ? '🟢 实时行情' : '🟡 模拟行情';
      sb.className = 'src-badge ' + (d.source === 'sim' ? 'sim' : 'live');
    }
    document.getElementById('thPrice').textContent = fmt(d.ticker.price);
    document.getElementById('thPrice').className = 'thp ' + chgCls(d.ticker.change);
    document.getElementById('thCny').textContent = '≈¥' + fmt(d.ticker.cny);
    document.getElementById('thStats').innerHTML = `
      <div><span class="muted">24h涨跌</span><b class="${chgCls(d.ticker.change)}">${chgTxt(d.ticker.change)}</b></div>
      <div><span class="muted">24h最高</span><b>${fmt(d.ticker.high)}</b></div>
      <div><span class="muted">24h最低</span><b>${fmt(d.ticker.low)}</b></div>
      <div><span class="muted">24h量</span><b>${fmt(d.ticker.vol, 0)}</b></div>`;
    document.getElementById('chartBox').innerHTML =
      `<div class="chart-spark">${spark(d.ticker.spark, 340, 90, d.ticker.change >= 0 ? '#16b364' : '#f53f3f')}</div>`;
    syncBook();
    if (ordType === 'market') syncEst();
  }
  async function loadOrders() {
    try {
      const d = await api('/api/spot/orders?symbol=' + symbol);
      const open = d.open.filter(o => o.symbol === symbol);
      const hist = d.history.filter(f => f.symbol === symbol);
      document.getElementById('ooSwitch').textContent = showHistory ? '查看当前委托 ›' : `查看历史成交 (${hist.length}) ›`;
      document.getElementById('ooTitle').textContent = showHistory ? '历史成交' : '当前委托';
      const box = document.getElementById('ooBox');
      if (showHistory) {
        box.innerHTML = hist.length ? hist.map(f => `
          <div class="oo-row">
            <span class="oo-side ${f.side}">${f.side === 'buy' ? '买入' : '卖出'}</span>
            <span>${fmt(f.amount)} ${f.symbol}</span>
            <span class="${f.side === 'buy' ? 'up' : 'down'}">@${fmt(f.price)}</span>
            <span class="muted">${fmtTime(f.at).slice(5)}</span></div>`).join('')
          : '<div class="muted" style="padding:14px 0;text-align:center">暂无成交记录</div>';
      } else {
        box.innerHTML = open.length ? open.map(o => `
          <div class="oo-row">
            <span class="oo-side ${o.side}">${o.side === 'buy' ? '买入' : '卖出'}${o.type === 'limit' ? '·限价' : '·市价'}</span>
            <span>${fmt(o.amount)} ${o.symbol}</span>
            <span>@${fmt(o.price)}</span>
            <button class="btn sm gray" data-act="spot-cancel" data-id="${o.id}">撤单</button></div>`).join('')
          : '<div class="muted" style="padding:14px 0;text-align:center">暂无进行中的委托</div>';
      }
    } catch (e) { /* ignore */ }
  }
  function syncOrders() { loadOrders(); }

  await loadMarket();
  await loadWallet();
  await loadOrders();
  syncForm();
  _timer = setInterval(() => { loadMarket(); loadWallet(); loadOrders(); }, 3500);
}

/* ================= 法币 C2C ================= */
async function renderC2c() {
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  // side 参数语义：sell=商家卖币（我买入）；buy=商家收币（我卖出）
  let side = params.get('side') === 'buy' ? 'buy' : 'sell';
  let asset = (params.get('asset') || 'USDT').toUpperCase();
  let pay = params.get('pay') || '';

  $view().innerHTML = `
    <div class="navbar">法币交易<span class="act" id="goPublish">＋ 发布广告</span></div>
    <div class="c2c-seg">
      <button class="cs ${side === 'sell' ? 'on buy' : ''}" data-side="sell">买入</button>
      <button class="cs ${side === 'buy' ? 'on sell' : ''}" data-side="buy">卖出</button>
    </div>
    <div class="c2c-chips" id="assetChips">
      ${C2C_COINS.map(c => `<button class="chip ${asset === c ? 'on' : ''}" data-asset="${c}">${c}</button>`).join('')}
    </div>
    <div class="c2c-chips pay" id="payChips">
      <button class="chip ${!pay ? 'on' : ''}" data-pay="">全部支付</button>
      <button class="chip ${pay === 'alipay' ? 'on' : ''}" data-pay="alipay">🅰️ 支付宝</button>
      <button class="chip ${pay === 'wechat' ? 'on' : ''}" data-pay="wechat">💚 微信</button>
      <button class="chip ${pay === 'bank' ? 'on' : ''}" data-pay="bank">🏦 银行卡</button>
    </div>
    <div class="c2c-tip">🛡️ 所有交易均由平台担保：货币先托管，买家付款、卖家放行后才结算</div>
    <div id="adList" class="ad-list"><div class="empty">加载中...</div></div>
    <div style="height:80px"></div>`;

  document.getElementById('goPublish').onclick = () => location.hash = '#/ad-publish';
  document.querySelectorAll('#assetChips [data-asset]').forEach(b => b.onclick = () => { asset = b.dataset.asset; paint(); refreshChips(); });
  document.querySelectorAll('#payChips [data-pay]').forEach(b => b.onclick = () => { pay = b.dataset.pay; paint(); refreshChips(); });
  document.querySelectorAll('.c2c-seg .cs').forEach(b => b.onclick = () => { side = b.dataset.side; paint(); refreshChips(); });
  function refreshChips() {
    document.querySelectorAll('#assetChips [data-asset]').forEach(b => b.classList.toggle('on', b.dataset.asset === asset));
    document.querySelectorAll('#payChips [data-pay]').forEach(b => b.classList.toggle('on', b.dataset.pay === pay));
    document.querySelectorAll('.c2c-seg .cs').forEach(b => {
      b.className = 'cs ' + (b.dataset.side === side ? 'on ' + (side === 'sell' ? 'buy' : 'sell') : '');
    });
  }

  let cache = [];
  async function load() {
    const d = await api(`/api/ads?side=${side}&asset=${asset}&pay=${pay}`);
    cache = d.list;
    paint();
  }
  function paint() {
    const iAmBuyer = side === 'sell';   // 商家卖 → 我买
    const box = document.getElementById('adList');
    if (!cache.length) {
      box.innerHTML = `<div class="empty"><div class="big">🪙</div>当前筛选下暂无广告<br><span style="font-size:12px">您可以换个支付方式或发布一个广告</span></div>`;
      return;
    }
    box.innerHTML = cache.map(a => `
      <div class="ad-card">
        <div class="ad-top">
          <div class="ad-m">
            <div class="coin-ic md" style="background:${a.isPlatform ? '#2b66ff1a' : '#ff9f0a1a'};color:${a.isPlatform ? '#2b66ff' : '#ff9f0a'}">${a.isPlatform ? '🛡️' : a.coinIcon}</div>
            <div><div class="ad-name">${esc(a.merchant ? a.merchant.name : '商家')}
              ${a.isPlatform ? '<span class="badge plat">平台</span>' : '<span class="badge vip">认证商家</span>'}</div>
              <div class="muted">成交 ${a.merchant ? a.merchant.done : 0} 单 · ${a.views || 0} 人浏览</div></div>
          </div>
          <div class="ad-price">
            <div class="ap"><span class="rmb">¥</span>${fmt(a.price, a.asset === 'USDT' ? 4 : 0)}</div>
            <div class="muted">每 ${a.asset}</div>
          </div>
        </div>
        <div class="ad-mid">
          <div><span class="muted">限额</span><b>¥${fmt(a.minCny, 0)} ~ ¥${fmt(a.maxCny, 0)}</b></div>
          <div><span class="muted">可交易</span><b>${fmt(a.available, a.asset === 'USDT' ? 2 : 6)} ${a.asset}</b></div>
        </div>
        <div class="ad-bot">
          <div class="ad-pays">${(a.payMethods || []).map(p => `<span class="pay-tag">${PAY_ICONS[p] || p}</span>`).join('')}</div>
          <button class="btn sm ${iAmBuyer ? '' : 'sell'}" data-act="open-ad" data-id="${a.id}">${iAmBuyer ? '买入 ' + a.asset : '卖出 ' + a.asset}</button>
        </div>
      </div>`).join('');
  }
  try { await load(); } catch (e) { /* */ }
  _timer = setInterval(() => api(`/api/ads?side=${side}&asset=${asset}&pay=${pay}`).then(d => { cache = d.list; paint(); }).catch(() => {}), 8000);
}

/* 广告交易弹窗 */
async function openAdModal(adId) {
  if (!requireLogin()) return;
  const d = await api('/api/ads/' + adId);
  const a = d.ad;
  const iAmBuyer = a.side === 'sell';
  showModal(`
    <h3 style="margin-bottom:6px">${iAmBuyer ? '买入' : '卖出'} ${a.asset}</h3>
    <div class="muted" style="margin-bottom:10px">商家 ${esc(a.merchant ? a.merchant.name : '')} · ${a.isPlatform ? '平台官方广告' : '认证商家'}</div>
    <div class="card" style="margin:0 0 12px;box-shadow:0 0 0 1px #f0f0f0">
      <div class="kv"><span class="k">单价</span><span class="v">¥${fmt(a.price, a.asset === 'USDT' ? 4 : 0)} / ${a.asset}</span></div>
      <div class="kv"><span class="k">限额</span><span class="v">¥${fmt(a.minCny, 0)} ~ ¥${fmt(a.maxCny, 0)}</span></div>
      <div class="kv"><span class="k">可交易量</span><span class="v">${fmt(a.available, a.asset === 'USDT' ? 2 : 6)} ${a.asset}</span></div>
      <div class="kv"><span class="k">收款方式</span><span class="v">${(a.payMethods || []).map(p => PAY_ICONS[p]).join('、')}</span></div>
      <div class="kv"><span class="k">广告说明</span><span class="v" style="white-space:pre-wrap">${esc(a.terms || '无')}</span></div>
    </div>
    <div class="form-group"><label>${iAmBuyer ? '买入' : '卖出'}金额（CNY）</label>
      <input id="adCny" type="number" inputmode="decimal" placeholder="输入金额 ¥${fmt(a.minCny, 0)} ~ ¥${fmt(a.maxCny, 0)}"></div>
    <div class="form-group"><label>或输入数量（${a.asset}）</label>
      <input id="adAmt" type="number" inputmode="decimal" placeholder="0.00"></div>
    <button class="btn block" id="adSubmit">${iAmBuyer ? '确认买入，货币托管' : '确认卖出，货币托管'}</button>
    <div class="muted" style="margin-top:8px;line-height:1.7">下单后 ${a.asset} 由平台托管，买家线下转账给卖家后点击"我已付款"，卖家确认收款即放行。</div>`, true);
  const cnyEl = document.getElementById('adCny'), amtEl = document.getElementById('adAmt');
  cnyEl.oninput = () => { if (Number(cnyEl.value) > 0) amtEl.value = fmt(Number(cnyEl.value) / a.price, 6).replace(/,/g, ''); };
  amtEl.oninput = () => { if (Number(amtEl.value) > 0) cnyEl.value = fmt(Number(amtEl.value) * a.price, 2).replace(/,/g, ''); };
  document.getElementById('adSubmit').onclick = async () => {
    try {
      const r = await api('/api/c2c/orders', { method: 'POST', body: { adId: a.id, cny: Number(cnyEl.value) || 0, amount: Number(amtEl.value) || 0 } });
      closeModal();
      toast('下单成功，货币已托管');
      location.hash = '#/c2c-order/' + r.order.id;
    } catch (e) { toast(e.message); }
  };
}

/* ================= C2C 订单详情 ================= */
async function renderC2cOrder(id) {
  if (!requireLogin()) return;
  $view().innerHTML = `<div class="navbar"><button class="back" data-act="back">‹</button>订单详情</div><div id="odBox" class="empty">加载中...</div>`;
  const box = document.getElementById('odBox');

  async function load() {
    const d = await api('/api/c2c/orders/' + id);
    const o = d.order;
    const myRole = state.user.id === o.buyerId ? 'buyer' : (state.user.id === o.sellerId ? 'seller' : 'admin');
    const steps = [
      { k: 'pending_pay', t: '下单·货币托管' },
      { k: 'paid', t: '买家已付款' },
      { k: 'completed', t: '卖家放行·完成' }
    ];
    const stepIdx = o.status === 'completed' ? 2 : o.status === 'paid' || o.status === 'disputed' ? 1 : 0;
    const statusCls = { completed: 'done', closed: 'closed', disputed: 'dis' }[o.status] || 'ing';

    box.innerHTML = `
      <div class="od-status ${statusCls}">
        <div class="os-title">${o.status === 'disputed' ? '⚖️ 平台仲裁中' : STATUS_BADGE(o.status)}
          ${o.status === 'pending_pay' ? `<span class="cd" id="odCd">--:--</span>` : ''}</div>
        <div class="os-steps">
          ${steps.map((s, i) => `<div class="os-step ${i <= stepIdx ? 'on' : ''} ${i === stepIdx && o.status !== 'completed' && o.status !== 'closed' ? 'cur' : ''}">
            <div class="dot">${i + 1}</div><span>${s.t}</span></div>`).join('<i class="os-line"></i>')}
        </div>
      </div>

      <div class="card od-amount">
        <div class="oa-coin"><span class="coin-ic lg" style="background:${o.asset === 'USDT' ? '#26a17b1a' : '#f7931a1a'};color:${o.asset === 'USDT' ? '#26a17b' : '#f7931a'}">${o.coinIcon}</span>
          <b>${fmt(o.amount)} ${o.asset}</b></div>
        <div class="kv"><span class="k">订单金额</span><span class="v" style="font-weight:700;font-size:16px">¥${fmt(o.cny, 2)}</span></div>
        <div class="kv"><span class="k">成交单价</span><span class="v">¥${fmt(o.price, 4)} / ${o.asset}</span></div>
        <div class="kv"><span class="k">订单号</span><span class="v">${o.no}</span></div>
        <div class="kv"><span class="k">交易方向</span><span class="v">${o.adSide === 'sell' ? '商家出售，你买入' : '商家收购，你卖出'}</span></div>
      </div>

      ${d.payInfo ? `
      <div class="card pay-info">
        <h4>💳 付款信息（请线下转账给卖家）</h4>
        <div class="kv"><span class="k">收款方</span><span class="v">${esc(d.payInfo.name)}</span></div>
        <div class="kv"><span class="k">方式</span><span class="v">${o.payMethodIcon} ${o.payMethodName}</span></div>
        <div class="kv"><span class="k">收款账号</span><span class="v" style="word-break:break-all">${esc(d.payInfo.account)}</span></div>
        <div class="warn">⚠️ 请使用本人实名账户转账，转账完成后点击"我已付款"。未收到货前请勿相信任何私下放币要求。</div>
      </div>` : ''}

      ${o.dispute ? `<div class="card dispute-card">
        <h4>⚖️ 申诉信息</h4>
        <div class="kv"><span class="k">发起人</span><span class="v">${o.dispute.byRole === 'buyer' ? '买家' : '卖家'}</span></div>
        <div class="kv"><span class="k">原因</span><span class="v" style="white-space:pre-wrap">${esc(o.dispute.reason)}</span></div>
        ${o.dispute.status === 'closed' ? `<div class="kv"><span class="k">仲裁结果</span><span class="v"><b>${o.dispute.result === 'buyer' ? '买方胜诉，货币放行给买方' : '卖方胜诉，货币退回卖方'}</b></div>
        <div class="kv"><span class="k">备注</span><span class="v">${esc(o.dispute.note || '无')}</span></div>` : '<div class="muted" style="padding-top6px 0">平台客服正在处理，请保持在线</div>'}
      </div>` : ''}

      <div class="card">
        <h4 style="margin-bottom:8px">订单进度</h4>
        ${o.timeline.slice().reverse().map(t => `
          <div class="tl-item"><div class="tl-dot"></div>
            <div><div style="font-size:13px">${esc(t.text)}</div><div class="muted">${fmtTime(t.at)}</div></div></div>`).join('')}
      </div>
      <div style="height:90px"></div>

      <div class="bottom-bar">
        ${actionsHtml(o, myRole)}
      </div>`;

    // 轮询倒计时
    const cd = document.getElementById('odCd');
    if (cd && o.status === 'pending_pay' && o.remainSec != null) {
      let s = o.remainSec;
      cd.textContent = '剩余 ' + fmtCountdown(s);
      _cdTimer = setInterval(() => {
        s--;
        const el = document.getElementById('odCd');
        if (!el || s < 0) { if (_cdTimer) clearInterval(_cdTimer); return; }
        el.textContent = '剩余 ' + fmtCountdown(s);
      }, 1000);
    }
  }
  function STATUS_BADGE(s) {
    return { pending_pay: '⏳ 等待买家付款', paid: '🔒 买家已付款，等待卖家放行', completed: '✅ 交易完成', closed: '❌ 订单已取消', refunded: '↩️ 已退款' }[s] || s;
  }
  function actionsHtml(o, myRole) {
    const btns = [];
    if (o.status === 'pending_pay' && myRole === 'buyer') {
      btns.push(`<button class="btn" data-act="c2c-paid" data-id="${o.id}">我已付款</button>`);
      btns.push(`<button class="btn gray" data-act="c2c-cancel" data-id="${o.id}">取消订单</button>`);
    }
    if (o.status === 'pending_pay' && myRole === 'seller') {
      btns.push(`<button class="btn gray" data-act="c2c-cancel" data-id="${o.id}">取消订单</button>`);
    }
    if (o.status === 'paid' && myRole === 'seller') {
      btns.push(`<button class="btn green" data-act="c2c-release" data-id="${o.id}">确认收款 · 放行${o.asset}</button>`);
      btns.push(`<button class="btn gray" data-act="c2c-dispute" data-id="${o.id}">申诉</button>`);
    }
    if (o.status === 'paid' && myRole === 'buyer') {
      btns.push(`<button class="btn gray" data-act="c2c-dispute" data-id="${o.id}">申诉（未收到放币）</button>`);
    }
    if (!btns.length) btns.push('<a class="btn" href="#/c2c-orders">返回订单列表</a>');
    return btns.join('');
  }
  let _cdTimer = null;
  const oldStop = stopPoll;
  await load();
  _timer = setInterval(async () => { try { await load(); } catch (e) {} }, 4000);
}

/* C2C 订单列表 */
async function renderC2cOrders() {
  if (!requireLogin()) return;
  let role = (new URLSearchParams(location.hash.split('?')[1] || '').get('role')) === 'seller' ? 'seller' : 'buyer';
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>我的法币订单</div>
    <div class="c2c-seg">
      <button class="cs ${role === 'buyer' ? 'on buy' : ''}" data-role="buyer">买入订单</button>
      <button class="cs ${role === 'seller' ? 'on sell' : ''}" data-role="seller">卖出订单</button>
    </div>
    <div id="olBox" class="ad-list"><div class="empty">加载中...</div></div>
    <div style="height:30px"></div>`;
  document.querySelectorAll('.c2c-seg .cs').forEach(b => b.onclick = () => {
    role = b.dataset.role;
    document.querySelectorAll('.c2c-seg .cs').forEach(x => x.className = 'cs ' + (x.dataset.role === role ? 'on ' + (role === 'buyer' ? 'buy' : 'sell') : ''));
    load();
  });
  async function load() {
    const d = await api('/api/c2c/orders?role=' + role);
    const box = document.getElementById('olBox');
    if (!d.list.length) { box.innerHTML = '<div class="empty"><div class="big">📋</div>暂无订单</div>'; return; }
    box.innerHTML = d.list.map(o => `
      <div class="odl-card" data-id="${o.id}">
        <div class="odl-top">
          <b>${o.coinIcon} ${fmt(o.amount)} ${o.asset}</b>
          <span class="odl-st st-${o.status}">${OSTATUS[o.status] || o.status}</span>
        </div>
        <div class="muted" style="margin:6px 0">¥${fmt(o.cny, 2)} · 单价 ¥${fmt(o.price, 4)} · ${o.no}</div>
        <div class="muted">${fmtTime(o.createdAt)}</div>
      </div>`).join('');
    box.querySelectorAll('.odl-card').forEach(el => el.onclick = () => location.hash = '#/c2c-order/' + el.dataset.id);
  }
  await load();
}

/* ================= 发布广告 ================= */
async function renderAdPublish() {
  if (!requireLogin()) return;
  await loadMe();
  const u = state.user;
  if (u.merchantStatus !== 'approved') {
    $view().innerHTML = `
      <div class="navbar"><button class="back" data-act="back">‹</button>发布广告</div>
      <div class="empty" style="padding-top:90px">
        <div class="big">🏪</div>
        <div style="font-size:15px;color:#333;margin-bottom:8px">${u.merchantStatus === 'pending' ? '商家资质审核中' : u.merchantStatus === 'rejected' ? '入驻申请未通过' : '您还不是认证商家'}</div>
        <div class="muted" style="margin-bottom:22px">完成实名 + 商家入驻审核后即可发布法币交易广告</div>
        <a class="btn" href="#/merchant">${u.merchantStatus === 'rejected' ? '重新申请入驻' : '去申请商家入驻'}</a>
      </div>`;
    return;
  }
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>发布法币广告</div>
    <div class="page-head ex-head" style="padding-bottom:16px"><h2>发布交易广告</h2><p>广告发布后，用户可在法币区与您交易，货币全程平台托管</p></div>
    <div class="card" style="margin-top:-6px">
      <div class="form-group"><label>广告类型<em>*</em></label>
        <select id="p-side"><option value="sell">出售（我卖币，用户买入）</option><option value="buy">收购（我买币，用户卖出）</option></select></div>
      <div class="form-group"><label>交易币种<em>*</em></label>
        <select id="p-asset">${C2C_COINS.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
      <div class="form-group"><label>单价（CNY/币）<em>*</em></label><input id="p-price" type="number" inputmode="decimal" placeholder="如 USDT 填 7.22"></div>
      <div class="form-group"><label>广告数量<em>*</em></label><input id="p-total" type="number" inputmode="decimal" placeholder="出售时账户需持有对应货币"></div>
      <div class="form-group"><label>最小交易额（¥）<em>*</em></label><input id="p-min" type="number" inputmode="decimal" placeholder="如 100"></div>
      <div class="form-group"><label>最大交易额（¥）<em>*</em></label><input id="p-max" type="number" inputmode="decimal" placeholder="如 50000"></div>
      <div class="form-group"><label>收款方式<em>*</em></label>
        <div class="pay-pick">
          <label><input type="checkbox" value="alipay" checked> 🅰️ 支付宝</label>
          <label><input type="checkbox" value="wechat" checked> 💚 微信</label>
          <label><input type="checkbox" value="bank" checked> 🏦 银行卡</label>
        </div></div>
      <div class="form-group"><label>广告说明</label><textarea id="p-terms" maxlength="500" placeholder="交易时间、放币速度、注意事项等"></textarea></div>
      <button class="btn block" data-act="ad-submit">发布广告</button>
    </div>
    <div style="height:40px"></div>`;
}

/* 我的广告 */
async function renderMyAds() {
  if (!requireLogin()) return;
  $view().innerHTML = `<div class="navbar"><button class="back" data-act="back">‹</button>我的广告<span class="act" onclick="location.hash='#/ad-publish'">＋ 发布</span></div>
    <div id="myAdBox" class="ad-list"><div class="empty">加载中...</div></div><div style="height:30px"></div>`;
  async function load() {
    const d = await api('/api/my/ads');
    const box = document.getElementById('myAdBox');
    if (!d.list.length) { box.innerHTML = '<div class="empty"><div class="big">📢</div>您还没有发布广告</div>'; return; }
    box.innerHTML = d.list.map(a => `
      <div class="ad-card">
        <div class="ad-top">
          <div class="ad-m">
            <div class="coin-ic md" style="background:#f5f6fa;color:#666">${a.coinIcon}</div>
            <div><div class="ad-name">${a.side === 'sell' ? '出售' : '收购'} ${a.asset}
              <span class="badge ${a.status === 'on' ? 'vip' : 'gray-b'}">${a.status === 'on' ? '进行中' : '已下架'}</span></div>
              <div class="muted">总量 ${fmt(a.total)} · 已成 ${fmt(a.filled)} · 锁定 ${fmt(a.locked)}</div></div>
          </div>
          <div class="ad-price"><div class="ap"><span class="rmb">¥</span>${fmt(a.price, 4)}</div></div>
        </div>
        <div class="ad-bot">
          <div class="ad-pays">${(a.payMethods || []).map(p => `<span class="pay-tag">${PAY_ICONS[p]}</span>`).join('')}</div>
          <div>
            <button class="btn sm gray" data-act="ad-toggle" data-id="${a.id}">${a.status === 'on' ? '下架' : '上架'}</button>
            <button class="btn sm gray" data-act="ad-del" data-id="${a.id}">删除</button>
          </div>
        </div>
      </div>`).join('');
  }
  await load();
}

/* 商家入驻 */
async function renderMerchantApply() {
  if (!requireLogin()) return;
  await loadMe();
  const u = state.user;
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>商家入驻</div>
    ${u.merchantStatus === 'approved' ? `
      <div class="empty" style="padding-top:90px"><div class="big">✅</div>
        <div style="font-size:15px;margin:8px 0">您已是认证商家</div>
        <a class="btn" href="#/ad-publish">去发布广告</a></div>` : `
    <div class="page-head ex-head" style="padding-bottom:20px"><h2>认证商家入驻</h2><p>平台审核资质后即可发布法币买卖广告</p></div>
    <div class="card" style="margin-top:-10px">
      <div class="form-group"><label>联系方式<em>*</em></label><input id="m-contact" placeholder="QQ号 / 微信号"></div>
      <div class="form-group"><label>收款方式<em>*</em></label>
        <div class="pay-pick">
          <label><input type="checkbox" value="alipay" checked> 🅰️ 支付宝</label>
          <label><input type="checkbox" value="wechat" checked> 💚 微信</label>
          <label><input type="checkbox" value="bank" checked> 🏦 银行卡</label>
        </div></div>
      <div class="form-group"><label>OTC 经验说明</label><textarea id="m-exp" placeholder="从事法币交易的经验、日均单量、资金规模等"></textarea></div>
      <button class="btn block" data-act="merchant-apply">提交审核</button>
      ${u.merchantStatus === 'pending' ? '<div class="muted" style="text-align:center;margin-top:10px">⏳ 您的申请正在审核中，请耐心等待</div>' : ''}
      ${u.merchantStatus === 'rejected' ? `<div class="warn" style="margin-top:10px">上次申请未通过：${esc(u.merchantInfo && u.merchantInfo.rejectReason || '资料不完整')}，可修改后重新提交</div>` : ''}
    </div>`}
    <div style="height:40px"></div>`;
}

/* ================= 钱包 ================= */
async function renderWallet() {
  if (!requireLogin()) return;
  $view().innerHTML = `
    <div class="wallet-head">
      <div class="muted" style="color:rgba(255,255,255,.75)">总资产估值（CNY）</div>
      <div class="wh-total" id="whTotal">¥ --</div>
      <div class="wh-rate" id="whRate">USDT/CNY --</div>
      <div class="wh-btns">
        <button class="whb" data-act="deposit"><span>＋</span>充币</button>
        <button class="whb" data-act="withdraw"><span>⇅</span>提币</button>
      </div>
    </div>
    <div class="card" style="margin-top:-14px;position:relative;z-index:2">
      <div id="coinList" class="coin-list"><div class="muted" style="padding:14px 0;text-align:center">加载中...</div></div>
    </div>
    <div class="card">
      <h4 style="margin-bottom:6px">资金明细</h4>
      <div id="txnList"><div class="muted" style="padding:14px 0;text-align:center">加载中...</div></div>
    </div>
    <div style="height:80px"></div>
    <div class="muted" style="text-align:center;padding:0 20px 20px">充提为模拟演示，不产生真实链上转账</div>`;

  const w = await api('/api/wallet');
  document.getElementById('whTotal').textContent = '¥ ' + fmt(w.totalCny, 2);
  document.getElementById('whRate').textContent = 'USDT/CNY ' + fmt(w.rate, 4);
  document.getElementById('coinList').innerHTML = w.coins.map(c => `
    <div class="coin-row">
      <div class="coin-ic" style="background:${c.color}1a;color:${c.color}">${c.icon}</div>
      <div class="cr-info"><div class="cr-name">${esc(c.name)} <span class="muted">${c.coin}</span></div>
        <div class="muted">≈ ¥${fmt(c.cnyValue, 2)}</div></div>
      <div class="cr-bal"><b>${fmt(c.balance, c.coin === 'USDT' ? 2 : 6)}</b><div class="muted">≈ $${fmt(c.usdValue, 2)}</div></div>
    </div>`).join('');
  document.getElementById('txnList').innerHTML = w.txns.length ? w.txns.map(t => `
    <div class="txn-row">
      <div><div style="font-size:13px;font-weight:600">${TXN_NAME[t.type] || t.type} · ${t.coin}</div>
        <div class="muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.note)}</div>
        <div class="muted">${fmtTime(t.at)}</div></div>
      <div style="text-align:right"><b class="${t.amount >= 0 ? 'up' : 'down'}">${t.amount >= 0 ? '+' : ''}${fmt(t.amount)} ${t.coin}</b>
        <div class="muted">余额 ${fmt(t.bal)}</div></div>
    </div>`).join('') : '<div class="muted" style="padding:14px 0;text-align:center">暂无明细</div>';
}

function openCoinModal(kind) {
  const isDeposit = kind === 'deposit';
  showModal(`
    <h3 style="margin-bottom:12px">${isDeposit ? '充币（模拟）' : '提币（模拟）'}</h3>
    <div class="form-group"><label>币种</label>
      <select id="cw-coin">${['USDT', 'BTC', 'ETH', 'SOL', 'BNB'].map(c => `<option>${c}</option>`).join('')}</select></div>
    <div class="form-group"><label>数量</label><input id="cw-amt" type="number" inputmode="decimal" placeholder="0.00"></div>
    ${isDeposit ? '' : '<div class="form-group"><label>提现地址</label><input id="cw-addr" placeholder="0x... 或链上地址"></div>'}
    <button class="btn block" id="cwSubmit">${isDeposit ? '确认充币（即时到账）' : '确认提币'}</button>
    <div class="muted" style="margin-top:8px">${isDeposit ? '演示环境：点击后模拟链上转账即时到账' : '演示环境：提交后模拟广播到区块链'}</div>`, true);
  document.getElementById('cwSubmit').onclick = async () => {
    const coin = document.getElementById('cw-coin').value;
    const amount = Number(document.getElementById('cw-amt').value);
    try {
      if (isDeposit) {
        const r = await api('/api/wallet/deposit', { method: 'POST', body: { coin, amount } });
        toast('充币成功，已到账');
      } else {
        const address = document.getElementById('cw-addr').value;
        const r = await api('/api/wallet/withdraw', { method: 'POST', body: { coin, amount, address } });
        toast('提币已广播（模拟）');
      }
      closeModal();
      router();
    } catch (e) { toast(e.message); }
  };
}

/* ================= 我的 ================= */
async function renderMe() {
  await loadMe();
  if (!state.user) { location.hash = '#/login'; return; }
  const u = state.user;
  const usdt = (u.coins && u.coins.USDT) || 0;
  const mTip = {
    none: ['成为认证商家', '发布法币广告赚收益', '去入驻'],
    pending: ['商家资质审核中', '平台将在1-2个工作日内审核', '查看进度'],
    approved: ['认证商家 ✔', '可发布法币买卖广告', '商家中心'],
    rejected: ['入驻申请未通过', '可补充资料后重新申请', '重新申请'],
    banned: ['商家资格已被封禁', '如有疑问请联系客服', '查看']
  }[u.merchantStatus || 'none'];
  $view().innerHTML = `
    <div class="me-head ex-me">
      <div class="avatar">${u.role === 'admin' ? '🛡️' : '🧑'}</div>
      <div class="info">
        <div class="nm">${esc(u.realName)} <span style="font-size:11px;background:rgba(255,255,255,.25);padding:2px 8px;border-radius:99px">✔ 已实名</span></div>
        <div class="ph">${esc(u.phone)} · ID:${u.id}</div>
      </div>
    </div>
    <div class="me-grid">
      <div class="mi" data-go="#/wallet" style="cursor:pointer"><b>${fmt(usdt, 2)}</b>USDT 资产</div>
      <div class="mi" data-go="#/c2c-orders" style="cursor:pointer"><b>C2C</b>法币订单</div>
      <div class="mi" data-go="#/trade" style="cursor:pointer"><b>现货</b>币币交易</div>
    </div>
    <div class="seller-banner ex-mer ${u.merchantStatus}">
      <div style="font-size:30px">🏪</div>
      <div class="txt"><b>${mTip[0]}</b>${mTip[1]}</div>
      <a class="go" href="${u.merchantStatus === 'approved' ? '#/my-ads' : '#/merchant'}">${mTip[2]}</a>
    </div>
    <div class="menu">
      <div class="mi2" data-go="#/c2c-orders"><span class="icon">💱</span>法币订单<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/my-ads"><span class="icon">📢</span>我的广告<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/trade"><span class="icon">📊</span>现货委托<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/wallet"><span class="icon">👛</span>我的资产 / 充提<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/merchant"><span class="icon">📇</span>商家入驻 / 资质<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/support"><span class="icon">💬</span>联系在线客服<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/live"><span class="icon">🔑</span>实盘交易（币安 API）<span class="arrow">›</span></div>
      ${u.role === 'admin' ? '<div class="mi2" data-go="#/admin"><span class="icon">🛡️</span>平台管理后台<span class="arrow">›</span></div>' : ''}
      <div class="mi2" data-act="logout"><span class="icon">🚪</span>退出登录<span class="arrow">›</span></div>
    </div>
    <div class="muted" style="text-align:center;padding:10px 0 30px">币易 BiYiEx · 模拟盘 · 7×24小时人工仲裁</div>`;
  document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => location.hash = el.dataset.go);
  document.querySelector('[data-act="logout"]').onclick = () => {
    state.token = ''; state.user = null;
    localStorage.removeItem('token');
    toast('已退出登录');
    location.hash = '#/markets';
  };
}

/* ================= 实盘交易（币安 API Key） ================= */
async function renderLive() {
  if (!(await loadMe()) || !state.user) { location.hash = '#/login'; return; }
  let symbol = 'BTCUSDT';
  let side = 'BUY';
  let ordType = 'LIMIT';
  let bal = {};
  let ticker = null;
  let keysStatus = null;

  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>
      <b>实盘交易</b><span id="liveNet" class="src-badge sim" style="margin-left:auto">加载中</span></div>
    <div id="liveBody" style="padding:12px 16px 90px"></div>`;

  async function checkKeys() {
    try { keysStatus = await api('/api/binance/keys'); } catch (e) { keysStatus = { configured: false }; }
    const el = document.getElementById('liveNet');
    if (el) {
      if (!keysStatus.configured) { el.textContent = '未配置'; el.className = 'src-badge sim'; }
      else { el.textContent = (keysStatus.net === 'main' ? '🔴 主网' : '🟡 测试网') + ' ···' + keysStatus.apiKeyTail; el.className = 'src-badge ' + (keysStatus.net === 'main' ? 'sim' : ''); }
    }
  }

  function renderKeyForm() {
    document.getElementById('liveBody').innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-bottom:8px">🔑 配置币安 API Key</h3>
        <p class="muted" style="font-size:12px;margin-bottom:14px">
          仅本人账户，Key 存在本机 keys.json，不传第三方。<br>
          创建 API 时<b>只勾选现货交易</b>，<b>不要勾选提现</b>。
        </p>
        <div class="form-group"><label>API Key</label><input id="lk-api" placeholder="粘贴 API Key"></div>
        <div class="form-group"><label>Secret Key</label><input id="lk-sec" type="password" placeholder="粘贴 Secret Key"></div>
        <div class="form-group"><label>网络</label>
          <select id="lk-net" style="width:100%;padding:10px;border:1px solid #e0e3eb;border-radius:8px">
            <option value="test">测试网（testnet，无需翻墙，用于测试）</option>
            <option value="main">主网（需翻墙，真实交易）</option>
          </select></div>
        <button class="btn block" id="lkSave" style="margin-top:8px">保存 API Key</button>
        <details style="margin-top:14px"><summary class="muted" style="font-size:12px;cursor:pointer">如何获取币安 API Key？</summary>
          <div class="muted" style="font-size:12px;padding:8px 0;line-height:1.7">
            1. 登录币安 App →「我的」→「API 管理」<br>
            2. 点「创建 API」→ 选「系统性交易」<br>
            3. 完成安全验证（邮箱+手机）<br>
            4. <b>只勾选「现货交易」</b>，不勾「提现」<br>
            5. 复制 API Key 和 Secret Key 填入上方<br>
            6. 测试网 Key 从 testnet.binance.vision 注册
          </div></details>
      </div>`;
    document.getElementById('lkSave').onclick = async () => {
      const apiKey = document.getElementById('lk-api').value.trim();
      const secret = document.getElementById('lk-sec').value.trim();
      const net = document.getElementById('lk-net').value;
      if (!apiKey || !secret) return toast('请填写 API Key 和 Secret Key');
      try {
        await api('/api/binance/keys', { method: 'POST', body: { apiKey, secret, net } });
        toast('API Key 已保存');
        await checkKeys(); await render();
      } catch (e) { toast(e.message); }
    };
  }

  function renderTrade() {
    document.getElementById('liveBody').innerHTML = `
      <div class="card" style="margin-bottom:10px;padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b style="font-size:16px">${symbol}</b>
          <span class="muted" style="font-size:12px">切换</span></div>
        <div id="liveTicker" style="font-size:13px;color:var(--sub)">加载行情...</div>
      </div>
      <div class="card" style="margin-bottom:10px">
        <div class="tt-seg" style="display:flex;margin-bottom:10px">
          <button class="tt ${side === 'BUY' ? 'on buy' : ''}" id="lvBuy" style="flex:1;padding:10px;border:none;border-radius:8px 0 0 8px;font-weight:600;cursor:pointer">买入</button>
          <button class="tt ${side === 'SELL' ? 'on sell' : ''}" id="lvSell" style="flex:1;padding:10px;border:none;border-radius:0 8px 8px 0;font-weight:600;cursor:pointer">卖出</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <button class="ty ${ordType === 'LIMIT' ? 'on' : ''}" id="lvLimit" style="flex:1;padding:8px;border:1px solid #e0e3eb;border-radius:8px;background:${ordType==='LIMIT'?'#2b66ff':'#fff'};color:${ordType==='LIMIT'?'#fff':'#666'};font-weight:600;cursor:pointer">限价</button>
          <button class="ty ${ordType === 'MARKET' ? 'on' : ''}" id="lvMarket" style="flex:1;padding:8px;border:1px solid #e0e3eb;border-radius:8px;background:${ordType==='MARKET'?'#2b66ff':'#fff'};color:${ordType==='MARKET'?'#fff':'#666'};font-weight:600;cursor:pointer">市价</button>
        </div>
        ${ordType === 'LIMIT' ? `<div class="f-row"><label>委托价格</label><div class="f-in"><input id="lvPrice" type="number" inputmode="decimal" placeholder="0.00"><span>USDT</span></div></div>` : ''}
        <div class="f-row"><label>交易数量</label><div class="f-in"><input id="lvQty" type="number" inputmode="decimal" placeholder="0.00"><span>${symbol.replace('USDT','')}</span></div></div>
        <div class="f-row avail" id="lvAvail">可用 --</div>
        <button class="btn block trade-btn ${side === 'BUY' ? 'buy' : 'sell'}" id="lvSubmit" style="margin-top:10px">${side === 'BUY' ? '买入' : '卖出'} ${symbol}</button>
      </div>
      <div class="card" style="margin-bottom:10px">
        <div class="oo-head"><b>当前委托</b><span class="muted" style="cursor:pointer" id="lvRefresh">刷新 ›</span></div>
        <div id="lvOrders"><div class="muted" style="padding:14px 0;text-align:center">加载中...</div></div>
      </div>
      <div class="card">
        <div class="oo-head"><b>最近成交</b></div>
        <div id="lvHistory"><div class="muted" style="padding:14px 0;text-align:center">加载中...</div></div>
      </div>
      <div style="text-align:center;margin-top:14px">
        <button class="btn sm gray" id="lvDelKey" style="color:#f53f3f">删除 API Key</button>
      </div>`;
    document.getElementById('lvBuy').onclick = () => { side = 'BUY'; renderTrade(); };
    document.getElementById('lvSell').onclick = () => { side = 'SELL'; renderTrade(); };
    document.getElementById('lvLimit').onclick = () => { ordType = 'LIMIT'; renderTrade(); };
    document.getElementById('lvMarket').onclick = () => { ordType = 'MARKET'; renderTrade(); };
    document.getElementById('lvRefresh').onclick = () => { loadOrders(); loadTicker(); };
    document.getElementById('lvDelKey').onclick = async () => {
      if (!confirm('确认删除 API Key？删除后无法实盘交易。')) return;
      await api('/api/binance/keys', { method: 'DELETE' });
      toast('已删除 API Key'); await checkKeys(); render();
    };
    document.getElementById('lvSubmit').onclick = async () => {
      const qty = document.getElementById('lvQty').value;
      if (!qty || Number(qty) <= 0) return toast('请输入交易数量');
      const params = { symbol, side, type: ordType, quantity: qty };
      if (ordType === 'LIMIT') {
        params.price = document.getElementById('lvPrice').value;
        if (!params.price) return toast('请输入委托价格');
      }
      const warn = ordType === 'MARKET' ? `市价${side === 'BUY' ? '买入' : '卖出'} ${qty} ${symbol}，将按市场最优价成交。` : `限价${side === 'BUY' ? '买入' : '卖出'} ${qty} ${symbol}。`;
      if (!confirm(warn + '\n\n⚠️ 这是真实订单！确认提交？')) return;
      try {
        const r = await api('/api/binance/order', { method: 'POST', body: params });
        toast(`下单成功 #${r.order.id} 状态:${r.order.status}`);
        loadOrders(); loadBal();
      } catch (e) { toast('下单失败: ' + e.message); }
    };
    loadTicker(); loadBal(); loadOrders();
  }

  async function loadTicker() {
    try {
      ticker = await api('/api/binance/ticker/' + symbol);
      const el = document.getElementById('liveTicker');
      if (el) el.innerHTML = `最新价 <b class="${ticker.change >= 0 ? 'up' : 'down'}">${fmt(ticker.price)}</b>　24h ${chgTxt(ticker.change)}　高 ${fmt(ticker.high)}　低 ${fmt(ticker.low)}`;
      if (ordType === 'LIMIT') { const p = document.getElementById('lvPrice'); if (p && !p.value) p.value = ticker.price; }
    } catch (e) { const el = document.getElementById('liveTicker'); if (el) el.textContent = '行情获取失败（' + e.message + '）'; }
  }
  async function loadBal() {
    try {
      const d = await api('/api/binance/account');
      bal = {};
      d.balances.forEach(b => { bal[b.asset] = parseFloat(b.free); });
      const el = document.getElementById('lvAvail');
      if (el) el.textContent = side === 'BUY' ? `可用 ${fmt(bal.USDT || 0, 2)} USDT` : `可用 ${fmt(bal[symbol.replace('USDT','')] || 0, 6)} ${symbol.replace('USDT','')}`;
    } catch (e) { /* 忽略 */ }
  }
  async function loadOrders() {
    try {
      const d = await api('/api/binance/orders?symbol=' + symbol);
      const ob = document.getElementById('lvOrders');
      if (ob) ob.innerHTML = d.open.length ? d.open.map(o => `
        <div class="order-card" style="padding:10px 0;border-bottom:1px solid #f5f6f8">
          <div style="display:flex;justify-content:space-between">
            <span class="${o.side === 'BUY' ? 'up' : 'down'}">${o.side === 'BUY' ? '买' : '卖'} ${o.symbol}</span>
            <span class="muted">${o.type} ${fmt(o.price)}</span>
            <button class="btn sm gray" data-oid="${o.orderId}" style="padding:4px 10px;font-size:11px">撤单</button>
          </div>
          <div class="muted" style="font-size:12px">数量 ${o.origQty}　已成交 ${o.executedQty}</div>
        </div>`).join('') : '<div class="muted" style="padding:10px;text-align:center">无委托</div>';
      ob.querySelectorAll('[data-oid]').forEach(b => b.onclick = async () => {
        if (!confirm('确认撤销此委托？')) return;
        try { await api('/api/binance/order/' + b.dataset.oid + '/cancel', { method: 'POST', body: { symbol } }); toast('已撤单'); loadOrders(); } catch (e) { toast(e.message); }
      });
      const hb = document.getElementById('lvHistory');
      if (hb) hb.innerHTML = d.history.length ? d.history.map(t => `
        <div class="trd-row" style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f6f8;font-size:12px">
          <span class="${t.isBuyer ? 'up' : 'down'}">${t.isBuyer ? '买' : '卖'}</span>
          <span>${fmt(parseFloat(t.price))} × ${t.qty}</span>
          <span class="muted">${fmt(parseFloat(t.quoteQty))} USDT</span>
        </div>`).join('') : '<div class="muted" style="padding:10px;text-align:center">无成交记录</div>';
    } catch (e) { /* 忽略 */ }
  }

  async function render() { if (keysStatus && keysStatus.configured) renderTrade(); else renderKeyForm(); }
  await checkKeys();
  await render();
  // 选择交易对
  document.querySelector('#liveBody [style*="cursor:pointer"]')?.addEventListener('click', () => {
    const pairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT'];
    showModal(`<h3 style="margin-bottom:12px">选择交易对</h3>
      <div class="sym-list">${pairs.map(p => `<div class="sym-item" data-pick="${p}"><b>${p}</b></div>`).join('')}</div>`, true);
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => { closeModal(); symbol = el.dataset.pick; renderTrade(); });
  });
  // 轮询
  _timer = setInterval(() => { if (keysStatus && keysStatus.configured) { loadTicker(); loadOrders(); } }, 5000);
}

/* ================= 登录 / 注册 ================= */
function renderLogin() {
  $view().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-head ex-auth"><div class="logo">◆ 币易 BiYiEx</div><p>现货交易 · 法币C2C · 数字资产钱包（模拟盘）</p></div>
      <div class="auth-card">
        <div class="form-group"><label>手机号</label><input id="lg-phone" placeholder="请输入手机号" value="13900000002"></div>
        <div class="form-group"><label>密码</label><input id="lg-pw" type="password" placeholder="请输入密码" value="buyer123"></div>
        <button class="btn block" data-act="do-login">登 录</button>
        <div class="auth-switch">还没有账号？<a href="#/register">实名注册</a></div>
        <div class="tip" style="margin-top:14px;line-height:1.9">演示账号：<br>管理员 13800000000 / admin123<br>认证商家 13900000001 / seller123<br>普通用户 13900000002 / buyer123</div>
      </div>
    </div>`;
  document.querySelector('[data-act="do-login"]').onclick = async () => {
    try {
      const r = await api('/api/login', { method: 'POST', body: { phone: document.getElementById('lg-phone').value.trim(), password: document.getElementById('lg-pw').value } });
      state.token = r.token; state.user = r.user;
      localStorage.setItem('token', r.token);
      toast('登录成功');
      location.hash = '#/markets';
    } catch (e) { toast(e.message); }
  };
}
function renderRegister() {
  $view().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-head ex-auth"><div class="logo">实名注册</div><p>实名信息仅用于交易风控与资质审核，平台加密存储</p></div>
      <div class="auth-card">
        <div class="form-group"><label>手机号<em>*</em></label><input id="rg-phone" placeholder="11位手机号" maxlength="11"></div>
        <div class="form-group"><label>登录密码<em>*</em></label><input id="rg-pw" type="password" placeholder="至少6位"></div>
        <div class="form-group"><label>真实姓名<em>*</em></label><input id="rg-name" placeholder="与身份证一致"></div>
        <div class="form-group"><label>身份证号<em>*</em></label><input id="rg-id" placeholder="18位身份证号" maxlength="18"></div>
        <div class="tip" style="margin-bottom:12px">📌 注册即完成实名认证；发布法币广告需再提交「商家入驻」审核</div>
        <button class="btn block" data-act="do-register">注册并登录</button>
        <div class="auth-switch">已有账号？<a href="#/login">直接登录</a></div>
      </div>
    </div>`;
  document.querySelector('[data-act="do-register"]').onclick = async () => {
    try {
      const r = await api('/api/register', { method: 'POST', body: {
        phone: document.getElementById('rg-phone').value.trim(),
        password: document.getElementById('rg-pw').value,
        realName: document.getElementById('rg-name').value.trim(),
        idCard: document.getElementById('rg-id').value.trim()
      } });
      state.token = r.token; state.user = r.user;
      localStorage.setItem('token', r.token);
      toast('注册成功，已完成实名');
      location.hash = '#/me';
    } catch (e) { toast(e.message); }
  };
}

/* ================= 在线客服 ================= */
function mountChat(rootEl, { fetchMsgs, sendMsg, selfSide, placeholder }) {
  rootEl.innerHTML = `
    <div class="chat-msgs" id="chatMsgs"><div class="muted" style="text-align:center;padding:20px">加载中...</div></div>
    <div class="chat-input">
      <input id="chatText" placeholder="${esc(placeholder || '请输入消息…')}" maxlength="1000">
      <button class="btn" id="chatSend">发送</button>
    </div>`;
  const msgsEl = rootEl.querySelector('#chatMsgs');
  const inputEl = rootEl.querySelector('#chatText');
  let knownCount = 0;
  function render(msgs) {
    msgsEl.innerHTML = msgs.length ? msgs.map(m => `
      <div class="bubble-row ${m.from === selfSide ? 'me' : 'other'}">
        <div class="avatar">${m.from === 'admin' ? '🎧' : '🙋'}</div>
        <div class="bubble">${esc(m.content)}<div class="btime">${fmtTime(m.at)}</div></div>
      </div>`).join('') : '<div class="muted" style="text-align:center;padding:30px">暂无消息，发一条开始咨询吧</div>';
    if (msgs.length !== knownCount) { msgsEl.scrollTop = msgsEl.scrollHeight; knownCount = msgs.length; }
  }
  async function refresh() { try { const d = await fetchMsgs(); render(d.messages || []); } catch (e) {} }
  async function doSend() {
    const content = inputEl.value.trim();
    if (!content) return;
    inputEl.value = '';
    try { await sendMsg(content); await refresh(); } catch (e) { toast(e.message); }
  }
  rootEl.querySelector('#chatSend').onclick = doSend;
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  refresh();
  stopChatPoll();
  _chatTimer = setInterval(refresh, 3000);
}
async function renderSupport() {
  if (!requireLogin()) return;
  stopChatPoll();
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>在线客服</div>
    <div id="chatRoot" class="chat-page"></div>`;
  mountChat(document.getElementById('chatRoot'), {
    selfSide: 'user',
    placeholder: '描述你遇到的问题，客服将尽快回复…',
    fetchMsgs: () => api('/api/support/conversation'),
    sendMsg: (content) => api('/api/support/messages', { method: 'POST', body: { content } })
  });
}

/* ================= 管理后台 ================= */
async function renderAdmin() {
  if (!requireLogin()) return;
  await loadMe();
  if (state.user.role !== 'admin') { toast('无管理员权限'); location.hash = '#/markets'; return; }
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  let tab = params.get('tab') || 'overview';
  $view().innerHTML = `
    <div class="navbar">🛡️ 平台管理后台</div>
    <div class="admin-stat" id="adminStat"></div>
    <div class="tabs" id="adminTabs">
      ${[['overview', '总览'], ['funds', '用户资产'], ['merchants', '商家审核'], ['ads', '广告管理'], ['disputes', '纠纷仲裁'], ['support', '客服']]
        .map(([k, n]) => `<div class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${n}</div>`).join('')}
    </div>
    <div id="admin-body"></div>`;

  async function loadStat() {
    try {
      const s = await api('/api/admin/overview');
      document.getElementById('adminStat').innerHTML = `
        <div><b>${s.users}</b><span>注册用户</span></div>
        <div><b>¥${fmt(s.escrowCny, 0)}</b><span>托管中资金</span></div>
        <div><b class="${s.pendingMerchants ? 'down' : ''}">${s.pendingMerchants}</b><span>待审商家</span></div>
        <div><b class="${s.openDisputes ? 'down' : ''}">${s.openDisputes}</b><span>待处理纠纷</span></div>`;
    } catch (e) {}
  }
  const body = document.getElementById('admin-body');
  async function switchTab(t) {
    tab = t;
    document.querySelectorAll('#adminTabs .tab').forEach(el => el.classList.toggle('on', el.dataset.tab === t));
    if (t === 'overview') renderOverview();
    if (t === 'funds') renderFunds();
    if (t === 'merchants') renderMerchants();
    if (t === 'ads') renderAds();
    if (t === 'disputes') renderDisputes();
    if (t === 'support') renderSupportAdmin();
  }
  document.querySelectorAll('#adminTabs .tab').forEach(el => el.onclick = () => switchTab(el.dataset.tab));
  // 全局委托（document 点击事件在 renderAdmin 作用域外，需暴露到 window）
  window._openAdjust = openAdjustModal;
  window._openTxns = openTxnsModal;
  window._openAdEditor = openAdEditor;

  async function renderOverview() {
    const s = await api('/api/admin/overview');
    body.innerHTML = `
      <div class="card"><h4 style="margin-bottom:12px">平台数据总览</h4>
        <div class="ov-grid">
          <div><b>${s.users}</b><span>注册用户</span></div>
          <div><b>${s.ads}</b><span>广告总数</span></div>
          <div><b>${s.onSale}</b><span>进行中广告</span></div>
          <div><b>${s.orders}</b><span>C2C订单数</span></div>
          <div><b>${fmt(s.escrowUsdt, 0)}</b><span>托管中(USDT)</span></div>
          <div><b>¥${fmt(s.escrowCny, 0)}</b><span>托管中(CNY)</span></div>
          <div><b>$${fmt(s.spotVol, 0)}</b><span>现货成交额(USDT)</span></div>
          <div><b>${s.pendingMerchants}</b><span>待审商家</span></div>
          <div><b class="${s.openDisputes ? 'down' : ''}">${s.openDisputes}</b><span>待处理纠纷</span></div>
        </div></div>
      <div class="card"><h4>系统状态</h4>
        <div class="kv"><span class="k">行情引擎</span><span class="v ${s.quoteSource === 'sim' ? '' : 'up'}">● ${s.quoteSource === 'okx' ? 'OKX 欧易实时行情（5秒刷新）' : s.quoteSource === 'binance' ? 'Binance 实时行情（5秒刷新）' : '模拟行情运行中（实时接口不可用）'}</span></div>
        <div class="kv"><span class="k">撮合引擎</span><span class="v up">● 现货限价单自动撮合（模拟成交）</span></div>
        <div class="kv"><span class="k">担保机制</span><span class="v">C2C 货币托管 + 超时自动退回（模拟资金）</span></div>
      </div>`;
  }

  async function renderFunds() {
    body.innerHTML = `
      <div style="padding:12px 16px 4px"><div class="searchbar" style="margin:0">🔍<input id="fundKw" placeholder="搜索手机号 / 姓名 / 用户ID"></div></div>
      <div id="fundList" style="padding:8px 12px"><div class="muted" style="padding:20px;text-align:center">加载中...</div></div>`;
    async function load() {
      const kw = document.getElementById('fundKw').value.trim();
      const d = await api('/api/admin/users?kw=' + encodeURIComponent(kw));
      document.getElementById('fundList').innerHTML = d.list.length ? d.list.map(u => `
        <div class="order-card fund-card">
          <div class="fc-top"><b>${esc(u.realName)}</b>
            <span class="tag ${u.role === 'admin' ? 'gold' : 'gray-b'}">${u.role === 'admin' ? '管理员' : '用户'}</span>
            <span class="muted" style="margin-left:auto">${u.phone}</span></div>
          <div class="fc-stats">
            <div><span class="muted">USDT</span><b>${fmt(u.usdt, 2)}</b></div>
            <div><span class="muted">资产估值</span><b>¥${fmt(u.cnyValue, 2)}</b></div>
            <div><span class="muted">C2C订单</span><b>${u.orderCount}</b></div>
          </div>
          <div class="fc-btns">
            ${u.role === 'admin' ? '' : `
            <button class="btn sm" data-act="adjust" data-id="${u.id}" data-name="${esc(u.realName)}" data-dir="add">＋ 增加资产</button>
            <button class="btn sm gray" data-act="adjust" data-id="${u.id}" data-name="${esc(u.realName)}" data-dir="sub">－ 扣减资产</button>`}
            <button class="btn sm blue" data-act="user-txns" data-id="${u.id}" data-name="${esc(u.realName)}">资金流水</button>
          </div>
        </div>`).join('') : '<div class="empty">🔍 没有匹配的用户</div>';
    }
    let t;
    document.getElementById('fundKw').oninput = () => { clearTimeout(t); t = setTimeout(load, 400); };
    await load();
  }

  function openAdjustModal(d, dir) {
    showModal(`
      <h3 style="margin-bottom:10px">${dir === 'add' ? '增加' : '扣减'}资产 - ${esc(d.name)}</h3>
      <div class="form-group"><label>币种</label>
        <select id="aj-coin"><option>USDT</option><option>BTC</option><option>ETH</option></select></div>
      <div class="form-group"><label>${dir === 'add' ? '增加' : '扣减'}数量</label>
        <input id="aj-amt" type="number" inputmode="decimal" placeholder="0.00"></div>
      <div class="form-group"><label>备注</label><input id="aj-remark" placeholder="如：活动奖励 / 异常冲正"></div>
      <button class="btn block" id="ajSubmit">确认${dir === 'add' ? '增加' : '扣减'}</button>`, true);
    document.getElementById('ajSubmit').onclick = async () => {
      try {
        const r = await api(`/api/admin/users/${d.id}/balance`, {
          method: 'POST',
          body: { coin: document.getElementById('aj-coin').value, amount: (dir === 'add' ? 1 : -1) * Math.abs(Number(document.getElementById('aj-amt').value)), remark: document.getElementById('aj-remark').value }
        });
        toast(`已${dir === 'add' ? '增加' : '扣减'}，最新余额 ${r.balance}`);
        closeModal();
        renderFunds();
      } catch (e) { toast(e.message); }
    };
  }
  async function openTxnsModal(uid, name) {
    const d = await api(`/api/admin/users/${uid}/txns`);
    showModal(`
      <h3 style="margin-bottom:10px">${esc(name)} 的资金流水</h3>
      <div style="max-height:55vh;overflow-y:auto">
        ${d.txns.length ? d.txns.map(t => `
          <div class="txn-row" style="padding:9px 0;border-bottom:1px solid #f2f2f2">
            <div><div style="font-size:13px;font-weight:600">${TXN_NAME[t.type] || t.type} · ${t.coin}</div>
              <div class="muted">${esc(t.note)}</div><div class="muted">${fmtTime(t.at)}</div></div>
            <b class="${t.amount >= 0 ? 'up' : 'down'}">${t.amount >= 0 ? '+' : ''}${fmt(t.amount)}</b>
          </div>`).join('') : '<div class="empty">暂无流水</div>'}
      </div>`, true);
  }

  async function renderMerchants() {
    const d = await api('/api/admin/merchants');
    const stMap = { pending: ['待审核', 'gold'], approved: ['已通过', 'green'], rejected: ['已驳回', 'gray-b'], banned: ['已封禁', 'red'] };
    body.innerHTML = d.list.length ? d.list.map(u => `
      <div class="order-card audit-card">
        <div class="fc-top"><b>${esc(u.realName)}</b>
          <span class="badge ${stMap[u.status][1]}">${stMap[u.status][0]}</span>
          <span class="muted" style="margin-left:auto">${fmtTime(u.merchantInfo && u.merchantInfo.appliedAt).slice(0, 16)}</span></div>
        <div class="muted" style="line-height:1.9;margin:6px 0">
          📱 ${u.phone}　🆔 ${u.idCard}<br>
          📞 ${esc(u.merchantInfo && u.merchantInfo.contact || '')}<br>
          💳 ${(u.merchantInfo && u.merchantInfo.payMethods || []).map(p => PAY_ICONS[p]).join('、')}<br>
          📝 ${esc(u.merchantInfo && u.merchantInfo.experience || '')}<br>
          💰 USDT ${fmt(u.usdt, 2)} · 广告 ${u.adCount} 条
          ${u.status === 'rejected' ? `<br>❌ 驳回原因：${esc(u.merchantInfo && u.merchantInfo.rejectReason || '')}` : ''}
        </div>
        ${u.status === 'pending' ? `
        <div class="fc-btns">
          <button class="btn sm green" data-act="audit-merchant" data-id="${u.id}" data-approve="1">审核通过</button>
          <button class="btn sm gray" data-act="audit-merchant" data-id="${u.id}" data-approve="0">驳回</button>
        </div>` : ''}
      </div>`).join('') : '<div class="empty">暂无商家申请</div>';
  }

  async function renderAds() {
    const d = await api('/api/admin/ads');
    body.innerHTML = `
      <div style="padding:12px 16px"><button class="btn sm" data-act="ad-new">＋ 发布平台广告</button></div>
      ${d.list.length ? d.list.map(a => `
        <div class="order-card ad-admin-card">
          <div class="fc-top">
            <b>${a.side === 'sell' ? '出售' : '收购'} ${a.asset}</b>
            <span class="badge ${a.isPlatform ? 'plat' : 'vip'}">${a.isPlatform ? '平台' : '商家'}</span>
            <span class="badge ${a.status === 'on' ? 'green' : 'gray-b'}">${a.status === 'on' ? '进行中' : '已下架'}</span>
            <span class="muted" style="margin-left:auto">${esc(a.merchantName)}</span></div>
          <div class="muted" style="line-height:1.9;margin:6px 0">
            单价 ¥${fmt(a.price, 4)} · 总量 ${fmt(a.total)} · 可交易 ${fmt(a.available)}<br>
            限额 ¥${fmt(a.minCny, 0)} ~ ¥${fmt(a.maxCny, 0)} · ${(a.payMethods || []).map(p => PAY_ICONS[p]).join('、')}
          </div>
          <div class="fc-btns">
            <button class="btn sm gray" data-act="admin-ad-toggle" data-id="${a.id}">${a.status === 'on' ? '下架' : '上架'}</button>
            <button class="btn sm gray" data-act="admin-ad-del" data-id="${a.id}">删除</button>
          </div>
        </div>`).join('') : '<div class="empty">暂无广告</div>'}`;
  }

  function openAdEditor(existing) {
    const a = existing || { side: 'sell', asset: 'USDT', price: '', total: '', minCny: '', maxCny: '', payMethods: ['alipay', 'wechat', 'bank'], terms: '', status: 'on' };
    showModal(`
      <h3 style="margin-bottom:10px">${existing ? '编辑广告' : '发布平台广告'}</h3>
      <div class="form-group"><label>类型</label><select id="ea-side">
        <option value="sell" ${a.side === 'sell' ? 'selected' : ''}>出售</option>
        <option value="buy" ${a.side === 'buy' ? 'selected' : ''}>收购</option></select></div>
      <div class="form-group"><label>币种</label><select id="ea-asset">
        ${C2C_COINS.map(c => `<option value="${c}" ${a.asset === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label>单价(CNY)</label><input id="ea-price" type="number" value="${a.price}"></div>
      <div class="form-group"><label>数量</label><input id="ea-total" type="number" value="${existing ? a.total : ''}"></div>
      <div class="form-group"><label>最小交易额</label><input id="ea-min" type="number" value="${a.minCny}"></div>
      <div class="form-group"><label>最大交易额</label><input id="ea-max" type="number" value="${a.maxCny}"></div>
      <div class="form-group"><label>收款方式</label><div class="pay-pick">
        <label><input type="checkbox" value="alipay" ${(a.payMethods || []).includes('alipay') ? 'checked' : ''}> 支付宝</label>
        <label><input type="checkbox" value="wechat" ${(a.payMethods || []).includes('wechat') ? 'checked' : ''}> 微信</label>
        <label><input type="checkbox" value="bank" ${(a.payMethods || []).includes('bank') ? 'checked' : ''}> 银行卡</label></div></div>
      <div class="form-group"><label>说明</label><textarea id="ea-terms">${esc(a.terms || '')}</textarea></div>
      <button class="btn block" id="eaSubmit">${existing ? '保存' : '发布'}</button>`, true);
    document.getElementById('eaSubmit').onclick = async () => {
      const payload = {
        side: document.getElementById('ea-side').value,
        asset: document.getElementById('ea-asset').value,
        price: Number(document.getElementById('ea-price').value),
        total: Number(document.getElementById('ea-total').value),
        minCny: Number(document.getElementById('ea-min').value),
        maxCny: Number(document.getElementById('ea-max').value),
        payMethods: Array.from(document.querySelectorAll('.modal .pay-pick input:checked')).map(x => x.value).filter(x => ['alipay', 'wechat', 'bank'].includes(x)),
        terms: document.getElementById('ea-terms').value
      };
      try {
        if (existing) await api('/api/admin/ads/' + existing.id, { method: 'PUT', body: payload });
        else await api('/api/admin/ads', { method: 'POST', body: payload });
        toast(existing ? '已保存' : '已发布');
        closeModal(); renderAds();
      } catch (e) { toast(e.message); }
    };
  }

  async function renderDisputes() {
    const d = await api('/api/admin/disputes');
    body.innerHTML = d.list.length ? d.list.map(o => `
      <div class="order-card dispute-admin-card">
        <div class="fc-top"><b>${o.coinIcon} ${fmt(o.amount)} ${o.asset}（¥${fmt(o.cny, 2)}）</b>
          <span class="badge ${o.dispute.status === 'open' ? 'red' : 'gray-b'}">${o.dispute.status === 'open' ? '待仲裁' : '已结案'}</span></div>
        <div class="muted" style="line-height:1.9;margin:6px 0">
          订单号：${o.no}<br>
          买家：${esc(o.buyerName)}　卖家：${esc(o.sellerName)}<br>
          发起人：${o.dispute.byRole === 'buyer' ? '买家' : '卖家'}　时间：${fmtTime(o.dispute.at)}<br>
          申诉理由：${esc(o.dispute.reason)}
          ${o.dispute.status === 'closed' ? `<br>仲裁结果：<b>${o.dispute.result === 'buyer' ? '买方胜诉·放行货币' : '卖方胜诉·退回货币'}</b>　备注：${esc(o.dispute.note)}` : ''}
        </div>
        ${o.dispute.status === 'open' ? `
        <div class="fc-btns">
          <button class="btn sm green" data-act="arbitrate" data-id="${o.id}" data-ruling="buyer">判买方胜诉·放行</button>
          <button class="btn sm gray" data-act="arbitrate" data-id="${o.id}" data-ruling="seller">判卖方胜诉·退回</button>
        </div>` : ''}
      </div>`).join('') : '<div class="empty">暂无纠纷申诉</div>';
  }

  async function renderSupportAdmin(box) {
    let inList = true, listRun = 0;
    async function showList() {
      const myRun = ++listRun;
      inList = true; stopChatPoll();
      let list = [];
      try { ({ list } = await api('/api/admin/support/conversations')); } catch (e) { return; }
      if (!inList || myRun !== listRun) return;
      body.innerHTML = `
        <div class="muted" style="padding:12px 16px 4px">共 ${list.length} 个用户会话，红点表示未读消息</div>
        ${list.length ? list.map(c => `
        <div class="conv-item" data-conv="${c.id}">
          <div class="avatar">🙋</div>
          <div class="conv-main">
            <div class="conv-hd"><b>${esc(c.userName)}</b><span class="muted">${fmtTime(c.lastAt)}</span></div>
            <div class="conv-msg">${esc(c.lastMsg || '（暂无消息）')}</div>
            <div class="muted conv-phone">📱 ${esc(c.userPhone)}</div>
          </div>
          ${c.unread ? `<span class="unread-badge">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
        </div>`).join('') : '<div class="empty"><div class="big">💬</div>暂无用户咨询</div>'}`;
      body.querySelectorAll('[data-conv]').forEach(el => el.onclick = () => openConv(el.dataset.conv));
      _chatTimer = setInterval(() => showList(true), 3000);
    }
    function openConv(id) {
      inList = false; listRun++; stopChatPoll();
      body.innerHTML = `
        <div class="conv-subhd"><button class="back" id="convBack">‹</button><span id="convTitle">客服会话</span></div>
        <div id="adminChatRoot" class="chat-page"></div>`;
      document.getElementById('convBack').onclick = () => showList();
      mountChat(document.getElementById('adminChatRoot'), {
        selfSide: 'admin',
        placeholder: '输入回复内容，发送后用户可实时看到…',
        fetchMsgs: async () => {
          const d = await api('/api/admin/support/conversations/' + id);
          const t = document.getElementById('convTitle');
          if (t) t.textContent = '💬 ' + (d.conv.userName || '用户') + ' ' + (d.conv.userPhone || '');
          return d;
        },
        sendMsg: (content) => api('/api/admin/support/conversations/' + id + '/messages', { method: 'POST', body: { content } })
      });
    }
    await showList();
  }

  await loadStat();
  await switchTab(tab);
}

/* ================= 全局动作 ================= */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close-modal') return closeModal();
  if (act === 'back') return history.back();

  if (act === 'logout') return; // 各页面自行绑定
  if (act === 'spot-cancel') {
    try { await api('/api/spot/orders/' + el.dataset.id + '/cancel', { method: 'POST' }); toast('已撤单'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (act === 'open-ad') return openAdModal(el.dataset.id);
  if (act === 'c2c-paid') {
    if (!confirm('请确认您已通过线下方式向卖家付款！确认后将通知卖家放行货币。')) return;
    try { await api('/api/c2c/orders/' + el.dataset.id + '/mark-paid', { method: 'POST' }); toast('已通知卖家，请等待放行'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (act === 'c2c-release') {
    if (!confirm('请确认您的银行/支付宝/微信已收到买家货款！确认后平台将把托管货币放行给买家，不可撤销。')) return;
    try { await api('/api/c2c/orders/' + el.dataset.id + '/release', { method: 'POST' }); toast('已放行，交易完成'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (act === 'c2c-cancel') {
    if (!confirm('确定取消该订单吗？托管货币将退回卖方。')) return;
    try { await api('/api/c2c/orders/' + el.dataset.id + '/cancel', { method: 'POST' }); toast('订单已取消'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (act === 'c2c-dispute') {
    const reason = prompt('请详细描述申诉原因（至少5个字）：');
    if (!reason || reason.length < 5) { if (reason !== null) toast('请详细描述申诉原因（至少5个字）'); return; }
    try { await api('/api/c2c/orders/' + el.dataset.id + '/dispute', { method: 'POST', body: { reason } }); toast('已提交申诉，平台将介入'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (act === 'ad-submit') {
    if (!requireLogin()) return;
    const payMethods = Array.from(document.querySelectorAll('#view .pay-pick input:checked')).map(x => x.value);
    try {
      await api('/api/ads', {
        method: 'POST',
        body: {
          side: document.getElementById('p-side').value,
          asset: document.getElementById('p-asset').value,
          price: Number(document.getElementById('p-price').value),
          total: Number(document.getElementById('p-total').value),
          minCny: Number(document.getElementById('p-min').value),
          maxCny: Number(document.getElementById('p-max').value),
          payMethods,
          terms: document.getElementById('p-terms').value
        }
      });
      toast('广告发布成功');
      location.hash = '#/c2c';
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'merchant-apply') {
    const payMethods = Array.from(document.querySelectorAll('#view .pay-pick input:checked')).map(x => x.value);
    try {
      await api('/api/merchant/apply', {
        method: 'POST',
        body: {
          contact: document.getElementById('m-contact').value.trim(),
          payMethods,
          experience: document.getElementById('m-exp').value
        }
      });
      toast('申请已提交，等待平台审核');
      await loadMe();
      location.hash = '#/me';
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'ad-toggle') {
    try { await api('/api/ads/' + el.dataset.id + '/toggle', { method: 'POST' }); toast('操作成功'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (act === 'ad-del') {
    if (!confirm('确定删除该广告吗？')) return;
    try { await api('/api/ads/' + el.dataset.id, { method: 'DELETE' }); toast('已删除'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (act === 'deposit') return openCoinModal('deposit');
  if (act === 'withdraw') return openCoinModal('withdraw');

  /* ---- 后台动作 ---- */
  if (act === 'adjust') { window._openAdjust && window._openAdjust({ id: el.dataset.id, name: el.dataset.name }, el.dataset.dir); return; }
  if (act === 'user-txns') { window._openTxns && window._openTxns(el.dataset.id, el.dataset.name); return; }
  if (act === 'audit-merchant') {
    if (el.dataset.approve === '0') {
      const reason = prompt('请输入驳回原因：', '资料不完整，请补充OTC交易经验与收款信息');
      if (!reason) return;
      try { await api('/api/admin/merchants/' + el.dataset.id + '/audit', { method: 'POST', body: { approve: 0, reason } }); toast('已驳回'); router(); }
      catch (err) { toast(err.message); }
    } else {
      try { await api('/api/admin/merchants/' + el.dataset.id + '/audit', { method: 'POST', body: { approve: 1 } }); toast('已通过审核'); router(); }
      catch (err) { toast(err.message); }
    }
    return;
  }
  if (act === 'arbitrate') {
    const note = prompt('仲裁备注（可留空）：') || '';
    if (!confirm(el.dataset.ruling === 'buyer' ? '判定买方胜诉？托管货币将放行给买方。' : '判定卖方胜诉？托管货币将退回卖方。')) return;
    try {
      await api('/api/admin/disputes/' + el.dataset.id + '/arbitrate', { method: 'POST', body: { ruling: el.dataset.ruling, note } });
      toast('仲裁完成'); router();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'ad-new') { window._openAdEditor && window._openAdEditor(null); return; }
  if (act === 'admin-ad-toggle') {
    try {
      const list = await api('/api/admin/ads');
      const a = list.list.find(x => x.id === el.dataset.id);
      await api('/api/admin/ads/' + el.dataset.id, { method: 'PUT', body: { status: a.status === 'on' ? 'off' : 'on' } });
      toast('操作成功'); router();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'admin-ad-del') {
    if (!confirm('确定删除该广告吗？')) return;
    try { await api('/api/admin/ads/' + el.dataset.id, { method: 'DELETE' }); toast('已删除'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
});

/* 首次加载：先恢复登录态，再触发路由（整页刷新后 state.user 不会丢失） */
async function init() {
  if (state.token) await loadMe();
  router();
}
if (document.getElementById('view')) init();
else window.addEventListener('DOMContentLoaded', init);
