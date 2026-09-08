/* ========== 游易达 H5 前端 ========== */
const CATS = [
  { k: 'all', n: '全部' }, { k: 'account', n: '游戏账号' }, { k: 'skin', n: '皮肤' },
  { k: 'item', n: '道具' }, { k: 'coin', n: '游戏币' }
];
const CAT_NAME = { account: '游戏账号', skin: '皮肤', item: '道具', coin: '游戏币' };
const STATUS = {
  pending_pay: '待付款', paid: '待发货', delivered: '待收货', completed: '已完成',
  disputed: '仲裁中', refunded: '已退款', closed: '已关闭'
};
const TXN_NAME = {
  recharge: '账户充值', pay_escrow: '付款-资金托管', gateway_pay: '在线支付-托管',
  sale: '销售收入', refund: '仲裁退款', withdraw: '提现'
};

const state = {
  token: localStorage.getItem('token') || '',
  user: null
};
const $view = () => document.getElementById('view');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
  const r = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
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

/* ---------- 图片/视频上传 ---------- */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1000;
      let w = img.width, h = img.height;
      if (w > max || h > max) { const s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
function readFile(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
}
async function uploadOne(file, kind) {
  if (kind === 'video' && file.size > 30 * 1024 * 1024) throw new Error('视频不能超过30MB');
  const dataUrl = kind === 'image' ? await compressImage(file) : await readFile(file);
  const r = await api('/api/upload', { method: 'POST', body: { dataUrl, kind } });
  return r.url;
}
/* 多图上传组件：挂载到容器，收集 urls */
function bindUploader(container, { max = 6, kind = 'image' } = {}) {
  const urls = [];
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = kind === 'video' ? 'video/*' : 'image/*';
  input.multiple = kind === 'image';
  input.style.display = 'none';
  container.appendChild(input);
  function render() {
    container.innerHTML = '';
    urls.forEach((u, i) => {
      const d = document.createElement('div');
      d.className = 'up-item';
      d.innerHTML = kind === 'image'
        ? `<img src="${u}"><span class="del" data-del="${i}">×</span>`
        : `<video src="${u}" style="width:100%;height:100%;object-fit:cover"></video><span class="del" data-del="${i}">×</span>`;
      container.appendChild(d);
    });
    if (urls.length < (kind === 'video' ? 1 : max)) {
      const add = document.createElement('div');
      add.className = 'up-add';
      add.innerHTML = kind === 'video' ? '<span class="plus">🎬</span>上传录屏' : '<span class="plus">+</span>上传图片';
      add.onclick = () => input.click();
      container.appendChild(add);
    }
    container.appendChild(input);
    container.querySelectorAll('[data-del]').forEach(el => el.onclick = (e) => {
      e.stopPropagation();
      urls.splice(Number(el.dataset.del), 1); render();
    });
  }
  input.onchange = async () => {
    for (const f of input.files) {
      if (urls.length >= max && kind === 'image') break;
      try { toast('上传中...'); const u = await uploadOne(f, kind); urls.push(u); }
      catch (e) { toast(e.message); }
    }
    input.value = '';
    render();
    toast('上传完成');
  };
  render();
  return { get urls() { return urls; } };
}

/* ---------- 路由 ---------- */
const routes = [
  [/^#\/home$/, renderHome],
  [/^#\/product\/(\w+)$/, renderProduct],
  [/^#\/publish$/, renderPublish],
  [/^#\/seller$/, renderSellerApply],
  [/^#\/orders$/, renderOrders],
  [/^#\/sales$/, renderSales],
  [/^#\/order\/(\w+)$/, renderOrderDetail],
  [/^#\/wallet$/, renderWallet],
  [/^#\/admin$/, renderAdmin],
  [/^#\/me$/, renderMe],
  [/^#\/login$/, renderLogin],
  [/^#\/register$/, renderRegister],
];
async function router() {
  closeModal();
  window.scrollTo(0, 0);
  const hash = location.hash || '#/home';
  const path = hash.split('?')[0];
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      setTab(hash);
      try { await fn(...m.slice(1)); } catch (e) { $view().innerHTML = `<div class="empty"><div class="big">😵</div>${esc(e.message)}</div>`; }
      return;
    }
  }
  location.hash = '#/home';
}
function setTab(hash) {
  const map = { '#/home': 'home', '#/publish': 'publish', '#/orders': 'orders', '#/sales': 'orders', '#/me': 'me', '#/wallet': 'me', '#/admin': 'me' };
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === map[hash.split('?')[0]]));
}
window.addEventListener('hashchange', router);

/* ================= 首页 ================= */
async function renderHome() {
  const cat = (location.hash.split('?cat=')[1] || 'all');
  const q = (new URLSearchParams((location.hash.split('?')[1] || ''))).get('q') || '';
  $view().innerHTML = `
    <div class="home-banner">
      <h1>游易达 · 游戏交易担保平台</h1>
      <p>账号 / 皮肤 / 道具 / 游戏币，全程担保交易<br>资金平台托管，验货确认后才打款给卖家</p>
      <div class="flow"><span>① 买家付款</span><i>→</i><span>② 资金托管</span><i>→</i><span>③ 卖家发货</span><i>→</i><span>④ 确认收货</span><i>→</i><span>⑤ 平台打款</span></div>
    </div>
    <div class="searchbar">🔍<input id="searchInput" placeholder="搜索游戏名 / 账号 / 道具 / 游戏币" value="${esc(q)}"></div>
    <div class="cats">${CATS.map(c => `<div class="cat-chip ${c.k === cat ? 'on' : ''}" data-cat="${c.k}">${c.n}</div>`).join('')}</div>
    <div class="grid" id="pgrid"><div class="empty" style="grid-column:1/3">加载中...</div></div>
    <div style="height:20px"></div>`;
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') location.hash = '#/home?q=' + encodeURIComponent(e.target.value.trim());
  });
  document.querySelectorAll('.cat-chip').forEach(el => el.onclick = () => {
    location.hash = '#/home?cat=' + el.dataset.cat + (q ? '&q=' + encodeURIComponent(q) : '');
  });
  const { list } = await api(`/api/products?category=${cat}&q=${encodeURIComponent(q)}`);
  const grid = document.getElementById('pgrid');
  if (!list.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/3"><div class="big">📦</div>暂无相关商品</div>`; return; }
  grid.innerHTML = list.map(p => `
    <div class="pcard" data-pid="${p.id}">
      <div class="ph"><span class="ct">${CAT_NAME[p.category]}</span>
        <img src="${p.images[0]}" onerror="this.style.display='none'"></div>
      <div class="pb">
        <div class="tt">${esc(p.title)}</div>
        <div class="mt"><span class="price pr">${p.price}</span><span class="gm">${esc(p.game)}</span></div>
        <div class="sv"><span class="vbadge">✔ 已实名</span><span>· 成交${p.seller ? p.seller.done : 0}单</span></div>
      </div>
    </div>`).join('');
  grid.querySelectorAll('.pcard').forEach(el => el.onclick = () => location.hash = '#/product/' + el.dataset.pid);
}

/* ================= 商品详情 ================= */
async function renderProduct(id) {
  const { product: p } = await api('/api/products/' + id);
  const mine = state.user && state.user.id === p.sellerId;
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>商品详情</div>
    <div class="swiper">${p.images.map((im, i) => `<div class="slide"><img src="${im}" onerror="this.style.display='none'">${p.images.length > 1 ? `<span class="idx">${i + 1}/${p.images.length}</span>` : ''}</div>`).join('')}</div>
    <div class="detail-price"><span class="big">${p.price}</span><span class="old">¥${(p.price * 1.3).toFixed(0)}</span>
      <span style="margin-left:auto;font-size:12px;opacity:.9">${p.views}人看过</span></div>
    <div class="card">
      <div style="font-size:16px;font-weight:700;line-height:1.5">${esc(p.title)}</div>
      <div style="margin-top:8px"><span class="tag">${CAT_NAME[p.category]}</span><span class="tag blue">${esc(p.game)}</span><span class="tag green">担保交易</span></div>
    </div>
    <div class="card">
      <div class="kv"><span class="k">商品描述</span><span class="v desc-box">${esc(p.desc) || '卖家很懒，没有填写描述'}</span></div>
      <div class="guarantee">
        <h4>🛡️ 平台担保交易流程</h4>
        <div class="step"><b>第一步</b>买家下单付款，货款由<span style="color:var(--primary);font-weight:700">平台托管</span>，卖家拿不到钱</div>
        <div class="step"><b>第二步</b>卖家移交游戏账号/道具并上传交接凭证</div>
        <div class="step"><b>第三步</b>买家验货无误后确认收货，平台才打款给卖家</div>
        <div class="step"><b>维权</b>遇到骗号、虚假发货，可上传截图/录屏申请<span style="color:var(--red);font-weight:700">人工仲裁</span>，查实全额退款</div>
      </div>
    </div>
    <div class="card">
      <div class="row between">
        <div class="row" style="gap:10px">
          <div class="avatar" style="width:42px;height:42px;font-size:18px;background:var(--primary-l)">🧑‍💼</div>
          <div><div style="font-weight:700;font-size:14px">${esc(p.seller ? p.seller.name : '卖家')} <span class="vbadge" style="font-size:11px">✔实名</span></div>
          <div class="muted">历史成交 ${p.seller ? p.seller.done : 0} 单</div></div>
        </div>
        ${mine ? '<span class="tag gray">这是我的商品</span>' : '<span class="tag gold">认证卖家</span>'}
      </div>
    </div>
    <div style="height:76px"></div>
    <div class="bottom-bar">
      <div class="bb-info"><div class="price p">${p.price}</div><div class="muted">平台担保 · 确认收货后打款</div></div>
      ${mine
        ? `<button class="btn gray" data-act="toggle-off" data-id="${p.id}">${p.status === 'on' ? '下架商品' : '重新上架'}</button>`
        : `<button class="btn" data-act="buy" data-id="${p.id}">立即购买</button>`}
    </div>`;
}

/* ================= 发布商品 ================= */
async function renderPublish() {
  if (!requireLogin()) return;
  const u = state.user;
  if (u.sellerStatus !== 'approved') {
    $view().innerHTML = `
      <div class="navbar"><button class="back" data-act="back">‹</button>发布商品</div>
      <div class="empty" style="padding-top:90px">
        <div class="big">🏪</div>
        <div style="font-size:15px;color:#333;margin-bottom:8px">${u.sellerStatus === 'pending' ? '卖家资质审核中' : u.sellerStatus === 'rejected' ? '入驻申请未通过' : '您还不是卖家'}</div>
        <div class="muted" style="margin-bottom:22px">${u.sellerStatus === 'pending' ? '平台将在1-2个工作日内完成资质审核' : u.sellerStatus === 'rejected' ? '可重新提交入驻申请' : '完成实名认证与卖家入驻审核后即可发布商品'}</div>
        <a class="btn" href="#/seller">${u.sellerStatus === 'rejected' ? '重新申请入驻' : '去申请卖家入驻'}</a>
      </div>`;
    return;
  }
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>发布商品</div>
    <div class="page-head" style="padding-bottom:16px"><h2>上架新商品</h2><p>商品上架后买家即可下单，交易全程由平台担保</p></div>
    <div class="card" style="margin-top:-6px">
      <div class="form-group"><label>商品分类<em>*</em></label>
        <select id="f-cat">${CATS.filter(c => c.k !== 'all').map(c => `<option value="${c.k}">${c.n}</option>`).join('')}</select></div>
      <div class="form-group"><label>游戏名称<em>*</em></label><input id="f-game" placeholder="如：王者荣耀 / 原神 / CS2"></div>
      <div class="form-group"><label>商品标题<em>*</em></label><input id="f-title" maxlength="60" placeholder="如：V10账号 3水晶 212皮肤 秒换绑"></div>
      <div class="form-group"><label>商品价格（元）<em>*</em></label><input id="f-price" type="number" placeholder="0.00" min="1"></div>
      <div class="form-group"><label>商品描述<em>*</em></label><textarea id="f-desc" maxlength="2000" placeholder="详细描述账号/道具信息、换绑方式、发货流程等，信息越完整越容易成交"></textarea></div>
      <div class="form-group"><label>商品图片<em>*</em>（最多6张）</label>
        <div class="uploader" id="f-imgs"></div>
        <div class="tip">请上传游戏内截图、账号仓库/皮肤展示图，首图将作为封面</div></div>
      <button class="btn block" data-act="submit-product">立即上架</button>
    </div>`;
  const up = bindUploader(document.getElementById('f-imgs'), { max: 6, kind: 'image' });
  document.querySelector('[data-act="submit-product"]').onclick = async () => {
    const body = {
      category: document.getElementById('f-cat').value,
      game: document.getElementById('f-game').value.trim(),
      title: document.getElementById('f-title').value.trim(),
      price: Number(document.getElementById('f-price').value),
      desc: document.getElementById('f-desc').value.trim(),
      images: up.urls
    };
    try {
      const r = await api('/api/products', { method: 'POST', body });
      toast('上架成功');
      location.hash = '#/product/' + r.product.id;
    } catch (e) { toast(e.message); }
  };
}

/* ================= 卖家入驻 ================= */
async function renderSellerApply() {
  if (!requireLogin()) return;
  const u = state.user;
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>卖家入驻</div>
    <div class="page-head" style="padding-bottom:16px"><h2>卖家资质审核</h2><p>实名认证信息已自动带入，平台人工审核通过后即可上架商品</p></div>
    <div class="card" style="margin-top:-6px">
      <div class="kv"><span class="k">真实姓名</span><span class="v">${esc(u.realName)} <span class="vbadge">✔ 已实名</span></span></div>
      <div class="kv"><span class="k">身份证号</span><span class="v">${esc(u.idCard.slice(0, 6))}********${esc(u.idCard.slice(-4))}</span></div>
      <div class="kv"><span class="k">手机号</span><span class="v">${esc(u.phone)}</span></div>
      <div class="kv"><span class="k">审核状态</span><span class="v"><b style="color:${u.sellerStatus === 'approved' ? 'var(--green)' : u.sellerStatus === 'pending' ? 'var(--gold)' : u.sellerStatus === 'banned' ? 'var(--red)' : 'var(--sub)'}">
        ${({ none: '未入驻', pending: '审核中', approved: '已通过 ✔', rejected: '未通过，可重新申请', banned: '已被封禁' })[u.sellerStatus]}</b>
        ${u.sellerStatus === 'rejected' && u.sellerInfo ? `<div class="muted" style="margin-top:4px">驳回原因：${esc(u.sellerInfo.rejectReason || '资料不完整')}</div>` : ''}</span></div>
    </div>
    ${u.sellerStatus === 'approved' ? '<div class="empty"><div class="big">🎉</div>您已通过卖家资质审核<br><a class="btn" style="display:inline-block;margin-top:16px" href="#/publish">去发布商品</a></div>' : `
    <div class="card">
      <div class="form-group"><label>联系方式（QQ/微信）<em>*</em></label><input id="s-contact" placeholder="用于买家与平台联系您"></div>
      <div class="form-group"><label>主营游戏<em>*</em></label><input id="s-games" placeholder="如：王者荣耀、原神、CS2"></div>
      <div class="form-group"><label>交易经验/资质说明</label><textarea id="s-exp" placeholder="如：从事游戏交易X年，累计成交X单，可提供换绑/录屏等服务"></textarea></div>
      <button class="btn block" data-act="submit-seller">${u.sellerStatus === 'rejected' ? '重新提交审核' : '提交入驻申请'}</button>
      <div class="tip" style="text-align:center;margin-top:10px">提交后平台将人工审核您的资质，通常1-2个工作日完成</div>
    </div>`}`;
  const btn = document.querySelector('[data-act="submit-seller"]');
  if (btn) btn.onclick = async () => {
    try {
      const r = await api('/api/seller/apply', {
        method: 'POST',
        body: {
          contact: document.getElementById('s-contact').value.trim(),
          mainGames: document.getElementById('s-games').value.trim(),
          experience: document.getElementById('s-exp').value.trim()
        }
      });
      state.user = r.user;
      toast('已提交，请等待平台审核');
      location.hash = '#/me';
    } catch (e) { toast(e.message); }
  };
}

/* ================= 订单列表（买家） ================= */
async function renderOrders() {
  if (!requireLogin()) return;
  const tab = (location.hash.split('?tab=')[1] || 'all');
  $view().innerHTML = `
    <div class="navbar">我买到的</div>
    <div class="tabs">${[['all', '全部'], ['pending_pay', '待付款'], ['paid', '待发货'], ['delivered', '待收货'], ['completed', '已完成'], ['disputed', '仲裁中']].map(t =>
      `<div class="tab ${t[0] === tab ? 'on' : ''}" data-tab="${t[0]}">${t[1]}</div>`).join('')}</div>
    <div id="olist"><div class="empty">加载中...</div></div>`;
  document.querySelectorAll('.tabs .tab').forEach(el => el.onclick = () => location.hash = '#/orders?tab=' + el.dataset.tab);
  const { list } = await api('/api/my/orders?role=buyer');
  const filtered = tab === 'all' ? list : list.filter(o => o.status === tab);
  renderOrderList(filtered, 'buyer');
}
async function renderSales() {
  if (!requireLogin()) return;
  const tab = (location.hash.split('?tab=')[1] || 'all');
  $view().innerHTML = `
    <div class="navbar">我卖出的</div>
    <div class="tabs">${[['all', '全部'], ['paid', '待发货'], ['delivered', '待收货'], ['completed', '已完成'], ['disputed', '仲裁中']].map(t =>
      `<div class="tab ${t[0] === tab ? 'on' : ''}" data-tab="${t[0]}">${t[1]}</div>`).join('')}</div>
    <div id="olist"><div class="empty">加载中...</div></div>`;
  document.querySelectorAll('.tabs .tab').forEach(el => el.onclick = () => location.hash = '#/sales?tab=' + el.dataset.tab);
  const { list } = await api('/api/my/orders?role=seller');
  const filtered = tab === 'all' ? list : list.filter(o => o.status === tab);
  renderOrderList(filtered, 'seller');
}
function renderOrderList(list, role) {
  const box = document.getElementById('olist');
  if (!list.length) { box.innerHTML = `<div class="empty"><div class="big">📭</div>暂无订单</div>`; return; }
  box.innerHTML = list.map(o => `
    <div class="order-card" data-oid="${o.id}">
      <div class="order-head"><span>订单号 ${o.no}</span><span class="status-badge st-${o.status}">${STATUS[o.status]}</span></div>
      <div class="order-body">
        <img class="thumb" src="${o.item.image}" onerror="this.style.visibility='hidden'">
        <div class="oinfo">
          <div class="t">${esc(o.item.title)}</div>
          <div class="g">${CAT_NAME[o.item.category]} · ${esc(o.item.game)}</div>
          <div class="g">${role === 'buyer' ? '资金平台托管，确认收货后打款卖家' : '买家付款后资金由平台托管'}</div>
        </div>
        <div style="text-align:right;flex:none"><span class="price" style="font-size:16px">${o.price}</span></div>
      </div>
      <div class="order-foot">
        <div class="btns">
          ${role === 'buyer' ? buyerActions(o) : sellerActions(o)}
        </div>
      </div>
    </div>`).join('');
  box.querySelectorAll('.order-card').forEach(el => {
    el.onclick = e => { if (!e.target.closest('button')) location.hash = '#/order/' + el.dataset.oid; };
  });
}
function buyerActions(o) {
  const b = (act, txt, cls) => `<button class="btn ${cls || ''} sm" data-act="${act}" data-id="${o.id}">${txt}</button>`;
  switch (o.status) {
    case 'pending_pay': return b('cancel-order', '取消订单', 'gray') + b('pay-order', '去付款');
    case 'paid': return b('dispute-order', '申请仲裁', 'gray');
    case 'delivered': return b('dispute-order', '申请仲裁', 'gray') + b('confirm-order', '确认收货', 'green');
    case 'disputed': return b('', '仲裁处理中…', 'gray disabled');
    case 'completed': return b('', '交易完成', 'gray disabled');
    case 'refunded': return b('', '已退款', 'gray disabled');
    default: return '';
  }
}
function sellerActions(o) {
  const b = (act, txt, cls) => `<button class="btn ${cls || ''} sm" data-act="${act}" data-id="${o.id}">${txt}</button>`;
  switch (o.status) {
    case 'paid': return b('deliver-order', '去发货');
    case 'delivered': return b('', '等待买家确认', 'gray disabled');
    case 'disputed': return b('', '仲裁处理中…', 'gray disabled');
    case 'completed': return b('', '已完成', 'gray disabled');
    default: return '';
  }
}

/* ================= 订单详情 ================= */
async function renderOrderDetail(id) {
  if (!requireLogin()) return;
  const r = await api('/api/orders/' + id);
  const o = r.order;
  const isBuyer = state.user.id === o.buyerId;
  const isSeller = state.user.id === o.sellerId;
  const steps = ['下单', '付款托管', '卖家发货', '交易完成'];
  const stepIdx = { pending_pay: 0, paid: 1, delivered: 2, completed: 3, refunded: 3, disputed: o.delivery ? 2 : 1, closed: 0 }[o.status] ?? 0;
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>订单详情</div>
    <div style="background:linear-gradient(135deg,#ff7a45,#ff5a36);color:#fff;padding:18px 16px 22px;text-align:center">
      <div style="font-size:18px;font-weight:700">${o.status === 'disputed' ? '⚖️ 纠纷仲裁处理中' : STATUS[o.status]}</div>
      <div style="font-size:12px;opacity:.9;margin-top:5px">
        ${o.status === 'pending_pay' ? '请尽快付款，付款后资金由平台托管' :
          o.status === 'paid' ? '资金已托管，等待卖家移交商品' :
          o.status === 'delivered' ? '卖家已发货，请尽快验货并确认收货' :
          o.status === 'completed' ? '平台已将托管款项打给卖家' :
          o.status === 'refunded' ? '托管款项已全额退回买家' :
          o.status === 'disputed' ? '平台客服正在人工审核双方凭证' : '订单已关闭'}</div>
    </div>
    <div class="card">
      <div class="stepper">
        ${steps.map((s, i) => `<div class="stp ${i < stepIdx ? 'done' : i === stepIdx ? 'cur' : ''}"><div class="dot">${i < stepIdx ? '✓' : i + 1}</div>${s}</div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="order-body" style="padding:0 0 10px">
        <img class="thumb" src="${o.item.image}" onerror="this.style.visibility='hidden'">
        <div class="oinfo">
          <div class="t" style="font-size:14px">${esc(o.item.title)}</div>
          <div class="g" style="margin-top:6px">${CAT_NAME[o.item.category]} · ${esc(o.item.game)}</div>
        </div>
        <div style="flex:none"><span class="price" style="font-size:18px">${o.price}</span></div>
      </div>
      <div class="kv"><span class="k">订单编号</span><span class="v">${o.no}</span></div>
      <div class="kv"><span class="k">下单时间</span><span class="v">${fmtTime(o.createdAt)}</span></div>
      <div class="kv"><span class="k">付款方式</span><span class="v">${o.method === 'gateway' ? '在线支付（支付宝/微信）' : o.method === 'balance' ? '余额支付' : '未付款'}</span></div>
      ${isBuyer && r.seller && r.seller.contact ? `<div class="kv"><span class="k">卖家联系方式</span><span class="v" style="color:var(--blue)">${esc(r.seller.contact)}</span></div>` : ''}
      ${isSeller && r.buyer && r.buyer.phone ? `<div class="kv"><span class="k">买家手机号</span><span class="v">${esc(r.buyer.phone)}</span></div>` : ''}
    </div>
    ${o.delivery ? `
    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">📦 卖家发货凭证 ${o.delivery.at ? `<span class="muted" style="font-weight:400">（${fmtTime(o.delivery.at)}）</span>` : ''}</div>
      <div class="desc-box" style="font-size:13px;line-height:1.7">${esc(o.delivery.desc)}</div>
      ${o.delivery.images && o.delivery.images.length ? `<div class="evidence-imgs">${o.delivery.images.map(im => `<img src="${im}" data-act="preview" data-src="${im}">`).join('')}</div>` : ''}
    </div>` : ''}
    ${o.dispute ? `
    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">⚖️ 纠纷仲裁</div>
      <div class="dispute-box">
        <h5>申请理由（${o.dispute.byRole === 'buyer' ? '买家' : '卖家'}发起 · ${fmtTime(o.dispute.at)}）</h5>
        <p>${esc(o.dispute.reason)}</p>
        ${o.dispute.images && o.dispute.images.length ? `<div class="evidence-imgs">${o.dispute.images.map(im => `<img src="${im}" data-act="preview" data-src="${im}">`).join('')}</div>` : ''}
        ${o.dispute.video ? `<div class="video-box"><video src="${o.dispute.video}" controls playsinline></video><div class="muted" style="margin-top:4px">▲ 游戏录屏凭证</div></div>` : ''}
      </div>
      ${o.dispute.status === 'closed' ? `
        <div class="result-box ${o.dispute.result === 'buyer' ? 'win-buyer' : 'win-seller'}">
          <b>仲裁结果（${fmtTime(o.dispute.handledAt)}）：${o.dispute.result === 'buyer' ? '买家胜诉，已全额退款' : '卖家胜诉，已打款给卖家'}</b>
          ${o.dispute.note ? `<div style="margin-top:5px">客服说明：${esc(o.dispute.note)}</div>` : ''}
        </div>` : `<div class="muted" style="margin-top:10px">⏳ 客服正在人工审核截图与录屏凭证，请保持电话畅通</div>`}
    </div>` : ''}
    <div class="card">
      <div style="font-weight:700;margin-bottom:6px">交易进度</div>
      <div class="timeline">${o.timeline.map(t => `
        <div class="tl"><div class="td"></div><div class="tt">${esc(t.text)}<small>${fmtTime(t.at)}</small></div></div>`).join('')}</div>
    </div>
    <div style="height:20px"></div>
    <div class="bottom-bar">
      <div class="bb-info"><div class="price p">${o.price}</div><div class="muted">${o.status === 'pending_pay' ? '付款后资金由平台托管' : '平台担保交易'}</div></div>
      ${isBuyer ? buyerActions(o) : isSeller ? sellerActions(o) : ''}
    </div>`;
  bindPreview();
}

/* ================= 钱包 ================= */
async function renderWallet() {
  if (!requireLogin()) return;
  const { balance, txns } = await api('/api/wallet');
  $view().innerHTML = `
    <div class="navbar"><button class="back" data-act="back">‹</button>我的钱包</div>
    <div class="wallet-card">
      <div class="lb">账户余额（元）</div>
      <div class="bal">${balance.toFixed(2)}</div>
      <div class="wbtns">
        <button data-act="recharge">充值</button>
        <button data-act="withdraw">提现</button>
      </div>
    </div>
    <div class="card" style="padding:4px 0">
      <div style="padding:12px 16px 6px;font-weight:700">交易明细</div>
      ${txns.length ? txns.map(t => `
        <div class="txn">
          <div class="tic">${({ recharge: '💰', pay_escrow: '🔒', gateway_pay: '💳', sale: '✅', refund: '↩️', withdraw: '🏦' })[t.type] || '📝'}</div>
          <div class="tinfo"><div class="t1">${TXN_NAME[t.type] || t.type}</div><div class="t2">${fmtTime(t.at)}${t.ref ? ' · ' + esc(t.ref) : ''}</div></div>
          <div class="tam ${t.amount > 0 ? 'plus' : 'minus'}">${t.amount > 0 ? '+' : ''}${t.amount.toFixed(2)}</div>
        </div>`).join('') : '<div class="empty">暂无交易记录</div>'}
    </div>`;
  document.querySelector('[data-act="recharge"]').onclick = () => {
    let method = inWechat ? 'wechat' : 'alipay';
    const render = () => showModal(`
      <h3>账户充值</h3>
      <div class="form-group"><label>充值金额（元）</label><input id="rc-amt" type="number" placeholder="请输入金额" value="500"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">${[100, 500, 1000, 5000].map(v => `<button class="cat-chip" data-rc="${v}">${v}元</button>`).join('')}</div>
      <div class="pay-methods">
        <div class="pay-m ${method === 'alipay' ? 'on' : ''}" data-m="alipay">
          <span class="pic">🅰️</span><div class="pn">支付宝<small>跳转支付宝App充值</small></div><span class="radio"></span>
        </div>
        <div class="pay-m ${method === 'wechat' ? 'on' : ''}" data-m="wechat">
          <span class="pic">💚</span><div class="pn">微信支付<small>${inWechat ? '微信内支付' : '跳转微信充值'}</small></div><span class="radio"></span>
        </div>
      </div>
      <button class="btn block" data-act="do-recharge">确认充值</button>`);
    render();
    document.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => document.getElementById('rc-amt').value = b.dataset.rc);
    document.querySelectorAll('.pay-m').forEach(m => m.onclick = () => { method = m.dataset.m; render(); document.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => document.getElementById('rc-amt').value = b.dataset.rc); });
    document.querySelector('[data-act="do-recharge"]').onclick = async () => {
      const amount = Number(document.getElementById('rc-amt').value);
      if (!amount || amount <= 0) return toast('请输入充值金额');
      const modal = document.querySelector('.modal');
      modal.innerHTML = `<div class="cashier"><div class="spin"></div><div style="font-size:15px">正在创建充值订单...</div></div>`;
      try {
        const r = await api('/api/wallet/recharge', { method: 'POST', body: { amount, method } });
        const pollFn = () => api('/api/wallet/recharge/status?no=' + r.rechargeNo);
        if (r.channel === 'alipay') {
          openExternalPayAndWait(r.payUrl, pollFn, '支付宝');
        } else if (r.channel === 'wechat') {
          if (r.type === 'jsapi') {
            modal.innerHTML = `<div class="cashier"><div class="spin"></div><div style="font-size:15px">正在调起微信支付...</div></div>`;
            await wechatJsapiPay(r.payParams);
            modal.innerHTML = `<div class="cashier"><div class="spin"></div><div style="font-size:15px">正在确认充值结果...</div></div>`;
            await pollStatus(pollFn);
            modal.innerHTML = `<div class="cashier"><div class="ok">✅</div><div style="font-size:16px;font-weight:700">充值成功</div>
              <button class="btn block" style="margin-top:18px" data-act="pay-done">完成</button></div>`;
            modal.querySelector('[data-act="pay-done"]').onclick = () => { closeModal(); loadMe(); router(); };
          } else {
            openExternalPayAndWait(r.mwebUrl, pollFn, '微信');
          }
        }
      } catch (e) {
        modal.innerHTML = `<div class="cashier"><div class="ok" style="color:var(--red)">❌</div><div style="font-size:15px;margin-bottom:16px">${esc(e.message)}</div>
          <button class="btn block" data-act="pay-retry">返回重试</button></div>`;
        modal.querySelector('[data-act="pay-retry"]').onclick = render;
      }
    };
  };
  document.querySelector('[data-act="withdraw"]').onclick = () => {
    showModal(`<h3>申请提现</h3>
      <div class="form-group"><label>提现金额（元）</label><input id="wd-amt" type="number" placeholder="可提现余额 ${balance.toFixed(2)} 元"></div>
      <div class="tip" style="margin-bottom:14px">提现到绑定的支付宝/银行卡，1-3个工作日到账（演示环境）</div>
      <button class="btn block" data-act="do-withdraw">确认提现</button>`);
    document.querySelector('[data-act="do-withdraw"]').onclick = async () => {
      try { await api('/api/wallet/withdraw', { method: 'POST', body: { amount: Number(document.getElementById('wd-amt').value) } });
        closeModal(); toast('提现申请已提交'); await loadMe(); router();
      } catch (e) { toast(e.message); }
    };
  };
}

/* ================= 我的 ================= */
async function renderMe() {
  if (!state.user) { location.hash = '#/login'; return; }
  const u = state.user;
  const sellerTip = {
    none: ['成为认证卖家', '实名入驻 · 发布商品赚钱', '去入驻'],
    pending: ['卖家资质审核中', '平台将在1-2个工作日内完成审核', '查看进度'],
    approved: ['认证卖家 ✔', '您已通过资质审核，可发布商品', '卖家中心'],
    rejected: ['入驻申请未通过', '可补充资料后重新申请', '重新申请'],
    banned: ['卖家资格已被封禁', '如有疑问请联系平台客服', '查看原因']
  }[u.sellerStatus];
  $view().innerHTML = `
    <div class="me-head">
      <div class="avatar">${u.role === 'admin' ? '🛡️' : '🧑'}</div>
      <div class="info">
        <div class="nm">${esc(u.realName)} <span style="font-size:11px;background:rgba(255,255,255,.25);padding:2px 8px;border-radius:99px">✔ 已实名</span></div>
        <div class="ph">${esc(u.phone)} · ID:${u.id}</div>
      </div>
    </div>
    <div class="me-grid">
      <div class="mi" data-go="#/wallet" style="cursor:pointer"><b>¥${u.balance.toFixed(0)}</b>钱包余额</div>
      <div class="mi" data-go="#/orders" style="cursor:pointer"><b>订单</b>我买到的</div>
      <div class="mi" data-go="#/sales" style="cursor:pointer"><b>卖单</b>我卖出的</div>
    </div>
    <div class="seller-banner ${u.sellerStatus}">
      <div style="font-size:30px">🏪</div>
      <div class="txt"><b>${sellerTip[0]}</b>${sellerTip[1]}</div>
      <a class="go" href="${u.sellerStatus === 'approved' ? '#/sales' : '#/seller'}">${sellerTip[2]}</a>
    </div>
    <div class="menu">
      <div class="mi2" data-go="#/publish"><span class="icon">➕</span>发布商品<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/orders"><span class="icon">📦</span>我买到的<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/sales"><span class="icon">📤</span>我卖出的<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/wallet"><span class="icon">💰</span>我的钱包<span class="arrow">›</span></div>
      <div class="mi2" data-go="#/seller"><span class="icon">📇</span>卖家入驻 / 资质<span class="arrow">›</span></div>
      ${u.role === 'admin' ? '<div class="mi2" data-go="#/admin"><span class="icon">🛡️</span>平台管理后台<span class="arrow">›</span></div>' : ''}
      <div class="mi2" data-act="logout"><span class="icon">🚪</span>退出登录<span class="arrow">›</span></div>
    </div>
    <div class="muted" style="text-align:center;padding:10px 0 30px">客服热线 400-888-0000 · 交易纠纷 7×24小时人工仲裁</div>`;
  document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => location.hash = el.dataset.go);
  document.querySelector('[data-act="logout"]').onclick = () => {
    state.token = ''; state.user = null;
    localStorage.removeItem('token');
    toast('已退出登录');
    location.hash = '#/home';
  };
}

/* ================= 登录 / 注册 ================= */
function renderLogin() {
  $view().innerHTML = `
    <div class="auth-wrap">
      <div class="auth-head"><div class="logo">游易达</div><p>游戏账号 · 皮肤 · 道具 · 游戏币 担保交易平台</p></div>
      <div class="auth-card">
        <div class="form-group"><label>手机号</label><input id="lg-phone" placeholder="请输入手机号" value="13900000002"></div>
        <div class="form-group"><label>密码</label><input id="lg-pw" type="password" placeholder="请输入密码" value="buyer123"></div>
        <button class="btn block" data-act="do-login">登 录</button>
        <div class="auth-switch">还没有账号？<a href="#/register">实名注册</a></div>
        <div class="tip" style="margin-top:14px;line-height:1.8">演示账号：<br>管理员 13800000000 / admin123（审核卖家·纠纷仲裁）<br>卖家 13900000001 / seller123　买家 13900000002 / buyer123</div>
      </div>
    </div>`;
  document.querySelector('[data-act="do-login"]').onclick = async () => {
    try {
      const r = await api('/api/login', {
        method: 'POST',
        body: { phone: document.getElementById('lg-phone').value.trim(), password: document.getElementById('lg-pw').value }
      });
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
      <div class="auth-head"><div class="logo">实名注册</div><p>实名信息仅用于资质审核与交易安全，平台加密存储</p></div>
      <div class="auth-card">
        <div class="form-group"><label>手机号<em>*</em></label><input id="rg-phone" placeholder="11位手机号" maxlength="11"></div>
        <div class="form-group"><label>登录密码<em>*</em></label><input id="rg-pw" type="password" placeholder="至少6位"></div>
        <div class="form-group"><label>真实姓名<em>*</em></label><input id="rg-name" placeholder="与身份证一致"></div>
        <div class="form-group"><label>身份证号<em>*</em></label><input id="rg-id" placeholder="18位身份证号" maxlength="18"></div>
        <div class="tip" style="margin-bottom:12px">📌 注册即完成实名认证；如需出售商品，再提交「卖家入驻」资质审核</div>
        <button class="btn block" data-act="do-register">注册并登录</button>
        <div class="auth-switch">已有账号？<a href="#/login">直接登录</a></div>
      </div>
    </div>`;
  document.querySelector('[data-act="do-register"]').onclick = async () => {
    try {
      const r = await api('/api/register', {
        method: 'POST',
        body: {
          phone: document.getElementById('rg-phone').value.trim(),
          password: document.getElementById('rg-pw').value,
          realName: document.getElementById('rg-name').value.trim(),
          idCard: document.getElementById('rg-id').value.trim()
        }
      });
      state.token = r.token; state.user = r.user;
      localStorage.setItem('token', r.token);
      toast('注册成功，已完成实名');
      location.hash = '#/me';
    } catch (e) { toast(e.message); }
  };
}

/* ================= 管理后台 ================= */
async function renderAdmin() {
  if (!requireLogin()) return;
  if (state.user.role !== 'admin') { $view().innerHTML = '<div class="empty"><div class="big">🚫</div>无管理员权限</div>'; return; }
  const tab = (location.hash.split('?tab=')[1] || 'sellers');
  $view().innerHTML = `
    <div class="navbar">🛡️ 平台管理后台</div>
    <div class="tabs">
      <div class="tab ${tab === 'sellers' ? 'on' : ''}" data-atab="sellers">卖家审核</div>
      <div class="tab ${tab === 'disputes' ? 'on' : ''}" data-atab="disputes">纠纷仲裁</div>
      <div class="tab ${tab === 'products' ? 'on' : ''}" data-atab="products">商品管理</div>
    </div>
    <div id="admin-body"><div class="empty">加载中...</div></div>`;
  document.querySelectorAll('.tabs .tab').forEach(el => el.onclick = () => location.hash = '#/admin?tab=' + el.dataset.atab);
  const ov = await api('/api/admin/overview');
  const bar = `<div class="admin-stat">
    <div class="astat"><b>${ov.users}</b><span>注册用户</span></div>
    <div class="astat primary"><b>¥${ov.escrow.toFixed(0)}</b><span>托管中资金</span></div>
    <div class="astat warn"><b>${ov.pendingSellers}</b><span>待审卖家</span></div>
    <div class="astat red"><b>${ov.openDisputes}</b><span>待处理纠纷</span></div></div>`;
  const box = document.getElementById('admin-body');
  if (tab === 'sellers') {
    const { list } = await api('/api/admin/sellers');
    box.innerHTML = bar + (list.length ? list.map(u => `
      <div class="audit-card">
        <div class="hd"><div class="nm">${esc(u.realName)} <span class="tag ${u.status === 'approved' ? 'green' : u.status === 'pending' ? 'gold' : 'gray'}">
          ${({ pending: '待审核', approved: '已通过', rejected: '已驳回', banned: '已封禁' })[u.status]}</span></div>
          <div class="muted">${fmtTime(u.createdAt)}</div></div>
        <div class="kv-mini">
          📱 手机：<b>${u.phone}</b>　🆔 身份证：<b>${u.idCard}</b><br>
          📞 联系方式：<b>${esc((u.sellerInfo && u.sellerInfo.contact) || '-')}</b><br>
          🎮 主营游戏：<b>${esc((u.sellerInfo && u.sellerInfo.mainGames) || '-')}</b><br>
          📝 资质说明：${esc((u.sellerInfo && u.sellerInfo.experience) || '-')}
        </div>
        ${u.status === 'pending' ? `<div class="audit-actions">
          <button class="btn green" data-act="audit-seller" data-id="${u.id}" data-approve="1">审核通过</button>
          <button class="btn gray" data-act="audit-seller" data-id="${u.id}" data-approve="0">驳回</button></div>` : ''}
      </div>`).join('') : '<div class="empty"><div class="big">✅</div>暂无入驻申请</div>');
  } else if (tab === 'disputes') {
    const { list } = await api('/api/admin/disputes');
    box.innerHTML = bar + (list.length ? list.map(o => `
      <div class="audit-card">
        <div class="hd"><div class="nm">${esc(o.item.title)}</div>
          <span class="status-badge st-${o.status}">${o.dispute.status === 'closed' ? (o.dispute.result === 'buyer' ? '已退款' : '已打款') : '待仲裁'}</span></div>
        <div class="kv-mini" style="margin:6px 0">
          订单号：<b>${o.no}</b>　金额：<b class="price">${o.price}</b><br>
          发起人：<b>${o.dispute.byRole === 'buyer' ? '买家' : '卖家'}</b>　时间：<b>${fmtTime(o.dispute.at)}</b>
        </div>
        <div class="dispute-box" style="margin:0">
          <h5>纠纷理由：${esc(o.dispute.reason)}</h5>
          ${o.dispute.images && o.dispute.images.length ? `<div class="evidence-imgs">${o.dispute.images.map(im => `<img src="${im}" data-act="preview" data-src="${im}">`).join('')}</div>` : ''}
          ${o.dispute.video ? `<div class="video-box"><video src="${o.dispute.video}" controls playsinline></video></div>` : ''}
        </div>
        ${o.delivery ? `<div class="kv-mini" style="margin-top:8px">📦 卖家发货说明：${esc(o.delivery.desc)}</div>` : '<div class="kv-mini" style="margin-top:8px">⚠️ 卖家尚未发货</div>'}
        ${o.dispute.status === 'open' ? `
          <div class="form-group" style="margin-top:10px"><label>仲裁备注（将展示给双方）</label><input id="ab-${o.id}" placeholder="如：经查证卖家虚假发货，证据不足"></div>
          <div class="audit-actions">
            <button class="btn" data-act="arbitrate" data-id="${o.id}" data-ruling="buyer">判买家胜诉·退款</button>
            <button class="btn green" data-act="arbitrate" data-id="${o.id}" data-ruling="seller">判卖家胜诉·打款</button>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#666;margin-top:8px">
            <input type="checkbox" id="ban-${o.id}"> 买家胜诉时同时封禁该卖家资格（骗号/欺诈）</label>`
          : `<div class="result-box ${o.dispute.result === 'buyer' ? 'win-buyer' : 'win-seller'}" style="margin-top:10px">
              <b>仲裁结果：${o.dispute.result === 'buyer' ? '买家胜诉，货款已退回' : '卖家胜诉，货款已打给卖家'}</b>
              ${o.dispute.note ? `<div>备注：${esc(o.dispute.note)}</div>` : ''}</div>`}
      </div>`).join('') : '<div class="empty"><div class="big">⚖️</div>暂无纠纷工单</div>');
    bindPreview();
  } else {
    const { list } = await api('/api/admin/products');
    box.innerHTML = bar + `<div style="padding:0 12px">${list.map(p => `
      <div class="order-card" style="margin:10px 0">
        <div class="order-body">
          <img class="thumb" src="${p.images[0]}" onerror="this.style.visibility='hidden'">
          <div class="oinfo"><div class="t">${esc(p.title)}</div>
            <div class="g">${esc(p.game)} · 卖家 ${esc(p.sellerName)}</div></div>
          <div style="flex:none;text-align:right"><span class="price" style="font-size:15px">${p.price}</span>
            <div class="muted" style="margin-top:4px">${p.status === 'on' ? '在售' : p.status === 'sold' ? '已售' : '已下架'}</div></div>
        </div>
        ${p.status !== 'sold' ? `<div class="order-foot"><div class="btns"><button class="btn gray sm" data-act="admin-off" data-id="${p.id}">${p.status === 'on' ? '强制下架' : '恢复上架'}</button></div></div>` : ''}
      </div>`).join('')}</div>`;
  }
}

/* ================= 全局动作（事件委托） ================= */
function bindPreview() {
  document.querySelectorAll('img[data-act="preview"]').forEach(img => img.onclick = () => {
    showModal(`<img src="${img.dataset.src}" style="width:100%;border-radius:10px">`, true);
  });
}
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close-modal') return closeModal();
  if (act === 'back') return history.back();
  if (act === 'preview') { showModal(`<img src="${el.dataset.src}" style="width:100%;border-radius:10px">`, true); return; }

  if (act === 'toggle-off') {
    try { await api('/api/products/' + el.dataset.id + '/off', { method: 'POST' }); toast('操作成功'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (act === 'buy') {
    if (!requireLogin()) return;
    try {
      const r = await api('/api/orders', { method: 'POST', body: { productId: el.dataset.id } });
      openPayModal(r.order);
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'pay-order') {
    const { order } = await api('/api/orders/' + el.dataset.id);
    openPayModal(order);
    return;
  }
  if (act === 'cancel-order') {
    if (!confirm('确定取消该订单吗？')) return;
    try { await api('/api/orders/' + el.dataset.id + '/cancel', { method: 'POST' }); toast('订单已取消'); router(); }
    catch (err) { toast(err.message); }
    return;
  }
  if (act === 'confirm-order') {
    if (!confirm('请确认已收到并查验游戏账号/道具无误！确认后平台将把货款打给卖家。')) return;
    try {
      await api('/api/orders/' + el.dataset.id + '/confirm', { method: 'POST' });
      toast('确认成功，交易完成');
      await loadMe(); router();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'deliver-order') return openDeliverModal(el.dataset.id);
  if (act === 'dispute-order') return openDisputeModal(el.dataset.id);

  if (act === 'audit-seller') {
    const approve = el.dataset.approve === '1';
    let reason = '';
    if (!approve) { reason = prompt('请输入驳回原因：', '资料不完整，请补充交易经验与联系方式'); if (!reason) return; }
    try {
      await api('/api/admin/sellers/' + el.dataset.id + '/audit', { method: 'POST', body: { approve, reason } });
      toast(approve ? '已通过审核' : '已驳回'); router();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'arbitrate') {
    const id = el.dataset.id;
    const note = (document.getElementById('ab-' + id) || {}).value || '';
    const ban = document.getElementById('ban-' + id);
    const ruling = el.dataset.ruling;
    if (!confirm(ruling === 'buyer' ? '判定买家胜诉？托管货款将全额退回买家，商品下架。' : '判定卖家胜诉？托管货款将打给卖家。')) return;
    try {
      await api('/api/admin/disputes/' + id + '/arbitrate', {
        method: 'POST',
        body: { ruling, note, banSeller: ruling === 'buyer' && ban && ban.checked }
      });
      toast('仲裁完成'); router();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'admin-off') {
    try { await api('/api/products/' + el.dataset.id + '/off', { method: 'POST' }); toast('操作成功'); router(); }
    catch (err) { toast(err.message); }
  }
});

/* ---------- 支付弹窗（收银台） ---------- */
/* 检测是否在微信内浏览器 */
const inWechat = /MicroMessenger/i.test(navigator.userAgent);

/* 微信内 JSAPI 支付 */
function wechatJsapiPay(params) {
  return new Promise((resolve, reject) => {
    if (typeof WeixinJSBridge === 'undefined') {
      if (document.addEventListener) {
        document.addEventListener('WeixinJSBridgeReady', () => invokePay(params, resolve, reject), false);
      } else if (document.attachEvent) {
        document.attachEvent('WeixinJSBridgeReady', () => invokePay(params, resolve, reject));
        document.attachEvent('onWeixinJSBridgeReady', () => invokePay(params, resolve, reject));
      }
    } else {
      invokePay(params, resolve, reject);
    }
  });
}
function invokePay(params, resolve, reject) {
  WeixinJSBridge.invoke('getBrandWCPayRequest', {
    appId: params.appId, timeStamp: params.timeStamp, nonceStr: params.nonceStr,
    package: params.package, signType: params.signType, paySign: params.paySign
  }, res => {
    if (res.err_msg === 'get_brand_wcpay_request:ok') resolve();
    else reject(new Error(res.err_msg === 'get_brand_wcpay_request:cancel' ? '已取消支付' : '支付失败'));
  });
}

/* 轮询订单/充值支付状态 */
function pollStatus(fn, max = 30) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const t = setInterval(async () => {
      n++;
      try {
        const r = await fn();
        if (r.status && r.status !== 'pending_pay' && r.status !== 'pending') { clearInterval(t); resolve(r); }
        else if (n >= max) { clearInterval(t); reject(new Error('支付超时，请稍后在订单列表查看')); }
      } catch (e) { if (n >= max) { clearInterval(t); reject(e); } }
    }, 2000);
  });
}

/* 跳转支付宝/微信H5 后，新开页等待用户回来再轮询 */
function openExternalPayAndWait(payUrl, pollFn, channel) {
  showModal(`<div class="cashier"><div class="spin"></div>
    <div style="font-size:15px;margin-bottom:16px">正在打开${channel}完成支付...</div>
    <div class="muted" style="margin-bottom:14px;line-height:1.7">请在${channel}中完成支付，完成后返回本页面<br>系统将自动确认支付结果</div>
    <button class="btn block" data-act="pay-complete">我已完成支付</button>
    <button class="btn ghost block" data-act="pay-cancel" style="margin-top:8px">取消</button></div>`);
  window.location.href = payUrl;
  const modal = document.querySelector('.modal');
  modal.querySelector('[data-act="pay-complete"]').onclick = async () => {
    modal.innerHTML = `<div class="cashier"><div class="spin"></div><div style="font-size:15px">正在确认支付结果...</div></div>`;
    try {
      const r = await pollStatus(pollFn);
      modal.innerHTML = `<div class="cashier"><div class="ok">✅</div><div style="font-size:16px;font-weight:700">支付成功</div>
        <div class="muted" style="margin:10px 0 16px">资金已由平台托管</div>
        <button class="btn block" data-act="pay-done">完成</button></div>`;
      modal.querySelector('[data-act="pay-done"]').onclick = () => { closeModal(); loadMe(); location.reload(); };
    } catch (e) {
      modal.innerHTML = `<div class="cashier"><div class="ok" style="color:var(--gold)">⏳</div><div style="font-size:14px;margin-bottom:14px">${e.message}</div>
        <button class="btn block" data-act="pay-recheck">重新查询</button></div>`;
      modal.querySelector('[data-act="pay-recheck"]').onclick = () => { modal.querySelector('[data-act="pay-complete"]').click(); };
    }
  };
  modal.querySelector('[data-act="pay-cancel"]').onclick = closeModal;
}

function openPayModal(o) {
  const bal = state.user ? state.user.balance : 0;
  let method = bal >= o.price ? 'balance' : (inWechat ? 'wechat' : 'alipay');
  const render = () => showModal(`
    <h3>订单支付</h3>
    <div style="text-align:center;background:var(--primary-l);border-radius:12px;padding:14px;margin-bottom:6px">
      <div class="muted">托管金额（确认收货前平台保管）</div>
      <div class="price" style="font-size:30px">${o.price}</div>
    </div>
    <div class="pay-methods">
      <div class="pay-m ${method === 'balance' ? 'on' : ''}" data-m="balance">
        <span class="pic">👛</span><div class="pn">余额支付<small>当前余额 ¥${bal.toFixed(2)}${bal < o.price ? '（不足）' : ''}</small></div><span class="radio"></span>
      </div>
      <div class="pay-m ${method === 'alipay' ? 'on' : ''}" data-m="alipay">
        <span class="pic">🅰️</span><div class="pn">支付宝<small>手机网站支付，跳转支付宝App</small></div><span class="radio"></span>
      </div>
      <div class="pay-m ${method === 'wechat' ? 'on' : ''}" data-m="wechat">
        <span class="pic">💚</span><div class="pn">微信支付<small>${inWechat ? '微信内 JSAPI 支付' : 'H5 支付，跳转微信'}</small></div><span class="radio"></span>
      </div>
    </div>
    <button class="btn block" data-act="do-pay">确认支付 ¥${o.price}</button>
    <div class="tip" style="text-align:center;margin-top:10px">🔒 付款后资金进入平台托管账户，卖家无法直接收取</div>`);
  document.querySelectorAll('.pay-m').forEach(m => m.onclick = () => { method = m.dataset.m; render(); });
  document.querySelector('[data-act="do-pay"]').onclick = async () => {
    if (method === 'balance' && bal < o.price) { toast('余额不足，请选择其他支付方式'); return; }
    const modal = document.querySelector('.modal');
    modal.innerHTML = `<div class="cashier"><div class="spin"></div><div style="font-size:15px">正在创建支付订单...</div></div>`;
    try {
      const r = await api('/api/orders/' + o.id + '/pay', { method: 'POST', body: { method } });
      if (r.paid) {
        modal.innerHTML = `<div class="cashier"><div class="ok">✅</div><div style="font-size:16px;font-weight:700">支付成功，资金已托管</div>
          <div class="muted" style="margin:8px 0 18px;line-height:1.7">卖家发货后请验货确认<br>确认收货后平台才会打款给卖家</div>
          <button class="btn block" data-act="pay-done">查看订单</button></div>`;
        modal.querySelector('[data-act="pay-done"]').onclick = () => { closeModal(); loadMe(); location.hash = '#/order/' + o.id; };
        return;
      }
      const pollFn = () => api('/api/orders/' + o.id + '/pay-status');
      if (r.channel === 'alipay') {
        openExternalPayAndWait(r.payUrl, pollFn, '支付宝');
      } else if (r.channel === 'wechat') {
        if (r.type === 'jsapi') {
          modal.innerHTML = `<div class="cashier"><div class="spin"></div><div style="font-size:15px">正在调起微信支付...</div></div>`;
          await wechatJsapiPay(r.payParams);
          modal.innerHTML = `<div class="cashier"><div class="spin"></div><div style="font-size:15px">正在确认支付结果...</div></div>`;
          await pollStatus(pollFn);
          modal.innerHTML = `<div class="cashier"><div class="ok">✅</div><div style="font-size:16px;font-weight:700">支付成功，资金已托管</div>
            <button class="btn block" style="margin-top:18px" data-act="pay-done">查看订单</button></div>`;
          modal.querySelector('[data-act="pay-done"]').onclick = () => { closeModal(); loadMe(); location.hash = '#/order/' + o.id; };
        } else {
          openExternalPayAndWait(r.mwebUrl, pollFn, '微信');
        }
      }
    } catch (err) {
      modal.innerHTML = `<div class="cashier"><div class="ok" style="color:var(--red)">❌</div><div style="font-size:15px;margin-bottom:16px">${esc(err.message)}</div>
        <button class="btn block" data-act="pay-retry">返回重试</button></div>`;
      modal.querySelector('[data-act="pay-retry"]').onclick = render;
    }
  };
}

/* ---------- 发货弹窗（卖家） ---------- */
function openDeliverModal(orderId) {
  showModal(`<h3>卖家发货 / 移交商品</h3>
    <div class="tip" style="margin-bottom:12px;line-height:1.7">请先在游戏内完成账号换绑 / 道具赠送 / 游戏币交易，并<b>截图或录屏留存凭证</b>，再提交发货。虚假发货将被仲裁退款并封禁。</div>
    <div class="form-group"><label>交接说明<em>*</em></label>
      <textarea id="dv-desc" placeholder="如：账号已换绑至买家手机 138****，密码已通过QQ发送；或：道具已通过游戏内邮件发送，附截图"></textarea></div>
    <div class="form-group"><label>交接截图（聊天记录/换绑成功/发货记录）</label><div class="uploader" id="dv-imgs"></div></div>
    <button class="btn block" data-act="do-deliver">提交发货，等待买家确认</button>`);
  const up = bindUploader(document.getElementById('dv-imgs'), { max: 4, kind: 'image' });
  document.querySelector('[data-act="do-deliver"]').onclick = async () => {
    try {
      await api('/api/orders/' + orderId + '/deliver', {
        method: 'POST',
        body: { desc: document.getElementById('dv-desc').value.trim(), images: up.urls }
      });
      closeModal(); toast('发货成功'); router();
    } catch (err) { toast(err.message); }
  };
}

/* ---------- 纠纷仲裁申请弹窗 ---------- */
function openDisputeModal(orderId) {
  showModal(`<h3>申请纠纷仲裁</h3>
    <div class="tip" style="margin-bottom:12px;line-height:1.7">遇到<b>骗号、虚假发货、货不对板</b>？上传聊天截图、游戏内截图和录屏，平台客服将<b>人工审核</b>凭证，查实后全额退款。</div>
    <div class="form-group"><label>纠纷说明<em>*</em></label>
      <textarea id="dp-reason" placeholder="请详细描述问题，如：卖家提供的账号密码错误/账号被找回/道具未到账等（至少5个字）"></textarea></div>
    <div class="form-group"><label>证据截图</label><div class="uploader" id="dp-imgs"></div></div>
    <div class="form-group"><label>游戏录屏（强烈建议）</label><div class="uploader" id="dp-video"></div></div>
    <button class="btn block" data-act="do-dispute">提交仲裁申请</button>`);
  const imgs = bindUploader(document.getElementById('dp-imgs'), { max: 4, kind: 'image' });
  const vids = bindUploader(document.getElementById('dp-video'), { max: 1, kind: 'video' });
  document.querySelector('[data-act="do-dispute"]').onclick = async () => {
    try {
      await api('/api/orders/' + orderId + '/dispute', {
        method: 'POST',
        body: { reason: document.getElementById('dp-reason').value.trim(), images: imgs.urls, video: vids.urls[0] || null }
      });
      closeModal(); toast('已提交，客服将尽快处理'); router();
    } catch (err) { toast(err.message); }
  };
}

/* ---------- 启动 ---------- */
(async function init() {
  await loadMe();
  if (!location.hash) location.hash = '#/home';
  router();
})();
