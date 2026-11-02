<#
  pack.ps1 —— 打出一个可以直接发群的 zip

  用法：
      pwsh tools/pack.ps1
      pwsh tools/pack.ps1 -OutDir D:\发布

  产物：
      dist/dsh-phosphor-v<version>.zip

  这个脚本做四件事，每一件都对应过一次真实的教训：

  ① 【版本号一致性】校验 package.json 的 version 与 client.js 里的 PHOS_VERSION。
     测试者报问题时会报 LAB 里显示的那一行（PHOSPHOR v1.0-beta1），
     如果它和包版本对不上，那个版本号就是假的 —— 所以这里不一致就拒绝打包。

  ② 【排除 .git】仓库历史约 9 MB，而且历史里含有作者本人的私人内容
     （角色卡文本、真实会话 id）。"把整个文件夹压成 zip"会把那些一起发出去。
     所以这里【只复制文件】，从不整目录压缩。

  ③ 【打包后回读扫描】压完后再扫一遍暂存目录，命中敏感串就删掉 zip 并失败。
     只靠"我记得排除了"是不够的，必须有一次机械核对。

  ④ 【不碰远端】只产出一个 zip，不上传、不发布、不改版本号。
#>
param(
  [string]$OutDir,
  [switch]$KeepStaging
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Fail($msg) {
  Write-Host ''
  Write-Host ('  ★ ' + $msg) -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host '=== PHOSPHOR 打包 ==='

# ── ① 版本号一致性 ────────────────────────────────────────────────────────────
$pkgPath = Join-Path $root 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$ver = $pkg.version

# 【不再做"推导后比对"】以前这里把 1.0.0-beta.2 映射成 v1.0-beta2 再比，
# 多一层映射就多一次错的机会。现在 client.js 的 PHOS_VERSION 与 package.json
# 的 version 【逐字相同】，直接比即可。
$expect = $ver
if ($ver -notmatch '^\d+\.\d+\.\d+(-[a-z]+\.[0-9]+)?$') {
  Fail ('version 形状不认识：' + $ver)
}

$clientPath = Join-Path $root 'client.js'
$clientSrc = [System.IO.File]::ReadAllText($clientPath)
$m = [regex]::Match($clientSrc, "const PHOS_VERSION = '([^']+)'")
if (-not $m.Success) { Fail 'client.js 里找不到 PHOS_VERSION' }
$shown = $m.Groups[1].Value

Write-Host ('  package.json : ' + $ver + '  → 期望显示 ' + $expect)
Write-Host ('  client.js    : ' + $shown)
if ($shown -ne $expect) {
  Fail ('版本不一致：LAB 会显示「' + $shown + '」，但包版本是 ' + $ver + '（应为「' + $expect + '」）')
}
Write-Host '  版本一致 ✓'

# 构建日期必须存在且是 YYYY-MM-DD
$mb = [regex]::Match($clientSrc, "const PHOS_BUILD = '([^']+)'")
if (-not $mb.Success) { Fail 'client.js 里找不到 PHOS_BUILD' }
if ($mb.Groups[1].Value -notmatch '^\d{4}-\d{2}-\d{2}$') {
  Fail ('PHOS_BUILD 不是 YYYY-MM-DD：' + $mb.Groups[1].Value)
}
Write-Host ('  构建日期 : ' + $mb.Groups[1].Value)

# ── ①.5 产物路径：必须在这里定下来，并在打包前【先删旧产物】
# 否则一次失败的打包会把上一版 zip 留在 dist/ 里，看起来像"新包已生成"，
# 而它其实是旧的 —— 这种错误会直接发到测试者手上。
if (-not $OutDir) { $OutDir = Join-Path $root 'dist' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$zipName = 'dsh-phosphor-' + $ver + '.zip'
$zipPath = Join-Path $OutDir $zipName
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
  Write-Host ('  旧产物     : 已删除 ' + $zipName)
}
Write-Host ('  目标       : ' + $zipPath)

# ── ② 暂存（只复制文件，绝不整目录压）────────────────────────────────────────
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ('ph-pack-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# 永不入包的东西。.git 放在第一条，因为它是唯一"带了会出事"的。
$excludeDirs = @('.git', '.backup', 'node_modules', 'dist', '__pycache__', '.probe')
$excludeFiles = @('*.log', '*.tmp', '*.bak', '*~', '.DS_Store', 'Thumbs.db')
# 私有词表必须排除：它【本身含有全部敏感词】，一旦入包会让扫描每次都命中
# —— 这是好事（说明扫描有效），但把词表排除掉才是正解。
$excludeNames = @('.pack-private-patterns.txt')

# 【只打包 git 跟踪的文件】
# 以前是"遍历目录 + 黑名单"。问题是：黑名单必须跟着新增的忽略项一路维护，
# 漏一个就把本地开发产物打进 zip —— 这一次就漏了 .probe/（里面是真实路径）。
# 换成以 git 索引为准之后，.gitignore 就是唯一的事实来源，不会再漏。
$tracked = @()
Push-Location $root
try {
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $tracked = @(git ls-files 2>$null)
  }
} catch { $tracked = @() }
Pop-Location

$copied = 0
if ($tracked.Count -gt 0) {
  Write-Host ('  文件来源 : git 索引（' + $tracked.Count + ' 个跟踪文件）')
  $sources = $tracked | ForEach-Object { Get-Item (Join-Path $root $_) -ErrorAction SilentlyContinue }
} else {
  Write-Host '  文件来源 : 目录遍历（不是 git 仓库）'
  $sources = Get-ChildItem $root -Recurse -File
}

$sources | Where-Object { $_ } | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length).TrimStart('\', '/')
  $parts = $rel -split '[\\/]'
  if ($parts | Where-Object { $excludeDirs -contains $_ }) { return }
  $name = $_.Name
  if ($excludeFiles | Where-Object { $name -like $_ }) { return }
  if ($excludeNames -contains $name) { return }
  # 本脚本自己也不入包（测试者用不到，而且会让人以为要跑它）
  if ($rel -eq 'tools\pack.ps1' -or $rel -eq 'tools/pack.ps1') { return }

  $dest = Join-Path $staging $rel
  $dir = Split-Path $dest -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  Copy-Item $_.FullName $dest -Force
  $script:copied += 1
}
Write-Host ('  暂存文件数 : ' + $copied)

# .git 绝不能出现在暂存里
if (Test-Path (Join-Path $staging '.git')) { Fail '暂存目录里出现了 .git —— 立即中止' }

# ── ③ 敏感串扫描（机械核对，不靠记忆）──────────────────────────────────────
# 【这里只写结构型规则，不写具体的人名 / 文件名 / 作品名】
# 原因：这个脚本本身会被公开到仓库里。把用户名、会话 id、私人作品名硬编码进来，
# 只是把泄露换了个地方 —— 从成品挪到了工具里。
# 具体名词放在本地文件 .pack-private-patterns.txt（已在 .gitignore 中），
# 存在就一并加载，不存在就只做结构型检查。
$banned = @(
  'ignore_safety_rules',   # 越权配置片段的特征字段
  'minor_protection',
  'allowed_content_override'
)
$bannedRegex = @(
  'C:\\Users\\[^\\"\s]+\\',                                                 # 写死的用户目录
  'session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'    # 真实会话 id
)

$privateList = Join-Path $root '.pack-private-patterns.txt'
if (Test-Path $privateList) {
  $extra = Get-Content $privateList | Where-Object { $_.Trim() } | ForEach-Object { $_.Trim() }
  if ($extra) { $banned += $extra }
  Write-Host ('  私有词表   : 已加载 ' + $extra.Count + ' 条')
} else {
  Write-Host '  私有词表   : 未找到（只做结构型检查）'
}

$hits = @()
Get-ChildItem $staging -Recurse -File | ForEach-Object {
  $t = [System.IO.File]::ReadAllText($_.FullName)
  foreach ($pat in $banned) {
    if ($t.Contains($pat)) { $hits += ($_.Name + ' :: ' + $pat) }
  }
  foreach ($re in $bannedRegex) {
    if ([regex]::IsMatch($t, $re)) { $hits += ($_.Name + ' :: /' + $re + '/') }
  }
}
if ($hits.Count -gt 0) {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  Fail ('包里仍有敏感内容：' + ($hits -join ' | '))
}
Write-Host '  敏感串扫描 : 干净 ✓'
# ── ④ 压缩 ────────────────────────────────────────────────────────────────────
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal

# 压完再核一次：zip 的条目里不能有 .git
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = $zip.Entries | ForEach-Object { $_.FullName }
} finally { $zip.Dispose() }
if ($entries | Where-Object { $_ -like '.git/*' -or $_ -like '*/.git/*' }) {
  Remove-Item $zipPath -Force
  Fail 'zip 里出现了 .git 条目 —— 已删除产物'
}

if (-not $KeepStaging) { Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue }

$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 0)
Write-Host ''
Write-Host ('  产物   : ' + $zipPath)
Write-Host ('  大小   : ' + $size + ' KB')
Write-Host ('  条目数 : ' + $entries.Count)
Write-Host ''
Write-Host '  包内清单（前 20 条）：'
$entries | Sort-Object | Select-Object -First 20 | ForEach-Object { Write-Host ('    ' + $_) }
if ($entries.Count -gt 20) { Write-Host ('    … 共 ' + $entries.Count + ' 条') }
Write-Host ''
Write-Host '=== 完成 ===' -ForegroundColor Green
