/**
 * 支付宝手机网站支付 SDK（零依赖，仅用 crypto）
 * 文档：https://opendocs.alipay.com/open/203/105285
 */
const crypto = require('crypto');
const querystring = require('querystring');

function rsa2Sign(content, privateKey) {
  // PKCS#8 PEM 或裸 Base64 私钥都支持
  const key = privateKey.includes('-----BEGIN') ? privateKey :
    `-----BEGIN PRIVATE KEY-----\n${privateKey.replace(/\s+/g, '').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
  return crypto.createSign('RSA-SHA256').update(content, 'utf8').sign(key, 'base64');
}

function rsa2Verify(content, sign, publicKey) {
  const key = publicKey.includes('-----BEGIN') ? publicKey :
    `-----BEGIN PUBLIC KEY-----\n${publicKey.replace(/\s+/g, '').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  return crypto.createVerify('RSA-SHA256').update(content, 'utf8').verify(key, sign, 'base64');
}

/**
 * 构造支付宝手机网站支付请求参数并返回跳转 URL
 * @param {object} cfg  支付宝配置
 * @param {object} opt  { outTradeNo, subject, totalAmount, body }
 */
function wapPayUrl(cfg, opt) {
  const bizContent = JSON.stringify({
    out_trade_no: opt.outTradeNo,
    total_amount: opt.totalAmount.toFixed(2),
    subject: opt.subject,
    body: opt.body || opt.subject,
    product_code: 'QUICK_WAP_WAY',
    quit_url: cfg.returnUrl
  });

  const params = {
    app_id: cfg.appId,
    method: 'alipay.trade.wap.pay',
    charset: cfg.charset,
    sign_type: cfg.signType,
    timestamp: new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''),
    version: '1.0',
    notify_url: cfg.notifyUrl,
    return_url: cfg.returnUrl,
    biz_content: bizContent
  };

  // 签名：按 key 升序拼接 key=value，空值剔除
  const sorted = Object.keys(params).sort();
  const signContent = sorted.map(k => `${k}=${params[k]}`).join('&');
  params.sign = rsa2Sign(signContent, cfg.privateKey);

  return cfg.gateway + '?' + querystring.stringify(params);
}

/**
 * 验证支付宝异步回调签名
 * @param {object} params  回调收到的全部字段（含 sign / sign_type）
 * @param {string} publicKey  支付宝公钥
 */
function verifyNotify(params, publicKey) {
  const sign = params.sign;
  const signType = params.sign_type;
  // 剔除 sign 和 sign_type 后排序拼接
  const data = { ...params };
  delete data.sign;
  delete data.sign_type;
  const sorted = Object.keys(data).sort();
  const content = sorted.map(k => `${k}=${data[k]}`).join('&');
  return rsa2Verify(content, sign, publicKey);
}

/**
 * 支付宝订单查询：构造签名参数
 */
function queryOrder(cfg, outTradeNo) {
  const bizContent = JSON.stringify({ out_trade_no: outTradeNo });
  const params = {
    app_id: cfg.appId,
    method: 'alipay.trade.query',
    charset: cfg.charset,
    sign_type: cfg.signType,
    timestamp: new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''),
    version: '1.0',
    biz_content: bizContent
  };
  const sorted = Object.keys(params).sort();
  params.sign = rsa2Sign(sorted.map(k => `${k}=${params[k]}`).join('&'), cfg.privateKey);
  return params;
}

/**
 * 主动向支付宝查询交易状态（异步通知未到达时的兜底）
 * 返回 { trade_status, trade_no, ... }；订单未支付时 trade_status 为
 * 'WAIT_BUYER_PAY'；成功为 'TRADE_SUCCESS' / 'TRADE_FINISHED'；不存在会返回 sub_code=ACQ.TRADE_NOT_EXIST
 */
function queryOrderRemote(cfg, outTradeNo) {
  const params = queryOrder(cfg, outTradeNo);
  const body = querystring.stringify(params);
  const u = new URL(cfg.gateway);
  return new Promise((resolve, reject) => {
    const req = require('https').request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      }
    }, r => {
      let d = '';
      r.on('data', c => (d += c));
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve(j.alipay_trade_query_response || j);
        } catch (e) {
          reject(new Error('查询返回解析失败: ' + d.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { rsa2Sign, rsa2Verify, wapPayUrl, verifyNotify, queryOrder, queryOrderRemote };
