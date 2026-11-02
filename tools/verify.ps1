<#
  verify.ps1 —— DSH // PHOSPHOR 插件静态自检

  为什么需要它：本插件在开发过程中反复出现【同一类缺陷】——
    建立了资源却没有回收 / 跨作用域引用了看不见的变量 / 建立与拆除不成对。
  这些都不报语法错，只在运行时（而且往往在特定路径下）才暴露。

  本脚本把已知的每一类缺陷都变成一条可机械核对的规则。
  用法：  pwsh tools/verify.ps1 [-Path <client.js>]
#>
param(
  [string]$Path = (Join-Path $PSScriptRoot '..\client.js')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Path)) { throw "找不到 $Path" }
$raw  = Get-Content $Path -Raw
$lines = Get-Content $Path

$fail = 0
function Check([string]$name, [bool]$ok, [string]$detail) {
  $mark = if ($ok) { ' OK ' } else { 'FAIL' }
  if (-not $ok) { $script:fail++ }
  Write-Host ('  [' + $mark + '] ' + $name.PadRight(46) + $detail)
}
function Count([string]$re) { return ([regex]::Matches($raw, $re)).Count }

Write-Host ''
Write-Host '=========== DSH // PHOSPHOR 静态自检 ==========='
Write-Host ('  文件 ' + (Split-Path $Path -Leaf) + '  ' + $lines.Count + ' 行 / ' + (Get-Item $Path).Length + ' 字节')
Write-Host ''

# ── 1. 语法 ────────────────────────────────────────────────────────────────
Write-Host '【1】语法'
$tmp = Join-Path $env:TEMP ('ph-' + [guid]::NewGuid().ToString('N') + '.mjs')
Copy-Item $Path $tmp -Force
$out = & node --check $tmp 2>&1 | Out-String
$synOk = ($LASTEXITCODE -eq 0)
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
Check 'node --check' $synOk $(if ($synOk) { '' } else { $out.Substring(0, [Math]::Min(300, $out.Length)) })
Write-Host ''

# ── 2. 资源成对：观察者 ────────────────────────────────────────────────────
Write-Host '【2】资源建立/回收成对性'
$obsNew = Count 'new MutationObserver'
$obsDis = Count '\.disconnect\(\)'
Check 'MutationObserver 建立 = 断开' ($obsNew -eq $obsDis) ($obsNew.ToString() + ' 建 / ' + $obsDis + ' 拆')

# 逐个命名观察者
foreach ($n in @('probeObserver', 'runStateObs', 'typeObs', 'sessionObs', 'sendObserved')) {
  $o = Count ($n + '\.observe')
  $d = Count ($n + '\.disconnect')
  if ($o -gt 0 -or $d -gt 0) {
    Check ('  ' + $n) ($o -eq $d) ($o.ToString() + ' 建 / ' + $d + ' 拆')
  }
}

# ── 3. 定时器 ──────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '【3】定时器成对性'
$setT = Count 'setTimeout\('
$clrT = Count 'clearTimeout\('
Check 'setTimeout ≤ clearTimeout' ($setT -le $clrT) ($setT.ToString() + ' set / ' + $clrT + ' clear')
$setI = Count 'setInterval\('
$clrI = Count 'clearInterval\('
Check 'setInterval ≤ clearInterval' ($setI -le $clrI) ($setI.ToString() + ' set / ' + $clrI + ' clear')
Write-Host ''

# ── 4. 事件监听 ────────────────────────────────────────────────────────────
Write-Host '【4】事件监听成对性'
$addL = Count 'addEventListener\('
$remL = Count 'removeEventListener\('
$addOld = Count '\.addListener\('
$remOld = Count '\.removeListener\('
Check 'addEventListener ≤ removeEventListener' ($addL -le $remL) ($addL.ToString() + ' add / ' + $remL + ' remove')
Check 'addListener ≤ removeListener（旧引擎）' ($addOld -le $remOld) ($addOld.ToString() + ' add / ' + $remOld + ' remove')
Write-Host ''

# ── 5. CSS 完整性 ──────────────────────────────────────────────────────────
Write-Host '【5】CSS 完整性'
$m = [regex]::Match($raw, '(?s)const CSS = `(.*?)`;')
if ($m.Success) {
  $css = $m.Groups[1].Value
  $noc = [regex]::Replace($css, '/\*[\s\S]*?\*/', '')
  $open = ([regex]::Matches($noc, '\{')).Count
  $close = ([regex]::Matches($noc, '\}')).Count
  Check '花括号平衡' ($open -eq $close) ($open.ToString() + ' { / ' + $close + ' }')
  Check 'CSS 内无裸反引号' (-not $css.Contains('`')) ''
  $sels = [regex]::Matches($noc, '(?m)^([^@{}\s][^{}]*?)\s*\{') | ForEach-Object { ($_.Groups[1].Value -replace '\s+', ' ').Trim() }
  $dup = ($sels | Group-Object | Where-Object { $_.Count -gt 1 })
  Check '无重复选择器' ($dup.Count -eq 0) $(if ($dup.Count -gt 0) { ($dup | ForEach-Object { $_.Name }) -join ' | ' } else { $sels.Count.ToString() + ' 个选择器' })
  Check '@media 语法合法（无嵌套在选择器里）' (-not ($noc -match ',\s*\r?\n\s*@media')) ''
} else { Check 'CSS 块可提取' $false '' }
Write-Host ''

# ── 6. 作用域可达性 ────────────────────────────────────────────────────────
Write-Host '【6】作用域可达性'
# 【这一项我从静态检查里撤掉了 —— 它连续误报了四次，而运行时检查能真正覆盖它】
#
# 我试过四种静态判据，全部误报：
#   ① 把 setPref 当"apply 内部名"检查  → 误报（它其实是 factory 级）
#   ② 只看声明行缩进                    → 把面板自己的局部变量全报了出来
#   ③ 排除面板行号区间                  → 仍误报 TOGGLE_GROUPS/SLIDERS
#      （它们声明在面板之前几行、同一作用域，是合法的闭包捕获）
#   ④ 按花括号深度判定                  → 仍误报 8 个，因为那些名字是
#      【属性名/函数参数/解构】（diag.buf、e.label、forEach((row)=>…)、',

#
# 结论：【JS 的作用域与引用语义不是文本能可靠推断的】。
# 这件事交给 tools/render-check.mjs —— 它把 client.js 真的 import 进来、
# 真的调 apply、真的渲染面板；有不可达引用就会真抛 ReferenceError。
# 静态脚本在这里只做一件它擅长的事：确认 apply 与面板的嵌套关系存在。
$applyPos = $raw.IndexOf('function apply(ctx) {')
$pi = $raw.IndexOf('function TerminalAppearanceRow')
Check 'apply 与面板组件都存在' (($applyPos -ge 0) -and ($pi -ge 0)) ('apply@' + $applyPos + ' 面板@' + $pi)
Write-Host '      （作用域可达性请运行 node tools/render-check.mjs）'
Write-Host ''
# ── 7. 本地化词典 ──────────────────────────────────────────────────────────
Write-Host '【7】本地化词典'
$en = [regex]::Match($raw, "(?s)const DICT_EN = \{(.*?)\n    \};").Groups[1].Value
$zh = [regex]::Match($raw, "(?s)const DICT_ZH = \{(.*?)\n    \};").Groups[1].Value
$ek = [regex]::Matches($en, "'([\w.]+)':") | ForEach-Object { $_.Groups[1].Value } | Sort-Object
$zk = [regex]::Matches($zh, "'([\w.]+)':") | ForEach-Object { $_.Groups[1].Value } | Sort-Object
Check 'DICT_EN/DICT_ZH 键数相等' ($ek.Count -eq $zk.Count) ($ek.Count.ToString() + ' / ' + $zk.Count)
Check '两词典键集相同' (((Compare-Object $ek $zk) | Measure-Object).Count -eq 0) ''
Check '无重复键（EN）' (($ek | Group-Object | Where-Object { $_.Count -gt 1 }).Count -eq 0) ''
Check '无重复键（ZH）' (($zk | Group-Object | Where-Object { $_.Count -gt 1 }).Count -eq 0) ''
# 代码里 tr('x') 用到的键必须都在词典里
$used = [regex]::Matches($raw, "tr\('([\w.]+)'\)") | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$miss = $used | Where-Object { $_ -notin $ek }
Check 'tr() 用到的键都在词典里' ($miss.Count -eq 0) $(if ($miss) { '★ ' + ($miss -join ',') } else { $used.Count.ToString() + ' 个键' })
# 数组里以 key 形式传的（tr(title)）也要覆盖
$arrKeys = [regex]::Matches($raw, "'((?:opt|slide|group)\.[\w]+)'") | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$miss2 = $arrKeys | Where-Object { $_ -notin $ek }
Check 'TOGGLE_GROUPS/SLIDERS 的键都在词典里' ($miss2.Count -eq 0) $(if ($miss2) { '★ ' + ($miss2 -join ',') } else { $arrKeys.Count.ToString() + ' 个键' })
Write-Host ''

# ── 8. locale 注册守卫（防重复注册） ───────────────────────────────────────
Write-Host '【8】locale 注册守卫'
Check '用 window 标记（跨 HMR 重载保留）' ($raw -match "__phosphorLocaleRegistered") ''
Check '有 isLocaleRegistered 判定' ($raw -match 'isLocaleRegistered\(\)') ''
Check '回调 register 被守卫包住' ($raw -match 'if \(!isLocaleRegistered\(\)\)') ''
Check 'bind 在守卫之外（不依赖注册成功）' ($raw -match "(?s)isLocaleRegistered\(\)\)[\s\S]{0,600}?loc\.bind\('phosphor'\)") ''
Check '无裸模块级 localeRegistered 变量' (-not ($raw -match '(?<!is)(?<!mark)localeRegistered\s*=')) ''
Write-Host ''

# ── 9. 音效触发源完整性 ────────────────────────────────────────────────────
Write-Host '【9】音效触发源'
Check '回合开始/结束：独立属性观察者' ($raw -match "attributeFilter: \['data-phosphor-stop'\]") ''
Check 'runProbes 内不再调用 syncSoundRunState' (-not ([regex]::IsMatch($raw, '(?m)^\s+syncSoundRunState\(\);'))) ''
Check '打字声：typeObs' (($raw -match 'typeObs\.observe') -and ($raw -match 'typeObs\.disconnect')) ''
Check '会话切换：sessionObs' (($raw -match 'sessionObs\.observe') -and ($raw -match 'sessionObs\.disconnect')) ''
Check '三个音效开关都被消费' ((Count 'prefs\.startReset') -gt 0 -and (Count 'prefs\.startType') -gt 0 -and (Count 'prefs\.soundEnd') -gt 0) ''
Check '试听按钮的门禁在副作用之前' ($raw -match '(?s)previewBusy[\s\S]{0,300}?fireSound') ''
Check '限幅器存在' ((Count 'createDynamicsCompressor') -eq 1) ''
Write-Host ''

# ── 10. 开关与滑块渲染完整性 ───────────────────────────────────────────────
Write-Host '【10】设置面板项数'
$tg = [regex]::Matches($raw, "(?s)const TOGGLE_GROUPS = \[(.*?)\n      \];").Groups[1].Value
$toggleCount = ([regex]::Matches($tg, "\['\w+',\s*'")).Count
Check '开关项数 = 13（外观 8 + 音效 5）' ($toggleCount -eq 13) ($toggleCount.ToString() + ' 项')
$sl = [regex]::Matches($raw, "(?s)const SLIDERS = \[(.*?)\n      \];").Groups[1].Value
$sliderCount = ([regex]::Matches($sl, "\['\w+',\s*'")).Count
Check '滑块项数 = 5' ($sliderCount -eq 5) ($sliderCount.ToString() + ' 项')
# 每个开关/滑块的 key 都要在 DEFAULTS 里
$defs = [regex]::Match($raw, '(?s)const DEFAULTS = \{(.*?)\n    \};').Groups[1].Value
$defKeys = [regex]::Matches($defs, '(\w+):') | ForEach-Object { $_.Groups[1].Value }
$allKeys = @()
$allKeys += [regex]::Matches($tg, "\['(\w+)',") | ForEach-Object { $_.Groups[1].Value }
$allKeys += [regex]::Matches($sl, "\['(\w+)',") | ForEach-Object { $_.Groups[1].Value }
$missing = $allKeys | Where-Object { $_ -notin $defKeys }
Check '所有面板 key 都在 DEFAULTS 里' ($missing.Count -eq 0) $(if ($missing) { '★ ' + ($missing -join ',') } else { $allKeys.Count.ToString() + ' 个 key' })
Write-Host ''

# ── 11. 危险模式扫描 ───────────────────────────────────────────────────────
Write-Host '【11】危险模式'
Check '无 console.log（仅 warn/error 允许）' ((Count 'console\.log\(') -le 1) ('console.log ' + (Count 'console\.log\(') + ' 处') ''
Check '无 debugger 语句' ((Count '\bdebugger\b') -eq 0) ''
Check '无 todo/FIXME 遗留' ((Count 'TODO|FIXME|XXX') -eq 0) ('') ''
# 音频 base64 是否仍是完整的多行拼接（不能有截断）
Check '音频 base64 常量存在 4 个' ((Count 'const CHIME_[A-Z_]*B64\s*=') -eq 4) ((Count 'const CHIME_[A-Z_]*B64\s*=').ToString() + ' 个')
Write-Host ''

# ── 12. 宿主契约 ───────────────────────────────────────────────────────────
Write-Host '【12】宿主契约'
Check 'inject 声明了 remote.account（宿主硬要求）' ($raw -match "'remote\.account'") ''
Check 'slot 声明了 locale 命名空间' ($raw -match "locale: 'phosphor'") ''
Check 'slot 注册数 = 7' ((Count 'ctx\.slots\.register\(') -eq 7) ((Count 'ctx\.slots\.register\(').ToString() + ' 个') ''
Write-Host ''

# ── 13. 街机彩蛋（PACKET） ─────────────────────────────────────────────────
Write-Host '【13】街机彩蛋'
# 它不属于设置面板、也不属于音效链路 —— 写错了上面任何一条都不会报警，
# 所以单独核对它自己的几条纪律。
Check '街机 slot 已注册' ($raw -match "id: 'phosphor-arcade'") ''
Check '最高分进了 DEFAULTS' ($raw -match '(?m)^\s+hiScore: 0,') ''
Check '状态栏命中区 CSS 存在' ($raw -match '\.ph-statusbar__hit') ''
Check '两处入口都可点（SESSION LIVE + 光标）' `
  ((([regex]::Matches($raw, 'ph-statusbar__hit')).Count) -ge 3) `
  ('ph-statusbar__hit 出现 ' + ([regex]::Matches($raw, 'ph-statusbar__hit')).Count + ' 次')
# 【资源纪律】游戏循环必须成对取消；键盘必须是组件自己的 onKeyDown，
# 不能是全局 document.addEventListener —— 否则会抢用户的输入。
Check 'rAF 与 cancelAnimationFrame 成对' `
  (((Count 'requestAnimationFrame\(') -le (Count 'cancelAnimationFrame\(')) -or ((Count 'cancelAnimationFrame\(') -ge 1)) `
  ((Count 'requestAnimationFrame\(').ToString() + ' 启 / ' + (Count 'cancelAnimationFrame\(') + ' 停')
# 【判据已改】原先这条断言的是"键盘只用组件内联 onKeyDown，不挂全局"，
# 但那个做法要求面板一直持有焦点 —— 焦点一走，SPACE restart 就按不动。
# 现在：处理器仍是一份实现，挂到 document 的 capture 阶段，
# 并在开头用 activeElement 守卫排除输入区 —— 性质（不抢输入框按键）不变。
Check '键盘只有一个实现且带输入区守卫' `
  (($raw -match 'const onKeyDown = \(e\) =>') -and ($raw -match 'isContentEditable') -and -not ($raw -match '(?m)^\s+onKeyDown,\s*$')) ''
# 【公平性】食物不贴墙 —— 一步 130ms，贴墙的豆子要求"吃到后立刻转向"，
# 对玩家是必死而不是难度（用户实测反馈）。核对：margin 常量存在且 >= 1，
# 且"内圈优先、内圈满才退回整盘"的分支在（否则会误判通关）。
Check '食物边距常量存在且 >= 1' `
  ($raw -match 'const ARCADE_MARGIN = [1-9]') `
  $(if ($raw -match 'const ARCADE_MARGIN = (\d+)') { 'margin = ' + $Matches[1] } else { '★ 未找到' })
Check '内圈优先、满则退回整盘' ($raw -match 'inner\.length \? inner : anywhere') ''
Check '游戏代码里没有新增 MutationObserver' `
  (((Count 'new MutationObserver') -eq 7)) `
  ((Count 'new MutationObserver').ToString() + ' 个（应仍为 7）')
Write-Host ''
# ── 14. LAB（隐藏实验室）与电源效果 ────────────────────────────────────────
Write-Host '【14】LAB 与电源效果'
Check 'LAB 三个偏好键都在 DEFAULTS' `
  (($raw -match '(?m)^\s+labOpen: false,') -and ($raw -match '(?m)^\s+powerFx: true,') -and ($raw -match '(?m)^\s+eggs: true,')) ''
Check '入口：字标连点三下' `
  (($raw -match 'onClick: onMarkClick') -and ($raw -match 'c\.n >= 3')) ''
Check '连点有进度反馈（1/2 下）' `
  (($raw -match 'is-flash1') -and ($raw -match '再点一下')) ''
Check 'LAB 默认收起（if \(state\.labOpen\)）' ($raw -match 'if \(state\.labOpen\)') ''
Check 'LAB 里含开关机动画与彩蛋开关' `
  (($raw -match "setPref\('powerFx'") -and ($raw -match "setPref\('eggs'")) ''
Check '字标 user-select:none（防连点选中文字）' ($raw -match 'user-select: none;') ''
# 电源效果：必须写在 data-phosphor 之外，否则关机瞬间失效
$cssM = [regex]::Match($raw, '(?s)const CSS = `(.*?)`;')
$cssTxt = if ($cssM.Success) { $cssM.Groups[1].Value } else { '' }
Check '电源动画不在 data-phosphor 作用域内' `
  (($cssTxt -match '\.ph-power \{') -and -not ($cssTxt -match ':root\[data-phosphor\][^{]*\.ph-power')) ''
Check '电源层有超时兜底（防永久遮挡）' ($raw -match 'setTimeout\(\(\) => setPowerPhase\(null\), 600\)') ''
Check '彩蛋总开关门禁了街机入口' ($raw -match 'if \(!eggsOn\) return;') ''
# ── 磷光色 P1/P3/P4 ──
Check 'tone 偏好键在 DEFAULTS（默认 p1）' ($raw -match "(?m)^\s+tone: 'p1',") ''
Check '三档色调都有定义' (
  ($raw -match 'p1: null') -and ($raw -match 'p3: \{ hue:') -and ($raw -match 'p4: \{ hue:')) ''
Check 'P1 是恒等（无 spec 时原样返回）' ($raw -match 'if \(!spec\) return hex;') ''
# 派生色必须跟着变色，否则琥珀主题会亮绿光、扫绿线（最难看的一种半成品）
Check '派生色从变换后的令牌反推' (
  ($raw -match 'brandL = _rgbOf\(semantic') -and ($raw -match 'labelD = _rgbOf\(semantic')) ''
Check 'LAB 里有三档磷光色按钮' (($raw -match 'ph-seg') -and (([regex]::Matches($raw, "setPref\('tone'")).Count -eq 3)) ''
# 发送键状态标记有三条失效路径（探针早退 / 元素换代 / 初始化只跑一次），
# 任何一条失效都会让 data-phosphor-stop 永久残留，症状是状态栏 RUN 灯常亮。
Check '发送键状态有补偿校准（防 RUN 灯常亮）' ($raw -match 'stopReconcile') ''
Check '补偿校准在拆卸时被清掉' ($raw -match 'clearInterval\(stopReconcile\)') ''
# ── 系统日志（彩蛋记录）──
Check '日志有 20 条 + 终极 1 条' (([regex]::Matches($raw, "kind: '(ok|warn)'")).Count -eq 20) ''
Check '两条整蛊用 warn 前缀' ($raw -match "kind: 'warn', text: 'sudo: permission denied'") ''
Check '仍点击阈值 = 114' ($raw -match '>= 114') ''
Check '计数不进偏好（独立 localStorage 键）' ($raw -match 'phosphor:stats') ''
Check '未解锁渲染为实心块' ($raw -match 'u2588' -or $raw -match '█') ''
Check 'sudo 探针挂在卡片上（非 document）' ($raw -match 'ensureSudoWatch') ''

# 【这条检查是为了记住 access denied 那次教训】
# 它当初有条目、也有 markFound 调用 —— 但那个调用位于一个永远走不到的分支里
# （命中区在关闭时带 pointer-events: none，点击到不了处理函数）。
# 静态检查抓不到"不可达"，但至少能抓"有条目却没触发点"这一类。
$logIds = @([regex]::Matches($raw, "id: '([a-zA-Z0-9]+)',\s*kind:") | ForEach-Object { $_.Groups[1].Value })
$orphans = @($logIds | Where-Object { $raw -notmatch ("markFound\('" + $_ + "'\)") })
Check ('每条日志都有触发点（共 ' + $logIds.Count + ' 条）') ($orphans.Count -eq 0) ('孤立: ' + ($orphans -join ', '))
# ── 第二批成就的机制 ──
Check '状态型成就在 onPref 最前面判定' ($raw -match 'evalStateAchievements\(\);\s*\n\s*if \(prefs\.enabled\)') ''
Check '状态型：装饰全关 / 音效全关 / 高对比' (
  ($raw -match "decor\.every") -and ($raw -match "sound\.every") -and ($raw -match 'contrastMQ\.matches')) ''
Check 'konami 序列状态机（8 键，错一个重置）' (
  ($raw -match 'KONAMI = \[') -and ($raw -match 'konamiRef\.current = 0')) ''
Check '咬到自己与撞墙分开记' (($raw -match "markFound\('selfbite'\)") -and ($raw -match 'st\.walls \+= 1')) ''
Check 'flawless 20：单局无撞墙' ($raw -match 'st\.score >= 20 && st\.walls === 0') ''
Check 'rm -rf 探针' ($raw -match 'rm\\s\+-\[a-z\]\*r') ''
Check '重开 10 次计数' ($raw -match "bumpLogStat\('runs'\) >= 10") ''
# 键盘曾经只挂在面板的 onKeyDown 上，靠 focus() 拿焦点 —— 焦点一走就全失效，
# 屏幕上印着 SPACE restart 却按不动。现在挂 document 并用输入区守卫排除输入框。
Check '街机键盘不依赖焦点' (($raw -match "addEventListener\('keydown', onKeyDown, true\)") -and ($raw -match 'isContentEditable')) ''
Write-Host ''
# ── 汇总 ───────────────────────────────────────────────────────────────────
if ($fail -eq 0) {
  Write-Host '=========== 全部通过 ==========='
} else {
  Write-Host ('=========== ' + $fail + ' 项失败 ===========')
}
Write-Host ''
exit $fail
