/**
 * 支付配置向导
 * 功能：
 *   1. 生成支付宝 RSA2 密钥对（应用私钥 + 应用公钥）
 *   2. 交互式输入商户凭证，写入 pay.config.js
 *   3. 自动检测配置是否完整
 *
 * 使用方法：
 *   node.exe setup-pay.js              # 交互式向导
 *   node.exe setup-pay.js genkey       # 仅生成 RSA2 密钥对
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG_FILE = path.join(__dirname, 'pay.config.js');
const KEY_DIR = path.join(__dirname, 'keys');

/* ---------- RSA2 密钥对生成 ---------- */
function genRSA2KeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  // 去除 PEM 头尾，只留 Base64（支付宝开放平台密钥工具格式）
  const privBase64 = privateKey.replace(/-----BEGIN.*?-----/g, '').replace(/-----END.*?-----/g, '').replace(/\s+/g, '');
  const pubBase64 = publicKey.replace(/-----BEGIN.*?-----/g, '').replace(/-----END.*?-----/g, '').replace(/\s+/g, '');
  return { privateKey, publicKey, privBase64, pubBase64 };
}

function ensureKeyDir() {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true });
}

/* ---------- 交互式输入 ---------- */
function ask(rl, question, defaultValue) {
  return new Promise(resolve => {
    const hint = defaultValue ? `（默认: ${defaultValue}）` : '';
    rl.question(`${question}${hint}: `, answer => {
      resolve((answer || defaultValue || '').trim());
    });
  });
}

/* ---------- 读取现有配置 ---------- */
function readConfig() {
  try { return require(CONFIG_FILE); }
  catch (e) { return {}; }
}

/* ---------- 写入配置 ---------- */
function writeConfig(cfg) {
  const content = `/**
 * 真实支付配置
 * ⚠️ 请将您申请到的商户信息填入下方，未填写时自动回退为【演示模式】
 *
 * 申请地址：
 *   支付宝：https://open.alipay.com  →  签约「手机网站支付」
 *   微信支付：https://pay.weixin.qq.com →  开通「JSAPI支付」+「H5支付」
 */
module.exports = ${JSON.stringify(cfg, null, 2)};
`;
  fs.writeFileSync(CONFIG_FILE, content, 'utf8');
}

/* ---------- 主流程 ---------- */
async function main() {
  const mode = process.argv[2];

  // 仅生成密钥
  if (mode === 'genkey') {
    ensureKeyDir();
    const kp = genRSA2KeyPair();
    fs.writeFileSync(path.join(KEY_DIR, 'app_private_key.pem'), kp.privateKey);
    fs.writeFileSync(path.join(KEY_DIR, 'app_private_key_base64.txt'), kp.privBase64);
    fs.writeFileSync(path.join(KEY_DIR, 'app_public_key_base64.txt'), kp.pubBase64);
    console.log('\n✅ RSA2 密钥对已生成到 keys/ 目录');
    console.log('\n━━━ 应用私钥（粘贴到 pay.config.js 的 privateKey）━━━');
    console.log(kp.privBase64);
    console.log('\n━━━ 应用公钥（上传到支付宝开放平台）━━━');
    console.log(kp.pubBase64);
    console.log('\n📋 操作步骤：');
    console.log('1. 登录 https://open.alipay.com/develop/sandbox');
    console.log('2. 在「沙箱应用-接口加签方式」选择「公钥模式」');
    console.log('3. 将上方【应用公钥】粘贴进去');
    console.log('4. 支付宝会返回【支付宝公钥】，复制它填入 pay.config.js 的 alipayPublicKey');
    return;
  }

  // 交互式向导
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const cfg = readConfig();

  console.log('\n==============================================');
  console.log('  真实支付配置向导');
  console.log('==============================================\n');

  console.log('【第 1 步】获取公网回调地址');
  console.log('  支付回调需要公网 HTTPS 地址。推荐使用内网穿透工具：');
  console.log('  • cpolar（免费）: https://www.cpolar.com');
  console.log('  • natapp（免费）: https://natapp.cn');
  console.log('  • ngrok（免费）: https://ngrok.com');
  console.log('  启动隧道后将 localhost:3000 映射到公网，获取 HTTPS 地址\n');

  const baseUrl = await ask(rl, '请输入您的公网 HTTPS 地址（如 https://xxx.r6.cpolar.cn）', '');
  if (!baseUrl) { console.log('未输入地址，退出。'); rl.close(); return; }
  const cleanUrl = baseUrl.replace(/\/+$/, '');

  console.log('\n【第 2 步】配置支付宝（沙箱或正式）');
  console.log('  沙箱地址: https://open.alipay.com/develop/sandbox');
  console.log('  正式地址: https://open.alipay.com/develop\n');

  const useAlipay = await ask(rl, '是否配置支付宝？(y/n)', 'y');
  if (useAlipay === 'y' || useAlipay === 'Y') {
    const sandbox = await ask(rl, '使用沙箱环境？(y/n)', 'y');
    cfg.alipay = cfg.alipay || {};
    cfg.alipay.appId = await ask(rl, '请输入 APPID');
    cfg.alipay.privateKey = await ask(rl, '请输入应用私钥（PKCS8 Base64）');
    cfg.alipay.alipayPublicKey = await ask(rl, '请输入支付宝公钥（从开放平台获取）');
    cfg.alipay.gateway = sandbox === 'y' || sandbox === 'Y'
      ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
      : 'https://openapi.alipay.com/gateway.do';
    cfg.alipay.signType = 'RSA2';
    cfg.alipay.charset = 'utf-8';
    cfg.alipay.notifyUrl = `${cleanUrl}/api/pay/alipay/notify`;
    cfg.alipay.returnUrl = `${cleanUrl}/`;
    console.log('✅ 支付宝配置完成');
  }

  console.log('\n【第 3 步】配置微信支付');
  const useWechat = await ask(rl, '是否配置微信支付？(y/n)', 'n');
  if (useWechat === 'y' || useWechat === 'Y') {
    cfg.wechat = cfg.wechat || {};
    cfg.wechat.appId = await ask(rl, '请输入公众号/小程序 AppID');
    cfg.wechat.mchId = await ask(rl, '请输入商户号');
    cfg.wechat.apiKey = await ask(rl, '请输入 APIv3 密钥（32位）');
    cfg.wechat.merchantSerialNo = await ask(rl, '请输入商户证书序列号');
    cfg.wechat.privateKey = await ask(rl, '请输入商户 API 私钥');
    cfg.wechat.platformPublicKey = await ask(rl, '请输入微信平台证书公钥（回调验签用，可稍后补）');
    cfg.wechat.notifyUrl = `${cleanUrl}/api/pay/wechat/notify`;
    cfg.wechat.h5Scene = { type: 'Wap', wapUrl: cleanUrl, wapName: '游易达' };
    console.log('✅ 微信支付配置完成');
  }

  // 判断是否配置完整
  const alipayReady = cfg.alipay && cfg.alipay.appId && cfg.alipay.privateKey && cfg.alipay.alipayPublicKey && cfg.alipay.notifyUrl;
  const wechatReady = cfg.wechat && cfg.wechat.appId && cfg.wechat.mchId && cfg.wechat.apiKey && cfg.wechat.privateKey && cfg.wechat.notifyUrl;
  cfg.demo = !alipayReady && !wechatReady;

  writeConfig(cfg);
  console.log('\n==============================================');
  console.log('  ✅ 配置已写入 pay.config.js');
  console.log('==============================================');
  console.log(`  支付宝: ${alipayReady ? '✅ 已就绪' : '❌ 未配置完整'}`);
  console.log(`  微信支付: ${wechatReady ? '✅ 已就绪' : '❌ 未配置完整'}`);
  console.log(`  演示模式: ${cfg.demo ? '是（未配置真实支付时使用）' : '否'}`);
  console.log('\n  重启服务即可生效：双击 启动服务.bat');
  console.log('==============================================\n');

  rl.close();
}

main().catch(e => { console.error('错误:', e.message); process.exit(1); });
