const https = require('https');
const fs = require('fs');
const dest = process.argv[2] || 'cloudflared.exe';
const urls = [
  'https://pkg.cloudflare.dev/cloudflared/stable/cloudflared-windows-amd64.exe',
  'https://api.kgithub.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
  'https://ghproxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
  'https://mirror.ghproxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
];
async function tryUrl(url) {
  return new Promise((resolve, reject) => {
    console.log('尝试:', url);
    const req = https.get(url, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return tryUrl(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(dest); });
      ws.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}
(async () => {
  for (const url of urls) {
    try {
      const f = await tryUrl(url);
      const size = fs.statSync(f).size;
      if (size > 100000) { console.log('成功下载:', f, size, 'bytes'); process.exit(0); }
      else { console.log('文件太小，可能是错误页面'); fs.unlinkSync(f); }
    } catch (e) { console.log('失败:', e.message); }
  }
  console.log('所有源下载失败');
  process.exit(1);
})();
