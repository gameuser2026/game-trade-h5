# ============================================================
#  游易达 一键修复网络（隧道重启 + 回调更新 + 服务重启）
#  双击桌面「一键修复网络.bat」即可运行，无需手动改配置
# ============================================================
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$proj   = $PSScriptRoot
$cf     = 'c:\Users\Administrator\Desktop\cf.exe'
$node   = 'C:\Users\Administrator\Desktop\node-full\node-v20.18.0-win-x64\node.exe'
$config = Join-Path $proj 'pay.config.js'
$cfErr  = Join-Path $proj 'cf-fix.err.log'
$cfOut  = Join-Path $proj 'cf-fix.out.log'

function Step($n, $t) { Write-Host "`n[$n] $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "  ✅ $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ⚠️ $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  ❌ $t" -ForegroundColor Red }

Write-Host '==========================================' -ForegroundColor White
Write-Host '   游易达 一键修复网络' -ForegroundColor White
Write-Host '==========================================' -ForegroundColor White

# ---------- 0. 基础检查 ----------
Step 0 '环境检查'
if (-not (Test-Path $cf)) { Bad "找不到 cf.exe：$cf"; Read-Host "`n按回车退出"; exit 1 }
if (-not (Test-Path $config)) { Bad "找不到 pay.config.js：$config"; Read-Host "`n按回车退出"; exit 1 }
Ok 'cf.exe / pay.config.js 均存在'

# ---------- 1. 关闭旧隧道 ----------
Step 1 '关闭旧隧道进程'
Get-Process -Name 'cf','cloudflared' -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
Remove-Item $cfErr, $cfOut -Force -ErrorAction SilentlyContinue
Ok '旧隧道已关闭'

# ---------- 2. 启动新隧道 ----------
Step 2 '启动新隧道（cloudflared）'
Start-Process -FilePath $cf -ArgumentList @('tunnel','--url','http://localhost:3000') `
  -RedirectStandardError $cfErr -RedirectStandardOutput $cfOut `
  -WindowStyle Hidden -WorkingDirectory $proj
Ok '隧道进程已启动，正在分配公网地址...'

# ---------- 3. 抓取新公网地址 ----------
Step 3 '等待并抓取新公网地址'
$url = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $cfErr) {
    $raw = Get-Content $cfErr -Raw -ErrorAction SilentlyContinue
    $m = [regex]::Match($raw, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($m.Success) { $url = $m.Value; break }
  }
  Write-Host '.' -NoNewline
}
Write-Host ''
if (-not $url) { Bad '60 秒内未获取到公网地址，请检查网络后重试'; Read-Host "`n按回车退出"; exit 1 }
Ok "新公网地址：$url"

# ---------- 4. 更新 pay.config.js 回调 ----------
Step 4 '更新支付回调地址（pay.config.js）'
try {
  $cfg = Get-Content $config -Raw
  $cfg = [regex]::Replace($cfg, "notifyUrl:\s*'https://[^']*'", "notifyUrl: '$url/api/pay/alipay/notify'")
  $cfg = [regex]::Replace($cfg, "returnUrl:\s*'https://[^']*'", "returnUrl: '$url/'")
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($config, $cfg, $utf8NoBom)
  Ok '回调地址已写入配置'
} catch { Bad "更新配置失败：$($_.Exception.Message)"; Read-Host "`n按回车退出"; exit 1 }

# ---------- 5. 重启本地服务 ----------
Step 5 '重启本地服务（加载新配置）'
$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}
Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $proj `
  -RedirectStandardOutput (Join-Path $proj 'server.out.log') `
  -RedirectStandardError (Join-Path $proj 'server.err.log') `
  -WindowStyle Hidden
Start-Sleep -Seconds 4
$listen = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($listen) { Ok '本地服务已启动（端口 3000）' } else { Bad '本地服务启动失败，请查看 server.err.log'; Read-Host "`n按回车退出"; exit 1 }

# ---------- 6. 验证 ----------
Step 6 '验证访问'
$localOk = $false; $tunnelOk = $false
try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/' -TimeoutSec 8 -UseBasicParsing; if ($r.StatusCode -eq 200) { $localOk = $true; Ok '本地服务正常' } } catch { Bad "本地访问异常：$($_.Exception.Message)" }
try { $r2 = Invoke-WebRequest -Uri "$url/" -TimeoutSec 25 -UseBasicParsing; if ($r2.StatusCode -eq 200) { $tunnelOk = $true; Ok '公网隧道正常' } } catch { Warn "公网刚建立可能还在生效中，稍等片刻再打开" }

Write-Host ''
Write-Host '==========================================' -ForegroundColor Green
Write-Host '  ✅ 修复完成！' -ForegroundColor Green
Write-Host '==========================================' -ForegroundColor Green
Write-Host ''
Write-Host '  新网址（手机/浏览器打开）：' -ForegroundColor White
Write-Host "  $url" -ForegroundColor Yellow
Write-Host ''
if (-not ($localOk -and $tunnelOk)) { Write-Host '  个别检查未通过，稍等 10 秒刷新即可。' -ForegroundColor Yellow; Write-Host '' }
Read-Host '按回车关闭本窗口（服务和隧道会继续后台运行）'
