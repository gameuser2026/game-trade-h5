/**
 * 微信支付 SDK（APIv3，零依赖）
 * 文档：https://pay.weixin.qq.com/doc/v3/merchant/4012791750
 * 支持：JSAPI 支付（微信内）、H5 支付（微信外浏览器）、回调验签
 */
const crypto = require('crypto');

/** 商户私钥签名（RSA-SHA256） */
function sign(privateKey, content) {
  const key = privateKey.includes('-----BEGIN') ? privateKey :
    `-----BEGIN PRIVATE KEY-----\n${privateKey.replace(/\s+/g, '').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
  return crypto.createSign('RSA-SHA256').update(content, 'utf8').sign(key, 'base64');
}

/** 平台证书公钥验签 */
function verify(publicKey, content, signature) {
  const key = publicKey.includes('-----BEGIN') ? publicKey :
    `-----BEGIN PUBLIC KEY-----\n${publicKey.replace(/\s+/g, '').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  return crypto.createVerify('RSA-SHA256').update(content, 'utf8').verify(key, signature, 'base64');
}

/** 生成 APIv3 Authorization 头 */
function buildAuthorization(cfg, method, urlPath, body) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = sign(cfg.privateKey, message);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${cfg.merchantSerialNo}",signature="${signature}"`;
}

/**
 * JSAPI 下单（微信内浏览器，需 openid）
 * @returns { prepay_id }
 */
async function jsapiOrder(cfg, opt) {
  const body = JSON.stringify({
    appid: cfg.appId,
    mchid: cfg.mchId,
    description: opt.subject,
    out_trade_no: opt.outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: Math.round(opt.totalAmount * 100), currency: 'CNY' },
    payer: { openid: opt.openid }
  });
  const res = await fetch('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': buildAuthorization(cfg, 'POST', '/v3/pay/transactions/jsapi', body)
    },
    body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '微信下单失败');
  return data;
}

/**
 * H5 下单（微信外浏览器，返回 mweb_url）
 */
async function h5Order(cfg, opt) {
  const body = JSON.stringify({
    appid: cfg.appId,
    mchid: cfg.mchId,
    description: opt.subject,
    out_trade_no: opt.outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: Math.round(opt.totalAmount * 100), currency: 'CNY' },
    scene_info: {
      payer_client_ip: opt.clientIp || '127.0.0.1',
      h5_info: cfg.h5Scene
    }
  });
  const res = await fetch('https://api.mch.weixin.qq.com/v3/pay/transactions/h5', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': buildAuthorization(cfg, 'POST', '/v3/pay/transactions/h5', body)
    },
    body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '微信H5下单失败');
  return data;
}

/**
 * 生成前端 wx.requestPayment 所需参数（JSAPI 支付）
 */
function buildJsapiPayParams(cfg, prepayId) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const pkg = `prepay_id=${prepayId}`;
  const message = `${cfg.appId}\n${timestamp}\n${nonceStr}\n${pkg}\n`;
  const paySign = sign(cfg.privateKey, message);
  return {
    appId: cfg.appId,
    timeStamp: timestamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign
  };
}

/**
 * 验证微信支付回调签名
 * @param {object} headers  请求头（含 Wechatpay-Signature 等）
 * @param {string} body     原始请求体字符串
 * @param {string} publicKey  微信平台证书公钥
 */
function verifyNotify(headers, body, publicKey) {
  const signature = headers['wechatpay-signature'];
  const serial = headers['wechatpay-serial'];
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  if (!signature || !timestamp || !nonce) return false;
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  return verify(publicKey, message, signature);
}

/**
 * 解密回调中的 resource（AES-256-GCM）
 */
function decryptResource(apiKey, resource) {
  const { nonce, ciphertext, associated_data } = resource;
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(apiKey), Buffer.from(nonce));
  if (associated_data) decipher.setAAD(Buffer.from(associated_data));
  const tag = Buffer.from(ciphertext, 'base64').slice(-16);
  const data = Buffer.from(ciphertext, 'base64').slice(0, -16);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

/** 订单查询 */
async function queryOrder(cfg, outTradeNo) {
  const path = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${cfg.mchId}`;
  const res = await fetch('https://api.mch.weixin.qq.com' + path, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': buildAuthorization(cfg, 'GET', path, '')
    }
  });
  return res.json();
}

module.exports = {
  sign, verify, buildAuthorization,
  jsapiOrder, h5Order, buildJsapiPayParams,
  verifyNotify, decryptResource, queryOrder
};
