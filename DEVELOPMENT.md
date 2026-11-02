# DSH // PHOSPHOR — 开发记录

> ## ⚠️ 改包名会弄炸 DSH —— 先读第 50 条
>
> 包名在**四处**被引用，**只改其中一部分会导致 DSH 打不开**。
> 而且插件的 patch 层若被写坏，宿主会**连带截断 profile 的 `cordis.patch.yml`**，
> 把 `locale` / `ui-theme` 等**与主题无关的条目一起丢掉** —— 那才是打不开的真正原因。
> **这不是夸张，是本项目真实发生过一次的事故。**

黑底磷光绿的黑客终端主题。本文件是开发过程中的技术记录 —— **48 条从实战里摔出来的教训**，以及它们背后的实测证据。

| 路径 | 状态 |
|---|---|
| `phosphor-bundle/` | ✅ **正式插件**，已通过 `plugin_manager install_bundle` 装入 `desktop` profile |
| `phosphor/index.html` | 📐 **设计基准参考**，保留。它是观感标准的来源，但**不是产物** |
| `phosphor/asar-read.ps1` | 🔧 **工具**，保留。能读 `app.asar` 内部文件（`read` 工具与 shell 都进不去） |
| `phosphor/phosphor.client.js` | ❌ 过时。最早的「动态插件版」写法，已被 bundle 取代 |
| `phosphor/README.md` | ❌ 过时。内容仍在讲动态插件装载 |

安装位置：`~/.dsh/profiles/desktop/node_modules/@local/dsh-phosphor`
（pnpm 建的 junction，指向本目录，**改这里即生效**，client 半边经 HMR 热重载）

---

## 一、平台构成

```
```
内联变量    6 条 = 6 圆角刻度（只有这一项必须内联）
动态令牌   79 条 = 17 语义 token + 56 静态色板 + 1 排版 delta + 5 装饰变量
slot 注册   4 处 = shell.overlay（状态栏 order 90 / 启动序列 order 95）
                  + settings.general.item（设置项 order 60）
                  + conversation.input.right（快速回复键 continue，order 0）
可调项     12  = 11 开关（含总闸 enabled）+ 3 强度滑块（0–200%）
持久化         localStorage['phosphor.prefs.v1']
```

### 快速回复键 [ continue ] 用到的官方接口（重要，别再摸索一遍）

座位 `conversation.input.left`（宿主说明：*Compact controls at the left of the composer tool row*），
其 `standardProps` 提供 **`inputActions`** —— 官方唯一程序化提交入口，与 Send 键同一条路径。

```js
// InputActions 共 7 个成员（运行时实测；asar 内无 .d.ts）
captureInsertion()            // → { start, end, draftRev }
insertText(text, span)        // → boolean（注意 text 在前）
setDraft(text)                // 整段替换（会 clear + 切断撤销历史）
addAttachments / removeAttachment / pruneAttachments
submit()                      // → void，内部即 submit("queue")，等价于点 Send

// 正确的"写入 + 提交"序列（同步、每步可校验）
const span = inputActions.captureInsertion();
if (inputActions.insertText('继续', span)) inputActions.submit();
```

**三条关键事实**（都由 asar 逆向确认）：

1. **`insertAsyncText` 名字带 Async，实为同步**（内部 `applyEdit(...)` 后 `return applied`），
   所以能同步拿到成功标志，不会出现"提交了空内容"。
2. **`InputState.phase` 不代表模型是否在输出** —— 它只表示提交面状态
   （`plain`/`claimed`/`adjudicating`/`submitting`）。乐观提交设计下模型跑着时它仍是 `plain`。
   判断运行态要用 **`useSession((s) => s.running)`**（InputBar 自己也这么写）。
3. **不要用 `setDraft` 做"插入"** —— 它会 `root.clear()` 抹掉用户已输入的内容。


> 早先这里写的是「内联 47 条 / 令牌 22 条」，**与实际完全不符**，是一次审计发现的。
> 那 47 条里的色板与排版 delta **在令牌层而不在内联层**，写在内联上是无效的
> （见下节「为什么必须内联的只有圆角」）。**核对这类数字时请以代码为准**，不要再照抄本文档。

### 为什么必须内联的只有圆角

最初把「圆角 + 静态色板 + 排版 delta」都写成 `root.style.setProperty`，理由是它们在
`base.css` 里有同名定义。但**内联写在 `<html>` 上时，只对写在 `:root` 的变量有效**：

| 变量 | 宿主声明位置 | 内联到 `<html>` 是否有效 |
|---|---|---|
| `--dsw-radius-*` | `:root` | ✅ 有效 |
| `--dsw-static-*` 色板 | **`body`** | ❌ **无效**（元素自身声明赢过继承值） |
| `--dsh-content-font-delta` | **`body`** | ❌ **无效** |

也就是说那 40 条色板与 1 条排版 delta **从来没有生效过**，只是没有可见症状
（因为色板本来就有默认值，排版 delta 算出来恰好是 0）。实测证据：内联后
`getComputedStyle(body).getPropertyValue('--dsw-static-neutral-bluish-900')` 仍是宿主的 `#2c2c2e`，
而 `html` 上是我写的值。

**修法**：把色板与排版改走 `ctx.theme.overrideTokens`（宿主会把结果写到 `body` 内联），
只有圆角留在内联。**判据是"宿主把它声明在 `:root` 还是 `body`"**，不是"它是否被同名定义"。

### 为什么分「内联变量」和「动态令牌」两套

| 机制 | 用途 | 为什么这么做 |
|---|---|---|
| `root.style.setProperty`（内联到 `<html>`） | 仅 6 条圆角刻度 | 宿主在 `:root` 声明，内联优先级最高，绕开整个级联问题。卸载时逐条 `removeProperty` |
| `ctx.theme.overrideTokens`（官方分层） | 其余 79 条 | 官方接口，宿主负责写到 `body`。同一 `source` 重入即整层替换，所以强度滑块能实时生效 |

**注意 `validateOverrides` 只校验形状**（`{light, dark}` 一对字符串），**不校验名字** ——
所以任意名字（含 `--dsw-static-*`）都能传，但传裸字符串会抛 `TypeError`。

### 服务声明是「可见性」声明

```js
return { inject: ['slots', 'theme'], apply };
```

**没在 `inject` 里声明的服务，在 `apply`/`effect` 执行时取不到。** 早先用 `ctx.get('theme')` 软取，`theme` 不在 `inject` 里 → 值恒为 `undefined` → 令牌层静默地从未注册（错误还被吞在 `else` 分支里）。现在改为 `ctx.theme` 直接取，且失败必显式报错。

---

## 二、踩过的坑（都值得记）

### 0. 【头号坑】手动 append 的覆盖层必须幂等清理，否则逐次叠加

**症状**：用户反馈"强度调到十几，屏幕就被盖满"。

**真相**：实测层数 ——

```
.ph-scan      89 层
.ph-vignette  89 层
.ph-boot       0 层
style[data-phosphor-style]  1 份   ← 样式表正常
.ph-statusbar               1 层   ← 走 slot 注册、由 React 管理，也正常
```

**有效强度可精确计算**：

| | 单层 | 89 层叠加 |
|---|---|---|
| 扫描线 alpha 0.004 | `0.004` | `1 - (1-0.004)^89 ≈ 0.30` |
| 暗角边缘 0.176 | `0.176` | `1 - (1-0.176)^89 ≈ 1.00` ← 全黑 |

**实际强度是设计值的 89 倍，而设计值本身完全正常。**

**成因**：`effect` 每次执行都 `createElement` + `appendChild` 新节点，只靠返回的
`cleanup` 里的 `remove()` 回收。而**热重载 / effect 重跑时，cleanup 并不保证先于
新一轮建立执行**，于是旧节点留在文档里、新节点又插一套，逐次累积。
开发期频繁改文件 → 累积到 89 层。

**为什么只有这两层受影响**：`<style>` 只被读取、不参与叠加；状态栏与设置项走
`slot` 注册、由 React 管理生命周期。**只有"手动 append 且无存在性检查"的节点会中招。**

**正解**：建立前先清场（见 `client.js` §6.2b 的幂等清理）。

```js
// ① 摘掉所有同名印记（防跨实例残留）
for (const sel of ['[data-phosphor-composer]', '[data-phosphor-toolbar]',
  '[data-phosphor-trailing]', '[data-phosphor-stop]', '[data-phosphor-boot-host]']) { … }
// ② 删掉所有 .ph-scan / .ph-vignette（防叠加）★ 关键
for (const node of document.querySelectorAll('.ph-scan, .ph-vignette')) node.remove();
```

**由此得到两条铁律**：

1. **往 `document` 里 append 的节点，建立前必须先清同类残留** —— 不要假设 cleanup 一定会跑。
2. **观感"偏强/偏弱"时，先定量测量（层数、有效不透明度），再决定调系数还是修结构。**
   这次在错误前提下**连续调了两轮数值**，把正确的设计基准改坏，
   而真正的问题是 89 倍放大 —— **等于在给一个乘法错误做除法**。

### 1. `align-self` 顶不住父级的 `align-items`

用户消息气泡定位在 `.userRow` / `.userStack` 上：

```css
.userRow  { flex-direction: column; align-items: flex-end }
.userStack{ max-width: min(calc(内容宽 * .702), 82%); align-items: flex-end }
```

想改成左对齐时，我先用子元素的 `align-self: stretch` + `width: 100%` 去顶 —— **无效**。在 flex 容器上，子元素的 `align-self` 覆盖不了父级在交叉轴上把整条 stack 压到一侧，也顶不住 `max-width` 上限。

**正解**：直接改容器的 `align-items`。安全性依据是 `cJsG2q_` 类名全表里**消息容器只有 `userRow`/`userStack`/`bubble`，没有 assistant 侧对等类**。

### 2. 不要用宿主没有的类名做定位

曾写下 `.ph-user-row [class~="_bubble"]` —— `.ph-user-row` 是我凭空造的自定义类，真实 DOM 里不存在，**规则完全空转**，而我会误以为改好了。

**正解**：只用核实过的真实钩子。用户气泡的真实结构是：

```jsx
<div class="{hash}_userRow" data-pending-steering data-submission-echo>
  <div class="{hash}_userStack">
    <div class="{hash}_bubble">
```

类名形如 `<hash>_<semantic>`，**哈希前缀每次构建都变，但语义后缀在源码里写死**，所以 `[class*="_bubble"]` 是稳定的。

### 2b. 取类名要查「正在运行的构建」，不是「打包产物」

> **本条与第 10 条是同一主题，第 10 条有更完整的失效清单与两个可用方法。**
> 保留本条是因为它记录了最初发现这个问题的过程。

`app.asar` 里存在的类名，在实时 DOM 里**未必存在**。已确认落空的例子：
`_ioCard`、`_badge`、`_runningDivider`、`_titleRule` —— 全是直接从 asar grep 出来的，
写成的 CSS 全是死代码。

**可靠的做法（两种，都实测有效）**：

```js
// ① 遍历已加载的样式表，搜"当前构建实际在用"的选择器
for (const ss of document.styleSheets) {
  let rules; try { rules = ss.cssRules; } catch { continue; }
  for (const r of rules) if (r.selectorText && /关键词/.test(r.selectorText)) console.log(r.selectorText);
}
```

**② 优先用宿主自有的语义属性**（最稳）：`data-tool` / `data-state` / `data-variant` /
`data-chat-node-key` / `data-chat-turn` / `aria-label`。

**方法 ① 一次命中了整个侧栏模块**（`hIlkoa_sessionRow` / `hIlkoa_selected` /
`_9lTDKa_sectionHeader`），而此前从 asar 直接抄的三批全部失效。

### 2c. 类名有两种格式，`$=` 后缀匹配只在部分模块成立

```
RlGAzG_primary / RlGAzG_add / dlU_AG_trigger   ← 语义名在末尾，$= 成立
_text_1rdzk_17 / _block_7gxqk_4                ← 末尾是【行号】，$= 不成立
```

**实测判据**：输入行按钮的 `28px` 定高、`72px` 定宽、`send` 文字全都生效了，
而它们依赖 `[class$="_trigger"]` / `[class$="_primary"]` —— 所以 composer 模块
**确实以语义名结尾**。

**所以不能一刀切改成 `*=`**：宿主有 `_triggerIcon` / `_triggerLabel` / `_triggerEffort`
这类子元素，`*="_trigger"` 会连它们一起命中。**按模块分别确认。**

另：**不要用行号当标识**（`_thumb_1ik0f_33` 的 `_33`、`_step_1i3xo_97` 的 `_97`
都是行号），增删一行就静默失效。稳定的部分只有哈希，写成 `[class*="_thumb_1ik0f_"]`。

### 3. 定位差异时不要只看"机制"，也要看"值"

圆角问题我绕了四轮：怀疑样式表没生效 → 换内联 → 排除 `corner-shape` → 全是白费。真相是**机制一直生效，只是值不对**：`20px`/`8px`/`2px` 都被判为圆，`0` 才对。而且基础主题的 `corner-shape: superellipse(1.5)` 会让 2px 都显得饱满。

**教训**：当"为什么没生效"成为唯一假设时，就再也不会去检查"值对不对"。

**附带**：全站有大量**硬编码圆角**（`border-radius:999px` 27 处、`50%` 36 处），
不经过 `--dsw-radius-*` 刻度。已逐类清理 41 个（保留 8 个语义圆：头像、状态点、旋转器）。
**清零时必须同时写 `corner-shape: round`**，否则 0 半径在 `superellipse` 下仍呈异形。

### 4. 模板字符串里不能出现反引号

在 CSS 注释里用了一对反引号，**提前结束了模板字符串**，整个文件语法失败、HMR 加载不了。现在注释里明确标注了这条禁忌。

**这个错误犯过两次**（第二次一次写了 14 处）。**改完 CSS 必跑 `node --check`** —— 它是唯一能立刻发现这个错误的检查。

### 5. `:is()` 里不能放伪元素

```css
/* ❌ 无效：:is() 的参数列表不允许伪元素，容错解析会忽略这些分量 */
:is([class^="ph-"], [class^="ph-"]::before) { … }

/* ✅ 拆成独立选择器 */
[class^="ph-"], [class*=" ph-"] { … }
[class^="ph-"]::before, [class*=" ph-"]::after { … }
```

依据：selectors-4 的 forgiving selector list。**这个错误也犯过一次**，
症状是"意图覆盖伪元素但其实一行都没生效"，而且**不报错、`node --check` 也发现不了**。

### 6. 静态色板是两层结构的根

DSH 调色板：`--dsw-static-*`（颜色源，带具体色值，**亮暗共用一套**）→ 上百个 `--dsw-alias-*` / `--dsw-specific-*`（全部派生）。

**只覆盖别名层时，界面其余上百个别名仍在用宿主中性冷灰** —— 这就是"气泡是灰的、浮层是灰的、分隔线是灰的"的根因。改静态色板，一处改动全部跟着变。

---

### 7. 测量前先确认参照系

排查覆盖层"尺寸不对"时，我把 **`screen.width`（物理屏幕 1707）当成了视口宽**，
得出"元素只有 1280 宽 → 存在偏移 → 祖先有 transform 改写了包含块"的结论，
还据此写了一整套解释。实际 `window.innerWidth` **就是 1280**，
覆盖层尺寸**完全正确**，整条推理建立在错误参照物上。

**教训**：报告尺寸问题前，**必须同时读出参照物**（`innerWidth` / `clientWidth` /
`getBoundingClientRect`），不要拿 `screen.*` 与元素尺寸直接比较
（`devicePixelRatio` 会让两者天然不等）。

### 8. slot 组件首次接入时，先验证"零 hook 能渲染"，再逐层加

把 `continue` 接进 `conversation.input.left` 时，我**一次写完了完整组件**
（`usePrefs` + `useState` + `MutationObserver` + 事件），结果座位一直报错：

```html
<div data-slot="conversation.input.left" style="display: contents;">
  <div data-slot-error="conversation.input.left"></div>   ← 注册/渲染失败
</div>
```

**难点在于：宿主留下了 `data-slot-error` 标记，但没有任何错误输出**
（挂钩 `console.error` / `console.warn` 后重渲染，捕获到的是空数组）。
所以"看日志"这条路当时是死的。

**有效的做法是二分**：

| 步骤 | 组件内容 | 观察 |
|---|---|---|
| 1 | `return React.createElement('span', {className:'ph-qc'}, '[ continue ]')`（**零 hook**） | 成功 → **注册通路没问题** |
| 2 | 加 `usePrefs()` | 成功 → 这一 hook 也没问题 |
| 3 | 加 `useState` + `MutationObserver` | 成功 |

**得到的教训（两条）**：

1. **一次写完再排查，会把"注册问题"和"组件问题"混在一起**，
   而这两者的修法完全不同（前者改注册参数/时机，后者改组件体）。
   先用一个零 hook 的纯元素验证通路，只要一分钟，却能砍掉一半可能性。
2. **判断"座位是否被渲染"，看 `[data-slot="<name>"]` 的 `子元素数` 与 `outerHTML`**，
   不要只看"界面上有没有出现"。这次正是 `子元素数 = 1` 但内容是个
   `data-slot-error` 空 div，才把方向从"注册失败"纠正到"组件失败"。

**排查时用到的两条命令**：

```js
// 座位是否存在、里面是什么
const el = document.querySelector('[data-slot="conversation.input.left"]');
console.log(el && el.outerHTML);
// 文档里所有被宿主渲染的座位（判断某个座位到底有没有被渲染出来）
[...document.querySelectorAll('[data-slot]')].forEach(e =>
  console.log(' ', e.getAttribute('data-slot'), '| 子元素数', e.children.length));
```
### 9. 说"没生效"之前，先量出那个属性的实际值

**这是本项目重复次数最多的错误（至少四次），每次都浪费了好几轮来回。**

| 场景 | 我的判断 | 实际原因 |
|---|---|---|
| 下拉菜单项没边框 | "选择器没命中" | 选择器**一直是对的**，只是 `border-l1` = `rgb(16,53,42)` 太暗，肉眼看不见 |
| 快速回复键不显示 | "注册被拒绝" | 座位里是 `data-slot-error`，**组件体**有问题（与注册无关） |
| 覆盖层"尺寸偏移" | "祖先 transform 改写了包含块" | 我**把 `screen.width` 当成了视口宽**，尺寸其实完全正确 |
| 强度"偏重 3 倍" | "设计基准太重" | 覆盖层**叠了 89 层**，我却在调系数 |

**共同模式**：先形成一个"机制失效"的假设，然后一路往下查机制，
**却始终没有去读那个属性的计算结果**。

**正确的第一步永远是读值**：

```js
const s = getComputedStyle(el);
console.log(s.borderTopWidth, s.borderTopColor);   // 宽度对不对？颜色是不是透明/太暗？
console.log(s.animationName, s.animationDelay);      // 动画有没有真的挂上？
console.log(el.getBoundingClientRect().width);       // 尺寸是多少（并同时读视口做参照）
```

**判据**：
- 宽度 > 0 但看不见 → **颜色问题**（太暗 / 透明），不是选择器问题
- 宽度 = 0 → 才是**没命中**
- 有值但视觉不对 → **值的问题**，不是机制的问题

**这条与第 3 条（"不要只看机制，也要看值"）是同一个教训**，
但因为反复重犯，单独列出来。

### 10. 类名：只用"实时 DOM / 实时样式表"确认过的名字

**已经确认失效的 asar 类名清单**（全部写成了死代码）：

```
_ioCard / _badge / _runningDivider / _titleRule        ← 直接从 asar grep 的
wq12jW_option / mAtvLq_option / wq12jW_menu            ← 又从 asar 抄了一次
```

**实测有效的方法（两个，都用过并成功）**：

```js
// ① 遍历实时样式表 —— 拿"此刻在用"的选择器（一次命中整个侧栏模块）
for (const ss of document.styleSheets) {
  let rules; try { rules = ss.cssRules; } catch { continue; }
  for (const r of rules) {
    if (r.selectorText && /关键词/.test(r.selectorText)) console.log(r.selectorText);
  }
}

// ② 让脚本自己打开交互、再测量（对付"只在展开时存在"的元素）
(async () => {
  document.querySelector('[class$="_trigger"]').click();
  await new Promise(r => setTimeout(r, 350));
  [...document.querySelectorAll('[class*="_item_"]')].forEach(e => {
    const s = getComputedStyle(e);
    console.log(e.className, s.borderTopWidth, s.borderTopColor, s.padding);
  });
  document.querySelector('[class$="_trigger"]').click();   // 复原
})();
```

方法 ① 命中过侧栏（`hIlkoa_sessionRow`）与下拉项（`_item_4ub78_`）；
方法 ② 给出了 `padding: 6px 8px` 这种"加边框不会位移"的关键依据。

**注意**：本构建的类名有**多种格式混用**：

```
_item_4ub78_90      语义_哈希_行号   → 必须用 [class*="_item_4ub78_"]
RlGAzG_primary      哈希_语义        → $= 后缀匹配成立
pFy1Ka_ioCard       哈希_语义
_text_1rdzk_17      语义_哈希_行号
```

**没有统一规律，必须逐个确认。** 也不要写死尾部行号（`_90`）—— 宿主增删一行就失效。
### 11. slot 落脚在 flex 布局里的位置：`display: contents` + `order`

**问题**：把 `continue` 键放进 `conversation.input.right` 后，它出现在**模型触发器的左边**，
而用户要它在**右边、紧邻 send**。

**成因**：宿主的渲染顺序是「右区座位 → 模型触发器 → send」，
所以我的按钮在 DOM 上**永远排在最前**。这是宿主的固定结构，改不了。

**解法（纯 CSS，不动 DOM）**：

```css
.ph-qc { order: 100; }
```

**为什么 `order` 有效** —— 实测结构：

```
<div class="RlGAzG_standardControls">          ← flex 容器
  <div data-slot="conversation.input.right"    ← 座位容器
       style="display: contents">              ← 【不生成盒子】
    <button class="ph-qc">continue</button>    ← 于是它是 flex 容器的【直接 flex 项】
  </div>
  …
</div>
```

`display: contents` 让座位容器**不产生盒子**，所以插进去的元素直接成为外层 flex 容器的
flex 项 —— **`order` 对它有效，也不会被 `display:contents` 的祖先挡住**。
（若座位容器是普通 `display:block`，`order` 就会失效，必须改用别的手段。）

**排查时用的命令**（判断能否用 `order`）：

```js
const qc = document.querySelector('.ph-qc');
console.log('自身父级 =', qc.parentElement.className, getComputedStyle(qc.parentElement).display);
console.log('真正的 flex 容器 =', qc.parentElement.parentElement.className,
            getComputedStyle(qc.parentElement.parentElement).display);
```

**顺带一个特异性陷阱**（`continue` 键上踩过）：

`:disabled` 与 `:hover` 的特异性**相同**（都是 `0,2,0`），**谁写在后面谁赢**。
所以带 `:disabled` 的规则**必须放在 `:hover` / `:active` 之后**，
否则禁用的按钮在鼠标悬停时仍会亮起来。当前顺序：

```
:active(22% 底)  →  :focus-visible  →  :disabled(压过一切)
:hover(12% 底) 在 :active 之前
```
### 12. 排查前先冷启动一次 —— HMR 会留下无法用 CSS 解释的状态

**症状**：某个元素的 `border-color` 咬定 `rgba(0,0,0,0)`，而

* 规则存在（`引擎解析出的 border = "1px solid var(--dsw-alias-border-l2)"`）
* 选择器确实匹配（`el.matches(sel) === true`）
* 变量有值（`getPropertyValue('--dsw-alias-border-l2') === "#1d6b4a"`）
* **内联 `border-color: red !important` 也改不动它**
* **同一脚本能正确读出相邻元素的正确颜色**（对照正常）
* 无 `border-image`、无 `!important` 竞争、无伪元素遮挡

**这些事实在 CSS 层叠下不可能同时成立** —— 我为此远程排查了 8 轮，
每轮都出现新的矛盾值，最后**没有查明原因**。

**根因（推测但证据充分）**：本项目的 HMR **不保证清理上一轮**。
铁证是覆盖层曾经**叠了 89 层**（见第 0 条）—— 那是同一个根因的另一个表现。
在这样被污染的环境里，**元素可能处于引擎内部不一致的状态**，
表现为"声明正常但计算值不动"。

**冷启动验证（事后做，结果是干净的）**：完全重启应用后

```js
console.log('.ph-scan =', document.querySelectorAll('.ph-scan').length,
            '| .ph-vignette =', document.querySelectorAll('.ph-vignette').length,
            '| .ph-qc =', document.querySelectorAll('.ph-qc').length,
            '| composer 标记 =', document.querySelectorAll('[data-phosphor-composer]').length,
            '| 状态栏 =', document.querySelectorAll('.ph-statusbar').length,
            '| style 数 =', document.querySelectorAll('style[data-phosphor-style]').length);
// 全部为 1 —— 说明插件从零启动是幂等、无残留的
```

**所以规矩是**：

> **频繁改文件后，遇到"说不通"的渲染现象，先完全重启再复现一次。**
> 如果重启后现象消失，那就是 HMR 残留，**不要去改 CSS**。

**代价对比**：冷启动一次约 30 秒；而我在污染环境里排查了 8 轮、每轮都让你贴诊断输出，
**成本高得多，且最终没得到结论**。
### 13. 覆盖 token 时，别忘了同一族的其它档位

状态栏活动指示灯（RUN/IDLE）需要琥珀色，我写了：

```css
color: var(--dsw-alias-state-warn-label, var(--dsw-alias-brand-primary));
```

**体检时发现 `--dsw-alias-state-warn-label` 不在我覆盖的 token 里** —— 我只覆盖了
`state-warn-primary`，于是灯用的是宿主原色（**等于不受主题控制**）。

**注意这不是"名字写错"**：宿主确实有这个名字（asar 里 warn 系列共 4 个：
`primary` / `secondary` / `tertiary` / `label`）。**是我漏覆盖了**。

**教训**：宿主的状态色是**分档的**（`primary`/`secondary`/`tertiary`/`label`），
覆盖时要么整族覆盖，要么明确知道自己在用哪一档。**只覆盖 primary 就用 label 是常见疏漏。**

**顺带**：CSS 里给 `var()` 写兜底值（`var(--x, var(--y))`）**会把这类疏漏掩盖掉** ——
它让"变量不存在"表现得像"设计就这样"。**兜底值应该写在"确实允许缺失"的地方**，
而不是用来防自己的遗漏。

**同类检查手段**（找出"用了但没覆盖"的变量）：

```js
// 对比 CSS 里 var() 用到的名字 与 buildTokens 实际注册的名字
// 见第 9 条的输出格式；我在体检脚本里就是靠它发现的
```
### 14. 【关键】改动要【重启应用】才生效 —— 刷新页面不算

**这是本段耗时最多的坑，且不是代码问题。**

宿主把客户端插件打成一个 bundle，浏览器按修订号加载：

```
plugins/??@local/dsh-phosphor/client.js,…,<其它插件>&rev=54707a9dcdbd
```

宿主源码里的机制（逐字）：

```js
// Publish one completed bundle generation (the HMR watch's registration
// hook — the only entry point through which build changes reach the graph).
// Unchanged mtime, ctime and size preserve the graph without reading the bundle.
rebuilt(id) {
  const baseline = this.captureArtifactBaseline(record.meta.clientPath);
  const rev = artifactRevision(baseline);
  if (rev === record.entry.rev) return rev;     // 没变就跳过
  …
  this.bundle = readFileSync(record.meta.clientPath);
  …
}
```

**结论**：

* 制品的失效判据是 **`mtime` / `ctime` / `size`** —— 改文件确实会让它们变
* **但必须有人调用 `rebuilt()` 才会重建**，而调用者本该是开发态的 watcher
  （`pnpm run dev:web` 之类）
* **本机工作区里只有 `default-workspace`，没有 DSH 源码，跑不了 watcher**
* 于是：**只有应用启动时的那次扫描会重建 bundle**

**所以工作流是**：

```
改 client.js  →  完全退出 DSH  →  重新打开  →  新版本才生效
```

**刷新页面（F5 / Ctrl+R）不会重新打包。**

**这次排查里我连续多轮以为"改完约 6 秒 HMR 生效"** —— 那可能是插件开发早期的行为（当时 watcher 在跑），后来就不成立了。
**代价是让用户反复重启应用帮我验证，而我一直以为只是"刷新一下"。**

### 15. `ctx.get('x')` 能返回东西 ≠ `'x'` 能进 `inject`；命名空间要单独声明

**症状**：加余额栏时，`inject` 里写了 `'remote'`，访问 `ctx.remote.account` 抛：

```
cannot get property "remote.account" without inject
```

**我把它读成"需要声明 remote"，于是加了 `'remote'` —— 仍然抛同样的错。**

**实际答案写在宿主自己的声明里**（从 asar 逐字取出）：

```js
inject = [ "slots", "locale", "remote", "remote.account", "remote.session", "theme", "configForms" ]
```

**命名空间必须【单独列出】`'remote.account'`。** 一句报错里的名字就是该声明的名字。

**两条衍生教训**：

1. **`inject` 是硬依赖**：声明的服务不存在 → 插件整体加载失败（不是"该功能不可用"）。
   所以加之前先确认它在，且**一次只改这一项**，否则崩溃时无法归因。
2. **`ctx.get('remote.account')` 返回 Proxy 只说明"容器里注册过"**，
   **不说明"声明进 inject 后插件能正常加载"** —— 这两件事我混为一谈，白绕了好几轮。

**探查手段**（区分层级）：

```js
console.log(ctx.get('remote'));                 // 能不能拿到对象
console.log(Object.keys(ctx.remote.account));   // 命名空间是否可访问（被 inject 门控）
```

### 16. 余额接口的正确调用方式（已跑通，别再摸一遍）

```js
// inject 必须含 'remote.account'
const res = await ctx.remote.account.getBalance({
  version: '1.0.0',                              // AccountClientMetadata 三字段，
  locale: navigator.language || 'zh-CN',         // 缺一个就报
  timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
});                                              // gateway/input-invalid, field:"client"
// 真实返回（探针实测）：
// { ok: true,
//   value: { status: 'ready',
//            value:        [ { currency: 'CNY', balance: '43.8214700200000000' } ],
//            bonusWallets: [ { currency: 'CNY', balance: '0' } ] } }
```

**字段路径务必以实测为准。我按类型定义猜的三处全错**：

| 我猜的 | 实际 |
|---|---|
| `getBalance({})` 可调用 | **必须传三字段 metadata** |
| `details.balance.value` | **`details.value.value`** |
| `wallet.amount` | **`wallet.balance`** |

**格式化成 `CNY 43.82`**（币种代码 + 空格 + 金额，用户指定）：
数值规则复刻宿主的 `formatBalance` —— **两小数、向下取整（`Math.floor`，不是四舍五入）、千分位**；
`0 → CNY 0.00`、`<0.01 → <CNY 0.01`、负数 → `-CNY 0.01`。
### 17. 两个元素"观感不一致"时，先跑一张逐属性对照表

**症状**：`continue` 与 `send` 两个按钮并排，看起来亮度不一致。

**我的做法（错的）**：看着截图挑一个属性去改 ——
① 以为字号不同 → 改了字号（**这次恰好对**）
② "看着 send 更亮" → 给 `continue` 补 `text-shadow`
③ 以为 `border-l2` 比原色亮 → 把文字色改成 `border-l2`

**实际**：②③ 全错。

* ② 两者**本来就有完全相同的** `textShadow: rgba(0,255,156,.65) 0 0 8.7px`
* ③ `border-l2` = `#1d6b4a`（亮度 ≈0.113）**比原色** `label-secondary` = `#12a35f`（≈0.256）**更暗** —— 方向反了

**真正的原因只有一个**：`color` —— `continue` 是 `rgb(18,163,95)`，`send` 是 `rgb(0,255,156)`。

**一行命令就能定案**：

```js
const row = (name, el, pseudo) => {
  const s = getComputedStyle(el, pseudo);
  return { name, color: s.color, fontSize: s.fontSize,
           fontWeight: s.fontWeight, letterSpacing: s.letterSpacing,
           textShadow: s.textShadow, opacity: s.opacity,
           fontFamily: s.fontFamily.split(',')[0] };
};
console.table([
  row('continue', document.querySelector('.ph-qc')),
  row('send', document.querySelector('[class$="_primary"]'), '::after'),
]);
```

**把它做成习惯**：任何"这两个看起来不一样"的问题，**第一步就是这张表**，
而不是凭观感挑属性去改。**凭观感改，有一半概率改错方向**（本例 3 改错 2）。

**同类教训**：第 9 条（说"没生效"之前先量值）、第 7 条（测量前先确认参照系）。
它们的共同点是 —— **先取数，再判断**。
### 18. 音频素材：内嵌是唯一通路，且必须先瘦身

**插件没有静态资源出口**。`package.json` 的 `exports` 白名单只列了 js / json / svg；
客户端 bundle 路由只打包 JS；`dsh-app://app/api/...` 是宿主自己的 API。
**所以音频只能内嵌进 `client.js`。**

**内嵌前必须瘦身**，否则体积失控。这次的实际数据：

```
原始  559,356 字节 / 1.585s / 立体声 44.1kHz / 32bit 浮点
输出   24,298 字节 / 0.550s / 单声道 22.05kHz / 16bit PCM    缩减 95.7%
base64 32,400 字符
```

**步骤**（不需要 ffmpeg，用 PowerShell 读 WAV 头 + 处理 float 样本）：

1. **先解析包络**，找真正的有效段 —— 这次发现 **0.8s 之后已衰减到 0.004（死区）**，
   1.59s 里一半是听不见的尾巴
2. **但别裁到"刚好"**：0.4~0.55s 还有 0.06 的余韵，**再短会让铃声像被掐掉**
3. **立体声 → 单声道**（提示音不需要立体声）
4. **重采样用 2:1 盒式平均**（`(a[2i]+a[2i+1])/2`）—— **兼作抗锯齿低通**，
   直接抽样会产生混叠
5. **32bit 浮点 → 16bit PCM**
6. **末尾 60ms 淡出**（避免截断爆音）+ **按峰值归一化**（留 -1.5dB 余量）

**WAV 解析的坑**：`data` chunk 的**内容**在 `chunkStart + 8`（头是 8 字节：4 字节 ID + 4 字节 size）。
我第一次直接用 chunk 起点偏移读，**读到了 chunk 头**，于是"全局峰值 = 2.8e20" ——
这个荒谬数字就是偏移错了的信号。

**工具**：以上步骤已固化为 `tools/embed-sound.ps1`，换素材不必重跑手工流程。

```powershell
# 先干跑：看包络、看裁剪点是否合适、看预期体积
pwsh tools/embed-sound.ps1 -Src "C:\path\to\素材.wav" -WhatIf

# 确认后写入 client.js
pwsh tools/embed-sound.ps1 -Src "C:\path\to\素材.wav"
```

可用参数：`-Seconds`（裁剪时长）、`-OutRate`、`-FadeMs`、`-Peak`、`-Target`（变量名）、`-Client`。
脚本用 `-WhatIf` 复现过「叮~~~~」的处理结果（24298 字节 / 32400 字符 / 缩减 95.7%），与手工一致。

**验证方式**：从 `client.js` 里把 base64 **再取出来解码一遍**，确认
`RIFF/WAVE`、`fmt=1`、声道、采样率、时长、尾样本已淡出。**不要只信写入时的结果。**

### 19. 【重要】"记一个解锁标志"是错的 —— 要读 AudioContext 的实际状态

**症状**：`data-phosphor-stop` 的触发器写对了，但**第一轮结束不响**，从第二轮才有声音。

**原因**：

```js
let chimeUnlocked = false;
const play = () => {
  if (window.__phChimePending) { chimeUnlocked = true; return; }   // 消费标记
  if (!chimeUnlocked) { window.__phChimePending = true; return; }  // 首次必然走这里 → 不响
  …
};
```

`chimeUnlocked` 只在"解锁那次恰好有待播"时才置真。**首轮结束时它是 `false`，第一声被丢掉。**

**改法 —— 判断真实状态，而不是记一个标志位**：

```js
const chimeReady = () => !!(chimeCtx && chimeCtx.state === 'running' && chimeBuf);
const play = () => { chimeReady() ? chimeFire() : (chimePending = true); };
const unlock = () => {
  if (chimeCtx.state === 'suspended')
    chimeCtx.resume().then(() => { if (chimePending) { chimePending = false; chimeFire(); } });
};
```

**教训**：**浏览器对"能不能播"的权威是 `AudioContext.state`，不是你的变量。**
凡是"环境有权威状态、我又维护了一份本地副本"的地方，都有这个风险 ——
**能读就读，别缓存。**

**配套两条**：

* **预解码**：在 setup 时就 `decodeAudioData`，不要等首次播放 ——
  提示音**晚半拍就不像提示了**
* **复用 AudioContext**：`if (!chimeCtx || chimeCtx.state === 'closed')` ——
  开关反复切换会累积上下文（**浏览器上限约 6 个，超了之后创建失败并静默不响**）
### 20. 音频"处理"的坑：别用峰值判断响度，先算 crest factor

**症状**（用户原话）：复位音「完全失真了」→ 改完之后仍然「炸了」。

**我第一次的判断**：把失真归因于"重采样到 22.05kHz + 峰值归一化 ×2.905"。
**这个判断只对了一半** —— 归一化确实该去掉，但**去掉之后反而更炸**。

**为什么**：去掉归一化后，动态范围从 17:1 涨到 32:1：

```
旧（归一化 ×2.905）  RMS 0.0497  峰值 0.84    crest 17:1
新（保真，增益 1.0） RMS 0.0171  峰值 0.544   crest 32:1
```

**而我随后按"峰值 0.544"把播放增益补到 0.45** ——
**对高 crest 的声音，按峰值补增益是错的：响度感由 RMS 决定，不是峰值。**

**正确做法 —— 先量 crest factor**：

```powershell
# crest = 峰值 / RMS。持续音（铃声/人声）约 3~8；瞬态/噪声类可达 20+
$crest = $peak / $rms
```

这次四个素材的实测值，一眼就能分类：

```
复位      峰值 0.380  RMS 0.0171  crest 22.28   ← 瞬态型
打字      峰值 0.552  RMS 0.0259  crest 21.28   ← 瞬态型
单次切换  峰值 0.626  RMS 0.0276  crest 22.72   ← 瞬态型
叮        峰值 0.618  RMS 0.0719  crest  8.59   ← 持续型
```

**规则**：
* **crest < 10（持续型）**：按峰值归一化是可以的，响度随峰值走
* **crest > 20（瞬态型）**：**按 RMS 定增益**；按峰值补会让尖峰刺耳

### 21. 音量叠加要算总额，别用"感觉"判断削波

我一度怀疑"炸"是削波。算一下就知道不是：

```
复位 gain 0.16 × 峰值 0.544            = 0.087
打字 gain 0.085 × 峰值 0.552 × 3 个     = 0.141
最坏情况总和                            ≈ 0.23   ← 远低于 1.0
```

**所以"炸"是密度 / 音色问题，不是电平超标。** 这解释了为什么降增益只能缓解、不能根治 ——
也说明**先算总额能避免在错误的方向上来回调参数**。

### 22. 长尾音要用【增益包络】收，不要硬裁素材

**症状**（用户原话）：打字声跟到结束的复位声音后面了。

**原因**：结束序列的复位尾音长 1.455s，排在 0.52s → 一直到 1.92s 才结束。
用户发下一条消息时，开始序列的复位+打字正好撞进来。

**我先想的是硬裁素材**，但量了能量分布才发现不行：

```
复位  t=0.15~0.30s 一阵起手（rms 0.008~0.028）
      t=0.75s      主尖峰（pk 0.380）      ← 在 0.55s 之后！
```

**裁到 0.55s 会把主尖峰切掉** —— 尾音会变成"半截起手"。

**改用播放层的增益包络**（不动素材）：

```js
gain.gain.setValueAtTime(vol, at);
gain.gain.linearRampToValueAtTime(0, at + fadeOut);   // 0.45s 内淡到 0
```

于是尾音从 1.92s 收到 0.97s，既保留音色又不撞下一轮。
**素材是素材，编排是编排 —— 改编排参数比改素材更安全，也不会增加内嵌体积。**

### 23. "内容出现时的声音"要节流，且节流值由【声音本身长度】决定

用户建议：打字声应该跟着「内容真正出现」响，而不是固定时间点排三声。

**改法**：`MutationObserver` 监听 `characterData` + `childList`（流式追加会改写已有文本节点）。

**但必须节流**：打字音本身长 0.64s，而流式输出每秒可能追加几十个字符；
不节流的话几十个源同时发声 = 一片噪音。

```
节流 110ms ≈ 每秒最多 9 声
```

**节流值的推导**：它不是一个随手填的数 ——
**"每秒最大声数"应该接近"声音长度决定的可用密度"**。
0.64s 的样本按 110ms 间隔播放，同时约有 6 个实例在响 ——
再密就会糊成连续噪音，再疏就不像打字。

### 24. 音频素材必须内嵌，所以"改素材"的成本很高 —— 尽量改参数

插件没有静态资源出口（见第 18 条），所以每个音都要 base64 进 `client.js`。
这次四个音的最终体积：

```
复位（全保真：44.1k 立体声 16bit）  256,756 字节 / base64 342,344 字符
叮   （22.05k 单声道 16bit）         24,298 字节 / base64  32,400 字符
打字 （22.05k 单声道 16bit）         28,268 字节 / base64  37,692 字符
切换 （22.05k 单声道 16bit）         12,662 字节 / base64  16,884 字符
```

**`client.js` 因此涨到约 670KB**（其中 430KB 是音频）。

**教训**：**调音量、调时机、调淡出、调节流 —— 这些都是"参数"，改起来零成本**；
**只有非改素材不可时才重新内嵌**（那要重跑 `tools/embed-sound.ps1` 并重启应用）。
这轮我在素材与参数之间来回改了几次，其中大部分其实只需要调参数。
### 25. 多约束系统里，先列约束、再算各自的上下限 —— 别反复调同一个旋钮

**症状**：打字声节奏，用户先说「像机关枪」，改完又说「又有点慢了」，来回三次。

**代码里其实有两个约束**：

```
① 最小间隔 TYPE_MIN_GAP_MS        → 理论上限 = 1000 / gap
② "不重叠"闸的忙碌时长             → 理论上限 = 1000 / busy
```

**我前两次调的都是 ①**，而**两次的瓶颈都是 ②**：

```
第一次  ① 110ms  →  上限 9.0 声/秒
        ② 允许重叠（未设闸）→ 约 6 个实例同时响
        结果：机关枪

第二次  ① 260ms  →  上限 3.8 声/秒
        ② 忙碌 = 素材全长 0.64s  →  上限 1.6 声/秒   ← ② 才是瓶颈
        结果：偏慢（① 那个 260ms 根本没起作用）

第三次  ① 150ms  →  上限 6.7 声/秒
        ② 忙碌 = 素材时长 × 0.45 ≈ 0.29s  →  上限 3.5 声/秒   ← 现在是 ① 略紧
        结果：3.5 声/秒
```

**如果第一次就把两个约束列出来、各自算出上限，一眼就能看出瓶颈在 ②** ——
也就不会让用户陪着我调两轮无用的参数。

**推广的检查动作**：
当"调了参数但感觉没变化"时，**先怀疑"我调的不是瓶颈"**，
把所有约束列出来、算出各自的上限，**取最严的那个**。

**第三次的关键洞察（也是把它做对的那一步）**：
**"不重叠"该按【有效段】算，不是按【素材全长】算。**
实测打字音的能量分布：主瞬态在 0.27s，0.45s 之后衰减到 0.05 以下。
所以"听得出是一击"只需要覆盖前 ~0.3s，尾巴叠上去不会糊。
**"素材多长"和"需要隔多久"是两件事** —— 把它们混为一谈是我第一版的错误。

**参数化**：现在两个值都是命名常量（`TYPE_MIN_GAP_MS` / `TYPE_BUSY_RATIO`），
忙碌时长还从解码后的 `buffer.duration` 推导 —— **换素材自动跟上，不用改逻辑**。

### 26. 反复调整本身是个信号：说明我没建立"可预测的模型"

这一段的音频部分，用户和我之间有很多轮"太快/太慢/太响/炸了"。事后看，
**每一轮都对应一个我本来可以先行测出的量**：

| 用户反馈 | 我本该先测的 |
|---|---|
| 「完全失真了」 | 素材的 crest factor（第 20 条） |
| 「炸了」 | 播放增益 vs RMS，以及各音叠加总额（第 21 条） |
| 「打字声跟到结束的复位后面」 | 各音的**实测时长**与编排时间轴的叠加（第 22 条） |
| 「像机关枪」/「又有点慢了」 | 有两个约束、各自的上下限（第 25 条） |

**共同点**：这些都是**几行 PowerShell / JS 就能量出来的数**，
而我每次都先凭感觉改、改完等反馈。

**所以"继续调"之前，先问自己：这个感觉对应的物理量是什么？我能不能直接量出来？**
能被量出来的，就不要靠迭代逼近。
### 27. dB 与线性幅度的换算要算对 —— 否则会"治好一个不存在的问题"

**经过**：加「音效强度」滑块（0~200%）后，我给音频总线加了限幅压缩器，
阈值设 `-3dB`，并宣称"正常情况完全透明"。

**随后我自己复核时算错了**：

```
我把 -3dB 当成了约 0.4 线性  ← 错
于是认为"开始序列 0.228 已经超过阈值，压缩器在默认音量下就介入"
```

**实际换算**：

```
线性 = 10^(dB/20)
-3 dB → 10^(-3/20) = 0.708      ← 比我以为的 0.4 高得多
-1 dB → 0.891
```

**于是**：默认音量下所有组合的峰值（开始 0.228 / 结束 0.171）**都远低于 0.708**，
压缩器**确实完全透明**；要触发它得把音量拉到约 **310%**，而滑块上限是 200%。

**结论：设计是对的，我的"复核"错了。** 如果我按错误的换算去"修"，
就会把阈值调到毫无意义的低位，**反而让压缩器在正常音量下开始工作** ——
即"治好一个不存在的问题，同时制造一个真问题"。

**教训**：
* dB → 线性用 `10^(dB/20)`（幅度比），**不是** `dB/100` 之类的直觉近似；
* **复核也要复核**：一次"我发现了个问题"的冲动，同样需要先算清楚再动手；
* 这类换算**几行脚本就能验证**，不要靠心算。
### 28. 生命周期宿主被重建时，所有派生物都要作废或校验归属

**自检发现的两个 BUG，同一根因**（都是"`AudioContext` 重建后没管派生物"）：

```js
// BUG ①：总线缓存没校验归属
const ensureBus = () => {
  if (audioBus) return audioBus;          // ← 只判存在
  …
};
// AudioContext 一旦重建，audioBus 指向的是【旧上下文】的节点。
// 把新音源接到一个已废弃的音频图上 → 无声或错乱。

// BUG ②：解码缓存没清空
soundBuf[name] = decoded;                 // AudioBuffer 与创建它的上下文绑定
// 上下文重建后，soundBuf 里全是旧上下文的 buffer，跨上下文使用不受保证。
```

**修法**：

1. **缓存要连"归属"一起校验**（不只是判存在）：
   ```js
   if (audioBus && audioBus.context === audioCtx) return audioBus;
   ```
2. **重建时统一作废派生物**，并且**把"重建"这件事收进唯一入口**：
   ```js
   const ensureCtx = () => {
     if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
     audioCtx = new AudioContext();
     audioBus = null;                        // 旧节点失效
     for (const k of Object.keys(soundBuf)) delete soundBuf[k];
     pendingPlay = null;
     return audioCtx;
   };
   ```
3. **异步回调里也要判**（解码是异步的，回来时上下文可能已经换了）：
   ```js
   .then((decoded) => { if (audioCtx === c) soundBuf[name] = decoded; })
   ```

**为什么"收进唯一入口"是关键**：我原先在**两处**各写了一遍创建上下文的代码
（初始化一处、resume 重试一处）。**自检时正是"两处各写一遍"导致清理逻辑只补了一边**。
把它们合并成一个 `ensureCtx()` 之后，"重建时该清什么"就只有一处需要维护。

**推广的检查动作**（适用于任何"宿主对象 + 派生缓存"的结构，例如 DOM 元素缓存、
连接池、解码器实例）：
* 缓存键里带上"宿主的身份"，或访问时校验 `derived.owner === current`；
* 宿主的创建/销毁**只留一个入口**，派生物的作废写在那里；
* **异步**写回缓存前再校验一次归属。

### 29. 自检要做"交叉一致性"检查，不要只读代码

这次自检写的是**可执行的核对脚本**，而不是"通读一遍觉得没问题"。
它检查的是**同一件事在多个地方的说法是否一致**，例如：

```
音源常量名  ↔  SOUND_SRC 的键  ↔  fireSound('…') 的调用名    三者必须互相覆盖
base64 常量定义  ↔  SOUND_SRC 的引用                          一一对应
new MutationObserver 数量  ↔  .disconnect() 数量              成对
setTimeout/setInterval 设置  ↔  clearTimeout/clearInterval    成对
prefs 里用到的键  ↔  DEFAULTS 里的键                           无遗漏
"只在某处出现一次"的期望（new AudioContext / decodeAudioData） 实际出现次数
```

**这一类检查几乎不可能靠"读"发现** —— 尤其是"本该唯一却出现了两次"这种，
人眼读代码时会把它当成正常。**脚本数一遍就出来了。**

**而且它抓到的两个 BUG 都不是"写错了"，而是"漏了"** ——
漏了校验、漏了清理。**这类缺陷的通读盲区最大**：代码本身每一行都对。
### 30. 面板组件 ↔ apply 闭包：必须走模块级通道

**症状**：点「试听」按钮报 `Uncaught ReferenceError: audioDiag is not defined`。

**原因**：设置面板组件 `TerminalAppearanceRow` 定义在 `apply()` **之外**，
看不到 `apply` 里的任何局部变量。

```js
// apply 内部
const audioDiag = () => ({ ... });          // ← 面板读不到
// apply 外部
function TerminalAppearanceRow() {
  onClick: () => { audioDiag(); }           // ReferenceError
}
```

**而 `previewFn` 为什么能用**？因为它声明在 `apply` **之外**（模块级）：

```js
let previewFn = null;        // 模块级：apply 与面板都可见
let audioDiagFn = null;      // 同一个通道
// applySound 里统一挂上
if (prefs.enabled && anySound) { previewFn = playPreview; audioDiagFn = audioDiag; }
else { previewFn = null; audioDiagFn = null; }
```

**规则**：**面板要用 `apply` 内部的状态，必须新增一条模块级绑定**。

**这类错误 `node --check` 查不出来** —— 它只查语法，不查跨作用域可见性。
所以补了一个专门的作用域自检（见第 31 条）。

### 31. 用脚本做"作用域可见性"自检

写了一段检查，思路是**集合比较**：

```
① 找出 apply 函数体的字符范围（大括号配平）
② 收集 apply 内部的声明名（let/const/var/function）
③ 收集面板组件范围内的声明名（含解构、函数参数、for-of 变量）
④ 收集面板里"被调用"的标识符
⑤ 报告：③④ 都不可见、却在 ② 里出现的名字 = 真问题
```

**为什么必须用脚本**：这次报错的 `audioDiag` 和可用的 `previewFn` **在源码里相距不到
100 行、形状几乎一样**（都是 `const xxx = () => …`）。**人眼读会认为它们等价**，
只有"算作用域"才能发现一个在 `apply` 内、一个在外。

**顺带也查了 TDZ / 声明顺序**（同一段脚本）：
比较"声明行号"与"首次真实使用行号"（跳过注释行），报出顺序反常的。

### 32. 【纪律】不要再"按行号切段"改代码 —— 已出 4 次事故

本文件近 700KB / 6500+ 行。用"抽出第 N..M 行 → 拼接"的方式改代码，
**已经造成 4 次事故**：

| 次数 | 事故 |
|---|---|
| 1 | 留下**重复的 `height`** 声明 |
| 2 | 留下**重复的 `const running`** |
| 3 | 切断了 effect 收尾，留下**孤儿行**（导致整个状态栏消失） |
| 4 | 切掉了 `onPref` 的注释头与声明，**文件语法损坏**，且**没有备份、没有 git**，只能靠理解上下文手工重建 |

**根因**：行号靠"数"得来，而这份文件里注释块、多行字符串（base64）、模板字符串
交错，**数错的概率很高**；而且**拼接时一个 off-by-one 就会静默吃掉邻近的行**。

**替代做法**（按可靠性排序）：

1. **`edit` 工具做文本匹配替换** —— 命中唯一片段才生效，不匹配就报错（安全）
2. **锚定在唯一字符串上做 `Split`/`Replace`**，并用"替换后的行数变化"做校验
3. 确实要整段替换时：**先断言首行与末行的内容符合预期**，再做拼接
4. **每次改完立刻 `node --check`** —— 第 4 次事故就是它抓到的

**并且**：这个目录**没有版本控制**。600KB+ 的单文件 + 无备份 + 按行号切段 = 高风险组合。
**在继续大改之前，应该先做一份备份。**
### 33. 拆分一个开关时，要连带检查三处条件与"试听是否如实"

**需求**：用户要求把「回合开始序列」拆成复位音与打字音两个开关
（"有的用户只喜欢听复位，不喜欢一直响打字音"）。

**看起来只是"加一个 prefs 键"，实际牵动 5 处判断** —— 而**漏掉任何一处，
表现都是"关了还在响"或"开了不响"**：

```
① DEFAULTS            加键
② 设置面板 items      加项
③ 各自函数内的守卫     playRoundStart 判 startReset / typeTicker 判 startType
④ 三处聚合条件        anySound（决定是否解码）
                      want（决定是否建立观察者）
                      soundOn（决定试听按钮是否可用）
⑤ 试听序列           每一类音都要按自己的开关决定播不播
```

**⑤ 是我第一次实现时漏掉的**：试听按钮把五类音**全部无条件播放** ——
于是"关掉会话音"后点试听**仍然响**，用户会以为设置没生效（或以为有 bug）。

**教训**：**新增开关后，要检查所有"读了一组音效开关"的聚合条件**，
以及**所有"会发出声音的入口"**（正常触发 + 试听）。
试听本质上是一条"独立的声音出口"，很容易被忘掉。

**三个聚合条件的语义各不相同，不能合并**：

```
anySound  总闸 && 任一音效开关  → 决定要不要解码（解码与事件无关）
want      总闸 && (结束音 | 开始侧两项)  → 决定要不要建立回合观察者
          （会话音/尾音不依赖回合事件，所以不参与这个判断）
soundOn   总闸 && 任一音效开关  → 只决定试听按钮是否可点
```

**并且要推演开关组合**。这次逐组合核对的结果：

| 组合 | 解码 | 观察者 | 按钮 | 结论 |
|---|---|---|---|---|
| 全开 | 是 | 是 | 是 | OK |
| 只留复位音 / 只留打字音 | 是 | 是 | 是 | OK |
| 两个开始音都关 | 是 | 是 | 是 | 结束音仍工作 |
| 只留会话音 | 是 | **否** | 是 | 正确 —— 会话切换不依赖回合事件 |
| 只留"结束接复位" | 是 | **否** | 是 | 该项实际无效（它是叮的尾音，叮关了就无从触发）—— **语义自洽** |
| 全关 | 否 | 否 | 否 | 完全拆除 |

**"只留结束接复位时该项无效"不是 bug** —— 它是"叮之后的收尾"，
叮关掉就没有"之后"。**但这类"依赖另一开关才有意义"的项，值得在文档里写清楚**，
否则以后会被当成缺陷去"修"。
### 34. 死资源要"接上"或"删掉"，不要留着

**症状**：`locale/en.json` 与 `locale/zh.json` 从项目建立起就在
（`package.json` 的 `files` 与 `exports` 都声明了），但 **`client.js` 里零引用** ——
文件里写着双语的 `meta.title` / `meta.description`，界面却全是硬编码中文。
**这是"看起来支持双语、实际不会生效"。**

**修法（选"接上"）**：

```js
// 1) 注册词典
const loc = ctx.get('locale');            // 软取，见下
loc.register('phosphor', 'en', DICT_EN);
loc.register('phosphor', 'zh', DICT_ZH);
// 2) 取翻译函数
tr = loc.bind('phosphor');
// 3) slot 声明命名空间（宿主会据此注入 t 座）
{ name: 'settings.general.item', locale: 'phosphor', … }
```

**三个判断值得记下来**：

**① 用 `ctx.get('locale')` 软取，不写进 `inject`。**
`inject` 里的每一项都是**硬依赖** —— locale 服务不存在时**整个插件会加载失败**。
而词典只是界面文案，缺失时应当**优雅退化**（`tr` 的默认实现返回键名，界面仍可用）。

**② 数组里存"词典键"而不是文案。**
`TOGGLE_GROUPS` / `SLIDERS` 的第二个元素改成 `'opt.glow'` 这类键，渲染时才 `tr()`。
**若在那里直接写死中文，语言切换时不会更新**（常量在模块求值时就把字符串定死了）。

**③ 语言切换不需要自己订阅。**
宿主按 locale 的 `revision` 重渲染 slot；另外 `bind` 返回的函数是
"调用时读当前 locale"的，所以两边行为一致。

**验证方式**：词典 EN/ZH 键数必须相等（这次各 27），
且代码里 `tr('…')` 用到的每个键都要在词典里 —— 两头都脚本化核对过。

### 35. 同一条变更流上不要挂两条观察者链

**症状**：音效为了知道"是否正在生成"，自己开了一个
`MutationObserver(attributeFilter: ['data-phosphor-stop'])`。

**但那个属性【本来就是本文件的 `runProbes` 写的】** —— 于是实际链路是：

```
probeObserver(childList) → scheduleProbes(0ms) → runProbes → 写 data-phosphor-stop
                                                            → 音效的 observer 被唤醒
```

**同一条变更流上挂了两条链**，还多了一层"谁先触发"的时序依赖。

**修法**：在 `runProbes` 里主动通知一次，删掉音效那条观察者：

```js
const runProbes = () => {
  syncSoundRunState();      // ← 放在早退之前，否则状态变化会被早退跳过
  if (…已就绪…) return;      // 早退
  …
};
```

**三个要点**：

* **通知必须放在早退之前** —— 早退是"标记已就绪"，而运行态可能在标记不变的情况下改变
* **钩子要有默认空实现**，且在 `runProbes` 之前声明（否则 TDZ）
* **拆除时要还原成空实现** —— `runProbes` 的生命周期比音效长，
  不还原的话卸载后每个探针周期都会跑一段已失效的音频逻辑

**观察者从 7 减到 6。** 收益不大，但消除了一处结构上的重复与隐式依赖。
### 36. 【已否决】不要再提议压缩音频

**用户明确表态**（原话）："那个声音诡异的离谱"。

**结论：音频保真度不做任何折中，也不要再提压缩方案。**

这条写下来是为了**避免以后又提**。先前我提议过两种压缩，都被否掉了：

| 提议 | 否决原因 |
|---|---|
| 22.05kHz 单声道 + 峰值归一化 ×2.9 | "完全失真了" —— 归一化把瞬态拉爆 |
| 32kHz 立体声（约省 120KB） | "声音诡异的离谱" —— 降采样本身就改变了音色 |

**尤其要注意第二类**：**降采样不是"无损的体积优化"，它改变音色**。
44.1kHz→32kHz 虽然理论上只削掉 16kHz 以上，但这几个素材都是**噪声/瞬态型**
（crest 17~24），高频成分占比高，削掉后音色会明显变"闷/怪"。

**"复位"那 368KB 的 base64 就让它留着** —— 它是这个主题里最贵的一段，
但也是用户唯一明确要求"不许动"的东西。

**如果将来真要减体积，唯一可行的方向是"素材不内嵌"**（改走宿主静态路由），
而不是"压缩素材"。那需要动 host 半边，属于另一个量级的工作。
### 37. 【已否决】不要再提议压缩音频 —— 见第 36 条
（保留此条目序号占位说明：音频保真度不做折中。）

### 38. 第二个系统偏好也要接：prefers-contrast

**现状**：主题只处理了 `prefers-reduced-motion`（第 12 条），
`prefers-contrast` 完全没管。实测取值后发现几个**真正偏弱**的项：

```
（暗色）brand-primary   #00ff9c  ≈ 15:1   ← 远超 AA，不该动
        label-primary   #00d977  ≈ 10:1   ← 不动
        label-secondary #12a35f  ≈  5:1   ← 达标，可再亮一档
        label-tertiary  #1d9e68  ≈  6:1   ← 同上
        border-l2       #1d6b4a  ≈ 3.2:1  ← 【偏低】承担可见分隔
        border-l1       #10352a  ≈ 1.5:1  ← 【很低】默认"若有若无"
        border-l3       #0d2b22  ≈ 1.2:1  ← 仅作底衬
```

**本主题的边框是功能性的**（分隔卡片、勾勒输入区），3.2:1 与 1.5:1 在
"提高对比度"诉求下都偏弱 —— 所以只抬这三条边框 + 两档次要文字。

**亮色侧方向相反**：白底上"更浅"等于更看不见，所以是**加深**。

### 39. 【重要】改令牌要走 `overrideTokens`，不要写 CSS 媒体查询

**我第一版写错了**，而且错了两次：

```css
/* 错法一：把 @media 嵌在选择器里（那是预处理器语法，不是 CSS） */
:root[data-phosphor][data-phosphor-light],
@media (prefers-color-scheme: light) { … }

/* 错法二：即使写成合法 CSS，还得自己判"当前是亮还是暗" */
@media (prefers-contrast: more) {
  :root[data-phosphor] { --dsw-alias-border-l2: #3fbf8f; }
  :root[data-phosphor]:not(…) { … }   ← 判据怎么拿？宿主才知道当前主题
}
```

**而宿主早就给了正确的通道**（官方文档原话）：

> overrideTokens **stacks partial token layers** over the active theme …
> layers compose in seq order with **later layers winning per-token**,
> and removing a layer restores whatever it covered.

```js
// 另压一层，source 与基础层不同即可
hcLayer = ctx.theme.overrideTokens('phosphor-hc', {
  '--dsw-alias-border-l2': { light: '#5a7a6c', dark: '#3fbf8f' },
  …
});
```

**三个好处**：

1. **不用自己判亮/暗** —— `{ light, dark }` 双值由宿主按当前主题选用
2. **不用管优先级** —— 官方保证"后面的层按令牌胜出"，自然压过基础层
3. **撤销就是调 disposer** —— 与基础层同一套机制，不引入第二种撤销方式

**教训**：**这个主题的令牌体系已经有一套完整的分层机制。**
遇到"要按某种条件改主题颜色"的需求时，**第一反应应该是"压一层"**，
而不是"写一条 CSS 覆盖规则"。后者要自己处理
"条件组合 + 亮暗判定 + 优先级 + 撤销"四件事，而前者宿主全包了。

**配套要点**：
* **初始就要同步一次**，不能只等 `change` 事件 —— 否则已经开着高对比的用户永远看不到效果
* `matchMedia` 要 `addEventListener` + `removeEventListener` 成对；
  旧 Chromium 用 `addListener` / `removeListener`（都做了回退）
* **重试回调里要连它一起重做** —— 它也依赖 `ctx.theme`，首次未就绪会静默跳过
### 40. 聊天里生成课件：`<details>` 会吞掉其后全部 Markdown

**结论（从会话记录里挖出的实锤）**：在聊天消息里用 HTML 折叠标签做"答案折叠"，
**该标签之后的全部 Markdown 都会退化成字面文本** —— 标题、表格、列表全部失效。

**证据链**（`session.v4.jsonl` 里同一个模型的前后两版）：

```
行 133（坏的）：<details> 1 / </details> 1 / <summary> 1     ← 第 169 行起折叠
              之后是"常见错误清单"（| 表格）与"自测"（**Q1.**）
              → 用户截图里：表格、标题全变成源码

行 145（重写）：第 1 行有一句"问题出在我最后用了 HTML 的折叠标签 <details>，
              渲染器从那里开始就吞掉了后面的内容"
              → 该版本【无任何真实 HTML 标签】，渲染正常
```

**症状的迷惑之处**：折叠块**内部**的行内 `$…$` **反而渲染了** ——
因为它们逃过了这次"吞掉"。于是截图呈现出
"公式一部分渲染、一部分不渲染、标题表格全没了"的混合状态，
**极易被误诊为数学定界符问题**。

**我为此走了一整轮弯路**（记录以省后来者）：
依次怀疑并**逐一排除**了——跨行 `$$`、`$$` 收尾紧贴正文、缺空行、
不可见字符（零宽空格/全角 `$`）、行内 vs 块级数学的配置差异。
**全都不是**。最后是**去看原始会话记录**才找到真因。

**教训**：当"渲染异常"查不出所以然时，**先去拿原始输入数据**（会话 JSONL、
源文件字节），而不是继续对着截图推理。截图是**有损且会误导**的证据 ——
它会让我去查一个不存在的问题。

**自动化处理**：`tools/fix-md-math.ps1` 已把"脱掉 `<details>`/`<summary>` 标签、
**保留其内容**"作为第①条规则。注意是"脱标签"而不是"删整块" ——
后者会把折叠里的答案正文一起丢掉（我第一版就是这么写的，属内容损失）。

### 41. 复检代码本身也会错：判据要按定义写

`fix-md-math.ps1` 的写入后复检最初这样判断"跨行 $$"：

```powershell
if ($y -match '\$\$' -and -not ($y.StartsWith('$$') -and $y.EndsWith('$$')))
```

于是 `正文 $$x^2$$ 后面还有字` 这种**单行内既开又闭**的合法写法被误报为"跨行"。

**正确判据**（按定义写，不看位置看计数）：

```powershell
$n = ([regex]::Matches($y, '\$\$')).Count
if ($n % 2 -ne 0) { … }        # 本行 $$ 个数为奇数 ⇔ 必然跨行配对
```

**教训**：**复检逻辑比被检代码更容易出错** —— 因为它往往只被"正常输入"验证过。
写判据时要回到**定义**（"跨行"= 开闭不在同一行 = 本行计数为奇数），
而不是用"看起来像"的特征（以 `$$` 开头/结尾）。
### 42. 【已回滚】别把事件监听"合并"成由别人的控制流顺带调用

**症状（用户报"音效搞炸了"）**：

| 现象 | 机制 |
|---|---|
| 一轮结束**不响「叮」** | `真→假` 分支永不执行 |
| 下一轮开始**不响复位音** | `!soundWasRunning` 永不成立 |
| **打字声停不下来** | `contentTyping` 永远为 true |

**根因**：我曾做过一次"优化"（模块 ③ 观察者合并），
把音效的回合开始/结束触发，从**独立的属性观察者**改成
**由 `runProbes` 主动调用 `syncSoundRunState()`**，理由是：

> "`data-phosphor-stop` 本来就是 `runProbes` 里的 `markSendState` 写的，
> 同一条变更流上不必挂两条链。"

**这个推理错在**：`runProbes` **有一个早退分支**：

```js
const runProbes = () => {
  …
  if (composerHoldsEditable() && isLive(markedToolbar) && isLive(markedSend)) {
    return;                       // ★ 跳过下面三个 mark*
  }
  markComposerCard();
  markComposerToolbar();
  markSendState();               // ← 唯一会 removeAttribute('data-phosphor-stop') 的地方
};
```

只要探针认为"状态已就绪"而长期早退，
`data-phosphor-stop` 就**永远不会被摘掉** → `querySelector('[data-phosphor-stop]')`
恒为真 → 三个症状全中。

**核心教训**：

> **一个属性能否被摘除，取决于另一个组件的控制流（含它的早退条件）。
> 观察者【直接盯着属性】才是解耦的；改成"顺带调用"就把我的正确性
> 绑到了别人的早退分支上。**

**代价对比**：那次"优化"省下的只是**一条 `attributeFilter` 限定到单个属性的
观察者**（本文件原本就有实测注释说它"代价极低"），
换来的却是一个隐蔽且症状分散的故障。
**省下的资源远小于风险 —— 这类"合并监听"的优化，默认不做。**

**回滚方式**：恢复独立观察者（`runStateObs`），
并把 `runProbes` 里那行调用删掉。回滚后核对三项都回到原值：
观察者 7、断开 7、`runProbes` 内调用 0。

**自检清单（新增注册/监听时必须过一遍）**：

1. 这条监听处理的事件，**是否由我自己的代码产生**？若是别人产生的，
   我能否保证它**一定会被触发**（尤其**没有早退分支**）？
2. 我的触发**依赖的属性/状态**，是否可能**长期不被更新**？
3. 建立与拆除**是否成对**（`observe` ↔ `disconnect` 计数相等）？
4. 把它删掉后，**谁来兜底**？
### 43. 彻底自检：两层工具 + 一次变异测试

**问题**：本插件的历史缺陷**全是同一类** —— 建立了资源没回收、
跨作用域引用、建立与拆除不成对。这些都不报语法错，只在特定路径下暴露。
而"靠人肉 review"在本项目里已被证明不可靠（我曾连续改坏三次）。

**方案**：`tools/audit.ps1` 一次跑三层。

```
【0】目标文件      工作区与 junction 的 SHA256 一致性
【1】静态（verify.ps1）
     · node --check 语法
     · 资源成对：MutationObserver 7/7、setTimeout 7/7、
                 setInterval 3/3、addEventListener 5/5
     · CSS：花括号 149/149、无重复选择器、@media 无非法嵌套
     · 词典：EN/ZH 键集相同、无重复键、tr() 用到的键都存在
     · locale 守卫：window 标记 + bind 在守卫外 + 无裸变量
     · 音效触发源：三条链的观察者都在、runProbes 内无调用
     · 面板项数：13 开关 + 5 滑块，且每个 key 都在 DEFAULTS
     · 危险模式：无 console.log/debugger/TODO
     · 宿主契约：inject 含 remote.account、slot 声明 locale
【2】运行时（render-check.mjs）
     · 真的 import client.js、真的调 apply(ctx)
     · 渲染设置面板与全部 4 个 slot 组件
     · 按【配置】核对三个音效观察者（不是数总数，见下）
     · 分支覆盖：总闸关 / 音效全关 / 只留会话音 / 只留打字音 / 恢复全开
     · 重复 apply（模拟 HMR 重载）：不抛错、词典不重复注册
```

**结果：43 项 OK、0 FAIL。**

### 44. 【重要】写检查比写代码更容易出错 —— 本项误报了四次

作用域可达性检查，我连改四版判据，**每一版都是假阳性**：

| 版本 | 判据 | 误报原因 |
|---|---|---|
| ① | 把 `setPref` 当"apply 内部名" | 它其实是 **factory 级**（缩进 4），面板当然看得见 |
| ② | 只看声明行缩进 | 把**面板自己的局部变量**全报了出来 |
| ③ | 排除面板行号区间 | 仍误报 `TOGGLE_GROUPS`/`SLIDERS` —— 它们声明在面板**之前几行、同一作用域**，是合法闭包捕获 |
| ④ | 按花括号深度 | 仍误报 8 个：那些名字是**属性名/函数参数/解构**（`diag.buf`、`e.label`、`forEach((row)=>…)`、文案里的 `vol=`），**正则分不清标识符与属性名** |

**结论：JS 的作用域与引用语义不是文本能可靠推断的。**
这件事**从静态检查里撤掉**，交给 `render-check.mjs` ——
它把 `client.js` 真 import 进来、真调 `apply`、真渲染面板；
有不可达引用就会**真抛 `ReferenceError`**。

**另外两个自检自身的 bug**（都值得记）：

1. **汇总写在检查之前** → `process.exit` 让音效检查整段没跑，
   而输出还显示"全部通过"。**自检报告说谎比没有自检更危险。**
   修法：汇总固定在文件末尾，且不复用 `process.exit` 做流程控制。
2. **`ctx.effect` 桩静默吞异常** → 曾显示"全部通过"，
   实则 `setupSounds` 根本没建观察者（少 3 个）。
   修法：桩里把被吞的异常**收集起来并报告**，用 Proxy 兜底未知 ctx 成员，
   避免"缺某个 API"掩盖真问题。

### 45. 【重要】断言要按"配置"核对，不要按"总数"

`render-check.mjs` 最初断言"观察者应为 7 个"，一直失败。查清后发现：

> **7 是文件里 `new MutationObserver` 的出现次数，但其中 3 个是
> 【拿到发送键/活动灯元素时】才惰性创建的**（属于别的功能）。
> `apply` 期间实际只会建 4 个。

**改成按配置核对**（找有没有 `attributeFilter: ['data-phosphor-stop']`
的那个观察者），才是真正想验证的东西：

```js
const hit = observers.find(o => (o.opts.attributeFilter || []).includes('data-phosphor-stop'));
```

**教训**：断言的判据要与**意图**对齐。"数量对得上"是巧合，
"那个我关心的观察者确实存在且配置正确"才是意图。

### 46. 检查本身也要做变异测试

一个从不失败的检查，可能是"恰好总通过"。
所以我把 locale 守卫**故意短路**（`if (!isLocaleRegistered())` → `if (true)`），
看检查是否会报错：

```
守卫短路 → 词典注册累计 4  ★ 期望 2  → 报错（退出码 1）✓
原版     → 词典注册累计 2  ✓        → 通过
```

**能抓住人造 bug 的检查，才算检查。**
`render-check.mjs` 支持传路径参数（`node tools/render-check.mjs <file>`），
正是为了做这种变异测试。

### 47. 运行时检查的盲区（诚实记录）

它是桩件驱动的，**以下测不到**，仍需在真实界面验证：

| # | 盲区 | 涉及 |
|---|---|---|
| 1 | **真实 WebAudio 行为** | `decodeAudioData` / 限幅器 / **实际出声** |
| 2 | **真实 MutationObserver 时序** | 浏览器在微任务末尾派发；我是手动同步调用 |
| 3 | **`runProbes` / `markSendState` 的真实执行** | 依赖宿主真实 DOM。**第 42 条那个 bug 正是这类时序依赖，它测不到** |
| 4 | **CSS 实际渲染效果** | 149 条规则与令牌覆盖后的最终观感 |
| 5 | **宿主契约的运行时校验** | slot 名是否被接受、locale 是否真注册成功 |
| 6 | **真实 HMR 交互** | 只能模拟"再调一次 apply"，不是真重载 |

**所以 `audit.ps1` 全过 ≠ 可以交付** —— 声音、观感、宿主接受度仍须重启后实测。
### 48. 发布形态：安装路径靠【三处引用】，改名要同步

**结论（实测读出来的，不是猜的）**：这个插件被装进 profile 的方式是
**pnpm 的 `link:` 依赖 + junction**，包名在**三个地方**被引用：

```
① profile\package.json
     "dependencies": { "@local/dsh-phosphor": "link:C:/…/phosphor-bundle" }
     "dsh": { "profile": { "bundles": [ … , "@local/dsh-phosphor" ] } }
        ↑ 两处：依赖声明 + bundles 列表
② cordis.patch.yml
     - insert:
         - id: phosphor
           name: '@local/dsh-phosphor'      ← 包名在此，bundle 的 patch 靠它装载
③ node_modules\@local\dsh-phosphor        ← junction 的【目录名】= 作用域名
     Target = …\default-workspace\phosphor-bundle
```

**所以"改包名"不是改一个字段**，而要同时：
1. `package.json` 的 `name`
2. `cordis.patch.yml` 里的 `name`（**最容易漏**：它才是装载时用的名字）
3. profile 的 `dependencies` + `dsh.profile.bundles`（两处）
4. `node_modules` 下 junction 的目录名（作用域目录）
5. 让 pnpm 重装（`pnpm install`）

**公开版用的是无作用域名 `dsh-phosphor`**（任何人可发布/安装），
而本机开发环境用的是 `@local/dsh-phosphor`（本地 link，不进 npm）。
**两者可以共存** —— 这正是 `cordis.patch.yml` 里那份 `name` 存在的意义。

**附带的教训**：`private: true` 是**防误发的保险**。
公开版必须去掉它，去掉之后就**没有第二道保险**了 ——
发布前务必确认 `files` 白名单正确（本仓库已把 `.backup/` 排除在 `files` 与 `.gitignore` 之外）。

### 49. 仓库发布前的清理清单

按本仓库的实际情况整理，供同类项目复用：

| # | 项 | 本仓库做法 |
|---|---|---|
| 1 | 排除开发过程产物 | `.backup/`（7 MB 手工快照）→ 同时进 `.gitignore` 与 `files` 排除 |
| 2 | 行尾噪音 | `.gitattributes`：`* text=auto eol=lf`，二进制与 wav 标 `binary` |
| 3 | 包名与许可 | `@local/x` → `x`；去掉 `private`；加 `license: MIT` + `keywords` |
| 4 | 门面文件 | `README.md`（安装/验证/设置/已知限制）+ `LICENSE` |
| 5 | **调试出口加门禁** | 原本 `window.__phMathProbe` / `window.__phosphorPrefs` **无条件挂载**，公开版会污染全局。改成仅当 `?phosphor-debug=1` 或 `localStorage['phosphor.debug']='1'` 才挂 |
| 6 | 内部文档改名 | `MAINTENANCE.md` → `DEVELOPMENT.md`（公开惯例），并清掉仓库外路径的引用 |
| 7 | 敏感内容扫描 | 搜绝对路径、会话 id、uuid —— 本仓库全为 0（因为开发时就一直注意不留这些） |

**第 5 条最容易被忘**：调试出口在开发时是资产，在发布版是负债。
门禁写好后**记得同步改自检工具**，否则它会因为"出口没挂"而失败
（`render-check.mjs` 现在在 localStorage 桩里直接设 `phosphor.debug=1`）。

### 50. 【事故记录】改包名把 DSH 弄到打不开 —— 以及正确的顺序

**这是本项目最严重的一次事故**（用户原话："你把程序搞炸了，我刚才关掉插件之后都打不开 dsh"）。
把它完整记下来，因为**推理链本身比结论更有价值**。

#### 我做了什么

为了发布到 GitHub，把包名从 `@local/dsh-phosphor` 改成 `dsh-phosphor`，
并同步改了 `cordis.patch.yml` 里的 `name`。**自检三层全过**，我还对用户说
"本机不受影响"。

#### 实际后果

```
打不开 DSH。而且关掉插件也没用。
```

#### 真相（靠读 profile 的备份与日志还原出来的）

**包名在四处被引用**，我只改了其中两处：

| # | 位置 | 我改了吗 |
|---|---|---|
| 1 | 仓库 `package.json` 的 `name` | ✅ 改了 |
| 2 | 仓库 `cordis.patch.yml` 的 `name`（**装载时用的名字**） | ✅ 改了 |
| 3 | profile `package.json` 的 `dependencies` 键 + `dsh.profile.bundles` | ❌ 没改 |
| 4 | `node_modules/@local/dsh-phosphor`（junction 的**目录名**） | ❌ 没改 |

于是**装载时名字解析矛盾**。

**然后是更糟的连锁反应**：profile 的 `cordis.patch.yml` 被改写，
**从 8 个条目截断到 3 个**，丢掉了：

```
-agent-default-model   -ui-theme   -session-log-deepseek
-locale                -phosphor
```

**`locale` 被丢掉才是"打不开"的直接原因** —— 而巧合的是，
**本插件自己依赖 locale 服务**（`ctx.get('locale')`，见第 34 条）。
**两个错叠在一起，症状指向了错误的方向。**

#### 我犯的四个错（每个都可独立避免）

| # | 错误 | 正确做法 |
|---|---|---|
| ① | **在插件"装着且启用"时改包名** | 改包名是**装载链变更**，必须当作危险操作：**先停用插件 → 改名 → 同步全部四处 → 重启验证** |
| ② | **备份点选晚了** | 我在改完 `cordis.patch.yml` **之后**才建 pre-publish 备份，所以那份备份里已经是新名字 —— **备份失去了意义**。备份必须在**触碰任何文件之前**做 |
| ③ | **只验证"语法"没验证"装载"** | 三层自检全过，但它们**只覆盖仓库内部**，测不到"宿主能否装载它"。**"自检通过"≠"能装能跑"** |
| ④ | **用一个真命题推出了假结论** | 我说"Node 按 `node_modules` 路径解析、不读 `name` 字段，所以目录名不一致也行"。**这句话对 Node 成立，对 DSH 的插件解析不成立。** 用一个领域的事实去推断另一个领域，是这次事故的思维根源 |

#### 恢复办法（已验证有效）

profile 里通常留有 `.bak-<时间戳>`：

```powershell
# 1. 从 .bak 还原（那是正确基线，8 个条目）
# 2. 把 phosphor 条目改为 disabled: true（先让 DSH 能起来）
# 3. 重启
```

**关键认知**：`cordis.patch.yml` 里**不只是本插件的条目** ——
它还承载 `agent-default-model` / `locale` / `ui-theme` 等
**与主题无关的全局配置**。**动它等于动整个 profile。**

#### 如果将来真要改包名（完整清单）

1. **先在 DSH 里停用插件**，确认停用后能正常启动
2. **备份** `~/.dsh/profiles/<profile>/cordis.patch.yml`（**在任何改动之前**）
3. 改四处：仓库 `package.json`、仓库 `cordis.patch.yml`、
   profile `package.json`（`dependencies` 键 **+** `bundles` 数组两处）
4. 处理 junction 目录名（作用域目录）
5. `pnpm install`
6. **重启并在 DSH 里确认**：设置 → 通用 能看到主题那一行
7. 出问题时**回退到第 2 步的备份**，而不是自己去猜哪一处漏了

#### 一条更普遍的教训

> **"我改了 A，自检证明 A 没问题"** 这个推理是**不完整**的。
> 必须再问：**A 是否被 A 之外的东西引用？那些引用是否也同步了？**
>
> 这次四处引用只同步了两处 —— 而**自检工具检查的恰恰只有"同步了的那两处"**。
> **检查的覆盖范围，决定了它的结论能走多远。**

### 52. 【实测】systemPrompt.section() 是**按会话**的，不是全局 —— 但前提是注册在 agent 作用域

这是为"角色卡带"功能做的前置验证。**结论来自真实实验，不是文档推断。**

**要回答的问题**：宿主侧 `ctx.systemPrompt.section()` 注册的提示词段落，
是只作用于那个会话，还是整个 Harness 所有会话共用？

**方法（约 30 行宿主实验）**：

```js
export const inject = ['systemPrompt'];
export function apply(ctx) {
  ctx.on('agent/created', function (payload) {          // ← 普通函数，为了 this
    const suffix = String(payload.agent.id).slice(-6);
    const scoped = (this && this.systemPrompt)           // ← 关键：this 是 agent 作用域
      || (payload.agent.ctx && payload.agent.ctx.systemPrompt) || null;
    if (!scoped) return;                                 // ← 绝不回退到全局
    scoped.section({ name: 'phosphor.scopeProbe', order: 1000,
      text: '本会话标识后 6 位是「' + suffix + '」……' });
  });
}
```

**结果**：

| 会话 | 真实 id | 探针回答 |
|---|---|---|
| A | `session-…-aaaaaa`（已脱敏） | `aaaaaa` ✓ |
| B | `session-…-bbbbbb`（已脱敏） | `bbbbbb` ✓ |

**两个会话各自看到自己的后缀 → 作用域正确，互不污染。**

**四个实现要点（每个都能单独搞坏它）**：

1. **监听器必须用普通函数**，因为签名是 `'agent/created'(this: Scoped<Agent>, payload)`。
   **箭头函数会丢掉 `this`**，退化成外层 ctx —— 那正好就是全局注册。
2. **绝不回退到 `ctx.get('systemPrompt')`**：那是插件 ctx = 全局。
   拿不到 agent 作用域时**宁可什么都不做**。全局误注册的症状极隐蔽：
   **你在一个窗口测试完全正常，实际却把所有会话都变成了同一个角色。**
3. **`name` 必须唯一**（如 `phosphor.persona`）：scoped 会 shadow 同名 global，
   而**同一层里重名会 throw**。
4. **agent 作用域上的注册有两个 owner**：插件被卸载**不会**自动清掉它们，
   必须在插件自己的 effect 里留一份 disposer（官方实践文档明确提醒）。

**顺带实测到的两点**：

- `order: 1000` 正常工作，段落被**追加在系统提示末尾**（权重靠后，对"人设"这种指令反而有利）
- 同一 agent 若再次触发 `agent/created`（`source` 可能是 `resume` / `compact`），
  **必须先撤旧注册再注册新的**，否则同层重名抛错

**代价**：每会话**每一步**都会多这段 token，所以正文要压到 ~300 token 内。

**撤回方式**：`git checkout -- index.js` + 重启即可。
**不需要 `install_bundle`** —— 本项目用 junction 装包，改 `index.js` 就是改已安装那份，
宿主重启会加载新的 JS 模块（官方文档："替换已安装包需要重启加载新的 JS 模块"）。
这也意味着**改宿主半边比改客户端边的验证成本更低**（少一次装包与 profile 改写风险）。
## 三、已知边界

- **排版节奏无法完全对齐预览页。** 预览页的观感很大一部分来自它自己的排版系统（字号层级、padding/margin 节奏）。真界面由 DSH 组件决定，改它要动宿主样式，会破坏界面一致性。已移植的是可移植的那部分：行高 delta、面板字号、字距。
- **预览页的结构性装饰无法移植**：`.ph-turn-head` 轮次分隔线、`>` 提示符、`[ ok ]` 工具标签、ASCII Hero。宿主对话由 DSH 自己的组件渲染，没有对应 DOM 钩子。
- **打字机的诚实边界**：真正的逐字符需要 JS 接管渲染，会与 DSH 的流式追加打架（两边同时往同一段文本写），还会让输出排队等待。现在做的是零 JS 开销的近似：新内容快速淡入。
- **CRT 曲率**用的是内边阴影 + 圆角，**不是** `transform: perspective()` 真弯屏 —— 真弯屏会让整屏文字被重采样发虚。

---

## 四、卸载与回滚

- 临时停用：设置 › 通用 › 终端外观 → 关掉「终端外观」
- 彻底移除：`plugin_manager` `action: remove_bundle`，target `@local/dsh-phosphor`
- 单页调试：改 `client.js` 后经 HMR 自动重载；`index.html` 双击即可对照设计基准

---

## 五、验证手段

**能读到 DOM 真值的唯一通道**：把值写进 `document.title`。窗口标题（Electron 自绘标题栏读不到）、HTTP（401）都不通。曾用这个方法做过一次圆角诊断，读不到是因为标题栏自绘，不是方法本身无效。

**能读 DSH 内部实现的方式**：`asar-read.ps1`。`read` 工具读 asar 会报 BigInt 错误；shell / glob / grep 被 ripgrep 与文件系统挡住。这是唯一可用的路径，排查宿主行为时绕不开。
