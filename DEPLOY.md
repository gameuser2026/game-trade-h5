# 部署到云服务器（Fly.io 免费方案）

## 为什么选 Fly.io
- ✅ **永久免费**：3 个 256MB 机器 + 3GB 持久化卷
- ✅ **不休眠**：服务常驻，不像 Render 15 分钟没访问就睡
- ✅ **持久化存储**：data.json 和上传的图片重启不丢
- ✅ **自动 HTTPS**：`xxx.fly.dev` 域名 + SSL 证书开箱即用
- ✅ **国内访问快**：可选香港 / 东京机房
- ⚠️ 注册需信用卡验证（免费额度内不会扣费）
- ⚠️ flyctl 在国内下载需自备 VPN 或用海外网络

---

## 一键部署流程

### 1. 注册 Fly.io 账号
- 打开 https://fly.io/app/sign-up
- 用 GitHub 或邮箱注册
- 填入信用卡验证（**不会扣费**，免费额度足够）

### 2. 下载 flyctl（在国内需要 VPN 或海外网络）

**方式 1：PowerShell 官方安装脚本（推荐）**
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```
安装后 flyctl 路径会自动加入 PATH，重新打开 PowerShell 即可。

**方式 2：手动下载单文件**
1. 浏览器打开 https://github.com/superfly/flyctl/releases/latest
2. 下载 `flyctl-windows-amd64.zip`
3. 解压到 `C:\Users\你的用户名\flyctl-bin\`
4. 把这个目录加到系统 PATH 环境变量

### 3. 双击运行部署脚本

在项目目录双击 **`部署到Fly.bat`**，脚本会自动：
1. 检查 flyctl
2. 引导登录
3. 部署应用
4. 询问应用名并创建持久化卷
5. 重新部署让卷挂载生效

### 4. 拿到公网域名

部署成功后输出会有：
```
Deployment completed!
Visit your app at: https://你的应用名.fly.dev
```

### 5. 修改 pay.config.js 的回调地址

编辑 `c:\Users\Administrator\Desktop\game-trade-h5\pay.config.js`，把：
```js
notifyUrl: 'https://tones-determine-stroke-now.trycloudflare.com/api/pay/alipay/notify',
returnUrl: 'https://tones-determine-stroke-now.trycloudflare.com/',
```
改成你的新域名：
```js
notifyUrl: 'https://你的应用名.fly.dev/api/pay/alipay/notify',
returnUrl: 'https://你的应用名.fly.dev/',
```

### 6. 双击 `上传支付配置.bat` 上传配置到容器

输入应用名，脚本会自动：
1. 用 sftp 把本地 pay.config.js 上传到容器 /app/pay.config.js
2. 重启应用让配置生效

### 7. 测试访问

打开浏览器访问 `https://你的应用名.fly.dev`，登录买家账号 → 钱包 → 充值 → 走真实支付宝支付。

---

## 常用运维命令

```powershell
flyctl status                            # 查看运行状态
flyctl logs --app 你的应用名              # 实时日志
flyctl ssh console --app 你的应用名       # SSH 进入容器
flyctl scale memory 512 --app 你的应用名  # 升级内存（仍免费）
flyctl apps destroy 你的应用名            # 彻底删除应用
```

---

## 数据备份

```powershell
# 下载 data.json 到本地
flyctl ssh sftp get /app/data/data.json ./backup-data.json --app 你的应用名

# 下载整个 uploads 目录
flyctl ssh sftp get /app/uploads ./backup-uploads/ --app 你的应用名
```

---

## 文件清单

部署需要的核心文件：

| 文件 | 是否提交到 GitHub | 说明 |
|---|---|---|
| server.js | ✅ 是 | 主程序 |
| package.json | ✅ 是 | 入口声明 |
| Dockerfile | ✅ 是 | 容器构建 |
| fly.toml | ✅ 是 | Fly 配置 |
| .dockerignore | ✅ 是 | 排除文件 |
| .gitignore | ✅ 是 | Git 排除 |
| pay.config.example.js | ✅ 是 | 配置模板 |
| .github/workflows/deploy.yml | ✅ 是 | GitHub Actions（备选） |
| lib/ | ✅ 是 | 支付 SDK |
| public/ | ✅ 是 | 前端资源 |
| keys/ | ❌ 否 | RSA 私钥（敏感） |
| pay.config.js | ❌ 否 | 真实密钥（用 sftp 上传） |
| data.json | ❌ 否 | 运行时数据（挂载卷） |
| uploads/ | ❌ 否 | 用户上传（挂载卷） |

---

## 备选方案：Render（无需信用卡）

如果不想注册 Fly.io / 不想填信用卡：

1. 注册 https://render.com（GitHub 登录）
2. New → Web Service → Connect GitHub 仓库
3. 推送项目到 GitHub
4. 配置：
   - Build Command: 留空（零依赖）
   - Start Command: `node server.js`
   - Plan: Free
5. 加 Disk：Path `/app/data`, Size 1GB（⚠️ 付费 $1/月）

⚠️ Render 免费版 15 分钟无访问会休眠，数据需付费持久化。Fly.io 更推荐。
