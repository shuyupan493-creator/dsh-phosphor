<#
  fix-md-math.ps1 —— 把"易掉格式"的 Markdown 数学结构加固成通用可渲染写法

  为什么需要它
  ------------------------------------------------------------------
  课件类 Markdown 的数学密度很高（本次审计的那份：224 个 $、28 个 $$）。
  而【块级公式跨行】是掉格式的头号原因：

      $$a=b
      =c$$              ← $$ 的开闭不在同一行

  按行配对定界符的渲染器（commonmark 系、GitHub、多数聊天面板、部分博客）
  只看单行 —— 行内找不到闭合的 $$ 会被当【字面文本】输出，
  而且漏出的正文里若含 $ ，会继续误吞后面的真开界符 → 级联错位。
  所以症状通常是"成片掉格式"，而不是单点。

  本脚本做的几件事（都不改一个字符的数学内容）
  ------------------------------------------------------------------
    ① 【最高危】<details> / <summary> → 脱掉标签、保留内容
       实测（从会话记录里挖出）：一条用 <details> 折叠答案的课件，
       该标签【之后的全部 Markdown】（标题、表格、列表）都退化成了字面文本。
       这不是排版问题 —— 补空行没用，必须把标签去掉。
    ② 跨行的 $$ 块 → 合并成单行（用空格连接，\\quad 等原样保留），前后补空行
    ③ 引用块内的跨行 $$ 块 → 在块内合并（保留 "> " 前缀）

  用法
  ------------------------------------------------------------------
    # 先干跑：只报告问题，不改文件
    pwsh tools/fix-md-math.ps1 -Path "C:\path\to\lesson.md" -WhatIf

    # 确认后写入（会先备份为 .bak）
    pwsh tools/fix-md-math.ps1 -Path "C:\path\to\lesson.md"

    # 批量
    Get-ChildItem -Recurse -Filter *.md | ForEach-Object {
      pwsh tools/fix-md-math.ps1 -Path $_.FullName
    }

  注意
  ------------------------------------------------------------------
  · 它【不校验】数学内容本身，只处理定界符与空行。
  · 合并跨行公式时会用空格连接各行 —— 对绝大多数场景正确，
    但若原作者在 $$ 内部用了裸换行表达"换行"的语义（极少见），
    合并后语义会变成同一行。那种情况应改用 \begin{aligned}：
        $$\begin{aligned} a&=b\\ &=c \end{aligned}$$      ← $$ 仍在同一行
  · 合并只影响显示换行；\quad / \qquad / \Rightarrow 之类的间距与箭头不受影响。
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Path)) { throw "文件不存在: $Path" }

$lines = Get-Content $Path
$origCount = $lines.Count

function Get-Bare([string]$s) { return ($s -replace '^>\s?', '').Trim() }

# ── 扫描：找出所有问题（用于 -WhatIf 报告） ────────────────────────────────
$issues = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  $bare = Get-Bare $lines[$i]
  if ($bare -match '\$\$') {
    $open = $bare.StartsWith('$$')
    $close = $bare.EndsWith('$$')
    if ($open -and -not $close) {
      $j = $i
      while ($j -lt $lines.Count) {
        $u = Get-Bare $lines[$j]
        if ($j -gt $i -and $u.EndsWith('$$')) { break }
        $j++
      }
      $issues += [pscustomobject]@{ kind = '跨行 $$ 块'; line = $i + 1; to = $j + 1 }
      $i = $j
    }
  }
}
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^>\s*\$\$') { $issues += [pscustomobject]@{ kind = '引用块内 $$'; line = $i + 1; to = $i + 1 } }
}
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '<details>|<summary>|</details>') {
    # 【这类标签是"内容被整段吞掉"的头号元凶，而不只是排版问题】
    # 实锤（从用户的会话记录里挖出来的）：一条用 <details> 做折叠答案的课件，
    # 该标签之后的【标题、表格、列表】全部退化成字面文本；
    # 而折叠块内部的 $…$ 反而渲染了 —— 因为行内数学逃过了这次"吞掉"。
    # 所以这里单列一类高危问题，并在变换阶段【整块移除】。
    $issues += [pscustomobject]@{ kind = '★HTML 折叠标签（高危：会让其后内容不渲染）'; line = $i + 1; to = $i + 1 }
  }
}

Write-Host ('=== 扫描 ' + (Split-Path $Path -Leaf) + ' ===')
Write-Host ('  行数 ' + $origCount)
if ($issues.Count -eq 0) {
  Write-Host '  未发现问题 ✓'
} else {
  $issues | Group-Object kind | ForEach-Object {
    Write-Host ('  ' + $_.Name + ' × ' + $_.Count)
    $_.Group | ForEach-Object { Write-Host ('      行 ' + $_.line + $(if ($_.to -ne $_.line) { ' → ' + $_.to } else { '' })) }
  }
}

if ($WhatIfPreference) { Write-Host ''; Write-Host '  -WhatIf：仅报告，未修改。'; return }

# ── 变换 ───────────────────────────────────────────────────────────────────
# 【第一步：脱掉 <details> / <summary> 标签，但【保留其内容】】
# 为什么是"脱标签"而不是"移除整块"：
#   渲染器的问题是【从该 HTML 块开始不再按 Markdown 解析】——
#   内容本身还在原文里，只是显示成了字面文本。
#   若把整块删掉，会连【折叠块里的答案正文】一起丢掉 —— 那是内容损失。
#   所以只去掉标签本身，让里面的答案变成正常 Markdown 正文。
# 为什么不能只"补空行"：实测那次失败不是空行问题 ——
#   标签之后的标题/表格/列表全部退化，补空行治不了。
$pre = New-Object System.Collections.Generic.List[string]
foreach ($x in $lines) {
  if ($x -match '^\s*</?details>\s*$') { continue }          # 独占一行的标签 → 删掉
  $y = $x -replace '</?details>', ''                          # 行内出现的 → 脱掉
  if ($y -match '^\s*<summary>(.*?)</summary>\s*$') {
    $pre.Add('#### ' + $Matches[1].Trim())                    # 折叠摘要 → 普通小标题
    continue
  }
  $y = $y -replace '</?summary>', ''
  $pre.Add($y)
}
$lines = $pre.ToArray()

$out = New-Object System.Collections.Generic.List[string]
$i = 0
while ($i -lt $lines.Count) {
  $t = $lines[$i]
  $bare = Get-Bare $t
  if ($bare.StartsWith('$$') -and -not $bare.EndsWith('$$')) {
    $j = $i
    while ($j -lt $lines.Count) {
      $u = Get-Bare $lines[$j]
      if ($j -gt $i -and $u.EndsWith('$$')) { break }
      $j++
    }
    $parts = @()
    for ($k = $i; $k -le $j -and $k -lt $lines.Count; $k++) {
      $seg = Get-Bare $lines[$k]
      $seg = $seg -replace '^\$\$', '' -replace '\$\$$', ''
      if ($seg.Trim() -ne '') { $parts += $seg.Trim() }
    }
    $merged = '$$' + ($parts -join ' ') + '$$'
    if ($t -match '^>') {
      # 原本在引用块里：保留引用前缀，只在块内合并为单行。
      # 【不脱出引用】那样会连带改动周围的引用说明文字，破坏原文结构
      # （第一次实现犯过此错：把整个"考场英文写法"引文块的文字一并脱出）。
      $out.Add('>')
      $out.Add('> ' + $merged)
      $out.Add('>')
    } else {
      $out.Add('')
      $out.Add($merged)
      $out.Add('')
    }
    $i = $j + 1
    continue
  }
  $out.Add($t)
  $i++
}

$res = ($out -join "`r`n")
$res = $res -replace '(?m)(</summary>)\r?\n(?!\r?\n)', "`$1`r`n`r`n"
$res = $res -replace '(?m)(\r?\n){3,}',             "`r`n`r`n"

if ($PSCmdlet.ShouldProcess($Path, '加固数学排版')) {
  if (-not $NoBackup) {
    $bak = $Path + '.bak'
    Copy-Item $Path $bak -Force
    Write-Host ('  已备份 → ' + (Split-Path $bak -Leaf))
  }
  Set-Content $Path -Value $res -Encoding UTF8 -NoNewline
  $after = Get-Content $Path
  Write-Host ('  已写入。行数 ' + $origCount + ' → ' + $after.Count)

  # ── 写入后复检 ──────────────────────────────────────────────────────────
  # 【判据要精确】"跨行 $$"的定义是：本行的 $$ 个数【为奇数】——
  # 那才有开无闭（或反之），必然要和别的行配对。
  # 不能用"是否以 $$ 开头/结尾"来判断：`正文 $$x^2$$ 后续` 这种
  # 单行内既有开也有闭，是合法且能正常渲染的写法，不该报错
  # （第一版就误报了这个，属于"复检比被检代码更容易出错"，值得记一笔）。
  $left = 0
  foreach ($x in $after) {
    $y = ($x -replace '^>\s?', '').Trim()
    $n = ([regex]::Matches($y, '\$\$')).Count
    if ($n % 2 -ne 0) { $left++ }
  }
  $d = ([regex]::Matches(($after -join "`n"), '\$')).Count
  Write-Host ('  复检：跨行 $$ 残留 ' + $left + $(if ($left -eq 0) { ' ✓' } else { ' ★' }))
  Write-Host ('  复检：$ 成对 ' + $(if ($d % 2 -eq 0) { '✓' } else { '★' }) + '（共 ' + $d + ' 个）')
  Write-Host ''
  Write-Host '  下一步：在目标平台打开确认。若某条长公式横向溢出，'
  Write-Host '          把它改成 \begin{aligned} ... \end{aligned}（$$ 仍保持同一行）。'
}
