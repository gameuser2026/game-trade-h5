/* 端到端测试：担保交易全流程 */
const B = 'http://localhost:3000';
let pass = 0;
const ok = (c, m) => { if (!c) throw new Error('断言失败: ' + m); console.log('  ✔ ' + m); pass++; };
async function j(p, opts = {}) {
  const r = await fetch(B + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const d = await r.json();
  if (!r.ok) throw new Error(p + ' -> ' + (d.error || r.status));
  return d;
}
(async () => {
  console.log('1. 商品列表');
  const list = await j('/api/products');
  ok(list.list.length >= 6, '种子商品加载，共 ' + list.list.length + ' 件');

  console.log('2. 实名注册新用户');
  const reg = await j('/api/register', { method: 'POST', body: { phone: '13700000003', password: 'test123', realName: '王测试', idCard: '330106199001011234' } });
  ok(reg.token && reg.user.realName === '王测试', '注册成功并完成实名: ' + reg.user.id);
  const bad = await fetch(B + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '123', password: '1', realName: 'x', idCard: '1' }) });
  ok(bad.status === 400, '非法信息被拒绝');

  console.log('3. 卖家入驻申请');
  await j('/api/seller/apply', { method: 'POST', token: reg.token, body: { contact: 'wx:test001', mainGames: '王者荣耀', experience: '3年交易经验' } });
  const me = await j('/api/me', { token: reg.token });
  ok(me.user.sellerStatus === 'pending', '入驻状态=审核中');

  console.log('4. 管理员审核通过卖家资质');
  const admin = await j('/api/login', { method: 'POST', body: { phone: '13800000000', password: 'admin123' } });
  const sellers = await j('/api/admin/sellers', { token: admin.token });
  const pending = sellers.list.find(u => u.phone === '13700000003');
  ok(!!pending, '待审核列表包含新卖家');
  await j('/api/admin/sellers/' + pending.id + '/audit', { method: 'POST', token: admin.token, body: { approve: true } });

  console.log('5. 新卖家发布商品（含图片上传）');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await j('/api/upload', { method: 'POST', token: reg.token, body: { dataUrl: png, kind: 'image' } });
  ok(up.url.startsWith('/uploads/'), '图片上传成功: ' + up.url);
  const np = await j('/api/products', { method: 'POST', token: reg.token, body: { category: 'skin', game: '测试游戏', title: '限量测试皮肤一个', price: 100, desc: '测试描述', images: [up.url] } });
  ok(np.product.status === 'on', '商品上架成功: ' + np.product.id);

  console.log('6. 买家下单 + 余额付款（资金托管）');
  const buyer = await j('/api/login', { method: 'POST', body: { phone: '13900000002', password: 'buyer123' } });
  const w0 = await j('/api/wallet', { token: buyer.token });
  const order = await j('/api/orders', { method: 'POST', token: buyer.token, body: { productId: np.product.id } });
  ok(order.order.status === 'pending_pay', '订单创建，状态=待付款');
  const paid = await j('/api/orders/' + order.order.id + '/pay', { method: 'POST', token: buyer.token, body: { method: 'balance' } });
  ok(paid.paid === true && paid.order.status === 'paid', '余额付款成功，资金托管');
  const w1 = await j('/api/wallet', { token: buyer.token });
  ok(Math.abs(w1.balance - (w0.balance - 100)) < 0.01, '买家余额扣除 100: ' + w1.balance);
  const hidden = await j('/api/products');
  ok(!hidden.list.some(p => p.id === np.product.id), '已付款商品从在售列表移除');

  console.log('6b. 在线支付下单（未配置时返回错误，配置后返回支付参数）');
  const oTmp = await j('/api/orders', { method: 'POST', token: buyer.token, body: { productId: 'p1' } });
  const alipayRsp = await fetch(B + '/api/orders/' + oTmp.order.id + '/pay', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + buyer.token },
    body: JSON.stringify({ method: 'alipay' })
  });
  ok(alipayRsp.status === 400, '支付宝未配置时返回 400 错误（符合预期）');
  // 取消该订单
  await j('/api/orders/' + oTmp.order.id + '/cancel', { method: 'POST', token: buyer.token });

  console.log('7. 买家发起纠纷（骗号/虚假发货）');
  const disp = await j('/api/orders/' + order.order.id + '/dispute', { method: 'POST', token: buyer.token, body: { reason: '卖家提供的账号密码错误，登录不上，疑似虚假发货', images: [up.url], video: null } });
  ok(disp.order.status === 'disputed', '纠纷状态=仲裁中');

  console.log('8. 管理员人工仲裁：判买家胜诉并封禁卖家');
  const arb = await j('/api/admin/disputes/' + order.order.id + '/arbitrate', { method: 'POST', token: admin.token, body: { ruling: 'buyer', note: '经查证卖家虚假发货', banSeller: true } });
  ok(arb.order.status === 'refunded', '仲裁完成，订单=已退款');
  const w2 = await j('/api/wallet', { token: buyer.token });
  ok(Math.abs(w2.balance - w0.balance) < 0.01, '货款全额退回买家: ' + w2.balance);

  console.log('9. 正常担保交易：付款→发货→确认→打款');
  const seller = await j('/api/login', { method: 'POST', body: { phone: '13900000001', password: 'seller123' } });
  const sw0 = await j('/api/wallet', { token: seller.token });
  const o2 = await j('/api/orders', { method: 'POST', token: buyer.token, body: { productId: 'p5' } });
  await j('/api/orders/' + o2.order.id + '/pay', { method: 'POST', token: buyer.token, body: { method: 'balance' } });
  const dv = await j('/api/orders/' + o2.order.id + '/deliver', { method: 'POST', token: seller.token, body: { desc: '1000万游戏币已通过游戏内当面交易发放，附截图', images: [] } });
  ok(dv.order.status === 'delivered', '卖家发货成功，状态=待收货');
  const cf = await j('/api/orders/' + o2.order.id + '/confirm', { method: 'POST', token: buyer.token });
  ok(cf.order.status === 'completed', '买家确认收货，交易完成');
  const sw1 = await j('/api/wallet', { token: seller.token });
  ok(Math.abs(sw1.balance - (sw0.balance + 268)) < 0.01, '平台打款给卖家 +268: ' + sw1.balance);

  console.log('10. 管理后台总览');
  const ov = await j('/api/admin/overview', { token: admin.token });
  console.log('    ', JSON.stringify(ov));
  ok(ov.users >= 3 && ov.orders >= 2, '平台数据统计正常');

  console.log('\n🎉 全部 ' + pass + ' 项测试通过');
})().catch(e => { console.error('\n❌ 测试失败:', e.message); process.exit(1); });
