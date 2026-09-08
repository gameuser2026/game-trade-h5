/**
 * 真实支付配置 - 模板
 * ⚠️ 此文件不含真实密钥，提交到 GitHub 安全
 *
 * 部署到 Fly.io 后，执行以下命令注入真实配置：
 *   flyctl ssh sftp put ./pay.config.js /app/pay.config.js
 *   flyctl apps restart <app-name>
 */
module.exports = {
  // ============ 支付宝 ============
  alipay: {
    appId: '',                              // 真实 APPID
    privateKey: '',                         // 应用私钥（PKCS8 Base64）
    alipayPublicKey: '',                    // 支付宝公钥
    notifyUrl: '',                          // https://<your-app>.fly.dev/api/pay/alipay/notify
    returnUrl: '',                          // https://<your-app>.fly.dev/
    signType: 'RSA2',
    charset: 'utf-8',
    gateway: 'https://openapi.alipay.com/gateway.do'
  },
  wechat: {
    appId: '', mchId: '', apiKey: '',
    merchantSerialNo: '', privateKey: '', platformPublicKey: '',
    notifyUrl: '',
    h5Scene: { type: 'Wap', wapUrl: '', wapName: '游易达' }
  },
  demo: true
};
