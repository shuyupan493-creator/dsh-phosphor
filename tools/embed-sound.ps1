<#
  DSH // PHOSPHOR — 把 WAV 素材瘦身并内嵌进 client.js

  为什么需要这个脚本
  ------------------------------------------------------------------
  插件没有静态资源出口（package.json 的 exports 白名单只列 js/json/svg，
  客户端 bundle 路由只打包 JS），所以音频必须内嵌进 client.js 的 base64。
  而内嵌前必须瘦身，否则体积失控（原始素材 559KB → 内嵌后 base64 745K 字符）。

  这个脚本把整条流水线固化下来：
      读 WAV → 分析包络找有效段 → 裁剪 → 立体声转单声道 → 重采样（盒式平均）
      → 32bit 浮点转 16bit → 末尾淡出 → 归一化（默认关闭）→ 重新编码 WAV
      → base64 分片 → 替换 client.js 里的 CHIME_B64 块

  用法
  ------------------------------------------------------------------
    # 先干跑，只看分析结果与预期体积，不改文件
    pwsh tools/embed-sound.ps1 -Src "C:\path\to\叮~~~~.wav" -WhatIf

    # 确认后正式写入 client.js
    pwsh tools/embed-sound.ps1 -Src "C:\path\to\叮~~~~.wav"

  参数
  ------------------------------------------------------------------
    -Src        源 WAV（任意格式：PCM / IEEE float，单/多声道）
    -Seconds    裁剪时长（默认 0.55）。先用 -WhatIf 看包络再定
    -OutRate    输出采样率（默认 22050）
    -FadeMs     末尾淡出毫秒数（默认 60）
    -Peak       归一化目标峰值（默认 0 = 不归一化，保持原始动态）
    -Target     要替换的变量名（默认 CHIME_B64）
    -Client     client.js 路径（默认包根目录）
    -WhatIf     只分析，不写文件

  注意
  ------------------------------------------------------------------
  · 裁剪点不要"刚好卡在最后一个有声样本" —— 留一点余韵，
    否则铃声会像被掐掉。用 -WhatIf 看包络再决定。
  · 重采样用 2:1 盒式平均（相邻两样本取均值），它同时充当抗锯齿低通。
    直接抽样会产生混叠。
  · 输出是 16bit PCM 单声道，Chromium 的 decodeAudioData 原生支持。
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][string]$Src,
  # 裁剪时长。0 = 自动（按能量阈值找结尾）；>0 = 固定时长。
  # 【为什么默认自动】固定时长对不同素材会切错：
  #   复位.wav 的峰值在 0.70~0.85s，固定裁到 0.55s 会把最响的部分切掉。
  [double]$Seconds = 0,
  # 自动裁剪时的能量阈值（dBFS）与尾部余量
  # 【注意】对"噪声本底一路延续到文件末尾"的素材（这次的复位/打字/叮都是），
  # 自动裁尾会保守到几乎不裁。这不是 bug —— 它宁可多留也不切错。
  # 确实要裁短时，用固定 -Seconds，但先用 -WhatIf 看包络确认峰值没被切掉。
  [double]$ThreshDb = -42,
  [int]$TailMs = 90,
  [int]$OutRate = 22050,
  [int]$FadeMs = 60,
  # 归一化目标峰值。设为 0 表示【不归一化，保持原始动态】（增益 1.0）。
  #
  # 【重要】默认值是 0（不归一化）—— 这是踩坑后改的：
  #   原先默认 0.84，于是脚本会把复位音放大 2.9 倍。对 crest factor 高的
  #   （瞬态型）素材，这种放大在听感上就是"失真/炸"。
  #   响度应该由【播放增益】控制，而不是改样本 —— 播放增益不会削波。
  #   确实需要归一化时显式传 -Peak 0.84，但先看脚本输出的 crest 值：
  #     crest < 10（持续音，如铃声）→ 归一化可以
  #     crest > 20（瞬态/噪声型）  → 不要按峰值归一化
  [double]$Peak = 0,
  [string]$Target = 'CHIME_B64',
  [string]$Client
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Src)) { throw "源文件不存在: $Src" }
if (-not $Client) { $Client = Join-Path (Split-Path $PSScriptRoot -Parent) 'client.js' }
if (-not (Test-Path $Client)) { throw "client.js 不存在: $Client" }

function Read-Wav {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ([System.Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RIFF') { throw '不是 RIFF/WAVE' }
  $pos = 12; $fmt = $null; $dataOff = -1; $dataLen = 0
  while ($pos -lt $bytes.Length - 8) {
    $id = [System.Text.Encoding]::ASCII.GetString($bytes, $pos, 4)
    $sz = [BitConverter]::ToUInt32($bytes, $pos + 4)
    if ($id -eq 'fmt ') {
      $fmt = @{
        Tag      = [BitConverter]::ToUInt16($bytes, $pos + 8)
        Channels = [BitConverter]::ToUInt16($bytes, $pos + 10)
        Rate     = [BitConverter]::ToUInt32($bytes, $pos + 12)
        Bits     = [BitConverter]::ToUInt16($bytes, $pos + 22)
      }
    }
    elseif ($id -eq 'data') {
      # 【坑】chunk 头是 8 字节（4 ID + 4 size），内容从 pos+8 开始。
      # 直接用 pos 会读到 chunk 头，样本值会出现 1e20 这种荒谬数字。
      $dataOff = $pos + 8; $dataLen = $sz; break
    }
    $pos += 8 + $sz
  }
  if ($null -eq $fmt) { throw '缺少 fmt chunk' }
  if ($dataOff -lt 0) { throw '缺少 data chunk' }
  @{ Bytes = $bytes; Fmt = $fmt; DataOff = $dataOff; DataLen = $dataLen }
}

function Get-Mono {
  param($Wav)
  $f = $Wav.Fmt; $bytes = $Wav.Bytes; $off = $Wav.DataOff; $len = $Wav.DataLen
  if ($f.Tag -ne 3) { throw ("暂只支持 IEEE float（fmt=3），当前 fmt=" + $f.Tag + "。PCM 输入请先转换。") }
  if ($f.Bits -ne 32) { throw ("暂只支持 32bit float，当前 " + $f.Bits + "bit。" ) }
  $n = [int]($len / 4)
  $f32 = New-Object 'single[]' $n
  [Buffer]::BlockCopy($bytes, $off, $f32, 0, $len)
  $frames = [int]($n / $f.Channels)
  $mono = New-Object 'single[]' $frames
  for ($i = 0; $i -lt $frames; $i++) {
    $s = 0.0
    for ($c = 0; $c -lt $f.Channels; $c++) { $s += $f32[$i * $f.Channels + $c] }
    $mono[$i] = $s / $f.Channels
  }
  @{ Mono = $mono; Frames = $frames; Rate = $f.Rate }
}

function Show-Envelope {
  param($Mono, [int]$Rate, [double]$GlobalPeak)
  $hop = [int]($Rate / 100)            # 10ms
  $frames = $Mono.Count
  $segs = [int][math]::Floor($frames / $hop)
  Write-Host ('  包络（每格 10ms，共 {0:N2}s）：' -f ($frames / $Rate))
  for ($s = 0; $s -lt $segs; $s++) {
    if ($s % 10 -ne 0) { continue }
    $row = @()
    for ($k = $s; $k -lt [math]::Min($s + 10, $segs); $k++) {
      $m = 0.0; $b = $k * $hop
      for ($j = 0; $j -lt $hop; $j++) { $v = [math]::Abs($Mono[$b + $j]); if ($v -gt $m) { $m = $v } }
      $row += ('{0:0.00}' -f $m)
    }
    Write-Host ('    t={0:0.00}s  {1}' -f ($s * 0.01), ($row -join ' '))
  }
}

Write-Host '=== 1. 读取源文件 ==='
$wav = Read-Wav -Path $Src
Write-Host ('  {0}' -f (Split-Path $Src -Leaf))
Write-Host ('  {0} 字节 / fmt={1} / {2}ch / {3}Hz / {4}bit' -f `
    $wav.Bytes.Length, $wav.Fmt.Tag, $wav.Fmt.Channels, $wav.Fmt.Rate, $wav.Fmt.Bits)

Write-Host '=== 2. 转单声道 ==='
$mi = Get-Mono -Wav $wav
Write-Host ('  {0} 帧 / {1:N3}s' -f $mi.Frames, ($mi.Frames / $mi.Rate))

Write-Host '=== 3. 分析包络（决定裁剪点）==='
$gp = 0.0
foreach ($v in $mi.Mono) { $a = [math]::Abs($v); if ($a -gt $gp) { $gp = $a } }
Show-Envelope -Mono $mi.Mono -Rate $mi.Rate -GlobalPeak $gp
Write-Host ('  全局峰值 = {0:0.000}' -f $gp)

Write-Host '=== 4. 裁剪 + 重采样（2:1 盒式平均，兼作抗锯齿低通）==='
$ratio = [int][math]::Round($mi.Rate / $OutRate)
if ($ratio -lt 1) { $ratio = 1 }

if ($Seconds -gt 0) {
  $keep = [int]($Seconds * $mi.Rate)
  Write-Host ('  裁剪方式：固定 {0:N3}s' -f $Seconds)
} else {
  # 自动：按 10ms 格的峰值找最后一个超过阈值的格，再加尾部余量。
  # 阈值用相对全局峰值的比例（ThreshDb 视作 dBFS，但以本素材峰值为 0dB 参照），
  # 这样对"整体偏轻"的素材也能正确找到结尾。
  $thr = $gp * [math]::Pow(10, $ThreshDb / 20.0)
  $hop = [int]($mi.Rate / 100)
  $segs = [int][math]::Floor($mi.Frames / $hop)
  $lastLoud = -1
  for ($s = 0; $s -lt $segs; $s++) {
    $m = 0.0; $b = $s * $hop
    for ($j = 0; $j -lt $hop; $j++) { $a = [math]::Abs($mi.Mono[$b + $j]); if ($a -gt $m) { $m = $a } }
    if ($m -gt $thr) { $lastLoud = $s }
  }
  if ($lastLoud -lt 0) { throw '自动裁剪失败：整段都低于阈值，请手动指定 -Seconds' }
  $keep = [int](($lastLoud + 1) * $hop + ($TailMs / 1000.0) * $mi.Rate)
  Write-Host ('  裁剪方式：自动（阈值 {0:N1}dB，尾部余量 {1}ms）' -f $ThreshDb, $TailMs)
  Write-Host ('    最后一个有声格 t={0:N3}s → 保留到 {1:N3}s' -f ($lastLoud * 0.01), ($keep / $mi.Rate))
}
if ($keep -gt $mi.Frames) { $keep = $mi.Frames }
$outFrames = [int][math]::Floor($keep / $ratio)
$out = New-Object 'single[]' $outFrames
for ($i = 0; $i -lt $outFrames; $i++) {
  $s = 0.0
  for ($k = 0; $k -lt $ratio; $k++) { $s += $mi.Mono[$i * $ratio + $k] }
  $out[$i] = $s / $ratio
}
Write-Host ('  保留 {0:N3}s → 输出 {1} 帧 / {2:N3}s @ {3}Hz（抽取比 {4}:1）' -f `
    ($keep / $mi.Rate), $outFrames, ($outFrames / $OutRate), $OutRate, $ratio)

Write-Host '=== 5. 末尾淡出 ==='
$fadeN = [int](($FadeMs / 1000.0) * $OutRate)
for ($i = 0; $i -lt $fadeN; $i++) {
  $idx = $outFrames - $fadeN + $i
  if ($idx -ge 0) { $out[$idx] = $out[$idx] * (1.0 - $i / $fadeN) }
}
Write-Host ('  {0}ms' -f $FadeMs)

Write-Host '=== 6. 响度与归一化 ==='
$pk = 0.0
$sumsq = 0.0
foreach ($v in $out) { $a = [math]::Abs($v); if ($a -gt $pk) { $pk = $a }; $sumsq += $v * $v }
$rms = [math]::Sqrt($sumsq / $outFrames)
$crest = if ($rms -gt 0) { $pk / $rms } else { 0 }
Write-Host ('  峰值 {0:0.000}   RMS {1:0.0000}   crest {2:0.00}' -f $pk, $rms, $crest)
Write-Host ('  类型判断：' + $(if ($crest -lt 10) { '持续型（铃声/音调类）—— 归一化到峰值可以' } else { '瞬态/噪声型 —— 【不要】按峰值归一化，响度用播放增益控制' }))
if ($Peak -gt 0) {
  $gain = if ($pk -gt 0) { $Peak / $pk } else { 1.0 }
  Write-Host ('  归一化：峰值 {0:0.000} → 增益 {1:0.000} → {2:0.00}' -f $pk, $gain, ($pk * $gain))
  if ($crest -gt 15 -and $gain -gt 1.5) {
    Write-Host ('  【警告】crest 高（{0:0.0}）且增益大（{1:0.00}×）—— 这会让瞬态尖峰变得刺耳。' -f $crest, $gain)
    Write-Host  '          建议改用 -Peak 0（不归一化），在播放端用增益补响度。'
  }
} else {
  $gain = 1.0
  Write-Host '  归一化：已关闭（-Peak 0），保持原始动态，增益 1.0'
}

Write-Host '=== 7. 编码 16bit PCM WAV ==='
$dataLen = $outFrames * 2
$wavOut = New-Object byte[] (44 + $dataLen)
[System.Text.Encoding]::ASCII.GetBytes('RIFF').CopyTo($wavOut, 0)
[BitConverter]::GetBytes([uint32](36 + $dataLen)).CopyTo($wavOut, 4)
[System.Text.Encoding]::ASCII.GetBytes('WAVE').CopyTo($wavOut, 8)
[System.Text.Encoding]::ASCII.GetBytes('fmt ').CopyTo($wavOut, 12)
[BitConverter]::GetBytes([uint32]16).CopyTo($wavOut, 16)
[BitConverter]::GetBytes([uint16]1).CopyTo($wavOut, 20)      # PCM
[BitConverter]::GetBytes([uint16]1).CopyTo($wavOut, 22)      # 单声道
[BitConverter]::GetBytes([uint32]$OutRate).CopyTo($wavOut, 24)
[BitConverter]::GetBytes([uint32]($OutRate * 2)).CopyTo($wavOut, 28)
[BitConverter]::GetBytes([uint16]2).CopyTo($wavOut, 32)
[BitConverter]::GetBytes([uint16]16).CopyTo($wavOut, 34)
[System.Text.Encoding]::ASCII.GetBytes('data').CopyTo($wavOut, 36)
[BitConverter]::GetBytes([uint32]$dataLen).CopyTo($wavOut, 40)
for ($i = 0; $i -lt $outFrames; $i++) {
  $v = $out[$i] * $gain
  if ($v -gt 1) { $v = 1 } elseif ($v -lt -1) { $v = -1 }
  [BitConverter]::GetBytes([int16][math]::Round($v * 32767)).CopyTo($wavOut, 44 + $i * 2)
}
$b64 = [System.Convert]::ToBase64String($wavOut)
Write-Host ('  输出 {0} 字节 → base64 {1} 字符' -f $wavOut.Length, $b64.Length)
Write-Host ('  相比源文件缩减 {0:N1}%' -f (100 - $wavOut.Length / $wav.Bytes.Length * 100))

if ($WhatIf) {
  Write-Host ''
  Write-Host '  -WhatIf：只分析，未修改 client.js。确认裁剪点合适后去掉 -WhatIf 重跑。'
  return
}

Write-Host '=== 8. 替换 client.js 里的变量块 ==='
$clientText = Get-Content $Client -Raw
$pattern = "(?s)(const $Target =\s*).*?(;\r?\n)"
if (-not [regex]::IsMatch($clientText, $pattern)) { throw "在 client.js 里找不到 const $Target = …; 块" }

# base64 每 160 字符一行，便于阅读与 diff
$chunk = 160
$lines = @()
for ($i = 0; $i -lt $b64.Length; $i += $chunk) {
  $seg = $b64.Substring($i, [Math]::Min($chunk, $b64.Length - $i))
  $isLast = ($i + $chunk -ge $b64.Length)
  $lines += ("          '" + $seg + "'" + $(if ($isLast) { ';' } else { ' +' }))
}
$replacement = ('${1}' + "`r`n" + ($lines -join "`r`n") + "`r`n")
$newText = [regex]::Replace($clientText, $pattern, $replacement)

if ($PSCmdlet.ShouldProcess($Client, "替换 $Target")) {
  Set-Content -Path $Client -Value $newText -Encoding UTF8 -NoNewline
  Write-Host ('  已写入 {0}' -f $Client)
  Write-Host ''
  Write-Host '  下一步：'
  Write-Host '    1) 校验语法（把扩展名临时改成 .mjs 再 node --check）'
  Write-Host '    2) 【完全退出 DSH 再打开】—— 刷新页面不会重建 bundle'
}
