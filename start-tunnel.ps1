# 币易商城 - 启动公网穿透并显示地址（供「一键启动(服务+穿透).bat」最小化调用）
$proj = $PSScriptRoot
$cf = 'C:\Users\Administrator\Desktop\cf.exe'
if (-not (Test-Path $cf)) { Write-Host "  找不到 cf.exe：$cf"; exit 1 }

$err = Join-Path $proj 'cf-启动.err.log'
$out = Join-Path $proj 'cf-启动.out.log'
Remove-Item $err, $out -Force -ErrorAction SilentlyContinue

Start-Process -FilePath $cf -ArgumentList @('tunnel', '--url', 'http://localhost:3000') `
  -RedirectStandardError $err -RedirectStandardOutput $out `
  -WindowStyle Hidden -WorkingDirectory $proj

$url = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  $raw = Get-Content $err -Raw -ErrorAction SilentlyContinue
  if ($raw) {
    $m = [regex]::Match($raw, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($m.Success) { $url = $m.Value; break }
  }
}

if ($url) {
  Set-Content -Path (Join-Path $proj '公网地址.txt') -Value $url -Encoding UTF8
  Write-Host ''
  Write-Host '  公网地址（手机/浏览器打开，每次启动会变）：'
  Write-Host "  $url" -ForegroundColor Yellow
  Write-Host '  （同时已保存到项目里的 公网地址.txt）'
} else {
  Write-Host '  60 秒内未获取到公网地址，请查看 cf-启动.err.log'
}
