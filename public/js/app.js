/* ========== 币易商城 · 自营商品交易平台 前端 ========== */
const OSTATUS = {
  pending_pay: '待付款', pending_confirm: '待平台确认', pending_ship: '待发货',
  shipped: '待收货', completed: '已完成', cancelled: '已取消'
};
const PAY_ICONS = { alipay: '🅰️ 支付宝', wechat: '💚 微信支付' };

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
  if (dp == null) dp = 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
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

/* 图片压缩：File → 压缩后 dataURL（jpeg），避免大图请求超限 */
function fileToDataUrl(file, maxSide) {
  maxSide = maxSide || 1400;
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onerror = () => reject(new Error('读取图片失败'));
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}

/* ---------- 路由 ---------- */
const routes = [
  [/^#\/home$/, renderHome],
  [/^#\/p\/(\w+)$/, renderProduct],
  [/^#\/checkout\/(\w+)$/, renderCheckout],
  [/^#\/pay\/(\w+)$/, renderPay],
  [/^#\/orders$/, renderOrders],
  [/^#\/order\/(\w+)$/, renderOrder],
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
  const hash = location.hash || '#/home';
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
  location.hash = '#/home';
}
function setTab(hash) {
  const p = hash.split('?')[0];
  const map = {
    '#/home': 'home', '#/p': 'home', '#/checkout': 'home',
    '#/orders': 'orders', '#/order': 'orders', '#/pay': 'orders',
    '#/me': 'me', '#/support': 'me', '#/admin': 'me'
  };
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === map[p]));
}
window.addEventListener('hashchange', router);

/* ================= 首页（商品列表） ================= */
async function renderHome() {
  const kw = (location.hash.split('?kw=')[1] || '');
  const d = await api('/api/products' + (kw ? '?kw=' + encodeURIComponent(kw) : ''));
  let curCat = '全部';
  $view().innerHTML = `
    <div class="navbar"><b>币易商城</b><a class="act" href="#/orders">我的订单</a></div>
    <div class="searchbar">🔍<input id="kwInput" placeholder="搜索商品" value="${esc(kw)}"></div>
    <div class="cats" id="catBar">${(d.cats || ['全部']).map(c =>
      `<button class="cat-chip${c === curCat ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="grid" id="prodGrid">${d.list.length ? d.list.map(pcardHtml).join('') : `<div class="empty" style="grid-column:1/3"><div class="big">🛒</div>暂无商品</div>`}</div>
    <div style="height:16px"></div>`;
  const doSearch = () => {
    const v = document.getElementById('kwInput').value.trim();
    if (v) location.hash = '#/home?kw=' + encodeURIComponent(v);
    else if (kw) location.hash = '#/home';
  };
  document.getElementById('kwInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  document.getElementById('catBar').addEventListener('click', async e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    curCat = btn.dataset.cat;
    document.querySelectorAll('#catBar .cat-chip').forEach(x => x.classList.toggle('on', x === btn));
    const dd = await api('/api/products' + (curCat !== '全部' ? '?cat=' + encodeURIComponent(curCat) : ''));
    document.getElementById('prodGrid').innerHTML = dd.list.length ? dd.list.map(pcardHtml).join('') : `<div class="empty" style="grid-column:1/3"><div class="big">🛒</div>该分类暂无商品</div>`;
  });
}
function pcardHtml(p) {
  return `<a class="pcard" href="#/p/${p.id}">
    <div class="ph">${p.images && p.images[0] ? `<img src="${esc(p.images[0])}" loading="lazy">` : ''}
      ${p.soldout ? '<span class="ct">已售罄</span>' : ''}</div>
    <div class="pb"><div class="tt">${esc(p.title)}</div>
      <div class="mt"><span class="pr price">${fmt(p.price, p.price % 1 ? 2 : 0)}</span><span class="gm">已售${p.sales || 0}</span></div></div>
  </a>`;
}

/* ================= 商品详情 ================= */
async function renderProduct(id) {
  const { product: p } = await api('/api/products/' + id);
  window._curProduct = p;
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>商品详情</div>
    <div class="swiper">${(p.images && p.images.length ? p.images : ['']).map((img, i) =>
      `<div class="slide">${img ? `<img src="${esc(img)}">` : ''}${p.images && p.images.length > 1 ? `<span class="idx">${i + 1}/${p.images.length}</span>` : ''}</div>`).join('')}</div>
    <div class="detail-price"><span class="big">${fmt(p.price, p.price % 1 ? 2 : 0)}</span><span class="old">已售 ${p.sales || 0} 件</span><span style="margin-left:auto;font-size:12px;opacity:.9">库存 ${p.stock} 件</span></div>
    <div class="card"><h3 style="font-size:16px;line-height:1.5;margin-bottom:6px">${esc(p.title)}</h3>
      <div class="muted">分类：${esc(p.category)} · 7天无理由退换 · 平台担保</div></div>
    <div class="card"><div class="guarantee"><h4>🛡️ 购买流程（平台担保）</h4>
      <div class="step"><b>1</b>下单填写收货信息</div>
      <div class="step"><b>2</b>扫平台收款码付款</div>
      <div class="step"><b>3</b>上传付款凭证截图</div>
      <div class="step"><b>4</b>平台确认收款后发货</div>
      <div class="step"><b>5</b>收到货点击确认收货</div></div></div>
    ${p.desc ? `<div class="card"><b style="font-size:14px">商品详情</b><div class="desc-box" style="margin-top:8px">${esc(p.desc)}</div></div>` : ''}
    <div style="height:70px"></div>
    <div class="bottom-bar"><div class="bb-info">
        <div class="muted">总价</div><div class="p price" id="bbTotal">${fmt(p.price, p.price % 1 ? 2 : 0)}</div></div>
      ${p.soldout ? '<button class="btn disabled" style="flex:none">已售罄</button>'
                  : '<button class="btn" id="buyBtn" style="flex:none">立即购买</button>'}</div>`;
  if (!p.soldout) {
    document.getElementById('buyBtn').onclick = () => {
      if (!requireLogin()) return;
      location.hash = '#/checkout/' + p.id;
    };
  }
}

/* ================= 下单（填写收货信息） ================= */
async function renderCheckout(id) {
  if (!requireLogin()) return;
  const { product: p } = await api('/api/products/' + id);
  if (p.soldout) { toast('商品已售罄'); return location.hash = '#/home'; }
  let qty = 1;
  const c = state.user.lastContact || { name: state.user.realName || '', phone: state.user.phone || '', address: '' };
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>确认订单</div>
    <div class="order-card"><div class="order-body">
      <img class="thumb" src="${esc(p.images && p.images[0] || '')}" onerror="this.style.visibility='hidden'">
      <div class="oinfo"><div class="t">${esc(p.title)}</div><div class="g">单价 ¥${fmt(p.price, p.price % 1 ? 2 : 0)}　库存 ${p.stock}</div>
        <div class="stepper" style="padding:8px 0 0;justify-content:flex-start;gap:10px">
          <button class="btn sm gray" id="qtyMinus">－</button><b id="qtyVal" style="min-width:30px;text-align:center">1</b>
          <button class="btn sm gray" id="qtyPlus">＋</button><span class="muted">最多${Math.min(99, p.stock)}件</span></div></div></div></div>
    <div class="card"><b style="font-size:14px">收货信息</b>
      <div class="form-group" style="margin-top:10px"><label>收货人<em>*</em></label><input id="ck-name" value="${esc(c.name || '')}" placeholder="收货人姓名"></div>
      <div class="form-group"><label>联系电话<em>*</em></label><input id="ck-phone" value="${esc(c.phone || '')}" placeholder="11位手机号" maxlength="11"></div>
      <div class="form-group"><label>收货地址<em>*</em></label><textarea id="ck-addr" placeholder="省市区 + 详细地址">${esc(c.address || '')}</textarea></div></div>
    <div style="height:70px"></div>
    <div class="bottom-bar"><div class="bb-info"><div class="muted">应付金额</div><div class="p price" id="ckTotal">${fmt(p.price, 2)}</div></div>
      <button class="btn" id="submitOrder" style="flex:none">提交订单</button></div>`;
  const upd = () => {
    document.getElementById('qtyVal').textContent = qty;
    document.getElementById('ckTotal').textContent = fmt(p.price * qty, 2);
  };
  document.getElementById('qtyMinus').onclick = () => { if (qty > 1) { qty--; upd(); } };
  document.getElementById('qtyPlus').onclick = () => { if (qty < Math.min(99, p.stock)) { qty++; upd(); } };
  document.getElementById('submitOrder').onclick = async () => {
    try {
      const r = await api('/api/orders', { method: 'POST', body: {
        productId: p.id, qty,
        name: document.getElementById('ck-name').value.trim(),
        phone: document.getElementById('ck-phone').value.trim(),
        address: document.getElementById('ck-addr').value.trim()
      } });
      toast('下单成功，请扫码付款');
      location.hash = '#/pay/' + r.order.id;
    } catch (e) { toast(e.message); }
  };
}

/* ================= 付款（收款码 + 上传凭证） ================= */
async function renderPay(id) {
  if (!requireLogin()) return;
  const { order: o } = await api('/api/orders/' + id);
  if (o.status !== 'pending_pay') { location.hash = '#/order/' + id; return; }
  const { paycodes } = await api('/api/paycodes');
  let ch = 'alipay';
  let shot = '';
  const chBtns = cc => Object.entries(PAY_ICONS).map(([k, v]) =>
    `<button class="cat-chip${k === cc ? ' on' : ''}" data-ch="${k}">${v}</button>`).join('');
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>订单付款</div>
    <div class="card" style="text-align:center;padding:20px 14px">
      <div class="muted">订单金额（请按此金额转账）</div>
      <div class="price" style="font-size:36px;font-weight:800">${fmt(o.total, 2)}</div>
      <div class="muted" style="margin-top:4px">订单号 ${esc(o.no)}</div></div>
    <div class="card"><b style="font-size:14px">第一步：扫码付款</b>
      <div class="cats" style="padding:10px 0 4" id="chBar">${chBtns(ch)}</div>
      <div id="qrBox" style="text-align:center;padding:6px 0 2px"></div></div>
    <div class="card"><b style="font-size:14px">第二步：上传付款凭证</b>
      <div class="muted" style="margin:6px 0 10px">付款完成后截图，上传后由平台确认收款并发货</div>
      <div class="uploader" id="payUploader"></div>
      <button class="btn block" id="paySubmit" style="margin-top:14px">提交付款凭证</button></div>
    <div style="height:16px"></div>`;
  function renderQr() {
    const pc = paycodes[ch] || {};
    document.getElementById('qrBox').innerHTML = pc.img
      ? `<img src="${esc(pc.img)}" style="width:210px;height:210px;object-fit:contain;border:1px solid var(--line);border-radius:12px;background:#fff">
         <div class="muted" style="margin-top:8px">${PAY_ICONS[ch]}　${esc(pc.name || '')}${pc.account ? '　' + esc(pc.account) : ''}</div>
         <div class="muted">请转账后点击下方上传凭证</div>`
      : `<div class="empty" style="padding:30px 10px"><div class="big">🧾</div>平台尚未上传${PAY_ICONS[ch]}收款码<br>请先联系在线客服获取收款方式</div>`;
  }
  function renderUp() {
    const el = document.getElementById('payUploader');
    el.innerHTML = `<div class="up-item">${shot ? `<img src="${esc(shot)}"><span class="del" id="shotDel">×</span></div>` : ''}` +
      (shot ? '' : `<label class="up-add"><span class="plus">＋</span>上传截图<input type="file" accept="image/*" hidden></label>`);
    const fi = el.querySelector('input[type=file]');
    if (fi) fi.onchange = async () => {
      if (!fi.files || !fi.files[0]) return;
      try { shot = await fileToDataUrl(fi.files[0]); renderUp(); } catch (e) { toast(e.message); }
    };
    const del = document.getElementById('shotDel');
    if (del) del.onclick = () => { shot = ''; renderUp(); };
  }
  document.getElementById('chBar').addEventListener('click', e => {
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    ch = b.dataset.ch;
    document.querySelectorAll('#chBar .cat-chip').forEach(x => x.classList.toggle('on', x === b));
    renderQr();
  });
  document.getElementById('paySubmit').onclick = async () => {
    if (!shot) return toast('请先上传付款截图');
    try {
      await api('/api/orders/' + o.id + '/pay', { method: 'POST', body: { channel: ch, image: shot } });
      toast('凭证已提交，等待平台确认');
      location.hash = '#/order/' + o.id;
    } catch (e) { toast(e.message); }
  };
  renderQr(); renderUp();
}

/* ================= 我的订单列表 ================= */
async function renderOrders() {
  if (!requireLogin()) return;
  const tabs = [['', '全部'], ['pending_pay', '待付款'], ['pending_confirm', '待确认'], ['pending_ship', '待发货'], ['shipped', '待收货'], ['completed', '已完成']];
  let cur = '';
  $view().innerHTML = `
    <div class="navbar"><b>我的订单</b></div>
    <div class="tabs" id="odTabs">${tabs.map(([k, v]) => `<span class="tab${k === cur ? ' on' : ''}" data-st="${k}">${v}</span>`).join('')}</div>
    <div id="odList"><div class="empty">加载中...</div></div><div style="height:16px"></div>`;
  async function load() {
    const d = await api('/api/orders');
    let list = d.list;
    if (cur) list = list.filter(o => o.status === cur);
    document.getElementById('odList').innerHTML = list.length ? list.map(orderCardHtml).join('')
      : `<div class="empty"><div class="big">📦</div>暂无相关订单</div>`;
  }
  document.getElementById('odTabs').addEventListener('click', e => {
    const t = e.target.closest('[data-st]');
    if (!t) return;
    cur = t.dataset.st;
    document.querySelectorAll('#odTabs .tab').forEach(x => x.classList.toggle('on', x === t));
    load();
  });
  bindOrderCards(document.getElementById('odList'));
  await load();
}
function orderCardHtml(o) {
  const acts = [];
  if (o.status === 'pending_pay') acts.push(`<button class="btn sm" data-go="#/pay/${o.id}">去付款</button><button class="btn sm gray" data-ocancel="${o.id}">取消</button>`);
  if (o.status === 'shipped') acts.push(`<button class="btn sm" data-oreceive="${o.id}">确认收货</button>`);
  return `<div class="order-card">
    <div class="order-head"><span>${fmtTime(o.createdAt)}</span><span class="status-badge st-${o.status}">${OSTATUS[o.status]}</span></div>
    <a class="order-body" href="#/order/${o.id}">
      <img class="thumb" src="${esc(o.item.image || '')}" onerror="this.style.visibility='hidden'">
      <div class="oinfo"><div class="t">${esc(o.item.title)}</div>
        <div class="g">¥${fmt(o.item.price, 2)} × ${o.item.qty}${o.shipNo ? '　快递 ' + esc(o.shipNo) : ''}</div></div></a>
    <div class="order-foot"><div class="amt">合计：<span class="price">${fmt(o.total, 2)}</span></div>
      <div class="btns">${acts.join('') || `<a class="btn sm gray" href="#/order/${o.id}">查看详情</a>`}</div></div></div>`;
}
function bindOrderCards(root) {
  root.querySelectorAll('[data-ocancel]').forEach(b => b.onclick = async () => {
    if (!confirm('确定取消该订单吗？')) return;
    try { await api('/api/orders/' + b.dataset.ocancel + '/cancel', { method: 'POST' }); toast('已取消'); router(); } catch (e) { toast(e.message); }
  });
  root.querySelectorAll('[data-oreceive]').forEach(b => b.onclick = async () => {
    if (!confirm('确认已收到货？确认后交易完成。')) return;
    try { await api('/api/orders/' + b.dataset.oreceive + '/receive', { method: 'POST' }); toast('交易完成'); router(); } catch (e) { toast(e.message); }
  });
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go; });
}

/* ================= 订单详情 ================= */
async function renderOrder(id) {
  if (!requireLogin()) return;
  const { order: o } = await api('/api/orders/' + id);
  const steps = ['下单', '付款', '确认', '发货', '收货'];
  const stepIdx = { pending_pay: 0, pending_confirm: 1, pending_ship: 2, shipped: 3, completed: 4 }[o.status];
  const acts = [];
  if (o.status === 'pending_pay') acts.push(`<button class="btn" data-go="#/pay/${o.id}">去付款</button><button class="btn gray" data-ocancel="${o.id}">取消订单</button>`);
  if (o.status === 'shipped') acts.push(`<button class="btn" data-oreceive="${o.id}">确认收货</button>`);
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>订单详情</div>
    ${o.status !== 'cancelled' ? `<div class="card"><div class="stepper">${steps.map((s, i) =>
      `<div class="stp${i < stepIdx ? ' done' : i === stepIdx ? ' cur' : ''}"><div class="dot">${i < stepIdx ? '✓' : i + 1}</div>${s}</div>`).join('')}</div></div>` : ''}
    <div class="card"><div class="kv"><span class="k">订单状态</span><span class="v status-badge st-${o.status}">${OSTATUS[o.status]}</span></div>
      <div class="kv"><span class="k">订单编号</span><span class="v">${esc(o.no)}</span></div>
      <div class="kv"><span class="k">下单时间</span><span class="v">${fmtTime(o.createdAt)}</span></div>
      ${o.payChannel ? `<div class="kv"><span class="k">付款方式</span><span class="v">${PAY_ICONS[o.payChannel] || esc(o.payChannel)}</span></div>` : ''}
      ${o.shipNo ? `<div class="kv"><span class="k">快递信息</span><span class="v">${esc(o.shipCompany)}　${esc(o.shipNo)}</span></div>` : ''}</div>
    <div class="card"><b style="font-size:14px">商品</b>
      <div class="order-body" style="padding:10px 0 0">
        <img class="thumb" src="${esc(o.item.image || '')}" onerror="this.style.visibility='hidden'">
        <div class="oinfo"><div class="t">${esc(o.item.title)}</div>
          <div class="g">¥${fmt(o.item.price, 2)} × ${o.item.qty}</div></div>
        <div class="price" style="flex:none">${fmt(o.item.price * o.item.qty, 2)}</div></div>
      <div class="kv" style="margin-top:8px"><span class="k">合计</span><span class="v price" style="font-size:17px">${fmt(o.total, 2)}</span></div></div>
    <div class="card"><b style="font-size:14px">收货信息</b>
      <div class="kv" style="margin-top:6px"><span class="k">收货人</span><span class="v">${esc(o.contact.name)}　${esc(o.contact.phone)}</span></div>
      <div class="kv"><span class="k">地址</span><span class="v">${esc(o.contact.address)}</span></div></div>
    ${o.payShot ? `<div class="card"><b style="font-size:14px">付款凭证</b>
      <div class="evidence-imgs"><img src="${esc(o.payShot)}" onclick="window._viewImg('${esc(o.payShot)}')"></div></div>` : ''}
    <div class="card"><b style="font-size:14px">订单进度</b><div class="timeline">${o.timeline.map(t =>
      `<div class="tl"><div class="td"></div><div class="tt">${esc(t.text)}<small>${fmtTime(t.at)}</small></div></div>`).join('')}</div></div>
    <div style="height:80px"></div>
    ${acts.length ? `<div class="bottom-bar"><div class="bb-info"><div class="muted">合计</div><div class="p price">${fmt(o.total, 2)}</div></div>
      <div style="flex:none;display:flex;gap:8px">${acts.join('')}</div></div>` : ''}`;
  bindOrderCards($view());
}
window._viewImg = (src) => showModal(`<img src="${esc(src)}" style="width:100%;border-radius:10px">`, true);

/* ================= 我的 ================= */
async function renderMe() {
  if (!requireLogin()) return;
  const d = await api('/api/orders');
  const waitRecv = d.list.filter(o => ['pending_ship', 'shipped'].includes(o.status)).length;
  const waitPay = d.list.filter(o => o.status === 'pending_pay').length;
  $view().innerHTML = `
    <div class="me-head"><div class="avatar">${esc((state.user.realName || '用')[0])}</div>
      <div class="info"><div class="nm">${esc(state.user.realName)}${state.user.role === 'admin' ? '<span class="tag" style="background:rgba(255,255,255,.25);color:#fff">管理员</span>' : ''}</div>
      <div class="ph">${esc(state.user.phone)}</div></div></div>
    <div class="me-grid">
      <a class="mi" href="#/orders"><b>${d.list.length}</b>全部订单</a>
      <a class="mi" href="#/orders"><b>${waitPay}</b>待付款</a>
      <a class="mi" href="#/orders"><b>${waitRecv}</b>待收货</a></div>
    <div class="menu">
      <div class="mi2" data-go="#/orders"><span class="icon">📦</span>我的订单<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/support"><span class="icon">💬</span>联系在线客服<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/live"><span class="icon">🔑</span>实盘交易（币安 API）<span class="arrow">›</span></div>
      ${state.user.role === 'admin' ? '<div class="mi2" data-go="#/admin"><span class="icon">🛡️</span>平台管理后台<span class="arrow">›</span></div>' : ''}
      <div class="mi2" id="logoutBtn"><span class="icon">🚪</span>退出登录<span class="arrow">›</span></div></div>`;
  document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => { location.hash = el.dataset.go; });
  document.getElementById('logoutBtn').onclick = () => {
    if (!confirm('确定退出登录吗？')) return;
    state.token = ''; state.user = null;
    localStorage.removeItem('token');
    toast('已退出'); location.hash = '#/login';
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
          <span class="muted" style="cursor:pointer" id="lvSwitch">切换 ›</span></div>
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
        ${ordType === 'LIMIT' ? `<div class="form-group"><label>委托价格</label><input id="lvPrice" type="number" inputmode="decimal" placeholder="0.00"></div>` : ''}
        <div class="form-group"><label>交易数量</label><input id="lvQty" type="number" inputmode="decimal" placeholder="0.00"></div>
        <div class="muted" id="lvAvail" style="margin-bottom:10px">可用 --</div>
        <button class="btn block" id="lvSubmit">${side === 'BUY' ? '买入' : '卖出'} ${symbol}</button>
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
    document.getElementById('lvSwitch').onclick = pickPair;
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
      if (el) el.innerHTML = `最新价 <b>${fmt(ticker.price)}</b>　24h ${ticker.change >= 0 ? '+' : ''}${fmt(ticker.change, 2)}%　高 ${fmt(ticker.high)}　低 ${fmt(ticker.low)}`;
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
        <div class="order-card" style="margin:0 0 8px;padding:10px;box-shadow:none;border:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="color:${o.side === 'BUY' ? 'var(--green,#0e9f6e)' : '#f53f3f'};font-weight:600">${o.side === 'BUY' ? '买入' : '卖出'} ${o.symbol}</span>
            <span class="muted">${o.type} @ ${fmt(parseFloat(o.price))}</span>
            <button class="btn sm gray" data-oid="${o.orderId}">撤单</button>
          </div>
          <div class="muted" style="margin-top:5px;font-size:12px">数量 ${o.origQty}　已成交 ${o.executedQty}</div>
        </div>`).join('') : '<div class="muted" style="padding:10px;text-align:center">无委托</div>';
      ob.querySelectorAll('[data-oid]').forEach(b => b.onclick = async () => {
        if (!confirm('确认撤销此委托？')) return;
        try { await api('/api/binance/order/' + b.dataset.oid + '/cancel', { method: 'POST', body: { symbol } }); toast('已撤单'); loadOrders(); } catch (e) { toast(e.message); }
      });
      const hb = document.getElementById('lvHistory');
      if (hb) hb.innerHTML = d.history.length ? d.history.map(t => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f6f8;font-size:12px">
          <span style="color:${t.isBuyer ? 'var(--green,#0e9f6e)' : '#f53f3f'}">${t.isBuyer ? '买' : '卖'}</span>
          <span>${fmt(parseFloat(t.price))} × ${t.qty}</span>
          <span class="muted">${fmt(parseFloat(t.quoteQty))} USDT</span>
        </div>`).join('') : '<div class="muted" style="padding:10px;text-align:center">无成交记录</div>';
    } catch (e) { /* 忽略 */ }
  }

  function pickPair() {
    const pairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT'];
    showModal(`<h3 style="margin-bottom:12px">选择交易对</h3>
      ${pairs.map(p => `<div style="padding:12px;border-bottom:1px solid #f2f3f5;cursor:pointer" data-pick="${p}"><b>${p}</b></div>`).join('')}`, true);
    document.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => { closeModal(); symbol = el.dataset.pick; renderTrade(); });
  }

  async function render() { if (keysStatus && keysStatus.configured) renderTrade(); else renderKeyForm(); }
  await checkKeys();
  await render();
  _timer = setInterval(() => { if (keysStatus && keysStatus.configured) { loadTicker(); loadOrders(); } }, 5000);
}

/* ================= 登录 / 注册 ================= */
function renderLogin() {
  $view().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-head"><div class="logo">币易商城</div><p>正品好货 · 平台担保 · 扫码付款</p></div>
      <div class="auth-card">
        <div class="form-group"><label>手机号</label><input id="lg-phone" placeholder="请输入手机号" value="13900000002"></div>
        <div class="form-group"><label>密码</label><input id="lg-pw" type="password" placeholder="请输入密码" value="buyer123"></div>
        <button class="btn block" data-act="do-login">登 录</button>
        <div class="auth-switch">还没有账号？<a href="#/register">立即注册</a></div>
        <div class="tip" style="margin-top:14px;line-height:1.9">演示账号：<br>管理员 13800000000 / admin123<br>用户 13900000002 / buyer123</div>
      </div>
    </div>`;
  document.querySelector('[data-act="do-login"]').onclick = async () => {
    try {
      const r = await api('/api/login', { method: 'POST', body: { phone: document.getElementById('lg-phone').value.trim(), password: document.getElementById('lg-pw').value } });
      state.token = r.token; state.user = r.user;
      localStorage.setItem('token', r.token);
      toast('登录成功');
      location.hash = '#/home';
    } catch (e) { toast(e.message); }
  };
}
function renderRegister() {
  $view().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-head"><div class="logo">注册账号</div><p>注册即可下单购买，信息仅用于订单联系</p></div>
      <div class="auth-card">
        <div class="form-group"><label>手机号<em>*</em></label><input id="rg-phone" placeholder="11位手机号" maxlength="11"></div>
        <div class="form-group"><label>登录密码<em>*</em></label><input id="rg-pw" type="password" placeholder="至少6位"></div>
        <div class="form-group"><label>姓名<em>*</em></label><input id="rg-name" placeholder="收货联系人姓名"></div>
        <button class="btn block" data-act="do-register">注册并登录</button>
        <div class="auth-switch">已有账号？<a href="#/login">直接登录</a></div>
      </div>
    </div>`;
  document.querySelector('[data-act="do-register"]').onclick = async () => {
    try {
      const r = await api('/api/register', { method: 'POST', body: {
        phone: document.getElementById('rg-phone').value.trim(),
        password: document.getElementById('rg-pw').value,
        realName: document.getElementById('rg-name').value.trim()
      } });
      state.token = r.token; state.user = r.user;
      localStorage.setItem('token', r.token);
      toast('注册成功');
      location.hash = '#/home';
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
  if (state.user.role !== 'admin') { $view().innerHTML = '<div class="empty"><div class="big">🚫</div>无管理员权限</div>'; return; }
  let tab = 'overview';
  const TABS = [['overview', '总览'], ['products', '商品'], ['orders', '订单'], ['paycodes', '收款码'], ['users', '用户'], ['support', '客服']];
  $view().innerHTML = `
    <div class="navbar"><b>平台管理后台</b></div>
    <div class="tabs" id="adTabs">${TABS.map(([k, v]) => `<span class="tab${k === tab ? ' on' : ''}" data-tab="${k}">${v}${k === 'orders' ? ' <i id="odBadge"></i>' : ''}</span>`).join('')}</div>
    <div id="adminBody" style="padding-bottom:30px"></div>`;
  document.getElementById('adTabs').addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    tab = t.dataset.tab;
    document.querySelectorAll('#adTabs .tab').forEach(x => x.classList.toggle('on', x === t));
    renderTab();
  });
  async function renderTab() {
    const body = document.getElementById('adminBody');
    body.innerHTML = '<div class="empty">加载中...</div>';
    if (tab === 'overview') return renderOverview(body);
    if (tab === 'products') return renderProducts(body);
    if (tab === 'orders') return renderAdminOrders(body);
    if (tab === 'paycodes') return renderPaycodes(body);
    if (tab === 'users') return renderUsers(body);
    if (tab === 'support') return renderAdminSupport(body);
  }

  /* ---- 总览 ---- */
  async function renderOverview(body) {
    const d = await api('/api/admin/overview');
    body.innerHTML = `<div class="admin-stat">
      <div class="astat primary"><b>${d.users}</b><span>注册用户</span></div>
      <div class="astat"><b>${d.onSale}/${d.products}</b><span>在售/商品</span></div>
      <div class="astat"><b>${d.ordersTotal}</b><span>订单总数</span></div>
      <div class="astat"><b>¥${fmt(d.revenue)}</b><span>成交额</span></div>
      <div class="astat warn"><b>${d.pendingConfirm}</b><span>待确认付款</span></div>
      <div class="astat red"><b>${d.pendingShip}</b><span>待发货</span></div></div>
      <div class="menu"><div class="mi2" data-quick="orders"><span class="icon">🧾</span>订单处理（${d.pendingConfirm + d.pendingShip} 笔待办）<span class="arrow">›</span></div>
      <div class="mi2" data-quick="paycodes"><span class="icon">🧾</span>收款码设置<span class="arrow">›</span></div>
      <div class="mi2" data-quick="products"><span class="icon">🏷️</span>商品上架管理<span class="arrow">›</span></div></div>`;
    body.querySelectorAll('[data-quick]').forEach(el => el.onclick = () => {
      tab = el.dataset.quick;
      document.querySelectorAll('#adTabs .tab').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
      renderTab();
    });
    renderTab.badge && renderTab.badge();
  }

  /* ---- 商品管理 ---- */
  async function renderProducts(body) {
    const d = await api('/api/admin/products');
    body.innerHTML = `<button class="btn block" id="pAdd" style="margin:10px 12px;width:calc(100% - 24px)">＋ 新增商品</button>
      ${d.list.map(p => `<div class="order-card"><div class="order-body">
        <img class="thumb" src="${esc(p.images && p.images[0] || '')}" onerror="this.style.visibility='hidden'">
        <div class="oinfo"><div class="t">${esc(p.title)}</div>
          <div class="g">¥${fmt(p.price, 2)}　库存${p.stock}　已售${p.sales || 0}</div>
          <div class="g">${p.status === 'on' ? '<span class="status-badge st-completed">销售中</span>' : '<span class="status-badge st-closed">已下架</span>'}</div></div></div>
        <div class="order-foot"><div class="btns">
          <button class="btn sm gray" data-pedit="${p.id}">编辑</button>
          <button class="btn sm ${p.status === 'on' ? 'gray' : ''}" data-ptoggle="${p.id}">${p.status === 'on' ? '下架' : '上架'}</button>
          <button class="btn sm gray" style="color:#f53f3f" data-pdel="${p.id}">删除</button></div></div></div>`).join('')}`;
    document.getElementById('pAdd').onclick = () => openProductEditor(null);
    body.querySelectorAll('[data-pedit]').forEach(b => b.onclick = () => {
      openProductEditor(d.list.find(x => x.id === b.dataset.pedit));
    });
    body.querySelectorAll('[data-ptoggle]').forEach(b => b.onclick = async () => {
      try { await api('/api/admin/products/' + b.dataset.ptoggle + '/toggle', { method: 'POST' }); toast('操作成功'); renderTab(); } catch (e) { toast(e.message); }
    });
    body.querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
      if (!confirm('确定删除该商品吗？（有订单记录的商品不能删除，请下架）')) return;
      try { await api('/api/admin/products/' + b.dataset.pdel, { method: 'DELETE' }); toast('已删除'); renderTab(); } catch (e) { toast(e.message); }
    });
  }
  function openProductEditor(p) {
    let images = p ? (p.images || []).slice() : [];
    showModal(`<h3 style="margin-bottom:12px">${p ? '编辑商品' : '新增商品'}</h3>
      <div class="form-group"><label>商品标题<em>*</em></label><input id="pe-title" value="${esc(p ? p.title : '')}" placeholder="2-60字" maxlength="60"></div>
      <div style="display:flex;gap:10px">
        <div class="form-group" style="flex:1"><label>分类</label><input id="pe-cat" value="${esc(p ? p.category : '数码')}" placeholder="如 数码/生活"></div>
        <div class="form-group" style="flex:1"><label>售价 ¥<em>*</em></label><input id="pe-price" type="number" inputmode="decimal" value="${p ? p.price : ''}" placeholder="0.00"></div>
        <div class="form-group" style="flex:1"><label>库存<em>*</em></label><input id="pe-stock" type="number" inputmode="numeric" value="${p ? p.stock : ''}" placeholder="0"></div></div>
      <div class="form-group"><label>商品图片（最多5张）</label><div class="uploader" id="pe-up"></div></div>
      <div class="form-group"><label>商品详情</label><textarea id="pe-desc" placeholder="卖点、规格、售后…（换行分隔）">${esc(p ? p.desc : '')}</textarea></div>
      <button class="btn block" id="peSave">保 存</button>`, true);
    renderUp();
    function renderUp() {
      const el = document.getElementById('pe-up');
      el.innerHTML = images.map((img, i) => `<div class="up-item"><img src="${esc(img)}"><span class="del" data-del="${i}">×</span></div>`).join('') +
        (images.length < 5 ? '<label class="up-add"><span class="plus">＋</span>添加图片<input type="file" accept="image/*" multiple hidden></label>' : '');
      const fi = el.querySelector('input[type=file]');
      if (fi) fi.onchange = async () => {
        for (const f of fi.files) {
          if (images.length >= 5) break;
          try { images.push(await fileToDataUrl(f, 1200)); } catch (e) { toast(e.message); }
        }
        renderUp();
      };
      el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { images.splice(Number(b.dataset.del), 1); renderUp(); });
    }
    document.getElementById('peSave').onclick = async () => {
      const payload = {
        title: document.getElementById('pe-title').value.trim(),
        category: document.getElementById('pe-cat').value.trim() || '其他',
        price: Number(document.getElementById('pe-price').value),
        stock: Number(document.getElementById('pe-stock').value),
        desc: document.getElementById('pe-desc').value,
        images
      };
      try {
        if (p) await api('/api/admin/products/' + p.id, { method: 'PUT', body: payload });
        else await api('/api/admin/products', { method: 'POST', body: payload });
        toast('已保存'); closeModal(); renderTab();
      } catch (e) { toast(e.message); }
    };
  }

  /* ---- 订单管理 ---- */
  const ADM_OST = [['', '全部'], ['pending_pay', '待付款'], ['pending_confirm', '待确认'], ['pending_ship', '待发货'], ['shipped', '待收货'], ['completed', '已完成'], ['cancelled', '已取消']];
  async function renderAdminOrders(body) {
    let cur = 'pending_confirm';
    body.innerHTML = `<div class="tabs" style="position:static" id="adOdTabs">${ADM_OST.map(([k, v]) =>
      `<span class="tab${k === cur ? ' on' : ''}" data-st="${k}">${v}</span>`).join('')}</div><div id="adOdList"></div>`;
    async function load() {
      const d = await api('/api/admin/orders' + (cur ? '?status=' + cur : ''));
      document.getElementById('adOdList').innerHTML = d.list.length ? d.list.map(o => `
        <div class="order-card"><div class="order-head"><span>${esc(o.userName || '')}　${esc(o.no)}</span>
          <span class="status-badge st-${o.status}">${OSTATUS[o.status]}</span></div>
        <a class="order-body" data-oview="${o.id}" style="cursor:pointer">
          <img class="thumb" src="${esc(o.item.image || '')}" onerror="this.style.visibility='hidden'">
          <div class="oinfo"><div class="t">${esc(o.item.title)}</div>
            <div class="g">¥${fmt(o.item.price, 2)} × ${o.item.qty}　${fmtTime(o.createdAt)}</div></div>
          <div class="price" style="flex:none">${fmt(o.total, 2)}</div></a>
        <div class="order-foot"><div class="btns">
          ${o.status === 'pending_confirm' ? `<button class="btn sm" data-oconfirm="${o.id}">确认收款</button><button class="btn sm gray" data-oreject="${o.id}">退回凭证</button>` : ''}
          ${o.status === 'pending_ship' ? `<button class="btn sm" data-oship="${o.id}">发货</button>` : ''}
          ${['pending_pay', 'pending_confirm'].includes(o.status) ? `<button class="btn sm gray" data-ocancel="${o.id}">取消订单</button>` : ''}
          <button class="btn sm gray" data-oview="${o.id}">详情</button></div></div></div>`).join('')
        : `<div class="empty"><div class="big">🧾</div>暂无相关订单</div>`;
      bindList(document.getElementById('adOdList'));
    }
    function bindList(root) {
      root.querySelectorAll('[data-oview]').forEach(b => b.onclick = () => openOrderView(b.dataset.oview, load));
      root.querySelectorAll('[data-oconfirm]').forEach(b => b.onclick = async () => {
        if (!confirm('确认已收到该订单货款？确认后进入待发货。')) return;
        try { await api('/api/admin/orders/' + b.dataset.oconfirm + '/confirm', { method: 'POST' }); toast('已确认收款'); load(); } catch (e) { toast(e.message); }
      });
      root.querySelectorAll('[data-oreject]').forEach(b => b.onclick = () => {
        const reason = prompt('退回原因（将展示给买家）：', '未查询到对应款项，请核对金额后重新上传');
        if (!reason) return;
        api('/api/admin/orders/' + b.dataset.oreject + '/reject', { method: 'POST', body: { reason } })
          .then(() => { toast('已退回'); load(); }).catch(e => toast(e.message));
      });
      root.querySelectorAll('[data-oship]').forEach(b => b.onclick = () => openShipModal(b.dataset.oship, load));
      root.querySelectorAll('[data-ocancel]').forEach(b => b.onclick = async () => {
        if (!confirm('确定取消该订单吗？库存将释放。')) return;
        try { await api('/api/admin/orders/' + b.dataset.ocancel + '/cancel', { method: 'POST' }); toast('已取消'); load(); } catch (e) { toast(e.message); }
      });
    }
    document.getElementById('adOdTabs').addEventListener('click', e => {
      const t = e.target.closest('[data-st]');
      if (!t) return;
      cur = t.dataset.st;
      document.querySelectorAll('#adOdTabs .tab').forEach(x => x.classList.toggle('on', x === t));
      load();
    });
    await load();
  }
  async function openOrderView(id, onBack) {
    const { order: o } = await api('/api/admin/orders/' + id);
    showModal(`<h3 style="margin-bottom:10px">订单 ${esc(o.no)} <span class="status-badge st-${o.status}">${OSTATUS[o.status]}</span></h3>
      <div class="kv"><span class="k">买家</span><span class="v">${esc(o.userName || '')}（${esc(o.userPhone || '')}）</span></div>
      <div class="kv"><span class="k">商品</span><span class="v">${esc(o.item.title)} × ${o.item.qty}</span></div>
      <div class="kv"><span class="k">金额</span><span class="v price">¥${fmt(o.total, 2)}</span></div>
      <div class="kv"><span class="k">付款</span><span class="v">${o.payChannel ? PAY_ICONS[o.payChannel] : '未付款'}</span></div>
      <div class="kv"><span class="k">收货</span><span class="v">${esc(o.contact.name)} ${esc(o.contact.phone)}<br>${esc(o.contact.address)}</span></div>
      ${o.shipNo ? `<div class="kv"><span class="k">快递</span><span class="v">${esc(o.shipCompany)} ${esc(o.shipNo)}</span></div>` : ''}
      ${o.payShot ? `<div style="margin-top:8px"><b style="font-size:13px">付款凭证</b><div class="evidence-imgs"><img src="${esc(o.payShot)}"></div></div>` : ''}
      <div style="margin-top:10px"><b style="font-size:13px">进度</b><div class="timeline">${o.timeline.map(t =>
        `<div class="tl"><div class="td"></div><div class="tt">${esc(t.text)}<small>${fmtTime(t.at)}</small></div></div>`).join('')}</div></div>`, true);
  }
  function openShipModal(id, onDone) {
    showModal(`<h3 style="margin-bottom:12px">发货</h3>
      <div class="form-group"><label>快递公司<em>*</em></label><input id="sh-co" placeholder="如 顺丰速运"></div>
      <div class="form-group"><label>快递单号<em>*</em></label><input id="sh-no" placeholder="运单号"></div>
      <button class="btn block" id="shGo">确认发货</button>`, true);
    document.getElementById('shGo').onclick = async () => {
      try {
        await api('/api/admin/orders/' + id + '/ship', { method: 'POST', body: {
          company: document.getElementById('sh-co').value.trim(),
          no: document.getElementById('sh-no').value.trim()
        } });
        toast('已发货'); closeModal(); onDone();
      } catch (e) { toast(e.message); }
    };
  }

  /* ---- 收款码管理 ---- */
  async function renderPaycodes(body) {
    const { paycodes } = await api('/api/paycodes');
    body.innerHTML = `<div class="card" style="margin:10px 12px"><div class="muted" style="line-height:1.8">
      📌 上传您的<b>支付宝 / 微信收款二维码</b>，买家下单后在付款页扫码转账，并上传付款截图，您在「订单」里确认收款后发货。</div></div>
      ${Object.entries(PAY_ICONS).map(([k, label]) => {
        const pc = paycodes[k] || {};
        return `<div class="order-card"><div class="order-head"><b>${label}</b></div>
          <div style="display:flex;gap:14px;padding:12px 14px;align-items:center">
            <div style="flex:none">${pc.img
              ? `<img src="${esc(pc.img)}" style="width:120px;height:120px;object-fit:contain;border:1px solid var(--line);border-radius:10px;background:#fff">`
              : `<div style="width:120px;height:120px;border:1.5px dashed #ccc;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#aaa;background:#fafafa">未上传</div>`}</div>
            <div style="flex:1">
              <div class="form-group"><label>收款人</label><input id="pc-name-${k}" value="${esc(pc.name || '')}" placeholder="收款账户姓名"></div>
              <div class="form-group" style="margin-bottom:0"><label>账号/说明</label><input id="pc-acc-${k}" value="${esc(pc.account || '')}" placeholder="如 支付宝绑定手机号"></div></div></div>
          <div class="order-foot"><div class="btns">
            <label class="btn sm" style="margin:0">${pc.img ? '更换收款码' : '上传收款码'}<input type="file" accept="image/*" hidden data-pcup="${k}"></label>
            <button class="btn sm" data-pcsave="${k}">保存信息</button></div></div></div>`;
      }).join('')}`;
    body.querySelectorAll('[data-pcup]').forEach(fi => fi.onchange = async () => {
      if (!fi.files || !fi.files[0]) return;
      try {
        const img = await fileToDataUrl(fi.files[0], 1000, 0.9);
        await api('/api/admin/paycodes', { method: 'POST', body: { channel: fi.dataset.pcup, img } });
        toast('收款码已更新'); renderTab();
      } catch (e) { toast(e.message); }
    });
    body.querySelectorAll('[data-pcsave]').forEach(b => b.onclick = async () => {
      const k = b.dataset.pcsave;
      try {
        await api('/api/admin/paycodes', { method: 'POST', body: { channel: k,
          name: document.getElementById('pc-name-' + k).value,
          account: document.getElementById('pc-acc-' + k).value } });
        toast('已保存');
      } catch (e) { toast(e.message); }
    });
  }

  /* ---- 用户 ---- */
  async function renderUsers(body) {
    const d = await api('/api/admin/users');
    body.innerHTML = `<div class="menu" style="margin-top:10px">${d.list.map(u => `
      <div class="mi2"><span class="icon">${u.role === 'admin' ? '🛡️' : '🙋'}</span>
        <span style="flex:1;min-width:0"><b style="font-size:14px">${esc(u.realName)}</b>
        <span class="muted" style="display:block">${esc(u.phone)} · ${u.orderCount} 单 · 注册于 ${fmtTime(u.createdAt)}</span></span>
        ${u.role === 'admin' ? '<span class="tag">管理员</span>' : ''}</div>`).join('')}</div>`;
  }

  /* ---- 客服 ---- */
  async function renderAdminSupport(body) {
    const d = await api('/api/admin/support/conversations');
    if (d.list.length === 0) { body.innerHTML = '<div class="empty"><div class="big">💬</div>暂无用户咨询</div>'; return; }
    body.innerHTML = `<div class="menu" style="margin-top:10px">${d.list.map(c => `
      <div class="mi2" data-conv="${c.id}"><span class="icon">💬</span>
        <span style="flex:1;min-width:0"><b style="font-size:14px">${esc(c.userName)}</b>
        <span class="muted" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.lastMsg || '')}</span></span>
        ${c.unread ? `<span class="badge">${c.unread}</span>` : `<span class="muted">${fmtTime(c.lastAt).slice(5)}</span>`}</div>`).join('')}</div>
      <div id="adminChat"></div>`;
    body.querySelectorAll('[data-conv]').forEach(el => el.onclick = () => {
      const conv = d.list.find(x => x.id === el.dataset.conv);
      body.innerHTML = `<div class="navbar" style="position:static"><button class="back" id="chatBack">‹</button>${esc(conv.userName)}（${esc(conv.userPhone)}）</div>
        <div id="adminChatRoot" class="chat-page"></div>`;
      document.getElementById('chatBack').onclick = () => renderTab();
      mountChat(document.getElementById('adminChatRoot'), {
        selfSide: 'admin',
        placeholder: '回复用户…',
        fetchMsgs: () => api('/api/admin/support/conversations/' + conv.id),
        sendMsg: (content) => api('/api/admin/support/conversations/' + conv.id + '/messages', { method: 'POST', body: { content } })
      });
    });
  }

  await renderTab();
}

/* ================= 全局动作 ================= */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close-modal') return closeModal();
  if (act === 'back') return history.back();
});

/* 首次加载：先恢复登录态，再触发路由（整页刷新后 state.user 不会丢失） */
async function init() {
  if (state.token) await loadMe();
  router();
}
if (document.getElementById('view')) init();
else window.addEventListener('DOMContentLoaded', init);
