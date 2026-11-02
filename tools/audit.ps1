<#
  audit.ps1 —— 一次跑完所有自检

  用法：  pwsh tools/audit.ps1
  退出码：0 = 全部通过；非 0 = 失败项数

  含三层：
    ① 静态检查（verify.ps1）—— 资源成对性、CSS 完整性、词典一致性、
       音效触发源接线、宿主契约、危险模式
    ② 运行时检查（render-check.mjs）—— 真的 import client.js、调 apply、
       渲染面板与各 slot 组件；有不可达引用会真抛 ReferenceError
    ③ 目标文件比对 —— 确认 junction 里那份与工作区一致
#>
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
$client = Join-Path $root 'client.js'
$fail = 0

Write-Host ''
Write-Host '############################################################'
Write-Host '#  DSH // PHOSPHOR  完整自检'
Write-Host '############################################################'

# ── ③ 先确认检查的是"真的那份文件" ──────────────────────────────────────────
Write-Host ''
Write-Host '【0】目标文件'
# 【这里曾写死某个用户目录】—— 这份自检会随仓库公开分发：
#   · 写死路径别人跑不了（除非他的用户名恰好相同）
#   · 同时也把自己的账户名泄露出去了
# 现在按 DSH 注入的环境变量解析，取不到再退回默认 profile 位置。
# 优先用 DSH 注入的 DSH_PROFILE_DIR；否则按平台退回 $HOME（Windows 上 $HOME
# 由 PowerShell 提供，macOS/Linux 上是原生变量）——只认 $env:USERPROFILE
# 会让非 Windows 用户拿不到路径。
if ($env:DSH_PROFILE_DIR) { $profileDir = $env:DSH_PROFILE_DIR }
elseif ($env:USERPROFILE) { $profileDir = Join-Path $env:USERPROFILE '.dsh/profiles/desktop' }
else { $profileDir = Join-Path $HOME '.dsh/profiles/desktop' }
$junction = Join-Path $profileDir 'node_modules/@local/dsh-phosphor/client.js'
Write-Host ('  工作区 : ' + $client)
if (Test-Path $junction) {
  $a = (Get-FileHash $client -Algorithm SHA256).Hash
  $b = (Get-FileHash $junction -Algorithm SHA256).Hash
  if ($a -eq $b) { Write-Host '  junction : 一致 ✓' }
  else { Write-Host '  junction : ★ 不一致（同步可能未完成）'; $fail++ }
} else {
  Write-Host '  junction : （不存在，跳过）'
}

# ── ① 静态 ─────────────────────────────────────────────────────────────────
& pwsh -NoProfile -File (Join-Path $PSScriptRoot 'verify.ps1') -Path $client
if ($LASTEXITCODE -ne 0) { $fail += $LASTEXITCODE }

# ── ② 运行时 ───────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '############################################################'
Write-Host '#  运行时检查（真的执行 client.js）'
Write-Host '############################################################'
& node (Join-Path $PSScriptRoot 'render-check.mjs')
if ($LASTEXITCODE -ne 0) { $fail++ }

# ── ③ 凭据扫描 ─────────────────────────────────────────────────────────────
# 【为什么把这件事放进自检】主题代码、打包脚本、文档都会被公开。凭据泄露
# 一旦发生，事后改代码是没用的 —— 得假设它已经泄漏、去轮换密钥。
# 所以这里做成机械检查，每次自检都跑一遍。
#
# 规则要【够严】，否则会被内嵌音频的 base64 噪声刷屏：
#   · 只用裸 "AKIA" 会假命中 —— 本项目就在音频 base64 里命中过一次
#   · 因此全部改成"完整形状"匹配
Write-Host ''
Write-Host '【③】凭据扫描'
$credPatterns = @(
  @('gh[pousr]_[A-Za-z0-9]{36}',                 'GitHub token'),
  @('github_pat_[A-Za-z0-9_]{22,}',              'GitHub 细粒度 token'),
  @('sk-[A-Za-z0-9]{20,}',                       'OpenAI 风格 key'),
  @('AKIA[0-9A-Z]{16}',                          'AWS access key'),
  @('-----BEGIN [A-Z ]*PRIVATE KEY-----',        '私钥块'),
  @('xox[baprs]-[A-Za-z0-9-]{10,}',              'Slack token'),
  @('https://[^/\s:]+:[^/\s@]+@',                'URL 里内嵌凭据')
)
$repoRoot = Split-Path $PSScriptRoot -Parent
$trackedList = @()
Push-Location $repoRoot
try { $trackedList = @(git ls-files 2>$null) } catch { $trackedList = @() }
Pop-Location
if ($trackedList.Count -eq 0) {
  Write-Host '  （不是 git 仓库或没有 git，退回扫描全部源文件）'
  $trackedList = Get-ChildItem $repoRoot -Recurse -File |
    Where-Object { $_.FullName -notmatch '\\\.git\\|\\node_modules\\|\\\.backup\\|\\dist\\' } |
    ForEach-Object { $_.FullName.Substring($repoRoot.Length).TrimStart('\','/') }
}
$credHits = 0
foreach ($rel in $trackedList) {
  $full = Join-Path $repoRoot $rel
  if (-not (Test-Path $full)) { continue }
  $txt = [System.IO.File]::ReadAllText($full)
  foreach ($p in $credPatterns) {
    if ([regex]::IsMatch($txt, $p[0])) {
      Write-Host ('  ★ ' + $rel + ' :: ' + $p[1]) -ForegroundColor Red
      $script:credHits++
    }
  }
}
if ($credHits -eq 0) {
  Write-Host ('  已扫描 ' + $trackedList.Count + ' 个文件，未发现凭据 ✓')
} else {
  Write-Host ''
  Write-Host '  ⚠ 发现了凭据形状的字符串。不要只改代码 —— 假设它已泄漏并轮换。' -ForegroundColor Red
  $fail += $credHits
}

# ── ④ 版本号一致性 ─────────────────────────────────────────────────────────
# 【为什么值得单独查】版本号有四个落点：package.json、client.js 的
# PHOS_VERSION、README、QUICKSTART。测试者被要求"报版本号"，
# 四处不同就等于报出来的和实际发的对不上，排查会白费。
# 这次就真的落后了三处（启动自检行、README、QUICKSTART）。
Write-Host ''
Write-Host '【④】版本一致性'
$root = Split-Path $client -Parent
$pkgPath = Join-Path $root 'package.json'
if (-not (Test-Path $pkgPath)) {
  Write-Host '  ★ 找不到 package.json' -ForegroundColor Red
  $fail++
} else {
  $pkgVer = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
  $clientRaw = [System.IO.File]::ReadAllText($client)
  $mVer = [regex]::Match($clientRaw, "PHOS_VERSION = '([^']+)'")
  $mBld = [regex]::Match($clientRaw, "PHOS_BUILD = '([^']+)'")
  $shown = if ($mVer.Success) { $mVer.Groups[1].Value } else { '' }
  $build = if ($mBld.Success) { $mBld.Groups[1].Value } else { '' }

  Write-Host ('  package.json : ' + $pkgVer)
  Write-Host ('  client.js    : ' + $shown)

  if ($shown -ne $pkgVer) {
    Write-Host '  ★ PHOS_VERSION 与 package.json 不一致（必须逐字相同）' -ForegroundColor Red
    $fail++
  } else { Write-Host '  PHOS_VERSION 一致 ✓' }

  if ($build -match '^\d{4}-\d{2}-\d{2}$') { Write-Host ('  PHOS_BUILD   : ' + $build + ' ✓') }
  else { Write-Host '  ★ PHOS_BUILD 缺失或不是 YYYY-MM-DD' -ForegroundColor Red; $fail++ }

  foreach ($doc in @('README.md', 'QUICKSTART.txt')) {
    $dp = Join-Path $root $doc
    if (-not (Test-Path $dp)) { continue }
    $dt = [System.IO.File]::ReadAllText($dp)
    if ($dt.Contains($pkgVer)) { Write-Host ('  ' + $doc + ' : 含 ' + $pkgVer + ' ✓') }
    else { Write-Host ('  ★ ' + $doc + ' 里没有 ' + $pkgVer + '（文档落后）') -ForegroundColor Red; $fail++ }
  }
}

Write-Host ''
if ($fail -eq 0) { Write-Host '### 三层自检全部通过 ###' } else { Write-Host ('### 共 ' + $fail + ' 项失败 ###') }
exit $fail
