/**
 * DSH // PHOSPHOR — Client half.
 *
 * 黑底磷光绿的黑客终端主题。只依赖主题令牌（--dsw-alias-*）与自有 CSS 类名，
 * 不 import 任何 Harness Client 包。
 *
 * 官方形态（templates/decoration/client.js）：
 *   window.__ModuleLoader__.load({ id: <包名>, factory(require) { ... } })
 *   factory 返回 { inject, apply }，React 从模块表取，不打包第二份。
 *
 * 生命周期：apply 内的一切副作用都登记在 ctx.effect 下，插件卸载即回滚。
 * 首版刻意收窄范围（令牌 + 字体 + 发光 + 扫描线 + 曲率 + 状态栏 + 设置行），
 * 先在真实界面里跑起来，再按官方流程迭代观感。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-phosphor',

  factory(require) {
    const React = require('react');
    /* react-dom 只为了 createPortal：SKILL 库面板是从【设置页】里打开的，
       渲染在浮层容器里会被设置页那一层盖住（街机从状态栏打开，
       从没和设置页抢过层，所以一直没暴露）。portal 到 body 就跳出了容器的层叠上下文。 */
    const ReactDOM = require('react-dom');

    /* ------------------------------------------------------------------ *
     * 偏好：模块级状态 + 订阅者 + 跨刷新持久化。
     *
     * 关于持久化的说明（重要，别误以为是官方通道）：
     * 官方规范要求可调值放进插件的 Config（Host 半边 `export const Config`），
     * 但 Config 由 Host 持有，而主题住在 Client 半边。官方给出的 client→host
     * 写入路径（`host.call` + `harness.handle`）只属于 **动态包** 的闭包运行器；
     * 已安装 bundle 的客户端半边走 `require` 模块表，拿不到 `host` 符号。
     * 本 profile 的客户端服务目录里也没有 settings / storage，
     * `dsh-api-settings-controller` 同样未装载。
     *
     * 结论：官方持久化通道在当前 profile 下不可用。这里退而用 localStorage
     * 做跨刷新持久化，键名带版本号，将来接入官方通道时可平滑迁移。
     * ------------------------------------------------------------------ */
    /* 版本号显示在 LAB 里，测试者报问题时用它标识"装的是哪一版"。
       【必须与 package.json 的 version 对应】—— pack.ps1 会校验两者一致，
       不一致就拒绝打包（否则群里的版本号形同虚设）。 */
    /* 【唯一版本源头】与 package.json 的 version 必须【逐字相同】——
       pack.ps1 直接比对两者，打包时不一致就拒绝。
       之前它写的是 v1.0-beta2，而 package.json 是 1.0.0-beta.2，
       两者靠 pack.ps1 做一层"推导后比对"，多一层映射就多一次错的机会。
       现在两边一模一样，任何一个显示点都引用这一个常量。 */
    const PHOS_VERSION = '1.0.0-beta.2';
    /* 构建日期：跟版本一起手工维护。悬停/复制版本信息时用它，
       目的是让测试者报的"哪个版本"能对上具体某次打包。 */
    const PHOS_BUILD = '2026-11-02';

    const DEFAULTS = {
      enabled: true,
      glow: true,
      scan: true,
      crt: true,
      statusbar: true,
      boot: true,
      ascii: true,
      glitch: true,
      typew: true,
      /* 音效（用户指定默认【开】）：
         开始序列拆成两个开关 —— 用户指出"有的用户只喜欢听复位、不喜欢一直响打字音"，
         所以复位音与打字音各自可控：
           startReset   回合开始时的复位音（1.455s 长音）
           startType    生成过程中随内容到达的打字音
         soundEnd      回合结束音（叮）
         sessionSound  切换会话的提示音（单次切换）
         素材已内嵌（见 §6.10）。 */
      startReset: true,
      startType: true,
      soundEnd: true,
      sessionSound: true,
      /* endReset：叮之后的复位尾音（用户要求加，默认开）。
         关掉的话一轮结束就只剩一声干净的「叮」。 */
      endReset: true,
      /* 音效强度（全局乘数，百分比）。100 = 基准，0 = 静音，200 = 两倍。 */
      soundVolume: 100,
      /* 打字机速度（0~200，越大越快）。180 = 此前手调出来的手感。 */
      typeSpeed: 180,
      scanLine: 100,
      glowPower: 100,
      vignette: 100,
      /* ── LAB（隐藏实验室）──
         入口：设置面板头部的 PHOSPHOR 字标连点三下。
         这三项刻意【不进】TOGGLE_GROUPS，所以不会出现在正式分组里 ——
         只有找到 LAB 才看得见。 */
      labOpen: false,    /* LAB 是否展开（记住状态：它是你的实验室，不该每次重开） */
      powerFx: true,     /* 开关机动画（关掉/开启主题时的 CRT 电源效果） */
      eggs: true,        /* 彩蛋总开关：关掉后状态栏不再有街机入口 */
      /* 磷光色：p1 绿（默认/恒等）| p3 琥珀 | p4 白。见 TONE_SPECS 的说明。 */
      tone: 'p1',
      /* 系统日志：{ [id]: true }。由真实事件写入，见 LOG_ENTRIES。 */
      found: {},
      /* 街机彩蛋的最高分。
         放在偏好里而不是另起一套 localStorage：偏好已经有
         「读→合并默认值→写→广播」这条完整通道，没必要再造一条。
         它【不进】设置面板的开关/滑块数组，所以界面上看不到它 ——
         只在状态栏里以 HI 的形式出现，且为 0 时完全不渲染。 */
      hiScore: 0,
    };

    const PREF_KEY = 'phosphor.prefs.v1';

    function readPrefs() {
      try {
        const raw = window.localStorage.getItem(PREF_KEY);
        if (!raw) return { ...DEFAULTS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
      } catch {
        return { ...DEFAULTS };
      }
    }

    let prefs = readPrefs();
    const listeners = new Set();

    function setPref(key, value) {
      prefs = { ...prefs, [key]: value };
      try { window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* 隐私模式 / 配额满时忽略 */ }
      for (const fn of [...listeners]) {
        try { fn(); } catch { /* 单个订阅者出错不影响其余 */ }
      }
      /* 【这里曾经挂过一个"拨杆开关操作音"】—— 已移除。
         原因：用户指出那个场景实际用不到（不会常去动设置面板），
         所以把「单次切换」这个音改挂到【切换会话】上了（见 setupSessionSound）。
         保留这条注释是为了说明：setPref 确实是一个很好的汇聚点
         （所有偏好交互都走它，挂一处即可覆盖全部控件），
         如果以后需要给设置面板的交互加反馈音，这里仍然是首选位置。 */
    }
    /* ── 系统日志：彩蛋的可发现记录 ──────────────────────────────────────────
       这是 LAB 里那份 SYSTEM LOG 的数据源。

       【为什么叫"日志"而不是"成就"】
         成就系统是 App 语言，会滑向参与度指标 —— 而参与度指标会奖励"熬时间"，
         这与本项目的一条明确立场冲突：用户有时要长时间盯着输出读代码/复习，
         任何"多待一会儿就有奖励"的机制都会变成打扰。
         所以这里【没有一条】依赖计时、闲置或"用了多久"：全部由可数个真实事件驱动。

       【两组前缀是刻意的】
         [ ok ] 是记录（你做了什么）
         [warn] 是逮到你（机器在评判你）—— 整蛊的那五条都用它。
           前缀差别本身就是笑点：同一份日志里，"你装好了卡带"和"你敲了 sudo"
           的待遇不一样。

       【计数类为什么不进偏好】
         markClicks / toneSwitches / wallHits 每次事件都要变。走 setPref 会触发
         整条偏好管线（令牌重建 + 音频观察者重建），点一百多次就是重建一百多次。
         所以它们落在 localStorage 的独立键上；只有【跨过阈值那一次】才写偏好，
         那一次的代价是值得的（日志要立刻出现在 LAB 里）。
       另外必须持久化：否则点 60 次刷新一下就归零，114 永远达不到 ——
       那就不叫整蛊，叫 bug。 */
    const LOG_ENTRIES = [
      { id: 'arcade',   kind: 'ok',   text: 'cartridge mounted' },
      { id: 'lab',      kind: 'ok',   text: 'maintenance bay unlocked' },
      { id: 'p3',       kind: 'ok',   text: 'amber beam calibrated' },
      { id: 'p4',       kind: 'ok',   text: 'white beam calibrated' },
      { id: 'score20',  kind: 'ok',   text: 'score 20 logged' },
      { id: 'score50',  kind: 'ok',   text: 'score 50 logged' },
      { id: 'sudo',     kind: 'warn', text: 'sudo: permission denied' },
      { id: 'click114', kind: 'warn', text: 'still clicking' },
      { id: 'wall3',    kind: 'warn', text: 'wall inspector' },
      { id: 'tone6',    kind: 'warn', text: 'indecisive' },
      /* ── 第二批 10 条 ── */
      { id: 'konami',    kind: 'ok',   text: 'konami code' },
      { id: 'selfbite',  kind: 'warn', text: 'self inflicted' },
      { id: 'flawless20', kind: 'ok',   text: 'flawless 20' },
      { id: 'record',    kind: 'ok',   text: 'new record' },
      { id: 'rmrf',      kind: 'warn', text: 'rm: not permitted' },
      { id: 'onemore',   kind: 'warn', text: 'one more run' },
      { id: 'revoked',   kind: 'warn', text: 'clearance revoked' },
      { id: 'bare',      kind: 'warn', text: 'effects: none' },
      { id: 'contrast',  kind: 'ok',   text: 'high contrast engaged' },
      { id: 'silence',   kind: 'warn', text: 'silence' },
    ];
    const LOG_STAT_KEY = 'phosphor:stats';
    const readLogStats = () => {
      try {
        const raw = window.localStorage.getItem(LOG_STAT_KEY);
        const o = raw ? JSON.parse(raw) : {};
        return (o && typeof o === 'object') ? o : {};
      } catch { return {}; }
    };
    const bumpLogStat = (key, step) => {
      const s = readLogStats();
      s[key] = (Number(s[key]) || 0) + (step || 1);
      try { window.localStorage.setItem(LOG_STAT_KEY, JSON.stringify(s)); } catch { /* noop */ }
      return s[key];
    };
    /* 幂等：已经记过就不再写偏好（否则 114 次点击会写 114 次） */
    const markFound = (id) => {
      if (!id) return;
      const cur = (prefs && prefs.found) || {};
      if (cur[id]) return;
      setPref('found', { ...cur, [id]: true });
    };
    /* ── sudo 探针 ────────────────────────────────────────────────────────────
       整蛊：在输入框里打出 sudo，机器当场记一笔 permission denied。

       【挂在输入卡片上，不是 document】`input` 每敲一个字都会触发，
       如果挂 document，就要为每一次按键做一次从 target 到卡片的祖先遍历；
       挂在卡片上用 capture，只在卡片换代时重挂一次。
       元素换代靠 ensureSudoWatch 的地址比较判断 —— 旧监听器先摘掉再加新的，
       避免一个卡片上叠多个监听。 */
    let sudoCard = null;
    let sudoHandler = null;
    /* ── 状态型成就 ────────────────────────────────────────────────────────────
       这三条不记"发生过什么"，只判断"现在是什么"。
       所以它们【结构上不可能触发不了】—— 这正是上一轮那两条死条目缺的性质：
         access denied 要求点击到达一个带 pointer-events:none 的元素；
         power cycle 要求 onPref 走到末尾某个分支。
       两者都可能永远不成立。状态型没有这个问题：条件成立就是成立。

       调用点两个：onPref 的【最前面】（不放末尾，避免被前面的异常跳过），
       以及 apply 时一次（让"已经处在该状态"的人也能补记上）。 */
    const evalStateAchievements = () => {
      const p = prefs || {};
      /* effects: none —— 六个装饰开关全关 */
      const decor = ['glow', 'scan', 'crt', 'boot', 'ascii', 'glitch'];
      if (decor.every((k) => p[k] === false)) markFound('bare');
      /* silence —— 五条音效全关 */
      const sound = ['startReset', 'startType', 'soundEnd', 'sessionSound', 'endReset'];
      if (sound.every((k) => p[k] === false)) markFound('silence');
      /* high contrast —— 由【系统】的 prefers-contrast 驱动，不是我们的开关。
         【必须自己去问 media query，不能复用 effect 里的 contrastMQ】
         那个变量声明在 ctx.effect 内部，而本函数定义在外层 ——
         引用它会抛 ReferenceError，进而让 apply 的后续 setup 全部中断
         （音效观察者因此一个都没建起来）。自包含是这里唯一安全的写法。 */
      let hc = false;
      try {
        hc = (typeof window.matchMedia === 'function')
          && window.matchMedia('(prefers-contrast: more)').matches;
      } catch { /* 不支持就当作没有 */ }
      if (hc && p.enabled) markFound('contrast');
    };

    const ensureSudoWatch = (card) => {
      if (!card || sudoCard === card) return;
      if (sudoCard && sudoHandler) {
        try { sudoCard.removeEventListener('input', sudoHandler, true); } catch { /* noop */ }
      }
      sudoCard = card;
      sudoHandler = (ev) => {
        try {
          const t = ev && ev.target;
          if (!t) return;
          const text = (typeof t.value === 'string' ? t.value : t.textContent) || '';
          /* 认 /sudo、行首 sudo、空格后的 sudo —— 但 sudoers 这种前缀不误判 */
          if (/(^|[\s/])sudo\b/i.test(text)) markFound('sudo');
          /* rm -rf / rm -fr / rm -r —— 终端里最经典的那条 */
          if (/(^|[\s;|&])rm\s+-[a-z]*r/i.test(text)) markFound('rmrf');
        } catch { /* noop */ }
      };
      try { card.addEventListener('input', sudoHandler, true); } catch { /* noop */ }
    };
    /* ── 开发用调试出口的门禁 ────────────────────────────────────────────────
       公开版不该无条件下往全局挂东西。仅当满足其一才挂：
         · URL 带 ?phosphor-debug=1
         · localStorage 有 "phosphor.debug" = "1"
       自检工具（tools/render-check.mjs）在桩环境里直接设 localStorage 标记，
       所以它能照常使用这些出口。 */
    const DEBUG_ON = (() => {
      try {
        if (window.localStorage && window.localStorage.getItem('phosphor.debug') === '1') return true;
        if (window.location && String(window.location.search || '').indexOf('phosphor-debug=1') >= 0) return true;
      } catch { /* noop */ }
      return false;
    })();

    /* 【调试出口】把偏好读写挂到 window 上。
       用途：自检工具（tools/render-check.mjs）需要【在不改 localStorage、
       不点界面】的前提下切到各条分支（enabled=false、音效全关、高对比开启…）
       —— 那些分支正是历史 bug 的藏身处，手工点界面既慢又难覆盖。
       命名带 __phosphor 前缀，避免与宿主或其它插件撞名。 */
    if (DEBUG_ON) try {
      /* 街机开关：只给自检工具用（tools/render-check.mjs 要能把它打开，
         否则街机面板永远不渲染，等于没测）。仍在 DEBUG_ON 门禁内。 */
      window.__phosphorArcade = {
        open: (v) => setArcadeOpen(v),
        isOpen: () => arcadeOpen,
        /* 实时状态（phase / score / paused）。自检用它验证"死了能重开"。 */
        state: () => (typeof arcadeStateFn === 'function' ? arcadeStateFn() : null),
      };
      /* 电源层：自检要验证"清除后不渲染 / 播放时渲染"，
         而它平时是 null（只在总闸跳变那一刻出现），没有别的办法驱动。 */
      window.__phosphorPowerFx = {
        play: (kind) => setPowerPhase(kind),
        clear: () => setPowerPhase(null),
        phase: () => powerPhase,
      };
      /* 磷光色：自检要验证"P1 恒等"并实测 P3/P4 的对比度。 */       window.__phosphorTone = {         hex: (h, t) => toneHex(h, t),         tones: () => Object.keys(TONE_SPECS),       };
      window.__phosphorPrefs = {
        get: () => ({ ...prefs }),
        set: (key, value) => setPref(key, value),
        dump: () => JSON.stringify(prefs),
        /* 音效运行态（诊断「打字声停不下来」用）：读的是实时闭包值 */
        sound: () => (typeof soundStateFn === 'function' ? soundStateFn() : null),
      };
    } catch { /* 无 window（非浏览器环境）时跳过 */ }

    /* 【音效运行态探针】把内部状态暴露给调试出口。
       为什么需要它：
       「打字声停不下来」意味着 contentTyping 恒为真，而它有两个可能来源：
         ① syncSoundRunState 没被调用（观察者没触发）
         ② data-phosphor-stop 属性本身没被摘掉（markSendState 没跑）
       这两者的修法完全不同，靠推理分不出来 —— 必须把状态读出来。
       这些变量都在 applySound 内部，所以这里放一条模块级读取通道，
       由 applySound 赋真实现。 */
    let soundStateFn = null;   /* () => { running, wasRunning, armed, contentTyping, typeBusy } */
    /* 观察者是否真的被触发过 —— 用来区分「没触发」与「触发了但状态没变」 */
    let runStateObsHits = 0;

    /* 【事件轨迹】记录最近 40 条音效相关事件。
       为什么放在模块级：fireSound（定义在 applySound 内部）也要写它，
       而模块级是两者都够得到的地方。
       为什么要它：只靠瞬时快照，拍不到「正在响」的那一刻就白跑一趟；
       有了轨迹，用户可以在 bug 出现【之后】再读，看到之前发生过什么。
       纯内存、零副作用。 */
    const soundTrace = [];
    const tracePush = (ev, extra) => {
      try {
        soundTrace.push(Object.assign({ t: Math.round(performance.now()), ev }, extra || {}));
        if (soundTrace.length > 40) soundTrace.shift();
      } catch { /* noop */ }
    };

    /* ── 街机彩蛋：开关状态 ────────────────────────────────────────────────────
       为什么必须是【模块级】而不是放进某个组件：
         · 触发者在 StatusBar（状态栏），被触发者是另一个独立组件 ——
           它们是 slot 树里两个兄弟，拿不到彼此的 props
         · 而 StatusBar 里有个每秒跑一次的时钟（setNow），整条状态栏
           每秒重渲染。把游戏塞进它内部会跟着每秒重渲染，还可能打断动画

       所以两者只共享这一个开关 + 一组订阅者。
       刻意【不】用 MutationObserver / 自定义事件：这是纯 JS 状态，
       观察 DOM 只会引入不必要的耦合。 */
    const arcadeListeners = new Set();
    let arcadeOpen = false;
    const setArcadeOpen = (next) => {
      const v = !!next;
      if (v === arcadeOpen) return;
      arcadeOpen = v;
      for (const fn of [...arcadeListeners]) { try { fn(); } catch { /* noop */ } }
    };
    const subscribeArcade = (fn) => {
      arcadeListeners.add(fn);
      return () => { arcadeListeners.delete(fn); };
    };

    /* 街机音效通道：由 applySound 赋值（fireSound 在 apply 内部）。
       与 previewFn / audioDiagFn / soundStateFn 是同一个模式 ——
       组件在 apply 之外，必须经由模块级通道才能用到内部的音频能力。 */
    let gameSoundFn = null;
    /* 街机实时状态读取器（自检用）：返回当前 stRef.current。
       为什么需要：重启是否生效，只有读到 phase 才能判断 ——
       看画面文字不可靠（HUD 会被省略号截断，这正是上一轮踩的坑）。 */
    let arcadeStateFn = null;

    /* ── 电源效果（关机 / 开机）────────────────────────────────────────────────
       为什么放模块级：触发者在 onPref（apply 内部），渲染者是 shell.overlay
       里的独立组件 —— 与街机、音效通道同一个模式（组件在 apply 之外）。

       为什么要记住上一状态：onPref 被调用时 prefs 已经是新值，
       不比对新旧值就分不清"刚关掉"还是"刚打开"。 */
    const powerListeners = new Set();
    let powerPhase = null;          /* null | off | on */
    let prevEnabled = prefs.enabled;
    const setPowerPhase = (v) => {
      powerPhase = v;
      for (const fn of [...powerListeners]) { try { fn(); } catch { /* noop */ } }
    };
    /* ── SKILL 库的开关通道 ──
       和街机同一套形状：模块级状态 + 订阅者。设置行是"按钮"，浮层面板是"订阅者"，
       两者之间不需要穿过 props。 */
    const skillLibListeners = new Set();
    let skillLibOpen = false;
    const setSkillLibOpen = (next) => {
      const v = !!next;
      if (v === skillLibOpen) return;
      skillLibOpen = v;
      for (const fn of [...skillLibListeners]) { try { fn(); } catch { /* noop */ } }
    };
    const subscribeSkillLib = (fn) => {
      skillLibListeners.add(fn);
      return () => { skillLibListeners.delete(fn); };
    };

    const subscribePower = (fn) => {
      powerListeners.add(fn);
      return () => { powerListeners.delete(fn); };
    };

    /** 订阅偏好变化；组件卸载时自动退订。 */
    function usePrefs() {
      const [snapshot, setSnapshot] = React.useState(prefs);
      React.useEffect(() => {
        const onChange = () => setSnapshot(prefs);
        listeners.add(onChange);
        return () => { listeners.delete(onChange); };
      }, []);
      return snapshot;
    }

    /* 【apply 内部 → 设置面板的通道】
       设置面板组件（TerminalAppearanceRow）定义在 apply 之外，看不到 apply 里的
       任何局部变量。所以凡是面板要用、又依赖 apply 内部状态的东西，都得经由
       这里的模块级绑定转一手。

       ★ 这里曾经漏了 audioDiag：它定义在 apply 内，面板里的按钮直接引用它，
         运行时抛 `ReferenceError: audioDiag is not defined`（点试听就报错）。
         教训：给面板加"要用到内部状态"的东西时，【必须同时加一条模块级通道】，
         否则只会在用户点击时才暴露 —— 静态语法检查看不出来。 */
    let previewFn = null;     /* 试听：由 applySound 赋 playPreview / null */
    let audioDiagFn = null;   /* 诊断：由 applySound 赋 audioDiag（返回状态摘要） */

    /* ── 临时探针：量"数学在聊天里到底被渲染成了什么" ──────────────────────
       【为什么需要它】用户报告课件里的公式显示为源码。但两条证据互相矛盾：
         · 截图显示行内 $…$ 渲染了、$$…$$ 是源码
         · 宿主源码里 mathFlow 出现 50 次（说明 $$ 应该支持）
       靠推无法分辨，必须直接量 DOM。
       本探针挂在 window 上，供用户在 Console 里手动触发。完成后会删除。 */
    if (DEBUG_ON && typeof window !== 'undefined') {
      window.__phMathProbe = () => {
        const out = [];
        const q = (s) => document.querySelectorAll(s).length;
        out.push({
          位置: '总数',
          katex: q('.katex'),
          katexDisplay: q('.katex-display'),
          katexError: q('.katex-error'),
          katexMathml: q('.katex-mathml'),
        });
        /* 找含"测试"字样的块，看它内部的 HTML 结构 —— 这是关键证据：
           若 $$ 被当作数学，块内会有 .katex-display；
           若没被当作数学，$$ 会作为文本出现在 textContent 里。 */
        const blocks = [...document.querySelectorAll('p, div, li, pre, code')]
          .filter((e) => /测试[ABC]/.test(e.textContent || ''))
          .slice(0, 12);
        for (const el of blocks) {
          const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const hasDollar = /\$\$/.test(txt);
          out.push({
            标签: el.tagName + (el.className ? '.' + String(el.className).split(' ')[0].slice(0, 24) : ''),
            文本前40: txt.slice(0, 40),
            含双美元: hasDollar,
            内含katex: el.querySelectorAll('.katex').length,
            内含display: el.querySelectorAll('.katex-display').length,
            内含error: el.querySelectorAll('.katex-error').length,
          });
        }
        /* 再单独看每一个 .katex-error —— 它的 title 就是解析错误原文 */
        [...document.querySelectorAll('.katex-error')].slice(0, 5).forEach((e, i) => {
          out.push({ 错误: i + 1, title: (e.getAttribute('title') || '').slice(0, 160), text: (e.textContent || '').slice(0, 60) });
        });
        /* 以及每个 .katex-display 的尺寸（看是否溢出/被裁） */
        [...document.querySelectorAll('.katex-display')].slice(0, 5).forEach((d, i) => {
          const r = d.getBoundingClientRect();
          out.push({ display: i + 1, 宽: Math.round(r.width), 内容宽: d.scrollWidth, overflowX: getComputedStyle(d).overflowX });
        });
        console.table(out);
        return out;
      };
      console.log('[phosphor] 数学探针已就位：在 Console 里执行  __phMathProbe()');
    }

    /* ── 本地化 ────────────────────────────────────────────────────────────
       【locale/*.json 曾是一份死资源】：package.json 里声明了，但代码零引用 ——
       文件里写着双语 meta，界面却全是硬编码中文。
       两种正经做法二选一，这里选"接上"而不是"删掉"：
         ctx.locale.register(NS, locale, dict)  注册词典
         ctx.locale.bind(NS)                    取得翻译函数（调用时读当前 locale）
       语言切换时【不需要自己订阅】—— 宿主会重渲染 slot（它按 locale 的 revision 走）。

       词典键名用语义化的点分键，与宿主其它插件的风格一致（如 settings.agentPreset）。
       NS 用 'phosphor'：它同时是 slot 的 locale 命名空间标识。 */
    const LOCALE_NS = 'phosphor';

    const DICT_EN = {
      'general.title': 'Terminal appearance',
      'group.enhance': 'B · Enhance',
      'group.extreme': 'C · Extreme',
      'group.sound': 'E · Sound',
      'section.intensity': 'Intensity',

      'opt.glow': 'Neon glow',
      'opt.scan': 'Scanlines + vignette',
      'opt.statusbar': 'Bottom status bar',
      'opt.boot': 'Boot self-test',
      'opt.crt': 'CRT curvature',
      'opt.glitch': 'Glitch jitter',
      'opt.typew': 'Typewriter entrance',
      'opt.ascii': 'ASCII ornament',
      'opt.startReset': 'Turn start · reset tone',
      'opt.startType': 'Turn start · typing clicks',
      'opt.soundEnd': 'Turn end chime',
      'opt.sessionSound': 'Session switch click',
      'opt.endReset': 'Reset after chime',

      'slide.scanLine': 'Scanline density',
      'slide.glowPower': 'Glow strength',
      'slide.vignette': 'Vignette strength',
      'slide.soundVolume': 'Sound intensity',
      'slide.typeSpeed': 'Typewriter speed',

      'preview.button': '▶ Preview',
      'preview.title':
        'Play a demo: reset → typing ×3 → switch → chime → reset\nStatus: ',
      'preview.disabled': 'Turn on at least one sound option first',
      'preview.noAudio': 'audio engine not ready  vol=',
    };

    const DICT_ZH = {
      'general.title': '终端外观',
      'group.enhance': 'B · 增强',
      'group.extreme': 'C · 极致',
      'group.sound': 'E · 音效',
      'section.intensity': '强度',

      'opt.glow': '霓虹发光（现状：全局）',
      'opt.scan': '扫描线 + 暗角',
      'opt.statusbar': '底部状态栏',
      'opt.boot': '启动自检序列',
      'opt.crt': 'CRT 曲率',
      'opt.glitch': '故障抖动',
      'opt.typew': '打字机式入场',
      'opt.ascii': 'ASCII 装饰',
      'opt.startReset': '回合开始·复位音',
      'opt.startType': '回合开始·打字音',
      'opt.soundEnd': '回合结束音（叮）',
      'opt.sessionSound': '切换会话音',
      'opt.endReset': '结束音后接复位',

      'slide.scanLine': '扫描线浓淡',
      'slide.glowPower': '发光强度',
      'slide.vignette': '暗角强度',
      'slide.soundVolume': '音效强度',
      'slide.typeSpeed': '打字机速度',

      'preview.button': '▶ 试听',
      'preview.title':
        '播放一段演示：复位 → 打字 ×3 → 切换 → 叮 → 复位\n当前状态：',
      'preview.disabled': '先打开至少一个音效开关',
      'preview.noAudio': '音效未建立  vol=',
    };

    /* 面板的翻译函数。默认是"原样返回键"的兜底 ——
       这样即使 locale 服务缺失，界面也只是显示键名而不会崩。
       apply 里会把它换成 ctx.locale.bind(NS) 的真翻译函数。 */
    let tr = (key) => key;

    /* locale 词典是否已注册过。
       【必须挂在 window 上，不能用模块级变量】实测结论：
       HMR 会【重新求值整个模块】，所以模块级变量的初始值每次都会重置回 false ——
       我原先就是这么写的，结果守卫完全不生效，每次重载仍去打 register，
       然后被服务的"同一 (ns, locale) 不允许重复注册"拒绝并刷警告。
       window 才是跨重载真正保留状态的地方（本文件其它地方也用过这个办法，
       例如启动序列的"本会话是否已播放过"标记）。 */
    const localeRegKey = '__phosphorLocaleRegistered';
    const isLocaleRegistered = () => {
      try { return window[localeRegKey] === true; } catch { return false; }
    };
    const markLocaleRegistered = () => {
      try { window[localeRegKey] = true; } catch { /* noop */ }
    };

    const clampPct = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(200, Math.max(0, n)) : fallback;
    };

    /* ------------------------------------------------------------------ *
     * 令牌层 —— 14 个语义 token（亮/暗双值）+ 按强度缩放的装饰变量。
     *    对比度按 WCAG 核算：暗色正文 #00d977 on #04070a ≈ 8.6:1。
     * ------------------------------------------------------------------ */
    const SEMANTIC = {
      '--dsw-alias-bg-base':               { light: '#f4f6f3', dark: '#04070a' },
      '--dsw-alias-bg-layer-1':            { light: '#ffffff', dark: '#080d10' },
      '--dsw-alias-bg-layer-2':            { light: '#eef1ec', dark: '#0b1317' },
      '--dsw-alias-bg-overlay':            { light: '#ffffff', dark: '#0d191d' },
      '--dsw-alias-border-l1':             { light: '#cfd8d0', dark: '#10352a' },
      '--dsw-alias-border-l2':             { light: '#9fb3a6', dark: '#1d6b4a' },
      '--dsw-alias-brand-primary':         { light: '#00794a', dark: '#00ff9c' },
      '--dsw-alias-label-primary':         { light: '#0b3b28', dark: '#00d977' },
      '--dsw-alias-label-secondary':       { light: '#3f6b57', dark: '#12a35f' },
      '--dsw-alias-state-error-primary':   { light: '#c62828', dark: '#ff4d4d' },
      '--dsw-alias-state-warn-primary':    { light: '#b26a00', dark: '#ffb000' },
        /* warn-label：状态栏活动指示灯（RUN）用它。
           这一条原先缺失 —— 我只覆盖了 warn-primary，而灯需要的是 label 这一档，
           于是它一直显示宿主的原色（等于不受主题控制）。
           实测宿主确实有这个名字（asar 里 warn 系列共 4 个），所以不是名字写错，
           只是漏了覆盖。暗色取比 primary 更亮的琥珀 —— 它是"小面积的灯"，
           需要更高明度才能在深底上被余光看见。 */
        '--dsw-alias-state-warn-label':  { light: '#96590a', dark: '#ffc247' },
      '--dsw-alias-state-success-primary': { light: '#0f7a4a', dark: '#00e07a' },
      '--dsw-alias-state-idle-primary':    { light: '#8fa79a', dark: '#0a5c3d' },
      /* 【必须补】business 色调不经静态色板也能单独修。
         宿主暗色下 --dsw-alias-state-business-primary: var(--dsw-static-deepseek-400)
         = #7aaaff（蓝），而它正是输入光标的颜色：
           ui-conversation  .<hash>_input { caret-color: var(--dsw-alias-state-business-primary) }
         也用于宿主默认焦点环（focus.css 中 :focus-visible 的 outline-color 兜底）。
         此前没注册这一条 → 「调色板已经全绿」的判断漏了它，光标一直是蓝的。 */
      '--dsw-alias-state-business-primary': { light: '#00794a', dark: '#00ff9c' },
      '--dsw-specific-sidebar-fill':       { light: '#eaeeea', dark: '#030608' },
      /* 以下三个不在运行时提供的 14 个里，但界面的灰暗文字、分隔细线、选区
         都会用到它们（ui-layout 就用了 border-l3）。不覆盖就会回退到宿主默认色，
         在暗色主题下明显偏亮偏灰 —— 这正是插件版和预览页观感不一致的主因之一。

         tertiary 暗值取 #1d9e68 而非预览页的 #0a6b41：预览页那个值在真实气泡
         背景（#18251f）上只有 2.4:1，低于 3:1 的可读下限，日期/提示这类小字
         会真的看不清。#1d9e68 在气泡上约 3.7:1、在根背景上约 4.4:1，
         既保持「比次要字更暗」的层级，又守住了可读性。 */
      '--dsw-alias-label-tertiary':        { light: '#5d8473', dark: '#1d9e68' },
      '--dsw-alias-border-l3':             { light: '#dde4dd', dark: '#0d2b22' },
      '--ph-selection':                    { light: 'rgba(0, 121, 74, .18)', dark: 'rgba(0, 217, 119, .22)' },
    };

    /* 强度基准值 = 预览页的设计基准。100% 即设计强度，滑块按倍数缩放。
       ------------------------------------------------------------------
       【这段注释记录一次错误，供日后不要重犯】
       用户曾反馈"强度调到十几屏幕就被盖满"，当时据此把基准值整体压到 35%，
       让它"100% = 舒适值"。后来实测发现真正原因是【覆盖层叠加了 89 层】
       （见 §6.2b 的幂等清理），有效强度是设计值的 89 倍 ——
       也就是说那次"调参"是在给一个乘法错误做除法，方向完全错了。
       现已撤回全部标定，恢复设计基准。

       教训（写给以后的自己）：当观感"偏强/偏弱"时，先【定量测量】
       （层数、有效不透明度），再决定是调系数还是修结构。
       沿错误前提连续调参，只会越调越远，还会把正确的基础值改坏。 */
    const BASE = {
      scanDark:  { r: 0, g: 255, b: 156, a: 0.035 },
      scanLight: { r: 0, g: 121, b: 74,  a: 0.030 },
      glowBlur: 6, glowAlpha: 0.45,
      softBlur: 10, softAlpha: 0.22,
      vigLight: 0.10, vigDark: 0.50,
      crtLightA: 0.14, crtLightB: 0.09,
      crtDarkA: 0.55,  crtDarkB: 0.35,
    };

    const rgba = (c, a) => `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;

    /* ------------------------------------------------------------------ *
     * 底层变量组：以【内联样式】写到 <html> 上，不走样式表。
     *
     * 为什么必须内联：base.css（ui-theme）也在 :root 上定义了同名变量。
     * 我先前把覆盖写在 :root[data-phosphor] 里（特异性更高），但实测没赢下来，
     * 说明还有更靠后的同名来源或层叠层次在起作用。内联样式优先级最高，
     * 直接绕开整个级联问题，这是这类「必须生效」的底层变量唯一可靠的做法。
     *
     * 副作用：卸载时需要逐条 removeProperty，见 cleanup。
     * ------------------------------------------------------------------ */

    /* 排版节奏 —— 从预览页移植过来。这是「预览页读起来更好」的实质所在。
       ----------------------------------------------------------------------
       DSH 自己定义了整条行高链：
         body{ --dsh-content-font-delta: calc(var(--dsh-content-font-size,14px) - 14px) }
         正文行高 = calc(22px + var(--dsh-content-font-delta))
         标题字号 = calc(21px + var(--dsh-content-font-delta)) 等等
       也就是说，改这一个 delta 就能整体收紧版式，而【不必夺走用户的字号设置】
       —— 这点很重要：字号是用户在「设置 › 通用 › 字号」里的偏好，主题不该覆盖它。

       预览页基准：13px × 1.62 ≈ 21.06px 行高，而宿主默认 14px → 22px（1.571）。
       取 delta = -1px → 21px，与预览页的疏密一致。

       【两条变量都必须走令牌层，不能内联到 <html>】
       实测证据（用户 Console）：
         ① body 上的色板:  #2c2c2e   ← 宿主灰
         ② html 上的色板:  #18251f   ← 我写的绿，但被 body 自身的声明挡住
         ③ 行高变量:       calc(14px - 14px)  ← 实算 0，我想要的 -1px 没生效
       宿主把 --dsh-content-font-delta 声明在 body{} 上（gradient-shadow-text.css），
       CSS 自定义属性虽继承，但【元素自身的声明压过继承来的值】—— 写在 <html> 上无效。
       官方 overrideTokens 的通道由宿主把结果写到 body 内联样式上，稳赢。
       见下方 buildTokens 的 TYPO_TOKENS。 */

    /* 圆角刻度 → 完全方角。
       base.css 原值：xs:4 sm:8 md:12 lg:16 xl:20 panel:28。
       用户消息气泡用 var(--dsw-radius-xl)，原值 20px。整体替换刻度而非给气泡
       打补丁：全站 26 处引用一起变，气泡、输入框、卡片、菜单统一成终端方角。

       取值经实测校正：全部归零时用户确认观感正确；此前回调成 2-10px
       「细微圆角」后仍被判断为圆 —— 说明在这套界面上 2px 配合基础主题的
       corner-shape: superellipse 已足以呈现圆角感。故一律取 0，
       不再留任何「细微圆角」的余地。 */
    const RADIUS_SCALE = {
      '--dsw-radius-xs':    '0px',
      '--dsw-radius-sm':    '0px',
      '--dsw-radius-md':    '0px',
      '--dsw-radius-lg':    '0px',
      '--dsw-radius-xl':    '0px',
      '--dsw-radius-panel': '0px',
    };

    /* 静态色板替换 —— 整套主题一致性的关键。
       DSH 调色板两层：--dsw-static-*（颜色源，带具体色值）→ 上百个
       --dsw-alias-* / --dsw-specific-*（全部由静态色板派生）。
       例：--dsw-specific-bubble → var(--dsw-static-neutral-bluish-850)
           --dsw-alias-bg-base  → var(--dsw-static-neutral-bluish-950)
       只覆盖别名层时，界面其余上百个别名仍在用宿主中性冷灰，于是
       「气泡是灰的、浮层是灰的、分隔线是灰的」。静态色板亮暗共用一套数值，
       所以只需覆写一次。色相统一取品牌绿 H=152.9°，层级与原始梯级一一对应，
       对比度已逐项核算（12 项全部 ≥4.5:1）。 */
    const STATIC_PALETTE = {
      '--dsw-static-neutral-bluish-1000': '#050a08',
      '--dsw-static-neutral-bluish-950':  '#080e0b',
      '--dsw-static-neutral-bluish-900':  '#0e1612',
      '--dsw-static-neutral-bluish-875':  '#131e1a',
      '--dsw-static-neutral-bluish-850':  '#18251f',
      '--dsw-static-neutral-bluish-800':  '#21302a',
      '--dsw-static-neutral-bluish-750':  '#2f4139',
      '--dsw-static-neutral-bluish-700':  '#43564d',
      '--dsw-static-neutral-bluish-600':  '#5b7167',
      '--dsw-static-neutral-bluish-500':  '#789186',
      '--dsw-static-neutral-bluish-400':  '#9baba4',
      '--dsw-static-neutral-bluish-300':  '#c2cbc7',
      '--dsw-static-neutral-bluish-200':  '#dee3e1',
      '--dsw-static-neutral-bluish-150':  '#e8ebe9',
      '--dsw-static-neutral-bluish-100':  '#eff0f0',
      '--dsw-static-neutral-bluish-75':   '#f3f4f4',
      '--dsw-static-neutral-bluish-60':   '#f6f6f6',
      '--dsw-static-neutral-bluish-50':   '#f8f9f9',
      '--dsw-static-neutral-bluish-00':   '#ffffff',
      '--dsw-static-deepseek-50':  '#edfaf3',
      '--dsw-static-deepseek-100': '#d9f4e6',
      '--dsw-static-deepseek-200': '#b0e9cf',
      '--dsw-static-deepseek-300': '#7adcb2',
      '--dsw-static-deepseek-400': '#35c68c',
      '--dsw-static-deepseek-450': '#00b478',
      '--dsw-static-deepseek-500': '#00a86e',
      '--dsw-static-deepseek-600': '#00875a',
      '--dsw-static-deepseek-800': '#10402f',
      '--dsw-static-deepseek-900': '#0d2b21',
      '--dsw-static-blue-50':  '#eefaf4',
      '--dsw-static-blue-75':  '#e2f6ec',
      '--dsw-static-blue-100': '#d3f2e3',
      '--dsw-static-blue-300': '#8fdcb8',
      '--dsw-static-blue-400': '#4ccc96',
      '--dsw-static-blue-450': '#22c07f',
      '--dsw-static-blue-500': '#00b478',
      '--dsw-static-blue-600': '#009463',
      '--dsw-static-blue-800': '#0d5c40',
      '--dsw-static-blue-900': '#0a4330',
      '--dsw-static-blue-950': '#07301f',

      /* neutral 灰阶族 —— 早先漏掉的一族，导致附件按钮底色仍是原灰 rgb(53,54,56)。
         它不叫 neutral-bluish，是独立的一套中性色，被按钮/浮层等直接引用。
         映射方式与 bluish 族一致：色相统一到品牌绿，明度沿用原始层级（单调）。
         这一族偏中性，饱和度取得比 bluish 更克制。 */
      '--dsw-static-neutral-1000': '#000000',
      '--dsw-static-neutral-900':  '#0d110f',
      '--dsw-static-neutral-850':  '#1d2723',
      '--dsw-static-neutral-800':  '#22302a',
      '--dsw-static-neutral-700':  '#33463d',
      '--dsw-static-neutral-600':  '#4d5e56',
      '--dsw-static-neutral-550':  '#5e7269',
      '--dsw-static-neutral-500':  '#778f84',
      '--dsw-static-neutral-400':  '#9fa9a5',
      '--dsw-static-neutral-300':  '#d1d7d4',
      '--dsw-static-neutral-250':  '#dadedc',
      '--dsw-static-neutral-200':  '#e3e7e5',
      '--dsw-static-neutral-150':  '#eceeed',
      '--dsw-static-neutral-100':  '#f5f5f5',
      '--dsw-static-neutral-50':   '#fafafa',
      '--dsw-static-neutral-00':   '#ffffff',
    };

    /* 只有圆角刻度真正适合内联到 <html>。
       ----------------------------------------------------------------------------
       宿主 base.css 的原文是 :root{ …--dsw-radius-xs:4px;… --dsw-radius-panel:28px }，
       变量就声明在 <html>（:root）上，内联稳赢 —— 这也是方角一直成功的唯一原因。

       而静态色板与两个 --dsh-* 变量声明在 body{} 上，内联到 <html> 会被 body
       自身的声明压过（实测 ② 有值、① 却是宿主值）。它们改走令牌层，见下方。 */
    const INLINE_VARS = { ...RADIUS_SCALE };

    /* 静态色板 → 令牌层。
       ----------------------------------------------------------------------------
       validateOverrides 只校验"值必须是 { light, dark } 双字符串"，【不限名字】，
       所以 56 条 --dsw-static-* 可以走官方通道。宿主 ThemePresenter 会把合成结果
       写到 body 的内联样式上，层级、!important、时序问题一次全部消失。

       浅色与深色取同一个值：这 56 条是按深色磷光绿调出来的，
       浅色模式下宿主另有自己的浅色色板；两者共用一份是本主题既有的行为，
       本次只改"送不到的通道"，不改配色取值。 */
    const PALETTE_TOKENS = Object.fromEntries(
      Object.entries(STATIC_PALETTE).map(([name, value]) => [name, { light: value, dark: value }]),
    );

    /* 两个 --dsh-* 变量也走令牌层（原因同上：宿主声明在 body 上）。
       --dsh-content-font-delta 保留"跟随用户字号"的特性：
       不写死 -1px，而是把宿主的公式整体下移一档。 */
    const TYPO_TOKENS = {
      '--dsh-content-font-delta': {
        light: 'calc(var(--dsh-content-font-size, 14px) - 15px)',
        dark:  'calc(var(--dsh-content-font-size, 14px) - 15px)',
      },
    };

    /* CRT 相对暗角的强度比。
       ------------------------------------------------------------------
       原先 CRT 与暗角共用 vig 系数，两者绑死：用户把「暗角强度」调小时，
       CRT 的黑边被迫一起变淡，反之亦然，无法单独控制。
       现在给 CRT 一个独立倍率：两者仍由同一个滑块驱动，但可按各自需要的
       比例缩放 —— 暗角负责"边缘压暗"，CRT 负责"显像管四角的收束感"，
       后者本就应该比前者轻。 */
    const CRT_SCALE = 0.45;

    /* ── 磷光色（P1 绿 / P3 琥珀 / P4 白）──────────────────────────────────────
       这个主题叫 PHOSPHOR —— 而"磷光"本来就是三种颜色：P1 绿、P3 琥珀、P4 白，
       是老式单色显示器真实存在的三种荧光粉型号。所以这不是硬塞的梗，
       是主题名字的来源。

       【实现方式：色相变换，而不是手写三套色板】
         手写三套要 45+ 组十六进制值，改一处就得同步三处，必然漂移。
         这里只做一件事：把"绿色家族"的色相替换成目标色相，明度/饱和度沿用原值 ——
         于是三种色调天然保持同一套层级关系。

       【P1 是恒等变换】选了 P1 就完全走原来的路径，一个字节都不变。
         这保证了"这个功能不可能把现在的观感改坏"。

       【哪些颜色不参与变换】
         · 中性色/深色背景（色相不在 90~195）—— 黑底在琥珀/白色显示器上也是黑底
         · 错误色（红）—— 语义色不该被主题化
         · P4 下的警告色 —— 保持彩色，为的是在去饱和的环境里仍然醒目
       【P3 下警告色会被推开】琥珀主题里 warning(#ffb000) 和品牌琥珀几乎同色，
         所以 P3 把警告族的色相推到偏红(6°)，保证"警告"仍然读得出来。 */
    const TONE_SPECS = {
      p1: null,                        /* 恒等：不走任何变换 */
      /* 琥珀：色相 36°，略微提亮（不提亮会偏棕）。
         warnHue 把警告族推到偏红 —— 否则警告色和品牌琥珀几乎同色，
         "警告"就失去意义了。 */
      p3: { hue: 36, warnHue: 6, lLift: 0.10 },
      /* 白：几乎去饱和（留 8% 冷调，纯灰会显得脏）。
         lLift 0.4 是关键 —— 白磷光显示器是"亮白"，不抬亮度就会变成暗灰，
         而暗灰黑底上的可读性会明显差于现在的绿。 */
      p4: { hue: 150, sat: 8, lLift: 0.40 },
    };

    const _hexToHsl = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
      if (!m) return null;
      const n = parseInt(m[1], 16);
      const r = ((n >> 16) & 255) / 255;
      const g = ((n >> 8) & 255) / 255;
      const b = (n & 255) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h = 0;
      let s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      return { h, s: s * 100, l: l * 100 };
    };

    const _hslToHex = (h, s, l) => {
      const hh = ((h % 360) + 360) % 360;
      const ss = Math.max(0, Math.min(100, s)) / 100;
      const ll = Math.max(0, Math.min(100, l)) / 100;
      const c = (1 - Math.abs(2 * ll - 1)) * ss;
      const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
      const m = ll - c / 2;
      let r = 0; let g = 0; let b = 0;
      if (hh < 60) { r = c; g = x; }
      else if (hh < 120) { r = x; g = c; }
      else if (hh < 180) { g = c; b = x; }
      else if (hh < 240) { g = x; b = c; }
      else if (hh < 300) { r = x; b = c; }
      else { r = c; b = x; }
      const to2 = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
      return '#' + to2(r) + to2(g) + to2(b);
    };

    const _rgbOf = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };

    /* 把一个颜色按色调规则变换。tone 为 p1（或未知）时原样返回。 */
    const toneHex = (hex, tone) => {
      const spec = TONE_SPECS[tone] || null;
      if (!spec) return hex;
      const hsl = _hexToHsl(hex);
      if (!hsl) return hex;
      const isGreen = hsl.h >= 90 && hsl.h <= 195;
      const isWarnAmber = hsl.h >= 25 && hsl.h <= 55 && hsl.s >= 40;
      if (!isGreen && !(spec.warnHue !== undefined && isWarnAmber)) return hex;
      const hue = isGreen ? spec.hue : spec.warnHue;
      const sat = (spec.sat !== undefined) ? spec.sat : hsl.s;
      /* 亮度按比例向白抬：保留原有的明暗层级（暗的仍然暗），只是整体上移。
         加法抬升会把边框和背景一起推亮、层级被压平，所以用比例式。 */
      const lift = spec.lLift || 0;
      const lightness = hsl.l + (100 - hsl.l) * lift;
      return _hslToHex(hue, sat, lightness);
    };

    /* 把 rgb 对象按色调变换后拼成 rgba() —— 用于 glow/vignette/crt 这些
       必须带透明度的派生值（它们原本硬编码了品牌绿的 rgb）。 */
    const toneRgba = (rgb, alpha, tone) => {
      const hex = '#' + [rgb.r, rgb.g, rgb.b]
        .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
        .join('');
      const out = _rgbOf(toneHex(hex, tone)) || rgb;
      return 'rgba(' + out.r + ', ' + out.g + ', ' + out.b + ', ' + alpha + ')';
    };

    function buildTokens(p) {
      const scan = clampPct(p.scanLine, 100) / 100;
      const glow = clampPct(p.glowPower, 100) / 100;
      const vig  = clampPct(p.vignette, 100) / 100;
      /* CRT 用解绑后的倍率，不再与暗角同系数 */
      const crt  = vig * CRT_SCALE;
      /* 磷光色。p1 时 toneHex 是恒等函数 —— 默认路径与以前逐字节相同。 */
      const tone = p.tone || 'p1';

      /* 把 { light, dark } 双值的令牌表整体过一遍色调变换。
         只处理 light/dark 都是字符串的条目，其它（字体等）原样透传。 */
      const mapModes = (src) => {
        const out = {};
        for (const key of Object.keys(src)) {
          const v = src[key];
          if (v && typeof v === 'object'
              && typeof v.light === 'string' && typeof v.dark === 'string') {
            out[key] = { light: toneHex(v.light, tone), dark: toneHex(v.dark, tone) };
          } else {
            out[key] = v;
          }
        }
        return out;
      };

      const semantic = mapModes(SEMANTIC);
      const palette = mapModes(PALETTE_TOKENS);

      /* 【派生色也要跟着变】扫描线 / 光晕 / 暗角 / CRT 阴影原本硬编码了
         品牌绿的 rgb 字面量（例如 rgba(0, 255, 156, …)）。如果只换令牌表，
         琥珀主题就会亮着绿光、扫着绿线 —— 那是最难看的一种半成品。
         所以这里从【变换后】的令牌反推这几个颜色。 */
      const brandL = _rgbOf(semantic['--dsw-alias-brand-primary'].light) || BASE.scanLight;
      const brandD = _rgbOf(semantic['--dsw-alias-brand-primary'].dark) || BASE.scanDark;
      const labelL = _rgbOf(semantic['--dsw-alias-label-primary'].light) || { r: 11, g: 59, b: 40 };
      const labelD = _rgbOf(semantic['--dsw-alias-label-primary'].dark) || { r: 0, g: 217, b: 119 };

      return {
        ...semantic,
        ...palette,
        ...TYPO_TOKENS,
        '--ph-scan-line': {
          light: rgba(brandL, BASE.scanLight.a * scan),
          dark:  rgba(brandD,  BASE.scanDark.a  * scan),
        },
        '--ph-glow': {
          light: glow > 0 ? `0 0 ${BASE.glowBlur * glow}px rgba(${brandL.r}, ${brandL.g}, ${brandL.b}, ${BASE.glowAlpha * glow})` : 'none',
          dark:  glow > 0 ? `0 0 ${BASE.glowBlur * glow}px rgba(${brandD.r}, ${brandD.g}, ${brandD.b}, ${BASE.glowAlpha * glow})` : 'none',
        },
        '--ph-glow-soft': {
          light: glow > 0 ? `0 0 ${BASE.softBlur * glow}px rgba(${brandL.r}, ${brandL.g}, ${brandL.b}, ${BASE.softAlpha * glow})` : 'none',
          dark:  glow > 0 ? `0 0 ${BASE.softBlur * glow}px rgba(${labelD.r}, ${labelD.g}, ${labelD.b}, ${BASE.softAlpha * glow})` : 'none',
        },
        '--ph-vignette': {
          light: `radial-gradient(120% 100% at 50% 45%, transparent 55%, rgba(${labelL.r}, ${labelL.g}, ${labelL.b}, ${(BASE.vigLight * vig).toFixed(4)}) 100%)`,
          dark:  `radial-gradient(120% 100% at 50% 45%, transparent 42%, rgba(0, 0, 0, ${(BASE.vigDark * vig).toFixed(4)}) 100%)`,
        },
        '--ph-crt-shadow': {
          light: `inset 0 0 90px rgba(${labelL.r}, ${labelL.g}, ${labelL.b}, ${(BASE.crtLightA * crt).toFixed(4)}), inset 0 0 24px rgba(${labelL.r}, ${labelL.g}, ${labelL.b}, ${(BASE.crtLightB * crt).toFixed(4)})`,
          dark:  `inset 0 0 90px rgba(0, 0, 0, ${(BASE.crtDarkA * crt).toFixed(4)}), inset 0 0 24px rgba(0, 0, 0, ${(BASE.crtDarkB * crt).toFixed(4)})`,
        },
      };
    }

    /* ------------------------------------------------------------------ *
     * 装饰层样式表。只用自有 .ph-* 类名与 --dsw-alias-* / --ph-* 变量，
     * 不触碰其它插件的样式与 DOM。
     * ------------------------------------------------------------------ */
    const CSS = `
:root[data-phosphor] {
  --ph-mono: "JetBrains Mono", "IBM Plex Mono", "Cascadia Mono", Consolas,
             "Sarasa Mono SC", "Microsoft YaHei UI", ui-monospace, monospace;
  --ph-statusbar-h: 22px;
  /* 数字等宽：状态栏时钟、token 计数、轮次步数这类数值会随内容变化，
     等宽数字可避免整行左右抖动。挂在 :root 上让全站继承（与本主题此前
     的写法一致）。 */
  font-variant-numeric: tabular-nums;
  /* 圆角刻度与静态色板【不在这里】：它们在 base.css 中也有同名定义，
     写在样式表里赢不下来，改为在 apply 中以内联样式写到 <html> 上
     （见 RADIUS_SCALE / STATIC_PALETTE / INLINE_VARS）。
     本段注释不得出现反引号，否则会提前结束这个模板字符串。 */
}
/* 1. 等宽字体：只改展示字体，不动字号，避免打乱既有排版节奏 */
:root[data-phosphor] body,
:root[data-phosphor] button,
:root[data-phosphor] input,
:root[data-phosphor] textarea,
:root[data-phosphor] select {
  font-family: var(--ph-mono);
  font-variant-ligatures: none;
  font-feature-settings: "calt" 0, "liga" 0;
}

/* 1b. 选区配色：预览页有、上一版插件漏了 —— 用宿主默认选中色会明显出戏 */
:root[data-phosphor] ::selection {
  background: var(--ph-selection, rgba(0, 217, 119, .22));
}

/* 2. 滚动条：方角、细、随边框色 */
:root[data-phosphor] ::-webkit-scrollbar { width: 10px; height: 10px; }
:root[data-phosphor] ::-webkit-scrollbar-track { background: transparent; }
:root[data-phosphor] ::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-border-l1);
  border: 2px solid var(--dsw-alias-bg-base);
  border-radius: 0;
}
:root[data-phosphor] ::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-border-l2); }

/* 2b.（已移除）
   上一版这里有一条只作用于 button / input / textarea / select 的
   border-radius: 0 补丁规则。它有两个问题：
     1. 只认标签选择器，而用户气泡是 div —— 所以气泡仍然是圆的，
        用户看到的正是这个结果；
     2. 它与上面替换过的 --dsw-radius-* 刻度属于两套机制，并存会互相打架。
   现在圆角统一由刻度管理，这里不再需要任何补丁。
   注意：本段与下文所有注释都不得出现反引号，它会提前结束这个模板字符串。 */

/* 2c.（已合并进上面的 :root[data-phosphor] 块）
       等宽数字：时间戳、token 计数、行号、耗时不再随数字宽度跳动 ——
       终端质感的一部分，且零风险（只影响数字字形宽度）。
       合并原因：同一选择器重复出现会让"哪个块管什么"变难追，
       审计时也会被当成可疑点。属性本身不冲突，纯粹是可读性问题。 */

/* 3. 霓虹发光：只给激活/悬停/聚焦元素，静态正文永不发光 */
:root[data-phosphor][data-phosphor~="glow"] :focus-visible {
  outline: 1px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
  box-shadow: var(--ph-glow);
}
:root[data-phosphor][data-phosphor~="glow"] input:focus,
:root[data-phosphor][data-phosphor~="glow"] textarea:focus,
:root[data-phosphor][data-phosphor~="glow"] [contenteditable="true"]:focus {
  box-shadow: var(--ph-glow-soft);
}

/* 3b. 绿框统一 —— 只在「当前所在的区域」高亮。
   ============================================================================
   输入卡片那套「品牌绿包边 + 柔光」推广到全站，但【只标记状态，不标记焦点】。

   【为什么撤掉了 :focus 那一版】
   起初写的是「任何可交互元素聚焦时都套一圈绿环」，
   选择器里有 button / a[href] / [role="button"] / [role="tab"] / [tabindex]。
   实测反馈：对话与轨迹区域也被套上了绿框 —— 那些面板常带 tabindex / role=tab，
   于是"点到哪里哪里出一圈绿框"，既吵又不是本意。
   用户的要求是：**哪个部分被选中，就高亮哪个部分**。
   因此去掉 :focus 版本，只保留【选中/激活】这一种触发条件。

   【触发条件只认状态属性】
   aria-selected / data-active / aria-current / [data-state="active"] ——
   这些是"当前所在"的语义标记，切换标签、选中列表项、展开面板时自动变化，
   不依赖用户点在哪。键盘可见性由第 3 节的 :focus-visible（outline）保证，
   两者互补：outline 管"焦点在哪"，绿环管"当前处在哪个部分"。

   【为什么用 inset 环而不是 border】
   输入卡片本来就有 1px 边框，改它的 border-color 即可。但标签、列表项、
   面板按钮这些【没有边框】—— 给它们临时加 border 会让元素宽高变化、整行重排
   （这正是之前按钮 hover 抖动的原因）。
   box-shadow 的 inset 环不占布局空间，且自动跟随元素的 border-radius。

   环宽取 2px：1px 的 inset 环在密集区域会被内容视觉上吃掉，
   2px 与卡片那圈 1px 描边 + 柔光叠加后的视觉重量相当。 */

/* 3b. 当前所在的区域 —— 用【文字高亮】表达，不用绿框。
   ============================================================================
   来由（两次修正的最终结论）：
   ① 起初写成「任何可交互元素聚焦时套绿环」，选择器含 button / a[href] /
      [role="tab"] / [tabindex]，结果对话与轨迹面板到处出绿框。
   ② 改为只认状态属性后，范围对了，但用户实测截图显示：绿框套在
      「对话 / 轨迹」这类标签文字上，2px 的环几乎贴住字，显得又窄又挤。

   【为什么最终放弃绿框、改用文字高亮】
   环的宽窄取决于宿主给该元素多少 padding —— 那是宿主的样式，我改不了。
   2px 贴字、3px 可能溢出内容区，在标签类元素上无论取哪个值都不对。
   而文字高亮（颜色 + 辉光 + 字重）不依赖 padding，在任何元素上观感都成立，
   也正好符合「哪个部分在，哪个部分高亮」的诉求。

   顺带：这一条与第 3 节末尾的 text-shadow 规则合并到一处，避免同一选择器
   分散在两处（此前那一处只加了辉光，没有变字色，对比不足）。 */
:root[data-phosphor] :is(
  [aria-selected="true"],
  [aria-current="true"],
  [aria-current="page"],
  [aria-current="step"],
  [data-active="true"],
  [data-state="active"]
):not([data-phosphor-composer]) {
  /* 未开启辉光时也要有足够对比：字色本身就足以区分 */
  color: var(--dsw-alias-brand-primary);
}
:root[data-phosphor][data-phosphor~="glow"] :is(
  [aria-selected="true"],
  [aria-current="true"],
  [aria-current="page"],
  [aria-current="step"],
  [data-active="true"],
  [data-state="active"]
):not([data-phosphor-composer]) {
  /* 辉光 + 轻微字重，让"当前项"在不加框的前提下依然立得住 */
  text-shadow: var(--ph-glow);
  font-weight: 600;
}
/* 3c. 悬停绿框 —— 把输入框聚焦那种"绿框"模式推广到全站的交互元素。
   ============================================================================
   【这一段的历史，说明为什么要"排除"而不是"全加"】
   ① 最初写成"任何可交互元素聚焦时套绿环"，选择器含 [tabindex] / [role="tab"]，
      结果对话与轨迹面板到处出框 —— 太宽。
   ② 改成只认"选中状态"属性后，范围对了，但用户实测截图显示：
      绿框套在「对话 / 轨迹」这类【标签】上，2px 的环几乎贴住文字，又窄又挤。
   ③ 于是一度把框整个删掉、改用文字高亮 —— 但那样"悬停绿框"这个模式就没了，
      而用户在【其他部分】（按钮、输入框、列表项）是认可这个模式的。

   结论（用户澄清后的正确切分）：
     标签 / 选项类（文字紧贴内容盒） → 文字高亮（见下方 3b，不用框）
     其余交互元素                    → 悬停绿框（本节）

   【为什么用 inset 环而不是 border】
   给一个没有边框的元素临时加 border 会改变宽高、引发整行重排
   （这正是早先按钮 hover 抖动的原因）。inset 环不占布局空间，
   且自动跟随元素自身的 border-radius。

   【为什么环色用 border-l2 而不是亮绿】
   亮绿 brand-primary 留给【聚焦】与【选中】—— 那是更强的语义。
   悬停用较暗的 border-l2，强度层次才有区分：
     悬停(border-l2) < 聚焦/选中(brand-primary)
   这与工具卡 hover 用的颜色一致，全站悬停语言统一。 */
:root[data-phosphor] :is(
  button, a[href], summary, [role="button"], [role="link"], [role="checkbox"],
  [role="switch"], [role="radio"], [role="menuitem"]
):hover:not(:disabled):not(.ph-statusbar) {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
}
/* 桌面端的可点击行/项（没有 role 但带 tabindex 的），以及输入类元素 */
:root[data-phosphor] :is(input, textarea, select):hover:not(:disabled):not(:focus) {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
}
/* 输入卡片的可编辑面【排除】——卡片本身已有 :focus-within 的亮绿边框，
   这里再叠一层会让卡片内出现"框中框"。 */
:root[data-phosphor] [data-phosphor-composer] [contenteditable="true"]:hover {
  box-shadow: none;
}
/* 状态栏内部元素【排除悬停绿框】：状态栏是信息展示区，不是操作区，
   悬停时出现描边只会让人以为可以点。用 .ph-statusbar 作为排除条件，
   而不是排除 .ph-* 全部自有类 —— 只排除确实不需要的那一处。 */
:root[data-phosphor] .ph-statusbar :is(button, a[href], [role="button"], [tabindex]):hover {
  box-shadow: none;
}

/* 悬停：只提亮文字，【不铺底色】。
   ----------------------------------------------------------------------------
   原先这里是 background-color: color-mix(品牌绿 12%, transparent)。
   用户截图显示「轨迹」标签在鼠标悬停时出现一个明显的深绿方块：
   因为宿主自己就给标签铺了 interactive-bg-hover 底色，我这一层又叠上去，
   两层相加成了块可见的方块；再配上宿主的悬停描边，就成了一个"框"。
   更糟的是它与"选中"的表达太像 —— 悬停一下像切换了标签。

   现在把两者的视觉语言彻底分开：
     选中（当前所在） → 亮绿字 + 辉光 + 字重 600     ← 唯一带"强调"的
     悬停            → 只把字色提亮到主字色 + 淡淡辉光
   悬停不再有底色、不再有框，因此不可能被误读成选中。
   底色交还给宿主自己的 hover 反馈，我不再叠加。
   注意：标签类元素【不参与】上面的悬停绿框（见 3c 的说明），只走这里。 */
:root[data-phosphor] :is([role="option"], [role="menuitem"], [role="tab"]):hover:not([aria-selected="true"]):not([aria-current="true"]):not([data-active="true"]) {
  color: var(--dsw-alias-label-primary);
}
:root[data-phosphor][data-phosphor~="glow"] :is([role="option"], [role="menuitem"], [role="tab"]):hover:not([aria-selected="true"]):not([aria-current="true"]):not([data-active="true"]) {
  text-shadow: var(--ph-glow-soft);
}
/* 【已移除】button:hover 的全站柔光。
   ----------------------------------------------------------------------------
   原先这里有一条：
     :root[data-phosphor][data-phosphor~="glow"] button:hover:not(:disabled) {
       box-shadow: var(--ph-glow-soft);
     }
   它与预览页 .ph-cbtn:hover 的柔光对应，但【在真实界面上不成立】：
   预览页的按钮都是小尺寸文字按钮，柔光只有几十像素宽，是恰当的点缀；
   而宿主里有大量【整宽按钮 / 可点击行】，例如运行结束后那条
   「已完成，用时 44 秒」横栏 —— 同一条规则套上去，柔光会铺满整行宽度，
   看起来像整条栏在发光。用户实测反馈为「诡异的辉光」。

   结论：悬停发光不能按「元素类型」一刀切，它取决于元素尺寸。
   因此撤掉这条通用规则，只保留两处尺寸可控的：
     · 输入卡片聚焦（边框 + 柔光）—— 用户明确认可的那一处
     · 输入工具行内的四个按钮（尺寸由本插件固定 28px 高，宽度有限）
   其余元素的悬停反馈交还给宿主自身，焦点反馈由 :focus-visible 承担。 */

/* ============================================================================
   3b. 对话气泡 —— 从预览页移植。
   ----------------------------------------------------------------------------
   预览页的用户消息（.ph-user-body）不是填充气泡，而是：
       color: 主字色; padding-left: 16px; border-left: 1px solid 边框色
   即「左侧竖线 + 缩进 + 文字色」。真界面默认是「填充底色 + 右对齐气泡」。
   这里把填充改为左竖线，与预览页一致。

   选择器依据（已从 ui-chat 的源码核实，不是猜）：
     用户气泡 DOM： div.userRow > div.userStack > div.bubble
     · 类名形如 <hash>_bubble，哈希前缀每次构建都变，但语义后缀在源码里
       写死，所以 [class*="_bubble"] 是稳定的。
     · data-pending-steering / data-submission-echo 只挂在 userRow 上，
       正好用来把「用户消息」与其它同类气泡区分开。
     · 已核实：消息气泡只有 cJsG2q_bubble 一个；另一个 -ja1rG_bubble 属于
       ui-goal 的 GoalCommandInputView（目标命令输入），不在用户行内，
       因此不会被这两条属性选择器命中。
   ========================================================================= */
/* 位置：把右对齐的窄气泡改成左对齐、撑满宽度。
   ----------------------------------------------------------------------------
   宿主的原始规则（已从 ui-chat 的 CSS 串逐字取出）：
     .userRow  {flex-direction:column;align-items:flex-end;gap:6px;display:flex}
     .userStack{min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px)*.702),82%);
                flex-direction:column;align-items:flex-end;gap:8px;display:flex}
     .bubble   {…;max-width:100%;…}

   前一版试图用气泡与 stack 自身的 align-self / width 顶掉这两个
   align-items: flex-end —— 实测无效（重启后仍在右侧）。原因是 align-self
   只能覆盖父级对该元素的交叉轴对齐，顶不住父级在交叉轴上把整条 stack 压到
   右侧，也顶不住 82% 的 max-width 上限。

   现在直接改这两个容器的 align-items。安全性有确凿依据：
     · cJsG2q_ 类名全表里，消息容器只有 userRow / userStack / bubble，
       【没有 assistant 侧的对等类】—— 用户消息是专属结构，
       改它不会波及助手消息。
     · 选择器都限定在 *_userRow / *_userStack 上。
   加 !important 是兜住尚未穷尽的同名来源特异性竞争；这几个属性都是纯几何的，
   不涉及语义或可读性风险。 */
:root[data-phosphor] [class*="_userRow"],
:root[data-phosphor] [class*="_userStack"] {
  align-items: flex-start !important;
}
:root[data-phosphor] [class*="_userStack"] {
  max-width: 100% !important;
}
:root[data-phosphor] [data-submission-echo][class*="_userRow"] [class*="_bubble"],
:root[data-phosphor] [data-pending-steering][class*="_userRow"] [class*="_bubble"],
:root[data-phosphor] [class*="_userStack"] [class*="_bubble"] {
  width: 100% !important;
  text-align: left !important;
  background: transparent;
  border-left: 2px solid var(--dsw-alias-border-l2);
  border-radius: 0;
  padding: 2px 0 2px 14px;
  color: var(--dsw-alias-label-primary);
}
/* 注意：这里曾经写成 .ph-user-row [class~="_bubble"] —— .ph-user-row
   是我凭空造的自定义类，真实 DOM 里没有，规则等于空转。
   现在只用真实存在的钩子：data-submission-echo / data-pending-steering
   与 *_userStack，两者都已在 ui-chat 源码中核实。
   这条弯路本身值得记下：不要引入宿主没有的类名做定位。 */

/* ============================================================================
   3c. 输入框（composer）—— 向预览页对齐。
   ----------------------------------------------------------------------------
   预览页的输入卡片（.ph-composer）：
     border: 1px solid var(--dsw-alias-border-l1);
     background: var(--dsw-alias-bg-layer-1);
     padding: 11px 13px 8px;
     transition: border-color .16s, box-shadow .16s;
     聚焦 → border-color: 品牌绿; box-shadow: 柔光 + inset 内发光

   真实 DOM（已从 asar 中的 CSS 与模块名核实，不是猜）：
     · 可编辑面是 Lexical：class 形如 <hash>_input，语义后缀写死，前缀每次
       构建都变；它是 contenteditable 元素，本身【没有 border / background】。
     · 几何由 CSS 变量控制：
         --dsh-composer-stack-gap: 6px
         --dsh-composer-text-max-height: 336px
         --dsh-composer-side-clearance: 16px
         --dsh-composer-card-max-width: calc(--dsh-chat-content-width + 32px)
     · 因此可见的方框是外层卡片，不是可编辑面本身。

   范围克制：只用 contenteditable，并只改可编辑面自身的属性。不碰宿主的布局
   容器与几何变量 —— 输入框承载发送、附件、权限、模型选择一整套控件，
   动错一处代价很高。
   ========================================================================= */
/* 可编辑面：文字色与聚焦环。
   宿主默认在可编辑面本身【没有 border / background】，可见方框来自外层卡片；
   而外层卡片没有可核实的稳定类名（其几何只由 --dsh-composer-* 变量控制，
   且那些变量定义在卡片自身或其祖先上）。因此这里只做能确定成立的两件事：
   文字色，以及聚焦时的柔光。
   刻意【不做】的事：给可编辑面加边框或背景。那会在卡片里再套一个方框，
   与预览页的观感恰好相反。 */
:root[data-phosphor] [data-phosphor-composer] [contenteditable="true"] {
  color: var(--dsw-alias-label-primary);
  /* outline 收窄到输入卡片之内。
     宿主自己就给 composer 的输入面写了 outline:none（.<hash>_input{outline:none}），
     所以这里对输入框只是重复声明；但写成全站 [contenteditable="true"] 会连带
     取消重命名框、标题编辑等其它可编辑元素的原生焦点环 ——
     而补回可见焦点环的那条规则（第 3 节 :focus-visible）带 glow 开关，
     用户一关 glow，那些元素就既无 outline 也无替代指示。
     限定在卡片内即可：这些元素本就不是本主题的目标。 */
  outline: none;

  /* 老式终端光标：实心方块。
     ----------------------------------------------------------------------
     CSS 能控制光标的属性只有三个，逐个说明（取值均经运行时实测）：
       caret-color  —— 已由 --dsw-alias-state-business-primary 统一为品牌绿
                       （见 SEMANTIC），不在此重复，避免两处定义同一个值。
                       实测计算值 rgb(0, 255, 156)，生效。
       caret-shape  —— 唯一能做出方块的属性。实测本机
                       CSS.supports('caret-shape','block') === true，生效。
                       不支持的引擎会静默忽略该声明，退回默认细光标。
       caret-width  —— 【不要加】。实测本机
                       CSS.supports('caret-width','0.5em') === false，
                       且 getComputedStyle().caretWidth === undefined ——
                       它只有 Firefox 支持，写在这里是永远不生效的死代码，
                       反而会让维护者误以为光标宽度由主题控制。故删除。

     【方块的宽度不由主题决定，不要再试图去"调"它】
     实测：字号两种状态下都是 14px、caretColor 也一致，但用户观察到
     "打上字之后光标会变宽一点"。原因在浏览器一侧：
     caret-shape: block 的方块宽度 = 光标所在位置【相邻字符的宽度】。
       空输入框（行首、后面无字）→ 按该处默认字位
       光标贴在中文全角字旁 → 约 14px（宽）
       光标贴在拉丁窄字母旁 → 约 4-8px（窄）
     这是"一个字符位"的定义使然，CSS 层面无法固定。
     用户已确认当前形态满意（原话：这个宽度很好，我很满意）。
     IME 组字期间光标由输入法自己渲染，caret-* 一律不适用，CSS 也改不了。 */
  caret-shape: block;
}
/* 可编辑面的聚焦柔光【不在这里写】—— 第 3 节（霓虹发光）已经有一条等价的
   :root[data-phosphor][data-phosphor~="glow"] [contenteditable="true"]:focus。
   此处原先重复了一遍同样的声明，属于「同一属性两处定义」，
   正是改一处、另一处留旧值的温床，故删除。 */

/* 输入卡片（方框）—— 由插件探测后在 DOM 上打 data-phosphor-composer 标记，
   不靠猜类名。探测规则见 apply 中的 markComposerCard。
   对齐预览页 .ph-composer：1px 边框 + 层 1 背景 + 11/13/8 内边距 + 方角。 */
:root[data-phosphor] [data-phosphor-composer] {
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  padding: 11px 13px 8px;
  border-radius: 0;
  transition: border-color .16s, box-shadow .16s;
}
/* 聚焦 → 品牌绿描边 + 柔光 + 内侧极淡发光。
   用 :focus-within：光标在输入框内即成立，不必监听事件，也不会漏掉
   焦点落在卡片内其它控件（发送/附件按钮）的情况。

   inset 那一层是对齐预览页 .ph-composer.focus 的
     box-shadow: var(--ph-glow-soft), inset 0 0 26px rgba(0,255,156,.04)
   审计指出插件只做了外发光、漏了内发光。内发光让卡片"从里面亮起来"，
   与外描边形成内外呼应；透明度只有 .04，不会抢内容注意力。
   颜色写死而非用 color-mix：预览页就是字面量 rgba(0,255,156,.04)，
   保持一致便于日后逐个数值核对。 */
:root[data-phosphor][data-phosphor~="glow"] [data-phosphor-composer]:focus-within {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: var(--ph-glow-soft), inset 0 0 26px rgba(0, 255, 156, .04);
}

/* 输入工具行 —— 预览页 .ph-send / .ph-cbtn 的观感。
   ----------------------------------------------------------------------------
   按钮的类名与当前外观由实测得到（在 Console 里读 getComputedStyle）：
     0  <hash>_add      "添加文件或调用指令"  bg rgb(53,54,56)  radius 999px
     1  <hash>_trigger  "访问模式…"           透明              radius 0
     2  <hash>_trigger  "选择模型…"           透明              radius 0
     3  <hash>_primary  "发送消息"            bg rgb(122,170,255) radius 999px  ← 蓝色
   即：发送键是蓝色实心胶囊、附件键是灰色胶囊，与预览页的「绿色描边方角」相反。

   命名依据：语义后缀在源码里写死，哈希前缀随构建变化，
   因此 [class$="_primary"] 稳定（与气泡的 [class*="_bubble"] 同一机制）。
   作用域：全部限定在 [data-phosphor-composer] 之内 —— 发送/暂停按钮与
   对话流里的其它 _primary 按钮不能互相影响。 */

/* 四个按钮：尺寸与边框的【单一来源】。
   ----------------------------------------------------------------------------
   此前这里是逐条追加出来的：height 在两组规则里分别写 26px 与 28px，
   border 也先写品牌绿、再被 transparent 覆盖。计算值虽然一致，但同一属性
   两处定义是维护陷阱 —— 改一处必然留另一处不一致，高度不齐就是这么来的。

   现在只有一个尺寸来源：统一 height + box-sizing: border-box，
   使 1px 占位边框计入高度；各按钮只写自己的差异。

   【选择器必须用后缀匹配 [class$=...]，不能用包含匹配 [class*=...]】
   这一点由实测发现：宿主给按钮内部子元素起的类名是「按钮类名 + 后缀」——
     _trigger  →  _triggerIcon / _triggerLabel / _triggerEffort
   因此 [class*="_trigger"] 会连子元素一起命中，把 height:28px、inline-flex、
   flex:none 全套到图标与文字节点上，改变它们的盒模型，在内容变化时破坏排版
   （高度看起来「对」，但那是巧合）。
   [class$="_trigger"] 只命中以该名【结尾】的类，即真正的按钮。
   注意 _bubble / _userRow / _userStack 仍用包含匹配是对的 ——
   它们的子元素类名（attachmentRow 等）不含这些子串。 */

/* 基础：等高、方角、占位边框（悬停只换色，绝不改尺寸）。
   ----------------------------------------------------------------------------
   必须同时固定住「不被内容撑高」的三个面：
     · box-sizing: border-box  —— 让 1px 占位边框计入 28px
     · white-space: nowrap     —— 禁止换行。模型选择器文字最长
                                  （DeepSeek-V41-Flash High），允许换行就会
                                  折成两行、把固定高度撑开，这正是它比
                                  左侧两个框高的原因
     · flex: none              —— 禁止 flex 收缩，避免被同行其它元素挤扁
   min-height / max-height 一起钉死，杜绝内容或浏览器默认值再把它改回去。 */
:root[data-phosphor] [data-phosphor-composer] [class$="_add"],
:root[data-phosphor] [data-phosphor-composer] [class$="_trigger"],
:root[data-phosphor] [data-phosphor-composer] [class$="_primary"] {
  box-sizing: border-box;
  height: 28px;
  min-height: 28px;
  max-height: 28px;
  white-space: nowrap;
  flex: none;
  border: 1px solid transparent;
  border-radius: 0;
  display: inline-flex;
  align-items: center;
  background: transparent;
  transition: border-color .14s, background .14s, box-shadow .14s, color .14s;
}

/* 图标键（附件）：方形 + 居中。清零内边距 ——
   宿主默认是 0 4px 0 8px 这种不对称值（为「图标 + 文字」预留左侧空间），
   沿用会把只有图标的按钮推偏右。
   注意发送键【不在】这里：它是「图标 + 文字」，见下方。 */
:root[data-phosphor] [data-phosphor-composer] [class$="_add"] {
  padding: 0;
  min-width: 28px;
  justify-content: center;
}

/* 文字键（访问模式、模型选择器）：这两个是「图标 + 文字」，
   必须保留横向内边距，清零会让文字贴住边框。 */
:root[data-phosphor] [data-phosphor-composer] [class$="_trigger"] {
  padding: 0 7px;
}

/* 悬停：只换边框色与文字色 —— 尺寸不变，因此整行不会重排。
   ----------------------------------------------------------------------------
   边框色统一为 brand-primary（亮绿），此前用的是 border-l2（暗绿 #1d6b4a）。
   三处宽度其实都是 1px，差别在【颜色亮度】：
     输入卡片聚焦  = brand-primary #00ff9c
     send         = brand-primary
     add/trigger  = border-l2    #1d6b4a   ← 亮度只有亮绿的约 1/3
   暗绿在深色底上视觉重量明显更轻，看起来就像「薄了一档」；再叠上视口缩放
   （1707px 被缩到预览尺寸）产生的半像素渲染，细的感觉会被放大。
   统一为亮绿后四处边框在视觉上等重。 */
:root[data-phosphor] [data-phosphor-composer] [class$="_add"]:hover,
:root[data-phosphor] [data-phosphor-composer] [class$="_trigger"]:hover {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary);
}
/* 与 send / 输入框聚焦一致：悬停也带一点柔光，进一步拉平视觉重量。 */
:root[data-phosphor][data-phosphor~="glow"] [data-phosphor-composer] [class$="_add"]:hover,
:root[data-phosphor][data-phosphor~="glow"] [data-phosphor-composer] [class$="_trigger"]:hover {
  box-shadow: var(--ph-glow-soft);
}

/* 发送 / 暂停：对齐预览页的「⏎ send」—— 图标 + 文字，品牌绿描边，靠右。
   ----------------------------------------------------------------------------
   宿主这个按钮里【只有图标】（实测输出：唯一子元素是 svg），没有文字节点。
   因此用 ::after 注入 send 字样，把它做成「图标 + 文字」的组合键，
   这正是预览页 .ph-send 的形态：
     <span class="ph-send">&#9166; send</span>
     .ph-send { border: 1px solid brand; color: brand;
                padding: 2px 12px; margin-left: auto }

   ::after 位于按钮自身的 flex 布局中，天然成为最后一个 flex item、
   排在 svg 之后 —— 顺序与预览页的「回车符号 + send」一致。 */
:root[data-phosphor] [data-phosphor-composer] [class$="_primary"] {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
  margin-left: auto;
  /* 只保留 send 文字，隐藏宿主自带的图标（用户明确要求）。
     ----------------------------------------------------------------------
     实测这个按钮内部的总需求：
       svg 图标 ≈ 14px   +   gap 4px   +   "send" 27.5px   ≈ 45.5px
     而它在那一行里实际只拿得到约 34px —— 从第一轮起就装不下，
     于是 flex 先把图标压成 0、再裁掉文字尾部（「sen」）。
     两者不能兼得，用户选择保留文字。svg 置 0 并隐藏，
     按钮宽度于是只剩文字 27.5 + 边框 2 ≈ 30px，放得下。
     用 width/height + overflow 而不只是 display:none：后者会改变
     flex 项目数、影响按钮的宽度计算方式，这里更希望宽度由文字决定。 */
  padding: 0;
  /* 固定宽度：宽度不再依赖内容撑开。
     ----------------------------------------------------------------------
     实测教训：此前想用 ::after 的横向 padding 把按钮撑宽，结果按钮【一点没变长】，
     而文字被推出边界、又被工具栏的 overflow:hidden 裁成「se」。
     因为该按钮的宽度不由内容决定 —— 基础规则给了 flex:none、工具栏又 overflow:hidden，
     内容变化只影响溢出量，不影响宽度。
     既然宽度不受内容影响，就【直接给定宽度】，文字改用绝对定位居中：
     宽度可控、文字始终完整，两端都不再看内容脸色。 */
  width: 72px;
  min-width: 72px;
  position: relative;
  gap: 0;
  flex: none;
  /* 抵消宿主为「图标居中」做的上移补偿。
     ----------------------------------------------------------------------
     宿主自带的规则（从 app.asar 里逐字取出）：
       .<hash>_primary { width:34px; height:34px; display:grid;
                         place-items:center; transform: translateY(-2px) }
     那个 translateY(-2px) 是为了让图标在按钮里视觉居中。但用户要求隐藏图标、
     只留文字，这个补偿就失去了对象，变成纯粹的上移 —— 实测：
       send     top: 969.33
       trailing top: 971.33   →  差值 -2.00，与 transform 的 -2px 完全吻合
     而 _add / _trigger 没有这条规则，所以只有 send 高了 2px。
     显式置 none，四个按钮回到同一水平线。 */
  transform: none;
}
:root[data-phosphor] [data-phosphor-composer] [class$="_primary"] svg {
  display: none;
}
/* 文字绝对定位居中：位置与宽度都不再参与按钮的尺寸计算，
   从而摆脱「随内容漂移 / 被裁切」这一类问题。
   预览页 .ph-send 是 2px 12px 内边距 + 图标 + 文字；这里只留文字，
   用固定 72px 宽度还原它的大致比例。 */
:root[data-phosphor] [data-phosphor-composer] [class$="_primary"]::after {
  content: "send";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--ph-mono, monospace);
  font-size: 11px;
  line-height: 1;
  letter-spacing: .04em;
  white-space: nowrap;
}
/* 运行中：模型正在输出时，宿主的 aria-label 会变成停止类文案，
   JS 检测到后打上 data-phosphor-stop，文字随之切换为 stop。
   因为按钮宽度是写死的 72px，换文字不会引起任何尺寸变化 ——
   这正是把宽度固定下来带来的好处：状态切换不再牵动布局。 */
:root[data-phosphor] [data-phosphor-composer] [class$="_primary"][data-phosphor-stop]::after {
  content: "stop";
}
:root[data-phosphor][data-phosphor~="glow"] [data-phosphor-composer] [class$="_primary"] {
  text-shadow: var(--ph-glow);
}
:root[data-phosphor][data-phosphor~="glow"] [data-phosphor-composer] [class$="_primary"]:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--ph-glow);
}

/* 工具行本体（预览页 .ph-composer-bar）：
   顶部 1px 细分隔线把编辑区与工具行分开，两行文字用 11px + 次要字色。
   元素由 markComposerToolbar 探测后打标记 —— 不能挂在卡片上，卡片是
   flex column + gap 12px，border-top 会落到编辑区与工具行之间的空隙上。 */
:root[data-phosphor] [data-phosphor-toolbar] {
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding-top: 7px;
  margin-top: 6px;
  color: var(--dsw-alias-label-secondary);
  /* 交叉轴居中 —— 四个按钮的垂直对齐就在这里决定。
     ----------------------------------------------------------------------
     此前这一行【没有声明 align-items】，于是用 flex 默认值 stretch。
     而四个按钮都被我固定成 height: 28px，它们拒绝了 stretch；
     此时 flex 项的对齐退回 flex-start（贴顶）。工具行里还有比 28px 更高的
     元素（trailing 容器 / 宿主自身的行高），于是 28px 的按钮都贴到那一行的
     顶部，彼此之间又因所在行盒不同而错位 —— 用户看到的「三个图标比 send
     略微偏下」就是这个。
     声明 center 后，四个按钮在交叉轴上统一居中，不再受行盒高度影响。 */
  align-items: center;
  /* gap 收窄到 6px（预览页 9px）：真界面的模式/模型选择器文字比预览页的
     占位符长得多，9px 间距下四个控件加发送键放不进一行。 */
  gap: 6px;
  /* 右内边距 —— 目的从「精确对齐」改为「留出可见间距」。
     ----------------------------------------------------------------------
     实测（viewport 1707）：
       card   right = 1460   padding-right 13px  → 卡片内容右缘 1446.3
       editor right = 1443   （输入区文字的右缘）
       SEND   right = 1447   ← 比输入区右缘超出 4px

     先按「对齐输入区右缘」补了 4px，把发送键移到 1443。但两张截图逐像素
     对比后，位置【视觉上不可辨】—— 4px 的量级看不出来，而真正的观感问题
     是：发送键几乎贴着卡片右缘，缺少留白。贴边本身就读作「偏右」。

     参照预览页：绿色发送键与卡片右缘之间有明确间距。因此这里取 10px，
     让发送键离开边框一个可见的距离（1447 − 10 = 1437）。
     左侧 padding-left 仍保留，负责与输入区文字左对齐。 */
  padding-right: 10px;
  /* 字号与预览页工具行一致（11px）。
     这里曾短暂收到 10.5px 以挤出宽度，后来卡片加宽到 1280px 便不再需要，
     已改回 11px —— 注释与代码保持一致，避免日后误判。 */
  font-size: 11px;
  /* 兜底裁切：卡片 overflow 可见，工具行放不下时会盖到卡片边框外。 */
  overflow: hidden;
}

/* 承载右侧控件的 trailing 容器：允许收缩。
   ----------------------------------------------------------------------------
   实测数据说明宽度问题在这一层，而不是工具行：
     _trailing  w263  scrollW269  overflow:visible   ← 内容比自身宽 6px，且不裁切
     _row       w918  scrollW918  overflow:hidden    ← 工具行并未溢出
   成因：我的按钮规则（padding + gap + 注入的 send 文字）把这一层的控件撑宽，
   而它默认 overflow:visible 且不允许收缩，内容于是溢出到卡片边框外 ——
   看起来就是「send 从右边露出来」。

   真正解决宽度问题的是 min-width: 0 —— flex 子项默认 min-width:auto 会阻止
   收缩，给它 0 才能收得下来。

   overflow: hidden 原来也写在这里，现在【撤掉】：工具行那层已经有 overflow:
   hidden，这里是重复裁切，而裁切的代价已经出现 —— 实测 send 的 rect 比
   trailing 高 2px（969 vs 971），即在容器顶部溢出，被这层 overflow 裁掉。
   少一层裁切，就少一种「某个像素莫名被削掉」的可能。 */
:root[data-phosphor] [data-phosphor-trailing] {
  min-width: 0;
}

/* 4. 扫描线 + 暗角：纯装饰，绝不拦截指针事件。
   ----------------------------------------------------------------------------
   定位与尺寸（position/inset/z-index/pointer-events）写在【不带开关】的基类上，
   开关只负责视觉属性（background / box-shadow）。
   原因：两个浮层由 JS 无条件插入 body，而原先定位只挂在 scan 开关下，
   于是关掉「扫描线 + 暗角」、只留「CRT 曲率」时，.ph-vignette 退回 static、
   高度为 0，inset 阴影没有可渲染的盒 → crt 开关静默失效。 */
.ph-scan,
.ph-vignette {
  position: fixed; inset: 0;
  pointer-events: none;
}
:root[data-phosphor][data-phosphor~="scan"] .ph-scan {
  z-index: 2147483000;
  background: repeating-linear-gradient(
    to bottom,
    var(--ph-scan-line) 0px,
    var(--ph-scan-line) 1px,
    transparent 1px,
    transparent 3px
  );
}
:root[data-phosphor][data-phosphor~="scan"] .ph-vignette {
  z-index: 2147482999;
  background: var(--ph-vignette);
}

/* 4b. CRT 曲率：内阴影压暗 + 圆角。刻意不用 transform 真弯屏 ——
       那会让整屏文字被重采样发虚，中文字形尤其明显。

       这里的圆角必须写字面量 14px，【不能】用 var(--dsw-radius-lg)。
       本插件为了全站方角，把 --dsw-radius-* 六个刻度内联成了 0px，
       于是 var(--dsw-radius-lg) 实算为 0 —— 曲率只剩内阴影，
       圆角那一半特效等于被自己关掉了。预览页用的就是字面量 14px。 */
:root[data-phosphor][data-phosphor~="crt"] body { border-radius: 14px; }
:root[data-phosphor][data-phosphor~="crt"] .ph-vignette { box-shadow: var(--ph-crt-shadow); }

/* 4c. 抵消基础主题的 corner-shape: superellipse(1.5)。
       基础样式在 @supports 里给 *、:before、:after 都设了超椭圆角型，
       会把圆角渲染成饱满的「圆角方块」而非标准直角/圆角。
       要方就方得干净，这里显式拉回标准 round。 */
:root[data-phosphor],
:root[data-phosphor] *,
:root[data-phosphor] *::before,
:root[data-phosphor] *::after {
  corner-shape: round;
}

/* 5. 底部终端状态栏：fixed 浮层，正文必须让出等高空间。
   ============================================================================
   最终方案：只给 body 加 padding-bottom（box-sizing: border-box）。
   这曾经只是"退路"，现在成为唯一方案 —— 因为实测本机构建里
   【没有可标记的 app frame】。过程记录如下，避免以后再走一遍：

   ① 最初按布局包的描述，把让位做在 app frame 上：
        .frame { grid-template-rows: 100%; height: 100%; overflow: hidden }
      理论上给 frame 加 border-box 的 padding-bottom，内容区会真实缩短，
      状态栏正好落在让出的 22px 里 —— 这是"结构性正确"的位置。
   ② 但同时给 body 也加了一条（无条件），两条【永远同时生效】，
      于是让出 44px，状态栏上方多出一条 22px 空带。改成
      body:not(:has([data-phosphor-frame])) 让二者互斥。
   ③ 用户实测发现 frame 标记【从来就没成功过】：
        body.children[0] 是 display:block / height:1044px 的 DIV，不是 grid
      也就是说：让位一直正常，靠的正是"探测失败 → 走 body 这条"。
   ④ 我一度把判据放宽到 grid || flex 想"修好"它，结果命中一个
      className 为空、height 仅 40px 的垫片 → :has() 成立 → body 让位失效
      → 用户实测「下面的三个小工具不见了」（被状态栏盖住）。

   结论：**这个环境没有 grid 类型的根 frame，而"探测失败"本身就是正确路径。**
   因此彻底删掉 frame 探测与它那条 CSS，只保留 body 这一条 ——
   功能完全不变（已验证：body paddingBottom 22px、状态栏正好让出 23px），
   同时消灭了一整类 bug：任何一次误标记都会静默关闭让位并压住底部内容。 */
:root[data-phosphor][data-phosphor~="statusbar"] body {
  box-sizing: border-box;
  padding-bottom: var(--ph-statusbar-h);
}

.ph-statusbar {
  position: fixed; left: 0; right: 0; bottom: 0;
  height: var(--ph-statusbar-h);
  display: flex; align-items: center; gap: 12px;
  padding: 0 12px;
  background: var(--dsw-alias-bg-layer-1);
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--ph-mono, monospace);
  /* 10.5px 基准 + 0.04em 字距，取自预览页。
     行高必须显式给：宿主正文行高是 22px，在同样 22px 高的状态栏里会把
     内容往下推、垂直居中偏掉。 */
  font-size: 10.5px;
  line-height: 1;
  letter-spacing: .04em;
  white-space: nowrap; overflow: hidden;
  z-index: 2147482000;
  pointer-events: none;
  user-select: none;
}
/* SESSION LIVE 这个标签用大写 + 宽字距，取自预览页的终端标签处理
   （.ph-turn-head / .ph-grp 用的都是 .14em 级字距）。 */
.ph-statusbar__live {
  color: var(--dsw-alias-state-success-primary);
  display: inline-flex; align-items: center; gap: 5px;
  letter-spacing: .12em;
}
.ph-statusbar__dot {
  width: 6px; height: 6px; background: currentColor;
  /* 预览页 .sb-dot 带辉光（box-shadow: var(--ph-glow)），此处原先漏了。
     它是状态栏唯一的「活」标记，缺辉光会显得偏平。 */
  box-shadow: var(--ph-glow);
  animation: ph-pulse 2.4s ease-in-out infinite;
}
.ph-statusbar__sep { color: var(--dsw-alias-border-l2); }
/* 注：__msg 已不再由 JS 使用（原来是常量 'PHOSPHOR' 那段，
   现已被下面的 __run 活动指示灯取代）。规则保留 —— 它无害，
   且若日后要恢复一个纯文本标识段可以直接复用。 */
.ph-statusbar__msg { color: var(--dsw-alias-label-primary); }
/* 【活动指示灯】RUN / IDLE —— 由 data-phosphor-stop 驱动。
   这是"指示灯"语言里唯一不必编造数据的位置：宿主把模型运行态写在
   发送键的 data-phosphor-stop 上，这里把它引到状态栏。
   两态用不同颜色 + 不同动画：RUN 琥珀色闪烁（"正在工作"），
   IDLE 暗绿常亮（"待机"）。颜色而非仅亮度 —— 余光也能分辨。 */
.ph-statusbar__run {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  letter-spacing: .08em;
  color: var(--dsw-alias-label-tertiary);
}
.ph-statusbar__lamp {
  width: 6px; height: 6px;
  flex: none;
  background: currentColor;
  border-radius: 0;
  corner-shape: round;
  /* 未点亮时给一点内暗，像没通电的灯珠 */
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent);
}
/* RUN：琥珀/警示色 + 快闪（1.2s）。用 state-warn-label 与错误色区分 ——
   运行不是错误，只是"忙"。 */
.ph-statusbar__run.is-run {
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-brand-primary));
}
.ph-statusbar__run.is-run .ph-statusbar__lamp {
  box-shadow: 0 0 6px currentColor;
  animation: ph-lamp 1.2s steps(1) infinite;
}
@keyframes ph-lamp { 0%, 55% { opacity: 1 } 56%, 100% { opacity: .28 } }
.ph-statusbar__right { margin-left: auto; display: inline-flex; gap: 12px; align-items: center; }
.ph-statusbar__caret {
  display: inline-block; width: 7px; height: 11px;
  vertical-align: -2px; margin-left: 1px;
  background: var(--dsw-alias-brand-primary);
  animation: ph-blink 1.05s steps(1) infinite;
}
@keyframes ph-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
@keyframes ph-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }

/* 6b. 状态栏的窄窗口降级。
   ----------------------------------------------------------------------------
   补上「模型 / 访问模式」之后状态栏变长了（原本 4 段，现在 6 段），
   而它是通栏 fixed 浮层 + overflow:hidden —— 窄窗口下尾部的时钟与 UTF-8 会被裁掉。
   按宽度分两级收起，先收较长的"访问模式"，再收模型名：
     小于 1100px → 收起访问模式（.ph-statusbar__opt）
     小于  900px → 再收起模型名（.ph-statusbar__opt2）
   时钟与 UTF-8 始终保留：它们是这个状态栏最初就有的信息。 */
@media (max-width: 1100px) {
  .ph-statusbar__opt { display: none; }
}
@media (max-width: 900px) {
  .ph-statusbar__opt2 { display: none; }
}

/* 6c. 快速回复键 continue —— 输入工具行最左。
   ----------------------------------------------------------------------------
   观感参照发送键（用户要求"参考你写的那个 send"）：
     方角、等宽字体、小字号、窄字距、透明底、1px 边框。
   与发送键的区别：
     发送键是主操作（亮绿描边 + 品牌色文字），本键是次要辅助，
     因此用较暗的 border-l2 与次要字色，悬停才提到品牌绿 ——
     层次为「悬停(暗绿) < 本键常态 < 聚焦/发送(亮绿)」。

   【高度：28px —— 与左右完全一致（附实测定量）】
     我的 continue  外框 90.1 x 28.0   padding 0/11   height 28
     右 send        外框 72.0 x 28.0   padding 0/0    height 28（minH/maxH 均 28）
     左 + 附件键     外框 28.0 x 28.0   padding 0/0    height 28
     工具行          height 28         align-items: center
   三者高度都是 28、工具行高度也是 28 —— 高度【本来就已对齐】，
   19.1px 边框 + 24.7px 内容也与 send 一致。
   字号也从 11px 提到 13.33px 与 send 对齐（原先 11px 在 28px 框里字太小）。

   【宽度：用户看到截图后判断"框比 send 高"，实测否决了这个判断】
   看起来"更大"的真实原因是【横向过宽】：90px 里只有 6 个字符，
   比 send 宽 18px，于是显得松散、进而被读成"更大"。
   所以真正要收的是宽度：横向 padding 11px → 8px。
   教训：观感报告"太大/太高"时，先【分别量出宽与高】再决定改哪个 ——
   这次差一点就去改一个本来就正确的高度。 */
.ph-qc {
  box-sizing: border-box;
  flex: none;
  height: 28px;
  /* 【宽度与 send 对齐】用户要求"框宽度可以长点，高度保存一致即可"。
     定宽 72px = send 键的宽度，于是这一行三个操作键（+ / continue / send）
     横向节奏统一，高度都是 28px。
     注意：给出 width 后，text-align 由 flex 的 justify-content 决定，
     下面补了 justify-content: center 让文字居中。 */
  width: 72px;
  min-width: 72px;
  padding: 0 8px;
  /* 位于右区（send 左侧），留白放在【左边】以与模型触发器分开。原来在左区时是 margin-right。 */
  margin-left: 8px;
  /* 【order 推到右端】用户要求 continue 紧邻 send。
     宿主的固定渲染顺序是：右区座位（本键）→ 模型触发器 → send，
     所以 DOM 上本键永远排在最前。而座位容器是 display: contents、
     不生成盒子，因此本 <button> 是外层 flex 容器的直接 flex 项 ——
     order 对它有效。给一个大值把它推到宿主控件之后。
     注意：这是【视觉顺序】调整，不动 DOM，React 不会察觉。 */
  order: 100;
  justify-content: center;
  font-family: var(--ph-mono, monospace);
  font-size: 11px;
  letter-spacing: .04em;
  line-height: 1;
  white-space: nowrap;
  /* 文字色用 brand-primary —— 与 send 键同色（实测 send 是 rgb(0,255,156)）。
     原先用 label-secondary(#12a35f) 偏暗，两键并排时亮度不一致。
     注意【别用 border-l2(#1d6b4a)】—— 那比 label-secondary 还暗，会反向。 */
  color: var(--dsw-alias-brand-primary);
  background: transparent;
  border: 1px solid var(--dsw-alias-brand-primary);
  border-radius: 0;
  corner-shape: round;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  transition: color .15s, border-color .15s, box-shadow .15s, background .15s;
}

/* 【全程高亮：与 send 键一致】
   用户要求这两个键"全程高亮" —— 即常态就处于高亮态，而不是只在悬停时。
   与 send 对齐的三件套（send 的对应规则见 §6.5c 一带）：
     文字色   brand-primary
     边框色   brand-primary        ← 原来是 border-l2（中绿），显得没点亮
     文字辉光 text-shadow: var(--ph-glow)   ← 与 send 同条件（发光开关打开时）
   于是悬停不再需要"从暗变亮"，而是【在已高亮的基础上再叠一层底 + 柔光】，
   层次依然存在，但两个键常态就是"通电"的样子。 */
:root[data-phosphor][data-phosphor~="glow"] .ph-qc {
  text-shadow: var(--ph-glow);
}
.ph-qc:hover:not(:disabled) {
  color: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  /* 【高亮】用户要求"顶多改成高亮"：悬停时给一层很淡的绿底，
     让按键在整行里"亮起来"，而不只是描边变色。
     12% 是试出来的量级 —— 再高就会像被选中，与 send 抢视线。 */
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  /* 【叠加】而不是替换：全站悬停绿框规则（§3c）给 button:hover 加了
     inset 0 0 0 1px 的内环，两者优先级相同、本规则在后 ——
     若这里只写 var(--ph-glow-soft)，那层内环会被整体替换掉、按钮反而少了描边。
     所以把内环与柔光显式写在同一条里。 */
  box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary), var(--ph-glow-soft);
}
/* 【顺序很重要】:disabled 的特异性与 :hover 相同（都是 0,2,0），
   所以谁写在后面谁赢。原先 :disabled 在后 → 禁用时它会赢得竞争，
   那是对的（禁用就该压过悬停）。但反过来也意味着【不能】把带 :disabled
   的规则写在 :hover 之前 —— 那样禁用的按钮仍会亮起来。
   这里把 active 放在 disabled 之前、hover 之后，保持：
     hover < active < disabled                                             */
.ph-qc:active:not(:disabled) {
  /* 按下时给一点"实心"反馈，与终端按键的手感一致（比悬停再深一档） */
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);
}
/* 键盘聚焦要可见（appearance 被重置后原生焦点环不可靠） */
.ph-qc:focus-visible {
  outline: 1px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
/* 运行中禁用：压暗并去掉交互暗示。
   不用 opacity 全灰 —— 保持可辨识，让用户知道它存在、只是暂时不可用。
   放在最后：确保禁用的样式压过上面的 hover / active。 */
.ph-qc:disabled {
  color: var(--dsw-alias-label-tertiary);
  border-color: var(--dsw-alias-border-l1);
  background: transparent;
  cursor: default;
  box-shadow: none;
}

/* 6. 设置行内的强度滑块。
   字号与内边距对齐预览页控制台：滑块文字 10.5px、条目 11px、padding 4px 0。
   DSH 内联控件默认约 12-13px，在这个紧凑面板里显得松散。 */
.ph-slide {
  display: flex; align-items: center; gap: 7px;
  padding: 4px 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
}
.ph-slide__label { min-width: 84px; }
.ph-slide__value {
  min-width: 42px; text-align: right;
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
.ph-slide input[type="range"] {
  appearance: none; flex: 1; min-width: 90px; height: 14px;
  margin: 0; background: transparent; cursor: pointer;
}
.ph-slide input[type="range"]::-webkit-slider-runnable-track {
  height: 6px;
  /* 【推子轨道 = 填充 + 刻度 + 底色】三层 background 从上层到下层叠：
     ① 刻度线：repeating-linear-gradient 每 6px 一条 1px 竖纹，
        深色半透明 —— 它压在填充层之上，所以亮区上也能看见刻度。
     ② 填充：用 --ph-fill（由 JS 内联写入，值域 0–100%）把轨道硬切成两段，
        左侧走过 = border-l2 中绿，右侧未走 = border-l1 暗绿。
        硬切（两个 stop 同位置）而非渐变 —— 推子要的是"刻度读数"的精确感。
     ③ 底色在最下，出现在两段之外（理论上被前两层覆盖，留作兜底）。
     6px 高：原来是 3px，太细挂不住刻度；6px 与 thumb 的 14px 比例接近硬件推子。 */
  background:
    repeating-linear-gradient(to right, color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent) 0 1px, transparent 1px 6px),
    linear-gradient(to right,
      var(--dsw-alias-border-l2) 0 var(--ph-fill, 50%),
      var(--dsw-alias-border-l1) var(--ph-fill, 50%) 100%),
    var(--dsw-alias-border-l1);
  /* 方角是主题语言；不用 border-radius */
  border-radius: 0;
  corner-shape: round;
}
.ph-slide input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  /* 推钮：比原 9px 宽一档，做成"有把手的方块" —— 上下各一条亮纹当抓握纹，
     中间保持品牌绿。方向与推子一致（竖向）。 */
  width: 11px; height: 14px;
  margin-top: -4px;
  background:
    linear-gradient(to bottom, color-mix(in srgb, var(--dsw-alias-bg-base) 70%, transparent) 0 2px, transparent 2px calc(100% - 2px), color-mix(in srgb, var(--dsw-alias-bg-base) 70%, transparent) calc(100% - 2px) 100%),
    var(--dsw-alias-brand-primary);
  border: 0; border-radius: 0;
  corner-shape: round;
}
.ph-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 0; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.ph-row:hover { color: var(--dsw-alias-label-primary); }

/* 设置面板的外壳、标题与分组。
   ----------------------------------------------------------------------------
   用户实测截图指出两件事：「终端外观和上面的有点太挤」、「没有写终端的名字」。
   原因是这个座位（settings.general.item）直接以第一行开关开头，与宿主上一节
   （「性能与用量」）之间只有宿主的行距，既没有主题标识、也没有视觉分隔。

   这里补三件东西：
     .ph-panel  外壳 —— 顶部一条细分隔线 + 上外边距，与宿主内容分开
     .ph-head   标题 —— PHOSPHOR 标识（与状态栏、启动序列同名）+ 中文副题
     .ph-sec    分组小标题 —— 把开关按「增强 / 极致 / 强度」分开，
                与预览页 PHOSPHOR CONTROL 面板的组织方式一致
   留白用 margin 而不是 padding：外层是宿主的列表行，margin 更不容易被
   宿主的布局规则吃掉。 */
.ph-panel {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.ph-head {
  display: flex; align-items: baseline; gap: 8px;
  margin-bottom: 10px;
}
.ph-head__mark {
  font-family: var(--ph-mono, monospace);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .14em;
  color: var(--dsw-alias-brand-primary);
  text-shadow: var(--ph-glow);
  /* LAB 入口的命中区：字标连点三下展开。
     padding + 负 margin 扩大可点范围，但不改变它在标题行里的视觉位置；
     user-select:none 必须加 —— 否则连点第三下会顺手选中整段文字。 */
  cursor: pointer;
  user-select: none;
  padding: 3px 5px;
  margin: -3px -5px;
  transition: opacity .1s, text-shadow .1s;
}
/* 头部右侧的版本号：与标题同排、次要色、可点击复制 */
.ph-head__ver {
  margin-left: auto;
  font-family: var(--ph-mono, monospace);
  font-size: 10px;
  letter-spacing: .06em;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  user-select: none;
  transition: color .12s;
}
.ph-head__ver:hover { color: var(--dsw-alias-brand-primary); }
.ph-head__ver.is-flash { color: var(--dsw-alias-brand-primary); }
.ph-head__sub {
  font-size: 10.5px;
  letter-spacing: .04em;
  color: var(--dsw-alias-label-secondary);
}
.ph-sec {
  margin: 12px 0 4px;
  font-family: var(--ph-mono, monospace);
  font-size: 10px;
  letter-spacing: .16em;
  color: var(--dsw-alias-label-tertiary);
}
/* 分组标题紧跟内容时不要再叠上边距 */
.ph-sec + .ph-row { margin-top: 0; }
/* 主开关（总闸）与分组细项区分开 */
.ph-row--master { margin-bottom: 2px; }

/* 设置行里的复选框 —— 逐项对齐预览页 .ph-opt input。
   ----------------------------------------------------------------------------
   此前这里【一条样式都没有】，所以设置面板里的复选框是浏览器/宿主的默认外观
   （圆角方块、系统蓝色勾选），是"插件自建面板里唯一不自洽的地方"：
   面板其余部分全是磷光绿 + 方角，只有复选框出戏。

   技法：appearance: none 去掉原生外观，然后用 ::after 画一个实心方块当"勾"。
   不用对勾符号是有意的 —— 终端风格里"实心块"比"✓"更贴题，预览页也是这么做的。
/* 开关做成【拨杆】：轨道 + 可滑动的方钮。
   ----------------------------------------------------------------------------
   用户要求把复选框改成"拨杆/开关"的硬件形态。实现只用 CSS，
   因为 <input type=checkbox> 本身既是可交互元素、也接受伪元素：
     ::before 画轨道（整宽、暗绿底、浅边框）
     ::after  画拨钮（12px 方块，品牌绿）
     选中时把拨钮 translateX 推到右端 —— 于是"位置"本身就是状态，
     与硬件拨杆的语义完全一致。

   尺寸：轨道 26×14、拨钮 12×12（内缩 1px，正好贴合轨道内缘）。
   与面板的 11px 字号、22px 行高相称。

   为什么不用对勾符号：终端/硬件面板里"实心块位置"比"✓"更贴题，
   预览页与设置面板此前都是这个取向（见上一条注释）。

   可访问性：勾选框本身没有被替换掉（还是同一个 input），所以
   键盘操作、屏幕阅读器的"已勾选/未勾选"语义、label 点击都保持不变。
   只是它的视觉由两个伪元素承担。 */
.ph-row input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  /* 轨道尺寸：宽 26、高 14。这是【控件盒】的尺寸，不是原来 12×12 的勾选框。 */
  width: 26px; height: 14px;
  margin: 0;
  flex: none;
  position: relative;
  cursor: pointer;
  border: 0;
  background: transparent;
}
/* 轨道（::before）：铺满整个控件盒，暗绿底 + 浅边框 */
.ph-row input[type="checkbox"]::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-border-l1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 0;
  corner-shape: round;
  transition: border-color .15s, background-color .15s;
}
/* 拨钮（::after）：12×12 方块，内缩 1px 贴合轨道内缘；未选中时靠左 */
.ph-row input[type="checkbox"]::after {
  content: "";
  position: absolute;
  top: 1px;
  left: 1px;
  width: 12px;
  height: 12px;
  background: var(--dsw-alias-label-tertiary);
  border-radius: 0;
  corner-shape: round;
  transition: transform .15s, background-color .15s, box-shadow .15s;
}
/* 选中：轨道变亮绿、拨钮推到右端并变成品牌绿 + 辉光 */
.ph-row input[type="checkbox"]:checked::before {
  border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
}
.ph-row input[type="checkbox"]:checked::after {
  transform: translateX(12px);
  background: var(--dsw-alias-brand-primary);
  box-shadow: var(--ph-glow);
}
/* 悬停：轨道边框提亮（在 label 的 hover 之外再给控件本身一层反馈） */
.ph-row input[type="checkbox"]:hover:not(:disabled)::before {
  border-color: var(--dsw-alias-brand-primary);
}
/* 键盘聚焦：复选框被 appearance:none 后失去原生焦点环，这里补回来。
   用 outline 而不是 box-shadow —— 后者会被轨道的 ::before 盖住。 */
.ph-row input[type="checkbox"]:focus-visible {
  outline: 1px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
/* 禁用态（理论上不出现，宿主可能因权限禁用）：压暗而不是完全隐藏 */
.ph-row input[type="checkbox"]:disabled {
  opacity: .4;
  cursor: default;
}
/* 滑块手柄：预览页给 :hover 加了辉光，插件此前只有默认态。
   ------------------------------------------------------------
   这是审计指出的一处遗漏（低风险、纯装饰）。 */
.ph-slide input[type="range"]:hover::-webkit-slider-thumb {
  box-shadow: var(--ph-glow);
}
/* ── 试听按钮 ────────────────────────────────────────────────────────────
   与主题其它控件同一套硬件语言：
     方角（border-radius 0 + corner-shape round）
     常态：中绿边框 + 次亮文字（不是品牌亮绿 —— 它是"操作"，不是"当前状态"）
     悬停：边框转亮绿 + 淡绿底 + 柔光（与 continue 键的高亮语汇一致）
   disabled（总闸关、或四个音效开关全关）时压暗并去掉指针，不隐藏 ——
   隐藏会让面板高度跳动，而"灰掉 + title 文案"就把原因说清了。 */
.ph-row--preview { margin-top: 6px; }
.ph-btn--preview {
  appearance: none;
  box-sizing: border-box;
  flex: none;
  height: 24px;
  padding: 0 12px;
  font-family: var(--ph-mono, monospace);
  font-size: 10.5px;
  letter-spacing: .1em;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 0;
  corner-shape: round;
  cursor: pointer;
  transition: color .15s, border-color .15s, background-color .15s, box-shadow .15s;
}
.ph-btn--preview:hover:not(:disabled) {
  color: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
  box-shadow: var(--ph-glow-soft);
}
.ph-btn--preview:active:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
}
.ph-btn--preview:focus-visible {
  outline: 1px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.ph-btn--preview:disabled {
  color: var(--dsw-alias-label-tertiary);
  border-color: var(--dsw-alias-border-l1);
  cursor: default;
}

/* 7. 启动自检序列：一次性浮层，绝不阻塞交互 */
.ph-boot {
  position: fixed; inset: 0;
  z-index: 2147483200;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-family: var(--ph-mono, monospace);
  font-size: 12.5px; line-height: 1.75;
  padding: 40px 44px;
  white-space: pre-wrap;
  pointer-events: none;
  transition: opacity .28s ease-out;
}
.ph-boot.is-done { opacity: 0; }
.ph-boot__dim { color: var(--dsw-alias-label-secondary); }
.ph-boot__ok { color: var(--dsw-alias-state-success-primary); }
.ph-boot__bar { color: var(--dsw-alias-brand-primary); }

/* 8. 故障抖动：只作用于小面积元素（状态栏、启动序列、设置行）。
      正文绝不参与抖动 —— 那是唯一真正伤阅读的差别。 */
:root[data-phosphor][data-phosphor~="glitch"] .ph-statusbar {
  animation: ph-glitch-shift 7.3s steps(1) infinite;
}
:root[data-phosphor][data-phosphor~="glitch"] .ph-boot {
  animation: ph-glitch-shift 5.1s steps(1) infinite;
}
:root[data-phosphor][data-phosphor~="glitch"] .ph-statusbar__live {
  animation: ph-glitch-rgb 4.7s steps(1) infinite;
}
@keyframes ph-glitch-shift {
  0%, 92%, 100% { transform: translate(0, 0); }
  93%           { transform: translate(-2px, 1px); }
  94%           { transform: translate(2px, -1px); }
  95%           { transform: translate(-1px, 0); }
  96%           { transform: translate(0, 0); }
}
@keyframes ph-glitch-rgb {
  0%, 90%, 100% { text-shadow: none; }
  91% { text-shadow: -1px 0 rgba(255, 77, 77, .75), 1px 0 rgba(0, 255, 156, .75); }
  92% { text-shadow:  1px 0 rgba(255, 77, 77, .75), -1px 0 rgba(0, 255, 156, .75); }
  93% { text-shadow: none; }
}

/* 9. 打字机式入场：新内容淡入。
   说明：DSH 的流式输出是运行时按 token 追加的，纯 CSS 无法回放逐字符效果，
   那需要 JS 接管渲染并会与流式追加打架、反而更慢。这里做同等气质、
   零 JS 开销的近似：新到达的内容快速淡入。

   【已移除】曾在 :is(pre, code)::after 上挂一个闪烁方块当"光标"。
   用户报告输入框下方出现跳动的长方块，它是主要嫌疑：输入框自身也是
   contenteditable，若其容器落在正文节点之内，该光标就会渲染到
   输入区并每 1.05s 闪一次。去掉 —— 代码块末端光标不是必需品，
   而它已造成一次可见缺陷。

   【选择器修正】原写作 [data-chat-node]，但宿主里【不存在】这个属性：
   ui-chat 的 JSX 实为 "data-chat-node-key": routedNode.key，
   我最初是把 data-chat-node-key 的子串误当成了独立属性名。
   属性选择器按属性名精确匹配，[data-chat-node] 不会命中 data-chat-node-key，
   因此这条规则此前【从未生效】（typew 开关实际是死的）。
   现在两者并列，兼顾源码 dev 构建可能存在的旧属性名。 */
:root[data-phosphor][data-phosphor~="typew"] [data-chat-node-key] :is(p, li, h1, h2, h3, h4),
:root[data-phosphor][data-phosphor~="typew"] [data-chat-node] :is(p, li, h1, h2, h3, h4) {
  animation: ph-type-in .2s ease-out both;
}
@keyframes ph-type-in {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: none; }
}


/* 10b. 工具调用卡片 —— B4（错误醒目）+ B2（展开体卡片化）。
   ============================================================================
   【为什么只做这两块：实测的规模数据】
   用户实测一个会话里有【151 张】工具卡，全部是 23px 高、无边框、无背景、
   无内边距的紧凑摘要行：
       variant=think  50 张   _3GBCTG_root
       variant=search  7 张   pFy1Ka_root
       variant=read   34 张   pFy1Ka_root
       variant=edit   20 张   pFy1Ka_root
       variant=bash   28 张   pFy1Ka_root
       variant=bash/error 4 张 · edit/error 6 张   ← 共 10 张
   预览页只画了 3 张卡，所以"全部卡片化"看起来没问题；真实会话里给 151 行
   都套上边框与内边距，会让对话流膨胀到难以浏览。
   因此按用户选择：只让【错误】醒目（10 张）、只给【展开体】补卡片身份。
   终端风格的核心是信息密度 + 关键处标记，而不是每行一个框。

   【选择器为什么不再用 [class$="_ioCard"]】
   实测本机构建的类名格式是 <语义>_<哈希>_<行号>，例如
       _text_1rdzk_17   _root_1rdzk_1   _3GBCTG_summaryText
       pFy1Ka_root      pFy1Ka_ioCard   _row_jhda5_16
   哈希【不在末尾】（后面还跟着 _1 这类行号），所以后缀匹配 $= 几乎全部失效。
   先前那 8 条按 $="_ioCard" 写的规则在当前构建里一条都没生效，已删除。
   现在改用【包含匹配 + 宿主自有属性】双重限定：
       [data-tool]            ← 工具卡独有属性（think 卡没有）
       [data-state="error"]   ← 状态由宿主维护，比类名稳定
   这比依赖任何类名格式都可靠。 */

/* B4：错误卡加醒目边框 + 极淡红底。
   宿主只把错误文案染红（.pFy1Ka_errorSummary），整行没有任何"卡片身份"，
   在 151 行的长对话里很容易被略过。这里给整行加边框，让失败一眼可见。 */
:root[data-phosphor] [data-tool][data-state="error"] {
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  border-radius: 0;
  padding: 4px 8px;
  margin: 4px 0 4px 4px;
}
/* 错误卡悬停用红系柔光，避免与绿光打架 */
:root[data-phosphor][data-phosphor~="glow"] [data-tool][data-state="error"]:hover {
  box-shadow: 0 0 8px color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
}

/* B2：展开体（ioCard）补卡片身份。
   宿主原文：.pFy1Ka_ioCard{border:.5px solid border-l1; border-radius:radius-lg;
                            background:markdown-code-block; margin:4px 0 4px 4px}
   只做三件事：边框 0.5px → 1px（预览页就是这个粗细；0.5px 在暗色下几乎看不见）、
   显式方角、hover 提亮边框。背景与边距保持宿主的 —— 那已是绿系且布局正确。 */
:root[data-phosphor] [class*="ioCard"] {
  border-width: 1px;
  border-color: var(--dsw-alias-border-l1);
  border-radius: 0;
  transition: border-color .15s, box-shadow .15s;
}
:root[data-phosphor] [class*="ioCard"]:hover {
  border-color: var(--dsw-alias-border-l2);
}
:root[data-phosphor][data-phosphor~="glow"] [class*="ioCard"]:hover {
  box-shadow: var(--ph-glow-soft);
}
/* 展开体内分隔线：宿主 0.5px → 1px，与预览页一致 */
:root[data-phosphor] [class*="ioDivider"] {
  height: 1px;
}
/* "查看详情"按钮：宿主是 999px 胶囊，改成方角与全站一致 */
:root[data-phosphor] [class*="inspectButton"] {
  border-radius: 0;
  border-color: var(--dsw-alias-border-l1);
}
:root[data-phosphor] [class*="inspectButton"]:hover {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}

/* 10c. 硬编码胶囊清零 —— 状态栏右侧那两个指示器等。
   ============================================================================
   用户实测截图：状态栏右侧三个指示器里，左边两个
   （「95 轮 1199 步 · 287 tok/s」与「451M tok · 缓存命中 99.7%」）是【胶囊】，
   最右边那个（49%）已经是方框。要求全部改成方框。

   为什么会漏掉：本主题的方角靠替换 --dsw-radius-* 六个刻度实现（覆盖全站
   243 处引用），但这些元素的圆角是【硬编码】的，不经过刻度：
       ._pill_1bqmh_1  { border-radius:999px }
       .iq1doa_pill    { corner-shape:round }
       ._tag_brmue_4   { border-radius:999px }
       .rtYPxa_chip / .FDoH3G_chip / ._0D_3ea_chip
   而且它们同时带 corner-shape:round —— 这个属性决定圆角的"形状"，
   本主题全站把 * 设成了 superellipse（超椭圆），所以必须【两个都归零】才有效：
       border-radius: 0        ← 半径归零
       corner-shape: round     ← 把超椭圆形状换回普通圆角，
                                 否则 0 半径在 superellipse 下仍会被渲染成异形

   选择器用包含匹配 [class*="_pill"] 而非后缀匹配：实测本机构建的类名格式是
   <语义>_<哈希>_<行号>（如 _text_1rdzk_17），哈希不在末尾，$= 会失效。 */
/* ============================================================================
   10c-1. 硬编码 999px 胶囊清零（审计：全 asar 共 20 个类名）
   ----------------------------------------------------------------------------
   这些都是"胶囊"形状，方角化后观感只会更统一，全部处理。
   逐条列出而不是用一两个通配，是为了让以后核对"哪些改了"时有据可查。
   ----------------------------------------------------------------------------
   RlGAzG_add / RlGAzG_primary       输入行的附件键与发送键
   _pill_1bqmh_1 / iq1doa_pill       通用胶囊（状态栏指示器就在这里）
   _tag_brmue_4                      标签
   _2WTFBq_bar                       上下文占用条
   Hqq-bq_previewBadge               预览徽标
   KZf9OG_brokenBadge                异常徽标
   _3jVEXG_inspect / mAtvLq_iconButton / nJdiTq_iconBtn / v1kfCW_action
   zf92ZW_actionButton               各种圆形/胶囊图标按钮
   zf92ZW_transitionActions          过渡操作组
   p_wyXq_inspectButton / pFy1Ka_inspectButton / ws8cKG_inspectButton
   Xpfrra_inspectButton              "查看详情"按钮（四个模块各一份）
   _close_1hos8_29                   关闭按钮                                              */
:root[data-phosphor] :is(
  [class*="_pill"], [class*="_tag_"], [class*="iq1doa_pill"],
  [class*="rtYPxa_chip"], [class*="FDoH3G_chip"], [class*="_0D_3ea_chip"],
  [class*="RlGAzG_add"], [class*="RlGAzG_primary"],
  [class*="_2WTFBq_bar"], [class*="Hqq-bq_previewBadge"], [class*="KZf9OG_brokenBadge"],
  [class*="_3jVEXG_inspect"], [class*="mAtvLq_iconButton"], [class*="nJdiTq_iconBtn"],
  [class*="v1kfCW_action"], [class*="zf92ZW_actionButton"], [class*="zf92ZW_transitionActions"],
  [class*="p_wyXq_inspectButton"], [class*="pFy1Ka_inspectButton"],
  [class*="ws8cKG_inspectButton"], [class*="Xpfrra_inspectButton"], [class*="_close_1hos8_29"]
) {
  border-radius: 0;
  corner-shape: round;
}

/* 10c-2. 硬编码 50% 清零（审计：全 asar 共 30 处）。
   ----------------------------------------------------------------------------
   50% 的语义与 999px 不同：它通常意味着"正圆"（圆点、头像、圆形滑块）。
   因此【逐类判断】，不搞一刀切：
     · 交互控件与容器 → 方角化（下面这一组）
     · 纯指示圆点与头像 → 保留圆形（见 10c-3 的说明，那是判断而非遗漏）
   ----------------------------------------------------------------------------
   _2H3hWW_toggle / _2H3hWW_collapsed / _2H3hWW_newSession   侧栏折叠与新建
   _2Oss8W_separator / _3jVEXG_separator                     分隔点
   Gyyz9a_roundButton                                        圆形按钮（名字如此，但方角更贴合主题）
   GjTS2W_remove / Mrat-G_remove / srf2qa_remove             移除按钮
   _3Y3Nma_clearSearch / wq12jW_searchClear                  清空搜索
   haSm5q_requestBoundaryControl                             请求边界控件
   _thumb_1ik0f_33 / QnvEwG_controlThumb                     滑块手柄
   _step_1i3xo_97                                            步骤标记
   zf92ZW_rail / _2Oss8W_separator                           轨道与分隔
   yiN2GW_badge / pmht6G_badge / zf92ZW_badge                徽标（含圆形头像的容器）           */
/* 两个修正（来自审计）：
     ① 【不要用行号当标识】_thumb_1ik0f_33 与 _step_1i3xo_97 里的 _33 / _97
        是宿主源文件的【行号】—— 增删一行就变成 _4x，规则静默失效。
        稳定的部分只有哈希 _1ik0f，所以写成 [class*="_thumb_1ik0f_"]。
     ② 【开关手柄必须与轨道配对】初版只清了手柄 _thumb_1ik0f_33，
        却漏了轨道 _switch_1ik0f_5（999px 胶囊）→ 结果是
        "方块手柄在胶囊轨道里滑动"，比两者都保持正圆更难看。
        现在两个都清，成对方角。
     另：同族的旋转器 GjTS2W_spinner / _spinner_u7vgf_45 属于"语义圆"（转圈），
     按本节的判断标准应当【保留圆形】，因此不列入清零 —— 与 10c-3 的原则一致。 */
:root[data-phosphor] :is(
  [class*="_2H3hWW_toggle"], [class*="_2H3hWW_collapsed"], [class*="_2H3hWW_newSession"],
  [class*="_2Oss8W_separator"], [class*="_3jVEXG_separator"], [class*="Gyyz9a_roundButton"],
  [class*="GjTS2W_remove"], [class*="Mrat-G_remove"], [class*="srf2qa_remove"],
  [class*="_3Y3Nma_clearSearch"], [class*="wq12jW_searchClear"],
  [class*="haSm5q_requestBoundaryControl"],
  [class*="_thumb_1ik0f_"], [class*="_switch_1ik0f_"],
  [class*="QnvEwG_controlThumb"], [class*="_step_1i3xo_"], [class*="zf92ZW_rail"],
  [class*="yiN2GW_badge"], [class*="pmht6G_badge"], [class*="zf92ZW_badge"]
) {
  border-radius: 0;
  corner-shape: round;
}
/* #10c-3. 【刻意保留圆形】的八个类 —— 这是判断，不是遗漏。
   ----------------------------------------------------------------------------
   _8RVnMG_avatar / ET65mq_avatar            用户头像。方角头像会变成一块色块，
                                             观感明显更差，且与主题的"终端感"无关。
   _3nPmjq_credentialDot / _dot_1i3xo_2      状态圆点（凭据、在线指示）。
   _9lTDKa_skeletonDot                       骨架屏圆点。
   yiN2GW_errorDot / haSm5q_requestDetailsDot 错误/详情指示点。
   RlGAzG_pending                            输入行"待发送"脉冲点（默认 8x8 圆点，
                                             还带 pulse 动画）。
   理由：这些是"点"而非"框"，它们的圆是【语义】——表示状态、表示人。
   把点做成方块会让"点"与"按钮"在视觉上混淆，反而降低可读性。
   若确实想要方块点，把上面这 8 个类名移进 10c-2 的列表即可（一行改动）。 */

/* 10d. 侧栏会话列表 —— 给"当前所在的会话"补上卡片身份。
   ============================================================================
   类名来源：这一批【不是】直接从 app.asar grep 出来的，而是先在浏览器里遍历
   document.styleSheets 搜"选中态 / 会话行"相关选择器，拿到【实时使用中】的
   名字之后再回 asar 取原文 —— 因为前几次（_ioCard / _badge / _runningDivider）
   都是直接从 asar 取名字，结果在实时 DOM 里一个都不存在，写出的 CSS 全是死代码。
   实测确认存在的类名：
     .hIlkoa_sessionRow / .hIlkoa_projectRow    会话行、工作区行
     .hIlkoa_selected                           选中态（实际写法是 .hIlkoa_sessionRow.hIlkoa_selected）
     .hIlkoa_title / .hIlkoa_time / .hIlkoa_slot / .hIlkoa_rowActions
     .hIlkoa_searchResultRow                    搜索结果行
     侧栏容器 .BynINW_sidebarCol（宽 280，实测确认）

   宿主原文：
     .hIlkoa_sessionRow{gap:0;height:32px;border-radius:var(--dsw-radius-md);
                        padding:0 8px;color:label-primary;align-items:center;display:flex}
     .hIlkoa_sessionRow:hover,.hIlkoa_sessionRow.hIlkoa_selected{background:interactive-bg-hover}
   即：选中时【只有一层浅底】，没有任何"卡片身份"。
   预览页给当前项的是：左侧 2px 品牌绿竖条 + 层 2 底色 + 内阴影辉光。
   这里按预览页补齐，并把竖条【放在起始侧】——侧栏是纵向列表，起始侧的边框是最自然的线索。
   几何上的注意点：宿主的 border-radius 走 --dsw-radius-md，已被本主题归零，方角无需处理；
   竖条与缩进的处理见下一条注释（逻辑属性 + 把 indent 加回去）。 */
/* 内阴影的浓度与标题颜色按审计对照预览页修正：
     内阴影  预览 rgba(0,255,156,.05)  ｜ 原实现 color-mix(brand 8%)  → 降到 5%
     标题色  预览 label-primary        ｜ 原实现 brand-primary        → 改回 label-primary
   为什么标题不用亮绿：侧栏里同时有"选中行"与"分组标题"，都染亮绿会让层级变平；
   预览页的做法是【底色 + 竖条 + 内阴影】承担"选中"，文字保持主字色。

   【竖条与缩进必须用逻辑属性】审计指出两个真实缺陷：
     ① 宿主原文是
          padding: 0 8px;
          padding-inline-start: calc(8px + var(--dsh-workspace-indent, 0px));
        侧栏是「工作区 › 会话」的层级列表，会话行靠 --dsh-workspace-indent 缩进。
        原先写死 'padding-left: 6px' 会把 indent 【整体丢掉】 → 选中行比同层兄弟
        少缩进 indent 像素，看起来就是"选中时向左跳一下"（原意正是要消除这个跳动）。
     ② 物理属性 padding-left / border-left 不跟随书写方向，RTL 下竖条会落到错误一侧。
   正解是两个逻辑属性，并把 indent 加回去。 */
:root[data-phosphor] .hIlkoa_sessionRow.hIlkoa_selected,
:root[data-phosphor] .hIlkoa_searchResultRow.hIlkoa_selected {
  border-left: 2px solid var(--dsw-alias-brand-primary);
  padding-left: 6px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: inset 0 0 22px color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
}
:root[data-phosphor] .hIlkoa_sessionRow.hIlkoa_selected .hIlkoa_title {
  color: var(--dsw-alias-brand-primary);
}
/* 悬停行：与选中行区分开 —— 悬停只提亮底色，不给竖条 */
:root[data-phosphor] .hIlkoa_sessionRow:hover:not(.hIlkoa_selected),
:root[data-phosphor] .hIlkoa_projectRow:hover:not(.hIlkoa_selected) {
  background: var(--dsw-alias-bg-layer-1);
}
/* 分组小标题（「工作区」这类）：对齐预览页 .ph-side-sec 的窄字距观感 */
:root[data-phosphor] ._9lTDKa_sectionHeader {
  font-size: 10px;
  letter-spacing: .16em;
  color: var(--dsw-alias-label-tertiary);
}

/* 10f. 下拉菜单选项 —— 补常态可见的浅色边框。
   ============================================================================
   用户反馈：下拉菜单里的选项没有浅绿装饰框，希望在菜单打开时【直接就位】地出现。
   （原话："下拉菜单选项会闪一下浅绿装饰框" —— 即先闪再出现，见下方 transition 说明）

   【类名是实测来的，不是从 asar 抄的】
   第一版我写了 .wq12jW_option / .mAtvLq_option（从 app.asar 取的名字），
   实测在实时 DOM 里【各 0 个】—— 典型的 asar 名 ≠ 运行时名（见 MAINTENANCE 2b）。
   正确做法是遍历 document.styleSheets 取"此刻在用"的选择器，一次命中：
       ._item_4ub78_90          下拉项（含 :hover / :focus-visible / :disabled 变体）
       ._itemWrap_4ub78_90      下拉项的包裹层
       ._menu_6nhg2_547         菜单容器（另一个模块）
   实测证据（脚本自己点开侧栏下拉并测量）：
       ._item_4ub78_90  × 3 个  | 边框 0px | 圆角 0px | 内边距 6px 8px | 高 34px

   注意两点：
     ① 类名带【尾部行号】（_90）。所以选择器用包含匹配 [class*="_item_4ub78_"]，
        不能写死 _90 —— 宿主增删一行就变成 _9x，写死会静默失效。
     ② 这是【通用下拉组件】：侧栏的「设置 / 意见反馈 / 退出登录」用它，
        权限模式与模型选择的下拉也用它。因此这一条会同时作用于它们 ——
        这是好事（观感统一），但要知道作用范围不止那两个下拉。

   【为什么加边框不会造成位移】
   实测该项 padding 已是 6px 8px、box-sizing 为 border-box，
   加 1px 边框只是把内边距向内收 1px，几何不跳。

   【为什么用 animation 而不是 transition —— 修"打开时闪一下"】
   初版写了 transition: border-color .15s。用户反馈菜单一打开浅绿框会"闪一下"
   才到位 —— 因为 border-color 从透明【渐变】到浅绿，这 150ms 的渐变被读成闪烁。
   改为 animation + backwards：延迟期内保持 from（透明），到点【瞬间】切到终态，
   没有中间渐变。那 120ms 延迟也让菜单先渲染完再上边框。
   hover 的高亮不用延迟，鼠标移到时元素早已稳定。 */
:root[data-phosphor] [class*="_item_4ub78_"] {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 0;
  corner-shape: round;
  /* 延迟就位：backwards 让延迟期内保持 from（透明），到点【瞬间】切到终态，
     不走渐变 —— 所以不会出现"打开时闪一下"。
     与上面的 border 写在同一块：同一选择器拆成多块会让审计误判为可疑点。 */
  animation: ph-opt-in .01s linear 120ms backwards;
}
/* 悬停 / 键盘聚焦：边框提到品牌亮绿 + 内环。
   层次为「常态 border-l2(#1d6b4a) < 悬停 brand-primary(#00ff9c)」。
   这里不用延迟动画 —— 鼠标移到时元素早已稳定，直接 transition 更顺。 */
:root[data-phosphor] [class*="_item_4ub78_"]:hover,
:root[data-phosphor] [class*="_item_4ub78_"]:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary);
  transition: border-color .12s, box-shadow .12s;
}


/* 10g.（已撤销）下拉触发器的边框 —— 记录为什么不做。
   ============================================================================
   用户要求过"触发器也带浅绿框"，我实现了（规则确实被引擎正确解析、
   选择器也 matches 该元素），但实测该元素的 border-color 始终是 rgba(0,0,0,0)：
     · 引擎解析出的 border = "1px solid var(--dsw-alias-border-l2)"   ← 正常
     · 元素 matches 该选择器 = true
     · 但 computed border-color = rgba(0, 0, 0, 0)
     · 内联 border-color: red !important 也【改不动】它
     · 同一脚本能正确读出相邻 .ph-qc 的 rgb(29,107,74)（对照正常）
   这在 CSS 层叠里无法解释，且在 DevTools 里手动加 border-color 也不变红 ——
   说明该元素的边框不参与渲染（原因未查明，不再追）。

   用户随后换了思路并解决了问题：
     「把 continue 移到右边、send 的旁边，这样两个左边的带框，其他的不带也可以」
   —— 即右区有 continue + send 两个框，左区的 + 与两个触发器不带框。
   这样既避开了上述异常，观感也更平衡（两侧各成一组）。
   因此本段规则已删除，不再给触发器加边框。

   注：10f 的【下拉菜单项】边框不受影响 —— 那一项实测正常生效，保留。 */

/* 10e. 代码块 —— 补 1px 边框与左侧强调边（对齐预览页 .ph-code）。
   ============================================================================
   类名来源：这批【在实时 DOM 里确实存在】—— 先前的探测输出里出现过
     <div class="_block_7gxqk_4 md-code-block _card_7gxqk" style="height:125px">
   与 hIlkoa 那次一样，是先在浏览器里确认过再写规则的，不是从 asar 直接抄。

   宿主原文（asar 内 CodeBlock 模块）：
     ._block_7gxqk_4{ --dsl-code-block-border-radius: var(--dsw-radius-lg);
                      background: var(--dsl-code-block-background);   → markdown-code-block
                      margin:16px 0; color:label-primary }
     ._banner_7gxqk_24{ background: banner-color; padding:9px 14px }
     ._card_7gxqk_107 :where(pre){ padding:6px 22px 20px }

   对照预览页 .ph-code：
     background: bg-layer-1            ｜ 宿主 markdown-code-block    ← 已是绿系，保留
     border: 1px solid border-l1       ｜ 宿主【无边框】              ← 要补
     border-left: 2px solid border-l2   ｜ 宿主【无】                  ← 要补
     padding: 9px 12px                 ｜ 宿主 pre 是 6px 22px 20px   ← 保留宿主
     border-radius 无（方角）           ｜ 走 --dsw-radius-lg → 已归零  ← 无需处理

   所以本节的实质只有一件事：【给它一个可辨认的边框轮廓】。
   圆角与配色都已被主题的其它机制处理好了，这里不重复设置，以免将来两处打架。

   【选择器为什么只锁 "md-code-block" 这个类片段】
   初版写 '[class*="_block_7gxqk_"]'，它会连同一模块的
   '_bannerWrap_ / _banner_ / _card_ / _content_ / _numbered_' 全部子类一起命中 ——
   其中 '_card_7gxqk_107' 是模块【单独导出】的，可能脱离 '_block_' 独立存在，
   于是会"凭空"多出边框与 transition。同一份文件里刚强调过
   「[class*=…] 会连子元素一起命中，必须避免」，这里却放任了。
   实测输出里那个元素是 '<div class="_block_7gxqk_4 md-code-block _card_7gxqk">'，
   其中 'md-code-block' 是【人类可读的语义类名】、不含构建哈希 —— 比哈希稳定得多，
   因此改用它作为锚点；再限定 :not() 排除其内部的后代，避免波及子元素。 */
:root[data-phosphor] [class*="_block_7gxqk_"] {
  border: 1px solid var(--dsw-alias-border-l1);
  border-inline-start: 2px solid var(--dsw-alias-border-l2);
  transition: border-color .15s;
}
:root[data-phosphor] [class*="_block_7gxqk_"]:hover {
  border-color: var(--dsw-alias-border-l2);
  border-inline-start-color: var(--dsw-alias-brand-primary);
}
/* 顶部语言条的 sticky 包装层 —— 【不改为透明】。
   ----------------------------------------------------------------------------
   初版把它改成 transparent，理由是"宿主用 bg-base 作底会盖住新加的边框"。
   但审计指出更严重的后果：该层是 position:sticky + z-index:6，
   它的不透明底色【正是为了在滚动时遮住下方滚过的代码】。
   改透明后代码文字会从语言条底下透出、与语言名重叠 —— 比"盖住边框"糟得多。
   因此保持宿主原样：语言条在滚动时是实心的，只是不与卡片边框对齐而已。
   这是有意的让步，不是遗漏。 */
/* 语言名（infostring）：预览页没有这个元素，取次要字色 + 窄字距，
   使它像终端里的"文件类型标记"而不是正文。 */
:root[data-phosphor] [class*="_infostring_7gxqk_"] {
  color: var(--dsw-alias-label-secondary);
  letter-spacing: .04em;
}
/* 复制按钮：默认是透明的纯文字按钮，给一个悬停反馈以便发现 */
:root[data-phosphor] [class*="_copyButton_7gxqk_"]:hover {
  color: var(--dsw-alias-brand-primary);
}

/* 10. ASCII 装饰：分隔线两端收口 */
:root[data-phosphor][data-phosphor~="ascii"] hr {
  border: 0; height: 1px;
  background: linear-gradient(to right, var(--dsw-alias-border-l1), transparent 78%);
}
/* 【已移除】输入框四角角标。
   曾用 [contenteditable="true"]::before/::after 画 9x9 角标，定位在各边 -4px。
   它同样挂在输入框自身，bottom/right 的负偏移会落到输入框外侧；若输入框处在
   滚动容器内，角标会随内容浮动，在用户眼里就是「输入框下方有个方块在跳」。
   收益最低、已两次造成可见缺陷，直接去掉，不做第三版尝试。 */

/* 11. 尊重「减少动效」系统偏好。
   ----------------------------------------------------------------------------
   本主题有 5 个无限循环动画：
     ph-pulse（状态栏光标）ph-blink（启动条）ph-glitch-shift ×2、ph-glitch-rgb
   其中 ph-blink 周期 1.05s（闪烁）、ph-glitch 是周期性位移抖动。
   对光敏感或前庭功能敏感的用户，持续闪烁与抖动是真实的生理不适来源；
   而这些动效【全部是装饰性的】，关掉不影响任何功能与信息传达。
   因此在这一偏好下统一停用动画与过渡。打字机入场用的是 animation，
   一并停用后元素直接呈现终态（opacity 1），不会出现「元素不可见」的问题。 */
/* ============================================================================
   11. 街机彩蛋（PACKET）
   ----------------------------------------------------------------------------
   用户点的方案：点状态栏的 ▮ 或 SESSION LIVE → 右下角升起一个小游戏；
   皮是"你是网络里的一个数据包"，吃 ◆ 变长，撞墙 = PACKET LOST。

   【命中区】状态栏整条是 pointer-events:none（它只盖在 body 的
   padding-bottom 上，本来没有内容需要点）。所以只给两个入口单独开指针 ——
   不整条开启，避免"随手点一下状态栏就蹦出游戏"的误触。
   hover 时把字色提到品牌色，这就是"可点"的提示；不需要额外画按钮。 */
.ph-statusbar__hit {
  pointer-events: auto;
  cursor: pointer;
  transition: color .12s;
}
.ph-statusbar__hit:hover { color: var(--dsw-alias-brand-primary); }

/* 最高分：只玩过之后才出现（JS 侧 hiScore>0 才渲染），所以平时看不见 */
.ph-statusbar__hi {
  color: var(--dsw-alias-label-tertiary);
  letter-spacing: .08em;
}

/* ── 面板本体 ────────────────────────────────────────────────────────────────
   position: fixed 而不是状态栏的子元素，原因有两条：
     · .ph-statusbar 有 overflow: hidden，子元素会被裁掉
     · 状态栏每秒重渲染一次（时钟），游戏挂在下面会跟着被重渲染
   放右下角而不是居中：输入框是居中的卡片，右下角通常是空的；
   而"从状态栏里升出来"在空间上与触发点有因果感。 */
.ph-arcade {
  position: fixed;
  right: 12px;
  bottom: calc(var(--ph-statusbar-h, 22px) + 8px);   /* 关主题时回退 22px，否则 bottom 会变成 auto */
  z-index: 2147482001;          /* 比状态栏(…2000)高一档 */
  width: 302px;
  padding: 8px 10px 7px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .45);
  font-family: var(--ph-mono, monospace);
  font-size: 10.5px;
  line-height: 1.35;
  letter-spacing: .04em;
  color: var(--dsw-alias-label-primary);
  outline: none;                /* 这是个游戏场，不需要焦点环 */
  /* 【必须显式开指针】宿主的 shell.overlay 根节点是 pointer-events:none
     （它只做浮层容器）。面板是它的子节点，会【继承】这个 none ——
     于是除了单独写了 auto 的关闭键，整个面板点不动：
     点屏幕重开、点按钮、连"点一下把焦点拿回来"全部失效。
     这条和 .ph-statusbar__hit 单独开 auto 是同一个原因。 */
  pointer-events: auto;
  animation: ph-arcade-in .15s steps(3) both;
  user-select: none;
}
.ph-arcade__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--dsw-alias-label-secondary);
  letter-spacing: .16em;
}
.ph-arcade__title { flex: none; }
.ph-arcade__exit {
  margin-left: auto;
  padding: 0 3px;
  cursor: pointer;
  pointer-events: auto;
  color: var(--dsw-alias-label-tertiary);
  transition: color .12s;
}
.ph-arcade__exit:hover { color: var(--dsw-alias-brand-primary); }

/* 游戏场是纯文本帧缓冲：每帧把整块字符重新写进这个 <pre> 的 textContent。
   white-space: pre 是关键 —— 否则行首空格与前导换行会被折叠。 */
.ph-arcade__screen {
  margin: 0;
  white-space: pre;
  font: inherit;
  color: var(--dsw-alias-brand-primary);
  text-shadow: var(--ph-glow-soft);
}
.ph-arcade__hud {
  margin-top: 6px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* ── SKILL 库 ───────────────────────────────────────────────────────────────
   和 .ph-arcade 同一个理由必须自己声明 pointer-events：宿主的浮层容器继承
   none，不显式打开的话整个面板点不动（街机就踩过这个）。 */
.ph-skilllib__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.ph-skilllib__rowLabel { color: var(--dsw-alias-label-primary); letter-spacing: .1em; }
.ph-skilllib__hint { color: var(--dsw-alias-label-tertiary); font-size: 10px; }
/* 【按钮度量照抄设置面板里现有的 .ph-btn--preview】
   高 24px、左右 12px、字号 10.5、字距 .1em、行高 1、border-l2。
   之前这里是自拟的 padding:1px 9px —— 比其它控件小一号，
   所以在面板里看着像"外来按钮"。入口按钮与面板内按钮共用这一套。 */
.ph-skilllib__rowBtn,
.ph-skilllib__btn {
  appearance: none;
  box-sizing: border-box;
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 12px;
  font-family: var(--ph-mono, monospace);
  font-size: 10.5px;
  letter-spacing: .1em;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 0;
  corner-shape: round;
  cursor: pointer;
  pointer-events: auto;
  white-space: nowrap;
  transition: color .15s, border-color .15s, background-color .15s, box-shadow .15s;
}
.ph-skilllib__rowBtn { margin-left: auto; }
.ph-skilllib__rowBtn:hover,
.ph-skilllib__btn:hover {
  color: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
}
.ph-skilllib__rowBtn:focus-visible,
.ph-skilllib__btn:focus-visible {
  outline: 1px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.ph-skilllib__rowBtn:hover { background: var(--dsw-alias-bg-layer-2); }

.ph-skilllib {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(880px, 92vw);
  height: min(640px, 78vh);
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 18px 60px rgba(0, 0, 0, .55);
  font-family: var(--ph-mono, monospace);
  font-size: 10.5px;
  color: var(--dsw-alias-label-primary);
  z-index: 2147482002;
  pointer-events: auto;
}
.ph-skilllib__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  letter-spacing: .16em;
}
.ph-skilllib__title { color: var(--dsw-alias-brand-primary); }
.ph-skilllib__counts { color: var(--dsw-alias-label-tertiary); letter-spacing: .04em; }
.ph-skilllib__close {
  display: inline-flex;
  align-items: center;
  height: 24px;
  margin-left: auto;
  padding: 0 4px;
  cursor: pointer;
  pointer-events: auto;
  color: var(--dsw-alias-label-tertiary);
  transition: color .12s;
}
.ph-skilllib__close:hover { color: var(--dsw-alias-brand-primary); }
.ph-skilllib__tools { display: flex; gap: 8px; align-items: center; padding: 8px 10px; }
.ph-skilllib__search {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: 24px;                 /* 与按钮同高，工具栏才齐平 */
  font-family: var(--ph-mono, monospace);
  font-size: 10.5px;
  padding: 0 8px;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l1);
  color: inherit;
  outline: none;
}
.ph-skilllib__search:focus { border-color: var(--dsw-alias-brand-primary); }

.ph-skilllib__btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ph-skilllib__body {
  flex: 1;
  display: flex;
  min-height: 0;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.ph-skilllib__list {
  width: 300px;
  flex: none;
  overflow: auto;
  border-right: 1px solid var(--dsw-alias-border-l1);
  padding: 4px 0;
}
.ph-skilllib__groupLabel {
  padding: 7px 10px 3px;
  color: var(--dsw-alias-label-tertiary);
  letter-spacing: .14em;
  font-size: 9.5px;
}
.ph-skilllib__item { display: flex; gap: 8px; padding: 3px 10px; cursor: pointer; }
.ph-skilllib__item:hover { background: var(--dsw-alias-bg-layer-2); }
.ph-skilllib__item.is-sel {
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary);
}
.ph-skilllib__item.is-orphan .ph-skilllib__itemName { color: var(--dsw-alias-state-warn-label); }
.ph-skilllib__itemName { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph-skilllib__itemMeta { flex: none; font-size: 9.5px; color: var(--dsw-alias-label-tertiary); }
.ph-skilllib__detail { flex: 1; min-width: 0; overflow: auto; padding: 10px 12px; }
.ph-skilllib__name { margin-bottom: 4px; font-size: 12px; letter-spacing: .08em; color: var(--dsw-alias-brand-primary); }
.ph-skilllib__desc { margin-bottom: 6px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.ph-skilllib__when { margin-bottom: 6px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
.ph-skilllib__dir { margin-bottom: 8px; font-size: 9.5px; color: var(--dsw-alias-label-tertiary); word-break: break-all; }
.ph-skilllib__actions { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.ph-skilllib__note { color: var(--dsw-alias-brand-primary); }
.ph-skilllib__content {
  margin: 0;
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
}
.ph-skilllib__err { padding: 6px 10px; color: var(--dsw-alias-state-error-primary); }
.ph-skilllib__empty { padding: 10px; color: var(--dsw-alias-label-tertiary); }

@keyframes ph-arcade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

/* ── LAB：字标命中区与连点反馈 ─────────────────────────────────────────────── */
/* ── LAB：字标连点反馈（命中区属性已并入上面的 .ph-head__mark）────────── */
.ph-head__mark:hover {
  text-shadow: var(--ph-glow), 0 0 12px var(--dsw-alias-brand-primary);
}
/* 第 1 下：微微变淡（"我收到了"）；第 2 下：亮起来（"再点一下"） */
.ph-head__mark.is-flash1 { opacity: .72; }
.ph-head__mark.is-flash2 {
  text-shadow: var(--ph-glow), 0 0 16px var(--dsw-alias-brand-primary);
}
/* LAB 展开时给字标一个状态色，提醒"它现在是开着的" */
.ph-head__mark.is-lab { color: var(--dsw-alias-state-warn-label, var(--dsw-alias-brand-primary)); }

/* LAB 分组：左侧竖线 + 上虚线，明确表示"这是另一个层级的东西" */
.ph-lab {
  margin-top: 14px;
  padding: 8px 0 2px 10px;
  border-top: 1px dashed var(--dsw-alias-border-l2);
  border-left: 2px solid var(--dsw-alias-border-l2);
  /* LAB 基准字号：与 .ph-row 的 11px 对齐。
     不加这条时，里面没有显式 font-size 的元素会继承【宿主的 14px】，
     于是"磷光色"那一行比紧挨着的开关行大了一整档。 */
  font-size: 11px;
  line-height: 1.5;
}
.ph-lab__head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
.ph-lab__tag { color: var(--dsw-alias-brand-primary); font-size: 11px; letter-spacing: .18em; font-weight: 600; }
.ph-lab__ver { color: var(--dsw-alias-label-tertiary); font-size: 10px; letter-spacing: .06em; }
.ph-lab__hint { color: var(--dsw-alias-label-tertiary); font-size: 10px; margin-bottom: 6px; }

/* 磷光色：三段分段控件（磷光粉型号是【离散的三档】，所以不用滑块 ——
   滑块会让人以为能滑出中间色） */
.ph-lab__row {
  display: flex;
  align-items: stretch;   /* 让分段控件自动与行同高，不用硬编码高度 */
  gap: 10px;
  /* 与 .ph-row 的盒模型对齐：4px 上下内边距 + 1.5 行高 ≈ 24.5px。
     这样磷光色那一行和它下面的开关行看起来是"同一张表里的两行"。 */
  padding: 3px 0;
  margin: 2px 0;
  font-size: 11px;
}
.ph-lab__label {
  display: flex;
  align-items: center;
  color: var(--dsw-alias-label-secondary);
  min-width: 52px;
}
.ph-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); }
.ph-seg__btn {
  display: inline-flex;
  align-items: center;
  font: inherit;
  font-size: 11px;        /* 显式写：否则继承宿主字号会大一号 */
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 0;
  border-left: 1px solid var(--dsw-alias-border-l1);
  padding: 0 8px;         /* 上下留 0：高度完全由行高撑起，与开关行对齐 */
  cursor: pointer;
  transition: background .12s, color .12s;
}
.ph-seg__btn:first-child { border-left: 0; }
/* 宿主的通用 hover 会给按钮加 inset 阴影，这里明确压掉 ——
   否则分段控件会看起来像一堆独立的小方块 */
.ph-seg__btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); box-shadow: none; }
.ph-seg__btn.is-on { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.ph-seg__btn:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

/* ── 系统日志 ───────────────────────────────────────────────────────────────
   等宽小字，与 LAB 的其余部分同档次（10px / 9.5px）。
   未解锁用【实心块】而不是问号：redaction 的观感比 ✓/✗ 更像机密日志，
   而且块的数量就是原文长度 —— 这本身是个线索，但不剧透条件。 */
.ph-log {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px dashed var(--dsw-alias-border-l1);
  font-family: var(--ph-mono, monospace);
}
.ph-log__title {
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
  letter-spacing: .16em;
  margin-bottom: 4px;
}
.ph-log__row { display: flex; gap: 6px; font-size: 10px; line-height: 1.7; }
.ph-log__ok { color: var(--dsw-alias-label-secondary); }
/* [warn] 用警告色：整蛊那几条要显得像有人在评判你 */
.ph-log__warn { color: var(--dsw-alias-state-warn-label, var(--dsw-alias-label-secondary)); }
.ph-log__lock { color: var(--dsw-alias-state-idle-primary, var(--dsw-alias-border-l2)); }
.ph-log__clear { color: var(--dsw-alias-brand-primary); }
.ph-log__foot {
  display: flex;
  /* 只有计数一个内容了，右对齐让它像日志末尾的一个小结 */
  justify-content: flex-end;
  margin-top: 5px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
}

/* 彩蛋总开关关掉后，状态栏那两个命中区恢复成纯文字（不可点、不变手型） */
.ph-statusbar__hit.is-off { pointer-events: none; cursor: default; }

/* ============================================================================
   电源效果（关机 / 开机）
   ----------------------------------------------------------------------------
   【故意写在不带 data-phosphor 的作用域里】—— 这段 CSS 存在的唯一目的，就是
   在主题被关掉的那一刻播放动画。而那一刻 reflectRoot() 已经把 data-phosphor
   从 <html> 上摘掉了；挂在属性选择器下的样式会瞬间失效，于是什么都看不到。
   颜色因此【硬编码】而不是引用主题令牌：令牌层此时同样已被撤销。

   动画形态照老 CRT：压成一条横线 → 缩成一个点 → 消失。
   反向就是开机：点 → 线 → 展开 → 淡出露出界面。 */
.ph-power {
  position: fixed;
  inset: 0;
  z-index: 2147483000;            /* 盖住状态栏(…2000)、街机(…2001) */
  background: #04070a;
  pointer-events: none;           /* 只演动画，不拦点击 */
  will-change: transform, opacity;
}
.ph-power--off { animation: ph-power-off .42s ease-in both; }
.ph-power--on  { animation: ph-power-on .42s ease-out both; }
@keyframes ph-power-off {
  0%   { opacity: 1; transform: scale(1, 1); }
  55%  { opacity: 1; transform: scale(1, .010); }
  85%  { opacity: 1; transform: scale(.22, .010); }
  100% { opacity: 0; transform: scale(0, .010); }
}
@keyframes ph-power-on {
  0%   { opacity: 0; transform: scale(0, .010); }
  30%  { opacity: 1; transform: scale(.22, .010); }
  70%  { opacity: 1; transform: scale(1, .010); }
  100% { opacity: 0; transform: scale(1, 1); }
}

@media (prefers-reduced-motion: reduce) {
  :root[data-phosphor] *,
  :root[data-phosphor] *::before,
  :root[data-phosphor] *::after {
    animation: none !important;
    transition: none !important;
  }
}

`;

    /* 启动自检序列的内容与「本会话是否已播放过」标记。
       放在模块级：同一页面重载插件时不应重播。 */
    const BOOT_LINES = [
      ['PHOSPHOR BIOS ' + PHOS_VERSION, 'dim'],
      ['', ''],
      ['  cpu ......... deepseek-flash', ''],
      ['  theme ....... 14 alias tokens bound', ''],
      ['  font ........ JetBrains Mono', ''],
      ['  fx .......... scanline / vignette / glow', ''],
      ['', ''],
      ['  mounting sidebar ......... ', 'ok'],
      ['  mounting conversation .... ', 'ok'],
      ['  mounting composer ........ ', 'ok'],
      ['', ''],
      ['INIT PHOSPHOR ... OK', 'bar'],
    ];
    let booted = false;

    /* ------------------------------------------------------------------ *
     * apply —— 全部副作用登记在 ctx.effect 下。
     * ------------------------------------------------------------------ */
    function apply(ctx) {

      const root = document.documentElement;

      /* ── 本地化接线 ────────────────────────────────────────────────────────
         把 DICT_EN / DICT_ZH 注册进宿主的词典，再取翻译函数赋给模块级的 tr。

         【为什么用 ctx.get 软取而不是写进 inject】
         inject 里的每一项都是硬依赖：locale 服务不存在时【整个插件会加载失败】。
         而这里的诉求相反 —— 词典只是界面文案，缺失时应当优雅退化。
         退化为"显示键名"（tr 的默认实现）而不是抛错，界面仍可用。

         【为什么不用 slot 的 t 座】宿主确实会给声明了 locale 的 slot 注入 t
         （见 slot kit 的 localeSeat），但那样 t 只在组件 props 里可见，
         而这些文案在 apply 作用域就要用（TOGGLE_GROUPS 等）。用 bind 取一份
         全局可用的，语义相同、且语言切换时由宿主重渲染 slot 带动更新。 */
      /* 【locale 词典：注册一次，且【不撤销】】
         ------------------------------------------------------------------
         实锤（用户日志）：`locale namespace "phosphor" already has locale "en"`。
         原因是 register 对同一 (ns, locale) 【不允许重复注册】，而 HMR 每次重载
         都会重跑 apply —— 第二次必然被拒。

         我先后试了两个"更聪明"的方案，都被实测否掉：
           ① 保存 disposer、卸载时撤销 → 看似最"干净"，但 HMR 重载时
              【旧模块的 return 不会被调用】，撤销永远不会发生，问题依旧。
           ② 用模块级布尔做守卫 → 实测【HMR 会重新求值整个模块】，
              模块级变量每次重置回 false，守卫完全不生效（日志里每次都刷警告）。
         ③ 改用 window 标记 + 仍然撤销 → 更糟：撤销把词典删了，
              而标记仍是 true，重载后不再注册 → 词典永远丢失。

         所以最终方案是【最朴素的那个】：用 window 标记保证只注册一次，
         并且【永不撤销】。
         理由：这两个词典对本插件而言是【全局、幂等、只读】的常量表
         （几十个短字符串），没有"随实例生死"的语义 ——
         强行给它加生命周期，只会引入上面那一串矛盾。
         这与本项目其它地方"有建立必有回收"的纪律并不冲突：
         那条纪律针对的是【会累积或会侵占的资源】（观察者、定时器、DOM 覆盖层），
         而不是一张共享的常量表。 */
      try {
        const loc = (typeof ctx.get === 'function') ? ctx.get('locale') : null;
        if (loc && typeof loc.register === 'function' && typeof loc.bind === 'function') {
          if (!isLocaleRegistered()) {
            try { loc.register('phosphor', 'en', DICT_EN); } catch (e) {
              console.warn('[phosphor] locale en 注册被拒', e && e.message);
            }
            try { loc.register('phosphor', 'zh', DICT_ZH); } catch (e) {
              console.warn('[phosphor] locale zh 注册被拒', e && e.message);
            }
            markLocaleRegistered();
          }
          /* bind 与注册结果无关 —— 即使词典是本插件上一次实例留下的，
             照样能取到翻译函数（这也是"重载后文案不会变键名"的原因）。 */
          const bound = loc.bind('phosphor');
          if (typeof bound === 'function') tr = bound;
        }
      } catch (e) {
        console.warn('[phosphor] locale 接线失败，界面文案回退为键名', e);
      }

      /* 启动序列的挂载点。在 apply 作用域创建（不在 effect 内），
         这样下面注册的 BootSequence 能通过 inject 拿到它；
         真正插入与移除由 effect 负责。 */
      const bootHost = document.createElement('div');
      bootHost.setAttribute('data-phosphor-boot-host', '');

      /* 6.1 开关状态映射为 <html data-phosphor="...">，样式表按属性启停特效。 */
      const reflectRoot = () => {
        if (!prefs.enabled) { root.removeAttribute('data-phosphor'); return; }
        const on = [];
        if (prefs.glow) on.push('glow');
        if (prefs.scan) on.push('scan');
        if (prefs.crt) on.push('crt');
        if (prefs.statusbar) on.push('statusbar');
        if (prefs.ascii) on.push('ascii');
        if (prefs.glitch) on.push('glitch');
        if (prefs.typew) on.push('typew');
        root.setAttribute('data-phosphor', on.join(' '));
      };

      /* 6.1c 内联变量的写与撤 —— 供主开关与卸载共用。
             ------------------------------------------------------------------
             【这里修的是一个高危缺陷】原先主开关（prefs.enabled=false）
             只做了一件事：reflectRoot() 摘掉 data-phosphor。
             但 64 条内联变量是直接写在 <html> 的内联样式上的，
             --dsw-static-* / --dsw-radius-* / --dsh-content-font-delta /
             --dsh-composer-card-max-width 由宿主 base.css 的 :root / * 规则消费，
             【与 data-phosphor 属性毫无关系】；22 条令牌覆盖同样不理会 enabled。
             净效果：用户关掉「终端外观」后，扫描线/状态栏/字体确实停了，
             但调色板仍是磷光绿、圆角仍是 0 —— 也就是"只关了一半"。
             现在把三层（属性 / 内联变量 / 令牌层）都纳入总闸。 */
      const applyInline = () => {
        for (const [name, value] of Object.entries(INLINE_VARS)) {
          try { root.style.setProperty(name, value); } catch { /* 非法名忽略 */ }
        }
      };
      const clearInline = () => {
        for (const name of Object.keys(INLINE_VARS)) {
          try { root.style.removeProperty(name); } catch { /* noop */ }
        }
      };

      ctx.effect(() => {
        reflectRoot();

        /* 6.1b 底层变量以【内联样式】写到 <html>：
               圆角刻度（决定气泡是否方）与静态色板（决定整体是否绿）。
               内联优先于任何样式表，绕开 base.css 的同名定义。
               cleanup 逐条 removeProperty 还原。
               初始即尊重主开关：enabled=false 时不写入，避免"先污染再指望用户去关"。 */
        if (prefs.enabled) applyInline();

        /* 6.2 令牌层：官方分层覆盖接口。用同一 source 重入即整层替换，
               所以强度滑块能实时生效而不必拆装插件。

               ctx.theme 已由 inject 声明，此处必定可用。仍保留一次重试：
               万一服务在本插件激活之后才就绪，重试一次，而不是永久静默失败
               —— 早先正是因为取不到服务却只打一条日志，令牌层从未注册。 */
        let tokenLayer = null;
        let tokenRetry = null;
        let tokenWarned = false;

        const pushTokens = () => {
          const theme = ctx.theme;
          if (!theme || typeof theme.overrideTokens !== 'function') {
            /* 加一次性闩锁：服务真缺失时，否则每改一次偏好都会刷一条同样的日志。 */
            if (!tokenWarned) {
              tokenWarned = true;
              console.error('[phosphor] ctx.theme.overrideTokens unavailable — token layer NOT applied');
            }
            return false;
          }
          tokenLayer = theme.overrideTokens('phosphor', buildTokens(prefs));
          return true;
        };

        /* 释放令牌层 —— 官方 overrideTokens 以 source 为键、再次调用即整层替换，
           返回的 disposer 只在"仍是当前层"时生效，调用它是幂等的。
           主开关关闭时必须调用，否则 22 条令牌覆盖会一直留在活动快照里。 */
        const releaseTokens = () => {
          if (typeof tokenLayer === 'function') {
            try { tokenLayer(); } catch { /* noop */ }
          }
          tokenLayer = null;
        };

        /* ── 高对比偏好层：prefers-contrast: more ──────────────────────────────
           【为什么另压一层而不是写 @media】
           宿主给了 overrideTokens —— 它接收 { light, dark } 双值、由宿主按当前
           主题选用。自己写 CSS 媒体查询就得**同时**判 prefers-contrast 与
           当前是亮还是暗，而"当前主题"只有宿主知道（它会随 system 偏好翻转）。
           另压一层的 source 与基础层不同，按官方说明
           "layers compose in seq order with later layers winning per-token"，
           所以这一层自然赢过基础令牌层；撤销时只需调用它的 disposer。

           【抬升依据】先看原值（暗色）的对比度：
               brand-primary   #00ff9c  ≈ 15:1   ← 已远超 AA，不动
               label-primary   #00d977  ≈ 10:1   ← 不动
               label-secondary #12a35f  ≈  5:1   ← 达标，偏高要求下再亮一档
               label-tertiary  #1d9e68  ≈  6:1   ← 同上
               border-l2       #1d6b4a  ≈ 3.2:1  ← 【偏低】它承担可见分隔
               border-l1       #10352a  ≈ 1.5:1  ← 【很低】默认是"若有若无"
               border-l3       #0d2b22  ≈ 1.2:1  ← 更暗，仅作底衬
           本主题的边框是功能性的（分隔卡片、勾勒输入区），在高对比诉求下
           3.2:1 与 1.5:1 都偏弱 —— 所以只抬这三条边框 + 两档次要文字。
           亮色侧方向相反：白底上"更浅"等于更看不见，所以是【加深】。 */
        let hcLayer = null;
        let contrastMQ = null;

        const buildHighContrastTokens = () => ({
          '--dsw-alias-border-l1': { light: '#7d958a', dark: '#1f6b52' },
          '--dsw-alias-border-l2': { light: '#5a7a6c', dark: '#3fbf8f' },
          '--dsw-alias-border-l3': { light: '#8fa79a', dark: '#1f6b52' },
          '--dsw-alias-label-secondary': { light: '#24503d', dark: '#4dd48a' },
          '--dsw-alias-label-tertiary': { light: '#3a6551', dark: '#3fc98a' },
        });

        const syncHighContrast = () => {
          const want = !!(prefs.enabled && contrastMQ && contrastMQ.matches);
          if (want && !hcLayer) {
            const theme = ctx.theme;
            if (theme && typeof theme.overrideTokens === 'function') {
              try {
                /* source 必须与基础层不同，否则会把基础层整层替换掉。 */
                hcLayer = theme.overrideTokens('phosphor-hc', buildHighContrastTokens());
              } catch (e) { console.warn('[phosphor] 高对比令牌层注册失败', e); }
            }
          } else if (!want && hcLayer) {
            try { hcLayer(); } catch { /* noop */ }
            hcLayer = null;
          }
        };

        /* 监听系统的高对比偏好。matchMedia 只在媒体查询变化时回调，
           不需要轮询；不支持的引擎会拿到 null，那就整块功能静默跳过。
           卸载时成对移除（见 return 里的清理）。 */
        try {
          contrastMQ = (typeof window.matchMedia === 'function')
            ? window.matchMedia('(prefers-contrast: more)')
            : null;
          if (contrastMQ) {
            if (typeof contrastMQ.addEventListener === 'function') {
              contrastMQ.addEventListener('change', syncHighContrast);
            } else if (typeof contrastMQ.addListener === 'function') {
              contrastMQ.addListener(syncHighContrast);   // 旧 Chromium 兼容
            }
          }
        } catch { contrastMQ = null; }

        /* 重试一次（防御性：inject 已声明 theme，正常不会走到这里）。
           重试回调里连高对比层一起重做 —— syncHighContrast 也依赖 ctx.theme，
           若首次跑时服务还没就绪，它会静默跳过且不会自己再来一次。 */
        if (prefs.enabled && !pushTokens()) {
          tokenRetry = setTimeout(() => {
            pushTokens();
            syncHighContrast();
            tokenRetry = null;
          }, 500);
        }
        /* 初始即按当前系统偏好决定是否压高对比层 ——
           不能等第一次 change 事件，否则已经开着高对比的用户永远看不到效果。 */
        syncHighContrast();


        /* 6.2b 幂等清理：先摘掉【任何已存在的】本插件印记与覆盖层。
           ====================================================================
           【这是一个真实的严重缺陷，实测定量确认】
           用户反馈"强度调到十几屏幕就被盖满"。实测层数：
             .ph-scan     89 层
             .ph-vignette 89 层
             .ph-boot      0 层
             style[data-phosphor-style]  1 份   ← 样式表正常，只有覆盖层疯长
             .ph-statusbar               1 层   ← 走 slot 注册，由 React 管理，正常

           后果是可以精确算出来的：单层扫描线 alpha 0.004，89 层叠加后
             1 - (1-0.004)^89 ≈ 0.30
           单层暗角边缘 0.176，89 层叠加后
             1 - (1-0.176)^89 ≈ 1.00   ← 边缘全黑
           也就是说实际强度是设计值的 89 倍。

           成因：下面每次执行都 createElement + appendChild 新节点，
           只靠返回的 cleanup 里的 remove() 回收。而热重载 / effect 重跑时
           cleanup 并不保证先于新一轮建立执行，于是旧节点留在文档里、
           新节点又插一套，逐次累积。本会话改过很多次文件，正好累积到 89。

           【为什么样式表与控制层没事】
           <style> 只被读取、不参与叠加；statusbar 由 slot/React 管理。
           只有"手动 append 且无限叠加"的这两层受影响。

           修法两层保险：
             ① 建立前先摘掉所有同名印记（防跨实例残留）
             ② 建立前先删掉所有 .ph-scan / .ph-vignette（防叠加）
           这样无论 effect 重跑多少次，文档里恒为 1 套。 */
        try {
          for (const sel of ['[data-phosphor-composer]', '[data-phosphor-toolbar]',
            '[data-phosphor-trailing]', '[data-phosphor-stop]', '[data-phosphor-boot-host]']) {
            for (const node of document.querySelectorAll(sel)) {
              try { node.removeAttribute(sel.slice(1, -1)); } catch { /* noop */ }
            }
          }
          for (const node of document.querySelectorAll('.ph-scan, .ph-vignette')) {
            try { node.remove(); } catch { /* noop */ }
          }
        } catch { /* 环境异常时不影响后续建立 */ }

        /* 6.3 装饰层样式表：直接插一个 <style>，卸载时随该元素一起移除。
               这样不依赖任何 Harness Client 包，也不需要额外的样式服务。 */
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-phosphor-style', '');
        styleEl.textContent = CSS;
        document.head.appendChild(styleEl);

        /* 6.4 装饰浮层：扫描线 + 暗角。挂在 body 上、pointer-events:none。 */
        const vignette = document.createElement('div');
        vignette.className = 'ph-vignette';
        vignette.setAttribute('aria-hidden', 'true');
        const scan = document.createElement('div');
        scan.className = 'ph-scan';
        scan.setAttribute('aria-hidden', 'true');
        document.body.appendChild(vignette);
        document.body.appendChild(scan);

        /* 6.4b 启动自检容器：挂载点在 apply 作用域创建，这里插入 DOM。
               文本由 BootSequence（下方 slot 注册）逐行写入；
               boot 关闭时组件渲染 null，容器自然为空。 */
        document.body.appendChild(bootHost);

        /* 6.5 app frame —— 【已彻底移除】。
           ====================================================================
           这里原本有一套 app frame 探测 + data-phosphor-frame 标记，
           用来把状态栏的让位做在 frame 上而不是 body 上。现已删除，原因：

           ① 用户实测本机构建里【没有】可标记的 frame：
                body.children[0] 是 display:block / height:1044px 的 DIV，不是 grid
              也就是说让位一直正常，靠的正是"探测失败 → 走 body 那条 CSS"。
           ② 我一度放宽判据想"修好"它，命中了一个 height 仅 40px 的无名垫片，
              于是 :has([data-phosphor-frame]) 成立 → body 让位失效
              → 用户实测「下面的三个小工具不见了」（被状态栏盖住）。

           教训：当"现状正常"依赖某个探测失败时，放宽判据让它"成功"是危险的 ——
           误标记会【静默关闭】一个本来可用的兜底机制，而且没有任何日志。
           现在只剩 CSS §5 的 body 让位一条路径（经实测：paddingBottom 22px、
           状态栏正好让出 23px）。功能不变，但一整类 bug 被消灭。 */

        /* 6.5b 输入卡片标记 —— 同样靠探测，不猜类名。
               依据：可编辑面（[contenteditable="true"]）自身的 border/background
               都是空的（已实测：RlGAzG_input → 0px none / transparent），
               可见方框在它的某个祖先上。沿祖先链向上，
               取第一个「有可见边框或非透明背景」的块级元素，即卡片。
               为什么不用类名：卡片类名带构建哈希；而可见边框这一几何特征
               与构建无关，上几层结构变化也不影响这个判据。 */
        let markedComposer = null;
        const markComposerCard = () => {
          /* 用"就是这个元素吗"而非仅看 isConnected：
             React 换代时旧卡片可能仍留在文档中（被隐藏的容器里），
             只靠 isConnected 会一直认为"还有效"，新卡片永远标记不上。 */
          const editable = document.querySelector('[contenteditable="true"]');
          /* 【标记必须唯一】审计指出一个真实泄漏：这里原先只把引用置空、
             不摘属性。宿主的可编辑面在「选择工作区 / 只读 / editor 重建」期间
             会渲染成 contentEditable="false" 或干脆缺失（asar 原文：
             `contentEditable: editor !== null && editable`，其父级传
             `editor: workspaceTrigger ? null : editor`），而卡片节点仍在文档里。
             于是旧卡片上的标记永久残留、新卡片又被打一次 → 两个标记共存；
             下游三处（工具行 / 发送键 / 状态栏读 host）都用【首命中】取卡片，
             首命中的可能是旧卡片 → 装饰挂错、模型与权限读不到。
             因此这里统一走 ensureSingleComposerMark：不论哪条分支，
             都保证文档中至多一个 data-phosphor-composer。 */
          if (!editable) { markedComposer = null; return; }
          if (markedComposer && markedComposer.isConnected
              && markedComposer.contains(editable)) {
            return;
          }
          if (markedComposer) {
            try { markedComposer.removeAttribute('data-phosphor-composer'); } catch { /* noop */ }
            markedComposer = null;
          }
          let el = editable.parentElement;
          for (let depth = 0; el && el !== document.body && depth < 6; depth++) {
            const cs = getComputedStyle(el);
            const hasBorder =
              parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
            const bg = cs.backgroundColor;
            const hasBg = bg && bg !== 'transparent' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg);
            const isBlock = cs.display === 'block' || cs.display === 'flex' ||
                            cs.display === 'grid';
            if (isBlock && (hasBorder || hasBg)) {
              el.setAttribute('data-phosphor-composer', '');
              /* 【不做】输入卡片宽度覆盖 —— 保持宿主原值 ≈945px。
                 ------------------------------------------------------------------
                 这一段曾三次改动，把结论记在这里，避免以后又去动它：
                 ① 最初把 --dsh-composer-card-max-width = 1280px 内联到 <html> 上。
                    但宿主把它声明在 .Dc7zOa_body，而自定义属性「元素自身的声明压过
                    继承值」—— 那条 1280px 【从未生效】，卡片一直就是宿主原值。
                 ② 用户看着这个"没生效"的状态说"能不能扩大点"，我误当成已确认；
                    后来把变量改写到卡片自身（修通道），1280px 才第一次显形。
                 ③ 用户看到后判断太宽，要求回到原来的 ≈945px。
                 最终决定【完全不覆盖】：那个 ≈945px 并非硬编码，而是宿主
                   max-width: min(calc(100% - 16px), 952px)
                 在 1707px 视口下的实际结果 —— 它自带「窄窗口下不溢出」的自适应。
                 写死任何一个像素值都会丢掉这个特性，因此这里什么都不写。 */
              markedComposer = el;
              return;
            }
            el = el.parentElement;
          }
        };
        markComposerCard();

        /* 6.5c 工具行标记 —— 预览页 .ph-composer-bar 需要一条顶部细分隔线。
               分隔线必须挂在「承载四个按钮的那一行」上，不能挂在卡片上
               （卡片是 flex column + gap 12px，border-top 会落到编辑区与工具行
               之间）。探测：从 _trigger 出发向上找同时含 _primary 的第一层 = 工具行。

               同时标记工具行【内部承载右侧控件的容器】与其【直接父级】。
               这一步是实测驱动的修正：用户报告文字「从右边露出」，随后测出的
               层级数据是
                 SEND  w34 right1439   ← 按钮本身没有越界，right 与所有祖先相等
                 _trailing  w263 scrollW269 overflow:visible  ← 差 6px 且不裁切
                 _row       w918 scrollW918 overflow:hidden   ← 我原本标记的层，并未溢出
               即：真正溢出的不是工具行，而是它内部的 trailing 容器。
               成因是我的按钮规则把 trailing 里的控件撑宽（padding + gap + 注入
               的文字），而 trailing 是 overflow:visible、又不允许收缩，
               于是内容溢出到卡片边框之外。
               因此把 trailing 也标记出来并约束它 —— 只标记工具行不足以修好。 */
        let markedToolbar = null;
        let markedTrailing = null;

        /* 清掉不再属于当前卡片的那两个标记。
           判据用"是不是当前卡片的后代"而不是仅看 isConnected ——
           React 换代时旧工具行可能仍留在文档里，只靠 isConnected 会一直认为有效。 */
        const dropIfOutside = (el, card) => {
          if (!el || !el.isConnected || !card.contains(el)) return null;
          return el;
        };

        const markComposerToolbar = () => {
          const card = document.querySelector('[data-phosphor-composer]');
          if (!card) return;

          const liveToolbar = dropIfOutside(markedToolbar, card);
          if (liveToolbar !== markedToolbar) {
            if (markedToolbar) {
              try { markedToolbar.removeAttribute('data-phosphor-toolbar'); } catch { /* noop */ }
            }
            markedToolbar = liveToolbar;
          }
          const liveTrailing = dropIfOutside(markedTrailing, card);
          if (liveTrailing !== markedTrailing) {
            if (markedTrailing) {
              try { markedTrailing.removeAttribute('data-phosphor-trailing'); } catch { /* noop */ }
            }
            markedTrailing = liveTrailing;
          }

          if (!markedToolbar) {
            const trigger = card.querySelector('[class$="_trigger"]');
            let el = trigger && trigger.parentElement;
            for (let depth = 0; el && el !== card && depth < 5; depth++) {
              if (el.querySelector('[class$="_primary"]')) {
                el.setAttribute('data-phosphor-toolbar', '');
                markedToolbar = el;
                break;
              }
              el = el.parentElement;
            }
          }

          if (!markedTrailing) {
            const primary = card.querySelector('[class$="_primary"]');
            let el = primary && primary.parentElement;
            for (let depth = 0; el && el !== card && depth < 4; depth++) {
              const cs = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              /* 判据：内部内容比自身宽（scrollWidth > clientWidth + 1），
                 即真正的溢出层。这比靠类名可靠。 */
              if (r.width > 0 && el.scrollWidth > el.clientWidth + 1) {
                el.setAttribute('data-phosphor-trailing', '');
                markedTrailing = el;
                break;
              }
              /* 已经能裁切的层说明它自己处理了溢出，不必再管 */
              if (cs.overflowX === 'hidden' || cs.overflowX === 'auto') break;
              el = el.parentElement;
            }
          }
        };
        markComposerToolbar();

        /* 6.5e 统一的探针调度器 —— 用一个观察者 + 合并处理，替换原来的两个。
           ============================================================================
           【修的两个隐患】

           隐患一：观察者的"建立条件"与"断开条件"不对称，且断开条件会被
           陈旧引用骗过。原实现里 frameObserver 一旦成功就 disconnect()，
           composerObserver 则在"四个标记齐了"时 disconnect() —— 而两者的
           成功判断都只看变量是否为真；元素换代后变量仍为真，于是新元素
           永远标记不上，主题的一部分【静默失效】（无日志）。
           现在：探针内部一律先清陈旧引用（见 dropIfDisconnected / dropIfOutside），
           并【不再因为"已成功"就永久断开】—— React 会重建卡片，
           永久断开等于放弃后续一切变化。

           隐患二：body 级 childList+subtree 观察者在对话流式输出期间每秒触发
           上百次，而原回调里要做 6 层 getComputedStyle 与 getBoundingClientRect
           —— 那是每帧强制同步布局，代价真实。
           现在：回调只排一次调度、不做任何 DOM 读取；真正的探测里把零成本判断
           （isConnected / contains）放在前面，只在确实需要时才跑昂贵的那部分。
           0ms 定时器把同一轮内的多次变更合并成一次处理。 */
        let probeScheduled = false;
        let probeTimer = null;
        const isLive = (el) => !!(el && el.isConnected);

        /* 【音效层的运行态同步钩子】
           默认空实现；setupSounds 建立时把它换成真实现，拆除时换回空。
           为什么要这样一个钩子：音效原先自己开了一条 MutationObserver 盯
           data-phosphor-stop，而那个属性是 runProbes 写的 —— 同一条变更流上
           挂两条链是浪费。改为探针周期里主动通知一次（见 runProbes）。
           放在这里是因为 runProbes 会调用它，必须先声明。 */
        let syncSoundRunState = () => {};

        /* 探针是否已经处于正确状态？只做一次 querySelector + 一次 contains。
           ------------------------------------------------------------------
           为什么不能只查 isConnected：卡片换代的典型情形是【旧卡片仍留在
           文档里】（被 React 收进不销毁的容器），此时 isConnected 为真，
           只查它会一直认为"还有效"，新卡片永远标记不上。
           contains 才能判断"被标记的卡片是否仍包含当前可编辑面"。
           代价：一次 querySelector 远低于 markComposerCard 的 6 层
           getComputedStyle，所以这个早退仍然划得来。 */
        const composerHoldsEditable = () => {
          const editable = document.querySelector('[contenteditable="true"]');
          if (!editable) return false;
          if (!isLive(markedComposer)) return false;
          return markedComposer.contains(editable);
        };

        const runProbes = () => {
          probeScheduled = false;
          probeTimer = null;
          /* 【音效的运行态【不在这里】同步 —— 那是我犯过的错】
             曾在此调用 syncSoundRunState()，理由是"标记本来就是这里写的"。
             但本函数【有早退分支】（见下）：早退会跳过 markSendState，
             而 markSendState 是唯一会摘掉 data-phosphor-stop 的地方 ——
             于是只要探针长期早退，该属性就永不摘除，音效直接坏掉：
               不响叮、不响复位音、打字声停不下来。
             现在音效改回自己的属性观察者（见 setupSounds 里的 runStateObs）。 */

          /* 零成本判断放在最前，不碰 getComputedStyle / getBoundingClientRect。
             ------------------------------------------------------------------
             【注意：这里刻意不检查 markedTrailing】它是"条件标记"——
             只在检测到溢出时才打上。用户实测 trailing: false 时
             scrollWidth === clientWidth（确实没溢出），那是【正常状态】。
             若把"trailing 已标记"写进早退条件，这一条永远不成立，
             早退失效 → 每帧都跑 markComposerCard 的 6 层 getComputedStyle，
             正是本段要修的性能问题。 */
          if (composerHoldsEditable() && isLive(markedToolbar) && isLive(markedSend)) {
            return;
          }
          markComposerCard();
          markComposerToolbar();
          markSendState();
        };
        const scheduleProbes = () => {
          if (probeScheduled) return;
          probeScheduled = true;
          probeTimer = setTimeout(runProbes, 0);
        };

        const probeObserver = new MutationObserver(() => { scheduleProbes(); });
        if (document.documentElement) {
          probeObserver.observe(document.documentElement, { childList: true, subtree: true });
        }

        /* 6.5d 发送键状态 → 文字在 send / stop 之间切换。
                ------------------------------------------------------------------
                CSS 无法读取「模型是否正在输出」，因此需要 JS 把状态写到 DOM 上。
                唯一可靠的可读信号是按钮的 aria-label：宿主在运行中会把它从
                「发送消息」改成停止类文案（确切措辞未知，所以用关键词匹配）。

               监听方式：MutationObserver 只观察发送键自身（attributes + subtree），
               只有它变化时才触发，代价极低；图标/文字切换也在 subtree 内。

               【为什么用 WeakMap 而不是往元素上挂属性】
               起初写成 send._phosphorSendObserved = new MutationObserver(...)。
               那有真实的泄漏：发送态与停止态很可能是两个不同的元素，
               React 重建后，旧元素的 observer 仍挂在已脱离文档的节点上、
               永远不会被断开；而新元素上又挂一个。用 WeakMap 以元素为键，
               既能判断「这个元素是否已观察」，又能在元素被回收时自动清掉条目。
               此外这里显式跟踪 lastObserved，元素换了就断开旧的。 */
        let markedSend = null;
        let lastObservedSend = null;
        const sendObserved = new WeakMap();
        const stopWords = /stop|abort|interrupt|cancel|pause|停止|中断|取消|暂停/i;

        /* 注：早先这里有一个 composerIsBusy()（读 data-phosphor-stop 判断运行中），
           供快速回复键使用。后来子智能体逆向确认了官方判据
           SessionSnapshot.running（且本座位 standardProps 里就有 useSession），
           于是改用它、不再走 DOM 观察 —— 那个 helper 随之删除，避免留下死代码。
           data-phosphor-stop 本身仍由下面的 markSendState 维护，
           它的用途是【CSS 把 send 文案换成 stop】，与运行态判断无关了。 */

        /* ==========================================================================
          6.10 回合结束音效（Chime）
          ==========================================================================
          用户需求：一轮回答结束时响一声。素材是他自己找的（8 个 WAV 里选了「叮~~~~」）。

          【素材怎么进来的】
          原文件 559,356 字节 / 1.585s / 立体声 44.1kHz / 32bit 浮点。
          插件没有"静态资源"出口（package.json 的 exports 只列出 js/json/svg，
          客户端 bundle 路由只打包 JS），所以素材必须内嵌。
          为控制体积，先在本地瘦身：
            裁到有效段 0.55s（包络显示 0.8s 之后已衰减到 0.004，属死区）
            立体声 → 单声道；44.1k → 22.05k（2:1 盒式平均兼作抗锯齿）
            32bit 浮点 → 16bit PCM；末尾 60ms 淡出；按峰值归一化到 0.84
          结果 24,298 字节（缩减 95.7%），base64 后 32,400 字符。
          截断点选 0.55s 而不是更短，是因为 0.4~0.55s 还有 0.06 的余韵，
          再短会让铃声显得被"掐掉"。

          【为什么用 Web Audio 而不是 <audio>】
          decodeAudioData 解一次、缓存在内存，之后 play 只是节点连接 ——
          没有加载延迟（音效晚半拍就不像"应答"了），也没有元素入 DOM 的副作用。

          【自动播放策略】
          页面未发生用户交互前 AudioContext 处于 suspended，直接播会静默失败。
          所以：首次用户交互时 resume（一次性监听）；若那时没有待播的，就只是解锁。
          另外：若解锁成功但一轮在解锁之前就结束了，本次不补播 ——
          补播会在一句话之后突然出声，比不响更糟。 */
        const CHIME_B64 =
          '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';

        /* 「复位」—— 回合开始序列的第一个音（打字机回车的长音）。
           原文件 1.455s，峰在 0.70~0.85s；自动裁尾给出 1.400s。
           注意：【不能】用固定 0.55s 裁 —— 那会把最响的部分切掉。 */
        const CHIME_RESET_B64 =
                    'UklGRuzqAwBXQVZFZm10IBAAAAABAAIARKwAABCxAgAEABAAZGF0YcjqAwAGAAMABQACAAYAAQAHAAEACAABAAoAAgAMAAMADQAEAAwABgALAAcACQAIAAcACQAFAAgAAwAIAAMABwAEAAYABgAFAAgABAAKAAQA' +
          'CgAEAAkABAAIAAMABwADAAcAAgAJAAIADAABABAAAgATAAIAFAADABUABAAUAAUAEgAFABAABQAPAAUADgAGAA8ABwAQAAkAEgAMABMADwATABIAEQAUAA4AFQAKABUABwAUAAUAEwAFABIABwASAAoAEwAPABQA' +
          'EwAVABcAFgAXABUAFgATABQAEAAQAA0ADgAKAA0ACAAPAAgAEQAJABMADAAVAA8AFQATABQAFQASABYAEAAXABAAFgARABUAEgAVABQAFgAVABgAFQAbABMAHQARAB8ADwAfAA0AHQANABkADgAVABAAEgATAA8A' +
          'FQAOABcADgAXAA8AFgAPABMADwAPAA0ADAALAAsABwALAAQADQADABAAAgATAAMAFAAFABQACAARAAsADQANAAgADwAFAA8ABAAOAAUADQAIAAwADAALAA8ADAAQAA0AEAAOAA4AEAALABEACQAQAAkADwALAA0A' +
          'DQALABAACQATAAgAEwAHABMABwARAAcADQAHAAoABgAHAAQABAACAAIAAAACAP//AgD+/wMA//8EAAAABAABAAMAAgACAAIAAQABAAAA//8AAPz/AgD5/wUA9v8JAPX/DAD1/w4A9v8PAPj/DwD6/w4A/P8LAPz/' +
          'CQD8/wYA/P8EAPv/AwD7/wMA+/8DAPv/BAD8/wUA/f8GAP7/BgD9/wcA/P8IAPv/CgD6/wwA+f8PAPn/EgD7/xQA/v8VAAIAFAAFABIABwAOAAgACgAHAAYABQAEAAIAAwAAAAUA//8HAP//CQD//woAAAALAAAA' +
          'CwD//woA/v8IAP3/CAD8/wgA/P8IAP3/CgD//wsAAgANAAYADgAJAA0ACgANAAoADAAJAAsACAAMAAcADQAHAA4ACQAQAAwAEAAOABAAEQAPABIADQASAAsAEQALABAACwAPAA0ADwAQABEAEwATABQAFwAUABoA' +
          'EgAcABAAHQAOABwADgAZABAAFQASABEAFgAOABgADQAZAAwAGAAMABUADAARAAsADgAJAAsABwAKAAUACgAEAAwABAAPAAUAEQAIABIADAASABAAEAATAA0AFQAKABYABwAVAAUAFAAFABIABgAQAAcADwAIAAwA' +
          'CQAKAAgACAAHAAUABQACAAQAAAAEAP7/BAD9/wUA/v8GAAAABgACAAYABQAEAAcAAgAIAAAACQD+/wgA/P8HAPr/BQD5/wQA+P8DAPf/AgD2/wIA9v8BAPb/AAD3//7/+P/7//r/9//6//P/+v/w//n/7v/4/+3/' +
          '9v/t//T/7v/z/+7/8//u//P/7v/0/+7/9P/u//P/7v/y/+7/8P/w/+7/8f/t//T/7P/2/+3/9//u//j/8P/4//L/9v/z//T/8v/y//H/8P/w/+7/7v/t/+7/7P/w/+z/8v/r//X/6v/3/+j/9//m//b/4//0/+H/' +
          '8f/f/+//3//t/+D/7f/i/+//5f/x/+j/8//r//P/7v/z/+//8f/w/+//8f/s//H/6//x/+v/8v/s//P/7//0//L/9P/1//T/9//z//j/8f/4//D/9//v//b/7//1/+//9f/x//X/9P/2//f/9//6//j//f/5//7/' +
          '+v/+//r//f/5//v/+f/5//j/9v/4//X/9//0//b/9f/2//b/9v/4//f/+//6//3//f8AAAEAAwADAAUABQAHAAYACQAFAAsABAAMAAMADQADAA0ABAAMAAYACwAIAAkACQAHAAoABAAJAAIACAAAAAYA//8EAP//' +
          'AwABAAMAAwAEAAcABQAKAAYADAAGAA0ABgANAAUACwADAAkAAgAHAAIABQACAAQAAwAFAAUABwAHAAkACAALAAgADAAHAAwABQALAAMACgABAAkAAAAIAAAABwAAAAcAAQAHAAMABgADAAUAAwACAAMA//8CAPz/' +
          'AgD4/wIA9v8CAPX/AwD3/wQA+v8FAP//BAAEAAIACAABAAsA//8MAP7/DAD//wsAAAAJAAIACAAEAAcABQAIAAUACAAFAAgABAAIAAMABgACAAMAAgD//wEA+/8BAPj/AQD2/wEA9f////b//v/3//z/+f/6//v/' +
          '+f/8//n//f/5//7/+//+//z//v/+////AAAAAAIAAQAFAAIACAADAAoABAAMAAQADAAEAAsABAAJAAMABgADAAIAAgD+/wIA+/8DAPr/AgD6/wIA+/8BAP3/AAD///7/AAD7/wAA+v////n//v/6//3/+//8//7/' +
          '/P8BAP3/BQD//wgAAAAKAAIACgADAAoAAwAJAAMABwACAAUAAgADAAEAAAABAP7////7//7/+f/7//b/+P/0//b/8//0//P/9P/z//X/9f/4//j/+//7//7//v8BAAAAAgACAAIAAgABAAIAAAADAAAAAwABAAQA' +
          'AgAGAAMABwAEAAgABQAJAAUACAAEAAcAAwAFAAEAAwAAAAEA//8BAP//AQD//wIAAAACAAIAAwAEAAMABgACAAcAAQAJAAAACQD//woA//8JAAAABwABAAUAAgACAAMA/v8DAPz/AgD6/wAA+v/9//z/+/////n/' +
          'AwD4/wYA+P8IAPn/CAD7/wcA/P8FAPz/AwD8/wIA/P8CAPv/BAD7/wYA/P8IAP3/CQD//wkAAAAHAAAABQABAAIAAAABAP//AQD//wMA//8EAAAABgABAAcAAwAGAAUABQAGAAQABgADAAUAAwADAAQAAQAHAP//' +
          'CgD+/w0A/f8OAP3/DQD+/wsA/v8GAP7/AgD+//7//v/8//7//P////7/AAAAAAIAAQAEAAIABgABAAcA/v8IAPv/BwD5/wYA+f8EAPr/AgD8/wAA/////wEA/v8DAP7/AwD+/wEA/v8AAP3//v/8//3/+v/8//j/' +
          '/f/2//7/9f////X/AAD1/wAA9/8AAPj/AAD6/////P////3////+////AAAAAAEAAQACAAIABAACAAYAAgAIAAAACQD+/wgA/P8HAPn/AwD3////9f/6//T/9f/0//H/9P/u//X/7f/2/+3/9//u//f/8P/4//H/' +
          '+P/z//j/8//3//T/9//0//j/9f/6//b//P/5/////P8AAP//AQACAAAABAD9/wUA+f8FAPX/BADy/wIA8P8BAPD/AADx/wAA8v8BAPT/AgD0/wIA9P8BAPL/AADx//3/8P/6//D/+P/y//f/9f/2//f/9//6//n/' +
          '+//6//r/+//5//v/9v/6//P/+f/x//n/8f/4//H/+f/z//v/9f/9//b////3/wAA9v8AAPP////w//7/7v/9/+z/+//s//v/7v/7//H/+//1//z/+P/7//v/+v/8//n//P/4//r/9//5//f/9//5//X/+//0////' +
          '9P8CAPP/BQDz/wYA8/8HAPT/BgD0/wUA9f8EAPb/BAD3/wUA+P8GAPj/BwD4/wcA+P8HAPj/BgD4/wUA+P8DAPj/AgD4/wAA9/////b//v/0//3/8v/8/+//+v/t//n/7P/4/+v/+f/s//r/7f/8/+/////y/wEA' +
          '9P8DAPX/AwD2/wIA9/8AAPf//f/3//r/9//3//f/9v/2//X/9P/2//L/9v/v//b/7f/2/+z/9f/s//X/7f/0/+//9P/y//X/9f/3//f/+P/5//r/+f/7//n/+//4//r/+P/4//f/9v/3//P/9//w//f/7//3/+7/' +
          '+P/u//f/7v/3/+//9v/w//X/8P/1/+//9P/v//L/7f/x/+3/8P/s/+//7f/v/+3/7//u//H/7//z//D/9f/w//f/7//4/+7/+P/t//f/7f/1/+7/8v/w//D/8v/v//X/8P/4//H/+f/z//r/9P/5//T/9//z//T/' +
          '8f/x/+//7v/t/+z/7P/r/+3/6//w/+v/8//r//f/6//5/+v/+//q//r/6//5/+z/9//u//b/8f/1//X/9f/4//b/+//3//z/+P/9//f//P/2//r/8//4//D/9//t//f/7P/4/+7/+f/y//r/+P/7//7/+/8DAPr/' +
          'BwD5/wcA9/8FAPb/AAD2//z/9//3//n/9f/8//b//v/4/wAA/P8CAAAAAgADAAIABAACAAMAAwAAAAMA/f8FAPv/BwD5/woA+P8MAPn/DwD7/xEA/f8SAP//EwAAABIAAQARAAEADwABAA0AAQAMAAAACwAAAAsA' +
          'AAALAAAADAAAAAwA//8NAP7/DQD8/w0A+/8NAPr/DAD6/wsA+/8LAP3/CwAAAAsAAwALAAUADAAGAA0ABgANAAQADQABAAwA//8LAP3/CQD9/wcA/f8GAP//BgABAAcAAgAIAAIACgAAAAsA/v8LAPv/CwD4/wkA' +
          '9/8HAPf/BgD5/wQA/P8EAP//BAACAAUABAAGAAMABgACAAcA//8GAPv/BgD4/wUA9/8EAPf/BAD5/wUA+/8FAP3/BQD+/wUA//8FAP//AwD//wIA//8AAAAA/v8CAPz/AwD8/wUA+/8FAPv/BAD7/wIA+/////r/' +
          '/f/5//z/+P/7//f//P/1//3/9P/9//P//P/z//v/8//4//P/9v/z//X/9P/0//b/9f/3//f/+P/7//r//v/7/wAA/P8CAPz/AgD9/wIA/f8BAP3/AAD8/wAA+/8AAPn/AQD3/wEA9P8CAPL/AgDv/wIA7f8AAO3/' +
          '///t//7/7//+//H////0/wIA9/8FAPn/CAD7/woA/f8LAP7/CgD//wgAAQAFAAIAAgAEAAAABQD//wUAAAAFAAAABAACAAIAAwAAAAMA/v8DAPz/AgD7/wIA+/8BAPr/AgD6/wMA+f8FAPn/BwD5/wkA+f8LAPv/' +
          'DAD+/wwAAQALAAQACQAHAAcACgAFAAsABQALAAUACgAHAAoACQAKAAwACgAPAAwAEQANABIADgASAA8AEQAOABAADQAPAAsADgAJAA4ACQAPAAoAEAAMABAADwARABIAEAAUAA8AFQAOABUADQAUAA0AEwAPABIA' +
          'EAASABIAEwATABUAFAAXABQAGAATABkAEgAYABIAFwASABUAFAAUABcAFAAZABUAGwAWABwAGAAcABoAGgAaABcAGgAUABkAEgAXABEAFQARABMAEgARABQAEAAVAA8AFAAPABMADwAQAA4ADQANAAwADQAMAA4A' +
          'DgAPABMAEgAYABYAHAAaAB8AHQAgACAAHgAhABsAIQAYAB4AFgAbABYAGAAWABQAGAASABkAEAAZAA8AGAAOABUADAASAAsAEAAJAA4ACAANAAYADgAGAA8ABwAQAAgAEQAKABEADAAQAA4ADQAOAAsADQAJAAwA' +
          'CQAKAAoACAANAAYAEQAFABUABQAYAAUAGgAFABoABQAYAAQAFQADABEAAQAOAAEADQABAA0AAwANAAcADgALAA4ADwAMABIACgAUAAYAFAADABIAAgAQAAIADQAEAAoABwAJAAsACAAOAAcADwAGAA4ABAAMAAEA' +
          'CAD9/wMA+f8AAPX//v/y//7/8f////L/AwD1/wYA+v8JAP7/CgACAAkABAAGAAUAAwAFAP//BAD8/wMA+/8DAPr/BAD7/wYA/f8JAP//CgD//wsA//8JAP7/BgD9/wEA/P/8//z/+P/+//b/AAD1/wMA9/8FAPn/' +
          'BgD8/wUA/v8DAP//AAD///3//v/7//3/+v/+//v/AAD9/wQA//8IAAAADQABABAAAAARAP//DwD9/wsA+/8GAPr/AQD6//z/+//5//3/+P/+//f////3////9//+//b//f/1//v/9P/7//T/+//1//3/9/////r/' +
          'AQD+/wMAAgADAAQAAQAFAP3/BAD4/wEA9P/+//D//P/u//r/7//5//H/+v/0//r/9//6//n/+f/6//f/+v/z//n/7v/4/+r/+P/n//n/5v/6/+f/+//p//z/7P/8/+///P/x//z/8f/8//D/+//v//v/7v/7/+//' +
          '+//x//z/9P/9//n//f/9//3////+/wAA/v////7//P////j/AAD0/wEA8f8CAO7/AwDt/wMA7f8DAO3/AwDu/wIA7v8AAO7//v/u//3/7//9//D//v/y/wEA9f8DAPr/BgD+/wkAAQAKAAQACgAEAAkAAwAIAAEA' +
          'CAD//wgA/f8IAP3/CgD+/wsA//8NAAEADQADAA0ABAAMAAUACwAFAAoABQAJAAUACQAGAAkACAAJAAoACAAMAAcADQAGAA0ABQAMAAMACgACAAcAAgAFAAMABQAFAAYABwAJAAkADQAKABEACwAVAAsAGAAKABgA' +
          'CAAXAAcAFAAGABEABQAOAAYACwAHAAoACAAKAAgACgAHAAoABQALAAQACwACAAwAAwAMAAQADgAHABAACQATAAwAFgANABkADQAbAAsAHAAIABsABAAZAAEAFgAAABMAAAAQAAEADQADAAsABQAJAAYABwAGAAUA' +
          'BgAEAAQAAwACAAMAAQADAAAABAAAAAYAAQAJAAMACwAFAAwABgANAAcADQAHAA0ABgALAAUACQACAAcAAAAFAP7/BAD9/wIA/P8BAPv/AAD6////+v////n//f/5//z/+P/6//j/+f/4//f/+f/2//r/9v/6//b/' +
          '+//3//z/+P/9//j//f/4//z/9//7//b/+f/0//f/8//1//L/8//y//P/8//0//X/9f/4//f/+//5//7/+/////z/AAD8/////P/9//z/+v/8//j//v/2/wAA9v8DAPb/BgD3/wgA9/8IAPf/BwD2/wYA9f8DAPP/' +
          'AQDy/wAA8f////P/AAD1/wEA+P8BAPr/AQD8/////f/9//z//P/6//v/9//8//T//v/y/wEA8f8EAPL/BgDz/wcA9P8GAPb/BAD4/wEA+f////n//v/6//7/+v8AAPv/AgD8/wQA/v8GAP//BwD//wcA//8GAP7/' +
          'BQD8/wUA+v8FAPn/BgD5/wgA+v8KAPz/CwD+/woA//8IAAAABAD//////f/7//v/+P/5//j/9//5//b//P/2/wAA9v8CAPb/BAD1/wMA9f8CAPX/AQD0/wIA9f8EAPf/CAD6/w0A/v8RAAMAFQAHABcACwAWAA0A' +
          'FAAOABEADQAOAAsADQAJAAwABgANAAQADgACAA4AAwAOAAQADAAGAAkACAAFAAkAAwAKAAEACwACAAoABAAJAAgACAANAAcAEQAGABQABgAVAAYAFAAGABEABgANAAYACQAFAAcABgAHAAYACAAHAAoACQAMAAwA' +
          'DQAPAAwAEQAKABMABgATAAMAEgABAA8AAAAMAAAACQABAAYAAwAFAAUABAAHAAQACAAEAAkABQAKAAUACwAFAAwABQAMAAYADAAHAAsACQAJAAsACAANAAYADgAEAA4AAgAMAAAACQD+/wYA/f8CAP3////9//3/' +
          '///+/wEAAAADAAMABAAHAAUACgAFAAwABQANAAUADAAHAAsACAAJAAkACAAKAAgACQAIAAcACQADAAkA//8IAPv/BQD4/wIA9/////f/+//5//n/+//3//3/9//+//f//v/4//z/+f/6//n/9//5//P/+P/w//b/' +
          '7v/0/+z/8v/r//H/6v/w/+r/8P/q//D/6v/v/+r/7//r/+7/7f/s/+7/6v/w/+j/8f/n//H/6P/x/+n/7//r/+3/7f/r/+7/6f/v/+n/8P/p/+//6//u/+7/7v/w/+3/8v/t//L/7f/x/+3/7//s/+7/7P/t/+r/' +
          '7v/p//D/5//y/+b/9P/l//X/5P/0/+T/8f/k/+3/5f/p/+b/5v/n/+b/6f/o/+r/7P/r//D/7f/1/+//+P/y//n/9f/5//n/9//8//X//f/z//3/8v/7//H/+f/x//b/8v/z//L/8f/z//D/8//v//L/7//x/+//' +
          '7//u/+7/7f/t/+3/7P/t/+3/7//v//H/8P/1//D/+P/u//v/6//9/+b//v/i//3/3v/6/93/9//f//X/4v/z/+f/8v/s//P/8P/0//L/9f/y//b/8f/1//H/9P/w//H/8P/v//H/7v/y/+7/8v/w//P/9P/z//j/' +
          '8//7//L//f/x//3/7//7/+3/+P/r//X/6//0/+z/9P/u//X/8f/4//P/+//1//7/9P////L//v/u//3/7P/6/+r/+P/q//f/7f/2//D/9v/z//b/9//1//n/8//5//D/+f/s//j/6P/3/+X/9P/k//L/5v/v/+r/' +
          '7P/v/+r/9P/o//n/5//8/+f//f/n//3/6P/6/+n/9//r//T/7P/x/+3/7f/u/+r/8P/o//H/5f/x/+T/8f/j//D/4//v/+X/7v/o/+3/7f/t//L/7v/3/+///P/w/wAA8P8BAPD/AQDw////8P/8/+//+f/u//b/' +
          '7f/0/+z/8//r//L/6v/y/+n/8f/p//H/6f/x/+r/8P/r//H/7v/y//D/9P/z//f/9f/6//b//P/2//7/9v/+//b//v/2//7/9v/+//b//v/1////8/8AAPH/AgDu/wQA7P8HAOv/CgDr/wsA7P8LAO//CQDx/wUA' +
          '8/8AAPT/+//0//b/8//y//H/8f/w//D/7v/x/+3/8v/t//P/7//0//L/9v/2//f/+//6/////f8CAAAAAwADAAMABQABAAYA/v8FAPz/AwD6/wEA+v/+//r/+//8//n//v/4////9/8AAPf/AAD3/wAA+P8AAPn/' +
          'AQD6/wIA/f8DAAEABAAGAAMADAADABIAAQAXAAAAGQD//xkA//8WAP7/EAD9/wkA/f8AAPz/+f/8//P//v/v/wAA7v8CAO7/BADv/wUA8P8FAPL/BAD0/wIA9v////n//f/8//v/AQD6/wYA+v8KAPr/DQD6/w4A' +
          '+v8MAPr/CAD7/wIA/f/8////9v8BAPL/AgDx/wQA8v8EAPX/AwD5/wEA/f/+/wEA+/8DAPn/BAD3/wQA9f8DAPT/AQD0/wAA9P/+//X//f/2//z/9//8//j/+//5//z/+v/8//z//v/9//////8AAP//AQAAAAIA' +
          '//8DAP//AwD+/wMA/f8CAP3/AQD+///////9/wEA+/8CAPr/BAD5/wQA+f8EAPr/BAD7/wMA/f8DAP//AwACAAUABAAHAAUACgAGAAwABgAMAAYACwAGAAkABgAGAAcAAwAIAAEACQABAAsAAgANAAQADwAGAA8A' +
          'CAAOAAkACwAJAAgACQAFAAgAAwAGAAIABQACAAQAAwAEAAQABQAGAAcABwAJAAgADAAJAA4ACgAQAAwAEQAOABAAEAAOABMACwAUAAcAFQAEABQAAAARAP7/DgD9/wkA/f8FAP7/AgABAAAABAD//wcA//8KAAAA' +
          'DQACAA8ABAARAAUAEgAGABMACAATAAoAEwAOABIAEgAQABgADQAeAAkAJAAFACkAAwAsAAMALAAFACoACQAmAA4AIAAUABoAGQATABsADQAcAAgAGgAEABYAAgASAAAADgAAAAwAAQALAAQACwAHAAsACwALAA8A' +
          'CwATAAoAFwAJABoACAAbAAcAHAAIABsACwAaAA8AGQATABkAGAAYABsAFwAdABYAHgAUAB0AEQAbAA4AGQAKABYABgAVAAQAFAACABMAAgATAAMAEwAEABIABgARAAcADwAJAA0ACwALAA0ACQAQAAkAFAALABcA' +
          'DgAbABMAHgAZACAAHwAfACUAHgAoABsAKgAYACkAFQAmABIAIQARABoAEQAUABAADwAPAAsADQAJAAoACgAFAA0AAQARAP7/FgD+/xsAAQAdAAYAHgANABwAFQAZABoAFgAdABMAHQARABkAEQAUABIADgAVAAkA' +
          'FwAHABkABgAbAAcAHAAIAB0ACQAeAAkAHwAHACAAAwAhAP//IgD9/yMA/P8iAP3/IQABAB8ABgAcAAwAGQARABYAFQATABYAEgAWABIAFAATABIAFAAQABUADwAWAA8AFQAQABQAEQASABEAEAAQAA4ADgAOAAsA' +
          'DgAHABAAAwATAAAAFgD//xkA//8bAAEAHQADAB0ABgAcAAgAGgAJABgACgAWAAoAFQAKABUACwAUAAwAFAANABMADwARABEADwASAAwAEQAKAA8ACQAMAAkACQALAAcADQAFABAABQASAAUAEwAFABIABQAQAAUA' +
          'DQAFAAsABQAJAAUACQAGAAoABwAOAAkAEwALABcACwAaAAsAGwALABoACQAXAAgAFAAHABEACAAPAAoADgAOAA4AEwAPABkADwAdAA8AIAAOACEADQAfAA0AGwAMABUADAAQAA0ACwANAAcADQAEAA0AAgAMAAEA' +
          'DAAAAAsA/v8MAP3/DAD8/w0A/v8PAAIAEQAIABMAEAAVABoAFQAiABQAKQARACwADQAsAAkAKQAGACQABAAeAAUAGAAIABMADAAQABEADgAUAAwAFQALABQACQASAAcAEAAGAA8ABAAQAAUAEQAHABMACgATAA8A' +
          'EgAVAA4AGQAJABwABAAdAP//HAD9/xkA/f8WAP//EwADABAABwAOAAkADQAJAAwABwAKAAIABwD9/wMA+P////b/+//2//j/+v/3/wAA+P8HAPv/DgD9/xEA//8RAP//DQD+/wYA+//+//f/9//z//L/8v/w//T/' +
          '8P/4//L////0/wYA9f8NAPX/EQDz/xMA8f8RAO//DADv/wYA8f////X/+P/6//H//v/r/wEA5v8BAOH//v/d//r/2v/2/9j/8f/X/+//2P/u/9v/7//g//L/5//1/+7/+P/1//n/+v/5//7/+P////T//v/w//z/' +
          '7f/4/+r/9P/o//H/6f/u/+v/7P/v/+r/8//o//b/5//4/+b/+P/l//f/5v/2/+j/9P/q//L/7f/x//D/8P/x/+//8f/u//D/7v/v/+3/7v/t/+7/7v/v/+//8v/x//X/8//5//X//f/3/wAA+f8CAPv/AwD9/wMA' +
          '/v8CAP7/AgD+/wIA/P8DAPr/BQD2/wgA8v8KAO//CgDt/wkA7P8GAOz/AADt//n/7//z//H/7v/1/+z/+v/s////7v8EAPL/CAD2/woA+v8JAP7/BgABAAEABAD9/wcA+v8LAPr/DwD8/xIAAAAWAAQAGAAHABkA' +
          'CQAYAAkAFgAIABMABwAPAAcADAAIAAoACgAKAA0ADAAQAA4AEQARABAAFAAOABUACgAUAAUAEwAAABEA/P8PAPn/DgD4/w0A+f8NAPv/DQD+/w0AAQANAAIADAADAAsAAwALAAMACgADAAoABQAJAAgACQAMAAkA' +
          'EQAJABMACgATAAoAEAALAAkACwABAAsA+v8LAPb/CgD2/woA+f8KAP//CgAFAAsACwALAA0ACwANAAoACgAIAAYABgADAAQAAgADAAMAAgAGAAIADAACABEAAgAWAAMAGQADABsABQAaAAcAGAAKABYADgAVABIA' +
          'FQAWABcAGQAbABwAHgAdACEAHAAhABkAHwAUABoADwAUAAoADgAFAAkAAQAGAP7/BgD9/wgA/v8MAP//EQAAABYAAAAZAAAAGwAAABsA//8aAP7/FgD9/xIA/v8NAP//CQABAAUABAADAAYAAgAJAAIADAADAA0A' +
          'BQANAAYADAAIAAkACQAGAAkABAAKAAIACgACAAkAAgAIAAIABwADAAUAAwAEAAMAAwACAAMAAQADAAAAAwAAAAMAAAADAAAAAgABAAAAAwD+/wQA/f8EAPz/BAD8/wIA/P////3/+v////b////x//7/7f/8/+r/' +
          '+P/p//P/6v/u/+z/6v/u/+n/8f/q//P/7//0//T/9f/6//X//v/0////8v/+//H//P/v//n/7v/3/+7/+P/v//r/8f/9//P/AAD2/wAA+f////v/+//7//b/+v/w//j/6//1/+f/8//l//D/5f/u/+f/7f/p/+z/' +
          '6//s/+z/6//s/+v/6//r/+n/7P/o/+z/6f/s/+r/6//t/+r/8f/q//T/6P/2/+f/9v/m//T/5f/w/+T/7f/k/+v/5P/q/+X/6//m/+3/5//v/+n/8P/r//H/7f/w/+3/8P/t/+//6//v/+n/8P/m//D/4//w/+D/' +
          '7//e/+7/3f/t/93/7P/e/+z/4P/t/+L/7//k//L/5//1/+n/9//r//n/7v/6/+//+v/x//j/8v/2//L/9P/x//L/8P/x/+3/8v/r//T/6f/2/+f/9//n//f/6P/1/+n/8P/q/+v/6//l/+z/4P/t/9z/7f/a/+7/' +
          '2v/u/9z/7v/f/+7/4v/t/+X/6//o/+n/6f/m/+r/5P/q/+P/6v/i/+r/5P/q/+b/6f/q/+j/7v/n//H/5v/z/+X/9P/k//P/5P/x/+T/7//k/+7/5f/v/+b/8f/n//X/5v/5/+X//f/j////4f///+D//f/g//n/' +
          '4f/1/+T/8v/n//D/6v/x/+3/9P/v//f/8P/7//D//v/v////7v/9/+7/+//u//f/7v/z/+//8P/v/+//7v/v/+z/8f/p//T/5v/3/+P/+v/i//z/4v/9/+L//v/k//7/5v///+j/AADp/wEA6f8BAOj/AQDn/wAA' +
          '5f/+/+T/+//k//j/5v/1/+j/8v/r//H/7v/w//L/8P/1//H/9//z//j/9P/4//b/9//4//X/+f/y//v/8P/8//D//P/w//z/8v/6//T/+P/2//b/9//z//f/8f/2//H/9f/y//P/9P/x//f/8f/7//H//v/y/wEA' +
          '9f8CAPj/AQD8///////7/wIA9/8EAPP/BADx/wQA7/8CAO//AADv//7/8P/8//H/+//z//n/9P/5//X/+P/3//f/+f/3//v/9//8//j//P/7//v//f/4//7/9f/+//H//P/s//r/6P/4/+T/9//h//j/4P/7/+H/' +
          '/v/k/wAA5/8BAOz/AQDw////9P/9//f/+//5//r/+//7//3/+//+//z////8/wAA+/8AAPn/AAD2/wAA9P////P////z//7/9f/9//j//P/7//v//v/5/wEA9v8BAPT/AADy//7/8f/7//H/+P/x//b/8//1//X/' +
          '9v/4//j/+//8//7/AAAAAAIAAgACAAQAAQAEAP7/BAD6/wMA9/8DAPb/AgD3/wIA+f8CAPv/AgD9/wEA/v8AAP3//v/7//3/+P/8//b/+//1//z/9v/8//j//v/6////+/8AAPv/AAD5////9v/8//P/+f/x//b/' +
          '8P/y//H/8P/y/+//9P/x//T/9P/z//n/8f/+/+3/AgDo/wQA5f8FAOL/AwDh////4v/6/+T/9f/n//D/6f/s/+v/6f/q/+j/6f/n/+f/6P/m/+n/5f/q/+b/6//p/+3/7f/u//H/7//1//L/+P/0//n/+P/4//v/' +
          '9//+//T/AQDz/wIA8/8DAPT/AwD3/wMA+v8CAP3/AAAAAP7/AQD7/wAA9/////T//P/w//n/7f/3/+z/9f/s//T/7f/0/+//9v/y//j/9P/6//b/+//3//v/+P/6//r/+P/8//f////4/wMA+v8HAP7/CwADAA4A' +
          'CAAPAAsADwAMAA0ACwAKAAkABgAHAAIABQD//wQA/P8EAPv/BAD7/wQA+/8DAPv/AQD7////+//9//r//f/5//7/+P8AAPn/AwD7/wUA/v8IAAEACgAFAAsACQALAAwADAAPAA0AEQAPABQAEgAXABYAGgAbAB0A' +
          'HgAfACAAIQAgACIAHgAhABsAIQAWAB8AEQAeAA4AHAAMABsADQAaAA4AGgARABkAEwAXABUAFgAWABQAFgARABYADwAXAA0AFwANABgADwAZABIAGQAWABkAGgAZAB4AGAAhABgAIwAYACMAGAAjABoAIgAcACEA' +
          'HgAfACEAHQAjABsAJAAaACMAGQAiABkAIAAZAB4AGgAbABoAGAAaABUAGQATABgAEgAYABEAGAARABgAEgAZABQAGQAVABkAFgAZABcAGAAXABgAFgAYABYAGQAWABsAFgAcABcAHQAYAB0AGQAcABoAGwAZABoA' +
          'FwAZABMAGAAPABcADAAWAAkAFQAIABQACQATAAsAEgANABAADgAOAA4ACwANAAgACwAFAAoAAgAKAAEACwABAA4AAQAQAAMAEwAEABMABQASAAYADwAGAAsABgAHAAcABAAKAAQADQAGABAACQATAA0AFQAQABUA' +
          'EQAUAA8AEAAMAAsABgAEAAAA/v/6//j/9f/z//L/8P/x/+//8f/v//L/8P/z//L/8//z//P/9f/x//b/8P/3/+7/+P/t//n/7f/6/+7/+//w//r/8//3//b/8//5/+//+v/q//r/5//5/+b/+P/n//f/6//2//D/' +
          '9//1//j/+//6/wAA/f8DAP7/BAD//wMA/v8BAPz//f/7//r/+v/4//r/+P/7//j//P/6//7//P////3/AAD+/wIA//8DAAEABgADAAkABgAMAAkAEAANABMAEAAVABEAFQARABMADwAQAAwADAAIAAgABQAEAAMA' +
          'AgACAAIAAgADAAMABgAFAAkABgANAAYAEAAGABMABQATAAQAEQADAA4AAwALAAQACQAGAAcACgAIAA4ACQASAAwAFAAOABQAEQASABMADgAVAAoAGAAIABsABwAdAAgAHwALAB8AEAAeABQAGwAYABkAGQAWABoA' +
          'FAAYABMAFgAUABMAFAAQABUADgAWAAwAFgAKABUACQATAAgAEAAIAA4ACQANAAoADQAMAA4ADwAQABIAEQAVABMAFwAUABkAFQAZABcAGAAYABYAGAATABgADwAYAAwAFwAKABYACQAUAAgAEQAIAA4ABwAKAAUA' +
          'BgAEAAMAAgABAAEAAAABAAAAAgAAAAQAAQAGAAEACAADAAoABQAMAAkADAAOAAoAEwAIABgABwAbAAYAHQAHAB4ACgAdAA0AGwARABkAFAAYABUAFwAUABYAEgAWABAAFgANABQADQASAA4ADgARAAkAFAAEABgA' +
          '//8ZAPz/GQD6/xYA+/8SAP3/DQAAAAgABAADAAgA//8LAPv/DAD5/w0A+P8OAPj/DwD5/xEA/P8UAP//FwAEABkACQAbAA4AHAATABsAFwAaABoAGQAcABcAGwAWABgAFQAUABMAEQARAA8ADgAQAAsAEgAIABYA' +
          'BgAbAAQAHwADACAAAgAgAAMAHAAEABcABgARAAgADQAKAAkADAAHAA4ABwAOAAcADgAIAA4ACAAOAAgADgAIAA8ACAARAAkAEgAKABIACgARAAsADgAKAAoACQAFAAcAAQAEAP7/AQD8//7/+//8//r//P/5//3/' +
          '+P8AAPf/BAD2/wcA9/8JAPn/CAD9/wQAAgD//wgA+f8OAPP/FADv/xkA7f8cAO3/HQDw/xwA9f8aAPv/FQABAA8ABgAJAAoABAAMAAEADQAAAA4AAQAOAAMADQAGAA0ACAAMAAkACgAJAAkABwAHAAUABAADAAIA' +
          'AQABAAAA//8AAP3/AAD7/wEA+f8CAPb/BAD0/wYA8f8HAO//CADw/wkA8v8KAPf/CgD8/woAAwAKAAgACgAMAAkADwAGAA8ABAAOAAEACwAAAAcA/v8DAP7////+//v//v/4//7/9v/+//T//v/y//7/8f////D/' +
          'AQDw/wQA8v8HAPX/CQD5/wwA/f8NAAAADgADAA4ABQAPAAcADwAHABAABwAQAAgAEAAJABAACgAQAAwADwANAA0ADwAKAA8ABgAOAAEACwD8/wcA9/8DAPP//v/x//n/8f/1//H/8f/x/+7/8f/r//L/6f/z/+n/' +
          '9f/p//j/6//8/+7////x/wEA9f8AAPj//v/7//r//P/3//z/9P/6//L/9//x//P/8P/v/+//7P/t/+r/6v/p/+b/6f/j/+n/4v/q/+L/6//j/+z/5v/s/+r/7P/u/+v/8//p//f/6P/6/+f/+//m//z/5//6/+j/' +
          '9//p//P/7P/w/+7/7f/y/+z/9P/s//f/7f/5/+//+v/v//r/7//5/+//+P/v//X/8P/z//H/8f/0//H/+P/y//v/9f/+//j/AAD7/wEA/P8CAPv/AgD6/wIA9/8AAPX//v/z//z/8//7//P//P/1//7/+P8BAPv/' +
          'BAD//wYAAgAHAAYABQAJAAIACwD//w0A/f8PAPz/EAD9/xAAAAAQAAMADgAFAAwABgAKAAYABwADAAQA/v8BAPn////1//7/8f/+/+//AADu/wQA7/8IAPL/DAD1/w8A9/8RAPn/EQD5/xIA9/8SAPX/EQDy/xAA' +
          '8f8OAPH/CwDz/wgA9v8FAPn/AgD7/////P/+//v//v/4////9P8BAPH/AgDu/wMA7f8DAO3/AgDu////8f/8//T/+P/2//X/9//0//f/8//1//T/8v/2//D/+f/u//z/7v/+/+/////w//7/8f/8//L/+P/x//T/' +
          '8f/v//D/6//v/+j/7v/m/+z/5P/r/+T/6f/k/+j/5v/m/+j/5f/q/+T/7P/k/+7/5P/v/+T/7//k/+//5P/t/+P/6//i/+j/4f/l/+D/4//g/+P/4P/k/+H/5f/i/+f/4//o/+T/6P/l/+b/5v/k/+j/4v/q/+H/' +
          '6//h/+3/4f/v/+L/8f/k//T/5f/2/+f/+f/o//r/6f/7/+n/+//p//r/6P/6/+f/+v/m//r/5v/6/+X/+v/m//n/5//3/+r/9v/u//b/8//2//j/+P/9//r/AgD8/wUA//8HAAEACAACAAYAAwADAAIA//8BAPv/' +
          '///3//3/9f/6//X/9//2//T/9//y//n/8f/6//L/+v/y//r/8//5//P/+P/y//j/8f/4//D/+f/w//r/8P/7//L/+//0//z/9//7//j/+v/4//r/9//5//b/+v/0//3/8/8BAPL/BgDx/woA8P8OAO//EADu/xAA' +
          '7f8OAOz/CgDs/wYA6/8BAOr//f/p//n/5//3/+X/9f/k//T/5f/y/+b/8P/p/+7/7P/r/+7/6f/u/+j/7f/n/+n/6P/m/+v/4v/u/9//8v/e//b/3f/5/97/+//e//z/4P/8/+H/+v/j//f/5f/0/+j/8P/q/+3/' +
          '7P/p/+7/5v/w/+X/8//l//X/5v/2/+r/9//u//b/8//1//j/8//8//H////w/wEA7/8AAO///v/w//v/8f/3//L/9P/z//H/9P/v//X/7//1/+//9f/x//X/9P/2//j/+P/8//n////6/wAA+/8AAPz////8//z/' +
          '/f/4//7/9P/+/+///v/s//z/6f/5/+n/9f/p//D/7P/s/+//6v/y/+n/9P/r//T/8P/z//b/8f/8/+//AQDt/wQA6/8DAOn/AADp//n/6v/z/+z/7f/w/+n/8//o//f/6v/7/+3//f/y////9f8AAPf/AAD3////' +
          '9v/+//T//P/y//v/8v/5//T/+P/3//j/+//4//7/+f////n//v/6//r/+v/1//n/7v/4/+f/9v/h//T/3f/x/9r/7v/Z/+v/2P/p/9n/6P/Z/+f/2v/n/9z/5//e/+j/4v/p/+b/6//r/+7/8P/y//X/9v/4//n/' +
          '+//6//z/+v/8//j/+//2//n/8v/3/+//9f/u//X/7f/1/+//9v/y//b/9v/2//r/9f/9//P//v/y//3/8//6//X/9//7//P/AgDw/woA7v8SAO7/GADx/xwA9f8cAPz/GQACABUACQAQAA8ACwATAAkAFwAIABkA' +
          'CAAaAAkAGAAJABUACAAQAAcACAAFAAAAAwD4/wEA8f8AAOz/AADq/wEA6v8EAOz/BwDw/woA9f8KAPr/CQD+/wUAAgABAAQA/P8GAPn/CAD4/woA+f8LAPz/DQD//w4AAwAOAAUADQAHAAsABwAIAAcABAAGAAEA' +
          'BgAAAAcAAQAHAAQACAAJAAgADgAHABMABgAVAAQAFQADABIAAgANAAEACQACAAUAAwADAAUAAwAHAAMACQADAAoAAgALAP//CwD7/wsA9f8MAO//DQDr/w4A6f8QAOn/EADt/xAA8/8OAPn/CgAAAAUABQD//wgA' +
          '+v8JAPf/CAD1/wcA9v8GAPf/BgD5/wYA+f8GAPj/BQD3/wMA9f8AAPT/+//0//b/9f/y//f/8P/6//H//P/z//7/9v8AAPr/AQD9/wEA//8BAP/////+//3//f/7//v/+f/6//j/+v/4//r/+f/7//v//f/7////' +
          '+/8AAPn/AQD4/wIA9v8DAPf/BQD4/wgA+v8LAP3/EAD//xQAAAAXAAAAGQAAABgAAQAWAAMAEgAFAA0ACAAJAAoABQAMAAMADAADAAoAAwAIAAQABAAEAAIABQD//wUA/v8FAP7/BwAAAAkAAgAMAAUAEQAIABYA' +
          'CwAbAA0AHwANACAADAAfAAkAGwAGABYABQARAAQADAAGAAoACAAIAAkACQAKAAoACAAMAAUADgABABEA/f8UAPn/GAD3/xsA9v8eAPX/IQD2/yEA9v8gAPb/HQD2/xgA9v8SAPf/CwD5/wUA/P8AAP///f8BAP3/' +
          'AwD//wMAAwABAAYA//8JAPz/CgD5/woA9/8IAPX/BgD1/wIA9v////j//f/7//v//v/6/wAA+f8CAPj/AwD3/wQA9v8EAPf/BQD6/wYA/v8IAAQACQAKAAoAEAAKABQACQAWAAYAFQADABIAAAAOAP3/CQD6/wQA' +
          '+v/+//r/+f/8//X//v/y////7/8AAO3/AADr/wAA6f8BAOf/AgDm/wMA5/8EAOn/BgDs/wcA8P8HAPX/CAD6/wgA//8JAAMACQAHAAkACwAIAA0ABgAQAAQAEQADABEAAgAQAAMADgAFAAoACAAFAAsAAQAOAP3/' +
          'EAD6/xEA+v8SAPv/FAD//xYAAwAYAAkAGQAPABgAEwAXABcAFAAYABEAGAAPABYADgAVAA8AEwARABQAEwAVABQAGAAWABwAFwAgABkAJAAbACcAHQAqAB4AKgAeACkAHQAnABsAJAAaACAAGQAbABkAFgAaABIA' +
          'GwAPABsADQAaAAwAGQAMABcADgAWABEAFgAVABgAGwAZACEAGgAoABkALgAXADMAEwA3ABAAOQAOADkADgA4ABEANgAVADQAGgAyAB4AMAAgAC4AHgAsABsAKQAWACYAEgAjAA4AIQAMAB8ACwAeAAwAHgANAB8A' +
          'DwAgABIAIgAUACIAFQAiABUAIAAUABwAEQAYAA8AEwANAA4ADAAJAAwABQAMAAIADAAAAAwA//8KAP7/CQD//wkAAAAIAAIACQAEAAsABgANAAkADgAMAA4ADwANABAACgARAAcAEQAFABAABQAOAAcADAAMAAkA' +
          'EAAGABMAAwAUAP//EwD8/w8A+f8MAPf/CAD1/wYA9f8FAPX/BQD2/wYA9/8IAPn/CgD8/woAAAAKAAMACQAHAAcACgAGAA0ABgAQAAcAEgAJABIADAASAA8ADwATAAwAFgAHABgAAgAYAP3/FQD4/xAA9P8KAPH/' +
          'BQDw/wIA8P8CAPL/BQD1/wkA+v8NAAAAEAAFABEACQARAAsAEAAMAA4ACgALAAcACQAEAAcAAgAGAAIABgADAAcABgAIAAkACQANAAsADwAMABEADgARABAAEQARABAAEwAPABQADwAWAA8AGAAQABsAEAAdAA8A' +
          'HwAOACEADAAiAAkAIgAGACEABAAgAAMAHgADABsABQAXAAgAEgANAAwAEgAFABYA//8aAPz/HAD7/xwA/P8aAP7/FwABABMABAAPAAUADAAGAAkACAAIAAoABgANAAUAEQADABQAAQAXAP7/GQD8/xgA+v8WAPn/' +
          'EwD4/xAA+f8NAPr/CwD9/woAAAAJAAMACAAFAAcABwAGAAcABgAGAAgABQAKAAQADgADABIABAAWAAUAGgAGAB0ABwAgAAgAIwAHACUABgAnAAQAJwABACYA//8kAPz/IQD6/x4A+P8bAPf/GAD3/xUA+f8SAPz/' +
          'DwABAAwABQAKAAkACQAMAAsADQAOAAsAEgAJABgABgAdAAMAIAACACEAAgAgAAMAHgAFABwACAAbAAoAHAAMAB4ADgAgABAAIgAQACQAEAAkABAAIwAPACEADwAfAA8AHgAQABwAEQAbABQAHAAXAB4AHAAhACAA' +
          'JAAkACYAJwAoACkAKAAqACYAKAAjACUAIAAhABwAHAAaABgAGQAVABoAFAAdABUAHwAWACAAGAAgABkAHgAZABwAGQAZABkAFwAZABcAGQAYABkAGgAZAB0AGQAgABkAIQAXACMAFQAjABIAIgAOACIACwAhAAgA' +
          'IQAGACAABQAeAAYAHAAIABgACgAUAAwAEQANAA4ADgAMAA4ACgAOAAoADgALAA8ADAARAA4AEwAQABUAEwAXABQAFwAUABUAFAATABMADwASAAsAEQAHABEABAASAAIAFAAAABQA//8UAP7/FAD9/xIA/f8QAP3/' +
          'DgD9/w0A/v8MAP//CwABAAkAAwAHAAUABQAGAAIABQD//wMA/f////z/+f/8//P//f/u//7/6v///+n////o//7/6f/9/+r/+//r//n/6v/3/+r/9f/p//P/6P/x/+j/8f/p//H/6v/z/+z/9f/u//f/8P/3//L/' +
          '9//z//X/8v/y//H/7//w/+3/7v/r/+z/6v/q/+v/6f/r/+j/7P/p/+3/6f/t/+r/7f/r/+3/7P/u/+7/8P/x//L/9P/1//f/+P/6//v/+//8//r/+//3//r/8//3/+7/8//p/+7/5v/q/+X/6P/l/+b/5//m/+r/' +
          '6P/t/+r/8P/s//H/7v/y//D/8f/x/+//8f/s//L/6v/z/+f/9f/m//f/5f/6/+T//f/l//7/5v/+/+f//P/o//n/6v/2/+z/9P/t//L/7//w//D/7v/x/+z/8f/o//D/5f/w/+L/7//h/+3/4//s/+b/6//q/+n/' +
          '7v/n//H/5v/z/+X/8//l//H/5v/v/+j/7P/q/+n/7P/n/+3/5v/u/+X/7//l/+//5f/v/+X/7//m//D/5v/w/+b/8P/n//D/5//w/+f/7//o/+3/6P/r/+n/6f/q/+j/6//n/+v/6P/q/+r/6P/t/+b/8P/j//X/' +
          '4f/4/+D//P/e//7/3f/+/93//v/d//3/3v/8/+D/+v/k//f/6f/1/+7/8f/z/+7/9//r//n/6f/6/+j/+f/p//b/6v/y/+z/7f/u/+f/7//i/+//3f/v/9f/7v/S/+3/zv/r/8v/6f/K/+j/y//n/83/5v/Q/+b/' +
          '0v/l/9P/5f/U/+X/1P/l/9b/5f/Y/+X/3P/n/+D/6f/j/+z/5f/v/+b/8v/l//P/4//0/+D/8//e//H/2//v/9j/7f/V/+z/0//s/9H/7f/Q/+7/0P/v/9H/8f/S//L/0//0/9b/9f/Z//b/3f/3/+H/9//k//b/' +
          '5//1/+j/8//o//D/5v/t/+P/6f/f/+T/2f/d/9T/1v/Q/9D/zf/L/8v/yP/K/8j/yv/K/8r/zf/L/9L/zv/W/9H/2v/V/9z/2P/d/9r/3v/Z/93/1//c/9T/2//S/9r/0P/Z/8//1//Q/9X/0f/U/9P/0v/U/9H/' +
          '1P/Q/9P/0P/Q/9D/zf/R/8r/0//I/9T/yP/V/8r/1v/N/9X/0P/U/9P/0v/U/9D/1P/P/9L/0P/Q/9H/z//U/83/1//M/9r/y//d/8v/4P/L/+P/zP/k/87/5f/P/+T/0P/i/9H/3v/R/9r/0P/X/9D/1P/Q/9L/' +
          '0v/S/9X/1P/Z/9f/3f/b/+D/3//i/+L/4v/l/+L/5//h/+n/4f/q/+P/6//l/+z/6f/t/+z/7v/u/+//7v/v/+3/7//r/+7/6P/s/+b/6v/m/+j/6P/n/+z/5//x/+r/+P/u//3/9P8CAPv/BQACAAYACAAFAA4A' +
          'AgASAAAAFgD9/xgA/f8YAP7/GAABABYABAAVAAgAEwAJABEACQAQAAcADwAEABAAAgARAAIAEwAEABUACAAXAA0AGQARABoAEwAaABMAGgASABoAEQAZABAAGAARABYAFAAVABgAEwAdABMAIAASACIAEwAhABMA' +
          'HgATABkAEwASABMACwATAAYAFQADABcAAwAaAAYAHQAKACAADwAiABQAJAAYACQAGgAjABsAIQAbAB8AGwAdABoAHAAaABsAGQAcABgAHAAXABwAFQAaABMAGAARABQAEAAPAA8ACwAQAAcAEQAGABQABwAYAAkA' +
          'HQAOACEAFAAjABoAJAAfACIAIwAgACYAHAAnABgAKAAUACgAEAAnAA0AJgAMACMACgAfAAoAGgAKABMACwAMAAsABQAMAAAACwD8/woA/P8JAP7/CAACAAgACAAKAA4ADgATABQAFgAbABcAIAAXACMAFgAiABYA' +
          'HgAWABgAFgASABcADAAWAAcAFAAEABEAAQANAP7/CgD8/wkA+/8JAPv/CwD7/w4A/f8SAAAAFAACABUABQAUAAcAEQAJAAwACwAIAA0ABQAPAAMAEAADABAABQAPAAgACwAMAAcADwADABAA//8PAPz/DAD7/wcA' +
          '+v8BAPn/+//4//f/9//1//b/9P/2//P/9v/y//f/7v/5/+v//P/o////5v8CAOf/BQDs/wcA8/8IAP3/BwAGAAQADgABABMA/P8UAPj/EgD0/w0A8P8HAO7/AQDt//z/7P/5/+3/+P/u//j/8P/5//T/+v/4//r/' +
          '/v/5/wQA+P8JAPX/DADy/wwA8P8JAO7/AwDu//v/7//0//H/7v/x/+r/8f/r//H/7v/w//P/8P/5//D//f/v////7v///+z//f/q//v/6P/5/+b/+P/m//r/5//8/+r////u/wMA9f8FAPz/BgADAAUACQAEAA0A' +
          'AgAQAP//EAD8/w4A+f8MAPf/CgD2/wgA9f8GAPX/BAD1/wEA9f/+//X/+//1//j/9P/1//T/9P/0//T/9//3//v/+/8AAAAABAAFAAcACAAHAAkABQAHAAIAAwD+//3/+//3//n/8v/4/+//+P/t//j/7v/6//H/' +
          '/P/1////+/8CAAAABQAFAAgABwAKAAkACQAKAAgADAAGAA4AAwARAAIAFQADABcABAAYAAUAFgAGABQABwARAAYADQAGAAoABwAIAAgABwAJAAcACgAJAAoACgAKAAwACQANAAgADgAKAA4ADgANABIACwAXAAgA' +
          'GgAFABwAAgAcAAAAGgD+/xgA/v8VAP//EwABABAABAAOAAgADAANAAoAEgAIABcACAAdAAgAIQAKACMADAAjAA8AIQAQAB4ADwAbAA4AFwANABQADAARAAwADQANAAgADwACABAA+/8QAPT/DgDv/wsA7P8JAOz/' +
          'BwDu/wYA9P8HAPv/CAADAAkACgAKAA8ACwASAAsAEwAMABMADQASAA8AEQAQABIAEgAUABQAFwAWABkAFwAaABcAGgAYABcAGAATABYADgAUAAkAEQAGAA0ABgAJAAgABQAKAAEADAD9/w0A+v8MAPj/CQD4/wYA' +
          '+v8CAP7//v8DAPr/CAD3/wsA8/8LAPH/CQDx/wUA8f8AAPP/+//2//n/+v/5//3/+/8AAP//AwACAAUABAAHAAUACQAFAAoABQAJAAQACQAEAAgABAAIAAUACAAGAAgACAAIAAoABwAMAAYADQAEAA4AAgAOAAEA' +
          'DQAAAA0AAAAOAAIADwAGABAADAARABMAEAAZAA8AHQAOACAADAAhAAoAIAAJAB0ACAAYAAcAEgAHAAsACAAGAAoAAQAMAP7/DgD8/xEA+/8SAPv/FAD8/xYA/f8YAP7/GQABABkABQAYAAkAFwANABYAEAAVABIA' +
          'FQATABYAEwAWABIAFwARABkAEAAbAA8AHgAQACEAEQAjABQAJAAYACIAHQAdACAAGAAjABMAJAAOACIACwAeAAkAGgAIABUACAARAAgADgAIAAsACQAJAAkACAAIAAYACAAEAAcAAgAGAAIACAADAAwABAARAAYA' +
          'FgAIABsACQAdAAgAHAAIABcABwARAAcACwAIAAcACwAFAA4ABwARAAoAEwAPABUAFAAWABgAFgAaABMAGQAPABgACgAXAAUAFgAAABYA/f8WAPz/FQD+/xQAAQASAAYADwAKAA4ADgAMABAACwAQAAsADwAKAA4A' +
          'CgANAAsADQANAA4AEQAOABUADwAYAA8AGgAOABoADQAXAAwAFAALABEACgAPAAoADAAJAAsACQAMAAoADQALAA8ADQASAA0AFgANABoADAAdAAoAIQAJACQACAAlAAkAJQALACQAEAAjABcAIAAdABwAIgAYACQA' +
          'EwAkAA4AIAAKABsACAAVAAkADwAMAAsAEQAJABgACgAdAAsAHwANAB4ADwAcABAAGgAQABcADwAXAA0AGAAMABoACgAaAAoAGQAKABkACgAYAAkAFwAIABcABwAYAAUAGAAGABUACAASAAwADwARAAsAFwAIABwA' +
          'BwAfAAYAIAAFAB4AAgAaAP//FQD7/w4A9v8GAPP////x//n/8v/2//P/9f/2//X/+f/3//n/+f/3//z/8//+//D////t////7P///+3//v/v//3/8P/6//H/9v/y//H/9f/r//j/5f/7/9/////a/wAA1//+/9j/' +
          '+f/a//P/3//t/+b/6f/u/+f/9v/p//7/7P8EAPD/CgD0/w8A+P8SAPr/EwD6/xMA+v8QAPn/DAD4/wUA9v/9//X/9f/1/+3/9v/l//f/3v/6/9r////Y/wIA2v8DAN3/AwDi/wIA5//+/+v/+//v//n/8P/7//D/' +
          '/f/v/wEA7/8FAO//CADw/wgA8f8FAPT/AgD3////+P/8//n/+v/5//v/+v/9//z//f8AAPz/AwD8/wUA+f8HAPX/BwDy/wUA8/8DAPX/AAD4//7//f/9/wEA/f8DAP3/AwD+/wIA/v8BAP//AAAAAP//AQD//wMA' +
          'AAAFAP//CAD9/wsA/f8NAP3/DwD9/w8A/P8NAPz/CgD7/wUA+f8BAPn//f/7//n//v/3/wEA+P8EAPn/BgD8/wUA/v8BAAAA/f////r//f/5//v/+v/7//3//P8AAAAAAQAGAAAADQD8/xIA9/8UAPD/EgDq/w0A' +
          '5/8FAOj//f/r//X/7//v//T/7f/4/+//+//y//3/9f////j/AAD6//7/+//8//v/+v/8//f//P/2//7/9v8AAPj/AAD6////+f/9//j/+f/2//P/8v/u/+7/6v/u/+j/8f/o//T/6//5/+7//f/z////9//9//n/' +
          '+v/6//b/9//y//P/7v/v/+3/6v/t/+X/7v/h/+7/3//u/9//7v/f/+3/4f/u/+P/8v/k//j/5v/9/+j/AADr/wIA7/8CAPX/AQD8////AgD+/wcA/f8KAPz/CwD7/woA+/8GAPz/AgD9//7//v/6/wAA9v////P/' +
          '/f/w//r/7f/2/+v/8//p//H/6P/y/+j/9f/o//j/6v/6/+3//P/x//z/9P/5//j/8v/9/+v/AADl/wIA4P8DAN7/AwDf/wIA4v8BAOX////m//3/5//7/+b/9//k//L/4//s/+P/5f/l/9//5//c/+r/3f/v/+H/' +
          '8//p//b/8f/6//n//f/+//7/AAD+/wAA/f/+//r//P/1//r/8P/7/+z//v/q/wMA6f8HAOr/CwDs/w0A7v8MAPD/CADy/wMA9P/8//b/9v/3//L/+f/w//r/7//6//D/+P/y//X/9P/z//b/8P/3/+7/+f/v//r/' +
          '8f/7//P//P/2//z/+f/7//r/+f/6//X/+v/y//v/7v/+/+z/AwDt/wgA8P8OAPT/EgD5/xMA/v8RAAMADgAGAAoACAAFAAgAAQAGAP7/BAD8/wEA+v////v//f/9//z////7/wEA+v8EAPn/BQD2/wYA9P8GAPP/' +
          'CADz/woA9f8MAPj/DQD9/w0AAgAMAAYACQAGAAYABgAEAAQABAABAAUA/f8HAPv/CQD7/woA/f8JAAEABwAHAAUADQABABQA+/8aAPb/HQD0/x0A8/8ZAPX/EwD5/wwA/f8EAAAA/f8DAPj/BAD2/wQA9/8EAPj/' +
          'AwD6/wEA/P///////f8BAPr/AgD5/wQA+f8FAPn/CAD4/woA+f8MAPr/DgD5/xAA9/8RAPX/EAD0/w4A8v8KAPH/BgDx/wIA8P///+3//P/r//r/6//4/+n/9//p//X/6v/z/+3/8f/u//H/7//0/+7/+P/s//3/' +
          '6f8CAOj/BwDq/wkA7f8JAO//BwDw/wMA8P///+3/+v/n//b/4v/y/97/8P/d/+//3f/v/9//7//j/+//5f/u/+f/7f/o/+v/6f/p/+r/5//q/+b/6v/m/+r/5f/p/+X/5//k/+f/4v/p/+D/6//e/+7/3f/x/93/' +
          '8v/g//D/5v/q/+3/4v/0/9r//P/S/wMAy/8IAMj/CADJ/wYAzP8AANL/+f/b//D/5f/n/+7/3//1/9f/+v/S//z/zv/6/8v/9f/K//D/y//q/83/5f/O/+P/0P/k/9L/5v/W/+b/2//n/+H/5//m/+j/6//o/+7/' +
          '6v/x/+3/8v/u//L/7f/0/+3/9v/t//n/7P/7/+r//f/o//7/5f/+/+P/+//i//X/5P/u/+n/6f/t/+X/8P/k//P/5f/z/+n/8f/v/+z/9v/p//r/5//9/+X////l/wEA6v8CAO//AgDz/wAA+f/+//7//f8AAPr/' +
          'AAD3////9f////T//P/1//r/9v/5//f/9//6//b////1/wQA+P8HAPz/CQD//wkAAwAJAAgACAANAAYADgAEAA8ABQAOAAkADAAMAAgAEAAGABMABQATAAMAEAADAAsABQADAAgA+/8IAPf/CAD2/wkA9v8IAPb/' +
          'BwD3/wgA+P8LAPf/EAD1/xYA9P8cAPX/IAD6/yEA//8gAAYAGwANABUAFQANABsABgAhAP//JAD7/yYA+v8nAPr/JgD8/yQA//8gAAEAGwADABUAAwAOAAIABwABAP/////4//3/8v/+/+3/AADp/wMA5/8HAOf/' +
          'CwDq/w0A7/8NAPX/DAD6/wsAAAAJAAYABwAMAAQAEgD//xcA+f8dAPP/IgDv/yYA7v8pAPD/KgD1/ykA+/8mAAIAIAAIABgACwAPAA0ACAAPAAUAEAAEAA8ABwAQAAsAEQARABIAFgATABgAFQAYABQAFwASABUA' +
          'DwASAAwADwAKAA0ABwANAAQADgADABAAAwARAAIAEgACABIAAQATAP//EgD+/xIA/v8TAP//FgAAABoABAAeAAgAIAAOACAAFAAeABkAGgAcABMAHAAMABsABwAXAAUAEgAEAAsABQAEAAcAAAAIAP7/CQD+/wkA' +
          'AQAJAAYACQAMAAwAEQAQABQAFQAVABkAEwAdABEAHwAQAB4ADwAZAA8AEwAOAA0ADgAJAA0ABwANAAcADwAIABMACgAWAAwAFwANABgADAAXAAkAFQAGABUABAAXAAIAGgACABwABQAeAAsAHgARABwAFAAXABQA' +
          'EAASAAkADQAEAAgAAgACAAQA/P8JAPn/EAD7/xYA/P8aAP7/HAABABsAAwAWAAMAEwABABMA/v8QAPr/DAD4/wsA+P8LAPr/CQD8/woA//8OAAEAEAACAA8AAgAQAAEADwACAA0ABgAKAAsACgAQAA0AFAANABYA' +
          'DAAWAAoAEwAHAAwABAADAAEA+f8CAPH/AwDq/wQA5P8FAOH/CQDk/wwA6/8OAPL/DQD5/wwAAAAKAAUACgAIAAsACQANAAoADgANAAsAEQAJABcABwAaAAcAHAAFABsABgAWAAoADgALAAYACgD+/wkA+P8IAPb/' +
          'BgD2/wUA9v8KAPf/EAD4/xYA+f8aAPr/HgD7/x8A/f8cAAEAGQAGABYACwARABAACQAUAAEAFwD6/xkA8/8ZAO7/FwDs/xQA7v8RAPT/DgD8/wsABQALAA0ADgAQAA8ADgAPAAsADAAKAAcACQABAAkA+/8KAPn/' +
          'CgD5/wcA/f8FAAEABQAGAAYACQAHAAwACAAOAAkADgAIAA8ABAAQAAAADwD8/w0A+v8MAPn/DAD6/wsA/f8LAP//DQD//w4A/v8PAP//DQD//wwA/f8KAP3/CAAAAAgAAgAGAAQABAAIAAAADgD9/xEA+v8QAPj/' +
          'DQD4/wwA+/8KAAEACQAHAAcADAAEABAA//8QAPn/DwD4/wwA+P8JAPf/BwD4/wgA/v8LAAYADQAKAA4ACwAPAAwADwAMAA8ACQAPAAcADwAKAA4ACwALAAYABgADAP7/AwD2/wAA8P/6/+v/+P/q//f/6f/z/+n/' +
          '8f/q//P/7f/y//D/7f/z/+n/+v/o/wIA6P8HAOX/CADl/wgA6f8GAO//AQDz//v/+P/2//3/8/8BAO//AwDu/wMA6/8EAOn/AADo//n/6f/0/+v/8P/s/+v/7f/o//D/6//z//T/8//6//H//v/v/wEA7v8CAOz/' +
          '+//n//L/4v/r/9//5v/b/+L/2f/j/9j/5v/X/+j/2v/o/+D/6//i//D/4f/4/+H/AQDi/wcA4/8IAOT/BQDm////6P/9/+j////o/wAA5v///+H//v/e//r/3//3/97/9f/d//X/3v/3/+D/+//h//3/5P///+n/' +
          'AADv////+P/8/wIA9/8JAPX/DQD2/xEA+f8VAP3/FAACABMABgARAAYADQAFAAcAAgAAAPz/9//1/+7/8//o//X/5//0/+j/8v/p/+3/7P/q/+//6v/x/+7/8P/2//D//f/z//z/9//5//z/9f/+//H//v/w/wAA' +
          '8f8EAPb/BgD+/wgABQANAAsAEAAPABEADQARAAkAEAAHABAACQASAAoAFQAIABcACAAZAAYAHAAEACAABgAjAA4AJQASACgADgAqAAoAKQAEACUA9/8hAOr/GwDl/xUA4v8TAOL/DgDr/woA9v8IAP3/CAD//wYA' +
          'AgADAAQAAwAHAAIADAACABAABAANAAYAAwAJAPr/DADy/w4A7v8PAO//DQDw/woA8v8HAPX/AgD8//7////4/wIA9P8GAPP/CAD1/wYA+f8HAP7/CgADAAkABgAIAAYACAAFAAYAAwABAAEA/P8AAPr/AgD7/wcA' +
          'AQAIAAwABwAVAAUAFgAFABAABAAGAAIA/P8DAPj/CgD7/w8AAgARAAkAEgAKAA8ACQAKAAUABQADAP//AgD1/wQA7f8HAOz/CQDt/w0A6v8OAOv/DQDz/wgA/v8BAAQA/f8FAPz/BgD//wQABQAAAAsA+/8PAPf/' +
          'EADy/xEA8f8PAPT/CwDz/wgA7/8NAPD/FAD1/xkA+f8aAP//GQAHABUAEgARAB4ADwAoABAALAAUAC0AFQAuABIALAALACUABAAeAAIAGgAFABYADgARABoADQAlAAwAKgALACcADAAhAA0AGAALABYACgAbAA0A' +
          'JwANADEACwA0AAwALwATACUAHQAbACMAEwAlABYAJwAgACYAKQAfAC0AFgAtAA8AKgAKACMABwAbAAgAGwAHAB8ABQAgAAcAJgAJACgADQAgABMAFAAbABEAIwASACsAFAAvAB8ALQAsACkAMgAlAC4AHQAnABAA' +
          'HQAIABIABwANAAcACgAHAAoADQAJABMACAAWAAYAFwAIABgADwAXABwAEQAvAAoAQgADAE8A//9LAP7/PwACAC8ABQAcAAcACgAMAP//EgD+/xUAAgAUAAoAEwAUABIAGAAPABYADQAUAAkAFQAFABgABQAbAAgA' +
          'HAAHABcABQAMAAgAAwANAPz/DwD//w0ACAALABAABgASAP//DQD4/wYA7f/6/+H/9P/d//X/4v/5/+b//v/o/wMA7v8GAPb/BgD5/wYA9/8AAPT//f/x//3/7//7//L//f/z//v/8v/4//b/+f8AAAEACgAHAA0A' +
          'BAARAP3/GQDy/x0A9P8YAP3/DwAHAAwADwANAA4ADAAOAAkAEAABABIA+f8XAPb/HwDy/yUA5f8nAN7/JADl/xcA7f8CAPH/8P/0/+n/9v/o//X/6f/2//D/+f/6//L//v/w/wIA/f8CAAYABAAFAAIACAD3/xMA' +
          '8v8ZAO7/HQDn/ycA5v8qAOz/IADr/xwA7v8XAP3/AgAUAO7/KQDn/zIA4/8vAN//GwDm/wIA7f/v/+7/5v/0/+T//v/p/wAA8v8AAPX/BQABAAsAEAAMABYADQAZAA0AIAAHACcABAAjAAcAHwAHABUAAwD+/wMA' +
          '6v8JAOf/BgDs/wIA7P8FAPb/AQANAPX/GADr/xUA4/8OANb/AADS/+j/3//U/+3/1f/4/9z/BgDb/xQA1/8SAM//CgDG/wcAwv/9/9D/8f/t/+r/BgDq/xIA5/8SAOT/DwDr/w4A9f8PAAIACAATAP7/JQD4/zIA' +
          '8f81APD/MgD4/yMA+v8OAPv/+/8BAOf/AgDP//3/vf/9/7v///++//z/vv/3/8f/8v/c/9//8f/A/wEArf8JALD/CwDF/wgA3//8//T/7P/8/9z/7v/O/9r/y//O/8//zf/N/9v/0f/w/+r//f8GAP7/EgDz/xYA' +
          '5f8dAOT/HADz/xEABgAGAA4A//8KAPv/CQD0/wsA8P///+3/7P/h/93/2//X/+T/2v/o/93/3f/X/+T/zv/2/83/8P/K/+D/vf/b/7P/1v+x/8X/t/+//83/wf/z/8H/AwDN//T/5v/i//f/2f/1/87/7//A/+3/' +
          'wf/m/7z/1/+s/8j/ov/C/6n/xf/F/8f/5/+9/wwAuP8sAMv/NgDs/ygACwAKACYA8/85AOD/PADM/zoAuP81AK7/FgC8//D/0f/k/+r/4v8LAM3/JAC+/yoAzf8vAOT/OAD2/ysAEAAIACQA6P8jAM3/HgCr/x8A' +
          'kP8XAJD///+o/+3/y//c//j/wP8gAKP/JwCb/xIAq////8f//P/r//j/FADt/zIA3v82AMT/KQCs/xUAo//4/6n/0P/E/6z/7/+a/xUAjP8tAH//OACC/zAAl/8WALX/+v/d/93/DwC+/0EAov9hAJr/agCo/2YA' +
          'uP9QANT/KQD6/wEAFQDl/xwA1f8XAND/EgDW/wMA5//3//n/6/8DAN//DgDR/yIAxf8vAMz/KwDl/x0AEQAKAEEA5v9aAL//WgCo/0IAnv8bAJ7/8/+z/8r/1/+j//f/hf8OAIb/KACm/z8Ax/88AN3/LQDt/x0A' +
          '+P/8//P/0P/w/6z/9f+V//L/jP/r/5f/4v+4/9f/5v+3/xAAm/8tAKP/QADM/0sAAwBGADgANwBsACwAhQAaAHUA+f9GAOD/FQDU//X/yv/e/8j/0v/e/83/BQDF/yUAuP83AL3/PQDc/zUA+/8fAAkA/v8YAOD/' +
          'KwDG/yoAuP8ZAMP/AgDP/+r/0v/Z/9r/1v/l/+f/9f8BABUAEgA1AB0ARwApAFMAKQBcABkASgAJAB8ACQAAAA0A7f8JAN//AwDj//r/9P/w//z/8P8HAP//IwAUADcAIgA3ACIAOgAYAEkABgBHAPH/LQDs/xQA' +
          '+v/6/wkA0f8KALv////B/+7/wP/i/7v/5//T//X//f8LABYAGAAiABgANwAZAEUAHwA7AB0AKQALAB8AAwAPAAMAAADx/wEA5/8HAO3/AwD0//v//v8CAA4ADgAZABEAIAAYAB8AIAAZAB0AIQAZACUAGQAgABAA' +
          'JAAGABsAAAAPAPb/DADx/w0A9f8MAPz/EAACABgADwAWACMAFAAmABAAFQAHAA0A9v8XAN7/GQDM/xUAv/8YAL7/FAC///7/xP/p/9T/3v/o/9v/+v/l//n/8//0//D/8//m//j/6f/7/+r//f/e//7/2P/x/+D/' +
          '8//r/wkA7/8hAOb/NgDn/00A/v9kAB4AWAAzAD0APAAkAEcADABJAPn/PQDw/zEA//8lAA0AFAAMABEADAAVAAgACAD6//f/8P/3//v///8LAAIACQAQAAgAHgAFACAAAAAqAP3/LwD5/xsABAAGABkAAwAyAPv/' +
          'PgDy/zcA+v8qAPz/FwD3/wgA/////wkABQADABcAAgAfAA8AGgAUABQACgAGAAMA8/8BAPT/8//x/+H/7f/a//X/3P8CAOf/BwDw//7/9//7//n/AAAAAPv/DgD7/xAABgAKABQACgAfABAAGQAJAAgA+P/z//T/' +
          '6f/6//L/AgAAAAkADAATABsAIgAfADcADABEAAUAQwAJADUACQAkABoAHQA8ABUARgABAC0A6/8hAOH/KQDX/yoAyv8fAMj/FgDZ/woA7//s//z/2v8CAN3/AgDq/wIA8/8RAPT/HgD+/x0A9/8eAO3/GgD1/wcA' +
          'AADv/woA4v8KAOP/+v/k/+//5f/5/+z/9v/v//X/+f8IAAYADAAMAAUADQD+/wsACgAEABIA9v8VAOP/JADQ/yoAx/8RAMb/6f/T/93/4P/Y/+3/0v8IAM//IgDI/y8Ayv8vAM3/LgDP/ygA3P8cAOv/DQD4/wAA' +
          'CgD7/yEA9f8uAPP/IgD5/wwA//8EAAIAAgASAPH/NgDx/04AFABOADUASQBMAEgAZQA9AHMALgBTACQAMAAcACkADgAhAAAACgAAAPb/9f/5//b/8v8UANr/KADH/ykAz/8mAOX/HwD6/wQAFQDy/yQA7f8bAN//' +
          '+//R/+f/yv/X/8v/vv/J/7L/0/+8/+P/2P/l//T/4v8FAOn/DQD6/xUAAAAMAAsA+P8dAPz/HwANABcAEgAXAA0AFwD//xMA5/8iANL/MQDc/yoADwAdAEAAIQBlACkAeQAwAGcAOgBIAEMANABOACQAVAAWAE8A' +
          'BwBFAAEAOgALACsAGQAYADIAEgBMAAsAVgD5/0wA5f8/AOD/OADx/yYA9/8IAPb/3v8DALj/EgCh/w4Akf8GAIX/AACg/+f/3P/a/wsA2v8kAMb/IwC0/wMAvv/I/9T/n//U/5n/yP+s/8//xP/d/9D/6v/Z//X/' +
          '4v/y//7/9f8lAPz/YAD+/5MAAQCTAAMAgAAcAGAARAAkAE0A4v9CAMv/TQDb/1UA6P9GAPL/QwAIAEUAKAA1ADoAIABIABUAZQAIAGQA+f9DAPr/LgAEACQADQAQAA4A9v8OAPv/EwAJACAAAQAgAPz/DwAcAPv/' +
          'RADr/1QA3P9SAMb/MQC2/w4Awf/u/9v/4f/q/93/9f/S/wEA3v/8/+D//f/d/xIA4/8VAPD/CAD7/woAAQAOAAoAAQADAPv//P/8//P/+P/m//3/2v8QAM//IwDH/ygAv/83AMv/UwDx/1EAJwAzAE0AJQBXACIA' +
          'SQAjACgAKwAUADIADQAuAA8AHAAaABEAEwAKAP7/BwABAAEABwD2/wYA9f8kAPL/VQDm/2kA0v9YAMf/XADS/1kA1/8vAND/FADf/wUA/P/d//n/wv/3/9T/EgDf/xwAAgAFABMAAQD4/xsA6v8lAMz/HQCW/xsA' +
          'bf8uAI7/LQDT/xwAKwA/AF0AewA3AIEA/P9eAMT/SgDd/y8ARgD3/58A3P+bAO//ZQDV/0cAn/8xAJ//GwCN//X/S//e/0b/8/+Y/wQAwP/H/5//kv+4/6D/9f/A/+L/yP/B/8r/7//q/xMA5P8MAN//MwDz/1oA' +
          'JQA8AE8ALQAmAEoA7/88ANT/DQDP/wsA+f8iAFIAHQB7AA8AgwAcAJkAJQCeAB4AgQAWAIAA8P+5AMn/ugDh/5YAOABlAHkAEgCGAMb/fwC5/2IA4P87AOP/KAD6/xkAQgAIAHIAIwB5AEYAWgAZACEA4//Z/wgA' +
          'pv83ALT/MwCn/z4AVP85AEr/+v+H/8b/pf/M/67/wP/b/3X/GwBl/1cAjP+YAGz/qABG/1IAgP/f/9P/tv/c/67/7v+4/ysA8P8TACQA5v8VABQA4v8yAO7/EgAZABkAKQA8AC8AHwAsAOz/IwD+/wwAIgDn/ysA' +
          '6/9EABsAXQAqAG4AHgCQAB0AmAAhAH0ALABkAEkATwB+ADkAkAAbAFcACQD//x4Ax/9EAMf/PgDq/xYADgAkABoATQAZADcAHAAWAAwAEwDt/wIA8P/f/yMAt/9dAIL/ZgBa/0QAbv8WAJn/7v+o/+X/xv/p/w8A' +
          '/P8/ABEAEAAlANz/QQD9/0sAAQBDANz/9//f/6b/zv+b/5X/mf+J/4v/uP+b/9L/zv/R/+7//v/t/00Ay/9rAKj/UQCq/1IAwf9mAPT/WgAhAFgANwBeACMATgDq/zMAy/8aAN3/+v8TALj/SgCG/2MApP9bAOL/' +
          'TAD+/0QA7/87AOz/JwAHAAkADAD4/wMAAAAAAA4AAAACABMA/P8XAAgA7f8QAND/GgDd/0EA4v9LAOb/GwAAAAUAIwDq/1EAu/9vAIj/UQBp/wAAkv+3/87/q//8/6n/IwCX/0MAov8uALX/AwCz//v/tP/V/87/' +
          'pf/o/5z/+v+V/yoAdP9TAFn/MgB6/wAAvf/y//X/1P8eAJH/KABs/wUAjP/o/7T/2P+1/8T/2/+q/xEAnP8AAKv//f+u/zEAzP87ACEAGgBvABUAjgAlAIIAEgBaAPr/GQD9//v/8//s/+f/0f8AANr/GQDN/yIA' +
          'vv9OAN7/gAD+/1cAMgAPAFMAAgBSAPn/TQDT/ygAwf/r/9v/s//r/6L/2/+Q/9n/fv/R/6H/tP/P/6//7//N/wMAzf8YALb/GgDU/wYA+P8PAO3/+P/o/67/6/+O/9r/hP+5/4b/pv+Q/6j/pf+v/9D/zf/9/+//' +
          'EwD8/wAA8/8IAOb/CgAKAPD/OQDr/zsA/f8wABgAHwAMAA4ABQALACQA9v8+AM3/QwDj/3UAKwCmADMAnAAcAH0AKQBKACgALQAkABQARAD8/0EA5/8UAMv/KgC2/14Arf8mALz/0//P/+X/4f/+/9r/4P/M/9f/' +
          'vv/q/7f/7//D/wYAqv8oAHX/GQBL//T/Mv/j/1D/2/+W/9T/rv++/9P/pf8YAKP/NQCd/z0Ahv87AIb/LACc/xEAuP/g/+7/yP8cAND/EQDH//L/2f/t/+//7f/5/+r/BADx/xMA+v8zAAsALwD5/xwAuf8BAJv/' +
          '2v+o/6L/wv+a//b/tf82ALz/SQD5/zsAGQBAAB0APgAqACsAJwAsAC0AMgA0ADgAKgAuABgAFADm/xsApv8fAK7//f/H/+r/vP8LAMH/IgAAAA8AKAAQACYADABAAN//PgDL/yUA2P8IAM3/6f+n/73/sP+t/9P/' +
          'pv+//5v/r//C/8P/ov/O/2b/yv9d/8H/hf++/8z/uP/9/7X/JgCf/yUAav/+/13/tf96/3//oP90/7f/ev+//6//7f/W/xUA4v8JAPT/6//t/9f/3f++/+v/kf/u/33/5P+E/+r/iv8CAKf/DADJ/+v/3f/d//n/' +
          'x/8jAMr/VgADAHAAJQBrAEEASwAzACkAHwAsAA8AKQDy//r/AwDK/w0AyP/2/+H/7//Y/wgAz/8JAOz/AQAdAAkAUAD4/2IA5/9fAAQAXAA/AFoAVgBTADwAOgAdAB4A1//1/57/w/+z/7D/pv+f/7b/iP/1/5j/' +
          'EwC9//b/xP/A/7r/5P/T/9r/5P/d/8v/LwDH/2sAwv9OAKb/+P+3/wgA4v/e//D/6P/j/1QA5P+UACQAugBXAHsAPwBXAD0AAwB3AOf/igAyAHMA7v+EAMH/jACZ/0AAnv8bAOP/MwDi//b/+P+1/xoA+v90AEQA' +
          'nwAdAHYAFQBdAHIARgCPAEQAZgDz/44A4/+1AB0AVAAHAAEA9P8pADAAFwC8AKj/swCX/3sA/P+VABsAJQDp/3X/9v9v/y0A3f9gALX/fQB1/zYAvv/l//f/DQAJAAkAPQB//54AMv/jAHD/9QDl/7UAHQAvABkA' +
          't/8XAHD/JwBq/2UAWP+JAEP/QgB6/wMA0v9MAEAAZQB5AO3/WgC//zEACgAoADgAMgBJAML/bgBs/3wAvv9rANH/ZwCm/2gAxf8BAB4Apf/g/8D/i/+U/wcAIf+GAAb/cwBf/yQAd/9YAGn/dADF//3/FQDT/x0A' +
          'tf82AGD/igCA/70ADgDGAEAAugAXAI0AJwB3AHAAfgB5AFEAcgDx/28A8/9nADUAigAGAIkAqP9LAP//+P+RAPf/dgDg/yQAgf9TAKr/fAAvAPv/agCq/zwAlv/f/y7/v/8H/+L/e/+b/8f/aP+c/7D/t//0/xwA' +
          '6v9QAL//NQDY/ywAuP9xAIb/YwDL/xcAIQDi/xIAsf8IALH/FQDh/w0A8P8UAKf/nP+O/1X/yP+//xAAIgANABEA9f8KACoALAApAO3/JAC4/wUAmP+8/9L/l/8eAMn/awC3/wUBLv/7AGH/RQDd//n/tv/7/0L/' +
          '+P8IAG8AmQAk/+r/T/90AG8ABQGH/ZT/Af4a/+X/OgCX/k3/tf5r/j4B6f6dAbv/+P34/x8A7v5KAlQAX/+5Aej/JADcAH7/mwDqAdD/EAIFAK7+jP7v/qr97wC5AbX/xwE4/a8Atf6vAG8Avf7r/bv+zP68AWIB' +
          'qQLo/6v/Yf97/zsC7P4PAir+Ev+Z/hAAFP4BAlEAqACe/93+Zv6//xsBowB2Ab3/mv8Z/2L/Sv/cAGUApwLe/0YBL//O/SUB0v9yAR0Aj//Q/UT/5ACC/x4Cef9rAI4ALQCkAE7/bf/K/k7/wQAQAKgAr/8HAP3+' +
          'nwEBABwBQgFT/lwCqv3dAR0B9P6nAFD/cv8rA+UCpgIbAiX/7v8aAD0A/QG8AKkArQEW/zMA9f7H/vr/GwHkAAQBdwHn/XYAz/8p/uYCiP7//nkADf2T/14B/P30AdIAz/8UAoL/CP6HAU3+eAK5AVX/QwA2/gH/' +
          'Lf4lAir9fQF6/uj9+/+h/84ALACsAJH9y/88AFr/CQPG/gH/MACJ/XMBLwHx/4IAuv8j/mQBxv6oAAsAOv//ARYBHwFgAPz9WP3cANn+OgO2ACAAJAH5ADACbwKxAbD+7gC+/eYABAFfAED/G/8w/c/98AET//IC' +
          'dgEq/13/ZwCZ/zgD+AF6ANn9bP6CALkBPwKBACsAv/wJAggAsf5PAbwB2v/OAVgA5/5b/2z+dQCD/Kv+igDX/QX+JAI/AIUA+QG//LT8SgBU/2EEggJJ/YEDt/v3AF8C9wCOAZQDDP/XAv7+bf9QAiP/SgI3/4MA' +
          'tfxYAPD9XP/N/Jz+vP6R/lYCFALzAUH/LwBx/DD/AABz/yYBLv9GADkCQf4+ADIAl/58A4X+DQIp/a8ANv7SAgj9iwBKAR39pwCS/0gAe/5kAw360/xW+w3/CwEWBIQAcQOz/XUAWv8j/2oAvAIhAdT+SQLt/z4D' +
          '8gCUAfL+fAF6AnwF9v4fBX3/dv+f/1/9iPw2ARD/R/8rAnH7ygNQ/2n/yAGPAOUAeAKC/oL7df2F/1D+uwR+/gn+3ALh/eUCTv2C/MD7LPy6/rsAegAU/6MFXPojA3D/n//w/wj9g/q7+zsAcv5WBMn8jwEAAScA' +
          '/f+kARD+YAKcADb/AP+V/8z/UADt/tz/bQG6AWAG1AC/A2r/hAGF/TMC6/+B/jgDZfwP/1v6uv8p/B8F1AHeBuIBNgHtAUn6uwA7+yYBpfw7/1H8TP1+/AIAev14A2f+GQMyAZ//HgUCBLwAKAAd/pn6NAOQ/CEE' +
          'f/wwAsj/HwHr//oAnwK8/uAFvvynALD+lQA6/HL/UPuI+fb+1vlzATL82QNfAwYEOQRRBVQAjwMhAmcAjABxARUALP9f+7v93f56/7YCwgCA/9T+8QXd+kQAWfze++X8af5t/ML6pwHg/ZEBUQB6/SwCYAABBUkE' +
          'lwLdAFoBOf3S/ngAYvx+/8n9Kf3f/w4BWQJpAb/+WwBJ/7MB0AGLAUL/RAAkAPEAxf+EAgID5gE6BGwDbwLFAiwCLf22/9D/w/7HAzz9FAAc/mf/iAAHAO4B4P7lABL/ZABcAMUB5f8r/xv/Pv4jAvIApwFbAWD+' +
          'vwAK/ncB2wABAQMDZP9u/qz8u/yj/HMA4vxVAYj7xAB+/lgABQN//9EF6/0uBKP+4wH//5L/O/5L/vr9m//m/9z80QDL/Wf+nQAk/Wv/hv/IANr/LPxzAPT8OwDRBb3+NQLT/ZkETPx2BsP9AQBlAUT/fgK4/dT/' +
          'pwCTAHwBtwM2/n8DWPrXAsr5NP8c/qP7rf9LAM0BkwXP/60D5f9PAvz/iwPz/BUFrQAXBPcEMv8HBuX+sAVkAlMD4QOt/oEDef4hAlkC5/58A6f9HQPd/TAB8Pqc/j761/3e+/b6PfwI/+X6mQRR+/wB2/2vBpX8' +
          '2wL2+zv6yQAX+zwCxvpzANr+7wLY/x4DBPwPAY/8zgBJ/pYCOP2xBN3+FALP/0L/7Pw//l/+7v3W/84ApwEuBcADagJ+ASL9mAIc/8QFOQChAqwA3QLwAYEAxAAC/SD/uwEU/YoCgf3JA8b/sAJxArsCDgOcA8cB' +
          'IwAhAR4AOP5W/pb/of8UAwsCrwGY/xgC0PsjAan6t/+S+vgAFPq1/wz8SP+W/Xb8PwAP+78D1/8wBsMBNQS1Af0AKv9OACwAvP2eBd//UwXHBBIByQAW/m79a/9O/xT9HwCq/NYDFv56Ajb7Bv2o/8L8HP8w/nL6' +
          'PwEi/f8BsP5LAOb/TgAdAgv/dgFq/sL9IwAN/aj+tPxj/e77/P4L/23/q/3Z/qz8oP2fAdX8zgTh/cEF8v8QA0n+oQGz/KgDmP7dA2r+IwQPAPwCJQThAkME/gL7AjQCtwPOATkD3v6XAh3+igLW/T8An/2f/wr/' +
          'Tv5sAOf+1AKVBUACwAT/AAMCXwBGBC7+UQKT/igAsf7o/7b9K/8s/hH+5f0p/YH+Jv2w/bv9OP73/Oz/3/uY/mn9lf8v/k3+C/28/FL8Zf7c/EAAEQAZAioE3ACWACAB7vu+AdP9+wAH/48AvQH5/t4A6P5r/tT+' +
          'QwIMAN4BPQHbAED+qwOi/RsC5P9E/7MAoP9PAIsAR/9QADsAAACfAQ8BsgFkAc8BWACHAgMAgQOv/9ABFf7yAHH9MQGC/+IAHAFOA4IBUgNUAcQAKgG6/lsBZf0SAav9IQBF/TP+X/6j/l3/AwDC/9QA1wAFAwz/' +
          'oQKf/jUAv/6KAOn9BwId/ysCgP+RASf/tv0I/+n6lgDP/QACnf4xAEL9hf7E/Q//g/3LALH+UQA1AGL+T/44/ij/0/4FAVAAIAAHAU0AvwBJ/q8B0fu6AaL9cQJ0AIEDywFEAfsCb/8fA/n+PAIz/8QDqQBhBPIB' +
          'qwQMAnQEBgDl/wf/+P6m/2IAjQCa/84ADf9I/yP+pf/g/kIAhf8fAHP/yf8x/zr+//1U/8j80/+Q/E//Jv4tAf7+rAFp/oEA9f4rADsC9AA8AjEAIQFH/6kBJP+E/7r+3/+lANb/XQHR/9H/SQJl/kQCGf0tAiv+' +
          'bwKS/w8BT//T/sL/DPzwADf8+gBUAJv/DgL3/iQDA/42AuP8FP7r/fv6UPwc+Ov7w/nE/4D9mQEiAEEDVwOiAsUEGQJ9AcQD2/55Avr+0gC4/LH+hv6J/4MAWgKSAMwA3QJw/gYC2/30/47/yP4IAPv/If97ADP/' +
          'tf+k/0EBZQE4Av8BfwTqAQUF+wAeAhsAcgBRAOf9K/96/Nj+Fv2Z/Sb/Jv3wAen+nwGm/j4Cyf02AcX8Tfx3/o76EQKr+1AB0fzC/8b9gQA1ANEBkQJdA/8BQwJ2/iv+c/xT++3+6vxoAcj/0AKc/pMCtP4hAlgC' +
          'EwDUA3f86QKE/WcAmP5P//b+OwHJAUsCbQRCAWAEkP54AT39lP4i/rL8s/0G/XH8Mv0o/KD8uP5M//YBdwHAAjcATgI3/3gAGv7R/2X9agCg/ygAmQJYASAFaAKABf4BYQNeAS0BHQAEANX+Kv6W/eX81P3K/0n/' +
          'CAPP/zgEJgETA6EBegGvAXb/AwNu/bsDlP1jAnz9hv9rAD0AYQHGAMr+//0//9/8Jf9n/Y3+vP6W/cj+Gf6f/Xv/AP2S/gf+eABQAaYBDAOSAMYCJgDpAWD9twEr/RsCkf5BAAr/2v+HAoAAbgTQ/nsDKP6aAQ7+' +
          'owBy/dT/Mvzp/QL8s/+G/ksCcv8cAjP/JAFyAEIAGALy/m0Duf0jAz39OgFc/sv/pwAEALsARwErAPH/qf7w/Pn9r/1f//f/sP9DAC4AjgBS/8wAvf6eAD7/7gFaAKECsgEdApUA5AFdAI4BqgG3AcAB6QA5AVT/' +
          'RwHx/sD/Hf/h/gP/8f8v/xEAuf4WAA7+Tf8z/30Axf/9APn/E/+m/xwAq/0UAK79Pf72/nv+jv6s/3T9///p/VH/KP8f/4f//P67/+D+nf/q/uv/gP7PAMf++gDk/fsATv4EANoAev/nABABCADkALH/av+kAJn/' +
          '9wASAFIAPAA+AHwAJwCpATMBSgObAmEDLgKRAZAB0f9tAmoA0AAXAUkAbAAO/4IA4f5NAVcBJQFR/TMAkv6A/8//R/8p/TIA3f5XAPH9ef/Y/6L/YAACAHj/3v/qAAYAigC0ANIBsADTAVMAmALK/l4Cqf39AG3+' +
          '7QJ4/rQA2P2V/ML8jft9/E37Nv48+vL+pvzO+/gCf/pcAzD+4wL1/+oB3v7p/rr/vQF3A6oBeAQiACoDNQCtBLD+mQTo/lUDnP2SA5b6XACb+Cz+vPon/3z9Zf9bAJ0ADQPc/ysCZwA1BGADCAbfArAEYgEhApQB' +
          '/f+BAfUC/v6xBeX9RAH+/Yf+Uv2q/tv8zvp/+0/7D/zZ/Y79jv/i/ZABbv5iAmD+swTU/c8FdP6SBtQAfQTcAsAAcwLC/RQCfvuaAsX5qAOV9rUFdPm1BCj++AHR/kb/AgCn/F4BqfyRBBL8RQiz+w4Igf38BCD/' +
          'NgG2/1H/J/8g/gsANP0NAcL7uv+99/P9ifez/bb7sP8uAOH/OQKX/YABkPzs/yT+6v+/AC0DFwMrBjwH0gVUCRIB0giS/WEIn/t2Ayn6Lv5e+m/9v/tr/d4BIf6nBlT+ygVG/U4Dr/6mAdr/yv83ADj/XwI6AbcC' +
          'CgX/AU4HCQT1A24F9ABjAuf+EP5X/PL7tPvF+vP8Bflg/733TwGs9hAA9fZc/ZX78v29ADX/VQL3/zoEiQDqBl0ARgbH/7cE0f/2BFkAPQUM/7ACJ//1/mgAufyW/LP5XPlJ+JH7YPpm/Kn8cv6z/h0BGwMjAdYG' +
          '4AJzBkwDjAUyAuYEvwITBJYCOQI3AyABBAQGAo4AAwEX/A4ArPpu/4j8lvxG/Fj60fy0+isBAvw5BGT9jgdD/xEILAAkBjEALAL7APP96gEJ/VIC/vvWAIz6uP3j+Mb8s/pU/f7+RfzdAP/6CQLt+98C9v0FAtX/' +
          'ZgFyAT0ASgHl/h4B2/3bAqv8awO2/eABhv/IAE4AmADs/1AAeAG5//wBbf7XAAD+HQLt/30CwADyATP/rgFM/pD/g/7r+wf/GPup/3b8iQCI/p4BDP+SAuH+aAK4/1AA9v6h/gP+Ef/c/SkAMv9GAGsAh/+uAZb+' +
          'MQG//V8AwP7tAEwAlwDr/2b/h/+0/pX/swBP/9kAav4RAen84AGn+0gBDPsmARP8cQEO/k8AYf/X/kYAlf4JAsf9uAOC/3gEpAAUBMb/iwEy/nsB8v2MA1X9mAGi/jj//gGi/+3+y/9b/v8AtwGWAiECEQLnABQC' +
          'rQJaA3ICYAOfAEACgAH4ArkCNAMNBBkDRwNrAiEDev48ACf97gBN/ocAN//W/77/CAVF/yYEOv+YAkoAggC5/wkAy/wKAJX8Dv/v/6f+/QJI/acACfo8/6/38QAA/LUAHv3kAOr88P5f/nr9yv/i/e/+Xv+bAEz/' +
          'EAPh+x4B/PtCAb79zv5F/nUA6v4wAW0BGf5fAlH/dgGa/xEEsf5fBSoB1QLpAtoB1//jAX7/ov8tAY7+JwMe/r0BZ/7uAgkAqQRQ/zUA7P9v/zEBG/8KAQD/WQJx/cICgfvsAIP9IAAE/5EBkf2HAYP+kf4LAb79' +
          'BwBp/5cBUP8kA27/YQEeAVgAZQDhARX/eQCKACUAzf/OAFD9Bf99/Y4A4f6H/xv/QAAf/v//sv6i/Zn/IP7X/iD9WP3G/q/8agFG/tEBUP9mAFn95P+A/AP/1f5u/Zz+Ov30/Qn9tgA+/lIBc/6hAbz+HgSSAEQD' +
          'FwGOAfEBCgL1AjACcwGTAT8AUwBmAAABBv9eAqv91QEK/1MBQgBTATsA/gBKAT0AJgIcAMACjADjA+cAMwQHACkCF/5QASj9QwI7/s8BdwBIAeUAmAF4/2ABl//I/isAGv/Y/9QBGABoAoL/LwIx/5YAy//gAIAA' +
          'cgEVAX/+/AF1/fYDuf+hA5f+1wF5+y4AG/36/3EA0QDAAGL/8gDx/l8C3P8pAH//Rv1K/2H/0f5ZAUv+cwDm/+cAQAAKACAAcv6/AW0AjwEqAKAA9P4/AD3/n//i/uL/lP8sAWP/ewCs/5z/iQCIAa//XwLE/yAA' +
          '8wEs/6gDhACTAmcANgGf/6EBhf4jAr/92wAA/ub+UP8m/pf+yP26+xb+1P1+/wsBsgDHASsCaAH7Ar4BTQEWAu3/yQACAJwAOwAAANoAmQBlAkIBugHX/2D/ewCi/xUCGv/5ARn+NAH//QgBKv/5ADgB2QB6AcsA' +
          '8gKIAG0Dzv+oATX/NwAF/3n+Y/7U/Yb8hv4w/Tn+XQBt/aX/Dv37/fb9Qv+h/8EALgC2AKMB0gBLAcEB5wDkACQCkP9/AUcA5ABWAHP/lv/m/lAApf/k/7n/yP6IAGr/JAEzAIwAsv8kAGoAMgBKAcsAhv/JACn/' +
          'IgB1/0YAff/MAEgA9AH3AG0ARQJIAGwCTwEtAdMAgwDqAFcBZQBCAT4BQADk/wAAGgGQ/ugB4f0N/7H+Zf6T/tr8Av7E/Fz/aPz1ATH9bAHj/owAagAWAcwCuAASAiUB/ADd/10BVf74AZL/PQE5ALb/7//I/fL/' +
          'J/31/339sP/I/UIAkP9EAC8BWv/kAcj/OgG0/zAB+P4JAtr/LwIEAVUC8QCAAYAAZgCjAIAApgB9AMn/FgHQ/6QAk/89/2z+Uf+H/gD/c/5VAJH+9wAbAHEATQDMACsAof8VAhv/KQIb//AA3v5eAVz/oAEPAFwA' +
          'VADL/8T/zQH1/eoB6vwWAPf9k/+d//r+ogAv/hkC/P4aBP//BATB/4UDFADWAkgAywDo/zj+u//0/PAAtfx/AYn8oP8p/hT/jf9m/hgACv3OAU/9PgS8/s4DPQBWA54AngP7ADcBKgEwAO8B2v5wBMv9UgVc/ewD' +
          '8fuzAtX8rAHI/pX/jQFR/SsDDP2PA5z9gAPz/WYCpP/OAYgA4gBp/ysBGAAaAdICpgB4A57/XwFL/cUA3P1CAYn+UACd/gD/Iv9E/fT+F/zV/lH7XABk/DYBlv70/in+yf4n/+v+PAIu/jYDrP99ApQA6AIBALgD' +
          'KwD7Al4ATQJU/zgBOv/8/uP/zv2aAPb9FwHn/cMBWP37Avv89QEL/mEAjP8lAfAARAAaAkv+QgLM/v0Bkv+VALUArf93AeX/ngCJ/6z+L/74/LT89fwy/IH9rvtM/jT8kv/K/YYAd/6f/7P++v6n/8v/owDD/rwA' +
          'ivzIAAH9hwH//e8Bmv7wAEP//v91/h7/J/4A/i/+Ef54/xP/NQAJ/zwAuf3wAOz+RgDMAEv/SwAu/98Asv98AcD+fgFF/iABlf4OAL7/y/8lAV3+vQBc/ccAXf33AOv8MACq/Mv/df0LAWn/zgC3/yUBTwBmAXQB' +
          'lv+NATH/9gGJ/sQBvf65Abr/VgJ6/6UBlv5rABf/AgDd/uH+Kf5L/uv/7/70AJf/gwLj/6MDEQAZAicBigDiADX/CQDG/X4AVv9bAGwB5f+QAPT/IQDP/3T+J/+h/H3+R/1I/vH9ev7z/qb+hAEg/w0EXwA3AxQB' +
          'aAF/APH/9gBb/sEBVP6/AKL9FQAo/TcABP22/0v9eP7y/l3+gwCy/9sBoP/FAFn/PADw/0QBoP88ApX//QLBABMBxAH6/3YBuf8NASL9EQEa/FIAUv1D/1f9Bf/Z/eb/3/80/5sCB/32AsD8+ACO/ZQAN/4WAHX/' +
          'Cf84AOD9PwBA/hoBv/7gASH/YQI2ACMCMP9vAaL+gAGp/sQA4P98/5gBtf4yAQ3/NwG3/+kA/P+l/g0AFP5r/zr/Qv/r/0gAxAA5AQEBRwHKAeYArQGcALgAlgAoAKD/Wf/j/kr/F/8V/zD/XADC/+ABgP8HAVf/' +
          'vgCo/zcBNP++/6X/6P5CAdT/NwKB/3oBJf+dAFX/PgBL/y8A8f+vAKIAfAClAJf/cADu/qYA2f7pAC7/lQBc/38Anf/a/wkAbv+wADH/aQD9/iX/hf9E/0r/YgAqABkB/P8mAXP+vwAz/iQA/P0rAKn9bgAX/x8A' +
          '1QAoAEEAof+kABX/gwCq/zcAvQBQAN8AVP/8/+b/QAAuAPEA4f+rAPr/AwB7AAEAXQBp/+3/S/5fAKT+8v9S/o//xv0IAFb/DP8FAKL+1f5w/xj/D/8dAO//DwBRAHsAz/6TAFb+SP85AB//XQH0/wgArP8x/1f/' +
          'O/61/4v9M//5/Mj9Nf3H/Xv+uP5X/yP/TAAX/20AI/62AJT9nwBz/oj/LwDm/vwAYf7TABD/PAFHAF4BQP++AAj/LABp/yMA8P5R/6H/uP6W/wb/YgBJ/7EAy//s/83/tABxACkAtgCP/7AAx/8uAYsADAE7Ac4A' +
          'ggAQACkBuP/OAdD/7wDu/87/uP9H/7r/TP+T/6X+0P7w/yUATwGfAa8ADwK1ADkDCABkA9P/ogEEAYkBaAHjAUkCNAAwAwMAJgJlABAB3v+eACcAhwABAcz/SQBw/53/iQDxADcAewFmADcBhwGKATQC4gG3AfEA' +
          '2gDO/1YBX/+9AHr+0v83/t3+yf4K/1f/U/96AJ7+DQGp/w8A2f9B/+f/4/4lAKD/YADnAM8BOQBRAoP/RwFqAA4AiwBcAAr/S//N/q79/f+J/tT/Ov+c/yz/XwC8//D/uQBa/zEA2/+y/xUAWAGW/14CwP/2AOMA' +
          'z/9YAR3/LQKr/WkCB/6bAb3+WgHw/nYAnf9qABsBegDTAej+qQBO/vMAAP9yAIf/IQB9/8MBjP8PAkQAkQGc/54A5f4fAA0A0v55ACP9DgBJ/uP/Xf+EAN//6f/CABH+IQH2/fAArv3Z/zj9JgA2/rL/WwC6/pAB' +
          'pP5IAfr9cwHV/vYAKP6g/yH+6/7U/k7/gv5+/24AzP6vASX//gK9/wcDgf6nAaL9nQCQ/r7+2P9w/pEAxP6YAET/gAHI/y4Ce/8ZAk0BCQJyAgoBuAFxAJgCjP+JAS7/HQGl/2oCw/8FAp0BkAGpAu3/NgJY/9cB' +
          'i/4mAWL+zgDLAJn/sACD/wUBUADiAdj/QgExAPcA+v+JAMv/YwAPANP/nf99/67/P//R/2n/KgG6ABICgABCAV0AxgBjAS0BkwLaAW4CVADsACf/iwEZAHYB2v80AJz/jgBYAGYAZAAN/8z/nf0v/9n9HP9g/8j+' +
          '8v9G/68AoQC0AFMAUQDv/4AAtP82/zb/Q//Y/k7/0P73/o7/f//l/3H/ogDO/xIB7P7CACX/dwC3/17/fP99/mIAUv6/AHj+CgEW/8YAqf/A/2YA/v46Aej+1AED/wAC6f4dAcT+8ACi/9MAggDP/5QAqP4QATz+' +
          'YQHJ/wQBrv9ZAOT+KgGS/4UAPABO/00BrP9TAS//kwHH/8oBFwAwAT0AdAHlAJgASQDO/24AMwClATkAsgHL/7cAKP8dAMz/o/8ZANj+zv/L/v7/gv9VAI4AMAHkARIB8QF9AQ0CqgFvAW8AIwDP/zAAG/9fAHH+' +
          '4QAs/hAAbf6v/rv+ZP7Z/vP+lv82ABUAHAERAAYBuAA6ACYBAQDMANwAQACTAHP/Nv+1/uP/cf5r/yz/Iv+R/0YA3v/s/y4Aev/t/97+rQC4//8AYgDe/9AAjv9cAQ8A/gADAIIBVQCTAP0A9f/LACAAf/+q/yL/' +
          'gQC1/0kApP/4/6//2P/r/wf/PgCo/8r/j/7R/y7+cACd/70AqwDjAA4BlQDP/1MALQDU/+X+//9D/iD/OP8o/oj++f7G/+/+fv9o/tP+R/6r/nr+NP0b/4b9f/+v/hv/1gDt/sQCZ//3AZD/3ABd/8v/mP+7/hr/' +
          'CP79/iT/7QAaAQ8BvQDz/zAADQAD/8L/AP/u/mH/Ev/W/zQA2QBoALD/ggDBAAEBYQF+AOIBpf/5AmT/8QB8AJ3/pQCo/nUAaP3QAeD9jwFs/2kBwQCqAfYAZAD0AEX/pwCM/93/awBBAWIAbwFtAJIBZgHSAsoB' +
          'LQFHAcf+UgCI+8P+Rvua/wL+lv++/dv/Lf+y/4UE/v2LA/T/agPI/iIGJP9NAKn+q/wSABj8sQJU/m39UQLnACoESgR5ByECNAX9ABIB6f/c/bX/wPqL/8D8yQNUAfoEpgMLAioDsQCAAUkAIP/u/ar9m/xv/xn8' +
          'qAAL/Z7+CwHS/oEClAFVBHACtgIVAKMBUP3+Ai77FQJs+xQAMP1J+zkANPmGA4T6oQKM/MQDEf7uAxAAXwFFAc78kAFK98f+RfY5+nz4Zv3M/mICfQKGBIEEdgNsBU0APwDv/fX7Bvuo+1v8Yv3uAqED8QcVCsYI' +
          'RwjWBWUA8P8d+r773/fh+3r1nP30+sj9wQHz/kkEMwAECZf8aAeR+cYDovrt/nn8uvxOAPf95AOl/rQEugKCBWkCAgYu/aYFTflSAqX6c/8Y//j/DgL+/pQCMPvfA8n4hwKY/Gn+iwBE/qcBsv6rAskCWgHGBJr/' +
          'uv/fAhv9Dwb1/GgCZP45ALwAGgIOArf/pAEM+zv/d/vQ/yH8cgH+/GMBtACbAUsBbf9jANX7sQBk+T8AZPuw/G3+bftRAg/+wwVuACgC1QNi/vwFlPtAAwz7Av5R/WH9yQE4/80F4P5UAt/+i/3iAGr6SgEq+ZX+' +
          'p/t1+/QAZPgXBgL5SwZr/UAC9ACS/3QBcv0jAjP8MwOQ/gwDyP8iBIL/UwTs/TgDofxjATX9Yv+T/178mgJP+RgDvPkGA9j71wBA/mr9Yf+L/LP/Mv1A/+j9CP+OADgBEANjAu8AvAIw/8QECAAUBsAA3QNKAXkA' +
          'cAJ6/1wElf8/A2P/HwCs/23/2f7N/bf9gPwt/2n+HQFq/3oAOQAs/gIBp/0ZAKP9xQCQ/aMCsP6FA+L9KAJl/p7+SAE9/dwASP3M/pz9of/y/okBowCtALIAMgBJ/ywBgP9MAFsAUv9GAQv+iQHQ+2YDavuMAx/9' +
          'eACt/zX+MQCV+24ASPs8BC79IAZaAbQEjQMkBKwCrQSTAtQD3gHaAVwB/AEbAnAAOQSd/uwCHwD9/tUAi/xRAPn8X//b/nf/wwAgANEB/P+rAFYAnQBcALgARAH5AZMDIgKyAzsABwFu/nX+qfwl/pP9Sv6q/rr8' +
          'kADO+1ACmfwxAur9vQGF/hcADf/2/WkA4fxiAFH9DgDk/VQAyf5//xIA8v60/6L/tv6V/wv/XP1M//T73P85/WgBB/5qAmP+dAGt/9j+3wAa/OQBoPr4AhD7FQTB/HEDTgAHAn0CIQJsAl8BkAGg/5X+Bf8b/Sf/' +
          'Vv5x/gsAbf4IAhgAagKYAMgAOQBQ/woAqv0/APf89gAL/hcBJ/9+AVIAkwFkARIAPAEb/8UAI/+IABz+KACh/dwAb/5VAPn9if8D/o//Vf+m/0YA/wBrAOsAY/8+Adb+eALk/j4BS/96/lIA3f3d/+L+Qf6Y/nf+' +
          '8f5L/8P/g/7w/7/+vP9bAEv/zwAP/10Adf+T/5j/uf4E/8L/Jf9sAdD+LAHy/fsAGP7YAGT/vADAAIQBYAGwAYsBhAFeAegAXAE6AdMBPQJkAgwBwgL2/+UCkQD5Ac0BMgAcApv+AAFU/fUAoP00AXn/FAH9AAAB' +
          'FAJdAMQCSgA5AxYADgP+/6sAJwA2/7P/rP8GAPv/qwDkAT4BpAJqATcBXAHm//UBeP6UAbb+yADv/kwAFf/h/xMBo/+BAmL/8wJuADYDNAHdAqUA1wDlADP+tgEX/RQClP1wAvD+1gLZAHgCvgL0AXUCDgL3AMEB' +
          'dAHSAH8BVgDDAHwAGAIeAFYC5/5dAX3+LAEK/wgBOACOAD8Bw//UAOH/vwCSABgBBQLoAJUCnf/qAcj+iwG9/5wAeP8jAJT/2f8sABgA1P/7AB0AdgBFAHn/fwDQ/lEAI/6//3D+af/p/oX+5/5H/r/+nv6Y/iP+' +
          '3P4F/uz+WP5d/6T+dP8P/8z/9/4qAEH/hP/E/6L/x//4/vv+TP7A/tr9r/8O/Zv/GP6S/wv/3/+F/53/IQAb/27/I/+D/lL/z/07/4j9LQCF/fr/z/0K/wb/qv4+ACj+lwF3/hsBQf41AHn+iwBm/4gAo/8nAXH/' +
          'mQGI/vYBTv41Ad/+uv8fAHX/UwF6/0MBjgAFARsC1QBHArIAEAINAKEBy/+xAEEAsQDC/5UAV//RABn/kwAG/yIAPAC0AIIBqACoARcBaQGYALoBvABWAtwAiQJFAO8CSAEaA9oAJAIcAPYA/f+P/8wA9P4uASz/' +
          'vP8S/3//cv8GAIb/HgB0//IABQAdAycAoQNf/6ECAf/gAQQAHgDx/1L/FP+k/wgA8/+PANEA/f9vAB8Aqv8jAHUAxv/xAJz/lwA2AOv/fwAn/7X/4v4cAPD+nQHd/xMCpQC0AYcATwGZ/6oA5v3Q/yX+A/8k/vn+' +
          'PP4d/7b/yf4W/4f+Yf8L/sX/Y/49AKD/DQFrAJX/ogAf/6wADf9yAGv/7/+m/77/Uf/w/rP/9P0c/z/+7v4B//f+Sv/s/n7/vP+8/wcA8/8vACMAtwCv/wMAt//p/6gAPQEiAaIAHgHN/+UATwGLAMEBNgDtAE0A' +
          'WAETAVgAGgFY/5gAhf/yAC4A0QDiATwAYgILAJwCFwBrAkUAnwEwADAAFwDc/pT/oP5S/1v+bwAN/z0BLgCLAKEAJ/+m/1n+i//g/n8AKf/gAEH/iAEcABoCJQDVAYAA8/+pAQD/0wEc/m4B/vxFAcP9KQFW/+v/' +
          '/wCl/s8AH/9yAF3/JgEfAPAAewGdACsBywBHAVEAAALd/18CfwA/At8A2wEdADMB5P9BAPkATwGvAdYBlAIRASkDRAF4ApUAJQLw/v8BP/7IAYz+UgEl/93/jACo/rcBZP/IAVoAzQHc/88B2v/8AIL/PwBy/pcA' +
          'ef+AAO7/QP9Y/xH+3v/U/cT/9/3l/2D+EwDQ/hT/of81/i0AP/7K/43++/82/oX/jP0X/0r+Tf92/5H+Df8H/nj/0/4KAAsA/v6Z//n9uf6b/Xr/g/3Z/0v+df8QAL//4wCf/70Bgv8lArL/FAE7/0wANP+b/1EA' +
          'yP45ATD+TwAa/xX/agAu/sEAEv5RAWX/fwEYAM4ACAA2AAEAUAB7AHMAWwCUAFn/PgCT/+b/MgC1/1AA9f5aAKD/qv9oAJz+mACk/e0AVf2xAE7+AwAM/9L+ef8x/v//yf1Z/3T+Jv6o/t39GP5k/iH/k//u/uoA' +
          'Df6QAEn+kf5Z/539HwBJ/v3/XP6V/3L+jv+K/yH/4f9x/ab/nf2T/7H+5f7T/g/+HP9c/mv/8f4k/zv/Kf8OAJD/cgBT/7j/5f9N/7z/df8I/4//tP82AHIAtwDKAKkAEADJAGb+8QAh/+YATwEOAYIBgQFLAV4B' +
          'SQCXANj/i//M/zL/6P+N/58BBABaAWYAtgBYAFoAEwH9/8MB7P8/Aef/dABnABcAj//0/1r/Pv/B/93+XACU/78A3v8yAJn/DwDN/9T/gP/h/w//VP9R/wQA0f85AcH/lADf/0UA6QAt/zcAFf/T/ur/hv7u/x7+' +
          '///o/VX+W/77/a3/A/9UADn/sv+//5v/EADl/5oAEwDT/6EAjP/kAHEA6QCu/+8AV/+HAM3+KgBM/sv/4v6V/5P/jv/u/x3/h/+x/icAJv+L/38AOv5TAf3+cAHJ/6UBJwFiASwC1gDEAZkAAwF5ALEAWQBMAFsA' +
          'CQCIAGgAlQA8AMAAzwC2AEsAdQDu/yQALQBUAI7+agEA/44B8f8LAUcAfwCAAIL/s/+//nH/4P5t/8D/NABaAFoAqABN/6wAkf4RADH+9f6q/oj+4f+2/koA8f7w/5b/nwD7/wABGAAmADsAM/+PAHf+vgCO/g4B' +
          '+v7tAIn/KQAVASMAqAEzAEsBewCYAfYAEQHwAGcAJgCj/w3/Uv83/+z/DQDP/0oAcABwAM4AvwCx/28Ar/6+/0T+kP8//un/Zv4YAF//cQBiANgA2f8iAL7/ZP9vAHX/JAC4/+UA6f9hAUUARABEAVv/mgGO/u4A' +
          'kf6AABH/sf8gANb+nwDC/rn/k/55/vv95P3V/fj+H//2/4QAjwBKALsA2v/qAAUAXwAzAEv/eQDP/0oApv84AO7/UQD0AML/MAEk/5kBt/40AUT/yP8QAJL+dQBv/rUAav6RAJr+QwHQ/4cBsQDAAK8AjwDVAMAA' +
          'KQDRAGD/SQCi/+j/O/8NAA3/gv8j/6v+OQDZ/R0Bi/0EAXL+AAFx/zz/wP+l/vr/Nv+9ACEAzQBtAZAAJQGdAGIAEADS/rH/T/5R//L+t/61/ij+Pf8H/qb/O/4+/3j+iP/t/kH/Zv8+/xYAx/+bAHb/+gC3/xwB' +
          'T/85AeX+FgEoAHUAUQGQAI4B7QAAAZMAlf84ALT+UwBV/woADwCf/50AkP+TAdX/QAJ///oAGf9EAK3/OADx/zn/IQDP/+P/EQDG/7b/lv9y/wP/gP7F/3z+z//8/kD//P5X/1r/KP/Z/8T+u/+B/rj/Iv9fAKL/' +
          'WAFB/1kA8v6T/lz/Of4AAAX+kf8H/nv/M/+0/2EANP/WAIX/BQEiABIAlACO/8YAFf+0ABz/fgBOAJb/ewG5/yQCwQA5AbAAVwGIAEUAkADP/t//aP6m/8D9yP/l/qL/bP/z/4MApwAxAdAAAgEYAN0A6v/k/zkA' +
          'sv/v/1X/r/8FABEAYQBZABkAlABlAMMA9/+iAJr/ZAGY/yYCkP+LAXL/UwC8/0YAYgBuAKMB5/99AU4AtQCCAJ8AcgCz/wAB8/+IAe0AwABQAYkAXQEvAvQAHAJyABkBQAFFAbABfQHTAJEALQE9AIsBCAErAbYA' +
          'JQFqAF4B5QCgAGwB/gBwAWkBPQEUARgB2wHzAMUBRAFTAp8BIQIhAk8B4QH7AA4BTgDYALv/sgA3/wsAOv+3/5n+DgCE/x8AjQC0AB8BkwDRAYn/eACy/3T/cAAY/6AAxP51AEf/3QDVADYABAEO/3cAIP/VAEX/' +
          '7/9u/wP/y/90/zYA+/9ZACQAwQD5/yEBMAAFAYQAQAHu/6sBq/9wAav/nwD///3/4/85/0X/P/+E/5P/RwCq/7cBPgBJAToAUgDy/wMAff/Q/rL+Lf+A/sj/If+VAET/XwJg/6UB1v9nAFT/8//p/hb/4f5H/wX/' +
          'oP/8/h0Au/4NALr+qf9x/rP/Qf5D/+v+Mf4w//r9nv68/sH/Df6oAGr+0P+o/mT/cf6d/+n+KQAj/zYA0/84AB7/k/8c/4H+lf+5/k//Lf+8/53+PgAy/iUAh/8TAMMAPgBDAS4AWwH//6sAVv9xAJr/VwBnAMv/' +
          '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' +
          'Wv+H/nf/+f6j/1r/rP+D/wb/BQDk/rMAgf+TAN7/JwA8AFYAdQDUAHQAEAEKAbsB5wEuAkkBlgFjAMgAmQBsAL0AKwBVAKv/jwASAFEB8QB+AbYA+ACNAMgAVAGcAXUBVQIOAaICwwGmAhcCnALcAJgCNQAgAjQA' +
          'QwG0/80Ayf+MAFAAp//t/2X/Z/9WAPX/VwDBAAz/MgHj/nsBMv96ARf/WwEKAG4BNwFxAaAAngCJ/9//sv9XAIz/SQAU/zH/Bv/8/h3/OP+R/vb++/37/nb+Xv/n/lL/hP7R/ir+6/4h/1H/fP+L/3L/egCoALoB' +
          'cQBlAa7+OgDC/hUApP/J/zz/PP9a/7n/9f86ACIAaf8t/27+1P5m/m0Alv4BAdP+zQDJ/xYBEQEKAU8BUQA5ASgA1QEWAfwBCQFWASoAPAGxAJcB+gAnAUkAWwADAfH/4wGm/zoB+/5NAIf+VQCO/qEAGv4YALL9' +
          'mv8Y/u7/DP/z/yIAlv/HAEMA/AAtAakAmADU/5X/G/+g/xr/5v+f/8v/iP8zABb/rADa/r7/a/7z/lH+9/6h/j/+p/4p/ab+Kf3B/nT+xf5F/+z+lf8s/wEA4v/q/2IACP81AEb+HACI/s3/p/5//7v+B/+3/6X+' +
          'hgDY/hsADP+P//3+uv/Y/q3/3v7k/ob+d/6l/qX+gf/k/v7/2/5FAOX+agAQ//P/Lf4e/7z9Cv8H/jf/ef4w/6b+lf8A/xYAXABUAMYAggA9AZIAigENAEMBy/9XARcAyQHi/ycCmv9dAR8A/QCZAB8BUgCeAEEA' +
          'uP+hAEn/zwCp/uwALf78AHv+0gBh/n0Ab/5FAHP+ZgCk/kAASv+F/7z/Av+r//n+l/8E//j/Iv/B/2n/9/6o/6T+q//k/o7/7/6S/7D+bf+2/h3/J/8K/43//v5kALf+HQHn/sQAov+rAA8A2ABcAOsAhADwABYA' +
          'hQAf/7P/df5m/xH/if/1/yL/SwDn/o8AUv/KALv/3gAAAN8AqwDPAEcBUwFKASgCtwFzAqICuQI/An4CNQGbAUEByQFpAccC/gCCAucAiQGHAX0BEwKjASUCPAE6Aq0AaQKSAMQBxABWARIBAgLLAfYBtwFMAcIA' +
          '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' +
          'ewCyAqYAjgLqAOEBYgEyAeYBEQFAAiQBZwLUAHcCpwBgAv8AFAI0AbIBJgFaAUsBEwGlAaYAbwFyABgBugBAATIBTAGPAQ8B9AFFAUMCGAIWAjgCFgKaATYCOQHzAUIBjAFNARUBKgEIAeIAhgErAOcB1f/XAS4A' +
          'LAFPAHYACQA6APH/2/91AKn/xQDS/3kA2v9sABIA6QCgAD0BLAHxAOQAgAA9ADsA1//y/z3/5P/d/tf//v4q/y3/n/4x/9D+Kv/5/v/+nv76/kz+nf9o/tD/ev4o/4L+p/7k/jr+YP8z/sz/4v4hACX/IQD9/sj/' +
          'B/99/03/4v+m/zsAyP/N/9T/e////3D/FwBi/wAACf9jAKb+1gC3/rcA2f6zAPb+xwBc/9UA7v/MABMA2AD+//8AIgDeACoAogD1/0YAKQD4/7kA7P+zAFMApADTACMBHwFiAaQBBAHfAfMA3gFBAQ0CBAHjAbwA' +
          'hwHqAKUB1wC5AWgAZQEyAO8A+f+2AM//5gAWAOcAXwARAWQAPAFVAOgAgABOAKcAqv90AKb/QgBQAFAAFgF4AFsBdgBUAR8AIwHM/xIBx/9IAdH/WwGk/1kBkf/tALH/XADo/xsARgAsAJ4AEADhALf/LQEoAJwB' +
          '9gClAe0AEwGLAHIAWQCVAAAA/gCO/6IAZP94AKL/iwB+/4MA5f5vAJD+PAD3/ooAv/+8AIQAlQBIAfAANQHpAMcABgCpAJv/aQBo////t/6N/4H+Pf9s/xgAQgDAAbcA/wFxAVEBPgKcAMIC0v8MA6r/YwP4/8oC' +
          'OAB1AUUAmwC4/4MAH/9KAFH/vP/x/5T/8wBT//UBV/+EApD/kwJuADYCeAHwAegBhAFVArQA4AHZ/8cATv+w/4b/B/+u/7P+b/9x/mD/YP7Y/nv+uf6R/v3+iv48/6r+U/+Y/qn+qf7I/lD/RP8tAGj//f+R//b+' +
          'RQBY/toAN/6AAEz+2v9o/ib/WP6O/g/+C/4B/gL+eP2R/fT8Mf0+/WD9Kv75/Wf+4P6C/R//WP1f/w/+yv+W/jsA1f7p/z7/V/8m//v+4P4v/3/+s/8y/lj/Xv6O/of+xf18/sD9x/4C/Zv/x/x6/2f9Sf9u/jP/' +
          '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' +
          'vPxn/hD+j/5J/7T+l/+P/sAA2/2rAEL+BwDM/uf/v/6WAFH+yACM/uAA7/4HAXX+3ABf/yMAnP/Z/7n+UwBv/k8Atf+6APMA4v+u/woAb//Z/8IAbf85Acn/8AAh/4IB3f/zAX3/XAKT/xoDUgC2AhoB2QK3AfEC' +
          '/QGyArICvAFxAZsAiwJWAbYCRAL8AFACUQKGAa4B0gFBAY4CbwLNADYCXv83Ap7/+wKy/2kEXgCXA8sBywJQAikD9wFhAu4CywGYAxcBcwL8AJ8CsgBvAyQB9ALEAHQCUADVAWoA8gCbAH8ABwLh/9sAUP+3AWv/' +
          'NAJwAGIBfwBIAjMA0QEhAaABugH9AAADdQDNAm7/CgJ6/yYCFwDiAcv/KQI9/64Ac//D/yQB0v8wAHv/Fv9C/2T/1/7r/8r/Of++ADL/IQFXALUAwP++//j/y/8JAKf/AwAi/gv/R/0x/p39cf6C/Q/+Wf3e/nn9' +
          'ff4N/jH+H/47/mj+sP1T/1P+Yf8B/nL/t/5e//7+7/7W/dL+8v23/vH9nv6c/Xv+jP1S/sj9Cv9r/AAA1vzP/yD+jP8C/mwA+f4dATr+OQBD/nb/df+D/7L/Kv9V/4L/XgC3//wB3/5oArz/9AL5AQEDiQPJA/AD' +
          'DQJGBNQAYAV3AX0F5gABBXkBCARYAnMCCAPJAagCgQEcAzkAowM//74DWwB8BOcAsQTbAGAE7AFPA4wCuwLaAkQDkwM7A1oEhgImBI4DhANLAy0DFgOwAsQEPgLIBJsBwAPbAOoCQAC1AUMAr/8xAF/+cP+z/bP+' +
          'Bf4g/rf9Jv6L/XH+0P5B/7b/ZP88AFP+mv8I/sr+FP0c/nz88Pxl/b37Cv6S+xL/zfsrAGH92AAd/toA4P1dAI/9LQCY/Sn/Bf+x/X/8zPwy/Rz7JP+4+nP9pfyi/HH8Tf4o/CX/hv3O+u78F/1u/Az/Xf4f/Zv/' +
          'M/5g/xv9RwBA/FEAev2a/lsA4P2q/mv9Qv7z+o4AY/oc/Vr9y/vd/KH91vyO/ZoASvyLAFz+3/6qALQAo/91AcwAuP+IAQEAeAGnAAECiP/mALb+rf8//yH/Mv+N/6z+1/2M/on9K/4EAK7+UwGf/usA6P7x/sf+' +
          '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' +
          'JgCAAHf/IwCo/hn/Sf4a/8D+QwDg/6oAhQDi/xkB8P65AVT/qwBS/0f/0v5x/1H/8P/e/xAApwCuAKIBpwE3AUoCFQBGAjUA9AEmAJsBnP9FAO3/M//N/xz/CP+9/vX/Wv/OABgAd/5NAA/9kQHL/rIAcP9w/gv/' +
          'Yf4kASj+XALx/VgA/v5IAOj/jwGpACcA1QCl/gUBxP/4AWYAhAHg/q0A0P1rADr9BQA4/CgAYPy//+39X/45/nv+CP60AL3/hAB7AEP/q/9UAK//WwENAHYA/wDp/58BaAEHAVsB7wDlAC0BgABuAUEAOwEPAM//' +
          'c/+4/hMAB/8MAJP/gABD/zAAlf8WAQcBJwImAmIBjwJTAjsCeAIZAnkCUwKLAT8CQgBOAqH/BgKt/4kBlwCPAbMALgF6AcgATgFUALQAT/+V/5z/RP9fAN4A8P9fAR8A3AGrAXUCjwJLAhECcQEgAmYBmwLTAW4C' +
          'EgEPAhIBmAGWAQcB7gCfAGEBHwHJAUkBpQCeAJ8AcQFfARQCFgJKAZoBTAFtAa4BWQJAASoC3QAfAewBNgC7AmcAJAK/AEMCFwHjAjoBYwIuAUQBBQEFAesA/ADFAHoA4v/8/xcAuP+XAAEAEgH1/4gB+/9yAXkA' +
          'bgG1AAUBhwCVAG8A3/9AARz/gwH9/gkBT/+/ALj/WABtAKH/hgHT/moCnv5lApP+VQG7/hAADv9v/+f+Xv+2/iH/+P4E/wr/Uf/n/kz/5P6P/rr+oP7w/sL+Kf8A/qD/kP7n/9L+1v+0/v//+f/r/6z/tABO/sUA' +
          'Zv5RAML+NAFb/2IBJwBCALIAgf9zAMb/0/+B/2sAof7JAAL/sgADAAUBawBhAS4BsgC9Af7/wgEOAJwBlP9dAZb/aQGV/80AMADuAJ0ATQGZANYA5AGhADECYAAMAtj/EQKI/6UB7/9SAcb/XwHj/yQBVgBsAEEA' +
          'wgA/AMYAcQB4ANsAmwAVAaAAtwHaANUBvABBAfsAWgCWAe7/oQGr/6MAiP5m/5H+7v5W/4v+d/9J/u7+gv5p/qj/Bf4YADL+tf+B/ub/2P7S/93/RP/y/7f++/9x/9X/sv9v/9f+K/9P/sX+FP64/uf9h/76/I3+' +
          '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' +
          'Jv/7AD7/VwAp/5z/Uv9R/5z/Q/9I/4H/ov5v/+/+rv7r/tr9SP7A/ej+oP7S/4f/av9VAAj/xQA6/3MACP/b/0r/P/9k/3H/cf+2/9z/Vf+t/xj/SP/K/jf/OP4I//39N/5Q/gP+qP6w/i7/v/+p/58A1P/XANP/' +
          'kADf/xMAkgBeABEBPgE3AaABsAHZAQAChgLOAakCiAGoAjcBggKPAEQBcgAwAKEA2/9kAGT/ZwDc/nkAFf9+ANr/BAHEACEB4QCaAKAA4QDPAKMBzAD3AfgA+gEgARsCuwAmAiwAbgGm/7YAXf8iAGEAa/+AAS//' +
          'HgG0/msATf3M/3D8OP/M/En/P/2s/4f9MQDI/WIACv4ZAFj+FgAW/+b/VwArAOUALwDyAN7/NQF/AFQB2wDaADoBTwCvAWUAFQImACkCtf/3Aen/oQFqABMB+QAMAZYBvwAIAiYA/wHG/8EB4f+NAX4AcwHuAZsB' +
          'fQPMARcEjAEHBDoBhQNGAf8CMQFDAj8BWwFwAZsABwG7AEQAuQAoAG0ASwDjAMj/CQHd//UArgC+AAIBvgDZAOAABwGDAEwBEwDzAND/GQFE/0gB3P6TAB7/CQBm/ycAbQAYACoBcf//AIr/OAEgAAMBZgBdAKkA' +
          'fAC7AO4A5wBQARYBhAEgAUsB9wCgAKQAg/9xADT/KgA5//7/O/8gAJL/nQCo/0IBGQCJAQ0BbwEZAmsBagLcAUYCVwLoAWUC/wBMAikA3wHs/w0Brv/aACT/CQEs/7YAZf9WAJH/MgDm/14ArwCAAAUBAADUAHH/' +
          'eAE0/8EBFP8SAeb+awCT/iEAvv6L/z3/0f4E/4H+Yf5s/uz9WP7C/dP9u/0z/bv98/zT/T/9y/1m/t39ZP+v/Tj/d/3X/ur9PP5u/iT+yv7q/s/+CP8W///+9//m/qEAv/7dAJX+jQBn/lsAIP4FALX9MP+g/rf+' +
          '1f+L/t3/qv5y/7H+hP9u/mD/Yv6n/nf+5v7F/sz+zf5e/mT+Rv+//rv/1P+E/6kAsf81AT0ApgF1AMgBSACuAYIA4wF7ALQBSwCuAMz/5P/Z/h//cv5s/qD+lv4A/xj/Xf9l/7//VP97/0z/w/6H/5z+l//+/pL/' +
          'a/+Q/7//i//8/1f/1P/L/q3/iv65/8j+tP8a/yb/Of8x/jT/zv2O/wb+o/+X/lP/Wf86/9D/wv60/5b+6P/M/lYAfP7J/3j+Zv9G/2//+/8L//X/Tv/A/5X/kv+8/rT/9f2R/wH+3/52/gT/6v7U/9X/RQAZAdb/' +
          'hgEIAPsAzAANAGEASP/o/0n/ov/x/+X+if88/pr9iv6f/Ef+Yv3J/PL+fvyUAI/8BgHd+y8ArPuZ/sn8fv0H/kT9IP4d/cD+Wf2V//D8YP9H/Kr/Of0VAPX98f7W/L39XPxE/nP9Q/9P/QUAEf3tAPn+DwGnACcA' +
          'FAC+//b+y/9t/5X/wf/6/2//HQDbADwAswFlAYL/rAH//csAOf8PAA0BEP+bAV39IgG6/QgB2wBYAFACIwCTAf4B3gFWAzQDkgJ2A4wANQPC/zMDbQDBAaABGQBiAsn/swGb/xgBh//7ADgAYQIXAfIC1ACCAZj/' +
          'RwFp/4UA4wDg/7EBZwANAbsATgDkALr/iACb/44Aj/9HAGv/jP8d/0b/Yf4b/1H+T/8D/xD/Sv9f/vP+1P2A/3v9YQCg/QMAZv2K/z79VP8T/nP+uP6e/ez9+P1G/WH+2f2K/gX+//7s/Q7/3P2g/nT9Hv57/OD9' +
          'xvu//Xb88/1I/nr+jQCp/tMBIf82AjoAIwLsALsB0wDoAEUAPAAIAJUALQD//xgAcv9MABQAkQCY/w8Bf/6OAWn+qgBX/2v/BgFJ/lsCy/2gAnT+LwLm/tEBz//5ASQCKAKEBP0BhgTBANgCsf+wAQoAbgD3ALn/' +
          'ewH2/1MBegAoAWMBCADhAfv+IgJT/30Blf8uADkAzP9tAd//lAEZAKUACwDe/9T/0//Y/3r/FQDc/tcAff8FAYf/MgBs/qz/6P7s/4cARAAAAVkAywA/AH0AtP+j/9P+Bf8g/kX+Gv1f/hn8o/9G/G//0vz2/Zz8' +
          'l/1q/Dr+rf1b/oP/i/52AOr+vwCC/2IAJgC//xwANf9a/9T+d/7O/hD+vf4W/dT+JP18/q3+Bv3d/j38+/3C/FL9jv1G/U7+Qf7N/tP/lf8KAeUA1QE7Ag8C/gKiAR4DfgGPA6EBXwNAAUACxwC4AU4AaQFQAN8A' +
          'GgF1AF8BSgAkAZ//3QDS/pkAIf8kANz/8v9sAG0A0gB7AUQBOAJRAYQBCgFQAYsBoQFSAowB1QLpATUDwgFXA40ADAO4/84CLAD6AusAsgJoASMCkQGwAZIB6gC0Ac3/ggH//tsBiv//ApsA+QMyAQIEXwGnAv4A' +
          '5wFIAWMCEQJzAicC4AFUAhUBsgIwAWYCegEFApUBBgIsAtkBpwHpAe0ADAIiAfQB8QEmAmsCoQK/AUsD0gEQBBECygTFAaUEBQKLAzECpAIhAngCqgIqAssDlwEVBI4BcwNXAbcCAQESAvkA6gB/AA8AfP+hAOL+' +
          'XwBO/4P/ZP9//93+tf8E/8b/Ev8cALP+uwCq/qIAnv6SAGH+0ABK/iQBg/4HAZP+2P+i/gD/Ef+9/h7/0P7a/iX/jv6m/0f+dAB7/i4BH/+GAan/LAHT/18AwAAaAFkC/AAcAwQCZwN/Ac0DdQDiA0YAYgPz/xkD' +
          'YQB4A8YBoQMTArADmQFHBGsBTgQVAh8DagOSAlwECANFBCcDMwOJAroBxwEwASEBIgJkAPUCCAD7AgEAkgIYAKEB6P9GAbH/rQHa/2sBvv8XAXn/oQBC/5D/gP/u/or/of4W/7j+df+b/qv/AP5C/8v9Lv9O/tr+' +
          'C/9V/iD/Qv5F/5/+2v7R/hX+c/6m/gT+Zv/L/TD/2v34/Ur9vvya/OX8Af0//pr9cP87/sb/7/74/mf/xP2Y/5/99P8C/oIAq/1gAFj82P/O+4n/e/xI/wb93f6e/Zz+hf5s/ij/Jf6n/6n+igBu/wQBkv8FAbr/' +
          '6wB7/1ABD/8QAg//HAK5/tcBQ/63AQr++gFr/jwCxf91AjcB6AFdAaIA1wAKAOoAj//DAP7+FQAK/wUAz/81AG4AWADgAE4B1AAdAi8AYwICAFcC6v/fATj/NgHP/jwAl/8EAJ8ASQDrAWwAtAJ7AL0CbwA8AsEA' +
          'VQADAQj/+gCF/sIARv4HAJT+GP/Y/hL/Rv8Z//j/Yf4wAGX+Yv/f/oD+fv4a/gL+Hv4R/on9rv3b/KT8TP0Q/P79wPzr/sz9B/+A/hH+a/+R/dH/Ef0z/4r8zP48/bX+FP4m/lf+sf1C/1n9AAD0/A4A+PyZ/8b9' +
          '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' +
          'zQABATYBOQEoARoBLwEjAKYAa/8kAMf+dwBE/igA8v5CANP/uP+Y/3n/jP/Q/0wAe//n/8EAKP8oAYj/TQDS/4//AgA2/7z/Ef/p/sH+Uv5C/jT+l/yf/vP7kv7q+x//dPzw/2T9y//a/TgAZf7vALz94QAl/fgA' +
          'rf1mAVf/kACJAMz/xQAoAKEAgQC3/0QAMP90/8X+//4c/1X+0v+h/S8AVv0IAaj99wD3/ef/CP4s/03/I/80AKj/VgDj/6wA6/8EAUkAZAESACsBPv9rAfj+SQJc/5IBw/9mACAAmP82AEL+RABv/TwBUv3XAeL9' +
          'gwGf/jwBzP/yAGoBlQD2AcsAvQG3AXMBfwJfAfsCnQBVAqr/jgCQ/8L/nv+8/yEAif/HAM3/wwApAHkAzv+oAM3/PgGyAFIBbgELAckBHwGfAdIA9AAWADQAZf87/8n+Dv/I/ln/0v6C/9P+1v+1/kn/I/62/kP+' +
          'lP5K/zX/TQBtAM4AmQA8AHgAQP9lAOv+DwC4/rb/m/6t/z//F/81AJj+UgA3/yoA/P8DAMsAZ/9CAO3+rP9S//3/YgCq/70An/+XAVUAwQLJAG4Cxf8LAlr/HQLH/2sB6f80AK0APwDwAHkAHwG7/28Bs/+xAQoA' +
          'bAKt/28Ch/97AdH/SwDM/ysA1f/jABwAEgFtAK8AewDX/5MAVv/PAEr/swDj//MA9QC9AX8BMgInAh8CHgJiAqwBXgIQAaYBu/8tAXL/wADv/z4Awv+T/3X/L/8SAHX/LQDE/9X/OgALAKoAFACCAFQAfQAzAOMA' +
          'mf8tAVD/HQE7/+YAgP+4ADsAVQDTAPb/MQFY/9AAHv+N/0//XP8b/8H/Wv+m/93/MwCfANcALwHIAIYB4QD3AZAA2AGVANsBDwGhAd4AzgCqAQ4A4ALK/9QClv83AjD/VQJu//oBCQBsAUsApgE2AA0BfgATAAEB' +
          '6P7GAGH+NADU/jUA6f6mAKH+tADJ/i8AKf8dAAoAoADUAPAAEwADAQEA0AAt/zoAXf59/+b+df9w/or/sP4x/8b+G//T/gT/Cv8S/2X+FP8J/ln/H/7h/6X+8v+A/jr/kv6l/uX+nv8n/gAAdP7h/0z/iACp/3oA' +
          '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' +
          'zwLLAaACsQEqAjoCoAHAAjYC6QIBBOcClQXNArcFsAIiBYQCnAS5ASYEGwFZA40BkAIfAvYAiwGj/2QAIv/a/37/n/+5AI//GwGg/3gBrv+MAef/kgFCAKMBYAByAYoAawE5AecAqgEMAcQB2gGTARsCPwFDAtwA' +
          'KAI+AE4BTAB+AK0A//+/AJ3/qgBk/4oAiP8CAHv/NP9+/2b/mAATAIMBigAUASABHwDAAZP/agLX/gYDRf7jAi/+6gGJ/lABwv9PAfwAWgGhAagBdQECAuQAFwIwAKACHwA6A44A9QJVALwCIgADA7gA8QJPAlIC' +
          'ogM3Ah4EkALmA10CvAISAvcBlQHIAZcAjwFhAM4BUgGkATQBBwFL//IA3v1WABf9Iv8h/Gz+GvxX/r38gf7T/Gj/OP3TACT+hAF2/nwB9v72AKz/RgCE/yP/Of8q/kH/+v1U/8H9Y//S/bT/Dv4XAA3+CQBZ/ef/' +
          'o/xD/xf9C/5y/YT9fP6s/dP/l/3Q/2/95//m/d7/gP46//H+c/4j/wj+Yv69/WD9mf0a/Wj+d/1E/xH+zv/V/nX/af94/gz/kv2I/gD9lf4j/Tv+s/3S/Sf+Ov6z/S7+av2L/fP97v1I/wD/rACU/xQBlP//ABUA' +
          'yABlAYMBVgKvAfYC5QBNA70AEQPq/74CSf9kApL/DAILAIcBqAD+AKgAbQCuAGn/KgHd/o4BAf9cAQ//1AAJ/5YAYv8cAEsA8f9ZAUwA5AHvANYBvQHvARUCGQLOAaIB0wAPAZkA1gBqANcAnf/uAGX/ywBJ/04A' +
          'u//x/x0Avf+HAGj/WgGF/4kBGAAjAW8AmADCALMArgEnAUEC8QC3ARAAuAHQ//cBYQCUAAwBQv8MAUf/uABA/7UAMv9Q/0f/Y/4g/+/+3v7a/pH+d/6U/jL+1f7H/nP/WADx/6UBkP+UAsz+IwOr/iYC6f90AL0A' +
          'm/6t/8D8Zv7Q/K7+r/w4/x77kf4W+zr+nPsN/oH7vPwJ/G77S/yR+5/8PPyM/CH9I/yO/ib+y/7/AHn+ygF7/qMAG/5j/9n9YP77/Sb9mP5k/P3/hfwFAij9UgKQ/jgAHgEt/kIC3vzaAXT8pgEV/sUAQwEJAAMD' +
          'cwHaAhoDQgJLA1sBVAM8AUwCLQIkAdkCjwGzAUYBHQBvAKAA4v/rAc3+MQJQ/0ABswBfAMIAe//iAPj9dwCg/ZL/Iv++/1IAGQAhACUAfwC5AIkA6wAkAJQAuABlAEcAEABL/9D/7P7D/lz+e/4U/ob/M/+F/08A' +
          '2/9g/0MBlv6wAWz/eAFm/1gBx/4/AAIAQf+yADz/Qv8F/5j+mP6z/ij+uP6v/ZoA7f3AA+39mARQ/b0DsP0mBJr+vASz/9EDUQE9AooCZwFgAoMBWQGtATYAbQF+/wIBZf85AHr/rf7b/1/9Vf9y/C3+P/tJ/X37' +
          'H/yr/QT86P7M/Rf+9/+C/VEBUP5FAXn/KwBU/5//m/6M//7/0/6dAfL9sAD6/W3+Xv4D/BX/xvmV/xn5Xf+R+rr/fPwZ/2v+Kv61AEP+CAJh/v4Be/8nAucA5wLEAREDLwLNAjMBzgK5/+YCr/+cAtf/BwJl/wEC' +
          'z//5AcMABgHrAHEAVwA/AVYAGwKjAGECdQC5AhMBQAJiAgcB3AJTALADkv/iBJD+OAQs/qgCav4RArv+qwIb/48DCADcAwMB/APlABEDef+BAev9awGV/XUBVv5bAJr/mf99ABD/VQAW/isATP4YAMv+1v+F/uv/' +
          'U/5aAAr+jwDo/koAGQC0AGMAtQETAPkBqf/hAdj/vgF3/yMB9P5LAUb/cgJgAKICcAGRAdwBpQAvApgA4wFjAN8AAgDy/2sAHwC5AHgAgAC0/+gAPgA2AqkB4AK6AQoCjAEaAUgBzgBoAUgAJwIVAA4CsgBGAMcB' +
          'Zv69Arj9cwI7/W4BOf43AH3/FP+p/9P+GACB/lgAkv1/AMv9pQAe/1UByv8nAvf/QQJWAP4C3gA8BBcBSAQQAbQDDwGtAzgByQLSAZ4AtAIu/woDjf8hApIA1QDrAMT/5AAO/8oAsv6lAF3+nQC7/msA4/8lAIAA' +
          'hP99APb+xQDQ/oAAVf6O/9H9JP8l/Uj/kP2B/+j+lv95/z3/oP+F/vj+If5o/hv+S/7T/X39vfzm/Mj7Bv3F+wP9uftC/dr7b/2L/FT9E/3Y/Xf9mP6m/aX/vP3r/2f+lP/e/qb/ef45//X9GP/x/e/+xP5M/ub/' +
          'PP5fAPD+9/9J/4j/o/6z/3L+LABw/uoAc/63AUn/5QHl/4MBLQC0AYAAnQLJAEgDFQHcAwQCDAQCA/cC4QJxAUQCcABoAQsAeQFXAB8DMQHiBMIBgwXNAd0EEQKJA4UCIQJ/AqoBnwGoAbAArAHdAL0BIQFyAVsA' +
          '3QDq/4wAVQCQAEUAXwDe/8IAHQCdASMAFQKN/4kBUP/gANL+ywCw/UUAzfy7/9P8I/8V/af+v/yv/YH8qfwt/cb8Lv4j/J3+AftA/6j66P/z+vL/Q/un/7r7O/+7/I7+dP19/fj94f2j/RH/kvxw/yz8RQBP/JwB' +
          'uPweAl39XwEy/oQAa/92AIIAEAGrAK0BAgH4AcwBMwI3AgYC+wJsAZ8DlwE4A2UCWQJ4AmMBYwLZALMCgAF6AokC8AH0A+oBlwWsAXYFXAEyBKABQwMZAnsCswLEAcYCmAFKAjwB7wEjAUkCwAHUAugBAgMdA8kD' +
          'YwQ3BGgEGgPpA5kC5gIBBDwDZAQ/BJ8CVATQALAEIP+cBIb9NQL0/L//afzl/nb7Tv9Q/GQATf57/6n+DP6g/rP9TwB+/Q0COv08AQP8+f7x+vn9xvtu/vr9uP8p/1EAXv9Q/yT+G/4k+wL9FfoF/Hf7iPsx/V38' +
          'wf7t/cMAE/8pAcwAF//2AQH+SQF4/hYAf/9J/7j/6v3t/uz8Tv50/mj+zf/d//r+iQEy/hoCsv5aAHH/Gf64/8L+XgDe/8MA6f8HAO7/aACg/okBF/34/3n8s/1W/OH93v1j/m7/e/1i/zr95P/5/pEASQAKAYL/' +
          'YAL4/lICtv+mAMz/NP+0/i//nf4TAOL/fwCF/yUBm/1qAWP8PgDW+8H9hvuz/F78U/1T/nr9wP6Y/Qn9Iv3h+6T8Nv0a/bX+F/+o/tQA+v6eAI/+qP/j/Hb/Df1fAKD/zf/UAVT+nQIs/XoDSfyaA878fALB/m8C' +
          '5ADbAzECZASPAqUDDgKjA1YCGATwAhoD5ALYAFwDt/9fBGv/KQOM/kT/yf6f/QwAZv/lAAoCvwBoA1X/wQIZ/r4Aav5H/zv/mwBCAEMCmgIUAlkENAHnAwkADAIy/0f/1v4j/f3+vf2a/ywArv4+AfT8JAA2/Sj/' +
          '5v7K/7UAiQBAAvkAhAJfAf4BLgDdAI/+Mv/X/v/+mf+m/6X/bgDNAEsA6QHw/vL/DP4//bb9wv1I/ij/cP6r/tL93f7M/P//lfwVAFn+kwBhALIB8wHgAAIBD//C/tj+vP4FALn/aQDg/7T/zf72/6L9BwDF/bj+' +
          'T/41/vv+JwDX/1MCC//0AQP+swCx/tf/if8F/zcAVP6VAfT9DgK9/TgBm/2HAGX+Kv++/w7/qQDDAOsAIQFnAcT/jAEw/sz/g/7i/ib/SAC2//gAlQHRABACXwFIAf8ASAEU/8cBJv6SAbj+igCD/or/mP0v/x7+' +
          '9v5o/w7/KwFoALsDmwCFBPv/kgLa/6j/Z/9C/b3/Uvt+AGn6tQA0+9L/evw+/uX8zfx7/FH7lvzS+mf9yfuf/lf9J/+g/p/+Ff+k/iL/n//m/t0A9P5zAQYAswEHATUBrQGT//QBlf7cAU7/ZgGxAH0AdAFJ/9sB' +
          'kv4DAkYAaAFDA3wA5gSIAL4EHAHhA2UCxgLGBFYCSAZSAtYGZwKzBhEDdgW2Am0EYwIZBOUBdAMzASIDdQHVA+ABXgQXAuYD7wFSA3MCaQPjApoCQQMnAWID0QCrAr8A0QHm/yIBFv+rANX+vf+T/lj/lP40/8/+' +
          '2v5z/k7+q/3G/cD9NP6R/sv+Zv7q/kL9Ff6O/Ev9dPzX/Cb8k/x7+239B/sa/lv7Ov75+/79Zfy3/dn8zP2a/Rn9mP6A/F//qvxY/yb9f/5t/WT+cv0G/1P9CP+K/Dv/a/wTAMz8dgA8/ff/o/3b/iH+J/40/6j+' +
          'XQC9/2YBrQBkAU0BEwG9AagAlAG4ALQAUgFGAJYBgQAOAucAygEvAWUBOQGuAXgBQAJ4AQYD4wBYAzEAVAJ4/0IBZf8tAZ//gwHI/5YBQwA4AcQAhAEdAaUBGQFVAXcBBAHVAe8ArgG+ANwBvAAQAq4B0gH9AXYB' +
          'JgLJAaUBPgKaAJQCnADeAs8A5wG9AawAOANJAHADXQDOAhABZAKvAbABeQFsAeYApwJoAAIEZwD7A6AAHgO4AEMCyQCEAQkBtACfATIApAH5/4YB3v/PARgBgQFfAtEAZAKaADUC6wDgAS0B8QBgAWsAWwFbAJ4A' +
          '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' +
          'lPyh+Mn9O/nT/8z5iQES+nwBR/tu/5P9Jf1S/678AwCu/JAAzvw0APb8Ov8F/bj+svwD/6r8tP90/eb/+P1+/5r+kf5F/zz9hf/r+wn/5/vJ/vT88P6x/eD+Tv6P/pf/Hf4aAdr9/gEd/vYCVf+sA1X/sgOo/o8D' +
          '6P7+Avr+OAIG/ywBQf85AAj/3v+8/vj+y/7T/dP+df3k/6L9IgEs/uQB9v7XAo//2AKf/ywC1f/QAYEAvAFHAd0A2wGo/9IBIP97Ad3+cwEG/30BQP/sAFH/VAB5/+7/UABE/6QBKP/4AdX/6wEQADkCZQCGAmMC' +
          '0AJSBPkC1AQ+A40FMwO5BqcC3QaSAdsG0f+TB7n+QQc0//sFKQHZBEcDYAMCBE8BIwTS/1gEFADUA94AqgK2AOoB3ADLAVcC1wE6A0QCMwPzAkEDXAP2AgUD8AIXAlYDYwGgA64AigMnAPcCTQB7AugAAwKMAYUB' +
          'DQLPAAkC+f8wAaD/7ACJ/5cBtP8rAhUAegJgABkCQAAbAdr/TAB1/83/ff7G/2D9GAAI/RoAB/2F/z/9Rf/Q/d3/Gv48AEf+qwCP/hIBO/7DAJT9rQB8/agAWv0sADr9cv8S/ub+T/+T/rj/Hf5u/9H9z/5C/oT9' +
          '4P/D/J8Ab/2//zD+l//G/iX/ogDW/V4CFf3EAdH8dgDW/Oz/mf3k/ij/X/wvAND6hP83+5D+tfsm/2D8j/+S/YEAb/4aAr3+ywGZ/8MAfgB//zsAG/6t/9L9EwB4/uAASP5pAGP+nf9n/8z/XAB0/1QBwP5FATD/' +
          'pwGo/zMBZv9+/xH/rv9M/14BJP9YAST/wwAtAawBuwIaAKABrf7M/zMAAwA6ATYBdwCZAPL/7/9qAZUBDQNXA94DRQPNA6QCiAO8AqsDzAICBEQCUQMGAx4ClwOiAYYCQgEFAukB8wJwA90DAgSbA2EDOAQ2BCwF' +
          'UwU4BH0FrgLsBb8CMQXFA9UCGQQeAHUEXv/fBAoAUAMMAbQACgIgAO0B1f+VABL+af82/Rv/9P6l/uwAPv5PARr9VQHJ/FEBxf1QAQ/+7v+x/ZD9L/xD/Kb7QPwF/YD8Vf6t/AX/WP0R/x/+VP13/5j6DAHC+o8B' +
          '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' +
          'm/7/ABb/BgIzAG8CygHBAlEChAMCAmkEHwFbBAsBSgOZAdACdQK7AmIDDgIGAywBewJiALQBIgAuATEAIwHN/+UAtv8qAZYA1AA1AQUA7QDb/9gAFwA/AfEAcAG+AYwBOAEtAn8AkgILADMCmf8TAhwAQgKOAKsB' +
          'cQBsAJ8Anf9GAbH+KAFl/br/Q/0+/kH+ff1a/0H+RAD6/+sAvQFdAb0CcgHvARUBmgAHAXYANwE2ANoAWf9nAM/+QAAW/hwAR/68/83+cP81/0T/KgCb/noAJP6EAHj+5/9Z/zf/SACX/7UAgACsABgBmwB3AOQA' +
          'tf8bAQ4ANgE1ATABOQLwACMD9QAvAn4Anf9O/1f+o/6G/Y/+Hf0D/nT96/z8/h38MgE7/HECEf0PA6f9WQLT/YcA7P2y/kD+b/2+/hf93P4f/aH+cv3G/v/9x/8R/n8AkP6AAJn/aQCm/ycAY//M/yv/T/+N//f+' +
          '4P8f/6b/5f8aAMYAWwDjAE0AjwCM/00Aqf6GAJL+JwFV/rEBcf4dAtD+bQKC/q0Caf6YAnD/OAJ2APcBrwC5AXsAVQE1AIEAuP9C/zj/8P4K/3D/1v4E/8T+gP6S/y7/oQAZACEAcwDh/x8BEwFgAuUBuAKSAosC' +
          '4QKoApICQgLWAvMBXAOdAhIDVgM0AgMDIAF2ApcAeQLpAGECBgHnARUBPQFiARsBpAFfATECKgGoAgwBcQKFAeoBDgJGAXUCQgEgA+wBrwPtAdkDuAE9BK0BUgRIAXUDsQAMAhkAtwCj/+v/e/8G/5v/wP26/3P9' +
          '0v/i/ZP/yP1V/zr+L/9N/9r+V/80/6r+sP/M/sT/tf/S/wIA2/+f/4D/Kv+b/qb+Of4n/sL+xP2S/yv9BwA+/AcAHPz0/n38Xv2K/Ar99vwD/ZT9rfzt/aX8KP4s/dH+Vf7U//f+bgAQ/68AHv9kAMr+lf/w/jv/' +
          'lf++/6b/8P8t/0v/s/4V/yz+Zv9Q/Yj/a/2I/6j+gP/F/3H/rABb/8AAKP/7/6n+W/86/k7/YP6D/2v+lP/o/Xb/UP5T/3T/AADA/xQBKgAcAdsAdgDXABAAugAQALIAkQCVAHwBWQBiAikAkwJNAMUBGQDXAIj/' +
          '/AB5/wkB1v9qAL3/mwAR/2YA7v4YACcAvQCVARkB2gEmAbgB4ABbAa4AbgBfAOD/LwDM/zoAc//c/+7+FwB+//b/swBx/+gAWP+vAKD/pACbAJoA2ACbAKQA7gCzAO4BkQHPAgsDiAPvAlUEWQJTBLQB+QPzAAwE' +
          'UwEjBPgB7AOiApoDgwI+A7cBTgKIAegAfwH0/8EBYf8RAu3+5QEn/8ABwP+wAb//JgFx//wA5P47AXD+NwEZ/8sBx/8XARMAGgDCAMIAYwHJALABMQAyAR//HAAP/sj/bv2//4/9E/9f/jT+wP77/H3/q/ysAOH9' +
          'OAKU/tcCLv/4ASIAeADxAC3/UgHG/jgBwv5BAjUAaQNBAVEDmQAVAyIATgJ7/1oAIv/i/gf/C/9h/g//X/41/kr/0v0qAA7+lQER/s0Dtv2hA2b+jQFDAD8BPwHnAK8Br/+zAg3/aAK+/qcAWf4u/27+jv5V/7P+' +
          'RP9j/lL/Yf1Y/xL8ef69+gL+ofm0/bX4Hf4Q+Qz+uPpp/YL9ov0zAOX9IQCB/XL+sf2w/QT+2/0f/fn9oPzD/UT8Tf1E/MP83/3l/HX///0B//z+8/23/nD98P3U/CL+iP2M/9T+GQEdANcBTQEOAvUBqQJZArsD' +
          'FgKJBJwBIwX1AQIFWgPyAwQDTAO9AZUDqgGxBCYBggVMARUFtgLPA/ADUAL9BFQB5gSTAMgDPACtA5MAsgMtAGsDPv8BAxr/jQJu/+YCkP+ZAhAAJwL+ANwB9gAmAfH/qgAu/6P/r//4/o0Arv8FAPL/iv9l/6L/' +
          'kP+m/iz/e/1s/iT9cv/r+5H/+/lV/W768vs1/GP8Cv12/Yb+Ff8xAFcACQBZAF7/CP/L/1f9CQCx/e//VP7gAGj9kwEQ/doACv0yALL88P8O/Vn/bP4t/xQAbv86AYX/tgG4/zQBdwCBAIMBYAD5AZsAcgLiAEcD' +
          'ZgDQA+UAVwSfAqgEngK/A6gCgAJGA1oCHQKmAeAA7P9RALX+1P+1/ZX/sPyd/0v8UgA1/SEBkf7wAAf/EwAP/1H/9f6P/hj+zf10/e38ff7N/Lj/uf0BAIn+GwAx/xkAwv/v/zUACQBUAIYAXwCiAEsABgCv/2H/' +
          'Rv9a/6X/pv/kACcA0gEZAZABZwH4ACIBdABLATIAcgHK/ywBVP/zAOH/VgEnAP4BLQAZAhIB5AHCATcCfAFKApIAigGLAPsAJwHuAP0A8AC9AHwAPAEhAMIAegAEAPkAfgDkAf7/PwPB/yEEkwCNBMUBkwQyA8QD' +
          'pAO6AksDDAIUA3EBigMuAd0D/QA+BH4AUwOCAJcBkAAtAen/mwBs/08ATf/gACX/ugE0/9YBov9UAcj/QAE1/3QAjf4e/0r+Uf6H/rD98v5p/S3/dP3V/7X92ADO/kcBWf8bAbX+6ADy/d8A7f3KABL+cADM/ZP/' +
          'Av6a/gP+mP6D/kP/vP9B/54Atv4SAZX+ugDn/ooAAf+HALD+eP+O/tr9lf5l/aH+iv3M/iD9sv6D/f/9VP7r/Mz9h/xd/Tv8Gv7/+jf+mvoB/nr7cv6A/H/+H/0M/hL93f2J/Tz+wP5T/pn/s/3P/3H91P9e/QQA' +
          'YP0gAFb9f/+W/Qr+mP65/fr+f/6P//v9IwCL/fD/nP7a/1X/xf+j/sT/sP2A/4D9zv7P/bP9Of4y/Yf+5v3L/rj+Bf9i/6X/QwAmAL0AMwBjANcAJQAIAfX/pQAgAKYA2wAUAVQB3QHnANIBZwDAAOUATP+zALn+' +
          'ewBA/8QANv+4AEj/lAH//3ABkgDIAC0BWQG4AQMBpAFmACcBMQBVARMAngHJ/9wAp/8uANL/+P9n/0D/7v9j/sQANP7KAMP+gwBv/8YAnf8tAav/VQC0/1sAXP8/Aaf/agHcAIkAaAFZ/4wBlP5GAtv9iQJY/ucB' +
          'rf+SAYsA3gH0APcBYwEFAbIAl/8h/yT/1f4w/xX/pv5T/4X+jf97/8T/EADu/87/qf+c/3b/Mv+8/wP/LABk/w4AQv8b/wb/XP78/4P+oQFT/tAB6f1kAP79f/80/Wb/EfzE/r787v1L/lz9OP/M/Nb/D/1XAH39' +
          'WQBk/QYAwv28/3r+ov6A/ob92P0c/RP+Nv3g/rT9Ff8L/lP/Uv/G/+z/mv+N/wz/MACu/0cAUQBEAOP/eQEsAOMBOQFQAewBiQFRAnABvAKIAJQCAwAXAmMAOgL9AAUDTACRAzv/5QLM/sgBOv+sAHcAVgDHAU0B' +
          'XgPKAUUEWgGZA7QARQJFAMAAu/8AAN3+tQDc/kIBoP+/APP/y//D/xv/yP/z/vj/c/+Z/yAA7P4vAET+BgDm/fX/cv7YAD7/JgIZAEICTAF+AeIBWACVAY3/fAER/7ICN//XAzoA2AMCAY0DJAG3Ao8AIALr/2UC' +
          'af9BAqv/TwGqAGIA0wHS/8sCif9rAhgAQAFYAf//dgIxAPgCcgGvAkACfAEVAxQAIQN5/54CRP+OAfb+agAB/vP/Qf1HAOH9kgA3/m8A6P39AHv+UwBb/2n/ZP/I/sf/5P0QAR/+AQKe/qICtP8sA97/FgN4/00C' +
          'NgAzAYsA7v9ZAJn+JgCX/er/MP0e/yn9Ov5g/TD+Qv6s/vz+mv7R/o7+//6U/uD/Df4hAJL+2v/k/zUANQDJAHf/3gBl/3wAUf/p/yb/e//9/0//VgBB//AA7v5TAcf+UgD7/qj/B/9v/5z/Af/sAFv/tQH3/2oB' +
          'FwD4AIAA/QByAMEAcABhAEEBrgDOAcQAZAEGABkBC/9IAfT9HABL/eb+tv0R/7b+1v8n/6gA4v5XAP3+ov+W/3r/k/8J/+f+6v72/sv/yv9PAAwAfv9wAKT+sQFA/0wCGwGqAsgCnwNEA5gDHQMeA+UBZwP5/+oC' +
          'If9EARz/cACg/3MA7v/k/wgAe//9AKH/LAEEAEIATwBZ//b/Gf7W/8r99v8n/xUAjQBkAC8BdgALAVUAsAAPAHoA6//DAL//fwEz/9gAlf6p/8v9aP9Y/br+nf0+/jj+p/4D/03/+//M/84APP/xADP/hABLAOD/' +
          'rgCb/54A4f/XAO7/DgFZANQAlwHYAA4CnAAzAQQAKACV/1T/Iv+f/of/vf5s/3//xP76/qD+ev1M/gz9EP5h/T/+wP3D/nP+Zf8U/wAA2f5BACr++P83/lD/Of+B/3YAOwAMASMAAQH//4wAXv/U/8j+Wv8y/2b/' +
          '3f/6/6cA/v+sAKb/PQDl/0MAkP9hAPb+qABU/9YAoP87ATH/ZAG4/1oAUAGb/w0Cf//uAVr/lAEy/x8B1P59AJT+0P8F/23/yv8z/1oATP/5AP3/xQAcATwA3QF/ADgCKwGRAgsCSQJeApsBCAKWAbABLwLRAZcC' +
          '9QGYAlwCXQIuA8wBJAMOAfMC2wCAAhkBhQH7ADkBvQBdAYkAvwFPAJ4BOQDHADIA6f/x/+v+Z/+T/ij/0v5D//v+mf/9/iIAof/HAMcAUAEdAVwBGAEpAaUAuQAAAFIAd/+OAL7+MAFk/kwBaf7uAHP+0ABb/pAA' +
          'Q/71/yb+cf94/mr/J/9c/9L/Av8QAM7+vP+M/oT/gP4J/wr/dP6l/37+dP/0/vn+7v7u/gv/sf6C/3D+ev/A/mT/i/84/9j/Ef9b/03/Bf90/7n+9f4b/vz+9f1Q/8j+Uv9h/7D/bf+m/9L/QP9iAKr/mQBcAJcA' +
          'IwATAXIAZgGWAGoARABY/4YARP/d//7+AABf/rUAi/7H/+L+2P9t/oAAMv5m/6f+WP/8/dL+3/yf/Qz9jf4Q/UT/GP3j/5n+m/+nAOH+3AFz/uIBbf5XAXQASQEyAdIBFf8/AiT9EgKW/Z4A+P0d/9X/Af8fA7H+' +
          'IAKo/bT/wv3o/gz/B/92/wv/uP6s/1T+uwAx/zUA6AASALYBXQA9AdUAAgLjAE0DhwB1AiEBrwH3AMYBOAGPAUsCtwF4AWABbgDl/0QBXv6GAXj+3gAY/20BHf9jAkMA+gF6AboAlwG7/5QB2f5kAXr/qgCvAJAA' +
          'SAERAq0CLwOIAlAC2wBbALwA4f7wAJ/+dAA0/4cAowAJAAYCn//JAQYApQDe/1D/QACH/vUARf+IAIH/Nv8Z/8z+Wf9G/8r+yAAe/uUB4P4CAZn/jQFs/4MBjf/X/3//I/9V/w3/dwAq/wkBvv4HADD/fP8y/3MA' +
          'aP3YABP9gf9I/hb/mf+a/0YCR/87BCf/aQOt/3MCKQAMAekAUQCFAWgB5AC2AYL/GgIj//sBHwAWARYAqwB8/iAAjP3v/4r9PQDU/aYAgP7f/9z+fv8G/3IAyP9tAGYADP8nAbr9UAFw/kUArP9vARMBDgPKAcoB' +
          'PgANAR3+qQFD/csAtf5p/+n/mP/9/7r/Mv/f/mX+Zv+F/tIASv91AC4ADAB//0sB/P53AWb/7gDVAAACgAK5AjECUwLmAH4COgCkAsn/6QFr/zMBFQBoAfr/2gGg/0ABAQBvAIv/NwDH/ywAJAHxAK8ByAGrAXQB' +
          'VAETAXcAFgH//3wAVgBy/ykBSP8oAWkAbQB1AXf/NAEfAHcAkQHY/6UAPP/2/1f/BAC3//b/wv/L/9f/6f+2/1YAlf/D/+L/qv8ZAJL/0v+F/6P/6P/x/xb/GQD//ZP/J/7q/kT/nP+NACMBoQG3ARsCuQF3AcsB' +
          'Xv+zAQv+JwHv/pIA3P9uAEoA/P/kADT/4AC+/s3/bf7F/t39gP6n/ZP+h/5Y/gj/u/0c/u/9e/2l/iH+q/53/gr/6v2o/wj+pv+E/nL/8/0k/1P9q/45/Ub+5fy9/RH9Mf3P/Xr93f3W/Uv9OP74/C//ZP2t/9H9' +
          'HgC9/W4ACv5hAJf+wQDs/o4ATf9OACUA9P8TAQv/GQFl/x0BQwBJAYAAcAByAF//iQAg/4IAI/+MAKv+8ACf/lEBNP9DAqz/hQKIAOQCjwEcBDwCBgS/AvUCfwO0AT0E7AArBKcBHQT4AsAEGAMCBcMCOAQgAkwD' +
          'ogHMAoMCZQIwAzMCcwMPAm0DuAFbAmwBYgGzAZwBcgKlAWgCSwGYAbgBNQGqAQMBhwB3AMv/7//b/4//pP8v/0j/mf7y/uT9hv5L/Xj+Gf2//pX9O/9Q/kb/tP6o/nn+aP4m/jH/Sf4pAPf+jgDF/4QApv9CACb/' +
          'm/9//zD/owCl/48BKQC9AScBrwEdAQ0B9/+4/+L/TP9H/3IADP9AAScAWgF0AG0BUP9ZADT+5v5+/qX+Mf/u/rD/if5v/9T9if7I/Sz+Lf5r/qf+a/4y/0b+z//c/sT/+P5H/+f+bP9K/xEAO/+JACv/LQAO/4H/' +
          '0P4s/yT/B/+n//L+1f/x/m0A2P7+AEP+5wBJ/VEA0Pyd/5L9l/9p/m//p/7B/pb+af7Y/WH+JP1J/jn9YP6u/UD+j/2L/Rf99fwG/d380vwo/XX8C/2M/AT9T/2U/ez9j/35/Wb9ZP7f/T//gv4gANX+CQHd/pIB' +
          '/v4xARn/eQAx/3YAzP/YAEwAFgCY/xH/bP4g/3r90v4u/T/+bv53/rL/KP8CAHT/NQBI//7/Vf+Z/xr/U/8q/8z+DQDH/rUAo/8tAUUAsQGDAOQBnwBfAdj/vQCX/hQBVf7IAXv+mQGo/t8AOf+7ANP/FQEbALEA' +
          'Zf+S/0P/Lf+g/3T/CAB8/6MAzf8mAKkACQBMAYj/nAEV//cBTwBkAoQBCQPvAUsEzwEbBa8BxgNBAe0BCgGUAfAA2AEEAWoBiwELAI4BpP7iAd39OwKq/ZIBn/2lAM79WAB2/jIAdP/r/70ADAAyAeX/KQEC/7gB' +
          'iv5fAvb+lgJJ/9UBjv+tAAIArf+X/+f+Uf5q/vj90f2q/mb9G/9H/VT/zf2Z/l//HP1DAOT8Nv/R/fj9wP6E/eb+Hf2B/h/93P2k/YP9av06/qz8c/4r/WT+w/0d/in9RP0w/cX80v1v/PP93fwp/lP9lP4U/sX+' +
          'yv8v/+IA0/+pAP3/cgD6/1gBcQCIAU8BBAHDAaoApQFsAAcCtgD+ApABXgNvAhEDVQKyAuoBDQJMARUBDwFrAHUBpgAjAfwAOgErAdEB9gEYAp8CkwKzAhQDnAL6AhMDPgLLA/AB9QORAXoE0gAGBewAsAQ1Ad8D' +
          'EwHzArMA+wGOABMB8ACoAHEBVgApAmv/FQI2/h8Bw/0NAUv+bQHl/sQBb/8bAicAYgGpACUA7gBI/0MB1P5nAQr/jgF3/yQCjv9BAn//XQFW/3YAYv/L/+v/T/9uANL/OgGFABoCWwBvAqz/WgL6/vcBbv83AegA' +
          '9v8IAiP/qwIJ/xID0v8AA9MASQK4ALQBcQB7AWAAMQENAAcBMwCcABwB9/8/AVb/ZwBQ/n3/S/2z/vD81v53/en/ff7gAFz/FwHr/+oAAwA2APL/E/8fAKv+cgDI/pIAxv7f/63+v/5i/yr+1AAb/uYANP5sACj+' +
          'bQAl/kD/5v3g/d/8Gv57/Nn/Jv1tAbj9sQEv/gEBZf4e/0/+2PwU/jr7pP2k+mT9FPuD/ZL7Zv2T+8n8Dvyo/K39wvyZ/oP8jP6j/CT/Bf2J/579//6F/sb+6f5B/5j+rf91/q//uv6j/xX/CwCm/2EAbgBxAFwB' +
          'oADfAdMA6wHhANsBwwCDASYBPwEjAgMBdgKCAKUB0P/QAFn/oACR/5AA1P8ZAbb/2QHj/78B6QDiAcMBSALmAV4CoQKXAv0DrgL+BKYCSgWZAu4EeAI2BKsCcwPfAg8DUwJ5AqoBQgGUAYMAuQFKAKsBHAClAScA' +
          'KQInAGoCUQAcAvQAMQL7AcwCOgMuAwgELwM7BBcDTwT5Ai4E1AJjA3sCLQKVAkkBTgLRAEEBLQDTAMH/LgDv/8r/rf86AOj+KACY/loAnv49Aav+bgGY/z4BegEPAeYCRgBYA97/UgMxAA4DuQA1Ah0BMwEiAdwA' +
          'CQF1AMAAsf+VAIn/zAAyAGABrQDnAVYACQIsAOMBggBtAZsA6wAlAbcANAIcAccC1wGmAkMCAgKuAUEBlAAgAOn/4P5h/zT+6P4s/a/+zPs4/437rf9B/HX/kvyT/9v8TP/n/QP/sv4r/+L+dP9B/+T/tv9i/8X/' +
          'xf7U/3n+eABs/u4AJP+cAHn/VwA1/xMA0/4s/3P+Ff4d/g/9NP5d/Mr+Bvz7/sn7bP7S+6z9A/zK/YP8mv4a/Uj/pP2S/zb+Av+A/gH+8f72/Wr/e/68/5P+TwDS/tMAJv/BAFP/aQDe/5cAWwBKAdb/vgFQ/64B' +
          's/96AYgALwGeAeAA7AGXAIsBjAAkAT4BzAD8AfIAhQJCAUgDlAEIBL0BPAQuAucDyQKXA8gC+QK+AhkCxgLAAWwCwwH9AWEB7wHSAF0BjwCkAEsAcwBqAFEAtwDHAIwAKgHAAD0BhgE5AQIC3AAtAoIALwJWAJwB' +
          'dQCBAGAAav/G/6H+Ef9a/gT/hP4C/3b+qf4P/g//lf1+/yD9S/9v/Q//TP7V/sb+zP4M/wr/Zf+5/s//ff4lAMn+owDB/gcBcf6bAL798/8a/QX/Ev3e/ZP9q/1X/hb+vP5h/hr/Uv6N/yv+Uv+R/r7+3f5O/sn+' +
          '8P37/rP9fP/c/f//Mv4KAPH9h/+5/c/+9/1m/if+tP4D/o//oP0UAK39cP8p/ij+hP7m/Gn+zPs3/pH7DP6e/An+sv1U/uL9U/6y/XL+VP0n/9f8d//K/G//c/2g/yr+of6o/pj9VP8T/vX/T/5PADX+rwCX/hgB' +
          'dP4LAdz9zwA8/uAAw/5+AFD/ev89ADX/1wAYAP4AmwAcAEoA7/4NAGL+2v/j/mH/1/8F/4QAAv8WAUP/KQGT/3MBj//ZAVT/nAHk/kwBe/5DAaL+AAH1/pYAV/+PANL/XwAWAL7/GwAy/wQA2/60/2/+If9o/h7/' +
          'jv6r/0P+5/8z/vT/mP4TAFz/CwBtAN7/6gC0/yMAu/8p/+3/nP7F/zj+OP+W/vz+Bv9g/xz/uP8b//z/wP6MALj+8QAE/18BoP60Acj9RQGF/VYA0v2c/5b+r//F//b/jwAaAM8AgADNANYAhAC9AA8AbABW/z0A' +
          'jP70/0P+gP+L/iD/Dv+r/nn/fv4bACj/dAD0/1YA/f+YAK7/cACo/ysA3/9JAO//DwDl/5T/BgBZ/ygA6v9UAFwAPQCOAKz/JwE3/zQBDv+vAPD+LACv/iQAmf5/AAf/kwBw/wABh/9QAbf/5wAfAGgAdADX/48A' +
          'bf+gAFv/qwBS/28AR//p/+f/jv9LAKf/vP/3/7D+VQBx/Y0ACP1xAO/8GABl/cT/lP5R/yH/eP4s/+n9Kf8E/jT/if5M/xD/r/9Q/zQAnv86AJz/yv9q/8L/tv+O/ygAXv+CAN3/7AC//0gBz/8ZARoAtAAKAL4A' +
          'AQDcAAcA0wBPALoAjwBcAN0A6v/xAOr/3QDi/6gAXP9+AP/+7AA1/08Bov8bAQcAawCjAO7/UAGj/8wBUv/wAXT/ogEBABoBgACbAPYAewCmAXMAFgIFABsCdP/+AWv/NgLq/9oCjAAMA1sBuQIAAokCOwKUAlwC' +
          'iALWAp8CIQP1AscC9AKoApUCwgJ7Au8CfQJhAzACxQNUAvkDjALgA3ACxQMeArwDmQF1A7MBGAM0AtoCkwKyAjACYQKVAbwBIQEmAY0AvQCfAE0AvQAWAI8AGgAJAEEAa/9kAFX/kACb/68Azf9PAM3///9OAL3/' +
          'kwAo/1sAw/5mAH/+cgAw/pUAJ/5+AIT+AgDk/qL/BP8l/w7/+P4j/yH/Rv8x/7D/yv80AE4ASgAyAG4A9//1ANH//wAbAHcAogB1AN0AmAC4APX/KgBM/3X/If/z/gb/i/43/63+OwD1/tAAC/92ADL/owBA/wwB' +
          'OP9SAWr/2gGBAFYClgF/At0BDAKPAVYB4QDaAIwAUQCjAMD/8gBv/2oBL/+0AQr/RgFA/74A5//SAJgABgGfANIA/v9vAA7/DgCL/rj/uf7d/83+JQCb/kkAfv4kAJz+vf+5/p//mf4HAIP+VwCM/gUAkP6x/5P+' +
          'S//H/gH/Wv8H/xAAEf+0AGH/MAG0/zIB4P8fATUAZwHZAL4BQQHfAUIBagFmAb4ArwHGAMEBLwGEARQBPwGNAP8ABQDYAFn/rAAC/1wAef/r//3/bv80AED/igDG/ooAfv5OANP+4QDr/p4BBv+QAfH+FAHp/qAA' +
          'Sf8hAK3/i//W/1j/x/9N/8P/6P5c/6L+Kv/9/m3/qf9k/+H/5P4//1n+MP4p/tP9Jf5d/qv+4v4z/wn/qP/1/i4As/5bAJ7+iQDP/loA1/7+//n+o/+w/7j/CgCFAG3/GgEh/0EBu/8fATsA3QDj/1sAN/9r//H+' +
          'nP7E/qb+1P4a/27/l/97/50A6P6QAQX/oQGM/3YBfv+8AeD/9QFYAbYBhAJTAbUCWgFUAlYBtQHcABUB1wAaAQAB3gFTANQBhv+sAIX/LABh/24ABf8NAHL/c/8VAL//KQBbAMT/WgBW/1kAcf+bABwA5v95AIP+' +
          'JAD//bH/Vv7d/7H+jwD8/hoBTf+qAV3/uwGB/7UAFABP/4IA9/1uAL78OgAS/CcAnvwLAEz++v8/AB4AdgEHAM8Blf8tAlv/qAIt/+kCzv4mA/3+egP4/7MD0gDFA/EAkwMHAfMCcQFHAokBuwEqAfMAvgASAHMA' +
          '1f91AHwA6AD3ADkB6gBHAdcAsQHSABIC0gCtAaMAMQGGAEMBfAD6AA0A7P9z/wz/hv8s/yEADgA1AFgAxv/E/yD/U/8q/iH/bP3i/sP9xf5+/uX+Ev8R//z/Bf+XAM3+twDG/qAA/P59ACX/BQAy/1r/b/9X/9H/' +
          'Jv8ZALz+MAB4/ggAWv69/8X+av8z/zD/av8V/3j/9f5b/83+Rv8M/1n/v/+O/xEAqv9JAMP/+gDT/2QBtv8RAYP/qwBr/8MAgv/eAI3/kwC1/18A0/+5AJb/6QA7/1oADf/e/xv/xP/U/kf/hv6B/qH+ef7f/tv+' +
          'bf/H/hAAz/6AAEH/fwBI/00A4P5MAMz+AQDX/ij/pP47/sv+E/5w/2X+ev/e/v7+pv9j/z0ASwBcAIgAAwAHAK3/Yf9b/yn/T/+B/53/1/87/8n/v/7v/53+/f98/p//cf5a/0v+Lv8I/jX/3v14/xT+YP+e/pD+' +
          'iP8V/kMAA/83AFEAFACzADQAdQBbAGgASwB+AOD/OwAY/7//zf5n/0L/Uv8y/3H/4/5x/8X+VP+d/ib/nP7y/r7+A/8p/+j+df9q/o7/Pv5//5P+y/7N/uz9u/5a/Zz+T/1q/s39Z/5g/vT+lv62/0r+6f/y/cT/' +
          'I/71/5T+IwCP/vv/jf4SAMT+jADg/rwAKf/uAIn/VQHB/0ABx/8OAfz/JgFEACABawCFAK8A0v+yALT/yACF/wUBJv9FASf/fAE+/08BBv8KAdj+ggAD/6r/Lv/6/l7/Mf/Q/8L/RgDF/2YA8/8pADYA2/88AMP/' +
          'AQC0//v/kP9AAIn/GQCf/+v/mf/2/1n/+P9u/9v/AADH/0sA6/8ZAB8Aw/8MAF3/2/+2/isAJP7BADP+9wCf/ucA3v6nAPv+AAA5/1T/of+5/iwAXv6WAHj+rAC3/rYAKv/FAFb/2wA8/wYBNv/GAGv/9/+x/yX/' +
          'i/9c/oX/sP2l/9L99v8D/4kATADCAOIArQBdATsAMQLY/9QCLAACA9kA4wKNAW8CFQIiAjICdAIoAv0CIgIbAxUCrwIbAkMCEwK+ARcC5QAiAk4ARAI4AHgCMAAwAv7/2wE9AKUB4AAcAQcBfACQADwA/P8xAID/' +
          'AgAM/xgAF/8/AL//QAA7AEAAPwAGAPD/n/9y/1v/QP8t/7H/Fv9gAHD/ogCY/4wAjP+vANT/+wAFAAEB1P/lAJL/CAGy/xgB7/8nAYUAtwFpASEC/gHsATMCwwFeAtQB+gKJAV8DJQH3AkQB7wFOAaoA6ADq/6sA' +
          'jP+eAEr/TQBD/x4Adf9pANb/eAC2/yoAFP8lAB/+XgCI/UkAcv4WAAsALwBzARUAkAGM/+wAMP8YAd/+cgE8/rwB7/3oASP+twHq/bkANv30/zH9PgDq/aD/fP5E/sb+Zf3G/qj8Xv6e/CL+5/2S/l3/sP5UAE7+' +
          'wgDk/kgA6P8RANn/YgAi/47/0P6x/dX+yPzZ/lH9Pf8v/vn/of/VABUBEQIlASMDSQD2Am3/jwGK/2UAOACIALcAIQH6APcAGgFqAG4BUgCHAYIAxQGoANkBEwFSAW4BhgBUAbn/WAGj/x4Btv9OAJ3/UwDP/50B' +
          '2ACUAssBNwJmATEBGwFBAEwBqv8oAZ//TAGk/+sBhP9BAuP/xwHkAL8AUwIxAFYDhQDFAr0AQgFvAPb/TADs/iYAf/7m/+n+CgAU/4MA4v4KAcT/6wBcAS4AzwEa/2sBF/6cAev9ugG6/vwAFgCOAJsA9QB5ADYB' +
          '0AAeATsB+gBSAWkAqgFO/1YCg/4VAuz+MAEGANsABwGNAU4CjwKOA3gC3wPDATQDPQEfAokABQHM/9v/YABh/8oBxv8IAqH//AEf/0UCXv83ArH/AgKC/0ABf/8aAPT/ff9MAHf/UwDl/4cA2gAXAckBkgE0ApIB' +
          'SAFLAV3/DwFV/uoA0v2AAJL9pP8t/tv+SP8K/uD/dP0BAL79gADg/ToAhP0W/4P98/29/Yr91/0X/q79jP5x/Tv/Qv13//r8XP4X/aH9iP3N/bX9nP0E/mD9qv6Q/d3+Xf0y/mP9Yv3x/eP8Sv6+/DT/WP0lACb+' +
          'iv+J/pH+7f4D/lH/Qf0t/+P8wf4X/d3+a/1L/8X9hf8E/rT/mf6O/2T/KP92/x3/Rv9S/8b/mv+OAMv/ngCA/y4AB/8nADP/iAAQABABnAAYAcgApwBJAT4AoAFL/4MBqf5eAQ3/KAHC/+kAYwDgAGkA1gBQAEQA' +
          'ogB5/+sA6P4PAc3+iAFm/zkC4/9DAtX/9wHB/5oBnv/TAGX/+P+c/zT/tACg/g0CTP6XAir+aAKX/hcCcv8UAvj/YAIJAIECTAB+AiIBYAL1AewBSgISAQMC1/8ZAeH+2f/6/vz+zv/x/hEAyf5u/5n+/v4b/xX/' +
          'ov8Z/8n/Df/f/5T/AwBXAAcAawDE/ykA1f4RAHv96f+L/Mn/U/wlAAf9ZgAh/sv/yP7a/jP/NP6M/yn+qf/X/h4Ayv9gAFQAGQCAAIEAnQDlAIsAtABTAMIA7v/lANz/xQCRALoAIgH8AN8A+ABBAMUAsv96AB//' +
          'xv/Z/k//NP+u/+7/VwCdAHIA7wCEAPIAYAD3AMX//ACP/+oAZf/tAFP/igBy/3b/RP+A/gr/BP5e/6j9y/9T/Zv/P/2i/0j9Mf8F/Qz+l/y2/Z38q/0C/fj9Rv26/oH9rv6x/Vn+u/0t/rH9zP2f/XX9wP0R/Sv+' +
          '8/zA/kf9RP+t/Yz/4f2x/5z9sv9f/YP/Jv3A/+D8VQBC/XEAG/56ABz/2QDW/8QAUAAWAK4A1v+zAPX/2ADd/7wAsf8YAKj/m/8SAHH/rwAa/2MB2v5aAif/3gJK/58CiP+UAvX/yAI+ABMCzQAJAXgBkwC+AWAA' +
          'pAFEAKkBOQCiAUcA3AEVAJUCaf8hA/z+GAOA/58CcgBXAt8A/wFjAZYBMgJeAScCUwG8AYoB3wGbAQICwAHMAegBSAH+AWYADgKR/9UBKv+vAcv+vgGK/hEC1v7mAaT+AQHx/RQA5v3m/gn+Yf7r/Rb/Gf6E/8b+' +
          'bv8x/0H/Ff+X/lv/W/4gAMv+ywCd/jcBC/6OAZr9mAEb/TEB3fz7AE79zgDr/TYAeP69//f+gP91/zH/WAD1/s8A8v6KABf/agBX/4cAvv9AAEcADgDUAFoAEQG9AN4AlQF9AJICPQAwA0QAJQMxANACGgDWAnsA' +
          'gwIQAQYCYAGtASABHAGKAIgADQDo/4r/Uv8e/0b/Bf+9/93+pwCL/vsBiv66AsX+mwIB/xECuP8OAeQANADmAYP/YQIA/wMC6f4pAb/+eQA0/+//IACR/8MAL/80AbH+PQGS/gUB4f7BAH//zABdACsBYAGYAVoC' +
          'wAGzAm8BlAIEAQEDygC6A64AuwMqADUDwf+oArv/+QGX/1wBmf/pADkAKwBHAW3/ygF2/0ACCQCBAk4A0AGtAGgBuQEdAZUCDAEJAzIBrwMXAY0EgQGEBYgBAQbMADcFGADjA/X/NANkAJoC8wAvAZUBSf/qAfz9' +
          'YAKN/cMCl/3BAn7+8ALK/8MCRQAuAisAdgEpAHYAYgDQ/9kA1/+OAZgAXQLVAeoCqQIuA+sCgwOXApkDzgENA8wAVwLf/6IBlP+vANn/xv+lABv/UAHC/ocBwf54AX3+TgFI/vgA6P78/73/X/85AFP/hAB4/+wA' +
          '8/9yAez/pQG2/1gBCgDjADoAhwDI/27/8/6a/dT9mvwG/aD8C/3P/GH98vwh/v/8Y//8/GEAbf1SAGv+Zf9U/4v+7//x/SMAnf38/5n94v+6/b//MP6y/97++f9Z/+v/kv9P/17/1f6S/nr+K/7C/Vz+Nf2n/jz9' +
          'EP9G/Qn/fv2//j/+RP5L/1v9QQC5/KoAhPxmAIP8qP8F/SX/ov0d/+79tf6m/uv9wv+S/akAwv0cAQL+6gDV/WkAX/1KACX9cAAv/XMAdf3GACL+RgE0/1UBTwAkAdoAGAERARIBeAH9ABUC7gCsAsAAsgKeAAIC' +
          '1QAkAcQAYAAoAKT/yP9S/1b/dv8F/1//kv8j/2QA9P7SAJT+BAFn/i4Bu/7nAEP/PQDI/2r/HQAS/yEAc/8iAL7/XADp/60ASgDUAN0AigBAAR8AHQHZ/1wAc/96//n+Jf/L/jL/zf42/3v+Mv/u/QD/e/2n/g39' +
          'kP4M/R/+vv13/ZP+Sf0+/2n94v/H/UkA+P0mAMr99/+3/T0AGv7aAJr+fwEy/4gBr/8PAb7/xwDA/5YAN/92AIj+pQBr/v8AfP5iAeT+fQGa/9wAUAD6/84Ao/8oAY7/qwGD//EBp//cAan/ZgGS/54An/9wAJP/' +
          'hABz/2MAo/+fANb/lwCO/0IAKv9HABH/MQAP//n/CP+8/xf/Yv8g/0T/Jf+p/1L/EQCV/+j/EwCM/70AbP8MAX7/OAF9/00BkP++AKr/0v+G/yX/sv+x/gEARv4XAOH9EgCN/av/dv08/5r9H//A/Sv/CP5o/2f+' +
          'af+7/gD/MP+o/tD/Nv5zAL/97wCx/XIBqv31AQr98wFa/H8BX/wCAcX8lQAq/fH/i/3g/un9Av4m/gX+oP6k/lP/K//M/07/HgAk//D/4f5X/+T+Ff8+/zX/sP9Y/ykApv+BAKX/iABu/3IA7f94AHwArQAJAfkA' +
          'ZwH3AEMBsQBWAYMAlgE0AOABp/8PAjL//wHu/skB0P4/AdP+tAAA/7wAdP8IASkAHwHiAPEAgQGNADYCZADqAqgAUANaASIDNwKCAlUCEQLJAdIBVQFKASoBlAAFAR0AswDl/4gApP9kAJH/GADe/+3/MwDa/24A' +
          'nv/UAGn/QwGu/3AB+P95Af7/RQE/AJsA1QAbADMBDADKAOj/+/+p/3P/h/9M/3j/iP9k////b/92AAQAHwHRAHsBLgGcATkB6gE/AT8BbAEQAL8Bj//1AX7/9gGh/wUCMgAMAhEBlwGAARIBhgHZAH4BjgBlAXMA' +
          'JwGZAO4AhgD2AFIATQFKAKYBWQCtATsAvQFBAF0BvgBsAC0B2/9kAcj/nAEDAJMBQQA/AcMATwE5AakBLwFMAWsBawCqAcT/lQFb/1UBEP/tAND+qAC7/oIAr/6nAE3+JAHN/XYBpf0/AdD91QAG/joARf5q/3T+' +
          'Bv9u/ij/o/6Z/1//PwAGANYAMwDeAHcAUQAVAXH/mQGf/ucBQP7fAUD+OAFG/yEAmgAz/1cBof7wAdD9vwEW/QYBTf1pAMT9yv8S/mT/1P59/+7/7v/yAFEArgHEACAC9wCSAsUAFwOmAIEDwACdA9YAOAP5AIoC' +
          'bgHoAaYBQwHxAZkArwJCAA4DfADmAsYAdALkALABhQHxAGgCsACrArYAwQK3AAwDnwDGAo0AQwKgAKwCtwBuA7MAjwOvADUD/QCUAi0BrAHcAKcAswCo/+kArf7TAGP+ngAN/7sAYP+/AMv+kwAL/l4AhP0MAFj9' +
          'kf+g/dX+Xv6V/nv/5f+/AHoB0AHrAfkBtgE6AR0ByAAqANgAMP9uAJD+zf8x/rD/Lf7i/47+NQDX/oEABP9bAAv/AQDi/jAAvv6qAMv+0gC3/uwAtv7hAN7+VQC8/sL/1f5+/wP/Pf/m/tb+DP9s/nD/uP1q/+X8' +
          'C//a/MT+Yv1c/gD+Gf6i/nv+0v7y/rr+mf7C/vb98P7S/UL/fv18/1r9dP8D/kT/lv4x/6v+Tv/X/k//WP83/4//Jf9h//L+Bf+d/sj+Of56/o/9xP3J/F/9s/w5/Rj9L/0X/VX9VP28/TH+cv5z/qz+Df7e/tb9' +
          'T/++/VP/2f3K/0/+aQCZ/hQAkf7X/4D+m/9f/hb/Tf4R/zT+Wf+p/fL/Cv2LAAr91gCy/QkB1f4ZATUA4AAyAXQAvQFxAF8CUwDeAo3/7wJy/8QCQQAzArEANgFNAEEAGQCf/4QAJ/9OANP+EwAb/5QAhf8nAUv/' +
          '6gBJ/wkAKQDX/8UArv+aAIn/qgBU/8UA4f5BANz+BgCq/pkAqv7/AGf/kwBsAO7/egBa//P/t/5AAFH+RwBN/oD/7v4G/8f/Zv/s/3//+P/v/mIAH/8zAIn/dP9r/5P/Vv89AHf/IAAHAEsATQD6AMb/0ACW/14A' +
          'tP92AD7/4wAP//MAqv9tAC0ACwBlAND/LgC//+L/EwCf/1YAHP/JAEr/fgEJAKkBiwB9AVQAgQEHACMBoQBaABwBIwAbAWUAGQFDAEkAuP9I/0j/UP8N/5D/xP4BAE7+hgCy/SoAkv26/wT+wv9J/v7/3/4JAOn/' +
          'd/9FAEz/QAB2/14AMP/3/4b/P/8gABD/owAX/8kAt/6+/6T+Hf8X/1n/yP7X/wD+WAAP/rcANf6xAOT9ov8e/jP/6v5g/5P/Cv8pALL+dwCj/kwACv9TACn/SACd/3r/TwDO/nAA9f5DADz/4f9T/woAq//f/ywA' +
          'KP9dAPb+LwDn/s//dP7K/7v+aADc/6AASgAoAIAAJQDE/ycAq/5K/1/+rv7J/Z7+UP5F/l3/Gf6X/zP+nf9O/j///P70/gcAv/7eALv+ggHz/sgB0v6tARX/oQHL/4kBOADtANwAbgCrAaUAlAHBANwAOgBxAHv/' +
          'KQAZ/8T/Uv/w/8b/9gA3AIkByABUAWsBJgHeAREBFAIhAUYC8wBxArsAjwLsAMMC5ADSAqgAwgKyAMwCqwC/AngAqwJ+AKQCuwB1AiIBPgI3AUkCBAFwAjoBVgKaAQEC1QGoAbwBYAH0AQYBLQJ+AHEBZQBTAcAA' +
          'zQG0AIYBdADsAJIAkwDgAFoA6QAOAN8AIgAaAXIAEgG3AKcA3ABTAHkAJwDt//3/0f/P/9H/5P+m/9L/qP8k/4L/0P5O/xv/ZP8o/zv/6f7T/tD+s/7f/sr+3f7u/t3+af8m/+b/ff8HAFr/q/8Q/4//Fv/i/wz/' +
          '2v8L//T/e/8TABsA4f+dANb/5QA0ALUAcgANAFEAfv9hAAP/dAB3/jYAo/61/1v/Vv+7/1D/5P9t/woA5P/q/58ApP8pAZn/dwFw/0UBHP/NADX/lgCU/2IACgBHAKgAxAAOAa8BEAHTAQ8BIgENAbwAvwCJAJsA' +
          '+//0APn/XwG6AMcBOgHHAfcB+QDLAh4A0wJ0/8YBmv5yABv+1/9o/ob/9/7p/yH/oQAc/8MAdv92ABoA0//ZACT/gwGU/p4Bsf49AS3/owCt/9T/PQAY/1wAvP6BAN3+XQAi/9r/1P6c//v9H/9x/X7+bv1R/nf9' +
          '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' +
          '2gDcAdQA6QGPAbIBWgImAZACAQG1AT8BmgFCAQgCdAH0ASgCIwJwAj8CBQKMAa0B/QFFAcYCcwB/Av//ZgLn/7oBaf9ZASD/pgE+/3wBUP91AUUA8gEVArkB1wIhAD4Clv6kAen9IAEu/j8A+P6N/7L/X/+8/3D/' +
          'dv9r/wP/Av/p/p7+MQDj/lEAmP9TAPP/bgGu/yABhP/LAMj/bgDy/wb/5/8N/u3/QP4JAB//JQCT////RQCB/zwBHv9ZAQ//KwFF/1YA3P+E/4kA4P9QAREAZwJaAKkCowDAAe3/RwE2AIABJAGJAbwA0AFHAH8C' +
          'GQAtAuf/vQBUAOD/mQCL/5sAE//0AHP/lgFrAF8CsACnAqkAowLEAJECpQDUAYIAPQGLADYBqgBmAecAOQL8AFADEAGbA2YBOQMuAccCZABmAhkADgIfABwB3v/b/7X/TP+y/5X/Qv8kAOX+SgCX/4cAYwCkABsA' +
          'fQBn//oAw/5YAUz+TgGC/g8B7/6c/9n+ZP7Z/tn+cv+p/wYAQQAwACQABwBL/3z/7/64/jD/6f1L/0P9/v4v/f3+ov27/xv+SQBJ/rj/GP7D/qz9wf6b/Yj/Df5K/z7+Zv6O/gL+ov+e/T4A+/3y/6j+wf+6/lL/' +
          'Xf9c/pwA4v0LAdn9QQCW/fz+wv2M/Yb+qvzU/tn8iP5d/WL+YP66/rz/Kv+QAF//FwGo/1wB//+EAVYA0gEGAfgBfgH1AUMBPgFHAaL/FQKV/pMCTv8DAhYAdwEVAMQBoQARAhIBvwHWAGQBOwAdAfH/gQANAPL/' +
          'WQCF/+QA1v7AAIf+VQD5/g4AXP8cABb/MACk/uv/Ef/y/04AZ/8jARf/FQG2//cAAgByAQEA7QEpAL4BhwA0AVcAvgDI/5cARv/YAKX++ABa/qoA3v6vAPf/FQGaAMwAdQAPAKv/EwDr/s8A+f5NAYD/GQFnAIsA' +
          '0wD4/3YAq/9pAA0AfQBoAGUA3P+IAFv/kQDd/xsAwADJ/0kBpv+NAY7/0QEAAAACQwDPAXsAPwHHAMcAIACeAFj/ZACX/u//v/1//3b9Lv9O/RT/O/0s/8P9Ff99/t3+y/7B/gP/dP5v/zz+h/+x/iD/EP/M/uT+' +
          'Nf78/v79Fv8k/p/+bf2B/qj9Lv90/qv/z/53/zj/Ev+r/ub+Nf7z/or+0v5I/zj+3v/N/dL/EP63/2v+Yf+p/mz/5P7//+/+BQAi/5P/Qv+P/8f+bf/J/q/+rf+z/hkAGP8iADn/dwBO/3wA+f5cAND+mAC+/oAA' +
          'X/7M/4H+5f4b/yL+Tv/e/XX/6P3g/8/9IAC+/WIAA/5sAC7+GgAO/j7/Q/7v/bz+Of0d/yD9uf83/SEAVP3H/6b9a/9y/iT/df9b/vv/uP2W/7n97v4H/k/+kf7K/ev+dv3R/p/9zf4c/u7+w/35/kj9+v5x/fH+' +
          'r/3f/s79mP49/iL+A//Q/UL/qP0j/6r92v7M/Xn+wf1g/mf9fv4u/fX+g/3q//L9LgFJ/qoBTv8tAYIAfwDJAAQAFQHR/+0Bvf8aAhcA0gGBANQBdACsAVAAVQGUAMwAGgHm/2oBXv9TAXz/pwDR/2oAEwAAASIA' +
          'jwFaAEsC9wADA34BOQPJARADLwKkAqACAQLbAjcB2AKPAIgCWAARAnIAzgFHAI0B2/8GAZn/dwAZ/wIAiv6F/8D+AP9r/2L+6v+E/T8AyfwGAJ38bP/W/In/XP0jACD+rwDf/gcBlP/cADcAYACpAOb/lQCu/7v/' +
          'uv8F//H/U//2/+P/6//a/+X/vv+P/xUAgf9zAJL/kwB1/5oAaf+zADn/7gAz//0Ahf+7AAYAaQC/AF8ATQHRAEsBOwFhAT8BbwFjAd4A/QFjAJwCZgDGApAA3wKRADoDxwBcA34BDQNfAq4CpQKDAhUCaQKCAWcC' +
          'RgHHApEBPwP3AWsD6wEsA9EBTwLBASYBUwFzAMUAfgC0APEAcQBoAQIAjwHo/zgB8//jACUA7QCLABEBZwEgAbMBKgFHAWoB+gC/AcUA7gHKAGcCpgA3A0sAxgP5/7sD5f8xAyQAaQJyAI4BogDiAIAAWgAbAKP/' +
          'wP/m/uH/k/5IALb+cQDe/qAAD//AALb/rQBtANcAvQABAdoA8gDNAMEAgwAqAGIAdv+TANv+ggC+/koAeP95ABkAjADk//v/Wf9Z/wL/PP/x/l7/cv9q/9v/e//d/2//LAA0/4cA+f6zANH+jAC1/jIAgv7u/4D+' +
          'tf8N/6T/qf+3//D/a/8nANf+XgAr/3oA//+OAK8AmgB6AXUA0AEWALIBa/86AYf+pADS/VYAj/1iAKD9uADO/eUAN/70AKz+EwHD/hwBx/7vAAD/yQBS/6QAvv9LACwAIQB7ANf/dACy/woARQB7/3UA2v5dAGP+' +
          '2ACH/kUBGf98AWz/4AFj/xUCff/VAcH/fwEfACkB3AB2ALQBpf8UAkv/EAJ4//kB+P/TAVoAzgFHABoCKwA8Ao8A3wENAV8BZAEhAcYBGQHzATABBwKvARgCOQIIAiQCLQLjASwC9QGLAQcC2QDCAWwAVgFBAC4B' +
          'XQA5AcQAHAF3AegA3QHsAK8BOQGUAXoBugFvAakBSQFeASIBUQHuACoBwADcAHUA/QAHAEMBCACIAZoAqQH7AIYBvADDAWkAHQKYANcB5ACWAQYBegF9Ae0AxQFSAAIBCwAoAE0A2P+UADn/dABj/jQA/P2o/3L9' +
          'Uf9v/GL/zvtg/9f7NP8L/LH+gPwW/jT9pP16/X79jP2S/SL+Z/3N/nf9I//A/ZP/oP0BAPb98f/C/qD/0f44/3b+yv7e/uD+lf9X/4D/df8z/3T/Pv+q/4z/n/+b/1n/Kf+G/+T+DADi/isAZP8DACEAFQAmABwA' +
          'm//k/w//4P85/y4A0P9pAAMAfwASAHUAJADL/1QApf76ADH+awGn/mQBIf+AAYT/bAH1/0MBAgAcAef/dgAfAOv/GABp/7r/5/7D/xD/5v9t/8X/1v8CAAkAQwDE/6j/mv83/2L/3v/A/jcACv6b/5H9if+O/ToA' +
          'Nf6FAOH+ogAk/w0Bm/8bAVYA0QDMAAkBwABXAU4ABwGz/9wAmf8kAab/EQEX/7kAIf/MAJ3/SwHY/8sBfAAFAqwAEAIwAAwCAADXASgAfwGBAFAB2gAQAQEBiADvAHMAoADmAEMA6gAzAH8AXQBbAKkAWADFAAIA' +
          'agDD/2kABADMAGAAvACZAKEA4gDQACkBwABFAdIAagFPAacB4QGbARkCDQGnARYALQEj/38Az/6I/9v+Ff+p/tX+Qf6//q79AP/r/P/+XPyz/lH8ev6C/GH+9fzN/uj9q/+J/tn/cP4//7D+b/58/2X94v+l/Mj/' +
          'k/yI/9782/59/cz9J/7k/FP+FPxc/jT7Ov7j+pH9bvtL/QD8x/3/+zv+8vtT/mD8j/4r/fr+8v3S/rf+fv65/zj+VgAD/iUAv/7D/17/S/8Y/8j+B//j/jT/O/9S/+D+bv9c/nf/dP5s/7L+Xv/L/nn/HP+7/2//' +
          'yf9i/2b/N/8I/0b/yP5p/5P+gP+P/sH/pP4gAH7/6f+rABD//wDX/qcATv9PAEr/fAAU/58AOf/VAIT/JQEwABAB/QBlAQoBZQGGAIkAVQCk/4YAzf6fAFr+xQCp/iMBdP9nAaUAZgHbAUAB2wEKAS4BzAA8AKcA' +
          'AP+XAOz+iwBs/58A7//yAHEAYQG+AJ4BQAHQAVABNAJAAYwCoQHfAq4BIANfAewCfwGoAvQBvAI+AqYCUAImAssBqQEBAU4BTwDzAIr/yQBz/8IAwP+EAK//OAD//wIAeACG/60AAv+xABv/MgCX/53/1/8U/87/' +
          '3P6x/wH/xv/l/jwA1f61ABn/zADC/+oAPABWAe7/lwGA/30BVP9EAUH/0QA2/04AU/8gAFr/9v9I/4n/qf9J/ysALf9OAMr+PwBT/h0AKf4dAIT+MwAs/x4Ahv86AI7/JAB6/4P/Lv8b///+1P4N/6X+5v7q/r7+' +
          'Lf/X/i//r/71/kD+xf4b/vr+WP4w/7P+F//L/rX+jP5F/nX+Cf6W/vz9X/4f/qr9Nv4e/Q/+F/3T/Q39h/0H/UP9Z/0+/dj9ef0i/t39S/5b/kD+rv5I/sD+w/4K/43/Wf/2/xz/w/+M/pr//f2t//b9hP+u/k3/' +
          'Zv9r/57/t/9v/w8AS/9CAFn/GABH/+X/6f7v/+f+NwCj/6EAWADUAO0AtgA5AX8AGAFoAAsBuwDvAGUBpAACAiIAbALv/48CbQAsAuoAZAE1AdIAmgHHADwCLgG7Ar0BswLTAV8CQQHmAbwAeAG1AE0BAgFvAYcB' +
          'uwHzAfkBCgKCAjQCPwOcAsED2ALLA9gCMAP8ArECKANGAvECfwF3AhcB8AE1AVQBaQHhAI4BuQCNAboAQAHMAA0BsAA/AUsAQQHh/+cAiP+JAEn/UABy/yMA5P/f/zAAvf+EAKX/AQFL/0QBC/8aASn/tQCm/zwA' +
          'CgCi/zMAF/9lAMH+IgB0/tT/T/5r/3X+5v6L/ir/YP6P/zH+/P8Y/jkAA/7e/yv+cv+Y/iP/3P4i/9/+P//b/gL/4/5t/uv+J/77/gz+BP/E/cP+r/1J/qv9Af6k/cn9Cv5V/bf+D/0D/0H9b/9Y/fH/Kv0QAG79' +
          'BgAu/of/sv5L/8D+n/+c/t3/q/7X/y7/j//m/xH/UgCM/kQAc/4yAKb+ZwAP/10Aaf/+/2z/5P9//+3/qv+0/6f/V/+T/+/+rf+l/ov/tP4w//L+Ff9A/0v/uv9//yMArP9WAGAAsgD6ADEBAgFKAeIANgGRAJAB' +
          'awDrAbcA0wEFAcYBNQEoAl0B0gIXAUkDpQA9A54AKQP9ADEDlwEDA+4B7gLaAecCmQGnAmYBcgJUAR8CDAFfAckAoADhAIMADAH/ABcBhQFDAeoBrwFNAuoBlAILAsYCTwL6AnoC8QJxAtoCTwIpAy4CdwOTAQkD' +
          'BwENAg8BMAHoAH8AuQCw/zoAIv+W//z+9//r/ukAKv+NAZ3/1wHc/+4BQQCyAa4AYAFvAB0B/v+TAFUABQAJAcv/dAHY/+UB1v8AAuT/WgE2AAwBawA/AWQAxAAvAAcAFQAJAGIAQQCcAD4AeQA4AEcARwAGAJAA' +
          '+v8GAWQAVQGzADoB3ADsAAkB9AAIASABDwHxAAwBwADwABAB9gCDAeIAfQHmACcBFAG1ANQAKgAgABUAzf9tACAAkQBKAKkAUQDcADsA0gC4/5AAnP9VAAQAKwA7ADgANQByAC8AawBUAO7/ngBE/+0A7v7/ANn+' +
          'tADU/o4ABv+OAOD+SgBJ/qD/Iv7f/kr+yP51/hL/9/5j/5r/2v/v/xcA6P8WAMv//v/l/7r/cQBR/ygBLf9NAWz/AAHK/8IA7/9WAPL/qf8IAED/AwA8/zEAVP9HAHv/GQCT//f/jf/z/7r/FwARABIAUQAIAKYA' +
          '0v82AXf/cQEo/9UAwP7z/6/+Vf9Y/9b+EwCG/vr/jP6M/5v+cv93/o//Nv60//T9/P+8/TsAvP0HAAz+xP+D/rf/+P7s/3//IQAHAFAAHgCsAPP/6gAfAC4BUAApATIA6AAWALgABwBGAOz/pP/9/xL/NwDM/n0A' +
          'yf7NAOb+9wD7/vQA7/7kABv/vQDl/7IAlADOALYAmwDsABQA2ACC/2kAyf4YABn+6/8j/sz/pP6w/9v+nv8i/3D/gf9r/17/R//1/gf/t/4f/+P+Vf9t/wEAzv+LAMr/fACD/1YAD/+u/9X+5f4o/67+wP+b/kAA' +
          'lP44AKP+nP+w/iz/zP4p//f+Rv9O/4X/dv+y/zH/o//3/qj/Bv/J/3n/0v8KAM//VwDv/2UA+/8iAMb/uv+2/5v/5f/O/zAAXgBLAEUBAgDXARkAsgGUAH0BnAByAcsAIAFoAQgBewEqATgB4gAxAbgAEAHEANUA' +
          'fADkACMAEgHy/wIB9v/KADAArQBgAGQAYACN//b/4f6W/9f+aP/k/jv/P/9k//3/ZP9wAGT/vQCM/yQBWP9EASj/BwEu/5EAZ/8HAMr/x/8qAMT/owCc/+cAc//AAH3/bwBN/9T/3/5k/8X+LP8F/8r+O/+4/lv/' +
          't/5G/8b+7/4X/7/+gv+8/gMAfv4DAAb+VP+m/Zr+sv1v/iP+vP56/hP/wP4f/1j/8f7Y/4v+z/8Q/qP/7v3D/zD+xf+j/pD//P6y/1z/1P+V/5//lP9z/5H/af+u/yP/HgD6/ngAav/SAMb/AgG4/9kA1P+mAPD/' +
          'YQCg/0IAcP9AAM7/CwA3ANH/VgDo/0gAyf/1/5v/gf/1/0f/MABP//D/l//I/9v/wv/g/0T/7v/4/jIAQv9EAJz/FQDw//H/HwDn/0wAEAB5ACkAZAD1/yoAAQAdAHcA9P+xAKr/cwCC/y4AR/8jAA3/CwDw/gMA' +
          'Fv8uAFn/GwDA//v/OwAVAEgA6v8kAH//KABq/2kApP+4ANP/NAEDAJ4BQwCZAaEAwQE0AeABrQGbAegBSAEVAjUBTQJmAX4CtgFZAucBCAK4AQQCVwEBAgQBuQEKAY0BJgFyASIB3gAxARIAKAGX/w8BWf/cAEj/' +
          'tgA+/4YAIP/8/0r/sf+k//L/8f8VAEsAGACVABUAuQCn/50AfP9VANT/LAA5AAgAiwCt/4UAHP9tAIX+YgAR/gQAnP1y/xD91f6d/Bv+M/yf/b77l/3S+6X9o/zL/Xj9aP7u/c/+IP6z/hb+3/4A/vP+Nv6v/qT+' +
          'Sf7B/r39hf5s/WT+iv1J/tr9C/7O/fH9qf0I/hb+Iv7F/h3+Gf/6/Uj/Av5r/5b+Rf+E/zz/MwA3/6IAD/8wAfv+sAE7/+QBLQAQAgABOgL+AEgCqwBfAl0AGAJTAGkBYwDjAAIAkgC+/0QAFQAbANoANwC3AYIA' +
          'BgLkANgBBgG1AbMA0QF4APYBzACcAVUB+wCRAcgAcgHcAGcBXwHHAVgCXQIFA6gCfQOWAqIDZAIpAwgCcQLrAeYBIgICAu0BMQJoARUCUQHaAVEBNQH9AMQAGAGsAIIBNgCTAaH/hgGP/2ABjv8BAX3/yADc//IA' +
          'IAAvAV8AQAGrAC8BoAAjATkAAwFX/6IAzv4nACr/CgCg/4QAwP8tASQApQGIAMIB2QDUAVABVAKAAZ4C/wGFAk8CuQL0AaQC4AENAu0B5wFMAfYBqQCBAZYApwAxAKz/t/+4/i3/NP6X/ln+Tf6q/vT9uP5H/vL+' +
          'Kf+//4T/lQC6/8cA+P+BANz/hgDE/7oAhf+nADP/kwAs/zEAjf9U/0MA1P6eAMP+vQBd/rkAxP2RAMT99v88/lP/c/6Y/4P+xv+1/tr/mf7s/wz+ZP/+/a/+fv6Q/kr+K//Y/Vz/Lv4P/9n90f5s/D/+HfyB/bn8' +
          '/fxS/Hz8s/tF/K37ifxb++X8LPt6/Tb88v3S/VX+vv7j/l//4/7CACz+AgKY/O0ByfpFAaz6hADz+0v/Bf0d/n/+Qv0KAIT8NP8f/CP9E/wu/Wz8D/78/Lz9CP0V/sT8bP8w/W0Ab/6GAB4Ahv/cAfr+kgLQ/2wC' +
          'QAHfAh4CDwMqArUB/QCUAHD/9ADt/xMBAwEMADABX//eAPj/AAHjAEECOwGEAjABlQEcARQBlwF6AKcC+v+pAgYBhgHsAYEBUgF9AhEBzwJaAXMCYgF/AUUBjABUAagAnwDaAK7/KgBsAMv/rAGrAGMCigErA3IB' +
          '+wNXAXcDdgGKAUcBHwA+AX//YgE1/+4AUP8VAC8ACACEAYIAxgEPAE0BSP+/AJL/Xv8qAEz+NwDB/o4Ayv9ZAdv/iwGS/kwBo/01ARf+2wD8/lYACQDUAFEBWQKiAcEC1AAXAa0AqP85AT0AtwA7Ad7/6wC0/w4A' +
          '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' +
          'vwBi/00By/55AXz+MQG8/pgAU/8RAJj/M/+M/xT+2P+i/XIAhP6NADX/cwCD/2EAvP+Z/7v/OP/j/9L/CQDc/6AAR//CANr+5f9g/mn/gP2O/7D8Zf+r/NP+KP2X/mT9av6X/eD98v1d/UT+Iv2d/g39DP+O/Yn/' +
          'bP5L/0v/a/5VAE7+tgDl/ocAPP9oAD//QABL/+P/gv/4/hUAbP0NAdr7VwG5+isA6frI/tv8+P1K/hT9bv7f+6D+Dvub/hX7Ev4v+2/9Rfv+/Or7xfyo/P38E/25/bT95/10/oP9mv6W/Yj+mv3N/hL+hv9V/7v/' +
          '2/89/wUAhv8wAOj/6P9i/6z/DP+0/2P/V/8IAOL+rgAw/yUBs/99AUkAYAGZAAgB+ABiAUYBEQK8AAECtgB/ARMBsAHSAWUCCwPwAhoEQgPDBFcDZQQyA6oDHgMPA+wC0QIQAtwCqQEDA3wCLgMVAwUD2AK7Al4C' +
          'OwJfAuYBKgPgAaQDFgJYA1oCBwNyAqUCrQIvAg4D7AFoA5YBrQP9AHkDvAA4AgsB8wDEAHoAtv9kAHT/sgBGAPQAlQDFAFAAJwB7ADf/+QBa/8ABDQCpAkMAAQMPAR8CTgG2AN4AXQDp/wwAgP4Y/+n9FP/M/VL/' +
          'TP5x/u/+Wv2Z/wz99/9z/WT/qP5S/pgAzv2NAUb+CwGL/scADf+mAFv/s//r/rz+T/5//vj9Yv5k/sr9Jf/9/GH/2/zH/o395/7q/WD/0f2T/yr+8/+9/uD/Sv/4//f/CwBPAAQAIwBZAFcApgDEAO4ALwDMAHb/' +
          'YgBI/3kA0v5yAL/+UgBt/+wALgAOAcgANgDqAJ//iAA1/9L/rP9w/9YA8P91AVsAcQJOAGUCggAAAd0AWADeAFYApQBAAOkALQB+AT8APwEmAHAALQDZ/ygA2/5yAJf9sQDq/LIAu/yfABH9FAC4/cv/C/74/u/9' +
          'Pv7Z/QL+Xv7w/Tr/Av70/2H9dQDm/JoAHP1qALX93//U/Vj/VP4C/y//ov4K/7z+4v4P/2X/Wv/D/+//X/8bAFn/uP9y/0r/3P5Q/xj+/f8k/qMAJ//7AP7/xgCQACMAjQANAKz/XwDt/mAA1/4aAMb+zf/Y/m3/' +
          'Gf9B/zL/ov/A/3EAtADmAXEB2gLIAUICZwHLAaIA4wGnANoB2wABAiIBIwKdASgCzwHqAQMCRQH9AdwAuALEADkD6AD1AmEB4AKjAWECIQE5AlgAEAIqAEUCdADtAs4AwAJvAQwC6QH/ALgBYACaAQoApQH0/wUB' +
          'JwAyAC0AUP/nAE7+lAEH/owBHf7bADj+ov+S/uz+1v6u/mX/zv76/zD/4/89/+D/Gf84ACX/cQCJ/48AAgDoAN//WwFX/wIB9v7//6n+f//9/nH/lP8z/5r/3v53/4b+9v4u/qb+E/5E/+v9v/9p/db/H/2i/2z9' +
          'PP/C/Vz/sv1j/8T90/5D/kr+yf71/RH/U/0B/0797P4m/g3/KP5T/+n9uv/j/Xn/Z/62/if/bf5b/wb+Vf9C/cP+Of1k/jv+CP4k/0f+Mf/J/nn/Sv9iAGEAJQEhANsB0f+tAtX/IgM1AM0C+QAoApABggFYAnMA' +
          'NALL/zACMAClAuUAvAJ3AbkBFQLIAN4C5gD8AugAigL9AOwCtACMA9EAfgNUAfwCFwI4An4DxgEiBJoBCARbAZADTwE8A3gBJwPHAbcCGgJCAkwCuwFwAm8BkAKgAbICzwGSAu0BPwKvARgCVQG+AdsAEgETAYQA' +
          'hQEoAOMADgD9AE4A9wByAF8ABADH/5L/4f7e/4L+aQBY/jQAff5s/9v+zv5Y/6r+3//n/jYA/P5/AOD+YQAr/wL/fP9L/SD/yPyd/u38qP50/en+5/3y/nH+vf5j/kH++/0S/kX+iP56/pj+Av/A/Qn/sfyZ/kb8' +
          'Qf6+/PD9Uf3G/bX9Ev2Q/nn87P9b/NYAi/yAACn9jP8s/jj/xf6X/8/+yv/D/ib/AP9+/qP/2P7b/y//DQCr/mUAPf6wAID+EAFH/zIBXgBJARABSwHVAGIBngDMASAB6gF9AZ0BawErAUkBxwAEAWIA+wCQ/wMB' +
          'eP+7ADAA8AACAGYBxv/+AMr/RACy/zYAFQBbADoAFwALANX/AACI/y4A7v6EAKn+8QCn/jMBhf4xAab+GwEE/5kAQv9JAHX/4f8cAHb/DAG2/0gBXv/QANv+fADK/n8A2/48ABX/Xv8i/7P+5P6f/un+sP41/xT/' +
          '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' +
          'dgCA/pUA6P12ANv9nv8I/vr+AP6T/gr+G/5m/on9Zv6u/UH+M/7O/rz+v//D/hkADf4HALj+JQDe/v3/hv5t/0//TP8g/+3/c/5uAHX+xgAy/1YBGQBcAQkB4QCfAdEA1wEcAe4BCwFqAewAvgA6AYUAPQEYAckA' +
          'QwGRAFcBpgBpAXAAwQAoAPcAigDkACwBagBzAdMAqAG1APYBowC0AUIB9AB2AasAAwEVAa8AZQG6ABUBzQDPAB0B7AD1APoA5gCLAKIBBgDjAe//2QHC/yIC6f8pAowAtwGAAEgByP9sAEb/gf8z/5f/N//J/67/' +
          'Mv9tAOT+rgBx/9gA0f87AdL/fAGd/2UBvP9JAUcAbAFzAFABYACuAGAATwAvAIIAAwCiAMsA2ABrATwBIgGIAVgBmgHUATIBrAG8APAAUACx/+v/7P7s/x7/6f8Y/2r/Ff9y/k//zf1o//79Wf9X/gL/sP5i//P+' +
          '8P/B/uv/p/5JAMX+uwDq/qAAhf+QAGAAsgCVACEAIQCX/+3/Sf8qALz+dwAF/wEBnv+WARgAlwEKAFgBZf8ZAZn/wwD0/88AHgAuAe0AGgGfAZ0A1AFbAB4CEQDeAbP/zgHj/x4CWwCMAaQAKQHEAEABsgBlAS0A' +
          'dgHg/zgBbADcABABegBBAQsAAAEgAGwA0ACq/xQBM/9GAVz/eQHc/7wBXwD9AZgARAHmAE4AIwHs//oAx/9eAcv/UgIDAPkCUABUA7wAhwMyAQwDsgEvAuMB7wG0AegBeQGEAX8BcwHBAbsBKQKpAV8CXAHLAeYA' +
          'kgFeAFABAACPAJf/jQA0/+sAEP8gAZX/9gCTAGEATQHP/7oBq/+/Ab//cgEFACIBcACmAFYAXgDZ/5EASgD1ADYBGwGAAcUA6gGIAA4CmQC8AWkATQETAMcALwC1ADgABQHN/yQB4v/AABUAgACk/4YAWP/6/47/' +
          'Tv/9/2j/cABB/7cAmf/jAK4AxgCUAE0AlQBXAO8AsgCWAJsAdgC1AGwA+gDy/3IAAwCI/4IAkP/HAM7/5wBn/6IAYP95AA8AUQBPAMH/5v9n/wAAjv/n/3gALf9HASH/7ABm/6UAfv+pAJr//f++/3f/0P/f/7T/' +
          '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' +
          'pP/x/jT/z/76/iP/lf58/6f+1/83/z0AGP9wAPL+iwBG/48AdP8qAHH/m/9G/0H/U/8j/3X/LP9o/yz/o/8M/zYAHv9bAKj/jQDy//sAwf+mAPb/SAA/AAQADABw/xkAGv9JADD/+/9C/9L/Z//u/yQArv+dAG//' +
          'cQC5//X/GACB/zEAhP9sAJD/yADu/80AfQB4ACEASQCi/3QABQCSAKIASADMAP7/jAD6/2kAxv8gAL3/gf8EAEb/DgBV/wcAK//f/5X+e/9k/ln/yv6c/w//uv+c/9P/RAAmALcA2P/kAAn/fADF/gsAv/5NAIH+' +
          '+QC//hYBYf+uALn/TADv/+3/BgBc/93/7f6y/+H++v8X/4YAiP+nANz/qgA8AAUBPwANAZ7/egCp/z0AYgBxALAAXQDHAD8AvwBlADcALADQ/4z/hP9h/zL/sP9I/87/Sv+h/0D/sv8U/+f/pf7X/5f+8P+9/kEA' +
          'u/49ACH/AgDz/+j/NwCb/1gAKf/SACv/vACY/1cA8P8wAOj/TgCw/4wAev9yAF7/dQBe/6kAf/9oAOT/6P9IAM7/iAAEAPwAWgBLAZgAAAGRAMoA9gDPAGcBfgBYATYA/QBDAKcAWgCvAEUAhgDv/2MAaP+HADn/' +
          'ZQCY/8D/zv8O/5v/7P5l/zL/cP99/7n/cv/f/3T/uf+o/8z/rf9dAJn/yQCa//IANgBCARQBwAEyATQCBQE+AlQB7gFQAZsBnQBtAawAZAFHARYB3wBcAAEA4/+t/+j/6f/P/yoAcv8JAET/tf9H/wz/FP9U/gX/' +
          'Nv5u//T+r//i/7b/QwAjAD0AogA8AIQAdQBQAHYApQCAAOIAtgCNAPAAQgA1AVMARwFQACYBIADoAC8AwABhAGQAJAAYAOL/SgD9/5cA7v+2APH/2gB/AAwBCAHnABcBuADKAHMAewA0AFMApAA+ADwBbgBAAcUA' +
          'BwG/ANAAewArAGcAmf9oAKD/PwDv/0kAKACwAFkAswCEACAAagCI/xkAKf+h/yX/ff9j/5j/if/L/8z/lQAiAFMBKwBSAR8AJgEfAOkAEwBHACwADABMAFAADwCAALH/3gCz/xoBBADJAFMAQACkAPv/AQFjADoB' +
          '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' +
          'fQDd/74A6f/UANv/CAGo/xQBsP/BAOX/fQDl/2kAz/8qAOX/7//l/wMA6f8mACwACQBcAOr/SAA2AEIAmgBmAKQAjQCXAKoAgQC9AGIAvwB3AKsAmQBuAI0A9/9hAJX/fQCU/9QAuv/mAOj/2wARAO4A+P/bANT/' +
          'xwD+/9QAOwDhAF0A5wBsAJAAfAA9ALAAPADfAC8A4QBBANYAjQDBAMsAjQC3AF4AcQBYAGcAgQCqALMAyQC2AJ0AgQBNACkA/P/d//D/s/8eALn/PgDx/xcAJwDN/0kAnP9nAK3/awAjAFEAoABoAM4ApgC/ALoA' +
          'jgC9AG8AqgBvAGEAaAAtAH8AMQCOAAMAYwDC/08A6f9iADMAkQA0ANQAFADUABkAoQA2AJ8AXwCdAKEAnwDgAJwA3gByAKUAUwCDADkAbABiAEUAoABCAHkAXgAdAE8Azv8ZAI//BQB2/xIAef8yAIP/fACt/5IA' +
          'wv89AM3/EgAPAEEAfgBUAMQAXQCzALEAdwAAAToA5gAlAM4AJADhAD8AuwBuAHgAlABVAMkANQA2AQAAoAHr/6AB/f96AfP/ZwHY/z8B6P8pASAAZAE1AIYBPwBlAXsAKAGnANoArwCkANYAggDsAIYAtwCDAJMA' +
          'lQCcANkAgwDqAFQAoABIAEwAWAA/ADoAMgDl//T/p//Q/5r/8v+s/+z/yf/p/9j/RgDd/04A9/8dACMAVAAkALIADQDCACgAkgBVAFUATwAHADYA5P87AAYAHwAzANT/eQCx/8QAu/+/AM//TgDS/9v/v//Z/87/' +
          'AAANABQAVAAmAJwAKwCzABgAnADs/5wAsv+BAG7/PQA8/xoAKv/2/1D/k/+m/1H/3v97/9n/qP++/5P/4f+P/0oAwP+XAOn/qgDu/7wAzf+YALj/VAD8/08AXQA7AHkAGQB+ACcApAA6AMAARQCHAGgAEQCPAMX/' +
          'ZwCx//j/ov/Y/4f/2P9c/5f/O/+W/zT/xP8N/6T/0P6D/+D+kP8S/5P/F/+Q/y7/h/9a/1z/UP9O/0H/df9m/47/X/+K/zz/cf9o/13/of9p/6f/ff/D/5f//v+y//z/mP/5/1H/KgAv/xIAT//X/3b/9/9P/zIA' +
          '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' +
          'Qf/f/0j/qP9F/4X/LP+A/zX/ff8w/2//Ff9R/yn/MP86/yr/Rf9B/2D/Zf9f/4H/YP+M/2r/i/9n/47/YP+N/2f/jv99/63/nf/U/7j/1v/I/7T/5f+H/9v/a/+x/3b/rv+U/7b/qv+7/7v/rf/J/47/yP+B/7b/' +
          'd/+9/3z/6f++/w8A+v8bAO3/GQDh/xoA4v8QANX/AQCy////i//w/3X/wv9A/6H/NP+M/4X/a//C/2f/zv+P/7r/uv+A/93/Qv/3/yv/6P9E/8T/a//T/3z/9v+I//T/nf/q/6X/3v+v/7H/tv93/7X/XP+y/1P/' +
          'tP9J/9L/Pv/W/zr/s/9D/5b/X/9o/4//Mv/E/yv/7v8s//z/IP/5/yr/BQAk/yUAH/9GAD7/UQBa/0gAcf8oAJz/BQC1//b/lP/k/4f/v/+f/5r/vv+K/+T/fP/4/3D/9P9u/9r/bP/N/2v/1v+C/9n/sf/U/+H/' +
          'l/8GAE//IABE/y8ASf8tAGb/IwCb/xMArf8DAKn/+v+n/+X/nv/L/7r/xf/d/9P/9P/k/x4A5v8QANv/3v/E/7n/t/+O/87/jv/z/7j/FgDO/zwAyP9QAMH/QwDD/zAAzP8bAL3/AQCt//D/1//m/wcA0/8qAMr/' +
          'WQDb/2IA4v9MAND/SQDF/0AA0f8rAOH/JgDj/y8A6P8tAPP/JgD6/x0AAADo/xAAwf8rAOP/QAAIAFQAGQBlAEEAVABiADEAYwAnAFsANABKAEUAUQBaAGoAagBrAHkAbACNAHoAiAB7AGsAgABhAJQAaQCaAHUA' +
          'lQCLAJMAlAC4AIsA7gCXAOAApACzAJAAkwB9AHMAgwBxAIcAkQB/AKgAfgCrAIoAnACMAHQAhABeAI4AWACqAEcAzABKAOsAfAD8AKYA6wC9AL0A/ACYABkBiwAMAYEAIQF1AC4BeAApAYMAKwGQABMBpADNALAA' +
          'mQCwAHsAtgBiALIAawCUAGEAfQBHAHAAPABoACkAdgAfAIQAKAB/ACgAdgATAHUAFwBwADoAaQBVAGEAdQBEAKEAGQCfAPH/egDJ/5EAqf+nALz/kgDy/4sAGQB2AD4AYQBiAFQAbAA+AG8APQCJAEQAmwA2AIwA' +
          'NgB9AFMAdgBjAGUAewBCAI8AIgCSAB8AogAxALkARQDAAEcAwgA6ANQAMQDkADAA9gArAPEAJQDdAC0AwABDAHsAPwBWABYASgD3/0sAAgB2AB0AlwAsAKoAOwCtAFEAfQBcAGUAVwB4AFQAjQBWAJgATACPADcA' +
          'iwAvAI8AMwCjACcAwQARALUABACPAPv/gAD4/3QABwBuADEAiQBwAJMAswCKANYAjwC3AJQAgwCtAFoA1QArAN0ACwDkAB8A7QBIANAAZADBAHgAwwB5AKQAcQCIAHYAigCDAIUAjQB9AJcAiACiAIIArQBTALkA' +
          'KACyAC8AoQBbAKIAiQCcAKsAgADBAGsAxgBqAM4AYwDkAEsA/QA3AA0BOAAIAUEA/wBAAOcAPQC2ADYAkgApAJ8AKAC1ADcAmQBKAH4AXACNAHgAnACNAKoAhADRAHYAwQB8AHwAfgBPAF4AOAA/ADcASABJAEsA' +
          'awA0AHMALABaACAASgAOACQAIwDm/1AA1f9mAPL/agDi/28AzP9aANv/LQDm/woA8P/6//z/8f8mAOr/QwDh/zMA2P81ANb/RQDf/1MA4/9QAMz/QQC//yoA3f8UAAAAGAAMABAAGAAVACoAKgAgAAQA///R/+j/' +
          'w//q/6T/6f+D/87/kv+q/7H/i/++/3T/xP9n/8X/Y/+a/1z/cP9Y/3P/c/90/53/fv+4/6T/zP+3/9z/mP/1/3f/EACB/w0Ak//x/6j/0//i/7f/JQCX/zYAg/8PAIz/5v+z/8v/3P+3/97/yv/J////zf8iAN7/' +
          'IADq//f///+1/xsAj/8kAIz/EQCo/+//yP/K/+L/tP8AAK7//f+u//v/vv8VANT/HQDY/w4A1P8KANj/9f/b/9H/2v/G/97/sP/t/5z//f+c/wMAnP///6j/8v/K/8//6P+e/+D/hP/D/4D/l/98/3j/hv9Y/5r/' +
          'P/+a/2X/jP+V/4b/nP+M/6z/nP+5/6//mP+7/3X/t/9m/6z/bf+j/2v/iv9a/3n/X/+R/1P/t/9Z/9P/jv/s/6//+f+y/+j/oP/I/3T/sv9K/6P/TP+R/2H/jf9r/5n/ev+h/3z/oP93/6j/dP+9/3r/vP+a/7P/' +
          'sf/J/6v/2f+L/83/a//P/2D/1f9T/7//Sv+5/1f/4v9O/+7/Nv/G/07/of9s/37/gv9X/53/T/+h/1b/lv9G/3z/P/9p/1z/Vf97/1j/ff9v/4H/b/+n/4H/w/+E/8P/bP/I/1H/3P89//P/Mv8BACP/+v82/9//' +
          'TP/K/2L/wv+I/7P/mf+i/6D/mP+Z/47/n/+B/7f/cP/H/3H/x/98/7r/f/+x/4v/ov+j/5L/tv+A/7//bv++/1r/qf9R/4T/Vf9n/2n/X/+d/2j/n/95/3v/g/90/4L/cP95/1//bP9e/2b/Wf96/zj/kf8T/4//' +
          '6/6A/9T+aP/J/kv/x/47/+L+Of8H/zP/Mv82/1D/RP9j/0X/d/9Q/4j/Zv+I/2f/fv9e/3//Y/+B/3X/iv+O/4L/sf9r/8n/cf/X/2H/5P86/97/Of+6/1T/mv9m/5H/hP+M/63/j//C/5z/zv+c/7//g/+f/33/' +
          'l/+k/5j/x/+N/9n/if///5X/JwCB/yMAZv8DAG7/9P91/9z/hv+1/53/qf+Z/6f/lv+S/5v/hP+S/4L/ov95/8v/cv/Y/4X/2P+W/7//hP+e/3T/p/98/7H/fP/F/3H/7v9///f/mv/f/6b/vv+5/5//2v+H//b/' +
          'ef8bAHH/WwB5/5MAjf+VAKj/dgDD/1UAxv8yAMf/FAC9/wQAtv8FAND/CwDd/wkA1v/3/8b/3P+0/9D/q//i/6b/9/+l/+3/wP/c/9v/4v/O/+b/y//d/+D/4v/e/+r/3f/d/9n/1v++//H/mP8TAH7/KwCa/0EA' +
          '1v9DACwAIABgAPT/VQDu/zMA+f8JAPP/7//0/+P/AwDz/w8ADgAYAC0AJgBPAC4AXAApAGEAMwBXAFMANQBoACQAegBFAJUAZACWAJwAfgDOAGMAyABGALsANwCXAD4AeQBOAGQAVABQAE0AXQBGAGwAOgBfAB4A' +
          'RQAHADIADgAUADAAGQBTAC8AYgAnAFsAHwBQABMASQASAEIAKQBPAEkAagBfAIQAUgCXAFoAhwB5AFYAfQAyAJYAJACrABMAmQATAJEAIQB7ACkAWQA5AEAATQAlAGkAIACLADYAlwBkAJIAngCLALgAcQCiAE0A' +
          'iABLAIsAXQCWAGIAmwBfALMAUgC3ADIAjQAVAJIAFAChABEAkQAJAJQAFwCIAB0AWQAUADAAHwAkAC0AFgAmACgALgBkAEcAeQBUAHwAWwB/AGoAeQB+AIgAlgCuAKAAvgCNALcAhQCxAIYAlgB2AHsAcQBoAIwA' +
          'RQCkAEAApQBhAJgAegB9AIoAWACHAD4ASwA+AA8APQD7/zoA1v9UAOD/cQALAH0AEQCBACgAewBoAGkAqwBHAMcAKgDfAB8A0QAnAJQARQB8AGcAiwB4AKoAeQC+AHgAuABmAJUAQgB6ACEAbAANAGwABwCAAAwA' +
          'dQAWAG4ADgBoAAYAWwAfAFkASwBJAHUAJACcAAcAowAFAIUAGQBnADoAPQBRAAEAZQDi/2wA4P91ANb/fgDR/3EA0/9pAMT/ZADH/1kA3v88AOH/JgDY/w8A1//w/8v/3f+8/93/z//y/+z/BwD//yYACAA5AAwA' +
          'KgAUABgAIwAJAEcAFABvADIAfgBNAGoAVAA2AFYA+/9qAN3/hQDp/6EACAClACYAhQA3AF4AKABFAAwAPAD6/04A9P9hAP7/XgAbAE8AOwA/AEgAVgBLAHAAPQCKACAAmQARAIwAEgCUACcAmABcAIkAkgBuALcA' +
          'VgDWAE0A5ABEAOUAQwDaAEEAqgA5AGcANQBCADgAMwBKACgAKAAuAAQAOwA+AEAADQBJABEAWwCVAGoAgwCKAL4AtwAiAbwADwG0AOoAqQC5AFwAugAYAHMALQAlABgARADv/9L/MwBU/2sAtP89AIf/LwA0/zQA' +
          '2P/Q/wgAlv8tANr/XQDi/x4A1f8PABIAlv8QAI3/uf+8/6X/fP+0/7z/eP+n/4H/cP/1/9L/FgAbACMAbACJAPoAqwDkAIIAWQCeAO7/xgA8/60A+P6rAEz/wQDW/3UATgDM/5QAQ//dAPj+jACn/m4Am/5uABf/' +
          'AQCA/8v/qf+l/8z/tP+f/6H/SP+p/2n/qP/q/1L/MQCc/14A/P+jAB4AsQBRAHoALAAmAMz/9f+O/xAAO/9DAEz/cAC7/5gAp/9+APb/MwBAAPj/t/+Q/5j/Af/V/8T+df/R/mD/z/4JAMD+/f/B/vD/u/4oAMv+' +
          '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' +
          'lf9z/47/kP+a/6b/r/+7/6j/0v/T/+3//v8LAP//KwAIAEIAHQA6AB4AIAAKAAQA///h/+v/0//p/+T/+//x/wYABwAOADQABQBCABgAMAAMADAA7P85AAYAPAAcAEAAQABNAFgAQwBUABMATwDt/yEA2f/8/7n/' +
          '6f+s/9v/vP/x/8z/FADv/x4AMAAaAHAAJACbAB8AwgAdAPgANAAVAT8ADAFUAAIBWwDqADQAuAAgAJIAFQB2ACIAUwBmAEEAlwA5AKQAIQClAAYAjAD1/0wA8v8pAAQALgAdAEEALQBmAD4AfQBHAIAALwBiAAEA' +
          'PQDh/xcA3//y/97/3P/b/97/3/8OANj/EgDd/yMA+f9NAAgARwAOAFMAIABaACYAXwAJAF8A6/9zAOr/jgDy/34A/v9sABwAMQAlAPj/HADK/zQApv9eAML/YwDa/0sA6/8/APn/LQAQACAAKAA2AEcAWACHAHsA' +
          'qQCZALUArgC8AMEAngDPAHcA3wB1AOcAggDOAIAAoACYAHIArABHAJkAJQCXABQAqAAVAKQAKACWAC0AmAAcAJwAJwCtAE4AswBmALEAfQDAAKUAtACxALcApQDEAK4AkwCnAHYAgwBsAHAAPgBgABcAMQD5/wUA' +
          '3f/w/8P/3v+n/9T/vf/b/9z/5v/h/+r//f/l//f/yv/F/7b/q//E/5//3f+f//P/tP8LAMr/IwDS/zcAz/9QAMf/dQDX/4sA+f+DACwAcwBtAGYAkABSAJ0ARgCVAFYAiABiAIEAcQCSAJUAzACXAPkAeQDwAHAA' +
          'zwBtALIASQBsACEAPgAaAEYAGAAhABYA+/8nAPL/QQDt/1UA4/9kAOj/bAD4/1cA7v8mAP7/BQAkAAAARADy/2cA3P+LANn/pADY/5IAwP95ALD/ZACm/z8Ah/8uAG//LwBx/zIAbf8UAGH/4f9r/8f/fv+c/37/' +
          'dP95/3r/hv+N/5r/vf+o/+f/uP/i/8r/0f/i/77/BADJ/yMA3P80ANv/OADi/zgAz/8pAK////+a/9P/hf+w/5H/mv+U/53/fv+n/4b/o/+Q/5z/r/+d//f/pf8gAKz/NgCz/0gAyP9aAO3/hgACAJUA9v+JAOj/' +
          'ggDb/2oA1/9PAP7/MwAuABMAQwD7/1AA8P9GAAMAGAAGAO7//v/r/xEA/f8TAAcACQAOABAAEwAkAAQAQAAAAEEAIAAnADcACAA/AO3/XQD4/30AGQCOACMAngAcALAABgCyAP//nQAKAIkADwB5ACEAXgAvADwA' +
          'IQAgADMAAwBWAOP/ZwDV/5wA3P+4AOX/sgD5/7gAHgCTADoAgABBAGUAQQA0ADwAOwA7AD0ARwA+AGQAUQB6ADwAcwAQAGEA6v9CAMP/FQCi//D/dv/O/2H/pP9z/5L/ff+f/7T/pv/q/6b/4P+4/9v/zP/Q/8z/' +
          'u//X/57//f98/wgAjf/6/5z/9P+K/9r/mf+t/8D/nf/r/6r/JgC2/xsAvv/R/8P/vv+//9D/wP/O/+3/x/83AJ7/YQBg/2cAVP9XAGX/HABi/77/Wv92/5L/Xv/t/1r/IgBc/zgASP85ACj/NwA4/xYAaP/G/4b/' +
          'jv+n/3j/3/+I/xMAx/8wANv/IwDG/9//0f+Z/8//dv/E/1T/tf8+/67/av/U/7n/0P/p/8b/DgDa/zEA2v82AAUANAA6ACUAYADz/60A4P/SAA0AsAAvAG4AIAALAAsArv/5/4P/2f+B/8f/cP/i/33/BADP/yEA' +
          '/v9MACMAWwBOADsARAAuAEMARQBbAEQAUwApACgAOgADAGgA1v9pAKj/SgCu/z0A4/82AB8AKABFABsAXgASAF4AGQBOAEQASABmAE0ARgBhABAAWgAKAEkAIQA+ACAAGQAWACAAJQBEACwALQARABMAAAAIAAwA' +
          '8v8eAOD/LADO/y0ApP8VAH3/4/93/6b/Yv9z/3L/TP+1/0H/2f9r/xEAmv9BAJ3/PQCb/zcAu/8dAPP/9P87AL3/gwCY/64Amf+vAJT/hwCN/0EAaP/g/0D/dP9C/yD/N//h/jb/m/5U/3L+gP+X/tD/3/4JAA7/' +
          'AgAx/wwAWv8AAH//yf+u/7j/5P+X//X/cf/y/4n/BQCQ/wMAdP++/2X/bf9b/0H/bf8j/5//Ff+w/x7/r/8Z/5z/Df96/xv/fP8u/3n/PP+K/2D/pv+p/6P/8f+s/xcAvv8wAM7/TwC//1UAoP8wAK//AgDG/+D/' +
          '3//J/xkAt/8hAKf/BACj/xUAuv8HAOH/6P/s////6P8yABoAaAB5AJAAyQCmAP0ApwAdAZwAHAGUAOkAewCOAFcAQABYACMAbAAjAH8AIQCVAAEAfADX/1sAz/9LAOH/OADi/1YA0f+GAOr/tABJANEAqQC6ANIA' +
          'pwDYAKsA0QByAMAAKgCuABsAmAAVAHoAHgBvADQAeQAlAG4AAABPAPj/RAARAE0AKQBQAFcASQCaAEQAwQBHAKYAWgBrAHAANgB6ABwAkQAZALgAFgDIAAoAvAD9/6QA+/+EAPP/XQDn/z0Azf8cALv/8P/A/8f/' +
          'vv+s/9j/kf/a/3z/xP95/7v/cP+f/2D/mP9a/7z/av/q/43/8v+r/+T/uv/K/9L/t//n/7P/5v+0//n/x/8wALn/UQC//1UA1f9WALj/MQCi/+T/mf+f/4T/Z/9q/zH/d/8Z/5T/N/+k/2P/t/9x/8f/eP/P/4P/' +
          'vv99/83/hP/e/73/2////+P/JAC+/zwAnP9EAJr/FQCz/9v/6P/S////x/8DAKz/CQC8/wUA4v8VAPT/JwAGABwACgASAPr//v/9/9v/FgC3/xoAov8HALD//f+//+L/yf+Z/9j/Wf/i/0L/3v8r/+X/Kf/j/1b/' +
          'yf92/8v/gP++/6j/n//N/6D/y/+7/9//3/8UAPH/MQDp/0EA1f9bALz/WgCx/y4Av/8TALf/GADb/w0ALQAMAC0ANQA8AEcATwAtADEAIgBGADIATABGAEEAXABEAHQAMQCHADIAjgAvAIwAEQCOAAQAjwAHAI8A' +
          'IwCQAEAAeAA2AEAAQgALAEMA8v8qAOL/RQDP/2QA1f9zAOr/jQDx/4UABwBuACQAaQAuAGAAPwBIAFsAGgBbAOj/TADW/0wA0v9HANT/OgDY/zUAw/8wAKH/FgCc/+b/qv+v/7X/if/E/3T/uP94/5n/lv+H/63/' +
          'g/+2/5P/xP+e/83/pv/J/63/4P+S/woAhv8RAKj/CwCq/wkAmv/j/7H/tv+7/6z/v/+f/+//iP/0/4H/zP9t/7j/Rv+F/zT/aP83/4j/Mv+j/y//rP9O/7T/fv/H/5H/yv+V/8f/ov/D/5v/zP+N/9r/mv/L/5//' +
          '4v+K//b/jv/j/6z/2P+o/7X/l/+B/5f/if99/6H/Zf+w/4L/1/+q/8f/0P+7/wgA2v8xANj/PQDq/0MA7/9UAN3/agDQ/3gAvf90AK3/XQCa/0YArf8yAN3/FQD9//X/MwDb/3MA2P94APr/dQAlAG8ARgBYAGwA' +
          'bwCSAHgAnQBwAJYAaACVAFMAmQBPAJgAXgCBAHgAYABzAFoAfQBnAIUAcQB2AHkAjAB/AI0AhQCKAJgAnwC4AKgA0ACwANMAtQDEAKoAqgCPAH4AdwBQAF4ASQBNAF8AVgBpAFAAYwAgAFUA8v80AOX/CwDZ//D/' +
          '3v/d//b/w//w/6//5f+3/+T/uv/L/6v/r/+0/57/0f+I/+P/lP/s/7T/+f+0/wUArf8OAKL/CwCH//f/f//g/5f/z/+2/8z/zv/F/93/rP/U/6n/t/+//6n/vv+w/6j/wv+Y/9T/iv/Z/47/4f+i//n/pf8PAJz/' +
          'AACc/+D/mv+9/5X/m/+n/5H/x/+h/9n/s//Z/6b/yv+s/7D/0v+m//D/xf8iAPP/NQANACcADAAtAPf/FADX//7/y//1/97/w//w/57/7/+S//j/iv8FAKz/9v/X/9//4f/h/9n/7P/T/+f/0v/R/+L/u/8OALn/' +
          'JwDH/xoA1v8CAOb/6f/0/9f//v/l/wUA5//x/9H/zP/v/8z/AwDn/wMA6P8eAOT/GAD4/wkACwALAAkAFQAQABMAJQAbAD8AOwBhAEAAbgBBAFQAUgBHAHwAVQCFAFQAaABGAFgAQAAsADgACAAjAAIABAD8/+3/' +
          '///9//b/LgD8/1UAGgBWADMASgBSAFcAZgBhAGkAVAB7AFoAkACCAIQAogCAAKUAhQCiAG8AlwBfAIMASwB3AEIAZwBCAFAANQBGADAARAAjAEAAFgA+ABoAOgAnADQAKgA1ADYANQA9ACUAQAAaAGUAJAB/ADQA' +
          'dwA/AFoAQQAxACgAIwAOADQAIQBCADMATgAvAEgASAAtAGcACQBTAN7/HwDo//P/8f/W//7/xP82AMP/SgDA/1EAtP86AML/CwDO//z/sf/k/5n/wf+2/7n/6//O//3/2//u/9n/5f/N/9//tf/M/6//tP/C/6D/' +
          '1f+b/+H/tf/r/9P/4P/f/+b/8P8BAAUA9/8KAPH//f/t/wQA7v8iAAwANAAxAEcAUwBXAEoARAAzACgAHAARAPj/7//e/9T/5v/g/xIAAAAvABQANAAZADgAEgBEAPj/MQDq/yMA/v8oAAkAKQD0/ycA8P8qAAgA' +
          'NwAVAB8AEAASAAEAHwDy/yMA7P87APD/VAD+/1EAEgBFAC4ARQBQADAAZwAaAHAAKgB+AFAAlACJAKEAvwC2ANoA3QDkAAMB3AArAbMARwGoADIBsAAOAasA+wCoANMAmwCRAJ0AdACfAHgAmwBxALIAbgDNAHQA' +
          '7ABxAPYAaQDMAF0AsgBTAKQAXwCBAIcAdQC7AGsA2wBtANUAcQDBAGoAsAB+AIwAcgBcAFEASgBTAEsAWAA6AEsAJAArACAABAAXAN7/+f+9/+D/uP/O/8//sv/b/6b/4/+2/+v/yf/Q/8L/xP+w/7//q/+1/7L/' +
          's//D/6L/5P+l//r/lf/3/43//f+k/wUAuf/r/9r/0P/Z/9T/8P/e/wwA0//4/7b/8f+f/87/l/+X/5P/hP+H/4L/df+P/3P/qv9+/8T/cv/A/1n/o/9o/5T/lv97/7P/a/+9/4D/s/+m/6T/yP+r/9T/sf/U/7D/' +
          'v/+z/6v/tP+m/7T/tf+4/9z/yP/m/8r/3f+v/+z/l//s/4D/3v9j/+n/Wf/c/2P/z/93/+v/jP/e/5f/8P+f/xAAsv/p/8//4v/v/+T/DADf/ygA8/9AAOL/PQC8/xwAuP8EALb/9f+i/+H/q//b/63/0f+u/7D/' +
          'w/+Z/8D/kf/V/4P/6/98//L/nf/6/77/7v+8//D/vv/n/87/2//Z/+X/4//q//X/6/8WAAAAOAAbAEcAJgBIAC0AQgAQAFgA7P+JAPz/iQAVAFsAMgBMAFoARwBTACEAJwALABQABwD5/wEA5f8qAAgAUQAQAEAA' +
          'DQBAACYAVgApAE8AHAA9ABAAOQAJAEIABgBIABcATwAxAFgAPABQAFEANABGABIAKAD6/yMA6P8XANn/IwDc/0wA7v9bAAIAQgAPABcADwAEABMAEgAnACoAJAA4AAEAKADt/wIA7//d//X/xf/3/6v/2/+g/8L/' +
          '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' +
          '1wBj/0kAr/8EAF7+pP9V/jAA5v4ZAd7+FgF2/7IASgCbALj/PQD6/ggA6f8cAEsB7P8yATUAfAB6AAsBagHOAUQCgwEwAYgBzwDgAS8CewE2AhsBSAB4Acf/vAGYACIBzwCuACIB5ACNAfYAJwIOAdsBOQHxABQB' +
          'TwHHABMBnQAzAIcAfAAkALgAAQAxAJ8AXwALASgB1gDXAOQAiACFAVEBegG4AdoABAECAW0BLAH8Ai0BFAKxAeIApwH+AWABuQL7AUgCywIRAvoClAJlAnACGwIPAuACpALaAvYCwQG7AhACbAMHA68E0AJIBLEC' +
          'xQMVA6UEQAMZBHEDRgKaA/EBawN9AtICQwKqAiACOQOQAroCaQJxASQCXAHAAmQB/AIaAEQCRv/VAc//aAIVAHkCBwCiAW4AGAKaAI4CXwAIAp0A9gGGAfABqwF1AYYA7AAuAEkB5AB9AcAAiAA0ADMAhAC8AMwA' +
          'xQBBAMIA//8wAUMAYAELACkB+v/bAN0AQgF5AUcB+QB+AJEAAQHoACgCFAHjAeQAUQH0AGMBNAGfAAABPwCQAIkAnQArAJEAov82AC3/HQBz/xQAyP9aAJf/wgBz/9gAAAA8AWIAtQEiAJ0BsAAtAc4A1wCBALMA' +
          'AgErADcBSv+UALD+XwCJ/sQAxf7tAPb+KQHh/vMAif7fAEX+1gB1/lIAgf5oAIn+WAAi/57/qf+8/53/tQA8/5sAPP91/7f/h/7x//D+DgCo/1EAEgAsAJ8Af/9wAGT/BQFMAFoBjADDAD0AiAAgAQ8AvQH//+cA' +
          'OwCtABYAEgF2/xEAvf/E/qAAUf88AWwA0wFWALoBBgB1ATcAIgEVAKwBev/BAWD/zwDD/3oAi/8rADX/xABY/+sAs/4YALP9FgAb/vj/Gf92/+z+x/8t/o8A8v2MAJz9pgAu/ZMAUv0KAID9vv+e/fj+Dv42/l3+' +
          'r/1e/or9e/7T/cn+wP3z/rX9IP/+/ZP/Z/7A/8j+q//E/uX/VP4eAMX98f9o/d7/q/08AA/+OAD0/dX/qf4KAPP/4P85AM7+OgDB/swAvf9IAan/oAAY/8H/+v/W/9kAGwAqAGEA8v96AI8AlwAgAD4Af/+m//n/' +
          'aQBUAPwA0f+HAPP/lADuAEcBmgB0AXr/NwG0/+QA9f8+APD+cgCD/tQATP+BAJD/WgBl/74AIgA5Ad8A+ACAAJcAPgAoALgAHACgAKwA/f9HAHsAmv+WAV7/TAFp/2UA8P++ADgASwEMALYADgB6ADkABQFo/1UA' +
          'mP4K/9L+RP+B/uD/c/6a/9X+hf+O/s//mP5S/xP/dP6F/2v+TP+I/jf/Av72//39KAC9/s//9P5//4D+R/9r/sL+yP5C/r7+qf58/vX+zf5r/lz/9f1q/2/+HP90/vL++P3r/sj+BP/0/lL/Q/5V/zP+Ev8A/ir/' +
          'tP0Z/039rP4l/bb+3/zI/qX8mP6H/cr+FP54/tr9Uv2F/WX9d/3N/lT9H//w/EX+Hf0k/rD9UP5z/gb+Qv5M/n/9p/5l/Ub+H/1i/or9kP48/qn98/3i/KH9GP0C/rn9jv7N/dj9A/0y/eH8zf3Q/Qn+Tf7f/Vn+' +
          'Ev5r/k3+Sf4V/ln+C/6e/kL+of5V/lD+oP5G/n/+Qf8X/iQA1P2i/8r9//4v/hz/JP72/vP9mP7W/S//jf05AHP9VQDU/ToAm/56AG7+0f80/gn/wf5g/07+NP+r/Vn+P/59/rv+G/+c/hf/wf7S/pz+8P71/Un/' +
          'wP2Z/yz+MQA3/mkAG/7A/7r+sv/n/lAAhf42AEP+EQBU/roAYP4xAWr+pgAd//P/KP/e//v+iP/U/1X/if86AC/+IQA7/sT+5v4p/5P/vgDKABUBbAGjAPMAtQDQ/08BFf83AWf/ngDC/x0B6/+bAYEANgHVAKQB' +
          'dwAPAhMACwEqAFkAIQBEAGL/jP9j/yL/SgAZAFsASgHi/wQBxP/z/6P/6v8U/x8AC/97/2v/V/+7/7z/zgCO/40Bs/+nATwA+wDc/6f/gP8aAEEASwHjABoBsgBhAG4Atf9cAML/SwDxAFAABQF2AJQAQwD4AJv/' +
          'NAB6/z7/6f+v/6z/CQBJ/47/z/9f/zQAP//k/0f/v/9G/8L/ff+H/zgAYf+G/37/+f52/9j+Dv+u/vz+9f50/+r+Tf8b/5D+Nf+K/iv/9/7G/hT/ff55/4z+QAAB/2cA9f8VAI3/cgAJ/wwBgv+0AFL/7P9J/5r/' +
          'gP+R/zX/hP+w/2D/TQBu/9QACQCZAZ0AVwGiAP//xgAm/0UB6/5eAYD+JgFc/zQB2/8VAW7/1wATADQBrwA1AS8BTgCOASIAtwGwAMIBcgCGABoAJP/UAID/qgFtAGgBRQDrAIUAbAFkAeIBRAGHAZ8BiQF4Ar4B' +
          'KgNyAe0ChQERAbQBmgAxATkBwgAOAaQA2wCHAF8B4AC5AYYBWwLGAYEDvQFRA/gBEgJ5AsoAgQJpAcgB2QHrAFUARQCp/1gAXP+GAX3+LgKw/ioBSgC6ABEC8QHqAxACSASsADAE1AA0BFUCMAJqAu//6QGF/vMC' +
          'Ff7dAzD/4wLvACcCkAGkAowA0wHRAPP/PwPp/zsEiAAXBHX/ggK8/rz/wv/a/hwAwv+G/3wCIAB/A0oB5gGmAfT/CALw/qYC2/7sAiH/1AIrANQBdwBOAO0B1v/IAg4AaQLx/4EB6f9n/xMAfP4kANT+4P9qAPj+' +
          'ugBy/gAByP44AZ/+uAG+/jQCbwDx/1MBDQHGAD4ChwGaAFUCwQCrACUCS/+SAi0A5gCiAD8AoP8aAGr/EADBAA4BcQE0ApEAgwNrAN4CZQGiAWIBUQEaASgC9QH1AeYC/QBCA0oDnwIxA5EApQG+/s0BnP5BAVP/' +
          'awHS/9H/CwAZ/3AAkwHmAMQCAAHVAsEATQMAAN0BKP9X/wn/PP8s/9v/hv8PAa4AbgKQARsCPQE3ASMAAwHU/kEBrP6SAD4AIACnAXsAsAFZAPsAKQCy/4IAF/4FAEj9JP9Q/UL/eP0d/6b+V/8EAT4AAAKQAFgB' +
          'HQHOAbEByAJrATQCnACtAb3/QQJ5/yUCav9MAVz/AwHl/7YAKwGi/7wBqv5CAXb+MgJh/sgDiP7DAsn/bADtAKABmQAIA1MA9ACPAD7/6P+k/23/WAEMANEBGABhAmb/DgNc/xwBk/9I/gP/7Px8/or9Xf81/lMA' +
          'Ff9V/yEA5P2GAa39uwEK/rT/Nf8V/48Ae/4xAL39of/L/roAMABEAZwA9f9vANv+dwC2/mMBhP5rAaP+Yf+h/yYAHAAOApf/5wG8/wsCTQCeAY7/z//1/tP9mgBn/TkCmf1+AQH+ZQB3AHUAjwNuAOED/v8MAqX/' +
          'twFZ/+EBq//HAKoApv/fAEgAxf/tAdb+jAH9/nIA/f4oADr+V/8p/uL+Jf+Z/xYAoQBiAP8Aq//JAB3/6QCTAAgAKwKb/lABMv7u/zz+cADv/ncB0/8hAYYAWwCQAHAAuP9SADH/dv99/z7/sf9z/9j/Ov/YALD/' +
          '4wB7ABgA2v8UAFP/YACMABMASwGI/3EA3/9HAP//GwEFALoAOwB9/9gAjv90ATsAywCO/3kAlv7U/8X+6v7u/tX+k/79/p7+I/+q/pP+TP5F/j7+o/6c/pD/2/7U/8j+Yf+s/uj/zv4aAM/+mv+s/qH++P6d/ZH/' +
          'Lv32//v98f+2/53/bAC7/74AwgCrAMUBsP95AQv/6f+t/8j+kwAi/08Auf+R/1X/bv/e/jX/aP/s/c//i/3q/jX+I/5z/nP+kP6t/rb+tP4l/wb/8v7S/rr+dv4P/wn/cf5//7L9Df8P/v7+rP6z/+b+/v/6/sb/' +
          'Cf/X/z3/AABb/8T/wf+x/5kAMQDlAJEAVgGXAAIC/QAyAZEB3v+GAXz/SAGA/0cBof8PAen/sgCmAKcA9gDjAHIABQFeAPMAAwACAWr/BgEu/7oAuP7sAAT/bgHU/wcBcwBhACABOQAlAdD/VwBl/5P/kP9W/63/' +
          'Kf+O/5b/sf9NAO7/EQDJ//X/k//N/6z/H/9g/6X+pf5S/nn+SP6I/nr+IP7T/tH9SP+9/YP/j/26/7P9rv+H/q3+df+U/a3/r/2A/6n+t/8I/6H/7P64/o3/Tv6p/9X+8v73/oP+qv7B/Sj/Z/3N/+r9Vv8+/ur+' +
          'cv5H/7P+6/65/j3+2v3i/r78kv/G/DT/qv1Q/1z+5/+E/oD/q/7Q/sH+vv57/k/+D/6b/Wj+N/74/pH/p/6B/8b+nP4N/+H+Ef8o/9X/I/6IAAX+kABn/5AAp/9UAMP+7f/W/k//L/8U/lb+AP7A/Xz+tf4Z/if/' +
          'VP5r/hH///7R//H/MgDg/kQAfP6kAPn/XQDK/4v/ef6P/2L/AQDlAH7/gAAw/+3/x/99AO//ZwCG/0j/N/8I/wMAZP/AAO/+1gDR/uUA+//J/7gAgP4+ANv9KgDU/foAo/4tARz/qgA1/78Aqf/kAB8AJAD3/77/' +
          'vv9gAM7/jAD0//v/9//2/67/MABC/9H/rP6y/4z+EwDb/vv/Y//5/ycAtABzAAgBFgGnAMUBnwAkAdkAgQCBAE4ABgCH/1UADv/dAD7/7gDv/hIBwP4uAZP/4wA6ANYAgQDMAI0AKwDD/9v/nf9eACAA3gBHAM0A' +
          'pACFAGUAuQDO/1MBuf+rAez/vAFuAKYBqQBYAUkABwF4AK4AkAFAAKMBHQB5AVcAygGnAB4BzADzAMIA1QHYAAoC1QCpATgAewGc/wgBhv9zAHr/QgBj/5cAfP/fAOP/aQCmAIoA+wBDAXcAZwEDAAkB4/8MAcj/' +
          'OAEVAOoAlAADAe0APAEqAckAywBUADQAygBbANsAnQDm/3IAvv+QALH/OQGD/poBTP7fAKH/+f8NAA0ADQAJAFAAof/y/wcAnP9MAHn/aP/y/9D+jABG/yMAr//h/67/WgAbAHUA1gAoALYAjQBSAMgAtwBHAKYA' +
          'agCa/5UATf+AACYAOwC8AND/rAABAJoADQBZALv/8f+E/0QA/P+UAIIAuf9jAE7/MwAnAGgALQCIADv/lP9c/wL/PACO/1oAWQBXAHMA3QByAOQA7gBoAFUAiwBz/98Aqf+bAHcAdABTAKMASABQAL8A0/89AGEA' +
          'ZABRAR0B2QD2Ab3/JQL6/2sB1QCiARcBawGCAaMADQK9AOgBKQHQAV0BAwJ/AWQBsgGZAG4BKwGJAOwBqv/xAOr/W//GAEf/0gD3/7YArf+RAED/7v8AAFD/4wBj//4AQwD5ANoA3QD4AG0AxQBnAFwA5gDy/+kA' +
          'wf9kAIkAUQASAZcASgB9AHv/lwCP/zUBAAAhAaMAOgAsAdb/8gDj/4IAZv8aAAf/uf/V////pAChAE4A3QASANoAVQC2AAEAWQDZ/woAkgDG/74AjP/8/23/kP8U/7D/uv6Z/7r+Zv+a/rX/cP7O/3f+Lf/U/kL/' +
          'UP8iACT/AADf/kf/Av+i/0b/MACO/2//4P+G/tH/xP6T/zT/vP9N/7f/xP/C/yEAPAC9/5MAbv9aAMb/nP/r/wP/QP8g/83+g/91/5f/CQCh/5b/Zf9D/xH/ff9y/x7/+/+H/g0A2P5CAFH/oQAg/4UAN/+t/9L/' +
          '0P7F/0L/Of8BAAb/3f+4/mX/ef4M/xb/5/7T//X+zf+X/67/7v8IAMH/7P+q/xX/fP/r/pX/mP/1//r/cAAeAJYAWgAzAC0A7P+4/87/8P9s/6AAb/+WAPf/EAAsAAoAJQAVAMb/pv8u/1v///5i/5T/fv82ALD/' +
          'UgCb/5YAL/+RABD/+/+f/3D/IgBd/+f/5v/f/1YAxQB5AHMBnwAoATgA7gCj/yQBJwDLAPEAFgDzAAsAwwBVAAEBewB/ARABdAHGARQBmAEBAeoASgHUAFkBPQE9ASQBtQHEAPkBNwHwAdcBJwKjAUECeQHdAcEB' +
          'RgF8ASYBxABRAXQAOwE5AMMAm//6AJT/jAF0AFEBiQAyAZf/FQFp/5sA7v88ANv/6P+m/6j/9P+d//v/o/+e/9H/vP/q/9//wf9O/8n/G//X/9H/tP9IAI//DQDK/+D/z//j/7H/qP8cAND/PwCPADkAqQDl/0sA' +
          'Mv+iANj+BgG0/qIAP/9LABsAbQAkAG8ABAAzACcA9P+A/9T/cf7a/3T+3v9l/+H/FgCt/1MA+/5JAI3+3/8k/0X/0v+h/mH/4/7D/kj/P/8x/6b/sf8D/6j/sv7q/0D/1f+d/8H+c/9w/1P/HgAt/3oAlP7uAIr+' +
          'kwCd/5QAJgBkAMj/agAAAHcAiQDm/zYAZ//W/2H/PwAHACwAvgAs/3kB/f6WASYAQgGgAL0A9f9g/wYAm/5LAF/+zf8W/iIA9v7nAHkALgA9AQj/6gBM//sA2//kAWD/bgIq/wcDvP8kA7L/JAJf/+UABgDQ/8cA' +
          'HP9yANj+NQDV/scAH/+bAM//0P9yACAAsACkAGAA3P9HAE3/LAC2/4T/NP9x//v9gf8X/ln/1v5q/4H+w/9q/g8Aif+t////x/6u/zL+eQCj/oYBYv8TAef/YQD+/8YA0v8gARQAcgASANf/xv8zALf/tgBG/8oA' +
          'F/+TAJT/IAB4/4X/Xf92/8f/GQA//yEAc/5s/yT/bf/5AOr/AQKu/0EBof+WABIAFQD0/yz//f9z/50Auf+eAI//z//A/47/iv8uAKP/fQCy/0AArv90AMEAywD9AD4AEgCq/0IA2P/QAAwAGQHP/xIBbP/t/2P/' +
          'Y/+0/8r/SADM/10Bpv8ZAjv/lgEb/xcBbf/eABMAz//bADP/tgAOAG0AVgCAACb/OAG3/h8Cdf8NAar/TP97//j+xf8j/87/K/9c/17/ov/Q/xgAfwCT/xcBCP/qAEf/hv+Q/3P+df/q/pf/8f8hAJYAhwB0AFkA' +
          'xv8YAC7/YAC3/3MAJwD4/zr/0v/H/vD/Wv+v////nf+k/ysA2v7NAPb+ugAw/xkAzf/C/9QApf+cAID/4P9m/4r/ff9d/8X/iv++/1H/Wv+H/jr/TP43/xH/4/7z//3+QAB5/1cApf+RAJ7/MAGB/1kBe//EAGL/' +
          'TAAZ/yj/Bf85/iT/mv4I/+r+3v6g/vr+y/0s/+H9Y/+p/nT/Cf5H/wb+/v4o/wP/bf96/4QAov9HAZ7/twDm/3sAo/+k/yj/9//l/1v/xAC1/XcA+f0pAFT+UgCP/+f/W/8R/7f+Kf80/+P/Zv/u/5QAjv/8/4r/' +
          '4v6P/8D+Qv/J/hb/+P8N/yIA3P4i/8b+G//f/tX/jv5+AN/9VQEw/tsBTP8dAZb/0f9v/xL/v/9Q/n0AeP0FAQn+nwDM/w4AtADr/7wA2f+MACMAOADEACUANgGz/38Bf/8SAsL/aAIMAOABcwCKAccAvgHgAHsB' +
          'bADDABAAbgAaAKcARADBAMT/oADt/8AAEgH8AK8A+AB2AA4BJgGGAUwBrwF0AXIBUwH0AbsAWAKEACsB0gAuANEAVACPANX/wAC0/uYAqf4tAZz/dAAfAB7/0f9V/4P/6/5c/9H+DP8oAIT/QgC0AO3/hwCAAH//' +
          '6ACk/34AFgDX////bf/2/87/AAArAEAAVQC1AGIAXgHx/58BCQC+ALX/FgBr/1cA/P9aAK8APQC8AdsAvgFeAW4ByQBCAcz/sP9L/8z+Nf/+/oH/9f75/yP/t/+m/wv/WwAg/5EAwv82ADEAvP9+AL//zABiAM0A' +
          'JwGhAJQBkQAzAXUABgAUAA//tv/k/pj/RP4m/27+Mf5b/6z9SAAb/mMBZP75APP9XwDy/Tj/0/7l/Wz/w/5B/+r/MP8uAEz/VwA5/zAAWf93/9n/hv41AA3+IgAA/woAhv8QAG//CQD5/wEA5P95ABkALAG2AOQA' +
          'hQBkACwAswB1ABEBvgAwAeUAeQH6APwB7AAlAnYA8QEW/wMCdP7ZAef+HgHY/+4AVQD0AIoAyf/tAMT+QQA2/zMAZf/DAK7+fQCD/kkAL/9BAI3/zv9n/7b/sP9HADIAzQBNAGEBPwCWAVEAiwE7ACwB7P+/AEUA' +
          'UADWAGb/YQD1/sX/+f7L/07/1v8uAMz/QwH4/0sBZQAbAAABOP+yAS7/AwKT/5EBuf8wAeT/RwFdAAABrgAQAGQAgf8jAAgA5f9dAPb++/+P/vj/8f4/ADj/JgB2//3/7//r/4AAev+mACr/YgDf/0YAWwBtAIj/' +
          'XQBg/y8AfQBFAN8AYQB5AH4AcgBRAJsABwA4ADkAov8fAIP/vf9Y/8j/4/5LAAn/rgCb/1kAT/+M/yX/rP4+ALr+tQAo/xYArP9yAMYAaAE8AewAVwGi/40BYP9CAeD/RAAzAAz/tQDb/iEBTP9WAF//Kv9J/yH/' +
          'Z/+t/83/wf/n/x4At/9kAcf/2AFPAOgAHwHZALoB4gHfAR4CZAEPAsMAfQJpADECsgA5AU8B2gB/AZ0AtQGY//0B9/4EAm7/kAFm/74Anf5bAK7+fwBZ/3EAhv8TAK7/8/8gAAYAOAAxAPf/kgAuAK8AqgB1AF0A' +
          'bQDi/5YATAB8AE4AOgBM/2gAEv+HALT/UADo/yUAGABWALcAbwDAAMT/GwDZ/wMAkgBnAFEAhwDc/5gAcgAoAVQB1wE9AckBFAFiAVsBNwH3APEAXgB7AI4ATgCZAI8AWgC3AEMAfwCFAEgApQAaAOf/8v/K/yIA' +
          'PwB8AAMAoAC3/48AHACVAA0ArgDV/5MAggAxAAUBuv/cAJD/WQCx/7wA1f+3AMT/xf+C/53/Kf/9/+z+NADp/pv/yP7D/8b+PQAn/+b/mv+q/8z/iv/U/9f/EwDX/1oAtP+JAEAAuQBHALAA7f+aAEwACwGnAIMB' +
          '5QBtARUBUgGDAF8BAwBdAREAPwEkAHYBbwDVAcwA2wG7AMQBxQBcAZwA+gBhALsAmQBQAKgAOQDaACYAAQGz/8UAkf+oAMn/+wB1/2QB3/5hAbn+7ADR/hkApv4r/zP+oP48/tv+j/5v/6L+vv/h/q7/QP+E/yL/' +
          'G//z/mD+If9Z/vT+AP+R/jb/wv5V/yX/LgDI/sYAFP6kADT+CQC//in/9f6n/jj/Sv6W/5b+c/8e/1P/4/6L/+z+Nv9T/77+Uv9Q/xH/YQDu/p4Avv6IAMn+CwEz/08BoP/hAJ7/SAAI/67/5P4Z/zb/0P6j/6f+' +
          'EwBC/oEA/v2pAEf+HADM/qr/u/41/67+s/6G/77+/P86/5r/j/9m/6n/aP8ZAHL/RQCT/wEAm/+G/5D/Cf+U/+f+e/8Z/93+Tf8n/kP/Mf6J/6r+1/+6/qr/uv6a/4v/AwBdAF0ALgCQANH/ngAgAEAA4gDD/48B' +
          'Bv8VAgL/RALX/xcCBgDmAeD/sAHW/1gB6v+yACgANgCIAFgAvwCBAKkAWgDKAEsA6AB7ALEAfgB2AF4AkgBPAK8AXwCeAK8A6gDGACIBkQD4AFYA9gDy/+4Aqv+4ANT/QQDW/53/lf+k/9n/8f8vAOj//P8TAPH/' +
          'FgA4AOL/OwAAAB8AUAAtAIYALwA3AEoA0f9oAMn/NgDB/9z/s/+//5j/LgBn/7UAV/+aADP/CQDt/sP/If/3/5P/CgD+/73/hgB2/3AAff///6P/x/+n/7L/kf/K/6T/i////8/+FwAg/nz/9f31/gD+Jf8k/ij/' +
          'mP5T/j//x/0NABz+LABc/mf/Qv6L/mT+kv6z/gr/w/7s/tH+M//W/of/gf4s/4j+Ef9C/xb/r/+q/lj/mv4w/xL/gf/t/lP/iv6r/nT+gf6C/vb+uv5F/4f+Uf8v/pL/N/66/3T+qv+p/rr/pv7H/77+1v/3/vH/' +
          'D/+z/xr/Qf9B/yr/lv9w/+r/nP+l/3L/R/82/4v/Rf9y/3f/Kv9u/wj/a/8P/6n/mv/h/xYAzP+zAJX/XQFh/2gBJf8OAV7/tQC5/wwAo/9w/8r/P/8PAF3/tP/i/zT/NQBr/0QAEgBWAEYAUAAtANv/GQCA/77/' +
          'j/+R/9P/DgBzAJkAvADHANAA2ACkAOQAbwC+ALEA1wDnAJQB4wAtArwAPwLaAFICvgBBAlsAkwG5AOcATgHOAFkBpwBoAQYAYQG9/98AJAA7AEwAFQAQAH8AAgCFABgAagAZAKAAJQBhAEQAtv8mAFP/LgAW/5oA' +
          '3/7GAPT+tAAk/7YAbv9RAKj/df/0/yr/cQCX/zsArP+d/3H/g/+d/3b/j/+m/wP/aQAE/8IAa/9UAHD/uf+Z/2L/JwAG/xkA9P5a/1z/F//H/27/2f9h/1X/+P7m/hz/n/5//17+Wf+C/jD/2f5t/9n+Sv/v/hr/' +
          'mP+r/ysA+P8yANr/7P8WAPz/YgDy/yEAyf9y/83/OP/W/1P/HQAU////8v6y/1z/Y/+T/wL/ev8b/8D/qf/a/1EAd/+aAEn/gQBi/+r/bf9w/5//t/8tAE8AdADeAAoACAGa/9wAa/+HABb/RADi/k8AKv98AKH/' +
          'QQAEAPT/RQAIAF4A3P9gAMf/gAArAL4A7gADAUABUwHyAK8B5ADYAXsArwHS/3YBt/8OAUIArwDDAKwAVwBvAPD/0v87AGn/XwBq/yoAgP/W/3n/iP+I/3D/2v/r/1sAwADHAPwABwEHAf8A4QC6AEsAfwDU/1YA' +
          'bv9YAFX/fwDm/60ADgHaAMYBowCEAWAA7gCPAJUApwCqAJYA+ACoAEMBxQBAAYAA4gAKAFwAIQATAIEAtP+wADH/kAAO/5gAUv+8AN//WwAjAD8AIwBzAE4APQCeAPX/kAARAG8AWACJABYAcwDZ/2AAIQBZACUA' +
          'ZgALADsASQBTAGgA3gBEAAMBbADtAMIAIwGnAJ8BVwAOAW8AIgDEAF8ApwCNAFAA+/9qAL7/dACXAMj/FgFS/2EAyP/E//b/1P9w/+b/Vv/c/6T/gwBn//oA6P5tACX/pf+R//b+of+k/hUAof73AAn/VAHr/yAB' +
          'gAAxAW4AKQH8/4cA9v8QADQANwAmADYAHQCh/+v/Xv+7/5n/i/95/2L/8/7h/9n+AQA7/3n/X/82/4//Xv/6/+X//P9kAKf/5wBl/+wAXv9SAHH/+f+D/5H/lf8v/6P/QP+z/5v/s/81AKj/iQDh/5cATADPAHQA' +
          'tQCIAE4AxQAVAMAAlf+HAI7+hQCI/oQAqP8wAEsA5v+TABIAggApAPj/9f+F/x4Agf+1ALT/7gDR/64AEgDBAFIAAAGMAAABYAAUAUcAUQG7AGgBHQE2AUEBBQH8ALkAhgA0AAUAJwC9/6oAz//LAD0AZwDtABUA' +
          'QAGo/wwB8f6RAIH+JACq/sX/Jf/v//f/gQC/AHsA8gAWAOEADgC6AEMAlwBvAFEAgAAgAEgAaACe/7QA4P6/ADD/rQDX/7oAGACjAE4AQwCPAB0ABAEmAL8AHgBBACkAAwBbAKH/WwBQ/xUAKf/m/0H//P9T/zIA' +
          '5v85AEsAIQAyAB8AEQDg/8L/ff+3/43/j/+j/+P/ff93AJn/YQDz/xEA1v/U/1P/yf9W/0v/L//Z/oj+xf59/sn+6P4h/xT/g/9M/yMA7v+bAIMAhQCyAA4AugBI/60A6P78/xv/8v5U/4r+d//M/n//RP93/2P/' +
          'if84/67/9v7G//D+av9Z/xT/pf8i/9j/Pv8eAHf/lwDA/7oAAQAVABcAtf/w/wMAxf9gAN//oADT/wYBCQA/AXUA/wA7AJQAGQAGAAsAbP9//0D/Wv99/9//qv/n/+P/j/8xAGj/GAB4/8X/Fv/I/5v+5v9C/8H/' +
          '0v+i/5n/mP9b/5X/cf+L/2//ef9q/3v/lP9s/7L/aP+n/2v/av9N/4z/Hf+k/yL/lP+G/5v/nP+7/0P/7f8m/0kAUP9UAHb/5P+E/27/vP8S/xAAbv9iAIv/wQCT/8QA6v+dACQAhQDu/zcAb/8iAHX/VgCJ/4EA' +
          'IgByAMMANgAHARkA2wAbAM4AMgAZAS8A5AAOAKgAEgA/AEgA4/9+ALH/ZADz/zkANAAbAJ8A3/8AAdX/tADV/00Axf+q/xEAeP9iAIX/EwArAI//1gCd/8kAu/9OAJv////W/1YAAQANAL7/0f95//b/mP8fAOL/' +
          'NgDb/2QAqP+gAKz/ggBBAKwA4gDQAOkAWQDgAMf/CwHN/00Bw/9zAQQAOQHZAAcBHwEbAawAHwEWAMEAp/81AK7/yP9RAHf/oQB5/6wAnv++AMf/qgA0AK8AgwAOAcEALQEPAREB7AC6AIQA1wCoANAAFAG7ANkA' +
          'DgG1AIgA9wBNAJgApP89ABAAWwA6APv/mQBo/74Arf+mAFEA9ABdADYAOwCvAEYADwBAANX/FAAF/8H/mv+Z/ykAyP+EAPz/8AA+AGcAdwDNAFUALAA5AOMAVQAbAG8AgACNAI8AIQHuAGkBDAEBAYEA9QAlAREB' +
          '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' +
          'dv5J/2f8cf06/eX5pPwv+qf87PyD/wv/2/yJAA/8DwGT/AIB/PqAAXH8WgMw/u8CBQEiAUsAtgEyAOoA+wDY/zMAiP7UAcH9bgCjAD0CxwD7/64Anf2jATL/1gKx/jAFUQMXAuoElP4kBRcA0ANoAmIB1wEUAa4B' +
          'QwBHA6sDoAMaBicG7ASsBqgE5APnBCAEKAWxBBAEqwPRAQACPAJ6ADICUACYAj8A+QKJ/4UDogDOA+gBbwB+AUwA9wN7/2wFSv/XA/gA2AQEANQGJQEaB+MEKAaVBrIHiAW3CKwFJgeYAxQG0AHeA2EAGgM9/q8D' +
          'DADmAhMC7gB/A2D/dwRBALkE+QE+BIsCtwNGAxAFwgVHBJkH2f9MB1X+ygXb/fMEEf2FA/3+rwCT/9j+yQCZ/ZIAGPwd///5eAAR+RwAbPpp/tf8sv1g/s7+af4H/uz+ZPsoAIH7lACL+gIAm/l1/1D8Rf81/u3/' +
          'mv1u/9P8vP1a+479IvrM/Zz6Q/3p+k/7K/sR+ED7EPZN+xH2Qvzd9u37M/dN+/v2QPxz+F38svkO+6r4Afrd9934K/mB9qn7ZfXG/Ij3K/3r+f77RfqV+kL66/uz+0n8V/xo+lH7UPis+pH2j/ri9u75Z/h++T/3' +
          '2ftz9oL+RPhW/l35q/30+Zr+ivur/lf9y/6y/fr/Hv13/9H83/96/fD/vf0JALz8NAG2/GoBM/2vANv8u/7o/Bf/rf2F/9L9Xf/w/XcAnP70AIz/pgE/ANUBQwHAAc8CBQNDApUDBALrAWQDmgGoA1UD0QROBXMG' +
          'egYUBksG5wWGBbIGlAVrBl0HrgXrCLEFGwmlBcgIqwVBCFUGcAejBt8HxAdqBzYJygbXBwUIlQaSB/IGngZfB+QFyggCBsQJygcQCoQJ4AplCTYLyAhpCm8Kcwn/CoMJ6wm/CaoIpgk5B9wIsQe9B8QILwdLCVEG' +
          'igosBn4KRAerCIcHMgdYBzEG3AgyBbAJ5AQPCI4FAggbBmoJXQWDCfIDOAhxBOgFowWmA5MF0ALqAwIDmAIwAnkCtgEhAdwBYgFmAccBDAFOAMUApABHAXUBoQELAYgBiACWAf0AyAGpAeABtQGaAC8CCAAhAgoA' +
          'dgCz/if+k/06/Ez99/q9/O/6y/tU/IT7BP1a++r89vrq+t36XvkB+u75pfgE+Yf44fmF+OT6HvgL+2X45fuD+Jn7cPir+7740/sX+VT7mvhI+m/4BfvI+bj8c/uN/dH7tvwG+4z6Q/vX+XT7bPlu+x/6A/y3+8j8' +
          '7fyz/YX9TP2E/Z788v1z+8D9+/n0/L36/fx5/HT+yfyH/6z8KAA2/pABAP9AA0H+vQOw/QYC9f1KAOX/LP8TAb/+3QDH/04BoAB0AXwBzgBhAksApgEjAE8ANABtAJcAQQFlAS4AMgEs/3r/RgBK/rABb/4UAiT+' +
          '5gEO/XMCgP0dAkT/6gEBASECZAJgASYD7QEJBOwCpQQYAz8EwwFoAzYBpAN4AvEEeAKiBVoCZQUHAmgEigLHA1wDsAMMAzkD6AKKAlUBcAIyAGUD2QCeA2QCOwMBA4wDYALPA/sCFAQQA7ID7wESA/QAOAO7ALoD' +
          '6gHqBNkD7gVzA1EGIAIsBgwDMAUAAwwE+wFIA+wBaAI/ApwBzgJ8AUQCbwDmAQj/oALb/rMABf+g/un+Vf8h/rv/mf24/yX++/9u/jgAyf1s/5P9iP5y/Qf+HP1T/Tf9Jf1x/L/8o/u5/Kr7qfyo+0v8nvsi/X37' +
          'ef07+878afsH/Yz7DP3B+g79nvrZ/BP7w/vC+7T6Hf3v+VL9Uvqe/P766/zz+3H9NPwG/cT7Lvxs/BP7av2/+rL9QPrU/bT4dv3c91f7YfdZ+tT33vnn+Gv5iPks+rb6p/rH+0L7ufsM/HL7tPx3+8r9svvs/hT8' +
          'Gv7o+/j7u/uo+i/82/td/ev8bP7z/Ij+MP3W/tb8Lv+U/cj+MP0Z/Rv8Yftw+3b7qfvM+1f7mvvZ+SL8b/sx/Yr84/4S/BEAB/xr/5f8lf8V/ab/uvxh/6389gBw/bsBpP7IAcn+awKr/6QCZAGeAlwBDwO1ALYD' +
          'VwEFBCIBwQR8ANQEywB6BGsBsAQPA+4DZwMeBHYChgVrAtcFkwN+BTMElwUIBP0FlQO1Bb4CegVMAkAFHAH2BKMAEAUWABwFqv+XBIEACwMkARcCIwPzAWED6gEVARUCYAAzAlUABALQ/+YB9v8tAsL/CQKg/sgB' +
          'tf6BAc//JAGZ/4EAB/6A/2H9yP43/Sb+ZP05/Qf/ufxz/xL9xP4g/RD+9P3V/A//E/3t/pH+b/4N/zj+Xf6z/mT9hP4G/UP+0f0N/pD99/yI/ED8svuq+8758vqF+e/5efrT+S772/qN+7X6z/sT+ov8lfpv/D77' +
          'kfzL+vz7Tfrs+jr6q/qN+p/68fqo+mL6Sfrn+on6V/zL+pb8t/pj/I36Xfyj+mX7e/pM+uz6IPuO/Ef7Zfwr+kH8efps/Vr7dv7++ib+zfoJ/Q/8GP0e/RH9lv6E/dD/RP9s/xIAI//K/6z/pv+eANP+ywCI/o0A' +
          'c/8zATEAnwGiAKoB5gC1AQYBWQFZAGYBVABiAQwBAQFYAXwAmwDkAPj/WAJ0AYECjQLxApoCwgMcAiED4QFSAssBoQIjAQEDRQHcAiABdQMUAZYDwwHlAvYBhgLGAdAC6AFfA98B+wMwArkEbAMABccDpwS/A5ED' +
          'kwP1Ah8DUQOWA6UDXgP9A9cCFwTdApIDzgKZA1sDMQT4AvsDswJVA+kBLANxANICxQAjAqEAlgJxAdoCpwKlAmoD9wL/A20DLwOoAw8C4QJOAWECkgKPAsUC6wIUArkCXALnAbcC4wGyA+oBBARLAVAE0wAtA8kA' +
          'AAIcAVoCXQEtAikBpgLhAOcC9/8lAsj/yAFhAOYBYgDTAWcAoAHe/w8BN/9aAN/9QwB6/RYBcP4DAmH+0QGj/rkBFP/KAL//bf+B/5H/pv6w//n+rQCJ/g4BVf4oAK3+hgDW/iEBRf9QAe7+xADU/ggA7v7J//3+' +
          'DQBc/3sA4v7dANz+hAGi/2EBowA4AWUBEAEtAdoAJwHoAeIAPQOwAPYDHAGnBMIAUQRBAHMDUQCMAwQBlgN6AQQEZgHJA3wCAQNJA8cCIwOoAmADoQLVAxMCSgS8ASAEeQFRBIsCIASUA0UDUAQTBBIGbQULBp8F' +
          'kAUfBaUEVAVFBEMFagVvBG8F1wSFBXcF+QVmBY4FqwU9BccFRQU4BdoEpQREBZcEzAQHBVsD4QS6A1AE3wMkBNgDXATLA/gEewPwBLMD9QTKA0oFUgQjBWwFvwQPB/gDcgexA84GTQPBBuEC5AU9A04FxQMgBa4E' +
          'mAQxBFcEogL8A4YCrgOyAh8EdQI1BPUC2wIqAx4CjAK7AWIC6wDHAQgBngAaAV0ADgE9AIMBbf/GARz/SwFT/04AuP6E/1v+4/56/lz+u/34/ZL99v3q/Zb+F/2M/v78mf0S/pj9lP55/m7+F/4L/p79cP17/qT8' +
          'tP5y/ND+mPz6/lD9vv4F/qb+K/2d/az8Wfws/FD8sPpX/Yz6wP2a+5b9wfvo/Zr7H/4n/JP+//tY/xr7q/+x+jT/0/q1/tz6fP4u+/j9Wfzs/GL8Qfxm+zX97/oj/pT69P0O+8L9NPxI/k39Ov9x/jL/0v4J/s3+' +
          'N/7F/hz/F/4E/i791Pzg/A79Qv16/nD99//O/AUBePx3Aaz9UgAy/8v/SP/G/9r+wv9//i4Aov4XAKz/CQDk/08Anv+eAP3/awCiALwAoABRAdD/NAGr/+UAWgCFAH8BfQDCATcB5gAfAqwAzgFrAG0B5/+OATcA' +
          '4gDXADkAQwFJAJQBQQD3ACIArv8oAPr+hwA3//YAsf9CAO7/0P9hANL/0wCB/8oAHv8xALP+vf/Q/vf/kv4PAKb+iP+F/zP/i//K/87+qQAQ/jUAnf0W/8f9Z//3/XcAS/4QAXT/ywDY/2kAb/7LAFL9HwFv/bMA' +
          'eP3J/wr+rf+b/qoA3f7yABz/sP9S/ur+vv0T/6z9AP/z/b7+1/25/mr9Q/9Q/Sb//vzM/j/9NP9m/BP/Kvvo/W37V/2b+0D+Rvxu/pP9pv0n/rj91f3G/Xn9Q/0e/WT9WvzM/Rv8ZP3x+yL8gfsr+4D6Mfuk+e37' +
          'C/qq/PP5dfxL+rr7jvsT+zP8vvsr/C39efuM/Vf7Hv6W+/7+ePu2/tb7tv1B/EH9+ft0/Zv7mv2v+zf9RfzA/Jf8B/15/Pv9rPyQ/hr9e/63/W/+Ov7j/kL+WP/t/bz+qv1p/nv9yP6b/a3/D/4nAF7+Nf81//H/' +
          'GgBdAfD/YgGK/+sAv/92AFkARAB5ADAANgByAIUAPADGADgA0wDfADYAygDT/2wAIQC9ACf/SQH0/p4BFwBTAeEAzwAGAQYBZwCbAHD/BgAm/0UAgP+nAGH/DQGs/34AaABk/5IA9/6t/2X/aP+G/+H//v6e//H+' +
          'Pv/5/rH+vf4B/yX+BACB/YcAhP0TAB3+K/8E/4L+Nf9n/l//hP7p/x/+9v9l/az/ZP2b/gP/Cf6P/yP+Pv8Z/tv+xP42/gn/7/3u/g39HP9+/N/+DP3U/RX+N/2g/a/9x/2X/S3+j/3e/O39mPzE/Z38jP3a/Jr9' +
          'cf3E/Tn+dP2U/qH9Kv47/pf+1f0T/qf9fPwb/if88/1E/DD9/PwH/RH+j/1p/o/9qf5P/Zn9Yf0U/ej9+/y4/hP86P7D/Mz+FP6+/sX+9v17/uD8Tf4F/Yn96P04/Sz+Kv5v/sn9H/+q/Tv/AP5o/v7+af5IAP//' +
          '6wBsAcMAGAIOAPUB5v9WAUL/BgEX/+0ADP/yAA7/WABI/8H/Jf+QALX/DwIMAG4CIwCnAbT/xwFCAF0C8AFrAkMC1AJ+AoADkQJXA9ABtQIvARgDywCeA/wAaQMcAgwDogJpAlkC7wE1AkoCCwI6A8sBggOUAegC' +
          '/QHjAtcBGgN+AbACdAKnAjkD8QMhAzoFJQPPBHoC8QPlARQDIQM+AhcDtwLEAq8D6AMkBEID/wO0AcMDzgEnA9ACAwL4AtUBvgLnARECQAF7ATEBLAIJAmECOwKJArMBDgMhAiACtQKGAZsCUAJwA7kCOwRvAl0D' +
          'lwGDAqoBDwLUASEBegCHAHf///+f/5H/vACK/8IBU/+GAYf/AQHW/24BBQCfAfz/dgGI/7oBOv/iAZ7+JALi/u8BHwCmAa8A/wAWAXv/AgHF/iUA0f6g/3//Yv/B/17/Mf+1/4b/7/+F/4EAMf+VAFT/cf+J/6b+' +
          '/f+b/kEAuf7aARH//QKJ/zECbf/WAUX/HgHH/48AbQC9AIMAdgD7/2cA9f+PACcATQDa/7AAQ/8sARn/JwEkAMgA5gAuAB8BkAA4AdoAWgCAAe//eAEFAcoAgQH1AIAACgCcADEAbQFEATUB3AEwAfcCpAHXAxEC' +
          'TAMRApwCnALgAkADdgJ1AuwCvwFaA8sBhQMdAjUEQQJcA5UC9QJ8A0cDQgRnA9UE6QKgBPgC2gOqBNID9gQzBLUEFAR8BK8DtwOcA34E2QNuBY0DiQUHAykF2AIIBdMCcQUhA7IE9gKWBNsC1ASWAy0EUQRQBIUE' +
          'PATXA8UDLgN1A9kCXQMOAg0EgQGhBMIB3QPcAUgCrQF3Ad4BXAEYAvIBtQG4AiwBvAIlAT4DEAEuA8QAvgGMAJQBawAXAhMAFgLe/zkCHgBmAigA4wFvADMBFgGeAXwBswEUAV0BRQBoAcH/WwE4/2EB9/4tAdn+' +
          'NgGr/tMBsP4CAjD/2QAnALb/SwC+/9f/BABOAG8AmwAqAeH/PQJZ/4QCLv8YAc3+1P9h/ur/tf6GAOn+8AD7/nwBg/9+AS7/UQC8/vH/h/4mANL+ggBh/38BEv9YAcn+uQCP/jkAp/7z/9b+yf8A/2v/cf80ALD/' +
          'aQA3AD8AkgCpAEIAtABa//wAdP6aAFz+RwB2/hQAP/7Y/yH+NACX/tb/F/+//wP/2P/y/v7/Gv9DAGb/UwDU/60AvP8JAKX/9v8KAOP/SQAh/zoAXP8SALr+OQBu/k4AI//A/4f/O//8/0T/CAAV/7f/rf77/qH+' +
          'W/6W/uH+pv7X/0P/fgASANcANgCRADIAqP+sAA3/cAB+/+b/GgBMAEoAiwBAAD0AwP8yAFP/RQDQ/yQAVwC2/wAAif/w/+X/mP8NAOv+7f94/77/yP+X/1n/nP9E/77/KP+6/3f+Fv9T/pH+SP8d//T/m/+f/4L/' +
          'CP9I/9L+PP9u/oX/h/7T///+3v8//6D/kP/c/2T/1P8s/+L+Zv6L/v79jv7B/o7+LP/G/in/w/6j/rv+4v7a/kz/Bv8D/+X+Tv+7/jD/yf7d/gz+of6E/f/9Kv7D/XD+ef0u/of8Nf6R/LH+ev3D/h7+CP7F/rL9' +
          'Vv4W/kT+kf56/kH+zP22/X79sv3V/Hf92vzf/CP9bvwY/df8a/20/VL9Ff4l/S/+Qv25/Zn9Rv1g/Yz9EP1c/fX8u/xD/Uf8Sv2+/E/8xv0j/L79Wfxu/XL8Rf13/DX9KP1b/fX9ev2d/QH+dP1R/lL9E/5x/c79' +
          'v/3Q/RD+yP0T/ur9bv2r/jn9EP86/eT+Mv3o/h397/5i/aH+sP2e/tH9qf44/i3+/P0S/nL9s/5V/Vv/N/1d/5X9a/9n/uX/z/6h/yj/Mf/V/pH/i/67/9b+KP8T/i//z/02ABX+hgA3/hYANP8PAH//2P9O/+z+' +
          'qP9F/nf/0f4W/07/p/72/hn+zP5h/qT+//58/tL+2f4y/lD/df7M/5b+UgA2/qcA2P7LALD/XgDU/57/Mv84/4r+T/8Z/tn/vP34//n9X//F/tD+3v7E/vz9hP4a/vz9Cv50/nX9F/9s/f7+nf3L/nj+0f74/vL+' +
          '/P7c/o7+x/41/q7+/v2F/nT9j/6a/cb+l/3h/r79kf5E/j3+LP5I/uj9L/7h/b79Fv7W/az+cv4P/5L+q/5y/mH+kv7v/bf+q/22/t39t/4q/u/+7/4p/zb/EP8e/+X+fP4E/7n96f7k/cf+Z/4Z/0P/Pf9R/3z/' +
          '3P5LADD/+wBb/5YAmf/q/wUA5f/0/7D/8f/M/ykALwDI/zcA8v53ACD/uQCy/7IApf+HAJn/mQAt/yIBtP7WAW3/HwJlAGoBAQBgAKj/NAC2/6UAFv+nAF3/RAATAGoAYwAfAcUATgGXANYAzP9/ABj/KgFg/0cC' +
          'wv9KAkcALAIxAbwC7gDjAur/XQJZ/ygCE/87Ajn/CAL2/xECmQD7AZ0BiAG0ARUBsADGAMUAVwC2AA0A+gCUAEEB1wAdANEAtv/3AEcAHgGGAMEBbwA+ApsAXgJjAa8CrAHsAtwAXgK1AE8B7gDxAL//2gD4/sUA' +
          'FAAxAeIAFAHQAKwAigHaACoC2QB/AqcAbgK/ANgBLgHgAVQByQENAVMCCwGVAiEBZwFpAccADALEAGYCrQDmAcIAYwEZAaoBeQHBAbsCagG+A1IB2gKyAZgBHAI3AegBCwFYAU4AAwFNABQBxQB2AdkAnQHJAB8B' +
          'JgCrADEAlgDaAGUAEQH5/14B//+YAdIAnAEWAeQBeQBsAbr/VwAT/+H/S/97/+D/CADq/2kB0f/EAdL/PgGa//gA5/78AJL+dwDl/iIAd//GAEMAeAFzACwBEADMAJX/5wBq/4oAsv8dALP/OQDX/5YA9P+5AMf/' +
          '5QAaAA8BpwDxAI4A7wD6/70APQBuAM0AZgBIAFgAtf8gABYA9f/gAB8AAgGXAI8AAAHRALgBjgFmAuUBWgLbAQcClwHIAYABKQJcAScCDQHjAesAYwIkATEC3AEWAkIC2QIYAkID5wHRAgoC/wEOApQCsAFsA6QB' +
          'jgPwASwEZQJcBHACcQQiAqgDYAIwAuEC8gE0AxMCqAOtAk8EdgOrBCEEhQQwBBQEtgPrA4wD5AMcA5IDEwNqA9oCZgO9AjQDbQMLAzkD+AJoA8ACNwTAApcD+QIHAxUD6gJRA+ECzAMxA/gD5AJvA/wC0gL6Al4C' +
          'pgLRAWsCbAE5AnEBWQJeAZ0BGgHrAFgBawG1Aa0CyQHLAqEBRAKMAT8CiQGkAS0BzAH4AFMC6wDxAZgAUQFeAM8AYwBUADoAAQARAKz/FgDA//D/AQCe/37/jP+f/77/KgCb/5cAV/8BASr/nwA7//z/tf+t/+f/' +
          'x//I/1oArv+wAKX/lQCL/5oAHf/2/6D+gf9u/rj/Yv50/1T+RP9p/pH/tP6w/w3/NwBH/0UBH/9BAa/+KgG9/rIA/v4jAOP+TQDx/joAF//dACL/wQB6/wAAwv/a/0f/AAC2/jwA2/5GAFD/hQCC/3sAW/9kABD/' +
          'rgD//gUBpP9hAAEAsP9j/zoA/P7QACH/7ACH//IA7v80AQMAoAH0/6MBGAC2APj/0gBg/1kBQf+4AIn/WgDj////RgBLAE0AhgAsAEkA+v9uAJf/eABH/5oAlP+9ADAAigFDALoBGQAhAQ0AKwEIAOgAEAC2AAsA' +
          'oAD6/4AA4/9RABIAKgB1AGEAJABpAF7/2ABP/0QByv+5Afz/TQIjAAgCqQBkAQwBigBBAVgATgG1ALsA/wBeAFcBpgAgAbcA5gBcANYARQB+AIkADgBCACkAxv8VAaz/zQFz//oBJ/+lATz/GAF2/wUBXv+eAJf/' +
          '+v8rAIH//v8R/4r/vf+C/6QAn//6AMv/HwHJ/4AAov+m/3b/b/8n/2b/6P7x/tT+df6e/gH+Lf6H/Qv+g/1Q/jX+Uf4E//f9sf69/c/9tP3G/XP9Bf5k/V3+0f14/vD9xv3g/dP9o/0y/kb94f1P/Xb9eP1y/eH9' +
          '2v3e/ar9Pv0c/QH9cfzx/Pb7+vxY/CT9Y/1s/Vb+7v1+/gj+h/6u/XL+qP3w/aH9lv01/VL9Xf3f/An+4PwN/mH9Sv3M/e/8Lv4v/QH+DP1u/dD8Wv1n/aL9cv4C/r3+Bf5F/s/99/0t/jf+df6s/r/+0v7//s7+' +
          'p/69/u7+gf7l/lv+JP5x/tv9rv4C/j3/5f4AAJr/LADM/6H/JgBD//P/b/8R/5f/bf6F/5P+ef+C/m//Cv5Y/2D+af/E/pD/Hf+n/5H/vf89/97/G////2v////A/z8A7f+gAJP/mwDg/o8AHf6+AOf9zgBd/oIA' +
          '0P7g/7b+GP8B/+L+e/9C/03/W/+E/0z/a/+h/87+OQB2/o4A7P1pAKX9QADt/YQARf7XAB3+FwEg/k4Bcf4YAQP+nwBU/UwA7fwzAH/9JgAr/uT/m/1i/6b99v58/tT+gf7F/g/+ev7c/RP+q/0s/rH9dv7S/VP+' +
          'f/0x/iH9XP7z/Ij+2vwR/wr9gv+A/fP+lP2G/mz9mP5X/Vb+a/0b/uD9Jv60/Rf+Rv38/U797f0v/Zf9Uv38/Lb9wfy8/SP9dP2p/SP9C/7n/CD+ovz3/ZP8zv3G/Lv9Fv3j/bH9/P3T/Rj+T/2c/tn80/7I/B/+' +
          'V/26/cL9Zf5R/qr+8/5A/vj+I/71/un9WP44/QD+UP19/j7+9v6v/lj/sv40/+r+9P4T/0v+BP8X/h7/0/5C/wP/Gv9E/4r+eP9M/i//m/4//nn+bP2z/gT+AQCt/uMArP6qAIH+kAB5/s0AzP5xAOr+KwDt/nIA' +
          '9/5kAL3+FADE/vP/t/7i/4P+2/+0/hYAvf6ZAMr+zQBY/5EAsv/yAD3/7wH0/j0CSv/RAb7/qQF9AK0BCAGCAdoAVgE+ADQBJwA5AfIAfAGnARwCsQGSAk8BRgIVAfgBFwFCAu0AbgLFAAsC2wDLAUgBIgIIAokC' +
          'LgJzAswBHwJRAUgCtwCSAnAAPwJTABoCZwBDApwADgIFAeMBowGHAdMB+gC5AfcAyAF8ASYC7QEkAsIBowF8AW0BXwFbATEBFAEVAQkBHQFqAWoBMAG8AYgApQGIAOcA/QDr/6kBx//oAfT/RgGb/7oAbP+ZAJr/' +
          'EgDT/1b/1v+O/8f/CgDv/z0AUgCuANkArgDNAKgAFwCQAIv/KAB7/0MAmP8yAHr/sP8n/1n/vf5o/4P+Qf+f/hX/vP6O//H+BAB3/08A5/+OANf/uACq/9QA4/+eADEA6P8+ALz/bQBNAKoAcgCVADwAWwAOAAoA' +
          '7f/R/9L/3//B/yAAxf9xAEsAnADhAMkAGgEFAYIBMwF4AWYBKQFrAeAAKgHJAAwBHwEIAfUAyABgAJkAVQC7ALoABAElAVwB3QGQAYoCqwHoAvcB0wJjAuQCygJ9Ay0DJANqAx4CNAOCAbICkQFkAlgCMQLpAvkB' +
          '6gIwAg8D4QIBA1sDsQJHA9AC8QJFA6kCegOtAlED/gLUA2QDJgS4A8UD9QN5A/8DDgOOA9IC5gJMArUCPwIYA9gCewP6AmsD6wIbA6gCwgLQAkoC1ALyAUsC8gFEAs8BhQKqAdYCAQK/AlICHgIgAtYBxAFPAvAB' +
          '+gJTAuwCIgKaAqgBPgIpAaUBpAAcAVwAlABbAGYAhABrAJYApACNACUBkgAZAYwA2QB6AOAAhwDzAKIAtgCXAIAAdADjACsApwDc/+r/2P+G/+T/8v7c/xL/0P/w/5//aABH/zwA5f4JAJb+DgBF/vD/Ff4aAFr+' +
          '7f/R/sT/I//w/1D/j/9w/33/if+q/4T/g/+k/43/9P+2/wAAqv+g/+n/IP9DAB7/wACd/zcB1/+uAE7/0/9a/vL+sP2f/o79/v4B/o//qv7FAPz+fgFJ/z4Bsf+bALb/+f9F/9P/7/5AACj/kwCi/30Azv+qALL/' +
          'aADb/xkAPQCtAPX/GQEA/0YBhf5ZAQP//gC+//IA2f8WAbb/jgDN/6gA4P96AQAAewFUAEIB1ABcAR0BbwH1ANkBkgCIAjIAaAIuAOsBrwDAAVEBgQFoAXYBKAFWASUBBQELASgBogDJATkALAIxAAMCZgDgAVcA' +
          'iQEiAGgBSADLAesAHAKbAXoC6gFxAu8B9wHwAXcBBQIIAegBLAFqAWMB9AANAd4AsgD9AN4A9wBlAbAA1AFyAOsBjwCqAdgAYwEJAWgB9gDdAbcA/QHGAIMB6QBHAd8AFQH4APAAJQEpATYBAQEpAZUAIQFdAAoB' +
          'RgDGAHIArAA9AKIAEwAwAGMAm/9YACj/MwDa/vf/Bf8KAIX/fwDg/4sA/f8WABEAVv8NAPn+yf/s/r//RP/f/y4AjP9yAAH/k/+S/gf/Nv5A/yz+9P60/qT+Bf/t/mn+Pv/A/WD/1v3j/iX+Ff5E/h/+cf6i/rL+' +
          '6/7H/kf/d/53///9bP/5/Sv/Wf6w/qP+Zf6+/nr+x/6T/sn+d/63/rv+qP6+/rT+o/59/kr/P/6u/5/+wf8o/5//Mf9J/+b+Dv/L/rn+v/6h/o3+ev67/nr+KP/g/hT/M/+s/qH/rf7I//v+kf8F/1H/FP8u/0r/' +
          'dP9K/9b/Sf8JAET/BQAP/6L/P/8i/xQA8/6jAFn/JAAFAGz/NgBR/+n/SP9w/z3/Vf9r/4T/Yf9Y/0n/NP+f/5b/1f/j/13/fP8w/2L/yv+6/xgAu////7D/LgCG/2QAZ//9/2j/jv9q/77/2v/Y/xAA7P+U/0cA' +
          'Ff8yAAn/uP8t/3H/yv5Q/4H++P7z/uz+Wf+M/1f/3v/5/pf//f56/x3/uv+m/sz/dv5y/53+Jv/y/vr+IP/L/vf+Cv/N/nP/eP5E/0L+uf4W/pj+Hv7Z/kX+v/79/Xr++P2j/i7+uv7s/Y7+rP2c/g3+1v46/uL+' +
          'Av7Y/gn+xv73/Xn+/v1f/j/+mv5G/qf+H/6g/rr9tv4H/ar+6fyi/mH9//6o/XD/K/5u/97+NP/M/hz/Hf7g/qj9a/6J/Tz+3/0m/jD+Bv5b/mD+m/7S/iT+tv5W/Vf+BP1i/jX97v6T/VD/Ev47/5j+GP+5/gr/' +
          'gv7t/jH+4v44/uz+kv4G/6v+Tv9I/oX/MP5n/2H+Ff9L/vz+Wv46/7/+Vf8d/y//Bv8V/9T+Kv+w/mH/pP6i/6n+1v+6/uT/+f7w/9T+EQDD/gsA6P77/+L+FwAb/wQARP+X/1f/WP8+/5n//P7Y/0P/wv96/7z/' +
          'f//p////6P9xAL3/PACu/xcAlf9OAJH/5v/Y/0j/CwDs/kAA5/6qAEj/tQAy/0QAEv8EAGn/KQCi/1EAwv+BAOj/0ACo/8EASf9NACn/OABI/3AAmv9cAKn/NgBn/1EAdf93AL3/jwBk/7EAS/+wAK7/igC8/4gA' +
          'o/+CAG7/XgBb/1QALv9hADr/UACz/wwAyv/m/6L/7/+X/+T/fv/U/xb/CQCp/mgA6P6RAKX/nAABAK8ACQCfAOD/OACS/67/YP90/2X/jv9q//P/Lv9nABz/XQAl/wcAWP/E/7D/lP/L/4f/sf+d/53/3P90/xkA' +
          '6v4YAMb+/v8I/9H/W//C/8P/6P+6/wQAf/8mAFz/HgA7//X/P//d/4T/yf/K/+H/vf/c/2//vP8N/7D/6P6h/2T/ov+9/23/kv89/8D/df/T/8r/yf8IAAoALwDu/3EA0P/KAKv/+ACT/7wAIwA2AKUA5f/KAMH/' +
          '7wC2/wAB2/+BAP3/BQD//18A3v/UAMf/CwHA/zEBxP8kAQYA6ABPANUAZwDeAIUA1ACyAPcA1QASAfoANgE8AVEBdQFRAXIBXgFBARkBAAEtAbkAgAFgAEsBHwCSARAAQQIhAHsCXQCHAp0AEQLsAFgBQgEKAVoB' +
          '3QBkARcBfAGLAYwBmgFvAa0BGAHnAQUB1gEuAWYBFwH/AOQA+QD9AGwBKwHNAQYB5gHSAA0C6ADTAf4AigHOACkBlgCBALwAdgAdAaMAUAH9ADkBlQH7AKIBygCJAc4AjQH0AGMB+QD3AO0AvgASAdEAKwHYAAsB' +
          'AQHnAOsA4QAaAcYAkgFxAHIBTwB8AXcAXAGxAM4AAwGPACABiADSAK4AdgDOAIEA2AC4AOAAvgDuANMADwHaAPAAlQDHAHQAAQHjAAgBhQHHAKIBwwA8AdIA0wDqAKoAVwGfANQBigAEAlYA/gE2AGQBgADSAOIA' +
          'ywDqALIAwADZANgALAEhAW0BKgHQASAB6AE1AXUBRAH6ADMBsQDuAJwAjQAOAUQAkQFGAL8BgADeAaYA1gG0ALcBzgCXAccA9wCcAIYAmQDeAMYAHAHyAEoB7AB+AdwAtAEFAfsBHwEJAtkADgKnANgB8ABSAR0B' +
          '5gDcAPAAoQBpAakArQG/AJ4B2gBmARMB/AAZAZsA0QCnAHwAHgE4AIwBLQB2AV4AAgHBANwAGwHlACwB6wALAT0B4gB6AeMAgQG8AHcBNgAmAeD/vwD+/40AQwCLAGcAwABpAD4BYwCuAVAAoAE3AEUBCwAGAdr/' +
          '2ADT/70A5P/tAO7//wD7/64AMACqAIsAuwDWAGUAAgE6AAkBWQDZAH0AggB/ACYAawDy/1cA0/9KAK3/GQDG/9v/CQD+//3/VgC//5IAo/+nAJT/iwCN//z/uP+f/xUA1f9gAAcAVQAvACUATQARAK4ABQDoAPL/' +
          'igC//14Afv97AF//EgBV/yX/Yv+k/mP/h/5M/7b+Qf9L/x//nf/9/rP/Kf/5/2//RgBX/yAA2f6j/5b+ev/M/nX/Hv9P/0f/MP8y/zH/EP9X/yH/Zv9a/4H/lf9r/+b/Lv82AB7/LQAR//n/gv/Y/w4A4P8hAAIA' +
          'UwD//54A5f+QAK3/PwB0/5z/of8Q/+f/C//R/zL/gf+E/1X/9/9Y/xIAZv8NAIj/RgCt/yUAnv/S/3T/1f+C//v/vP80AO7/IQAEAAAADQATABIAAQDu/9j/pv+5/4D/xv+e/y4Azv+vANT/4wDM//QA/f+xADcA' +
          'BAA2AMT//f8XAJX/LQBd//f/YP/g/0f/2v9S/73/jv+b/8X/mf8CAMv/JADd/woAf//a/1j/w/9w/6n/WP+H/2L/uf9X/z8AOP+SAEz/aQBi/wQAiv+T/6b/RP+U/zv/mf8T/5v/zP5z/9D+Ef8T/8X+O//E/iD/' +
          '5f76/nP/1P7K/5v+rv+R/lH/5f6q/lD/m/6S/9r+nf+//nr/m/5Z/3X+dP97/tv/8f5XAEb/fwD6/jgAqv7O/8b+YP8T//v+TP/F/gj/vf6z/un+4P4h//H+Nv/g/k//6f5l/9T+Uf/C/if/pP5B/4z+h/+n/pH/' +
          'qv6Z/6v+lv/i/jP/s/6//k7+pv5v/tX+qf7y/tv+DP8X/1z/F/+3//T+9P/2/sj/6f4+/4z+4v5m/tv+Y/7+/jL+Sv9H/q7/gf7K/7X+gv/j/j//+v4x/xv/Jf9B/x7/Z/9Z/1b/rP84/8X/Mv/R/xT/7f/g/vH/' +
          'jf7S/4X+vf+y/sz/rv7g//T+6f9n/8v/nf+b/6D/hv+L/5n/kv/S/5b/+v+M/+v/tP/e//D/4v/e/8T/mf+b/4v/lv+E/7P/Kf/h/7f+4/+p/rv/+P6w/1T/xv+h/+P/7P8CABcADAAMAAYALwAYADQACADB/7P/' +
          'ZP+L/0f/o/95/4T/0v86/9b/P//E/3z/3/+S/+//oP/x/8T/FQDj/0EA1/87AJf/EwBp/+b/fP+F/6z/Cv/D/8L+sv+R/qX/mv7P/9z+5/8w/53/ef9N/3T/Pv9Z/1b/P/91/1f/Zf9s/zH/Ef84/8z+if+3/sb/' +
          'lf7N/7P+xv8G/8v/D/+w/+3+VP+9/g3/qf4j/+P+Uv8B/yn/CP/a/g//0v4J/xP/8v5j/67+gP9F/mj/F/5i/0v+j/9X/sr/XP7j/7z+3P8A/+3/+v4NAPv+6v/8/qj/5P6U/9z+kv/q/nn/I/9b/3D/K/9t//P+' +
          'TP/m/lz/xf5//6L+U//j/tP+Wf+f/pv/8/6s/1T/7f+E/1kAtf+VANX/hgDM/0IAwv8gAOn/QgAoAGsAIgCEAPH/lgDE/3oAt/8iAMD/wf+7/3j/iP+B/4z/6//a/0EACwBHAJUAOAAJAVUA8gClAMkA4AC+APQA' +
          'yAAcAaYAPAF6AA8BiwCyALwATQC2AAIAqgAIALMALgCTADgAZgAyAFAAJABqACQAugA2APoARwDfAGIAugCHALMAlACPAGYAWQAyAHQARQDUAIMA6QCvAM4AuwDHAL8AsACiAFcAQAAtAAUAlAA8AN4AkQDTAI4A' +
          '3gBAAP4AGAAdATwADgF7ALQAkABpAJoAWADVAIcABgHCAAcB7AD1ABEBywD1AIYA4ABAAPEAFgDQAB0AnwBIAKcAiQDoAMsAEAGgAN8ALwCAABUA9f9cAFf/nQA8/74A4P8EAdcANwGUAf8A4AG8AMoBugBNAasA' +
          'pQCDAJ4AiwDbAKEAwACaAL8AkAC/AHoAjABLADUAJgA/ABkAzgAcAEEBJwBFASQA+AAQAOQAFgDjAFIAowB5AG0AZQA4AFUAJgBaAE4AWQCKAEoAwQA3AN4AHADnAAoAxAACAK4A4f+JAPH/HgBYACYAowB4AJ0A' +
          'eAB0ALoAbQBPAYwAaQGgAOsAqgA/AKEA6/97APX/ewAbALwAnADuABEB3wD6AMsAqQC+AIMAlACdAIIA9gCzAGUBuwCeAU8AoAHl/1EB1v+gAAEA/P9RAOT/wQAuAAYBeQDjAM4ApQAaAYcASwF+AFEBmgBIAeAA' +
          'SgEJASkB3gDvAI0A4wBZABgBMgB1ASIAwAFCAL4BTQCMAVYAaAGAAE4BgAD1AGYAswBrAOIAoAAlAeoAQAETATcBFgEhAQsBEAEBAQoBFAHeADABwAAdARIBBAFLAQ8BKQHnACgBawBcATIAdwFeAFQBUwApAQ0A' +
          'GgH6//4AGADiADMA4gBaAOwAiADzAJ8AzwCnAIsAlQB1AHEAowBoAMsAgQDuAIEADAF0AM0AjgBtALQALgCzAPT/aQDO/xoAxv8PAAoAHwCFAEUAuABzAJoAjACtAJwA+gCEAP0AOADFAPv/dAAFAB4ARQD1/1gA' +
          '5/8DACkAof97AJD/TgCd/wUAkP8dAK3/OgD7/xcAJAATADoASwB0AHAApABoAJ8AaAB/AFIAawAaAHYAEgCbADUApgBsAGcArwAXAMoA6P/eAMD/yACq/14Av/8YAM3/MgC9/3AA2P+QACgApgBoAIEAjAAdAL0A' +
          '6P/pAPr/0QAvAIgALQBPADAAKABRAP3/aADM/08Axv8GAMv/6/+m/9z/df/t/1b/HABn/zMAo/8vANP/FwDj//H/4f+q/+f/nf/1/8//8P8CAOz/OQAFADAADQDX/+H/mf+9/3H/5/8T/yoA2v5VAAT/YwBE/zoA' +
          'mP/8/wsA0f8OALr/jf+a/zP/Yf9q/zH/v/8W/9X/F//q/x//4/8X/7X/Kf9p/13/Kv+F/w3/jP8V/53/ZP/A/67/x//o/7D/9P+M/8//nP/X/+T/6f8MAPH/GADm/xMAyP/9/6j/6/99/9j/mP/O/9T/tf/H/5j/' +
          'oP+w/7n/0f/4/7P/9v+N/wkAof8zAK///v+S/6j/jP9d/73/Pf/Y/3D/wv/K/7L/GQDG/2IA/P96AEIAJQB9AMT/eQCR/0cAcv8mAHH/AACl/73/4f9+/9z/bP+P/6H/Sv/z/1D//v9O/8b/MP+M/0X/Yv+K/zr/' +
          'qf8a/3r/Pf9C/5f/Lf/q/zD/BwA9/+v/U//a/5n/5//U/+7/of/u/1T/AwBN/yQAbf8eAJv/yf+x/1H/lf8S/5P/L/+y/4n/mf/a/3P/CABz/xwAgf/9/4T/y/+B/6z/hP+E/3b/Uf+L/1L/sf+B/6X/gv9p/4D/' +
          'M//V/0L/QQBY/2AAdv9WALv/VQDa/yIAzf/D/8T/jf/H/5n/x/+4/8L/tv+4/53/pf+L/4T/gf9m/3//hP+I/9n/of/4/9P/wf/k/3D/uP9b/6z/qv/B/wMAwf8tAOD/RQATACEAJwDI/ywAsf8WAMn/0f/W/53/' +
          '6/+t/9r/sv+l/5P/gf+M/3b/m/99/4z/ev9y/2P/k/9i/9//q/81ACAAfABUAIAAOwBFACMABwDy/+3/m//1/2v/BABv/+P/Zv+t/1X/p/85/7v/+f62/+b+qv8T/6L/Sv9t/3X/Gf+Y/+r+qv/+/o//Sv9b/5f/' +
          'Pf+k/0//e/9m/2H/SP9e/yD/RP8T/yH//v4H//X+7P4a/+X+Iv/h/gj/3v77/v/+7/4p/wP/Pv8K/zn/w/4r/5L+Nv+s/l7/wP56/7P+a//H/l7//P5r//T+dP/W/lf/+/4s/yf/Ov8h/2z/8/6K/9v+dv/r/kf/' +
          '3v5K/8j+ZP/w/lf/AP8+/+T+P/8G/2P/T/90/2z/Xv9I/z//Pf8k/2j/N/+E/3H/fv+t/23/3/+F/+P/qv/S/63/yf+7/6v//P+K/0kAk/9YALL/IACs/9n/mf+Y/6b/X/+0/3f/r//o/6r/RAC//1sA1/9VAOP/' +
          'QgAXACIAYQD4/3cA2f97APn/kwA5AKAAXwCRAKkAjAA6AYsAXwFkAPwAPgDhADUA+QAvAMYANwBcAF0AGAB8ADQAbgCaAFQA6QAuAOcA///mAAQAyQBBAIQAgQCWAJ8A8ACiABwBnQD5AJAA7wCIAPgAiQDXAIEA' +
          'owBzAGMAdABUAIYAfwCeALoApwDtAHwA4gA8AKgAMwCZAF8AoACJAIoAfgB1AG0AbgClAHkA3wCBANkAegDDAIUAvACuAKkAtgB/AI8ARwB6ACkAdgBTAFUAhwAYAGkABABFAAIAZwDq/24A4/8qAOj/7v/e//f/' +
          '4f8dAPj/IgDo/xkAz/8OANT/CwDs/wMA1f/b/4v/1f92/xgAlv9OAKX/MQCQ/+7/pP/K/+j/3P8EAAcA1v8NAKj/7/+v/9//v//j/9f/1f/z/7D/8//B/9b/JwDw/5kAQQDOAFIAxABFAKsARwCgAEAAhABAAFYA' +
          'KgBDACAARACOADAABAH7/wgBsv/JAIH/kwCJ/14Awf9AAAcAbQBHAKEAjgC+AN8A1gACAeYA+wAPAREBNwE8ASoBNwEGAf8A7wC9APMAgADrAGEA2QBkAPYAVwAmAVMAagFrAIIBTgA7Afv/5gDl/9oANgAeAaEA' +
          'OgHQABYBwgAGAZsAMAGBAFMBfgA8AXYAJAGAABIByQDUABIBkwAFAZkAtwC8AHAA1gBdAPMAZgAKAU0A8AAjAK4AFQB6ABwAYwAPAF0A5P9KAPD/NwBUADgAogBBALAAeAC4AMkAwQDbAMcAwwDRAJIAyQBBAKQA' +
          'BQB+AOn/bQDW/0gAz/8ZAPH/HgD8/zYA1f8dALT/5v/W/+X/KAAwAFsAYwBwAEkAXwArAFYAOQA+ADQA3//8/7j/2P/t/93/LgDg/1MA5v9UAOf/RADk/yQABQDn/ywArP8YAHz/3P9Z/8n/X//u/4//+P+y/8n/' +
          'qf+7/5n/2v+Y/+P/2//X/0MAy/9hAMf/QADj/xcAEAAFABIABADh//H/vv/U/7v/rf+h/3v/d/98/2P/pf9l/+n/jP8rANX/IAAWAN7/IwDA/wQA1v/X/+D/n//h/37/2f+V/7P/tv+R/7f/mf+4/8T/u//p/6v/' +
          'EADH/yAAEQAPACcAEgD4/xwAvP8TAIX/6P9x/7v/lv+//63/6/+i/ywAxP93ACgAfgBtAEcAZQAjAE0AHABCABgAPQAWAEgAMgBaADsAXQBLAFUAhAA8AHoADwBEAPv/GAAoANv/dQCb/5MAj/91AKX/PwDG//z/' +
          '8//N//v/v//9/7X/EACo/w0An//x/7H/2f/Z/93/+v/p/yYA/P9jAAUAjQDu/4UA6/9wABEAdQAsAG0AOgBHACYAHwDW//P/hv/J/2X/wP93/8z/jv/Y/5r/7f+4//D/2f/J/+X/nP/P/5v/rv/A/5//6v+L/w4A' +
          'cP8YAFz/AABo/+T/i//d/4//4P+d//b/rP8nAIz/OwBQ/wwAOP/R/2P/vP+S/6H/zP92/wgAjf/7/7z/q/+l/2//f/96/4j/of+R/6v/gv+m/4P/xf+g/7//rf+C/67/T//L/0j/3P91/73/gv+Z/4r/m/+1/7P/' +
          'jv/C/y3/1/8f/+r/Vv/c/57/vP/e/4//6f9Z/8P/Wv+G/5T/Zf++/57/vf/v/7L/7f/C/9f/y//Y/7T/4/+v/wEA0P8GAO7/7//u/9H/5f+k/9r/eP/P/3f/xf+W/6v/of+T/67/lv/Z/5f/9P96//n/aP/1/4z/' +
          '3P+5/5b/zf8+/97/N//z/1n/9/94/+H/jv/O/2z/xP9c/7z/gv/D/83/uP///4//8P9r/9T/V/+Z/1n/O/91/w3/qf8p/9T/Rv/U/03/vP9m/6v/hv+y/3f/wf86/6//Gv+S/03/n/+f/7H/wv+g/7//h/+Z/3f/' +
          'Tv9s//3+Yv/j/mP/DP93/xT/jP8j/5H/Uf+W/3X/of+n/7P/tv/M/73/2P/G/93/pf/t/3P/AwBH/wkANf/w/zz/2v8//8b/Pv+k/0L/if9T/3z/jv+P/+z/tv8xAMb/NwC7/ykAvv8GAOn/2f8WAL//NwCX/1gA' +
          'i/9aAKf/PwDR/ykABAAiACEACwAqAPT/JQAbAAkAUwDl/1oA2v9NAAwASgBsAEAAcwAXABgA3P/d/9D/4//3//H/GgDt/yMAAAAaABsAGQAxACAAUQAXAHEA/f98AAIAWgAlAAkAOwC1/y0Aqf8GAOX/9f81APL/' +
          'WQDL/zQAmf/y/5b/zP+3/8j/3//Z/+f/6/+//+z/ov/i/7D/3f+t/7r/fP93/17/UP9+/1H/n/+T/5n/1f+c/8//rv/Z/6z/0/+e/6P/iP+H/2//gP+A/4j/nf+H/4P/mP9V/+b/Y/8dAKn/BQDP/9b/zP+z/83/' +
          'kf/J/3T/p/+H/27/tf9F/8D/U/+R/5v/Uf/i/zT/9/88/+T/f/+x/9L/hv8NAJL/QgDH/0QA6/8pAPX/BAALAML/IwCs/zAA2P8rAAoAAgAUAOb/BAD//+n/HQDK/xkAqv8BAIb/+P+V//H/2f/k/x4A5/9JAOb/' +
          'PwDY/xsAt//+/5f/BgCW/y0AqP9CANv/PwAzAEgAdQBWAHwAUABXAFIAQQBnAFUAbACFAG4AqwCLAK4AsACdALsAewCpADQAjwDr/4EA6P+GACUAiQBhAF4AdQA7AGoASABxAFoAjgB9AJUAqwCHAOcAmQAVAccA' +
          '+ADFAMwAjwCrAHgAmwCJALgAoADjALsA4wDDALoAtQDLALUAAwG+ABcBrAAJAZUA9gCfAOgAxQDMANkArgDHAKAAogC5AIgA6wByAOsAVADLAEgAvABZAKsAeQDBAIAAAQFtABsBbgD6AH8AvACWAJQAqwCHAJwA' +
          'iQBvAJ0ARwC/ADMAxwAjAKQACQB8ABIAVwBHAFcAfQBuAKcAhQDIAKIA6AC3APEA0ADKAOoAhADuAFIA3wBKANgAXgC8AFwAfwA2AFIANwAwAEgAHQA4ACUAMQAkAE4ALgBuAD8AcwBLAHEAbABLAIoAFQCMABYA' +
          'aAAzAEIARwA6AGYAOACSAEEArABSAKMAZAB/AGcAVQBMAEEARgA/AGIASQB+AF8AfwBtAHMAaABzAEUAdQAQAIQA6/+hAN3/gQDm/wEA9P+b/wIAoP8yAOL/cgAeAIcAOgBvAGUAYQCFAFkAeAA2AF0AJgBDADkA' +
          'IwA5ACoAIABnABwAmgAqALEALQCPADcASgBLACYAUwA0AFkAWwBrAHcAfgCQAGIAmAA8AI4AQQB8AEsAcwBRAHkAZgCFAHoAjABsAHEASABHACAALgAHADMAGAAtADEAKAA3AD4ARgBZAGEAawBoAGkAXQBZAFYA' +
          'KwBRAP7/OADp/w8A5//z/wYA7/8zAAoAWwAqAFQALwAyABYAOgD8/0wABgA+AA0AHgDx/x4A0f8vAMP/HgDA//j/uf/Q/6z/tv+n/6//wf+3//P/4/8RACIACgAyAPP/EADi//D/5f/I/+j/kf/l/3T/4v93/9v/' +
          'nv/b/+f/0f8FALX/6/+w/9T/z//H/+r/2f/u//n//P/4/w0A6v8IAN7/AADf//n/3//s/8z/6f/O/+T/5//D//D/kf/d/4r/2f++/9P/6P+//+v/2f/l/wIA5v8WAOj/IgDs/yUA8f8eAO3/IgDh/ykAzf8YAMf/' +
          'CQDV/w8A1/8cANf/BgDh/9v/7v/F/+3/xv/r//3/CwBFAEAAYABhAEEAVQAhADIAHgAYADoADgBYAA0ASAApACkAUAAkAGgAMQCCADQAhAAyAEsAKAAMACMAEQAsAEQANQBuAEwAeQBcAGQAWABWAEQAVgA3AG4A' +
          'NACNADoAngA+AJwANwB7ACkARwAYACoAEQBAAAgAQQAMABoAGwAOABkAIgAIACsAAQAqABsAOwBBAFgAWgBfAE8AMQAeAPf/6P/Z/8j/2v+p/+T/j//U/4//yP+b//j/tf9MANT/YQDl/z8A2v8hAMr/FADC//7/' +
          'xv/a/87/yP+8/7r/iP+t/0P/nf8E/4z/8f6W/x//r/9o/7j/mv+g/6j/dP+7/1j/zv9n/8P/e/+M/27/X/9j/1r/ef80/5v/Fv+1/yj/vf9J/63/ZP+L/2T/eP9e/3z/Xf9v/13/Zf9a/37/ef+T/6f/l/+h/5P/' +
          'Y/9//xz/Xv8G/0//IP9S/0//Zf+N/3r/vf9//7//f/+f/4X/bv+K/0j/hP9W/5H/b/+6/3v/1P+N/8n/jv+g/4T/ef+E/3f/h/+E/4j/gf+X/4D/uf+O/8T/lP+r/4X/m/+G/5//kf+x/5L/tf+K/5L/ef+F/27/' +
          'lv+G/43/xf94/+v/iv/d/6b/0f+f/93/nP/U/7b/u//d/8j/7P/4/9r/JwDV/zoA3/8vANf/FQC+/w0Am/8RAHT/CgBx/xEAk/8aAL3/DgDb/woA1P8OAMf/CwDj/wgAEwASACIAEwAPAAEA+P/r/+b/7P/0/xkA' +
          'GABMACoAXgArAFEAGwBDABMAOgAQACkAAgAVAP//DgD6/xoABgAdAAgACwDt/wMA1v8fAM7/NADe/ycA/f8XAC8AHAA7ACkAHgAbAP//7v/d/73/2P+1/9T/3v+y/wEAj//3/4L/0f+M/8D/tP+5/97/rv/z/77/' +
          'FQDj/x0A8//w/93/s/+l/4L/ef9j/4v/WP+1/3T/vf+U/6f/sv+P/8v/fP/S/3b/1f99/8H/j/+2/7P/s//G/5v/rv94/4j/Uf93/zf/dv84/3P/UP9s/2f/cv99/3v/hP9p/3//UP+F/0v/lP9h/6X/fv+W/4z/' +
          'df+R/1n/kv9P/5L/Y/+A/43/a/+5/2v/yv93/8D/bv+2/1L/uf9b/77/jv+1/6b/vv+U/+n/lv///7v/4//K/6j/tP+B/6P/lv+p/8v/x/8DAOL/HQDk/xcA4/8FAPT/AAAcAAYAMQDu/y8Azv8tANz/HwAQAP//' +
          'KQDY/ycAvf8+ALb/UwDN/zQA9/8VABUAKAAdAEAAGwA7ABcAEwAYAPv/MAAYAF4ANgCEAEEAhQA9AGoAPgBEADoALgA2ADgAVQBLAGQATABHAD0ALABBADoAXABtAGwAigBhAIQATQB3AEEAYAA7AEoANgBBADUA' +
          'VgA5AHsASACNAFQAlABYAI0AYQB2AGgAYABpAFMAagBgAHUAggCKAJgAmQCPAI0AcgByAEsAXQArAEMALgAvAFEAMgB1AD4AdwBFAFcAPwBEACQARwALAEIAIQBFAEwAWwBSAGUASQBQAEwALgA9ACUAFAAoAPn/' +
          'LwD4/0AACQBgACEAhwAoAI8AEwCJAPX/bgDq/ysA5P/l/+7/yf8cAOf/RAAcAD8AMwAYADkA7P8/AMn/LADO/x0A9P8eAAIAEwDs/wAA1f/n/8b/1f+y/9n/sf/u/8r/AADZ/w0Azv8WALz/FgC7/wMAy//g/9j/' +
          'xv/S/63/xv+Z/8T/h//B/4D/vv+U/7//pv/F/7L/0f+8/87/1f/G/wMAzf8pANj/UQDa/2IA2v9SAOT/LAD8//3/DwDp/wQA1v/f/9L/wv/c/8r/4//r//z/DwATADEAGAA9AAYAIwDo/wIA1P/y/+z/8P89AAkA' +
          'jwAwALUARwCqAEQAeAA7AEAANAAsAC8ARQAwAGoAPgB4AG0AawCMAFUAeABLAEwAUAAwAFsALQCAACIAswAfAMQAMACyAEoAoQBfAJcAYAB7AG4ATACJACwAmAAvAIQARwBoAFMAZwBMAHMAUAB6AGAAfQB/AH8A' +
          'nwB1AKMAXwCGAE0AWgBOAEQAaQA/AIoARACLAEYAXABLADYASQA7ACYATQAFAFEAAQBUABwAagA8AHsAQABlAC4AMQAaAAwAEAAMAPv/FgDY/xMAzv8GAOT/+v/y//L/5f/d/9f/wv/i/7z/AADE/ycA1/89APD/' +
          'OwD//zEA+f8XAOH/9P/U/9z/zf/P/8L/tv+8/5f/r/+g/53/zP+c//X/tf8FAMz/AgDP//f/0//a/8n/wv+l/7L/lP+s/7H/t//W/8D/5//V/+X/4//p/9r////T/xkA2f8pAOj/IgD4/w8ACgADAAgA9v/0/9r/' +
          '3P/I/8n/2P/H//b/xP8NAMn/DwDa//3/5f/n/+T/4//d//r/4/8kAAgASgBGAF0AcgBdAHIASwBYACQALAD7/wQA9v/q/wwA4f8IAPP/7P8OANb/EQDd//T/9f/W/wkA0P8dAOj/PAADAGAABgBvAAkAYAAMAE4A' +
          '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' +
          'BAD6/wQA+P/1//r/5//7/93//P/T/wQA1/8PAOb/FAAAABIAEwALABsA/P8WAPX/DwD+/xQADgATABUABwAXAAEAIQAUADYANABOAE0AXQBUAGAASQBSADAAPwAYADIAKQAxAFgAOQBtADwAXQA0AEYAIgA7ABMA' +
          'PgAOAD8AEwBAACIAUAA3AGEATABhAFEAVQBHAEkAMgBAAB4AQQAXAEYAHgBQAC4AYgA6AHQAOQB+ACkAggAZAIgAFQB+ABwAaAAnAFEAMAA8ADUAMAAvAC4AGwBCAA0AWAAZAGMALgBkAC8AXgAiAFgAFwBUABUA' +
          'UgATAEgADQA5AAcAJgANAB8AGwAiACAAIgASACIAAgAhAPz/KAD2/ykA7v8qAOj/LwDr/yMA/P8KAA8A6v8XAOj/FgD9/xMAEgASABUAEgAGAA0A//8KAAMAGAANAC0AEQAtABoAFgAuAPL/LgDX/xUAz//8/9r/' +
          '9f/s//j//P/1/wcA9v8FAPj/+//3//X/+////wgAEwAdABgAGwAMAAQA/f/v//X/6v/w//D/7P/+/+v/HQDt/zQA+f8+AAgAPgAPADUADAAuAAcALAAHADYACAA8AAYANwAKACkAIQAdAEEAHABNACIAQQAmAC0A' +
          'IQAeACEAFQAiAA4AKwAMADsAFABAACAAMwAjABsAFQAOAAIADwD6/x8AAAA5AAcAVgAHAHMAAwB7AAQAbQAOAFsAGQBWACUAVwA3AE8ARwBAAEMALwApACQACAAiAO//JADk/yYA5/8jAPL/JgD4/zoA/f9OAAYA' +
          'TQAQADkAFgAvABgAMAAcACoAIgAoACUAKwAfAC8ADwAyAP3/QADy/1IA7f9XAOf/TwDn/zcA7/8GAPj/2f/8/9P/9//s/+z/AQDl/wgA5f8KAOL/EQDi/xwA5/8bAOn/DgDl////2//1/8z/6//F/+n/0P/w/+H/' +
          '8//o//L/4//1/9P/+v/C//T/tP/u/6T/6v+Z/9r/pf/A/8D/nf/M/5T/yP+s/87/y//c/97/3f/i/9P/2//O/8j/0/+1/9H/pf/A/5n/p/+U/5P/m/+Q/6r/k/+0/5j/sv+k/6n/sf+v/7f/vP+2/8D/s/+6/7v/' +
          'tP/H/7P/yv+u/73/oP+x/5j/sf+h/7n/qv/A/7b/xP/T/9D/7//i//X/7P/y/+v/6//n/+f/5//n/+T/5f/c/+H/1P/j/9P/5P/Z/9n/1f/O/8T/0f+7/9//yf/r/+f/8v8AAO7/DADi/xIA2/8ZAOP/HAD8/xYA' +
          'EgANACYABgArAP7/IQD5/xEA+P8EAP7/BwAJABMAEgAdABEAFwAKAA0AEQAKACYACAA1AAIAMwD1/yQA7P8VAPD/CgADAAQAIAADADYACAA0ABMAFwAiAPn/KgD1/ykAAwAkAB8AHwAtABIAGwAKAAAAGgD1/zYA' +
          'AwBGAA0ARAAPAD4ADQA5AAcALgABAB0A+f8MAPD/AADj//b/2//p/9r/3//f/97/5//i/+f/5f/f/+L/2P/c/9D/3//K/+j/0v/p/97/3//a/9H/wP/H/6P/xf+V/8z/oP/X/7f/4f/A/+T/xv/a/77/x/+w/7z/' +
          'of+5/47/uv98/7v/hf/B/6n/zP/F/9H/zP/L/8L/xP+x/87/mP/i/4D/7v9w/+3/bf/m/3f/2f+A/8X/if+u/5T/n/+V/6D/ff+j/2r/nv9o/5j/a/+Y/3v/nP+P/53/mf+j/4z/sv9y/8D/Yv/G/2X/wf9v/7X/' +
          'eP+s/43/pv+l/6D/rv+i/5n/sP9//8j/cP/e/2n/6/92/+j/l//d/7z/1P/H/8//wP/O/7f/0f+s/9f/oP/U/5v/xv+l/7f/sv+z/73/uv/D/8z/xP/q/8T/BQDB/xQAwf8RAM7/BgDf//r/5P/y/+X/8v/p//v/' +
          '5/8PANP/IAC8/x8Auv8RAM//BQDo/wAAAQABABMABwAVAA0ACgAPAPj/EwDx/xYA8f8OAPP//v/7//P/AwD0/wUA+v///wIA9f8OAOj/GgDi/xwA4f8RAOf/BQD//wQAFQAWABsALQANADMA9/8sAOf/IgDf/xgA' +
          '5f8NAPT/BAD//wEA+/8HAPL/DgDp/w4A5f8IAOv/AwD8/wMADgAJABoAEQAcAA8AEgAGAAMABgDr/xEA1P8eAM7/JgDW/ycA3f8bANT/BQDL//H/zP/l/9L/6f/Y//v/1P8NAM3/EgDP/wsA2f/+/+T/8P/t/+v/' +
          '8v/z/+3/AQDk/xAA2v8aANL/GwDa/w4A7f/5//D/6v/f/+j/xv/y/8X//v/e/wQA9v8GAAAACwD6/xIA7v8UAOT/EQDl/xEA6f8UAOj/EADo/wcA5/8CAOv/AwDy/wQA9P8AAPT//v/1/wkA9/8ZAP3/HQAHABMA' +
          'EgAGABYAAQAMAAAA+//+//X/AQD+/w4AEAAkACgANAA0ADoAMwA6ADUANAA5ACsAQAAnADwALAAyADUALQA7ADQAPABGAD4AYABEAIIASwCMAEwAdgBKAFkATABLAFIAUgBUAGMAUgB0AFIAfQBXAIUAXQCHAGIA' +
          'ggBjAH0AZAB4AGwAgABxAJAAaQCdAF8AmQBlAIUAcQByAHYAaQByAG4AZwCFAFsAqgBVAMcAWQDDAGAAqQBpAJYAeACRAIMAkACDAJYAeQCbAGwAnwBmAKIAawCkAHQApQB8AKQAgQCdAIEAkQB2AIwAZgCPAFkA' +
          'mABdAJ8AbACaAHIAiQBnAHEATwBhADUAXwAhAGoAGQBxACQAfABAAIoAXgCLAGoAgQBdAG4AQQBfAC0AWwAmAGIAJwBkAC0AYQA3AFwAQwBPAEgAPwBAADQAMQAyACYAOAAjAD8AHABFABEARAAJAD4ACgAyAAoA' +
          'IgAAABsA8v8aAOj/GADj/xYA3/8UANr/FADa/xMA5v8WAPf/GgAGAB4ADQAfABAAJwARADEAEgAzABEANgAMADUABgAsAP7/HgD2/xMA7/8QAOj/FgDn/yYA7/8+AP7/VwAKAFoAEABHABAANAALACkACQAqAAsA' +
          'MwATAD8AGQBLABgAUQAUAEkAEgA8ABQANgAcAD0AJQBRACkAXwAjAGQAEgBiAAMAXAAEAFkAFwBYAC8AXwA9AG0AOwB3ADEAcQApAF8AKgBXADcAWQBMAGcAXwB6AGAAggBKAHkALABrABcAYQAXAFwAKABiAEUA' +
          'bQBjAHwAcgCJAGsAjABRAIYAOgB8ADYAdgBFAHQAVAB3AFMAdwBGAG0ANwBiAC0AXQApAGUAKQBtACkAcAAmAG4AIgBvAB8AbwAhAGcAKwBaADcAUgA6AE4ALgBBAB0ALwATACMAEAAjABIAKwAYADkAGgBJABQA' +
          'TAAKAEAAAAApAPv/FAD//wQACgAAABIACwARABwABwApAPv/IQDw/w4A5v/8/+P/8P/s/+3/9//y//r//f/w/wMA4v/9/+H/9f/n/+z/5v/g/9//0//Y/8b/z/+8/8P/uP+6/7//vP/O/8n/1v/a/9j/4v/S/9v/' +
          'yv/Q/8T/x/++/8L/uf+9/7f/uv+8/7n/u/+z/7b/pf+p/5T/lv+P/4//lv+a/53/rv+d/7//mv/M/6H/xf+r/67/sv+a/7T/kf+0/5n/s/+m/63/r/+k/7H/n/+q/6X/o/+y/6n/vP+4/77/yv+//93/wP/i/8H/' +
          '2v+9/8//vP/H/8T/w//N/8H/zf/A/8T/vf+8/7//uf/D/7j/w/+4/8b/uv/J/73/yf+9/8T/t/+9/7L/vv+3/8f/yP/R/9z/1v/p/9P/6//F/+n/sv/i/6r/1/+p/87/sf/P/8r/3f/o/+n//f/n//z/2P/i/8r/' +
          'vf/F/6H/xf+Z/8n/mv/Q/6T/1v+x/9X/uf/N/7r/x/+1/87/sP/c/6v/3/+o/9H/qf/D/6r/vv+j/7//lf/D/4b/yf9+/9L/f//W/4X/y/+Q/7f/mP+q/5v/rP+b/7v/m//L/5j/1/+L/9//e//e/3L/1f95/8j/' +
          'jP/A/53/u/+j/7b/lf+u/37/qP9u/6X/c/+j/4L/o/+O/6r/mv+4/53/wP+Y/77/iv+3/33/tv97/7n/hP+3/5f/rv+l/6r/pf+1/5n/wP+L/8X/gv/F/4X/xv+Q/8b/of/C/7j/uv/B/7L/uv+1/6j/v/+S/8b/' +
          'iP/I/4r/zf+T/9b/mP/Z/5X/0v+S/8f/jv/F/5H/xv+V/7//nv+y/7D/q/+//7P/yv/D/8X/zf+1/9L/rP/b/6v/5P+w/+n/tv/t/7//9v/E/wEAw/8FALr/AQCx//f/sv/u/7D/6P+s/+X/rv/j/7r/5P/E/+3/' +
          'x//1/8j/9//B//P/s//r/6b/5P+r/+L/u//v/8P/BQDB/xQAuP8TALD/AwCq//D/rv/l/7v/5v/B/+7/vv/4/7P/AACt/wEAq//4/6z/7f+t/+n/r//t/7P/8v+0//f/u//+/8P//f/E/+//vv/f/73/2f/B/+H/' +
          'wv/t/8P/9v/F//b/yP/y/8X/6v+//+D/vv/X/8P/1//H/+H/yf/n/9L/4v/i/9z/8P/i//T/9P/z/wEA6f/9/9f/9P/J//P/yf/3/9P/8v/k/+b/9P/j//v/6v/1/+r/7v/c/+//zf/0/83/+P/Z//H/5//l/+//' +
          '3//5/97/AwDY/wEA1f/y/+X/5//6/+z/DQD6/xYAAAAQAPv/AwD0//v/8P/7/+v/AADm/wcA5v8KAO//CAD8/wEABAD4/wMA9v8CAPr/AwACAAMADQABABcA/v8eAP//HwADABgACQARABEACwAdAAgAJgAHACUA' +
          'DAAdABIAEwASAA4ADwAQAAkAGAAHACQABAAsAAAAKQAEABsADwANAB8ADAAoABkALgApAC0ANQAoADcAJAAyACUAJQAwABcAOQAVADoAJAA0ADwALQBOACoAUQAwAEYAOgA3AD8ALgA+AC8AOwA3ADsAQQA2AEcA' +
          'MQBDAC4ANgA0ACgAQAAiAEkAJQBSAC0AWAAyAGEAMwBlADAAaQAsAGkAKgBjAC4AXQA4AFoAQgBfAEgAYQBKAGAASABjAEYAZwBHAGoATABsAFEAbwBSAHAATQBxAEMAdAA9AHsAPgCDAEMAfQBIAHEASgBrAEwA' +
          'bABMAGwASQBsAEUAbgBGAHEATAB0AFAAdABPAHEATwBoAFMAXQBaAFUAXgBXAFsAXgBRAGYARwBwAD0AdwA0AHsAMQB9ADoAggBHAIoASACNAD8AigA2AIMAOACDAEUAhQBSAIcAWQCIAF4AhQBhAIAAWgB8AEkA' +
          'egA8AHgAOwBwAEUAYgBRAFUAWABUAFcAXABPAGwASAB8AEUAgABFAHcASgBsAFIAZABYAGEAWABiAFUAYgBQAGUASwByAEcAggBIAIsASwCFAEsAbwBJAFcASgBIAEwARABNAEsASgBUAEgAWwBLAFoATwBSAFAA' +
          'SQBMAEIARgBHAEEAUAA8AFkANQBbADIAWAAxAFAAMQBCADAANwAxACwAMgAwADIAQQAyAFcAMgBnADMAZAA1AFgAMwBHACsANQAiACQAIAAcACQAIAArACoALwA1AC8AOQArADQAJQAtACEAJQAhACMAIQApAB0A' +
          'LwASADQABAA2APr/MQD7/yMABAAPAA0ABAAXAAkAGwAdABUAMQAJAD0A/v85APv/KAAAABUACwAOABQAEwAUAB0ACgAkAPv/IwDt/xsA4v8PAN//BQDk/wIA7f8JAPL/FADu/x8A5P8lANj/HgDT/w4A2P/8/+L/' +
          '9//t//v/8f/9/+7//P/n//f/4v/s/+D/3v/j/9T/6P/U/+j/3P/g/+T/0//o/8j/5//C/+T/v//n/8D/7P/H//P/1P/v/+P/4P/s/9H/7P/L/+T/0v/X/9v/z//j/8r/6P/I/+n/yP/u/8n/7v/G/+j/vf/b/7P/' +
          'yf+y/73/uv+5/8X/vv/R/8X/2f/Q/9v/2//W/+H/z//m/87/4v/W/93/4P/Y/+T/1v/h/9b/2f/X/9L/2P/P/9T/0f/K/9j/v//f/7z/5P/F/+P/0P/c/9j/0//Y/8z/zf/I/8L/yP/B/8n/zP/L/9L/y//O/8v/' +
          'yP/P/8P/2f/B/+P/v//s/77/8//B//b/wv/x/8H/6P+9/9//t//b/7H/2/+t/9z/sf/X/7j/zv+9/8n/u//K/7X/zf+t/8//pP/T/6X/1v+x/9f/wf/U/8z/0P/Q/83/yv/O/7z/0f+1/9T/tf/Y/7j/3P+3/9z/' +
          's//b/7P/2/+5/9z/wv/g/8b/6f/D//P/uv/5/7b/9P++/+n/0f/c/+D/0//j/9L/2f/W/8T/2v+u/9z/of/b/6X/1P+2/83/yf/M/9b/0f/Y/9r/z//k/8D/6f+x/+T/p//a/6n/0f+6/9D/y//a/9H/6f/N//n/' +
          'yv8DAM7/BQDU//v/2P/r/9X/4P/Q/+D/zv/n/8//7f/N/+3/x//o/7v/3v+t/8//of/B/6P/v/+y/87/xP/i/8r/8P/H//T/w//x/8f/7P/S/+H/1//U/9X/zv/N/9b/xf/m/8D/8f+///T/vf/x/7b/6f+0/+H/' +
          'vP/b/8n/4P/R//D/0f///8v/AwC///n/t//n/7T/2f+2/9T/u//W/77/2/+//+P/vf/n/7f/4/+x/97/sP/a/7D/2/+s/+H/qP/t/63/+P+2//z/uP/5/7L/8P+v/+j/tP/j/8D/4f/K/+L/zv/i/8//4//Q/+L/' +
          '1f/f/93/3//h/+b/3P/r/8//6P/D/+P/vv/h/8L/5f/G/+v/xf/v/8T/7//J/+v/1v/o/+D/4//f/97/1v/e/8//5f/S/+r/3P/q/+r/5f/y/97/7P/Y/97/1f/U/9f/1//e/+b/5v/4/+n/BQDm/wYA3////9v/' +
          '9v/d//T/4//1/+j/9f/r//P/6f/w/+T/7//f//D/3f/y/93/9P/g//X/5P/7/+j/BADu/w4A9f8UAPv/GAD9/x8A/f8kAP7/JgAFACMADgAbABUAEQAZAA8AGwAcABoALwAVADoADwA2AAwAJwAMABcACgAPAAUA' +
          'FQADACUACAA3AA8ARQATAEcAEgA3ABIAHgAWAAoAHQADACQACQApABAAKgAVACcAHAAiACMAIAAoACQAKAAqACMAKgAfACAAIQAVACsAEQA2ABQAOwAaADkAIwAzAC4AMgA3ADIAOwAzADgAMQAxADMALwA5ADEA' +
          'OwAzADUAMwAiADcACgA6AP//NgAFACwAFAAkACMAJAApACgAJAAsABoALQASACoAEwAjABwAGgAqABIAOAAVADsAIwA0ADIAKAA5AB4AOwAZADgAFwAxABQAIwARABYAEgAMABYABwAcAAMAHwD9/xwA+f8XAP7/' +
          'GAAGAB8ACwAlAA0AJwAQACQAFgAfABsAHAAdABwAHQAdABwAHwAYACUAEQAwAA0AOQAPADcAFgAuABwAIgAeABsAHQAgABkALgAVADsADwA9AAsANQALACsADgAkABQAIwAcACIAJAAgACgAIwAjACkAFQAtAAgA' +
          'LQAFACcADQAjABUAIwAYACcAFwArABMAKwALAC4AAgAwAP3/LQABACcACgAlABIALQAUADQAFgAwABsAJAAkAB0AKwAiADAALQA0ADQAOAA3ADoAOAA0ADkALAA9ACgAQwArAEQALgBAAC0AOgArADgALQA+AC8A' +
          'RwAuAEoAKgBFACYAOAAkAC0AIwAnACUAKwAqADMALwA6ADEAQAAuAEUAKQBIACYAQwAoADwALAA3ADEANQA3ADkANwBBADEAQgAmADUAHgAhAB4AFAAlABMALgAeADgALwA+AD8APwBGADgAPwAtADMAJgAqACYA' +
          'KQArAC4ALQA4ACoAQQAiAEYAFQBDAAkAOAD//ygA/P8ZAAAAFgAJACAAEgAwABkANgAfAC8AIwAmACYAIgAlACcAIwAsACMAMQAoADIALgAzACwANwAkAD8AGQBFABAAQAALADEACwAiAAwAHwANACgADgA1AA4A' +
          'OwAOADYADwArABEAJAAVACcAGgArABwALgAdADAAHAAyABgAMwARADMACwA1AAkANQALAC4ADgAfABAADwAQAAYADgAFAA4ACgAPABAADgAXAAoAHQAGACIABAAlAAMAJQADACAAAQAXAPz/EgD3/xEA9f8OAPX/' +
          'CAD6////AQD7/wQA/v///woA9f8VAOv/FgDi/w0A3v/+/97/9v/i//r/7P8DAPb/CAD+/wYAAQD9/wEA8f///+///v/2//////8DAAEABQD9/wQA+P////f/+P/5//P/+v/0//X/+P/s//z/4//9/+X//P/w//r/' +
          '/f/5/wQA+f8EAPf/AAD2//z/+f/6////+f8FAPn/BgD3/wEA+P/7//n/9v/3//T/7P/z/9z/8//Q//X/0//0/+H/7//w/+3/+//z//3////3/woA7v8PAOj/DQDn/wYA7f8AAPL/9//y/+7/7v/q/+n/7P/k/+7/' +
          '4P/w/9//9P/j//j/6f/6/+//+P/v//L/6v/u/97/8P/Q//P/xv/x/8b/6f/P/+L/2//d/+H/2v/d/9n/1//b/9L/3v/R/+L/0f/l/9H/4//T/97/1//a/9j/2//U/+D/z//n/8v/7v/J//H/xv/t/8T/4f/F/9T/' +
          'y//N/9H/zv/S/9T/zP/X/8D/1P+3/8z/uf/E/8X/vv/T/7z/2//A/9j/yP/P/9D/x//U/8L/1f/A/9X/wP/Z/8H/4P/G/+j/y//u/8v/7//H/+7/wf/q/77/5P/A/9//yP/c/9L/2//X/9j/1f/U/8//0P/M/87/' +
          'y//Q/8j/0v/F/9H/xP/O/8X/zv/J/9X/zf/g/8//6f/P/+7/z//u/9P/6f/a/+P/4//d/+b/3P/i/+H/2//q/9b/8f/U//L/2f/x/+H/8v/o//T/6f/0/+X/9f/h//n/3//7/9//+f/f//L/4P/o/+P/4//p/+P/' +
          '7v/l/+//5f/s/+X/5P/n/93/6f/e/+j/5//o//L/6//2//H/8f/0/+j/9f/h//f/3P/9/93/BQDl/woA8v8JAPv/BgD6/wIA7//8/+D/9v/Y//P/2v/2/+H/+v/p//j/7//v//H/5P/x/9//7//h/+v/5v/m/+r/' +
          '4v/t/+H/8P/j//T/5v/2/+f/+P/l//3/5P8CAOf/BADs/wMA7/8AAO3/+//o//X/5P/t/+b/5f/q/+P/7P/m/+3/7P/q//H/5P/2/+D/+//j//7/6//9//H/+P/0//P/8f/v/+3/6//s/+f/7P/j/+z/5f/r/+r/' +
          '6P/u/+T/8v/n//b/7v/7//T//v/y//7/7P/7/+b/9v/k//P/5f/x/+n/8f/u//X/7v/7/+n/AgDj/wYA3v8FANz/AADh//r/6v/3//X/9//+//r/AwD9/wMA/f/9//n/8//0/+r/8f/p//H/8P/2//f//f/5/wMA' +
          '8/8FAOv/AQDn//z/6P/3/+7/9f/3//b////2/wMA9P////L/9P/w/+j/8f/h//X/5f/7//L/AwD//wcABgAIAAQABQD8/wAA9P/8//D//P/0////+/8FAAIACAAHAAcABwACAAYA/P8GAPf/CwD3/w8A/P8QAP7/' +
          'DgD8/wsA+P8JAPj/CQD8/wkABAAIAAwABwAPAAUACwAFAAUABwABAAsAAAAQAAQAFAAKABgADQAaAAwAHAAIABoAAgAXAP7/FQAAABoABgAmAA8ALgAWACcAFAAUAAsAAwACAP///f8KAP7/GgAHACcAFAApABwA' +
          'IAAdABAAGQAAABMA+f8RAPz/EwAHABUAEgAVABQAEgALAA4A/f8JAPT/BQDz/wUA+/8JAAUADgANABIADgAWAAsAFgAHABIABgAOAAgACQAMAAQADwABAA8A//8OAP7/EAD9/xIAAAATAAUAEAAHAAoABwAHAAUA' +
          'CgADABIABQAbAAkAIQANAB0ADQARAAsAAwAIAPv/BQAAAAYAEQALACQAEwAuABoALAAbACIAFwAVABIADgAOABEADQAcAA0AJwAOACkADwAjAA4AHAALABkACAAcAAgAIAANACQAEQAmABUAJgAXACIAFwAgABYA' +
          'HwAVAB0AFQAYABYAEwAYABAAGQATABYAGwATACUAEgAqABIAJwASACEAEAAdAA8AHQAOAB8ADgAhAA8AIwAPACUAEQAlABQAIwAYACAAHAAgABwAIAAbACEAGAAhABUAIwAUACYAFQAnABUAJwAVACQAFgAhABgA' +
          'IAAaACAAGwAfAB0AHAAdABkAHAAYABoAFgAYAA8AGgAIABwABQAbAAgAFQARAA8AGQALABwACgAZAAkAEgAGAAkABAABAAEAAAD//wYA/f8PAPz/GQD+/yAA/v8hAPv/GwD4/xEA9P8MAPL/DwDx/xkA8P8hAO//' +
          'HwDy/xMA9f8GAPj/AAD6/wMAAAALAAYAEAAJAA8ACAALAAYABwAAAAQA/P8EAPn/BQD3/wYA9/8JAPr/DwD5/xUA8/8VAO7/DQDu/wMA7//8//T//P/5/wAA/v8DAP//BAD9/wcA+P8LAPX/DQD3/woA/P8EAP//' +
          'AAD//wIA+/8EAPf/BQDz/wMA8f8BAPX////9/wAAAgABAAAAAAD7//3/9v/5//b/9//6//X////z/wUA8f8KAPH/CwD2/wgAAAACAA4A/f8aAP3/HQD8/xgA9v8OAPD/BADt/wAA7/////P//f/1//z/9f/7//f/' +
          '/f/6//////8AAAUA/v8MAPn/EAD2/w4A9/8IAPv/AgD+//7///////z/AgD4/wMA9/8EAPr/AwD///z////z//r/7P/1/+n/8//s//P/8v/v//f/6//4/+v/9//x//L/+//v/wQA7/8GAPP/AgD1//n/9f/y//T/' +
          '7f/2/+r/+v/r//3/8f////v///8EAP7/BQD6//z/9f/w//L/6v/y/+z/8//0//P/+v/z//n/9f/z//n/6//+/+f//v/m//7/6/////T//f/7//n//f/0//r/8P/1//L/8//3//L//P/w////7v8AAO7/AADz////' +
          '+P////n/BAD1/w0A8P8UAO7/FQDv/xAA8P8JAO//AgDv////8f8AAPb/AQD5/wEA+P////T/+v/x//b/8//0//n/+P8AAP7/AgAGAPr/DADs/w8A4P8OAN3/DADj/wwA7f8NAPb/DQD9/w0AAQAKAAEABAD8////' +
          '9v/9//T//v/5/wQAAAAMAAQADwACAA4A+v8LAPP/CwDw/wsA8v8LAPX/CAD1/wUA9P8CAPP////x//v/8P/6//H/+v/0//v/+P/9//f//P/0//3/9f8AAPn/AgD9/wIAAAACAAMAAwAGAAcACQAKAAcACwADAAsA' +
          '//8LAP7/CgD//wgAAAAFAAAAAgD//wAA+//+//f//P/z//j/8v/1//T/8//3//L/+P/x//f/8//3//j//P/+/wIAAwAFAAYAAQAGAPv/BAD4/wQA+f8GAPz/CQD9/wwA+/8OAPn/DAD3/wgA9/8FAPj/AwD4/wEA' +
          '9v////X/+//0//f/9P/1//X/9v/2//r/9f/8//L//v/v////7f/9/+j//P/i//v/3v/7/9//+P/m//b/7P/1/+//9f/u//f/6v/5/+j/+f/p//f/7P/2/+3/9f/r//X/6P/1/+b/9v/o//b/6f/2/+n/9//n//f/' +
          '5P/2/+P/9P/l//L/6P/x/+j/8v/m//P/5f/y/+b/7//q/+v/7f/n//L/5v/0/+n/9P/s//L/7//w//L/7f/z/+r/8//m//X/5P/3/+X/+P/p//n/7f/6//H/+f/y//j/8//2//T/8//4/+/////t/wEA7P/9/+3/' +
          '8//u/+n/7//k/+//5f/v/+r/8f/w//P/9P/1//b/+P/2//n/9f/3//P/9v/z//b/9P/1//f/9v/6//j//f/9/wAAAQADAAQABAAGAAIABQAAAAIAAAD//wIA/f8FAP3/CgAAAA4AAwAOAAUACQAFAAIABgD+/wgA' +
          'AAAKAAcADwAQABMAFQAWABQAFgAOABMABwAOAAMACQAEAAYACgAGABIACAAXAAsAFwARABIAFgALABgACAAXAAoAFQAQABMAFAARABUADwAUAA4AEgAOABIAEAATABMAEgAWABEAGAAQABoAEAAcABEAHAASABoA' +
          'FAAaABUAGgATABgADwAVAA0AEAAQAAwAFwAKAB0ACgAhAAwAIwAPACIAEgAfABUAGgAXABcAFwAXABcAHQAYACQAGQAoABwAJAAfABwAHwAUAB4AEgAbABUAFgAZABIAHQAPAB0ADwAaAA4AFwANABgADAAbAAwA' +
          'HAAMABkADQAWAA8AFgAPABkADgAaAA0AFgAMABAACgAMAAoADAALABQADQAgABAAKQASACsAEgAoABIAIQASABgAEgASABAADwAOABIADAAZAAsAIgAKACYACgAkAAsAHAAMABQADQATAA4AGgAOACUAEAAtABQA' +
          'LQAXACcAGAAfABcAFwAVABIAEgATAA8AFgANABoACwAdAAoAHgAKAB0ACAAYAAcAFAAHABMACwATABEAFwAVABoAGAAcABgAGgAWABYAFAARABEADwAOABEADAAXAAkAIAAFACkAAQAtAP//JwD+/xwA//8TAP//' +
          'EAD9/xQA/P8aAPz/HwD9/yAAAAAeAAUAGQAKABMADwAOABEACwASAA4AEgAUABIAHAARACEADwAhAAoAHgAEABsA/v8bAPn/IQD3/ykA+f8tAP3/KAABACAAAwAaAAMAGQAEABcABgAUAAoAEgAOABEAEQASABAA' +
          'EwANABMACQAPAAUACgADAAgAAQAIAP//DAD//xAAAAASAAEAEAADAAsABAAIAAQACAAEAA0ABQAVAAUAGgAGABoABgAWAAUAEgAEABMAAwAXAAEAHAD9/x4A+P8bAPf/FQD3/w0A+f8HAP7/AgACAP//BQD//wcA' +
          'AwAIAAYABwAGAAgAAgAJAP3/BwD4/wQA+f8AAAAA/f8HAPr/CwD4/wwA9/8MAPb/DgD5/w8A+/8NAPz/CQD7/wUA+f8GAPj/DAD3/xIA9f8UAPb/EAD4/wkA+/8FAPz/BQD9/woA//8OAAEADgACAAgAAgAAAP//' +
          '+P/8//X/+v/3//n/+//2////9P8EAPL/CQDx/wsA8f8JAPP/BgD1/wUA9/8HAPn/DQD7/xIA/f8VAAAAEgACAAsAAwAGAAMABwACAAsAAAAKAAAAAwABAPn/AADw//7/7P/8/+3/+v/v//v/8f/+//L/AgDy/wMA' +
          '8v8FAPL/BgDx/wQA8P8AAO///f/v//r/8f/4//T/9v/3//T/+v/0//z/9//8//z/+/////j/AgD2/wgA9v8NAPX/DQD0/wsA7/8JAOr/BwDm/wYA5f8EAOb/AQDo//z/6f/6/+n/9//o//P/6P/x/+f/8f/m//H/' +
          '5v/v/+n/7//u//D/9P/y//b/9P/z//X/7f/z/+j/8v/o//P/6v/0/+z/9P/r//T/6P/y/+f/7v/p/+n/7P/l/+7/5P/u/+T/6P/l/+H/5f/c/+b/2v/o/9v/6v/e/+z/4P/v/+L/8v/h//L/3//w/9z/7P/b/+j/' +
          '3f/k/+D/4v/g/+D/3//g/9z/4v/b/+P/2//j/9z/4f/e/+L/3f/j/9z/5f/Z/+f/1//p/9X/6f/V/+n/2P/p/9v/6P/c/+n/2f/r/9X/7P/V/+z/2f/s/9//6//j/+v/5P/r/+P/6//i/+r/4P/q/+D/6//g/+v/' +
          '4P/s/+H/7v/h//D/4//x/+b/8v/q//P/7v/z/+3/8//q//L/5//x/+T/7//g/+3/2//r/9b/6v/W/+j/2v/o/9//5//j/+X/5P/m/+P/6P/h/+n/3v/p/9z/6f/b/+v/2//u/9z/8f/d//T/3f/3/9v/+P/X//f/' +
          '0//0/9H/7//R/+v/0//n/9b/5f/X/+T/1f/k/9H/5v/P/+j/zv/p/9D/6P/S/+j/1P/p/9T/6f/U/+n/1f/q/9X/6v/U/+j/0//m/9T/4//X/+H/3P/i/97/4//e/+T/3P/l/9r/5v/Y/+f/1//n/9f/6f/X/+3/' +
          '1v/y/9X/9v/R//n/zv/5/8r/9//G//T/xv/x/8n/7//O/+3/0v/r/9P/6f/R/+X/z//i/9L/4f/c/+D/5//f/+7/4P/v/+L/7P/k/+n/5//n/+z/5//x/+n/9f/t//j/8v/7//f//P/5//7/+f8BAPf/AwD1/wUA' +
          '9f8GAPb/BgD2/wQA9P8DAPT/AwD0/wMA8/8DAPH/AgDw/wAA8f////P//f/1//v/9//7//r//f/9//////8AAP3/AAD6/wAA9v////T////3////+//+/wAA//8BAAIA/v8FAPf/CgDx/w8A7/8TAPP/FQD5/xYA' +
          '/f8WAPr/FQD0/xQA7v8SAOv/DQDr/wcA7v8CAPP//P/5//j//P/1//3/9f/9//X//f/2//3/+f////z/BAABAAkACAAMAA4ACwASAAYAFAAAABUA/f8TAP//EgADABIABgAQAAQADQABAAkAAQADAAMA+/8DAPX/' +
          'AQDx//z/7//3//D/9v/0//f/+P/6//3/+v8EAPj/CgD3/w8A+/8PAAEADQAHAAgADAACAA0A/P8KAPj/AwD2////9v8AAPX/BQD0/woA8v8LAPH/CADy/wUA8v8CAPT////2/wAA+v8BAP7/BQADAAoACAAOAA4A' +
          'DgARAAoAEgADABEA//8OAP//CwACAAgABwAFAAoAAgAKAAAACAD//wUA//8EAP//BAACAAYABQALAAgAEQAJABgACQAbAAkAHQAKAB8ADAAjAA8AJwAQACoAEQAsABAAKgAOACUADAAeAAwAGAANABUADwAUABEA' +
          'FwASAB0AEgAiABIAJgASACcAEwAnABUAKQAWACwAGQAwABwAMwAdADUAHgA3AB8AOQAfADwAHQA9ABsAPAAaADoAGQA3ABkANgAaADUAGwA1ABsANQAcADQAHgAwAB4AKwAdACcAHQAkABwAIgAbAB8AGwAcABoA' +
          'GgAZABsAGAAcABcAHAAVABwAEwAdABQAHwAXACMAGgAnABsAKAAcACcAHAAmABoAJQAZACUAFwAkABcAIAAXABwAFwAZABUAGgASAB4ADwAgAA4AIAANABwADQAZAA4AGgARAB4AEgAiABEAJQAQACMADwAfAA4A' +
          'GwANABkADQAaAA0AHQANAB8ADgAfAA8AHwAMAB4ACQAdAAgAHQAGAB4ABAAfAAQAIAAGACEACAAjAAoAJQAMACQACwAiAAsAHwAMAB4ADAAdAAoAHQAIABwABgAcAAMAHAACAB4AAwAgAAQAIgAEACIABAAiAAQA' +
          'IQADACIAAwAhAAUAHwAHABsACwAYAA8AGQAUAB0AFwAhABoAJAAcACMAHQAgAB0AHgAbABwAGQAbABUAGwARABwADQAcAAsAGgAKABcACQAVAAkAFQAIABcACAAXAAoAFwAMABcADwAXABIAGAAUABgAFQAYABQA' +
          'GQATABwAEwAgABUAJAAWACUAFwAjABgAIQAYAB8AGAAfABgAHwAYABsAFwAWABcAEQAXABAAFgATABYAFwAWABoAFgAZABYAFQAXABMAFwATABYAFAAUABMAEgAQAA8ADAANAAcACwADAAgAAQAGAAEABgABAAUA' +
          'AgACAAMAAAADAP3/AwD6/wMA+f8EAPv/BQD+/wYAAwAHAAgABwAKAAYACgAFAAoAAwALAAQACgAFAAkABgAIAAQABgAAAAQA/P8BAPn//v/6//v//P/4//z/9v/6//T/9v/z//T/8//z//L/9P/y//T/8P/0//D/' +
          '8//x//H/8v/v//L/7v/y/+//8v/z//H/+P/w//v/7//8/+7/+f/t//T/7v/v/+//7P/x/+v/9P/q//f/6f/5/+n/+//o//z/6P/9/+r//P/r//n/7P/2/+3/8//u//D/7v/u/+//7f/z/+7/+f/v////8f8BAPT/' +
          '///4//r//P/1/wAA8f8EAO7/BQDs/wYA6v8FAOn/AgDo////6f/7/+n/9v/p//H/6f/t/+r/6v/r/+f/7P/m/+v/5f/p/+b/5//o/+f/6v/m/+v/5v/r/+X/6//j/+3/4v/w/+P/8//k//b/5f/3/+b/9//m//T/' +
          '5P/x/+D/7//c/+7/2v/u/9n/7v/a/+3/2v/t/9v/7f/c/+7/3f/v/9//8f/h//X/4v/3/+H/+P/g//r/4v/7/+X//P/m//z/5f/8/+L/+//e//r/2//5/9r/9v/a//L/2v/v/9v/7P/d/+r/3v/p/9z/6//a/+3/' +
          '2v/w/9z/8//f//T/4v/0/+P/9f/j//f/4f/6/9///v/c/wEA3P8DAN7/AQDg//7/4v/7/+P/+P/j//X/4f/1/93/9f/Z//f/1//5/9f/+v/a//v/3//8/+L/+//k//v/5P/7/+P/+//i//z/4v/+/+b//v/s////' +
          '8f8AAPP////z////8v////D////u////7f8AAO7/AQDx/wAA8f8AAO7/AQDo/wEA4v8CAOD/AgDj/wEA6P///+3//P/v//n/7//4/+3/9//r//f/6v/2/+r/9//q//n/6//6/+///P/z//3/9//+//f////1/wAA' +
          '8v8AAPP/AQD3/wIA/v8CAAMAAwAFAAYABAAJAAIACwABAA4AAAAPAP//DgD+/w0A/v8KAP//BwABAAUAAgADAAIAAgABAAAAAQD//wIA/v8CAP7/AQD9//7//f/6//3/+P/9//n//f/8//3/AQD+/wYAAAALAAMA' +
          'DwAHABAACQAOAAsACwAMAAgADAAHAAwACAANAAsADQAOAAwADwAKAA4ACAAKAAUACAADAAkAAwALAAMADwADABIABAAUAAUAFgAGABgABgAYAAYAFQAGABAABQANAAUADAAFAA4ABQARAAUAEwAGABMABwARAAkA' +
          'EAAMABMADwAWABEAGAASABYAEwASABIADgAQAA0ADwAMAA4ADAAOAA0ADQAQAA0AEwAMABYACgAXAAcAFgAFABMAAgAQAAEADwABABEAAwAUAAQAFgAHABcACwAWAA4AFgAQABcAEQAaABIAHwASACMAEwAmABUA' +
          'KQAWACwAGAAvABoAMAAaADAAGgAwABoALwAZAC4AFwAuABQALQASACoADwAnAA0AJgALACcACwApAAwAKgAOACkAEgAnABUAJQAZACYAHAAoAB4ALAAeAC4AHwAuACAALgAgAC4AHwAvAB8AMQAfADMAHwA0AB4A' +
          'NQAeADMAHwAyAB4AMQAcAC8AGgAuABcALgAVAC8AFQAxABYAMgAXADEAGAAuABkAKwAaACkAGAAnABcAKAAXACoAFgArABUALQAUAC4AFAAtABMALAASAC0AEQAvAA8AMQAOADMADgA0ABAAMwASADAAFQAtABgA' +
          'KwAaACsAGgAsABkALQAZAC0AGQAtABcAKwAWACoAFAApABEAKgAOACwADAAuAAkALwAHACwABgAnAAQAIwACACAAAQAfAAIAHwACAB4AAwAeAAYAHgAJAB4ACgAdAAoAHQAIAB8ABAAiAAAAJAD9/yMA+v8hAPn/' +
          'HQD5/xkA+/8VAP3/EgAAABAAAwAPAAYADgAHAA4ABwAOAAYADQAFAA4AAwAOAAIADwAAAA4A/f8MAPn/DAD2/w4A8v8OAO//DADt/wgA7P8FAOv/AwDr/wQA6/8IAOr/DADr/xAA7P8SAO//EgDy/xEA9/8PAPv/' +
          'DgD//wwAAgALAAIACwABAAsA//8KAPz/CAD7/wUA+f8CAPf/AQD0/wIA8f8DAOz/AwDm/wIA4v8BAOD/AADh////5P8BAOj/AwDr/wYA7v8HAPH/BgD0/wUA9f8DAPX/AAD1//3/9f/4//X/8//2//H/9v/z//X/' +
          '9v/0//f/8v/1//D/8v/u//H/7v/x/+3/8v/s//T/7P/1/+z/9f/s//X/7P/0/+z/9P/s//X/6//1/+r/9f/p//b/6f/3/+j/9//o//b/6f/z/+v/8P/s/+3/7v/r/+7/6f/u/+f/7f/k/+3/4f/t/+D/7P/h/+z/' +
          '5P/r/+j/6v/q/+j/6f/l/+X/5P/i/+P/3//h/9z/4P/a/+D/2P/g/9f/4P/W/+H/1v/g/9X/4P/U/+L/1P/k/9T/5f/W/+b/1//o/9b/6P/T/+j/z//p/83/6f/M/+n/zP/q/83/6f/M/+j/y//m/8r/5f/I/+L/' +
          'x//f/8X/3P/C/9n/wP/X/7//1f/A/9T/wv/T/8T/0f/F/9H/xf/Q/8P/zv/C/83/wf/L/7//yv++/8n/vf/J/7z/y/+8/83/vf/S/7//1//C/9v/xv/f/8n/4v/N/+P/0f/j/9P/4//S/+L/z//j/83/4//N/+T/' +
          'zv/k/8//4//R/+H/0v/e/9P/2v/T/9j/0v/X/8//2f/N/93/yv/j/8n/6P/I/+v/yP/r/8n/6f/K/+X/y//h/8v/3f/K/9r/yf/Y/8j/2P/H/9j/xf/a/8T/3P/B/97/v//g/73/4f+9/+H/vv/h/8H/4//C/+X/' +
          'wv/o/8D/6/+9/+3/u//w/7z/8f++//H/wf/w/8P/7//E/+7/xP/s/8L/6v+//+n/vP/n/7v/5v+8/+X/vf/l/7//5f/A/+b/wf/n/8L/6f/E/+r/xv/s/8j/7v/J//D/yf/x/8f/8v/G//P/xv/z/8j/8//J//T/' +
          'yv/1/8r/9P/K//T/yf/y/8b/7v/B/+r/vf/m/7v/4/+9/+H/wP/g/8T/4f/H/+L/yf/k/8n/5v/I/+f/yf/o/8r/6P/N/+j/0P/p/9P/6v/V/+v/1//v/9f/8v/Y//X/2f/3/9v/+P/c//n/3P/5/9r/+f/X//n/' +
          '1v/5/9f/+P/a//f/3v/1/+L/8//l//H/5v/w/+j/7//r/+7/7//u//T/7v/3/+//+f/w//n/8P/3//H/9f/y//P/8//x//X/7//3/+7/+v/t//7/7v8CAPD/BQDx/wcA8/8KAPX/CwD2/wwA9/8LAPb/CgD1/wgA' +
          '9P8GAPT/BQD1/wYA9/8HAPn/CAD6/wkA+/8IAPz/CAD8/wcA+/8HAPn/BwD3/wkA9f8MAPb/EAD3/xQA+f8XAPv/GgD7/xwA/P8eAP3/HgD+/x0AAQAdAAQAHAAHABoACQAZAAkAGgAIABsABwAeAAYAIAAFACAA' +
          'BAAgAAQAHgAFABoACAAVAAsAEgAPABEAEwAQABUAEgAWABMAFwAVABcAFQAYABYAGQAWABsAFwAdABgAHgAbAB8AHQAhAB8AIwAhACUAIQAmACAAJgAfACMAHgAgAB0AHgAbAB4AGwAgABsAIwAaACcAGgArABkA' +
          'LQAaAC4AGwAtAB0ALAAeACoAHgApAB4AKQAdACsAHAAtABsALwAbADEAHAAxAB0AMQAdADAAGwAwABgAMAAVADEAEwAyABMAMQATADAAFQAvABgALgAaAC0AHAAtAB0AKwAfACoAIAAoACMAJwAmACgAKAApACoA' +
          'LQArADEAKwA0ACoANgApADUAKAA0ACcAMwAlADQAIgA3ACAAOwAeAD4AHQBAAB0AQAAeAD4AIQA8ACQAOgApADkALAA5AC4AOQAwADgAMQA4ADEAOAAyADkAMgA6ADIAOwAyADsAMwA6ADIAOAAwADgALwA5AC4A' +
          'PAAsAEAAKwBEACoASAAqAEoAKQBKACkASQApAEcAKQBEACoAQQArAD8AKwA+ACoAPwApAEAAJwBBACUAQgAjAEMAIwBDACIARAAiAEMAIwBBACUAPwAmAD4AKAA9ACoAPQAsAD0ALQA8AC4AOgAtADoALAA8ACoA' +
          'PwAoAEIAJgBEACQARAAhAEMAHgBEABwARQAZAEcAGABIABcASAAXAEcAFwBEABkAQgAbAEAAHgA/ACIAPgAlAD4AJgA/ACcAQAAnAEIAJgBEACUARAAkAEQAIwBEACMAQwAjAEMAIwBCACQAQQAkAEAAJQBAACQA' +
          'QAAjAEAAIgA/ACEAPgAfAD4AHQA9ABoAPAAWADoAEgA3AA8ANAANADIACwAwAAsALgANAC0ADgArABAAKAARACUAEQAjABAAIwAPACUADwAnAA8AKgAPACwAEAAuABIALgAUAC0AFQAsABYALAAWACsAEwArABAA' +
          'KgAMACgACAAlAAUAIQADAB4AAgAdAAIAHgACACAAAwAiAAMAIQACACAAAQAdAAEAGgABABgAAgAWAAMAFQAEABMABQAQAAYADgAGAA0ABgAMAAYADAAFAAwABAAOAAEAEQD//xQA/f8XAPz/GAD7/xgA/f8XAP7/' +
          'EwD//xAAAQANAAIACwACAAoAAgAKAAEACwD//wsA+/8MAPj/CwD1/wkA8f8GAO7/AwDv/wAA7//9//D/+v/x//j/8P/3/+//+P/s//v/6v/+/+b/AADk/wAA4////+T//v/l////6f8AAO3/AQDx/wEA8/////T/' +
          '/P/0//j/8//0//H/8P/v/+z/7P/n/+n/5P/l/+H/4f/h/93/4f/Z/+L/1f/k/9H/5v/N/+f/y//n/8n/5//K/+X/zf/j/9H/4v/W/+P/2v/j/93/5P/e/+X/3//k/97/4//d/+D/2//e/9r/2//a/9n/2f/X/9n/' +
          '1f/Z/9b/2f/X/9n/2v/a/9v/2//b/93/2v/f/9r/4P/Z/+H/2f/g/9f/3v/V/9v/0v/Y/8//1P/M/9L/y//R/8n/0f/I/9L/xv/T/8X/1P/E/9T/xf/T/8b/0v/I/9L/yv/S/8z/0//N/9X/zv/X/8//2f/Q/9z/' +
          '0P/e/9H/4P/R/+H/0f/h/9H/4f/T/+D/1v/f/9n/4P/b/+H/3P/j/9v/5v/Z/+n/1//s/9b/7v/X/+//1//v/9j/7v/Y/+3/2P/s/9j/7P/Z/+3/2//u/93/8P/f//H/4P/y/+D/8//g//T/4P/0/+D/9f/e//T/' +
          '3f/0/9v/8//a//L/2f/x/9j/8v/Y//T/2f/2/9r/9//b//f/2//3/9r/9//Z//f/2f/4/9j/+v/Z//z/2f/9/9n//v/Y//7/1//+/9b//f/X//3/2f/8/9v//f/e//7/3////9/////e//7/3P/8/9v/+v/a//j/' +
          '2//3/9z/9v/e//b/4P/3/+L/+P/i//r/4f/7/9///P/d//7/2/8AANn/AQDX/wIA1P8DANP/AwDR/wIA0P8AAND//v/P//r/z//2/87/8P/O/+v/zv/m/8//5P/Q/+P/0v/j/9P/5f/U/+j/1f/s/9X/7//V//P/' +
          '1f/3/9X/+//W//3/1v///9b/AADV/wEA1P8BANP////S//3/0//6/9T/9v/X//P/2f/w/9n/7v/Z/+7/1//u/9b/7//V//D/1f/y/9X/8//V//T/1P/1/9T/9v/U//b/1v/3/9j/+P/a//j/2//4/9z/+f/c//n/' +
          '3P/5/93/+f/e//n/4f/7/+T//P/n//3/6f///+r/AADq/wEA6v8BAOv/AADt////7v/+/+7//f/t//z/7P/7/+r/+//p//r/6f/5/+r/+P/r//f/6v/1/+n/9P/o//P/5v/0/+b/9f/m//b/6P/3/+r/+P/t//j/' +
          '8f/5//T/+f/4//r/+//7//7//P////3//v/9//z//P/5//r/9v/4//T/9//y//f/8P/5/+7/+//r//z/6v/9/+r//f/q//z/6//7/+z/+v/u//r/8f/5//X/+v/6//v////8/wEA/f8BAP//AAD/////AAD+/wAA' +
          '/v8BAP//AQABAAIAAwADAAUAAwAGAAIABwACAAYAAQAFAAAAAwAAAAIAAAABAAAAAAABAAAAAgAAAAQAAAAGAAEACgACAA0AAwAPAAQAEAAFABEABgASAAgAEwALABQADQAVAA4AFgAQABYAEgAWABUAFgAYABUA' +
          'HAAVAB8AFAAhABQAIwATACUAFAAmABYAKAAXACkAGgAqABwAKwAfAC0AIQAuACQALgAnACwAKQArACsAKQAuACkAMAAqADIAKgAzACsANAArADMALAAyAC0AMAAwAC0AMwAqADUAKAA4ACcAOgAnADwAKQA+ACwA' +
          'QQAwAEIANABDADcARAA5AEQAOgBDADkAQwA3AEIANABCADEAQwAvAEQALgBFAC4ARAAuAEMALwBAADEAPwAyAD4AMwA+ADUAPgA1AD0ANgA9ADYAPAA2AD0ANgA+ADYAQAA1AEEANABDADEARAAvAEUALABGACkA' +
          'RQAnAEIAJgA/ACYAPAAmADkAJgA4ACUANgAjADUAIQAzAB8AMAAeAC4AHgAtAB4ALgAeADEAHwA0ACAANgAhADkAIQA6ACEAOgAhADoAHwA5AB4AOAAeADYAHQA1ABwANAAbADIAGgAxABgAMQAWADIAEwA0ABEA' +
          'NgAPADgADwA6ABEAPAAUAD8AFwBBABkAQgAbAEAAHAA8ABsAOAAZADMAFgAwABMALQAPACoADQAoAAoAJwAIACcABwAnAAUAJgADACUAAgAjAAEAIQABAB8AAgAfAAMAHwAEACAABAAhAAQAIQADACIAAgAjAAEA' +
          'JQD//yYA/v8nAPv/KAD5/ykA9/8pAPX/KADz/yYA8v8iAPL/HgDy/xoA9P8ZAPb/GQD5/xsA/P8cAP7/HgAAAB8AAQAgAAEAIAAAAB4A/v8aAPv/FgD3/xEA8/8NAO//CwDs/wsA6v8LAOj/CwDm/woA5P8JAOP/' +
          'CADi/wgA4f8IAOL/CADj/wcA5P8GAOX/BQDn/wQA5/8EAOf/BQDo/wUA6f8EAOj/AgDn////5v/7/+T/+f/i//f/4v/2/+L/9v/i//b/4//2/+X/9v/n//b/6f/2/+v/9v/t//f/7f/5/+3/+//t//z/7f/8/+z/' +
          '+//s//r/6//5/+r/+f/p//v/5//8/+b//f/l//3/5P/8/+P/+//i//r/4v/6/+L/+f/j//j/5v/3/+n/9f/s//L/8P/x//T/8P/3/+//+f/v//v/7//7/+7/+f/v//b/8P/x//L/7P/1/+j/9v/l//j/5P/4/+T/' +
          '+P/m//j/6f/5/+3/+v/y//r/9v/5//n/+P/7//f//P/3//z/9v/8//b//f/2//3/9v/+//f//v/5//3/+//8//z/+v/6//n/9//4//T/+P/x//f/8P/3//H/9//y//f/8v/3//H/9//v//b/7P/1/+n/9P/o//X/' +
          '6f/2/+v/+P/t//r/8P/8//L//f/0//3/9P/8//L/+//w//n/7v/4/+z/9//s//f/7f/3/+//+P/x//n/8v/6//L/+//w//v/7f/6/+r/+v/n//r/5P/7/+H//P/e//z/3P/8/9r//P/Z//v/2f/4/9r/9f/a//H/' +
          '3P/v/93/7P/e/+v/3//r/9//6//e/+v/3P/s/9r/7P/Y/+z/1v/s/9P/7f/Q/+3/zP/t/8n/7P/G/+z/xP/q/8X/6P/G/+f/x//l/8f/5P/H/+T/yP/k/8n/5f/L/+b/zP/n/83/5//M/+f/yv/o/8n/6f/I/+v/' +
          'yf/s/8r/7f/K/+7/yv/u/8n/7v/H/+7/xf/s/8T/6v/D/+f/w//k/8X/4f/G/9//x//f/8f/3v/H/97/x//e/8b/3//G/9//xv/f/8b/3//G/9//xv/g/8b/4f/G/+L/xP/j/8L/5P/A/+X/vv/l/73/5P+8/+P/' +
          'vf/h/77/4P/A/9//wv/g/8X/4f/I/+P/yv/m/8v/6P/K/+r/yf/r/8b/7P/E/+z/wf/r/77/6v+8/+n/u//n/7r/5v+6/+X/uv/j/7n/4f+4/97/tv/c/7X/2f+0/9j/s//W/7T/1v+2/9X/uP/V/7r/1P+8/9T/' +
          'vP/V/7z/1v+7/9f/u//Y/7z/2f++/9n/v//Z/8D/2v/A/9v/wP/c/8D/3f/A/93/wf/d/8P/3f/D/93/xP/e/8X/3v/G/9//yf/g/8v/4f/N/+H/zv/i/8//4v/O/+L/zf/i/8z/4v/L/+L/y//j/8v/4//L/+T/' +
          'y//l/8r/5f/J/+X/x//l/8X/5f/E/+b/xP/m/8b/6P/L/+n/0f/q/9j/6v/f/+r/4//p/+X/6P/m/+f/5//l/+f/5f/m/+X/5P/m/+L/6f/f/+z/3f/x/93/9v/e//r/3//+/+D/AADg/wEA4f8CAOX/AwDp/wQA' +
          '7/8GAPT/CAD3/woA+f8LAPv/CwD9/wsA/v8LAAAACwABAAsAAQALAAIACwACAAsAAQAMAAAADAD9/w0A+/8OAPj/DwD4/xAA+f8QAPz/EQAAABEAAwASAAYAEgAIABMACgATAAwAFAAOABUAEAAWABEAGAARABkA' +
          'EgAcABMAHgAVACAAGAAiABwAJQAgACYAIgAoACUAKgAmACwAJwAtACgALgApAC4AKgAuACwALgAvAC4AMgAuADUALwA3ADAANwAxADQAMQAwADEALAAxACkAMgAoADIAKAAzACgANAAnADQAJgAzACYAMQAnAC8A' +
          'KQAsACsAKgAtACgALwAmADEAJQA0ACYANwAoADsAKgA/ACwAQAAvAEAAMAA+ADEAPAAyADoAMgA5ADIAOAAxADcAMAA2AC8ANQAvADUAMAA1ADEANgAzADgANAA7ADUAPwA2AEIANQBEADYARwA2AEkANwBLADgA' +
          'TAA5AE0AOgBOADoATgA6AE4AOQBNADcATQA1AE0AMQBMAC4ASgAqAEkAJwBIACUARwAkAEYAJABEACUAQgAmAD8AKAA9ACoAPQAtAD4ALgA/ADAAQQAwAEMALgBGACwASQAqAEsAJwBNACQATgAiAE4AIABNAB8A' +
          'SwAeAEsAHgBKAB4ASQAfAEgAIABHACIARgAkAEUAJQBFACcARAAoAEIAJwA+ACYAOgAkADcAIgA2ACAANgAeADcAHAA2ABoANQAYADQAFQAzABIAMwAPADMADQAzAAsAMwAKADIACQAxAAkAMQALADIADQA0AA8A' +
          'NgARADYAEQA2ABEANAAPADIADgAwAAwALgAMACwADQApAA0AJwAOACQADgAhAA4AIAAMAB8ACwAfAAkAIAAGACEABAAjAAMAJAACACYAAQApAAEAKwAAACwAAAArAAAAKgD//ycA//8mAP7/JQD+/yQA/v8kAP7/' +
          'IwD+/yIA//8gAAEAHQADABwABgAaAAgAGAAJABcACQAVAAkAEwAJABEACAAQAAYADwAFAA8AAwAPAAEAEAD+/xEA+/8RAPf/EgD0/xMA8f8UAO//FQDu/xUA7v8UAO//EgDw/xAA8/8PAPb/DgD5/w4A/f8OAP//' +
          'DQAAAA0AAAANAP//DQD9/w8A+/8QAPn/EgD4/xIA9/8RAPb/EAD3/w8A9/8QAPn/EgD7/xQA/P8VAP7/FQD//xUAAQAUAAIAFAADABQAAwAVAAIAFQABABQA//8SAP3/DgD7/wsA+f8JAPj/BwD3/wcA9/8HAPf/' +
          'BwD4/wgA+f8IAPv/BwD8/wUA/v8CAP//AAAAAP7/AgD+/wQA//8FAAIABgAFAAYACAAGAAsABAALAAMACwACAAgAAQAEAAEA//8CAPr/AgD2/wMA9P8DAPP/BADz/wQA8/8EAPP/AwDz/wEA8/8AAPL//v/x//3/' +
          '7//8/+z/+//q//r/6f/5/+r/+P/r//f/7v/1/+//9P/w//P/8f/z//H/8//y//T/8//2//T/+P/0//r/9P/9//X////2/wEA9/8DAPn/AgD5/wEA+P/+//X/+//x//j/7f/0/+r/8f/p/+//6P/t/+f/6//m/+r/' +
          '5P/p/+L/6v/j/+z/5f/t/+j/8P/r//L/7P/0/+3/9v/t//j/7v/5/+//+f/w//f/8P/0//D/8f/w/+7/8f/s//H/6v/x/+n/8P/q/+3/6v/q/+v/5//t/+T/7v/j/+//4f/w/9//8P/e/+//3f/u/97/7f/f/+v/' +
          '4f/o/+L/5v/h/+P/3//g/93/3//b/9//2f/h/9f/4//V/+b/1P/o/9P/6f/S/+n/0v/p/9L/6f/S/+f/0f/l/9H/4//R/+D/0P/f/9D/3v/Q/97/0P/e/8//3f/N/9z/yv/b/8j/2//I/9v/yP/b/8n/3f/J/97/' +
          'yP/g/8f/4f/H/+L/xv/i/8b/4f/G/+D/xv/e/8b/3f/H/93/yf/d/8v/3//N/+D/z//i/8//4//P/+X/z//n/9D/6f/R/+v/0v/s/9P/7P/T/+v/1P/p/9T/5//U/+b/0//l/9D/5P/N/+T/yv/k/8j/5P/H/+T/' +
          'yP/l/8n/5f/K/+X/zP/m/8//6P/S/+r/1f/t/9n/8P/b//P/3f/z/97/8//g//P/4f/y/+P/8v/k//H/5f/x/+b/8P/m//D/5v/x/+b/8v/n//X/5//4/+b/+v/l//z/5f/9/+T//v/l//7/5////+n////q////' +
          '6//+/+v//f/q//v/6f/5/+j/9//n//X/5v/z/+X/8f/l//D/5v/v/+f/8P/p//L/6//0/+3/9//u//r/8P/9//H/AADy/wQA8/8HAPT/CQD1/wsA9v8LAPb/CgD1/wkA8/8HAPL/BQDx/wMA8f8CAPH/AQDx/wAA' +
          '8f/+//D//f/w//3/8f/9//L//v/0/wAA9/8CAPn/AwD7/wUA/f8GAAAABwADAAkABwALAAoADQANABAADwASAA8AFAAPABYADwAYABAAGwASAB0AEwAeABMAHgASAB0AEAAcAA4AGwANABkADAAYAAsAFwAKABUA' +
          'CgASAAwAEAAPAA0AEwALABgACgAbAAkAHQAJAB0ACwAdAA4AHQASAB4AFgAfABoAIAAcACEAHgAiAB4AIgAdACIAHAAjABsAIwAbACQAGwAmABwAKAAdACkAHgAqAB8AKQAfACcAHwAlAB8AIgAeACEAHQAgABwA' +
          'IQAbACMAGgAkABkAJAAYACMAFwAiABYAIQAVAB8AEwAeABIAHAASABoAEgAZABQAGAAWABkAGQAbABwAHQAdAB8AHQAhAB0AIgAbACMAGQAkABcAJAAVACMAEwAiABIAIAAQAB4ADwAdAA4AHAANABsACwAaAAoA' +
          'GAAJABcACQAXAAoAFwAMABgADgAYABAAGQARABsAEgAdABIAHwASACEAEQAhABAAIAAPAB0ADgAaAAwAFwAKABUACAAUAAYAFAAEABMAAgATAAAAEgD+/xIA/f8SAPz/EgD7/xIA+/8SAPz/EgD+/xIAAAARAAIA' +
          'EQAFABEABgARAAcAEAAGABAABQAPAAMAEAABABAAAAAQAAAAEAAAAA8AAAAOAAAADgAAAA4AAQAOAAEADgABAA4AAAAPAAAAEAAAABEAAAATAAIAFAADABQABAAUAAUAEwAEABIABAATAAIAFAACABYAAQAXAAEA' +
          'GAABABgAAgAWAAIAFAADABIAAwAPAAMADAACAAoAAgAKAAIADAADABAABAAVAAQAGAAFABoABQAaAAUAGQAFABgABgAXAAYAFgAGABUABgAVAAYAFAAFABQABQAVAAYAFQAGABUABgAUAAUAEwAEABEAAwAPAAMA' +
          'DQADAAwABAALAAUACgAGAAkABgAHAAYABwAGAAYABQAHAAMABwABAAYAAAAEAP//AQD+//3//f/6//3/+f/8//n//P/6//z//P/7//z/+v/9//n//f/4//7/9//+//f//f/3//v/9//4//j/9v/6//X/+//1//z/' +
          '9//9//r//f/8//3//f/8//3/+//8//v/+//6//n/+v/3//r/9v/5//b/+P/2//f/9v/2//b/9P/1//L/9f/x//X/8P/1/+//9f/w//b/8f/4//L/+//z//7/9f8AAPb/AgD2/wIA9/8CAPj/AQD4/wAA+P////n/' +
          '/f/5//z/+f/6//r/+v/5//r/+P/7//f//v/2/wAA9f8CAPX/AwD1/wMA9v8EAPf/BAD4/wUA+f8FAPr/BAD7/wMA+/8CAPv/AQD7/wEA+/8AAPr//v/5//3/+f/7//j/+f/3//f/9//1//b/8//1//D/9f/u//T/' +
          '7P/0/+v/8//r//T/7P/0/+3/9f/u//b/7//2//H/9v/z//b/9f/1//b/9P/3//P/9v/y//T/8P/y//D/7//v/+z/8P/p//H/5v/z/+T/9v/j//j/5f/6/+j//P/s//3/7//9//H//v/y//7/8f/9/+//+//s//r/' +
          '6v/4/+j/9//m//X/5f/0/+T/8//k//L/5P/x/+X/8P/l//D/5v/v/+b/7//m/+7/5//v/+j/8P/q//H/7P/0/+7/9v/w//n/8v/7//L//P/z//3/8v/9//H//f/w//z/7//7/+3/+f/s//f/7P/2/+z/9P/s//P/' +
          '7P/z/+v/9P/r//T/6f/0/+f/9f/l//b/4//3/+T/+P/m//n/6f/7/+3//f/v////8f8BAPH/AgDx/wIA8P8AAPD//v/u//v/7f/4/+v/9f/q//P/6f/y/+j/8v/o//L/6P/y/+j/8v/n//L/5//x/+f/8P/m/+//' +
          '5//u/+f/7v/o/+7/6P/v/+j/8P/o//H/6P/x/+f/8f/n//D/5v/v/+X/7v/j/+z/4v/s/+D/7P/g/+z/4P/s/+D/7P/h/+3/4v/s/+P/7P/k/+z/5v/s/+j/7P/p/+z/6P/s/+f/6//l/+n/4//n/+H/5P/e/+H/' +
          '3f/f/9v/3f/a/9z/2v/b/9r/2//Z/9z/2f/d/9j/3//X/+D/1//h/9f/4v/Z/+P/2//j/97/5P/h/+T/4//k/+T/5P/l/+T/5f/k/+T/5P/i/+P/4f/j/9//4//f/+T/4P/m/+D/6P/f/+v/3v/u/9z/8P/b//H/' +
          '2//y/9v/8v/d//H/3//w/+H/7//k/+3/5//s/+r/6//s/+r/7f/q/+3/6//s/+z/7P/u/+3/8P/u//P/8P/1//H/+P/z//v/8//9//P////z/wEA8v8CAPL/BADy/wYA9P8JAPb/CgD5/wwA+/8MAP3/DQD+/w0A' +
          '/v8NAP7/DgD//w8A//8QAP//EQAAABEAAAAQAAAAEAAAAA4AAQANAAIADQADAAwABgAMAAgADAALAA0ADAANAAwADgALAA8ACAAQAAYAEgAEABQAAwAVAAUAFwAHABgACgAaAA0AGwAPABwAEQAcABMAGwATABkA' +
          'EwAYABIAFgAPABUADAAVAAoAFAAIABMACAARAAkADwAJAA4ACgANAAsADQANAA8ADgAQABAAEwAQABYAEAAaAA8AHQAOACAADgAhAA4AIQAOACAADwAeABAAHAASABsAFAAaABcAGQAZABgAHAAWAB0AFQAdABMA' +
          'HQASABwAEQAcABEAHAARABwAEwAcABUAGwAXABkAGQAXABsAFgAdABUAHgAWAB8AGAAfABoAHwAdAB8AHwAfACEAIAAiACAAIwAhACMAIQAkACEAJQAhACcAIAAqAB8ALAAeAC4AHQAvAB0ALwAcAC8AHAAwABwA' +
          'MAAdADEAHgAyAB8AMwAhADIAIgAxACMALwAkAC4AJQAsACYAKgAmACcAJQAlACQAIwAjACMAIgAkACEAJwAgACkAIAArACAALAAgACwAIAAsAB8ALAAdACwAHAAtABsALQAaAC4AGQAtABkALAAYACoAFwAoABUA' +
          'JwATACUAEgAjABEAIQARAB8AEQAcABIAGgAUABcAFgAVABcAFQAZABYAGgAYABoAGwAbAB4AGgAhABgAIwAWACMAEwAjAA8AIwAMACIACgAgAAcAHwAFAB0AAwAcAAIAGgACABkAAgAYAAIAGAACABgAAwAYAAMA' +
          'GAADABgAAwAYAAMAGAADABgAAwAXAAQAGAAEABgABQAYAAUAGAAGABcABQAXAAUAFgADABYAAQAWAP//FgD+/xYA/f8VAP3/EwD9/xEA/f8RAP3/EQD9/xMA/f8VAP3/FwD9/xkA/f8aAP3/GwD//xoAAAAZAAIA' +
          'FwAEABQABQASAAYAEAAGAA8ABgAQAAYAEAAFABEAAwASAAIAEgAAABIA/v8SAP3/EQD7/xAA+v8PAPr/DQD5/woA+f8JAPr/CAD7/wgA/f8JAP7/CQAAAAoAAAAKAAEACgABAAkAAQAJAAAACAD//wgA/v8IAP3/' +
          'CAD8/wkA/P8LAP3/DQD+/w8A/v8RAP//EQD//xEAAAAQAAAADwACAA4ABAANAAYADAAHAAwACAALAAcACgAFAAkAAgAGAP//AwD8/wAA+f/9//f/+v/1//n/8//5//P/+v/0//z/9P/+//X/AQD3/wMA+P8FAPr/' +
          'CAD7/woA/f8LAP7/DQD//w4AAQAPAAIADwACAA4AAwAMAAIACQABAAYAAAADAAAAAAD+//7//f/9//3//f/8//z//P/7//z/+//9//v////8/wAA/f8BAP7/AgAAAAMAAQAEAAEABAACAAQAAgADAAMAAgADAAAA' +
          'AwD//wMA/v8CAP7/AQAAAAEAAgABAAQAAAAGAAAABwD//wgA//8JAAAACQACAAoABAAKAAYACwAIAAsACAALAAcACgAFAAkAAwAHAAIABAAAAAIA//8AAP7//v/+//7////+/wAA//8BAAAAAwACAAQABAAFAAUA' +
          'BQAGAAUABgAFAAYABQAFAAQABAAEAAMABAADAAMAAwACAAQAAAAEAP7/BAD7/wQA+v8EAPn/AwD5/wIA+v8BAPv/AAD8/////f/+//3//f/9//r//v/4//7/9v/+//T//v/z//3/9P/7//X/+v/3//n/+f/3//v/' +
          '9v/8//X//P/0//z/8//7//P/+v/z//j/8//3//L/9//y//f/8f/2//H/9v/w//b/8P/0/+//8v/v//D/7//w/+//8P/x//L/8v/0//P/9//z//n/8//7//L/+v/y//j/8v/1//H/8f/x/+3/8P/r//D/6//w/+z/' +
          '8P/u//D/8f/w//T/8P/2/+//9v/u//X/7v/z/+7/8v/v//L/8P/y//H/8//x//T/8f/1//H/9f/x//X/8f/z//D/8v/u//H/7P/x/+r/8f/p//L/6f/0/+r/9v/r//j/6//5/+v/+P/r//b/6v/0/+r/8P/q/+3/' +
          '6v/r/+r/6f/p/+j/6P/p/+b/6f/l/+r/5f/q/+T/6v/j/+n/4//n/+L/5v/h/+b/4f/m/+D/5//g/+n/3//q/97/6//d/+r/3f/o/9z/5v/b/+T/2v/i/9n/4v/X/+L/1v/k/9b/5f/W/+b/1//m/9j/5P/Z/+L/' +
          '2v/g/9v/3v/c/93/3P/e/9z/4P/b/+L/2v/l/9j/5//X/+j/1//o/9b/5v/X/+T/1//h/9j/3v/Z/93/2v/d/9v/3v/c/9//3f/h/93/4//e/+T/3v/m/97/5//e/+n/3v/r/97/7f/d//D/3f/x/93/8v/c//L/' +
          '3P/x/9v/7v/a/+v/2f/o/9n/5f/Z/+T/2v/k/9z/5v/d/+n/3//t/+H/8f/j//X/5f/5/+f//P/p//7/6v8AAOv/AgDs/wIA7f8CAO//AgDv/wAA8P/9/+//+v/v//f/7v/1/+7/9P/t//X/7f/3/+3/+v/t//7/' +
          '7f8CAO7/BQDw/wgA8f8KAPP/CgD0/woA9f8KAPX/CQD0/wgA9P8GAPT/BQD0/wQA9f8EAPf/BAD5/wUA/P8FAP//BgABAAcABAAIAAUACQAGAAsACAANAAkADwAJABEACgATAAoAFAAJABUACQAUAAgAEwAHABEA' +
          'BQAOAAMACwAAAAgA//8GAP//BQAAAAQAAwAEAAUABQAHAAUACAAGAAkABwAJAAcACgAHAAsACAANAAgADgAJAA8ACwAPAA0ADwAPAA8ADwAOAA8ADgANAA0ACwANAAgADQAGAA4ABQAQAAUAEgAGABMABwAUAAkA' +
          'FAALABMADQASABAAEQASABAAEwAQABQADwAUABAAFAAQABMAEQARABEADwARAA0AEAALAA8ACQAOAAcADQAFAA4ABQAPAAUAEQAHABIACAATAAsAEwAMABIADgASABAAEgARABIAEQASABEAEwARABQAEAAWAA8A' +
          'FwANABgACwAZAAoAGQAIABkACAAYAAcAGAAIABgACQAYAAsAGAANABgADwAWABAAFAAQABIADwARAA0ADwAMAA8ACgAPAAgADwAGABAABQARAAMAEQACABEAAQAQAAAADwAAAA8AAQAOAAIADwAEABAABQARAAcA' +
          'EgAIABIACQASAAkAEQAIAA8ABwANAAYACwAEAAsAAgALAP//DAD9/w0A+/8OAPj/DgD3/w4A9v8NAPb/CwD4/wkA+v8HAP3/BQD//wQAAAAEAAAABQD+/wcA/f8IAPv/CAD6/wcA+f8GAPn/BAD5/wMA+f8CAPn/' +
          'AgD5/wMA+P8FAPf/BwD3/wkA9/8KAPf/DAD5/wwA/P8MAP//CwACAAoABQAJAAUACQAFAAkAAwAJAAAACQD9/wkA+/8IAPv/CAD8/wcA/f8GAP//BQAAAAUAAgAGAAMABwADAAgAAwAKAAQACwAFAAwABgAMAAcA' +
          'DAAJAAsACQALAAoACwAJAAsACAALAAYACwAFAAwAAwANAAIADQADAA4ABAAPAAUADwAGABAACAAQAAoAEAAMAA8ADgAOAA8ADgAQAA0AEQANABIADQASAA0AEgANABEADAAQAAsADwAKAA0ACAAKAAgACAAIAAgA' +
          'CAAIAAkACQAJAAoACgAMAAsADQAMAA0ADQANAA0ADQAMAAwACwALAAoACwAIAAoABwAKAAgACgAJAAkACwAIAA0ABwAPAAUADwAEAA4AAwAMAAMACgADAAgABAAHAAYABwAIAAgACgAKAAwACwAMAAwADAALAAoA' +
          'CwAIAAkABQAIAAIABwAAAAcA//8HAP//CAAAAAkAAgAKAAMACwAEAAsABQAKAAUACAAEAAYABAADAAQAAgAEAAEABAABAAQAAgAEAAIAAgADAAAAAwD+/wMA/P8DAPr/AwD5/wMA+P8DAPn/BAD7/wQA/f8FAP7/' +
          'BAAAAAMAAQACAAIAAAACAP//AwD9/wMA/f8CAPz/AgD8/wIA/f8BAP3/AQD9/wAA/f////3//v/9//7//P/+//v//v/6////+f8AAPj/AQD3/wEA9/8BAPb/AQD2/wEA9v////b//v/2//z/9v/7//X/+v/0//n/' +
          '8//4//L/+P/y//f/8v/3//L/+P/y//n/8v/6//L/+//y//z/8f/8//D//f/v//3/7f/9/+v//f/p//3/6P/9/+n//f/p//z/6//6/+z/+P/t//b/7f/0/+3/8//s//L/6//y/+r/8v/p//L/6f/y/+n/8v/p//L/' +
          '6v/x/+r/8f/r//H/6v/y/+r/8//p//T/6f/1/+j/9f/o//X/5//1/+b/9P/l//P/5f/z/+X/8//l//T/5f/0/+X/9f/k//X/5P/0/+P/8//i//H/4f/v/+D/7v/e/+3/3v/s/97/7P/f/+3/4f/t/+P/7P/l/+v/' +
          '5v/p/+b/5v/l/+X/5f/k/+T/5P/j/+b/4//p/+P/7f/k/+//5P/y/+X/8//m//L/5v/y/+b/8f/l//H/5f/x/+b/8v/m//P/5//z/+j/8//o//L/6P/w/+j/7v/o/+v/6P/q/+j/6v/o/+v/6P/t/+n/7//p//H/' +
          '6//y/+z/8v/u//L/7//x/+//8P/v//D/8P/x//H/8//y//X/8//4//T/+v/1//z/9v/9//f//f/4//z/+P/8//f//P/2//z/9f/8//T//P/0//z/9f/8//b//P/4//z/+//8//3//P/+//z//v/8//3//f/7//3/' +
          '+f/+//j////4/wAA+f8BAPv/AgD9/wMA//8EAAAABQABAAYAAQAHAAEACAAAAAgA//8JAP//CQD//woAAAALAAMADQAGAA4ACAAQAAkAEQAJABEABwAQAAUADQADAAsAAQAJAAAACAAAAAgAAQAKAAMADAAFAA4A' +
          'BgAQAAgAEQAJABAACAAPAAgADgAGAA0ABQAMAAUADQAFAA4ABgAPAAcAEQAIABIACQATAAkAEgAJABEACQARAAgAEAAIABAACAAQAAgAEQAKABIACwASAA0AEgAPABEADwAPAA8ADQAOAAsADQAKAAwACgALAAsA' +
          'CgANAAoADwAJABEACQASAAkAEgAJABEACAAPAAcADQAGAAwABAALAAIACgABAAoAAQAKAAIACgADAAkABQAIAAcABgAJAAQACQACAAkAAQAIAAEABgACAAUABQAFAAcABQAJAAcACwAIAAsACgAKAAsABwALAAUA' +
          'CgACAAkAAQAHAAAABgABAAUAAwAEAAUABQAHAAYACAAIAAkACQAIAAoABgAJAAUABwAEAAYABAAEAAUAAwAHAAIACQACAAoAAgAKAAMACAAEAAUABAABAAQA/v8DAPz/AwD7/wQA/P8FAP7/BwABAAoAAwAMAAUA' +
          'DQAEAA4AAwANAAEADAAAAAoAAAAIAAEABgADAAQABgADAAkAAwAKAAQACgAEAAgAAwAEAAIAAAABAP3/AAD8/wAA/P8AAP3/AQAAAAIAAwAEAAQABgAEAAgAAwAJAAEACgD+/woA/f8IAPz/BwD+/wYAAAAGAAMA' +
          'CAAFAAoABgANAAUADwADABAAAQAQAP//EAD+/w8A//8PAAAADwADAA8ABQAPAAcADwAIABAACAARAAcAEQAGABEABQAQAAQADwAEAA8ABQAPAAYAEQAGABMABwAVAAcAGAAHABkABgAbAAYAGwAGABsABwAbAAgA' +
          'HAAJAB0ACwAfAAwAIQAMACQADAAmAAsAJwALACYACwAlAAsAJAALACMADQAjAA4AJAAPACUAEAAmABEAJwARACgAEgAoABIAKAATACcAFAAmABUAJQAWACUAFwAlABcAJwAXACkAFgArABYALAAVACwAFQAsABYA' +
          'LAAWACwAFgAsABcALQAYAC0AGAAuABkALwAZADAAGQAvABkALwAZAC4AGQAsABkAKwAZACsAGQArABkALAAaAC0AGgAuABsALgAbAC0AHAAsABwALAAdACwAHQAtAB4ALgAfAC8AHwAwACAAMQAgADAAIQAwACEA' +
          'LgAhAC0AIAArAB8AKgAeACoAHAAqABsAKgAaACsAGgArABkAKgAYACkAFwAoABYAJgAVACYAFAAmABQAJgATACcAEgAoABIAKQARACgAEQAmABEAJAARACEAEQAfABEAHgASAB0AEgAeABEAHwARACAAEQAhABAA' +
          'IQAPACAADwAeAA4AGwANABkADAAYAAsAFwAKABgACQAZAAgAGgAIABsACAAaAAgAGAAHABUABwATAAYAEQAGABEABgARAAYAEwAHABQABwAVAAcAFQAHABQABgASAAQAEAADAA0AAQAMAP//CwD+/wsA/v8MAP7/' +
          'DQD+/w0AAAAMAAEACQACAAYAAgADAAIAAQACAAAAAQAAAAAAAQD//wIA/f8CAPz/AQD7////+f/8//j/+f/2//b/9f/1//P/9v/y//j/8f/6//H//f/x//7/8v/9//P/+//z//f/9P/z//T/8P/0/+3/9P/s//T/' +
          '7P/z/+3/8//u//L/7v/x/+z/7//p/+3/5f/s/+L/6//g/+v/4P/r/+H/6//k/+z/5v/s/+j/7P/p/+z/6f/s/+j/6//m/+r/4//p/+H/6P/g/+j/4P/o/+D/6P/i/+j/4//o/+P/5//i/+f/4f/l/9//5P/d/+P/' +
          '3P/i/9z/4v/d/+P/3v/k/9//5v/g/+f/4P/p/9//6f/e/+n/3P/p/9r/6f/Z/+j/2f/n/9r/5v/b/+b/3P/m/93/5f/d/+X/3f/k/93/5P/d/+P/3P/i/9v/4f/b/+D/2//f/9z/3//e/+D/3//h/9//4//e/+T/' +
          '3P/l/9r/5v/X/+X/1f/l/9T/5f/U/+T/1P/l/9X/5f/W/+b/1//n/9j/5//Y/+f/1//m/9b/5f/V/+T/1P/j/9X/4v/V/+L/1v/i/9j/4//Z/+P/2f/j/9r/4//Z/+P/2P/j/9f/4//V/+P/1P/k/9T/5f/V/+f/' +
          '1v/o/9j/6v/Z/+r/2v/q/9r/6v/Z/+r/2f/q/9j/6//Y/+v/2P/s/9j/7f/Z/+7/2//v/93/7//e/+//3//v/9//7v/f/+3/3v/t/93/7f/d/+3/3P/t/9z/7f/c/+3/3f/s/97/6//f/+r/3//q/9//6v/e/+r/' +
          '3f/r/93/7f/d/+7/3f/w/97/8v/g//T/4f/1/+L/9f/j//b/5P/2/+X/9//k//f/5P/3/+P/9//j//f/4//2/+P/9v/k//X/5f/1/+b/9f/n//T/5//0/+f/9P/n//T/5//0/+f/9P/n//b/6P/3/+j/+f/o//r/' +
          '6f/8/+n//f/q//3/6v/9/+v//P/r//z/6//9/+z//f/s////7P8AAOz/AQDt/wIA7v8CAO//AQDw/wAA8v/+//P//P/z//v/9P/6//P/+v/z//v/8//8//L//v/x//7/8f/+//H//v/x//3/8f/8//L//P/y//v/' +
          '8v/8//L//f/x////8f8AAPH/AQDx/wIA8f8BAPL/AADz////9P/+//X//f/2//3/9v/9//b//f/2//7/9v/+//b//v/2//3/9v/8//f/+//3//n/+P/5//j/+P/4//j/+P/5//j/+v/4//r/+P/7//j/+//4//v/' +
          '+P/8//n//P/5//3/+v/+//v////8/wEA/f8CAP3/AgD+/wIA/v8BAP7/AAD+//////////////8AAP//AQAAAAIAAQADAAEABAABAAUAAAAFAP7/BQD8/wUA+/8GAPr/BwD7/wgA/f8JAAAACwADAAwABgAMAAcA' +
          'DAAIAAsABwALAAYACgAFAAkABAAJAAUACQAGAAoACAALAAoADAALAAwADAAMAAsADAAJAAsABgAKAAMACgABAAoAAAALAAEADQADAA4ABgAQAAkAEQAKABEACwAQAAoADwAIAA4ABgANAAUADAAFAA0ABgAOAAkA' +
          'DwAMABEADgASAA8AEgAPABIADgARAAwADwALAA8ACgAOAAsADwAMABAADwASABEAEwATABUAFAAVABQAFAATABIAEQARABAADwAPAA8ADwAPAA8AEQAQABMAEAAUABEAFgAQABYADwAWAA4AFgANABUADAAUAAwA' +
          'FAANABUADgAWABAAGAARABkAEgAZABIAGQASABkAEQAXABAAFgAQABQAEAATABAAEwARABQAEgAVABIAFgASABcAEQAXABEAFwAQABYADwAVAA8AFQAPABQADwAVAA8AFgAPABYADwAXAA8AGAAOABgADgAYAA0A' +
          'FwAMABYACwAVAAoAFQAJABUACAAVAAgAFQAIABYACQAWAAoAFQALABUADQAVAA0AFAANABQADQAUAAwAFQAMABUADAAWAAwAFgANABYADgAWAA8AFQAPABMADwASAA0AEQALABEACQARAAYAEQAFABEABAARAAQA' +
          'EAAFAA8ABgAOAAcADQAGAAwABQAMAAMADAABAA0AAAAOAP//DgD//w4AAQAOAAMADQAFAAwABwAKAAcACQAGAAkABQAIAAMACAACAAgAAgAIAAIACAAEAAgABQAHAAYABgAFAAQABAADAAIAAgAAAAIA/v8BAPz/' +
          'AQD8/wEA/P8BAP7/AQD//wEAAAAAAAAAAAD//wAA/v8AAP3/AAD8/wAA+/8AAPv////8/////f////7///8AAP//AAAAAAEAAQABAAIAAQACAAEAAgABAAEAAgD//wMA/v8EAP3/BQD8/wYA/P8GAPz/BQD9/wQA' +
          '/f8DAPz/AQD7////+v/+//j//f/3//3/9v/9//f//f/4//7/+v/+//z////+/////////////v/9//7//P/+//r//v/5//7/+f////r/AAD7/wAA+/8AAPv/AAD6////+P/+//b//f/z//z/8P/8/+///P/v//3/' +
          '7//9//H//f/y//3/8v/7//L/+f/x//f/7//1/+3/8//s//L/7P/x/+3/8f/u//L/8P/z//H/8//y//T/8v/z//H/8//v//T/7v/0/+3/9f/t//b/7f/3/+7/+P/w//n/8P/5//D/+P/v//f/7f/2/+v/9f/q//T/' +
          '6f/0/+n/8//q//P/6//y/+z/8v/s//L/7P/x/+v/8f/q//H/6f/x/+j/8v/o//P/6P/z/+n/8//q//P/6//z/+v/8v/r//H/6//x/+r/8v/q//L/6f/0/+r/9f/r//X/7P/1/+3/9f/t//T/7f/z/+3/9P/s//T/' +
          '6//2/+v/+P/r//r/6//7/+z/+//s//v/7f/6/+3/+P/t//f/7P/2/+z/9v/s//f/7f/5/+7/+//v//3/8P/+//L////y////8/////P////y////8v////L/AADy/wEA8/8CAPT/AgD2/wEA9/8BAPj/AAD5/wAA' +
          '+f8AAPj/AQD4/wIA+P8EAPn/BgD7/wgA/P8JAP7/CgAAAAoAAAAJAAAACAD//wcA/f8GAPv/BQD6/wUA+f8FAPn/BAD6/wQA+/8FAPz/BQD8/wUA/P8FAPz/BgD7/wcA+/8IAPz/CQD9/woA//8LAAEACwADAAsA' +
          'BAALAAQACgAEAAkAAwAIAAIACAACAAcAAQAGAAEABQABAAQAAQADAAEAAgACAAEAAQABAAEAAQAAAAAAAAAAAAAAAAABAAAAAgAAAAMAAAADAAAAAwAAAAIAAQABAAIAAAACAP//AwAAAAQAAQAEAAIABAAEAAQA' +
          'BwADAAkAAwAKAAMACwADAAsAAwALAAMACwAEAAsABAAMAAQADQADAA4AAgAPAAEAEAD//xAA/v8PAP7/DQD+/wwA//8LAAAACgABAAoAAgAKAAQACwAFAAsABgAMAAcADQAHAA0ACAANAAkADQAKAA4ACgAPAAsA' +
          'DwAKABEACQASAAgAEwAHABQABgAUAAUAFQAFABUABQAWAAYAFgAIABcACQAXAAkAFwAJABYACgAVAAkAFAAJABQACQAUAAoAFQAMABYADQAXABAAGAARABkAEwAZABQAGQAUABkAFQAaABUAGgAWABwAFwAdABkA' +
          'HwAaACEAGwAjABwAJAAbACQAGgAlABkAJQAXACUAFgAkABYAJQAXACUAGQAlABsAJgAdACUAHgAlAB4AJAAeACMAHQAjAB0AIgAdACMAHgAkAB8AJgAgACcAIQApACEAKgAhACoAIAAqAB4AKQAcACgAGwAnABoA' +
          'JgAaACUAGwAlABwAJAAdACMAHgAjAB8AIgAgACIAIAAiAB8AIwAfACQAHwAkAB8AJQAgACUAIAAkAB8AIgAeACAAHAAeABkAHAAWABoAFAAaABIAGQARABoAEQAaABIAGwATAB0AFAAeABUAHwAWACAAFgAhABcA' +
          'IQAXACEAFwAhABcAIQAXACAAFgAfABUAHQAUABsAEgAaABAAGAAOABgADQAXAA0AFwANABcADgAXAA8AFgARABYAEQAVABEAFQAQABYADgAWAA0AFwALABcACQAXAAgAFwAHABUABgAUAAYAEgAEABEAAwARAAEA' +
          'EgAAABMA//8UAP//FQABABUAAwAUAAUAEwAIABEACgAPAAsADQAMAAwADAAMAAsADQAJAA4ACAAQAAcAEQAFABIAAwARAAIADwAAAAwA//8JAP3/BwD8/wUA+/8FAPr/BgD6/wcA+v8IAPr/CQD6/woA+/8JAPv/' +
          'CAD8/wcA+/8HAPv/CAD7/wkA+/8LAPv/DQD8/w8A/f8QAP7/EQD//xEA//8QAAAADwAAAA4AAQAOAAIADwADABAABQARAAcAEwAIABQACQAUAAkAFAAIABIABgARAAQADwABAA0A//8MAP3/DAD8/wwA/P8MAPz/' +
          'DAD9/wwA/f8MAP3/DAD9/w0A/P8OAPv/DwD7/w8A/P8QAP3/EAD//w8AAAAOAAEADAABAAkAAAAHAP//BQD9/wQA+/8DAPn/AwD3/w==';;

        /* 「打字」—— 回合开始序列里重复播几次的短音。
           原文件 0.687s，自动裁尾 0.640s（保留完整音头）。 */
        const CHIME_TYPE_B64 =
          'UklGRmRuAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YUBuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAQABAAAAAAAAAAAAAAD//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAABAAAAAAABAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AAABAAEAAQAAAAEAAQAAAAAAAAAAAAAAAAAAAP//' +
          'AAD//wAAAAAAAAAAAAAAAAAAAAD//wAAAQAAAAAAAQAAAAAAAAABAAEAAQAAAP//AAD/////AAAAAAAAAAD//wAAAQAAAAAAAAD+//7/AQABAAAAAQABAAEAAgAAAP//AAAAAP//AAAAAAAAAgABAP//AAABAAEA' +
          'AQD/////AAABAP///v8AAAMAAgAAAAAAAAABAAEA//8AAAEAAAAAAAAAAAAAAAEAAAD//wAAAAAAAP///v/+//////8AAAEAAgABAP//AAABAAAA/f/+//7/AAABAAEAAAACAAEAAQAAAP7/AAAAAP7//v8AAAEA' +
          'AQD9//3/AQAAAP//AQACAAEAAQABAAEAAgD///7/AQD+/wEAAgD+//7/AQD//wAAAQD+////AgD/////AQADAP///f8BAAQABAACAAAA/v8BAAAA/P8AAAMAAQACAAAA/f/9//3///8AAP//+/8AAAIAAgADAP//' +
          '/P8BAAAAAwAGAAEA/////wEA/v/+//3/+//8////AAD8//n/+//9/wIABQAFAAgABgACAAUABAD8//3//P/8/wIA/v/6/wIACQABAAEAAAD6/wAAAAD+/wAA///+/wIAAwAEAAMA//8BAAMAAwAEAAEAAAACAAUA' +
          'CAAEAAMAAQD///z/+//4//b//f8AAAYA/f/3//z/CAAAAP7/BAD+//z/AgAHAAMAAgD+////CgAJAPz/9v/6//n///8BAPj/8v/+/wQABwAHAAMA/P8FAAUA/f/6//f/8v/9/wMAAAAIAAgA/v8IAAsA/f/9//r/' +
          '+f/6/wAA/v8FAAUAAgANAAwA///7//////8GAAMA///+/wEA///9/wEAAgD+//3/+f/3/w4AEwACAAEACAAEAAEAAgD9//3//P/x//X//P/0//7/BAD2//j/BgD7//j/BAD+/wAAAgD+/woAEgASAAQABQD///r/' +
          'BQAAAAIA/v8EAPf/9/8AAPn/AQD2//L/8v/9/wAAAwAFAPn/AgANAAwA//8JAP3/8f8JAP7/BAAIAPz/CAD+/w4A9/8CAAcA+v8BAPz/EgD5/wEADwD3/wMA9P/w/wAAAAAOACMAJAAjABwAFwACAAAA8v/5/wMA' +
          '6v/5//r/5f/j//f/9v/b/wQADAAUAAsADQD9//z/9v/r/+v/8//7/wUAAgD8/wYAEAAFAPv/7P/s//L//v8EAPL/5//f/wkAEAAKABwAHQATAPj/HADy/+v/DwACAA0AJAAsABgA7//e/9z/6P/6/0MALQBNAKj/' +
          'ef/S/kH/2wCy/3QBjgA/AIgBBAHm/+D+xf89/93/gP9//ksARwG1/0T/wf+0ADUBSwAF/kUARwC1/nD/RP9t/5gAIwHa/0YAPAFcAKr/2f/M/6gAcv+C/38AQQCC/4L/3P/a/4T/2f+aAOMAJf9PANb/zP+E/2oA' +
          'xwDbANsArAG6APL/sP8k/9b/Ev8AAIj/qf/f/1L/QQC9/wYACQBZAH4AlwCyAOL/qP9z/wUA/v82AJ7/5f92ABkAoP/I/zgAOgBG/zL/k/+c/5H/PP+B/sX/3P9NAEUARQDEAHwAygBmAAoAmADM/9z/KwBZAC4A' +
          'QQBz/xMAFQBL/7v/fv9IAAQALABMAKwAzwAjANL/BQEKAh8AXv9t/5H/9v+j/zD/Wf/7/3kAmQD6AJoAjgDdAMT/FgEMAXX/jf9C//n+cf+m/07/Gf9KAF0ATv+FAL8Al//z/5n/LgANAB7/s/8M/yP/DQCJ/yv/' +
          'v/8uAJcAAQBvAPkAxQCCAOX/mQC2AGIAMQC0/yL/l/9H/4D+MP9T/z//3f/a/yMA4gC9ADkAtQCOAe0AZgDQACIAm/9K/0r/9v8LAGD/mP+0/7MAQwB+AG4BiQBEATUB8QArAc0A1P8oAAv/Kv+8/mL+Of6J/r//' +
          'I/8o/63/sv/LAAIBDgBrAWIAVQC+AMgAsgDQ/0T/u/+n/j//l/88/2//cv5w/4n/6P7k/x0A9P92AKb/jABXADgA3AB+AKgAdAACAKgA6P8DAEwAqv/d/9X/l/8jANL/5/+2/6j/BgCj/33/tv87/2T/nf+2/wAB' +
          '6gCqAGAA3ABFAbkAlQC9ACoA1QC3AOIAzABGAGIAIgAUAA4Aov/a/nz/8/5R/3z+hv7OAEgAuf7a/hcAWQJYAIH+RwAhANAAKgHH/4z/xf4MAIAAlABMAP/+sf+1AKP/c/99/iz/9P9U/yj/CQBUAXEBnv6l/mMB' +
          'MgAnAP0AtwKIADD+lP/uANwAtf99/6wAqgFH/xX/wP9//nb/1/6+/xEA1f9n/20ASwDcADoA7wHHAPMACwHNAPcAgAASAOP+SP8BAaABpQA+/3H/O/7D/rz/lwBVATwAyv+CADMB6wDb/z7/n/8s/1n/1v3g/q8A' +
          'bv5F/gX/fQBfAbcBmAJbAQ4Ah/7B/pz/NQCHAVsAqf87ADIA/vya/aX7dPwVAOX+EwMaBG4AIgFwARYASwOP/kABeAJ2AFT+ef7Y/kH/zv9i/10A1P/0ACIB7QCI/3b+8v4S/sv/dwKN/9wBzgEg/b8Bq//e/vr7' +
          'I/9j/oH/ugDAAS0B7f/U+90AFAO6/mEDnwAjAJkBA/9T+3EAIf8Q/mcBOQNvAcn+7wJq/MoDe/5S/2QCLwUj/rf+Yv4CAFj+eP7p/kz/CAKa/gr9cgCD/wwA6P/j/1kBsQEAAfcBLQCSBWAAuf4qAWb/N/12AoP9' +
          'U/4p/if/Vv8jAgoBfACRA6gABv1m/sn/XPyk/4D+c/1yAf/9DQC3AOkB5AGU/u/6/f4nAMT+df4qAfMABgIzAxr/KgJzA80CTv/Z/mD87wDE/1YBRAATAacC5gIUAZX+2QDy/VcAUf5nAEoCXwE+/xwAlv9eAXX9' +
          'Rf6P+yz/egM6AfcCPwEx/yMBKwA3A1ADxf7A/yT/KwGhAHv/Rfwb/HL7dP3v+Qn+CwEFABIANf+YAkUAEf1yABQCWQDe/XsBwf8eAhgBFgMu/5gCzf5G/BH+Gf+jABL/PgFEA9UC4ABIA4UCCgLa/n3+EPzF/s//' +
          'qP5//hMENQNl/xYCHwMjAdL9nv3N/+7/bf8z/s/9DgDwAIv/1ACRAB//twCo/vcAhAAB/1cB6f+KBGYCWP+K/3r/sQFV/l39Gf3R+gv/9P7S+wL/p/+g/fP9BQAfAlUBxv/qAJIDXf5rAdj+eABRADwBMQLKABAC' +
          '+wA2/gT/OAHtAAkB9wLfAvf/OQCQAC//X/7y/VsAk/+l/vgAQ//N/7z+hv0LAPsBsgCCAjgCE/7OASYDdf+6/mT/WAL9/Ur+Uf/TAzUCFP77/SP9ev94/0P9Df/LApgBzf9h/wgGoQGwBLj6NvtlAND+hf6a/e0B' +
          'pwQG/Pb95QIGApL/w/0f/eT7AwI8AbH95/8gCBQD8gCvAcn/pvnVBP76DQDd/XsBGv8v+2b8pf4IAlQD+P+N/yP9BgKD/+H/YP91/s/99f7y+3cB3AN1BP4BsP7i/g0ChPuR/0MAjf6NAj/9OgIB/2AF3QRf/hL/' +
          'rQG4/7X9mwJR/boAZgJt/oYAKQIhAWwDyAI0/1T//gGv/az//wEy/UYEt/4zAqr9if1+/pz9/PrJAKv/y/5eAH0ACwDcAO/41/svAdb7/P+H/oX9Uf32ANoDj/2WAX0Bav75AZH9NQJTAqb/hQCPAxkDjgVcBAwB' +
          'YPwBAKYC6/efAY0BMvxyATf/Df29/9gCHgbNARz+XwJWAdICqQNQAqUC5vyH/l/+6P+YAFgBs/uu+fX8AAJm/hH9LggQ/27/tv1p/xr8sQSAA7b86vvH/AQHlf919n4FrACd/9f6AAECDgnyQw9pAswDVP4d+icD' +
          '3gKkDHv5JwYOAJn/6vGf//0EV/cG+d346/8v+KMHaxok9Q8AGAiN+y8Eof2sERbqjfwVAPj/4fXe7P8P6Qb47CL6zAbkAOb+VwzJCrQKL/LhBBsFbguQDAALAPhq82gC2gZT/PYDdu01CJgAvff1+2P/Qf2H9+X8' +
          'cAjHByH9RPlf/QEFXv6L+zkAWgEp91L77AM4CTj+BQJqCnwCvv1dAYD7AQsJ8nsEzvz4F5rqUvLJAXP3yf23AqgClvpIAdkA+wDdAnH5JAHTBUkHA/uPCkP6J/hT/oUDdPV0/0r7e/+KCbb/j/7n/SAEhP5a/iAI' +
          'ugB0AEkGRQbQ/IvmwQ/VGMTpjt1DKhnzeujQLWgA+bBVIvlEVK3j5YRr3OCl3EXkF0CAHmPcCMYHGnk1Su7g89TyoCNMF4Lb1ttBGFpIO/ciuUDglBMsSIzz+bm38zY7ziVmqTvvvzUtHhnVOdk6KHUUEBvrwMDx' +
          'PQSk+mD+Fe5hCvwMJAOp/2LzXQIYEM8PZv/nAisD7Ahd+ID5gQ0DCtr2zgY16Sf9nRLgDKsDx/J/EQkGAA6UATLuwB4r+2nsvwBB+C35fQYTDPbnDvn6E5P0vwxv9ov9WAET/fcB+vseCBQEyBXp9FL0yf4G+xf9' +
          '1+lAFAT8wfm5CwfsVgzQBAr+G/upApkACf7BEdz2U+3/Ejzx6ABTB/f/Qf249HwCzP2N/FgASwOK+xYI+/fdFa4I2ArvBAHypAdgAeUIBuuYAWsCnfwaBCj4qwYbDQcF/QZn/dUQG/bzCzvtg/mdDev59Aal9BoL' +
          '1P5cAS8IMfq4BuwBmv4d/xP3iwNy+TgDk/d8Bo3wHAOs+yn7afzR/rAGifEpAgD8rgDN/zL/nPcjAUMCgv5O9tb///wOEDwHdQX/8wvxHAuvEZb59t2NFPP3ZvQ66cwbGweo+SH90ty1Ii0PAO9W7h8O3hWo8F0A' +
          'KQhe+AIMKPz/8OX/iAcpC1/qm/Ke+oMEIPzIBgAF2+kqBDMJ+v/16MoK+wxxB8IIWOD1BmcTOQam8MIRwQ48/GT70vXRDvEWSOqp8Vn8SgpP5vH1CP5iEM3/puMO+VIPKw+x+3rtRwrcCvAAv/he/eH9mQztBOf3' +
          'UPDjAZIOSu3H+If+lfiWC70B5wDe+8IM3PkT+3MToBKEB6n8hAKVBn4N+gjlAHf7rf+qGA3+L/haCSEM/gxUDb8CpAQW+3HtUv3mAZMCZvAz8QLzpeRAD2EOPAid+7QMhv/m+kQTJwfw82cCABAjAf/3uP43AbL8' +
          '1Ad5/rgIWgDV82X5ewgFBAwFDAXW9I79cP43/VAFbxHqDx0CegWbBOkEaAi8Bl4CFwfoCv352O/EAZv2QAYiAa78T+gJ7pX17gxW+qT6/u+++CL+6/C+/BD9LPsoAc/yLPpx/hP9ewOF8EgK4/5A9sAH3Pc1/7gF' +
          'YwJxBBgBzAFI94wJNwtO/Wz/Y/5SB3UArQEW+mMGPQTHBOQFy/2uAg8Eef8h+0n6rv7DBLH48fkm+cT9vApy84z3Xw+485AEEgBp9bsCQvYU/j4BxwOE92/75AIDAnUCR/PP+ev5vuzn/Mj52f1RC1z79vPf86AF' +
          'kPzuBNb8Q+t48fQRgwV289r9lg2YB/4ZhQSL9ggWLQzF/9r6ZQijFOwMuPot8A4BrQ6m+Vv7yQFi9Y8OXAX279AGUApoCrr5aPFq+S0EbQ3g9lPiXPJDHXcFHOst7xgRHxB8BEUEofuFEcwVdusr9Z0Jxf9jCX76' +
          'rwHQAYoPVelVAbkGcPmYBxoYlgPuEuUC4PpeEVoOpAobAfkEL/vSDlAPof1OCfD4rgaS/OL1V/8M+CH/rQaF5bzxIg46CWj6m/gy+kHzXg7J5M37cwup/YL6xOqNB731fPwgA2YBAwZQ+uIQlurC+mv/6Av39rr9' +
          'yxIBBEcC4Axn8i3/NARzCpgIOg1wBl4I+QScBOMHkACrBHUEHQGn+voA2/yF8y7pBPjM+EnybesA6jYEUPSd9RnwDwg+AWThKQnFEtcLfPjyCssGVQLHC7oF3QBb8osGxgM++T8AaQzoEZTsLAvg/Pf7dgxo/QAI' +
          'WwNHAhL+0/oaAL39dxJY+/DwZfbs9lL+//PQ8ZvxQPXN/nr5yPt/APr4yfIJ/6n+1/4E+8P9PQQw8lb+LwPgBCIMR/7D9/IDdhMqBBcEdg6lCIoLCgVP/bMcCApN+DEFUwfD+uT+fgpDDRD3tPDu/RIT9Qc//WEE' +
          'iQfLBUcGYPj08TQIQBNP/ardbwPCDEMFoeOJ5hcCUPU0+rDpnPWcAc/5UAM66sn8vgq4BPT5Svt7DGoBTggRAsv+fhR8+ykB/witByYHcfgc/UkRogm8+DkBvgiMCvT1k/43/j0FDP63Akf3xgELDBb/aP8v98L9' +
          'vgcEBfz0JgVeB4r0Tvpd+UD3/gKFBR8B9PfA/43wC/4TC17+5P3c/3v/jgV1BMj9lgKdAqMGCg0LAH/8UAyUDNH/e/keAfoK+gYLACP35/nUBFgCZfKQ9DgJsQQvByL4kP5uAIcDdwNaA278+woxBej0qP4OAR0C' +
          'MP1Q+SEBnvx/BJr6mPnJ+qgA5AQd8Or6lAH2/SDzuPwH/nz+j/wx63wGv/1+/L4DYP4WB87yRgmbBmoF6wAPASQUZAdlBDEGIwPbAuz9Aw9k/7b+JQGCAH8GE/lWBfUA8QAjAWn/eQ6H+JH1/gHKAPQDiP3i9zz1' +
          'nvll/cn4pfrQ+NoAyQJU+Fv7KQBYAEkAhwys/sj7lAFYAdgHtAPDARP/hv6vAyH+eAKiAnoF3v0KBf//GgL5BZn2l/4RCkcDXgFQ/v783gNaBd4BtP70+scEdQhyBXMDwQB19g/3CQSFAz75wP89+5sByPUG8T75' +
          'zAb7A5ftyvcW/DADHP3s6836DQP+/eX0Ef22/fj/X/tm+4YBagCl+H0CtwiyBU4K0Plj+y0HiQmQ+cEA6wJHAUn94P0y+/8OzwIi7vwG/RO1ALjyDwUHCwj+PP0rAh4Clv0b9An9KAQABQf9UPMH9CEHiQLY9Sz/' +
          'rAgZAQ4A+/qxCSEGNQUZAgQG1wYHBfkCrgWFBsv6tQFA/24IpPwm/QcDKQCtBj38CAd1Af0C1/wc+dUCcANt/NH9wwZ4AyD4MwG3BKb+4QPgBA38EgD1AcgEVgKgBRD7hwe5/gX7Lwg9/Ej90Pyo9TT4CgTCAnv2' +
          'Z/rSBpD+BvPd/CMESwNI+Zn6HwW+Cp8B4wD4+ToDqA6z/Rv5cf2JAbIMI/+7/pH6ugVNA+n+Owqw/sgGAQs0A2UFzP+3AZkDqf9GAJL7ngCfBLL5lv18/2H29waV/8D0t/QVAccDJP0m/ar6cfz+/qP63P/tAmgJ' +
          'dPx5/IwCMAKpBDL0CP5BBhIJJgmU/dMIb//n/xj8nwH/Bor65ALd9pwIUATq+tX9k//NBWT79P/+/QEC7P+w/dv9GwAjChn86fxOBK37EQAn+279EgRU/d77kvij/I4Eyf9O9LX1cQHCBxf8ZvHH/NAG0/wm/UH8' +
          'ufpyAOL7C//q+n3+nQTV+Fb93Pnh+9z1S/+bA3T++/4/AKD/KQDB/YsHxP4lAesDPv+u+0H5xAM1+nIIjf8MAHz/Y/sr/bL7kgNyB6z89vna/qoBEQNt9an8ogfP/Bf6AAK8CKUEJvx0+moBYQsvAkD6zwHqADD9' +
          'rgDqBNn9gf+kAhf9u/9VBC4DH/1u/AUBAQHqBLMHgv1w+nAEkAoCA1v/TwI8/mwBAf7HBpcFbv+hAFIBtAc6+iP66gIgA7EJEQHZ/FT6oAmMA4UA3wOQ+mgFZANHAJD/MwGf/gP+Xf5QAXwCJACb/bn5GAOnA9P5' +
          'Q/vvAUYGkALr/W/5nAQvA1T9Mvmu+m8MoAKj/2f/ZAKBAlf4rf/5CP8BQf5f/agEAPwq/g3/cP/vAr/8LfsC/lAB1gXkB4kEufsTAosHEAUF/h8BdQS+A9b8KfjYCKAJNQYJ+1wHzAhq/goAvgLtBB4F5wCF/wUF' +
          'LwfR+rX6CAL6BbAHpf7O/FUEqgE8+gn7//fx/KD7G/4S9wr42vk2+s7/pft++HH/Yft0+pz+2/3L+7/5CvxIAbj+jwH9+4v+BAWX/UH9af6jB0/+MP6sABn9sQHsBC0CA/ms//wBegEpAwP+t/5pAy4AvQVTAqb9' +
          '6gTr/RgEUv7w/B78fP+iB4P9GP5K/Nb99giGAZ/4vQAxBBEAWP1i/6QA2AEk+2b7BP8nBqkBL/dW/5r5Rv4MAnkAhADm/1UFofpq/jgCs/xeBvkEVfxRACEC9f+D/1n+4gAyBzD/vv7g/OMCTgPfAD3/oPilBw4H' +
          '5Pe59YT+bASq/lD+ZfhD+lEFLwIV/L77VP4C+loCQAKY/On+Q/8GAVIA9f0j/y0Ejv95/fv+I//r/qgImf8kASv/kAHWAuj9gP/HAf8CLvvvAMb/JAP5AoYCmwGwBKb+mgEbBIf+iwDf/ZP9GAWvArX6EwELB7j+' +
          'Pv24/yb/eQToAVv+3P/jABb+uASbAbr4N/+I/0EDHAGu/Sj8IgD0Avb6ZPyL/rsCDQNB+fj8MwOVCOD6rvY9A7AHUQJx/IP58f8BANYBYQDcAM///f/G//D+2ACkAYUAeQH/AMQBBQJqAGn/Bv5gABACPAKk/y/8' +
          '6gCYBHEBIPpdAPAIagLw+0/+MALXAh0GufqB+cICdQJ4Ajn94PlyAAsAS/8rAWb/Yf0PAg0BLf9AAh3/hP/rAM8AMP9NAwv9eP9+APQBKfx9/XMGAf8vAHYBQQEeAkP/HP6uAzYB/P9yAAgA6/u8AHT+xvuKAhD+' +
          'tvmF/pcCMPoy/GIEfP9l98kABQojAfT3lPd2Ao0GLgZb/aD4uf6UBjgDXv3I+6n90AEUA0T5AABnApD/kf+y+9ECiwgoAVL8kwUzBTQBhAJTBe0CCwaxAmn7Wf/bBcAEVAK0BFIBIgLrAU7/tP1uBQT/rf7k/pf4' +
          'Uf9KAND7PvwL/3r+sv1yAE/+FP/5+U4C3QMp/VD8CP2//s77MvzU+1IA8AA2/RcCkgDr/tv+UgAlAGECyQWS/yT+3gPVBaL+wAJc/RMCqgHn/8H+X/1i/+X9ZP+W/FH+igKJ/Nr8sf/u/7X8K/nd/CD9awL8AJEB' +
          'wANcALgBhf/s/XMAZQI8Ai4AxAL1Ayj/kv5cApcAHP8q/VL/9QUTBRUBZ/90AdAEhP/lAzgDcAK4/VL9sgTcAQ/94/2mAQj9zf73+/f57gOcBGL8wfjr+c8EhQN++Vv+s/gzBDP9xv6j+a/95AXn+Db8bf/SAxD+' +
          'DACC+nP9ewR+/X38XwLSA4f+2P2E/gkGmgFkAUP9Bv2aAPMElwNZ+1b/aARmA9ABUgFYA5sEIf0TA3IAIgE5ATH/NwDP/QADO/4M/kL/L/wuAQcD2v6o+7sBLgQOA3kAvv+X/i8BsASMAT4BUfy+AekBRgX1AwMC' +
          '5v1/ARoHFf+z//b5r/5q/7P6TProA0IDlgJ5/wr7rP3q/f8D2wPlAub7Jv2O/Tv8hv9xAa76zgVa//b8Mf2y+gX3rAdVAQz90AKBAewFXfgY+Rf9cApf/T8BlgLXAaEEUwG2/zH6UQGJBb4G8/+F/4r8zf5rBML8' +
          'FALE/pT70gR9BAAB3AV3A/kA0/zHAtQDnv+2/zwE0fvw/2YDHfynBoIDngaFAnIBCQLUAUoAtf8T+u78qwSv+SH5Tv7c/uQC2/3Y/dD+WP9XA6wC1v+U/Cv8Of0FAHMBUf7y+WH+0PwWADX8A/fs/QQDtAEo+w/6' +
          'wARzA20E5fid+gQCzQJz/SP9Uv2aACoCgf2C+p0BMwQk/qcCEP7K/Vv/ugAv/kwBTwATAiEB4QF6AVEDzP/A/H3+H/6g/4gBcwFd/s8BYwFVA5MBnv/aA+wC9QJoAi3/3/4QAMYAgQH++av6bgAoBncANP/j/2b/' +
          'fgTe/X/6v/vv/Nb6VvefAHX8y/xA+8X4k/+O+xr7Jv0bAXL9Yv1C/6b98ADO+vX7Mvr8/E4Bbvxo/0T9BgDuAVn+6P3VAuH/SgL2Asn8U/6xAsYDrQRVAfn8+QSABtIBKwBZAbMFxgKCAjkB5QYeBEIHEAr+AhsH' +
          'JAINB/ECj/8eBSsFqgWKBIwBKAWtDCYEfP4G/sb/+gb8/u78XQBI/4P57fdtBOH93AKP/qX8JgFDAM3/Fv0MBDgH5AFU/Xv+DQfKBqkA1ACcBDkBSgDf/wICEgG/AOcBYvzmALIECfur/4ACnwaSC8QFL/7LAoEB' +
          'jAIKBZgAtwKWAWL/NP2DA3MBs/+VALT90f2eB4ADnfWL/s4B4gAnAdv7HgIiAywEyf5i+jb9OQEl/+j/G/7J/7EAOAE6AIwD1wQuAqD9XvxE/+kE8P52/aD9sQQI/rX6vP5q/Zv/JPz//+v/hv8nAZT6Ev6K+PkA' +
          'L/73/FD+wvt2/U39RP+R9nT9ff22/UX9I/tZ/pj86vrX9vD4n/tq/R38Ufz+/Ff+qf82/j/80fx5/0oAsvm29b78p//1/eH6QQGX/6n9IAIgAa38Yvt5/PT5D/ou+vH5Z/vF+rr3I/4Y/yX+BP8RAcT8tgH//V79' +
          'HwBmAPwAhP5f/Oj9wAHu/RL98/tP+476iPtW+sf3ef3j/YH7n/zeAb4EngDW/X8D5wQdA4MAPAGPAe4BNgCXAJkEFgWTAX8BnAHsAkwGIgJX/m0DqANY/zsDWgTABa8DPQL+BVMJQwpBBQ8GQAi/BuwIqAM5BfQE' +
          'dAdXA94AdAIEBNX/R/6oAWEHbwlCAJIDkQSsCNkJsP+3Ag8FAgloBDABtwUXBY0FagL4AuYDigSeBB4BvQBVARoDxAMxA/4AOAPSBib/if48/p/+qwLhAVP/6gDrArIA4f2XARoFOQP4AHb+I/+b/g8A2v7ZAI7/' +
          'EANEAZIA0wBrA+EBTP7hAZYA6QJYAicA9v4OApj/jf6QAAX8HgL1AFH+tvqt/L//gAGs+v/6QP9KAMcA9vrj/TcAB/6E/MX85/2i/cv8Nf8Q/Ur/If2c/bX7Af02An4C3f3U/tL9O/7yAbgA5gAUACUAm/+k+4L+' +
          'Jf/Y/iD9ePpD+8j77/7u/SL70fan/af+1P/i+dT1nfyD/lj4mfjZ+bH6E/0R94T8bv1h++D5Zvu8An3/bfu4+uT+jP+xADb85PtP/pz9t/ou+8X7Avx4/cD9CvwxAZL+Yf7XAgoAB/+b/Bv9Rv/u/s/9FwCY/4P+' +
          'iv5U/QT//P+rAfQCpv/C/SL/XQBRALkCegKX/+EAOwLUAz//DAFIAqMDdwA6/ZIDCQOHA6wAzgCh/mUA5f4u/IgBxAICBEMA2QDsA8cCiAFD/p8DpQIjATkCpgDiBtADqwIGBFQEvP6EAG0HyQMMA0IC/AQdBjYE' +
          'UQWCA2kEAQRDAo8BKABNA2wEcwHT/0UBAAGbBXYDrv4L/jv/nQBbBaoA3/4GAu0D7AP1BNgCvf/xAAr/5QPLAbgA5AI2BGUBNP9IBOIDBQRT/c4AjwE3A67/0f3PAB4CFgZFA1ICeAASAzIGFQEPAyIBBQDQAs8C' +
          'pv+//mEA4Pxf/eQAOwDsAML9Uf3t/3QCff5s/Xz/tgBN/6n+Af/A+/z98v2k/gAA//kN/aIBpP5T/ub9uf0W/oL/vP6J/7j/af2f+yP84/1D/k//egAE/S39c/qw/uf+0/0t/V4A5v/v+if9Lvzv/wf+6P0y/Lr9' +
          'N/8g+iD57vxS/Pn+U/2k/Nj8Vv4k/2D7Ef6Y+xABmP7L/LD/TPzE/Pn+t/3R/AD8OwDlASz+Mfww/dj+igBX/SL9bP/eAeAAuP9h/bT9DvyMAAAAAP26/7P+RwDb/pz/iv/p/wsCzQByAEgBzQAIAzgC8/5pAEUA' +
          '1wCvAMgA9v/x/68AlQB9ADwCpAK8AgEAewBhAoICIAHcA8YDTv3ZACoD+QH+A/z/hgIBAeYBpP2YAbcDfwRb/ogAogPMAdcB8v/OAhgCS/9iAWgCUgJ4BG0ELwEyAZoBLQAFAnkBSgCj/wYCkAOMBa4E2/6nAH0F' +
          'vPovAjYB4gFS+wv9/gCU/xH+Rw+2AXABHAWFA3EDsgIYAaDxQwz/AHf/iwAi+z0IgP1tB0vxpgfl+YkAWP92CXUDvQDhASH7xP8sCq730QDPAf76MgIeB3H9Bvo0/VX7BABV/qn8EfSUAP0CE/X+Bln+1gWv/McC' +
          'KfkWAPkFh/jo+tD+1f/n/dMAzfbR/rQHeP+8Aa0F+ACfAfwE8/+7+lP5v/oiA60FDP1rAGT6Uv8bA4r+6gTZBPz+7PVeBej9EAAsBB4DiP2ZB5gAwfslA7P6RwFbALf6EPnw9ywEEPePCBr4aPrZANb9qQI0AO/7' +
          'tvxABYYA3f1P928AZwR3CBz6AvzuAmUBM/yyAt35T/xm+hP60gJFABf9VQBsCQEBvwA+/kQC3/5IBD3/Evte+Q780gAO+QoAuP/t/vP+8wFkA//7pfyn+hX+P/Yk/dMD9RIM7doHZfkl/SAQchKX53X1BwgbDlj1' +
          'wv+4ATYAn/tUBeEQYvPl9hcHaw4nBDjy4wc+BaLweQlgEJDzyfJWGC4DL+ZOAmMgffia4BQY8wPHDADorOqxDJoCHgbW5aQGMgql9rIMn/6OC9j6PvmX/in9aADrDL4UOv706N3/SwCy/SoHxRC88A39gwLo+Jz+' +
          'aRARALT9DgH27Mn5+gVaDNgCCfNF+wX7dPwM+PkQrwaMAGL4sf+k9VYC/AtHBo7/OvuYBGYKPQd7AQH88AGuDo4Akfw99sUK9AWu/RgXWABM+wj+6RIw/nYHCAcuADb+ogKV/5QKvfw/AAAJwAfJ/ewIFxCT9w72' +
          '0gDSBFbzbATgA+/3VPtL91T9xwGG+En1xwesAVf1gf4N/2z/Ewln+g0B0AE3/gwFsQAD/zr9I/i4+8X73Qll/YQG5Pjs+dLzif5C9wH2z/0BDMwBzfUG+qMFkwbg/yX7TAJODr3+5wVxCJIK9v0m/ngJBv71AN0G' +
          'YgKa+wDz0PWK+0z8C/VZ/Oz+ZPhmAET+E/2LAtQDggibAzsA9/6fB+UM3wkrB8sK+QfUBzD82wIJCl0GbfFE/DANDO/E9sMGiPvwB6f6QgEOAHTyHvIH/9wFN/Wu/nsCU/bZBJ8HL/Z993n3efH084UDhwAb97T0' +
          '8Pw2+PACJP39+aUN0v7L+6cCtPcz+hcBKgb+/zoAjgP6/sf42/jnBbkAif+m8JcB2/ux/RgDJ/aCAqcBbPzG/K//Qf7zBTL9bwCCBHEBAAnXBLn7Xfy5/63+LP94/b/9h/3MAmACrgJu/8sFHAY5//z9EAVEAlAC' +
          'EAb9AV4D2/0AAXP+NwC9/h8E3wCO/80AQQIKAwgAUAGJ/tz+z/gf+hIAKPpcAt7/h/jAAicB7wTaAfwB+gA6+qT89PsX/ED+lPvG/ZX+FwEHB8YCbfsOAzsCRgCAA4n89//kA0UETAB4ALoB0QJp/1UAO/+S/eEC' +
          'fgIt/eYA6AKfBSoKNvzxAr8CzADC/QL9fQKH/fEBmvkP/F77QADT/yQJnwRoAWMDfgT++4YB9QYZA88CY/4wACoCWQBPAzsA0gBp/64ELgJ+/UgIIwSM/en86v4a/A0Am//FAL0HowQU/Xr9kwEjBZMFSQXyBJsC' +
          'jwfjBkwDQQZOASYB6gJf/+n6XgCuAUH/VPja/OgDsADhB6sBaQLLBcMHaQJH/tkENQRFA5oDPAIy+j78af2V/Nz/+f/OA8f+TP5d/y8FGQhF/Kv+kAKw/ij9mP2E/Qb+Yvm//skDYgII/CADj//AAkkCzQL1/9UF' +
          'NwIu+nL7DgDl/lADLfo291P8igTU/Ir2rwFH/Vr/lgHN/Vz66wFp/kr/1/yi+zb82/y595v9pQH0+Hn8Zf3w+aD/LANXALP/rQA5/4L9fAD3/QEABQBz/jwDTAB5+33+FAIGAZ8EpgLx+r0DkAQqAmv2bf8jALn4' +
          'q/tY+mv7Dvpp/Gn79/pl+xv7iQRB/eL8W/2qAPT+nQFs+UL6jATI/fT3Pv/w+PX61v5T/nj5JAFs/2X4vPqT/j//rPpb+8H8mwJW/jb9tgG5Akv/tP9l+rH+9gO5/ggAn/5eAAQAwgEGAav+8QLg/S0ApgLI/vP/' +
          'KQQVACwA7/8A/3/+jgBK/oP+5gWi/gMC1gBCAhcCnf+wBRgDJweR/EIAjAMABmn78P3bArYBnQCr/o8AHAL4AOX8OwMEBEgCRAS5AQEETQSDBOECxAGj/jr+6wVY/1n5QAIc/s37mfzr/of7lf+BAQn8LQOa/7b+' +
          'w/1XAhsCMgD+Ak3+CQ8yCawChv4nCAYE+ggnBMUGRwoxBjYFCgWNBooEZgWBBQEFpgWiAW0DxAL8AQ4Dxv5bBHb/rAHu+VwBnQRwAd3+If9TAE39wPxI/U0BUf+M/YX8DAMg/mz/Jv4l/mj+SwGrALj/tgJ//O78' +
          'gQPKAsH8hgKKA3T81Pyq/qP/uP95Ai8EXgFf/Xv97AJWA4v9KwB//2X+3/3A/x0B6v8q/gL8s/9E/sT+PAGNAPT84/7kAX//df57/Bf+2gB2/gX9iP2JAC8AXv8B/GoBwgDpAKP/Kvhg/1ECIP1W/IP+Jft+/7UA' +
          'i/2c/Zj8tf85AXL+zf0sBMEA6vrcAPL8/P1U/20DW/4I/lL9w/1d/uD92/zN+eIBHP6x/Xn7/f0qApj8B/6b++r+kf1L/2/+//rB/ZP+Tv289vn8vAGe/u/9G/ydAcD+CP6gASwB+v/q/Vn/JgKK/ugAAwJ0/cL/' +
          '3v5QA0L/VQEVBAL/4v/w/b7+OwG2AiH/fv9SBLn+PwBO/v8AbAAgAHcE4v/6AV4BzQWmAj0CRQThAXT/iAKlAr7/6wGHAcj+pwBrAJwB5gF7ATgAjQBaAFb9SQUpAa38Lv8RAzMDTwI+AJoAhQbZ/Sv8jQH9AkIC' +
          'twEDAUMCMABRAOECEv/i/EQD6wMkABgDcwEkA/f/0wGQAFICQgK/AfX+h/01AzgAxgDv/WD+uP29/zgDGAB9/cn+7gNG/6gDTAH3Ab0AwgEOBIIC/AD0AGsDYgRx/eACPgV6ADsAdwL3AL7/ywBkAQ3+lgByARD/' +
          'jf/E/vEA+P79AJwAXf6V/Y/8X//2AC8C0/8q/L4Au/9cAO//RgAN/sP90QFw/rD+NAKGAZT9hQCN/6D9JgFbAI78XP5m/9D/0f2g/5L+Qv+w/6L99/2O/wv/Cvxn/Sn+hf9a/CP/w/+R/uL8Xfpx/6r+sv82/Sv+' +
          'Cv9lAj/8jfpo/QL9Mf6zASD+kf0x/6L9if0gALr8yv9EAcz9nP0gASIA8P35APT+4P+LAtf+6v2N/9z9hP9M/oX+b/7P/W38OgCuAev+af6E/o37E/2n/nb/ovykAK7/aP6K/lz8Df+2+x0AOf99/0j+f/6i/8z+' +
          'vv8m/d/8hwADANT9KAB/ALQEGgIKAfT+NgNeA+f/CAV1AR4CYQLLA0wDggAPBJYDff6u/2v/GwRZAYoAT/5VAIkB6v8QAZ4Bk//T/qr+pQAAArYAFwPL/UsAGwOw/53+JgSB/+X/+QMyADcBwQCF/yz/UgFMAAgA' +
          'YgQaAb0BlAKrAwkCDAHB/wX/ZgIVA1UACQELAn3+FwDZ/0IArQDoAVgABQIaAZgBoAHyAMEBzgAuAo0B3QNUBOQAuQPwAaUBsQSMBJD/tQFCBVcAlQAUBTEC4wGwBbQBMP12A3kDMADKAGkBjgHb/wECXgCrAhQC' +
          '2gHC/VAAiwBgAAn+KQHo/3MA1P89/qL9Cv9hAS4BXP+JAZ7/Wv1vAMz9UABgATv/A/6cABYC4v9s/T7+Jf9H/9r/8/w1/Cv9tf6L/nj+fPwV/yQBM/7c/rT9Df4AAe/+uf2l+xX+5P1YAL/9Hv/s/i/9yv7J+rn/' +
          'EgHa/9b+Dv5A/gT95v+o/gr9z/8m/xr+mv4D/0X/1/0TADr9DACMAJb+8/1yABIAmP70/kX/m/68/UD8xfxO/v3+Iv4x/Z/9Bv8TAXD8Zv44/mD+Mf+X/qH+jADN/Wf+Of/t/nYAHgCu/uD+Lv1t/a3+J/+V/5f/' +
          '5P5C/i4Apf9p/+QBE/+r/ij/6f92AKv9lv4z/6EABgEYAGYA3AA0/3j+lv/NATwB3v4VAUL/gwHx/7L9hgC+AekCGABI//UCyQJVAIsAQAF1A0wBwQKmAToCVQPaAa//GgKUA+MBpgLI/1QAbgBeAywDcgETAX4A' +
          'v/5JAbsBQP9DAOkA2QA4AHH/3v9cA+cCAgFw/mECrABjAo8Alv/y//YBcQG4/0UA9ABwApcCPQLYAZUB8QKWARb+igAnBMsBXv9lAu4ARgBoA2QD7ALEApYDMQFIBHkCFgFd/8IAIwAKAq4ACwJJALj/owH/APIA' +
          'mQG8AAYAuwA1AYr+4f/sAA/+9P4nAIQBGgCp/gT+C/9v/1UAnfwL/4j/ov1KAf7+rP44/98ASv8A/g0An/+S/goBwf4n/sX/DQEt/yv+HwBV/9n+oP63/kv+ZACp/+797fyB/lL+tf3o/QD/of30/qP/8fw3/tH9' +
          'ev42/ln+r/6n/ob+Of+F/mL9Vv7c/vL+uv0H/779S/9E/5L/y//B/lH+0v8P/4j+ZP/CAPX+Jf7z/wP/x/7eADP/gP7I/z8AoACV/mH/GAFJAAIBoP/V/3gBBgHFAKsAbQED/6v/WQG0/zv/Uv70/+AAXgB0/gAB' +
          '1v9U/iD/tf8DAM3/r/+xALoAeQCBAH//kf9wAg8BEgD4AF4BXAAo/3MAfQDoAGL/iwHpAIX/rP9WAGr/VABTAXgCZQAyAGICyQDWAB0A+/+iACoAv/9VAPb/rACq/+cBVABs/1AAyQHf/6oAVf/XAMsB8QCnAIsA' +
          'QwGvAMIAmf+aANYB0wI3AMMANgA6AQEB3f/QAVwA+f+qANL//f4OAWoA8P+nACoBcwCw/0gAgP9nACYBGAGBAEf+Uv+yANoAmP6K/zYA6wBwAIv/IwCPAO4AZv5C/10AHgGSAFX+QwDTADMBaf58/w3/MgHg/8T+' +
          'B//2/in/j/9m/6X+Mf7t/4EAWf51/U//JQCl/okAqP9w//b+IQBuALH/FwAU/4QAiwB1AJAApAA4/5D+9v/5AC4Alv99/mz/FP/8/h4BkP9L/xD/If8rABf+uf/M/+j+Y/5y/sL+U/+l/zYA7v6C/pz/l/+z/pT+' +
          'Tf5jAND/AP6j/gEAjwG8/84ATADV/gwA5gD8/0T/y//5AFgAZf/o/kwBxwAKACwAvgABAMwBc/4r/tUA/AHK/zQA4/+pAHoAfgFhAdMAjv9n/9oCvAHE/sz/LwGWASMB6v/7/xwB6wH1/0z/fwBBAXcAbADo/y4B' +
          'hgBQAOj/+QB6/yQArADBAPYAYgBFASsBoAC3AJYAwABeAD8BMQHVAEf/jwBRAQoB1ADGAB0BfwGtAGwBpADUANb/PADYAPL+lP80AUUAewCD/8P/Cv/g/7T+AwCD/hIAY/8i/7T/LQGa/4f/hf69/wYCmgHw/zgA' +
          '3wCx/pH/qgAHAT7/VwC8/sT/hABWAXkAIP+s/p4AHgGMACIAXwBcAEL/FACK/+b/QAADAOv/TP9p/8kAqAAQAL7/Uf+E/un+IgFl/5j+z/9dAJL/SP8w/1gA3P5X/zT/pP9e/7D/pv8TAH7+yv8r/w8ABP9c/jv/' +
          'HQCY/3b+T/6z/0wAcv8i/tn+pgB4AAX/kP5p/xEAXf9l/93/Iv9sAKoAhP9l/6j/cQAh/43+NgBZANT/h/9o/+X+2v6T/8z/rP8a/mX+Df+g/93+d/71/sn+7f9I/63+3P8xALj+7P9j/07/k//4/4n/RQAyAREC' +
          'WgAEAM4A0wB4AXEA+v+k/5j/AgBRAH7/nv/t/zoBq//9/qkAgAD1//v/sf6i/zgAx/8UANH/AAAsAGcAiABOAaUA7QDM/4b/oQDXAGkA9/9uAG8AhwAJAQ8BrwAfAAIB7ACuAIIAFgEuAQMBvQE7AbgAYgGfAPgA' +
          'igHgADf/pAC8AS0BcQBPAUEBY//T/0YBqwHm/wQBxwC0AE0A8ADoAH0AnwBRAWwAnwBbAJj/8/+wAHEA7QBp/87+Z/8tASgAmf+M/x4A6//9/6sArQFH//3+ZgDoASABDgBsAJL/XABCAF0ABQAQAWIA2ACX/8IA' +
          'gABi/5L/0/83ABMB9ABV//7/TwCO//T/eAC4/zEAlwCl/wD/OgBlAOL/Bf8tAHH/A/+pAJH/nf7I/0MAOf+4AAgBl/8QAJ3/KgAYAOb/hgCQ/yQA///U/1wA2v+z//n/3P8LAA0Ayf92/+H+Gv++/sz+Yv5c/x3/' +
          'y/6Q/1gA3v6s/kAA4v5p/2QAl/+y/qj+if/o/+f/sv9N/h0AIv8q/8P/uP+w/xP/8v9c/3f+g/9UAIT/sP3N/kn///+9/+/+D/9t/2f/AQCC/wz/EwBaAFL/8v73/3EAfv+d/2L+tv8KABwABv84/3r/bv/Y/6kA' +
          'n/+S/9X/JgBA/xoADQEGABYAFAA2AAIAcgD2AIwAbP+Y/yYAhwAKAEQAOf/E/7L/rP+T/8wAfgCqABIB+v/t/+gAkQE5AGwAiACJAeX/YQBgACUAsgA0ADoAEAEmAU8A4v92/yQA2/89ALIASAD1/7r/rgDp/zIA' +
          'BwFXAPL/ywAbAGgApQEqAdUAlwBvAT8BpP8DAGgAr/9oAIYAswDU/3z/YAAEAdMA8/8CADMABABvAC4B/gD4/+//uACYACMAkwBbAEkAxwCfADoAEgB1/3b/7v8fAOz/JgCA/0n/0gCbAMH/EQCnAFcANABJ/8z/' +
          'SQFBAIUAJwDIAH4AjQAkALj/s/8yAIQAfP8GAFX/0P8SANz/pv/i/xcATACmAL7/Qv8c/w0AiAA1AEwA8/9///r/u/+4/9//g//B/4D/HP+U/8H/AwC1/pf/FgBj/yn/4P5JADgA0P8Z/wP/vv9J/zv/r/+O/57/' +
          'x/5U/wkAOwBJ/7T+IgDa/7T/jf/h/9//MgCt/1T/9/89AJr/f/8oANn/uv9A/x3/h/+Q/xL/If+o/7L/9P+Q/6D/jP9Y/8L/cP96/63/8P8//8X///+Z/5P/5v+3/0r/7v+y/7j/6/8UANP/G/8UAEIAKABAACoA' +
          'EQClAAIA9//lAHIAFgCtAAUBQQDp/ygAYQBfAAcA7v8eAIb/+f5cANAAPACr/7r/LgCsAE0AQgDdAPgAxwAsAZ8AgwCqAFIAaQAOAXUA9v/LAFsApv/x/1IAFwD7/2QAWQD1/zQAnwBjANsA4gDt/5j/ywBwAFoA' +
          'ggC2ACMA1P/p/28A9P8eAEMAXwBVAEMAiABNADsAYwCzAJsAkQDz/wsARwAyAN7/LwBzAHMAiv9N/0sAMAA6ACf/xP9tAIAAuf+w/5L/YABoAB4AmQAfAKn/6v/UAJMAawBuABkAKADMAHoA9v8/AGwAw//9/uT/' +
          'gAB9/5n/WQDD/zMAr//T/8r/ov/H/7P/wf+o/9L/4P/m/z//pP/i/2kA+P+Y/y3/p/+v/8//0/+2/y//p/8xAHgA/v9w/8f/5P8nAAUAFAA0ADP/mf+a/8n/1f+U/3n+O/8WABoAh/+s/nT/1P9j/2r/zv+i/4j/' +
          'V//r/8b/g/+8/yD/c/+6/wEAv/9t/04APQCa/5r/UwDh/ywAVwC0/1T/lP8fAJb/Sf+p/0EAq/+R/4D/m//x/6v/n//O/2H/X//2/1QAo/9v/77/LgCXAPz/PgCo//n/dAB1AFsADQBUAAMAgwDUAEgAr//R/4UA' +
          'UACOADoAXQDc/7f/hgBpAIX/VP+1/2sAOwDk/3j/yv8uAHEAVwBaABgAowBsAF0AqwA6AewAIgBUAHUAbgDBAO8AqwCJACgApf9oAB8BIQFFABUAjf81ADsAOABTAEoA/P9EAGAAEQADAP//MgD8/zsAi/8RAPj/' +
          'DAAJAGAAHQABAGcAbABfABoAuwBBABQAUwCPABgAjgDLAPj/yf+Y/10AcgAXAL//4P+3/3L/+/97ABYA5f/R/97/cQA3AO7/2v+1/xsAsAD6//n/CwArAFkACgANAEEA9P+s/+T/QgAoABkAiv9+//n/owAbAI3/' +
          'nf8/AFUAxv+P/6v/bv8YAC8AbP9Y/8D/2P+7/wMAoP87AB4A7f/1/xQApf+W/wUAMQA/AKr/0P+q/7P/AgCGAPn/Xf+y//v/bv+t/7//tP8g/zH/xP+h/5j/if/N/77/Lv/3/p3/QwDB/1T/eP+k////oP+o/4r/' +
          's/93/6b/HADZ/7j/+f/g/1oAZwBlAEsAnP+e/w8A6//f/zIA4/82/37/z//R/xMADgDI/7D/pf+0/0kAFwDQ/1f/nv/n/6L/z/9wACkACgD8/y8AOgAZAIQA2f9vAGEAQAApANH/NQB5AHkAHgDm/87/HwA9ANj/' +
          '0v+AALQAHwCj/xAAhQCbABYAs//o///////d/0YAcQAgABsAnABVAGIAYABjAAMAUQBsAEAAHAD5/y4ADwDS/zoAmADH//X/dABFAOz/HgAlABcAsf/1/2sALADP////WACYAB0AUABGADEAAwBXAC8A///k/zwA' +
          'hwBOAOX/uf8RAFsApAAQAML/ewATAOH/MwCCAB8AfADc/7f/UwBFAO//of+h/8H/PgAuAML/2P8NADUAOAA5AJj/q//2/2cAGgANAJb/5v81AAkA6v8PAEAAFQDs/wEALwDX/9H/FgAtALD/sf8QAAgAGQDR/+f/' +
          '5P/x/xsALQDp/9r/4f9P/27/FQAjANH/y//m/+D/y/9rACcADwCk/+7/5//A/7L/6v8xAPb/mP/L/xAAlv8AAA0AOACw/4z/7f8WAMH/8f/S/3X/pv/J/9v/9v/W/4b/1f+n/5X/yP8uAP//NwC4/9D/vv/6/1MA' +
          'RQD+//v/0P+v/9//QAAwAND/8/8CANr/8//w/+D/1f8XALj/gP8SAAMA3f8UAC4Ao//a/2AAAwDA/4H/MQA2AMf/7f8WAO//3/8pACMA9P8CADUA9v/8/zQAWQAFAJT/PgC/AGQAGQAMAPT/VwBHADUA2P9JADkA' +
          'AwDq/+3/QgAjAMf/xv/b/xYALwADAOr/AwAMAAkARQAwAAMA6/+VAEMA9P/5/zYAQwAgABAAAgD8/87/HgA6AA8A+P8YAC4ADQAjACcAHwDQ/6D/KwBjAPb/pf/k/ykAAQAMAL//7v8WAPT/4f/d/57/JAAoAAgA' +
          'PgA4AAQAzP/i/+//KwAhAAUABQDd/7L/+v9cAGwA4f/j/w8AQAAoAOn/4P/g/0wAHgC3/57/MAAXANX/0f8rABEA5f/M/ykAGwDl/9X/zP/k/+H/7f85ACsAv//N/zoASQDj/+H/HgALACwAAwAJAMz//P/y/+z/' +
          'kv/W/ygA9/+y/6D/0P/8/z4A+f/m/wwALgAnAPH/IAD5/+f/3v/n/yEAIQC6/9n/GQAjAOL/AQABABYAUwDj/9H/NAA4AMX/8f/k/8n/1P/k/7j/5/8GAD4AHAD0/+P/9v/d/yYAUwDL/6P/3/8mAOL/8P9UAE8A' +
          'CgD5/x0AQgBMABMA4/8QADwAPwACABkA5f8bAEMA7/+8//v/EADJ/+f//v8kABMA5f/y/wIAAAD7/wMAxv8XAB4A//8MABkARgAiACAADwAZACsAPgD//yIANQAPAP7/UgBWAD0AXwAiANn/FAAtAA0A9P/m//b/' +
          'DQDj/+r/2P/b/9T/GwAbAPD/5//t/+D/DgAHAAEA9P8CAPf/IgD8/+b/IgBRAA0A5/8XABUAKQAcAAYA6P/x/zoAHwDF/woAIgAGAPD/3f/E/9r/DAARAPT/3//a/9b/3/8FAPn/xf/D/8v/AwARANz/qv8HACMA' +
          'FwAeAAQA2/+8/+f/EAA0AP7/tP/X/yQAGQDT/+v/3f/i/wYADQDG/83/6//l/8//1f/8/8T/uP/n/zEAGADv/+P/DQAxABgA9v/4/yEAuf+5/+3/EwDT/9X/2P/x/+v/BQAJAP3/9v/X/woA9f/x/8X/+v8JABkA' +
          'GgApAP7/7P/p/yEAEAD2/9//qv/i/xIAGADB/7//9P8eALX/vv8ZACIA/P/S/7L/+f8/AD4ABgAPAD0ATwAkAA8ADAD1//3/CwALAOH/AQAHAA4AIADo/+X/QAA5AOL/yP/+/wUAv/8oAD8AEwDL/9r/NABbAAkA' +
          'wv/3/yUAKwD8/wAAHABgADsAFgAWAB0AKQAqACgA+f/q/wwAFAAHABoACgACAAQAEgAMABMANQATAPX/8P/2/xAAHwAfACMADQAMAAgA4/8SADMAKwAZACkA9v8IABoAEwAZADMAFwAjADAADwDx/+T/EQAMAA8A' +
          '5P/X/xQAIQD3//L/3//b//j/DAAZAN3///8HAAUABgACAAAAEgAXABcACwD1//v/DQANAPr/BQA2AEIA/P/0/w8A9v/a/xQAQwD8/77/1//d//H/5//T/+L/+//1/9r/9/8YANn/y/8BAOj/zf/9/ycA2f/G/woA' +
          '9//W/wAALQAlAAcABQDv/wQAJQAsAPr/6v/z/wMABADq/9v/AgD0/8b/x//0//L/+v/f/+j/DQDo/8j/4P8IANj/9f8HAAYAAgDt//b/AAANAPb/+f/3/x0AIwD8/+//JgAaAAwA9v/g//T/FAD3/8z/9f/Y/+//' +
          'AgDm/9r/6v8SAOH/2f/u//L/8v8GAAMABgABAAcAGwAjAOr/9v8mACgABgAGAAAAIQA2ABAABAAXAAMABQAOAOH/5/8ZAAUA1v/n//b/6f/e/8z/3//7//D/5v/8/wIAEQD9//f//f8HAA8AEwAmACYAHgAMABEA' +
          'HQA1ADcAKgAKAA0AFwAaACAADAD5//r/8P8MAAgA1P/c/wQA/f/k//H/4//h/+L/AQAAAOz/7//1/wAACgD2//f/DgAeABYAIQBIAAsA/P82AC8AHgAsAD4AFQAVACEA//8DABkA/f/Z//b//f/u/9b/3f/d/+X/' +
          '5f/F/8v/BwD//9X/4v/5//f/AQAFAP//+/8hAC8ADgAVAB4AGAAeACsANgAnABUA8f8TADMAHwAEAAMA+f/f/+b/8v/f/93/1f/U/9//+//6/97/1//u/wQA7v/N/+X/CQAKAP3/5//v/xAAHwATACkAKQAcAAcA' +
          'GAAiABwAHAAWACUAFwAWAPv/6f/m/+f/6f/y/+f/0f/W/+z/9f/2//X/4v/f//P/AwAAAPb/3//5/wkA+P/5/wIAEgAbAB8AIwAbAAEADgAYACMAHwAVAAQA/v/+/wUABAD8/+j/7f/1/+r/9//x/+//4v/u//D/' +
          '7P/6/+3/5f8EAA0A9//k//3/AQALABQAAgD//yEAKQAQABwALQAnAAgA//8QABkAFgAJAPP/AAABAOj/4//4//j/5P/r//L/4v/c//b//v/w////+//y/+//BQAGAAQADAASABcAFgAIAAQAGAAuACEAAAD+/xIA' +
          'HAAJAP////8RAAoA+P/1//P/+f/5//X/7//y//H/4P/u/xAA/v/p//L/AgD1/+z/+f8JAAUA/P8DABIAFQADAAIADwAZABcAEgAOABAAHAASAAsA///5/wUADgD4//D/8//2//L/9P/u/+7/7//x//D/6v/1/wMA' +
          '8f/u//7/DQD5//n/CAAWAAcA6/8FACcAHwAGAAUAFwARABIABwD9/wYABgD2//P//f8GAPv/9//6//b/7f/9//n/7//v//b/+v8BAP//8//v//j/BwABAPX/+/8JAAIABAANAAsABgABAAIACAAPAA4AAgD6/wkA' +
          'AwAJABIAAQDt//z/DAABAPr/9v/u////DgD6/+X/8f/8//r/+P/4//f//P/8//3/BwACAPv/BgAMAAAA+P8IAAYABAAJAAoABQADAAsABAD+/wMAEgALAP//+//7//f//f8BAAEA9f/w//7/BAD9//P/+P8CAPr/' +
          '//8IAP7/7f/y/wIAAgADAAUABAD9////EgAVAP//AAANAAoAAgAIAAoABgABAAQA///2//X/CQAJAPL/7v/9/wUA/f8AAP7/+//+/wQA/v/u//X/AwD9//f/+f8AAAIABQANAAcABAACAAYABwAGAAAABQALAAEA' +
          '/v8GAAoAAQAEAAEAAgAGAAUA+v/6/wEAAQD4//7/AQD8//n/9P/2//P/9//3//v/9/8BAAgABQABAP//AQAGAAcACAAGAAcACAAGAP//BgAOAAkA/f8CAAsABwD9//n/AQAGAPv/9P/6//3/+//1//X//P/+//r/' +
          '9P/4/wMAAwD7//3////9////AgD+/wEACAAJAA4ABgD7//7/CQAJAAIA//8IAAkAAAACAA0AAwD5/wAAAgD5//n//f/+//P/7f/3/wEA+//1//r/+f/9/////f/2//7/DQAOAAMABQAKAAgAAgAIAAoAAgAFAAcA' +
          'AQAAAAMAAgACAAAA/v/+//3/+/8AAAAA+f/0//T/+v/9//z/+//4//T/+f8CAAIAAwAFAAIABwAIAAYABAACAAUAAgACAAEAAwAGAAkABwAGAAIA/v/8/wAABQADAP7//P/+/wAA+v/1//r/+v/1//L/9//9//v/' +
          '+f/+/wYABQD9/wIACgALAAYAAwD//wAACAANAAcAAwAEAAUABQAGAAIAAAACAAMAAAD+//z/+//9//3/+P/2//T/9v/6//3//f/6//n/AgAEAP7//f8AAAAAAgAGAAgABQACAAkACQACAAIABgAGAAQABAADAAIA' +
          'AQAEAAUA/v/6//7/AQD+//f/9v/7//3/+v/6//r//f8BAP//+v/8//3//f///wEABQAFAAIAAQAEAAYACAAJAAYAAQABAAMABAAEAAMAAgAAAP/////9//7////9//3///////z//P/+//7//f/6//j//f8CAP//' +
          '+//+/wEAAAADAAQAAgACAAMAAQABAAMABAAEAAIAAwACAAEAAgAEAAIA/////wEAAQD///7/AAACAP///P/8//3//f/8//v/+v/7//7//////wEAAQABAAEAAQAAAP//AQAFAAIAAQADAAYABAABAAEABAAGAAMA' +
          '/////wAA///+//7/AAAAAP7//f/8//z//v/9//3//v////7//v////7//f8BAAIAAAD//wEAAwACAAMAAwACAAIABQADAAEAAAADAAQAAQABAAEAAAAAAAAA///+//7////9//3//v///////v/+//7//P/9////' +
          '//8AAP////8CAAMAAQABAAMAAgABAAIAAwACAAIAAgACAAEAAgADAAEA/////wAAAQD///7///////7//P/9///////9//3///8AAP7/////////AQACAAEAAAAAAAEAAQACAAMAAgABAAIAAgACAAIAAgABAAAA' +
          'AAAAAAEAAQAAAAAA/v/+///////+//3///8AAP///v////////8AAAAA/v///wEAAQABAAAAAQADAAIAAQABAAEAAQABAAIAAgAAAAEAAQAAAP//AAAAAP////8AAAAA/v///////v///wAAAAD/////AAAAAP//' +
          '//8AAAAAAAABAAAAAAABAAEAAQAAAAAAAQABAAEAAAAAAAAAAAABAAAA//8AAAAAAAD/////AAAAAP//////////AAD///////8AAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
                /* 「单次切换」—— 现在用作【切换会话】的提示音（0.286s，单击）。
           原打算给拨杆开关用，但用户指出那个场景实际用不到（不会常去动设置），
           于是改挂到"切换会话"这个真正常用的动作上。
           它的特点正合适：只有一击、起音快（10ms 内到 0.75）、干净利落。
           原始峰值 0.626 本身就够高，保持增益 1.0 不动（不做归一化，
           避免第 19 条那个"增益过大导致失真"的坑）。 */
        const CHIME_SWITCH_B64 =          'UklGRm4xAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YUoxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//wAA//8AAP//AAAAAAAAAAAAAP////8AAAAA' +
          '//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAQABAAEAAQABAAEAAQABAAEAAQABAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////' +
          '//////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABAAEAAQABAAEAAQAAAAAAAQAAAAEAAQABAAEAAgABAAIAAQABAAEAAQABAAIAAgACAAIAAgACAAIAAgACAAIAAwADAAMAAgACAAMAAwADAAMA' +
          'AwADAAQAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwACAAEAAQABAAEAAQAAAAEAAQABAAEAAQABAAEAAAAAAP////////////8AAAAAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAABAAAAAQAAAAEAAAAAAAAA' +
          'AAAAAAAA///////////+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/9/////v/9//7//v/+//7//v/+//7//v/+//7///////7//v///wAAAAD///////////7//v////////////7//v/+//z/' +
          '/P/8//v/+v/6//r/+v/6//r/+f/5//j/9//3//f/9//3//b/9//4//f/9v/3//f/+P/2//b/9v/3//j/9//3//j/9//3//f/9v/4//f/9//4//j/9//2//X/9v/3//f/+f/4//r/+f/2//P/9v/0//P/9P/1//b/' +
          '9//4//n/+P/4//X/+P/7/wAABAADAAUAAwADAAMAAwAGAAcACAALAAkACwAIAAUABAAGAAAABgAGAAcADQALABAADAADAAwA+//I/7z/z//e/+T/4v/W//n/yv/g/xsANwAtAAsAKgArAAsAGQAFAAcAKwBFAGoA' +
          'rQBPAGUAawA9AC8AOAAlAEEADgBJACUAOQAiAEgACwBNAEcAZAA8AE8A/P/x/xQA5/8fABcA2P9JADgACgD//yMA5P/I//b/t/8MAND/zv8xAOf/BAD//xoALgDi/x4A/v8RAMT/EQDC//H/9/9CAA8AQQAaAMj/' +
          '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' +
          '5//3/xAAAwAJAA0A/v8AAPr/BQALAPL/2f/Y/+f/8v8SABAACwAXAAEABAD+//7/EwABAPz/9v8NABUAFQAWAPT/8P/0/w0AGgAfAAgA7f8AAP3/AwD9/+7/6P/8/w4AJAAfAAIA9P/i/+H/+f8GAAYA/f/+/wAA' +
          'EwARAAEA9//t//P/+P/7/wcA/v/y/+v/+f8HABgA///u//3/GAAOAO7/5P8FAAUA9P/7/xAAIwALAPT/8P8EAAgA6//z//7/EgAHAAQAAQD7/wIA9f/6//z/BAADAPv/9P/8//T////5//r/+v8NABEACQAQAAoA' +
          '/v/2/+3/6v8AABAAAQAAAAkAAwD///b/9P8HAAEA+v8FAPv//f8AAAIA9f/8//7/CwAGAPv///8DAAoAAwD0/+//+P8TABYAEQD4//v/BgAAAAAA/f8BAP///P///wIABwALAAIA/v8MAA4ACQD+//3/9v/1//7/' +
          'AAD7//3/BgD9//f/AwAEAPj/8P8BABsAEQD2/+3//v/8//3//f8AAAUA/f/4/woADwAIAPr/+P8BAAwACgACAAcABAAGAAUADQAAAOn/8f8FAAoAAwAGAAMABAD+/wQAAwD8//T/9/8LAAgA/f/8/wEAAQDs/+//' +
          '+P8IAAEA8f/3/w4AFQADAPP/9//3//H/AQAQAAkA+P/9/wcACQD3//P/AAAJAAQAAQAOABEABwDz//L/AwAHAPz/+f/+/wMAAgAGAPr/8//3//j/AwAGAP///f8HAAQA/f/3//7/AgD7//v//f8BAAIA+P/z//v/' +
          '//8FAAUACgAFAP//AwAIAAQA/f/2/wMABwD8////CAAJAAcA+//2//z/BQACAAcABQAHAAQA/P/1//T//P/+/wIAAwD+/wEAAgD+//3/9f/6/wMABAAAAA4ACAADAAEA/f/8/wQAAAD8/////v8GAAoABgAGAPv/' +
          '/P8CAAkABAAGAAgAAwD9//7//v/4//7///8BAAQAAgD/////+//5//n/AwACAAMA/f/+////+//9//3//P8EAP3///8FAAQAAwAHAAMAAQACAP//BAADAAkABgADAAQAAQD//////f/+/wIAAwAJAAYAAgD9//n/' +
          '+f/3////AgD///n/AQAAAPv/+f/3//v/AQAAAP7//f/8/wAA/v/7//7//f/9/wAABAALAAgABAABAPr//P8BAAIABQAIAAUABgAEAAIAAgD9//7/AQABAAEAAgABAAEAAAD8//3//f/8//3//P/9/wIA/v/7//r/' +
          '+P/8//7/+f/6//3/AAADAAEA///9//z//v/+//3/BQAGAAIAAQACAAcABwAEAAIAAAAAAAMAAQAEAAgABwAFAAEAAQACAAAA/////wAAAAAAAPz/+v/7//7/AwACAP3//P/5//r//P///wIA///9//j/+f///wAA' +
          'AAACAAIAAgAAAP//AwADAP//AQACAAYABQAEAAUAAwADAAUABgAEAAEA//8AAAQABAABAAEAAgABAP///f///////P/8//7////+//v/+v/9//7///////7//P/7/////v/+/wEAAAD9//3/AAAFAAUAAwADAAIA' +
          'AwAEAAIAAQABAAIAAwAGAAcABAAAAAEAAwADAAQAAQAAAP7//v///wEAAAD9///////+//7//v/9//v/+//+//3////+//3//v/+//////8AAP///////wAAAQACAAIAAAABAAMABAAEAAMAAgABAAMABAACAAEA' +
          'AgABAAEAAgACAAEAAAAAAAEA/////////v/9//3//v/+//z//v/////////9//3//v/+//3//f/+////AAAAAAEAAQAAAAAA//8AAAIAAwACAAEAAQACAAQAAwABAAAAAgACAAMAAwABAAEAAAD//wIAAwAAAP7/' +
          '/v///wEAAQD///3//f/9//7//////////v/+/wAAAAD///7//f/9/wAAAQAAAP////8BAAEAAQABAAAAAAAAAAIAAgADAAIAAQAAAAEAAQAAAAAAAAABAAIAAgABAAAA//////////////////8BAAAA//////7/' +
          '/v////////8AAP//AAAAAAAAAAD///////8AAAAAAQABAAEAAAAAAAAAAAABAAAAAAABAAEAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

        /* ── 多音播放器 ────────────────────────────────────────────────────────
           三个音：roundStart（复位）/ roundEnd（叮）/ type（打字）。
           base64 在 setup 时【全部预解码】—— 不等首次播放才解，否则第一声会晚半拍，
           而"应答音"晚半拍就不像应答了；开始序列更明显（复位音要立刻跟上）。 */
        const SOUND_SRC = {
          roundStart: CHIME_RESET_B64,
          roundEnd: CHIME_B64,
          type: CHIME_TYPE_B64,
          session: CHIME_SWITCH_B64,
        };
        /* 音量分层：不同类型该有不同的响度，否则会互相盖。
             roundEnd   0.18  —— 状态提示，用户要听见
             roundStart 0.45  —— 【比另两个高得多，原因见下】
             type       0.085 —— 重复三次，必须很轻，否则变成噪音

           roundStart 为什么是 0.45：
             这个音【不再做峰值归一化】。原先为了把它拉到 0.84 峰值，
             加了 2.9 倍增益 —— 叠加重采样，用户听到的明显失真
             （他原话是"完全失真了"）。
             现在保留原始动态（峰值 0.544），响度靠这里的播放增益补，
             而不是去改样本本身。改播放增益不会产生削波失真。 */
        const SOUND_GAIN = { roundStart: 0.16, roundEnd: 0.18, type: 0.085, session: 0.20 };

        let audioCtx = null;
        let audioBus = null;          /* 总线：所有音都经它再进 destination */
        const soundBuf = {};          /* name → AudioBuffer（解码后） */
        let soundWasRunning = false;
        let soundArmed = false;       /* 是否见过一次"运行中"——没见过就不播（避免初始态误报） */
        let pendingPlay = null;       /* 想播但 AudioContext 还没 running（等解锁后补播） */

        /* ── 总线保护（别靠"应该不会同时到"）────────────────────────────────
           加了「音效强度」滑块后，最大可以到 200%。峰值余量会明显变薄。
           【以下数字都实算过】（增益 × 素材峰值 × 强度乘数）：

             强度 100%（默认）
               开始序列（复位 + 3×打字）最坏叠加 ≈ 0.228
               结束序列（叮 + 尾音）    最坏叠加 ≈ 0.171
             强度 200%（滑块上限）
               开始序列 ≈ 0.456    结束序列 ≈ 0.342
               单音最大 切换 ≈ 0.250

           所以 200% 时其实【也还没到 1.0】。但余量只剩约 0.54，
           而这些都是瞬态型素材（crest 20+），峰值撞在一起的概率不低 ——
           一旦越界就是硬削波（刺耳的"啪"）。所以加一道保险，而不是赌。

           在每组增益与 destination 之间插一个 DynamicsCompressor 当限幅器：
             threshold -3dB（= 0.708 线性）
               注意这个值【高于】上面所有组合的峰值 —— 包括 200% 的 0.456。
               所以正常使用下它【一次都不会介入】，是透明的；
               只有出现意料之外的叠加（或未来加了更多音）才会开始压。
               换算：开始序列要到约 310% 才会触发，而滑块上限是 200%。
             knee      0     硬拐点，只在越过阈值后才压
             ratio     20    接近限幅
             attack    0.003 3ms，才拦得住瞬态
             release   0.15  不要压着不放
           这样：200% 也不会破音，而正常音量下听感完全不受影响。 */
        /* 【上下文与派生对象的生命周期，收拢在这里】
           ------------------------------------------------------------------
           自检发现两个同源的 BUG，根因都是"重建 AudioContext 后没清理派生物"：
             ★ ensureBus() 只判断 `if (audioBus) return audioBus` ——
               而 AudioContext 是可能被重建的（切换被关闭 / 系统回收）。
               重建后 audioBus 指向的是【旧上下文】的节点，把新音源接上去
               等于接到一个已废弃的图里 → 无声或错乱。
               修法：连 context 一起校验。
             ★ soundBuf 里存的是【旧上下文】解出来的 AudioBuffer。
               AudioBuffer 与创建它的上下文绑定，跨上下文使用不受保证。
               修法：重建时一并清空（下面的解码循环会重新填充）。

           顺手把"创建上下文"也收进这个函数 —— 原先有两处各写一遍
           （初始化一处、resume 重试一处），清理逻辑会散落，迟早漏一边。
           现在只有这一个入口，重建时该清的一定会清。 */
        const ensureCtx = () => {
          try {
            if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            /* 重建后必须作废的派生物 */
            audioBus = null;      /* 旧压缩节点已随旧上下文失效 */
            for (const k of Object.keys(soundBuf)) delete soundBuf[k];
            pendingPlay = null;   /* 排队的那一声属于旧上下文，留着重播无意义 */
            return audioCtx;
          } catch { return null; }
        };

        /* 【建立/刷新上下文的统一动作】预解码与恢复播放都走它。
           resume() 的 Promise 一律 catch —— 解锁失败时留待下次用户交互重试，
           不让它变成未处理的拒绝。 */
        const useCtx = () => {
          const ctx2 = ensureCtx();
          if (!ctx2) return null;
          try {
            if (ctx2.state !== 'running') {
              const p = ctx2.resume();
              if (p && typeof p.then === 'function') p.catch(() => { /* 下次交互再试 */ });
            }
          } catch { /* noop */ }
          return ctx2;
        };

        const ensureBus = () => {
          try {
            /* 【必须连 context 一起校验】只判断 audioBus 是否存在是不够的 ——
               上下文一旦重建，旧总线就是废弃对象（见上面自检记录）。 */
            if (audioBus && audioBus.context === audioCtx) return audioBus;
            const comp = audioCtx.createDynamicsCompressor();
            comp.threshold.value = -3;
            comp.knee.value = 0;
            comp.ratio.value = 20;
            comp.attack.value = 0.003;
            comp.release.value = 0.15;
            comp.connect(audioCtx.destination);
            audioBus = comp;
            return audioBus;
          } catch {
            /* 不支持时退回直连，不影响发声 */
            return audioCtx.destination;
          }
        };

        /* 是否真的能出声：看 AudioContext 的实际状态，而不是记一个"解锁过"的布尔量。
           【这条是踩过坑的】原实现用 chimeUnlocked 标志，但它在"解锁那次恰好有待播"
           时才置真 —— 于是首轮结束不响，第一声要等到第二轮。
           浏览器对"能不能播"的权威是 audioCtx.state，能读就读，别缓存。 */
        const audioReady = () => !!(audioCtx && audioCtx.state === 'running');

        /* 【诊断用】一行摘要，供"点了没声音"时定位到底是哪一层：
             ctx —— 上下文状态（none = 还没创建 / suspended = 未解锁 / running = 可用）
             buf —— 已解码的音源数（0 = 解码没成功，多为 base64 或格式问题）
             fn  —— 试听按钮是否已挂上回调（false = 开关状态导致没挂）
             vol —— 当前强度乘数（0 = 被强度滑块静音了） */
        const audioDiag = () => ({
          ctx: audioCtx ? audioCtx.state : 'none',
          buf: Object.keys(soundBuf).length + '/' + Object.keys(SOUND_SRC).length,
          fn: typeof previewFn === 'function',
          vol: clampPct(prefs.soundVolume, 100) / 100,
        });

        /* 发声。when 是相对当前时间的秒偏移（同一序列里用绝对时间排布，避免 setTimeout 抖动）。
           volume 允许按次覆盖分组音量。
           opts.fadeOut = 在多少秒内把音量淡到 0（不传则不淡，播完整段）。
             用途：结束时那个"复位"尾音原本长 1.4s，而用户发下一条消息时
             开始序列的复位+打字会撞进来 —— 听感就是"打字声跟到结束的复位后面"。
             不裁素材（它的主尖峰在 0.75s，硬裁 0.55s 会把尖峰切掉），
             而是在播放层用增益包络把它收干净。 */
        const fireSound = (name, when, volume, opts) => {
          try {
            if (!audioReady()) { tracePush('fire-blocked', { name, why: 'not-ready' }); pendingPlay = { name, volume }; return false; }
            const buf = soundBuf[name];
            if (!buf) { tracePush('fire-blocked', { name, why: 'no-buffer' }); return false; }
            const src = audioCtx.createBufferSource();
            const gain = audioCtx.createGain();
            /* 【强度乘数】乘在每组增益之上 —— 于是调总强度不会改变各音的相对配比。
               clampPct 把值夹在 0~200，再 /100 得到 0~2 的乘数。
               放在 fireSound 里而不是写进 SOUND_GAIN，是因为它要【在每次发声时读】，
               这样用户拖动滑块后立刻生效，不需要重建任何东西。 */
            const mul = clampPct(prefs.soundVolume, 100) / 100;
            const vol = ((volume === undefined) ? (SOUND_GAIN[name] || 0.15) : volume) * mul;
            const at = audioCtx.currentTime + (when || 0);
            const fade = (opts && opts.fadeOut) || 0;
            if (fade > 0) {
              /* 线性淡出：先保持 vol，再降到 0。用 setValueAtTime 固定起点，
                 避免依赖默认值（不同实现对初始值的处理可能不同）。 */
              gain.gain.setValueAtTime(vol, at);
              gain.gain.linearRampToValueAtTime(0, at + fade);
            } else {
              gain.gain.value = vol;
            }
            src.buffer = buf;
            src.connect(gain);
            gain.connect(ensureBus());
            src.start(at);
            tracePush('fire', { name, vol: Math.round(vol * 1000) / 1000 });
            return true;
          } catch (e) { tracePush('fire-threw', { name, msg: String(e && e.message || e).slice(0, 60) }); return false; }
        };

        /* 解锁：首次用户交互时 resume。
           不设 once —— AudioContext 可能被系统重新挂起，需要能再次唤醒；
           卸载时成对移除（见下面的返回函数）。 */
        const audioUnlock = () => {
          try {
            if (!audioCtx) return;
            if (audioCtx.state === 'suspended') {
              const p = audioCtx.resume();
              if (p && typeof p.then === 'function') {
                p.then(() => {
                  if (pendingPlay) {
                    const q = pendingPlay; pendingPlay = null;
                    fireSound(q.name, 0, q.volume);
                  }
                }).catch(() => { /* 解锁失败：留着 pending，下次交互再试 */ });
              }
            }
          } catch { /* noop */ }
        };

        /* 预解码（首次建立上下文）。放在模块作用域执行一次，而不是等 setupSounds ——
           setupSounds 会随开关反复启停，而解码只该做一次。
           useCtx() 内部会 resume；若此刻用户还没交互，resume 会失败并安静收场，
           解码本身仍会进行（decodeAudioData 不需要 running 状态）。 */
        const primeDecode = () => {
          const c = useCtx();
          if (!c) return;
          for (const name of Object.keys(SOUND_SRC)) {
            if (soundBuf[name]) continue;   /* 已解码过就不重复 */
            const raw = atob(SOUND_SRC[name]);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            Promise.resolve()
              .then(() => c.decodeAudioData(bytes.buffer))
              .then((decoded) => { if (audioCtx === c) soundBuf[name] = decoded; })
              .catch((e) => console.warn('[phosphor] 音效解码失败:', name, e));
          }
        };

        /* 【回合开始】只放复位音。
            ------------------------------------------------------------------
            原来这里还固定排三声"打字"（0.40/0.58/0.76s）。用户听后指出：
              「执行会话时有时会触发打字机入场，那个声音是对的」
            意思是：打字声应该跟着【内容真正出现】的时候响，
            而不是跟在一个拍脑袋定的时间点上。
            所以那三声已移除，改由内容到达驱动 —— 见下面的 typeTicker。 */
        const playRoundStart = () => {
          if (!prefs.startReset) return;   /* 复位音独立开关 */
          if (!audioReady()) { pendingPlay = { name: 'roundStart' }; return; }
          fireSound('roundStart', 0);
        };

        /* ── 内容到达时的"打字"声 ────────────────────────────────────────────
           宿主的内容是【流式按块追加】的（本文件 §9 那条 typew 规则的注释
           已经查明：纯 CSS 无法回放逐字符效果，所以视觉上只做了整段淡入）。
           但"文本节点在变化"这个事实是可监听的 —— 它才是真实的打字节奏。

           触发源：characterData 变化 + 聊天节点内的 childList 新增。

           ── 节奏控制（用户两次反馈后定的）────────────────────────────────
           用户原话：「有些时候你会瞬间生成一堆的文本，在我耳朵里听起来像挺机关枪」
                    「正常情况下打字机的速度是不会很快的」
                    「在没有播完打字声的情况下不要重复」

           所以做了两层限制：

           ① 最小间隔 gapMs（现由「打字机速度」滑块推导）
              原来 110ms ≈ 9 声/秒（机关枪），一度收到 260ms（偏慢）。

           ② "不重叠"闸：一声还在响就不发第二声（用户明确要求）

           ── 关键修正：闸门该按【有效段】算，不是按【素材全长】算 ──────────
           之前把忙碌时长设成素材全长 0.64s，于是上限被锁死在 1.6 声/秒 ——
           调 ① 完全没用，因为 ② 才是瓶颈（用户反馈"又有点慢了"就是这个原因）。

           而打字音的能量分布（实测 10ms 包络）是：
             0.21~0.24s  起音
             0.27s       主瞬态 pk 0.84   ← 一击的主体
             0.39s       次瞬态 pk 0.60   ← 第二个小尖峰
             0.45s 之后  衰减到 0.05 以下 ← 尾巴，很轻
           所以"听得出是一击"只需要覆盖前 ~0.3s。尾巴（0.3~0.64s，幅度 <0.1）
           叠上去听感上不会糊 —— 反而更像连续打字时的自然余响。

           于是忙碌时长改为 duration × busyRatio（默认约 0.45 ≈ 0.29s），
           上限提到约 3.4~3.9 声/秒。

           ── 两个参数现在都由「打字机速度」滑块推导 ────────────────────────
           速度取值 0~200（与其他强度滑块同一语汇：越大越快）。
             s = speed / 200
             gapMs      = 380 - 260·s     → s=0: 380ms      s=1: 120ms
             busyRatio  = 0.90 - 0.50·s   → s=0: 0.90×640   s=1: 0.40×640
           两式都调过，目的是让【两个约束在整段行程里都接近】，不至于出现
           "拖了半天没变化"（那说明调的不是瓶颈 —— 第 25 条）。
           实测各档的实际上限：
             speed   0 → 1.7 声/秒      speed 100 → 2.4 声/秒
             speed 180 → 3.4 声/秒      speed 200 → 3.9 声/秒
           默认 180：它正好还原此前手调出来的手感（gap 150 / busy 288），
           同时两侧各留出行程。 */
        const TYPE_SPEED_DEFAULT = 180;
        /* 速度 → 两个约束。写成函数而不是两个常量：
           它们是同一个"速度"的两个侧面，分开写迟早会不同步。 */
        const typeParams = (speed) => {
          const s = clampPct(speed, TYPE_SPEED_DEFAULT) / 200;
          return {
            gapMs: 380 - 260 * s,
            busyRatio: 0.90 - 0.50 * s,
          };
        };
        let typeLastAt = 0;
        let typeBusy = false;        /* 上一击的有效段是否还在响 */
        let typeBusyTimer = null;
        let contentTyping = false;   /* 由主观察者维护：只在生成中才出声 */
        /* 【自愈看门狗】上次核对「生成是否已结束」的时间戳。
           见 typeTicker 里 reconcile 的说明。 */
        let typeRecheckAt = 0;

        const typeTicker = () => {
          /* ── 自愈：核对 contentTyping 是否与现实一致 ──────────────────────
             【为什么需要它】用户报告过「会话结束后打字声不断播放」。
             那个症状的机制是 contentTyping 卡在 true，而它只能由
             syncSoundRunState 的「真→假」分支清掉 —— 也就是说：
             **只要那次属性变化被漏掉（MutationObserver 合并记录、
             属性摘掉又立刻加回、或任何时序意外），状态就永远卡住，
             而且我无法复现，也就无从确定是哪一种。**

             与其赌"修好了"，不如让它**自证**：
             typeObs 在每次 DOM 变化时都会调这里，所以借这个现成的时机
             顺带核对一次现实。核对限频（400ms）以免在流式输出时反复跑。

             【为什么这是【读】而不是改状态机】
             只把 contentTyping 拉回 false，**不去动 soundWasRunning /
             soundArmed**。因为那两者若被误改，会让结束音在下一轮开头
             被再放一次（"叮"重复）—— 那比"打字声多响一会儿"更糟。
             只清 contentTyping，最坏情况是"少响一声结束音"，
             不会出现重复音。 */
          if (contentTyping) {
            const t = Date.now();
            if (t - typeRecheckAt > 400) {
              typeRecheckAt = t;
              if (!document.querySelector('[data-phosphor-stop]')) {
                contentTyping = false;
                tracePush('self-heal', { reason: 'typing-flag-without-run-marker' });
                return;
              }
            }
          }
          if (!contentTyping) return;
          if (!prefs.startType) return;   /* 打字音独立开关（用户可只留复位音） */
          if (typeBusy) return;                       /* ② 没播完不重复 */
          /* 每次发声时按当前速度重新取两个约束 —— 用户拖滑块后立刻生效，
             不需要重建任何东西（与 soundVolume 的处理一致）。 */
          const p = typeParams(prefs.typeSpeed);
          const now = Date.now();
          if (now - typeLastAt < p.gapMs) return;     /* ① 最小间隔 */
          /* 【两个状态都要在"确实发出去"之后才更新】
             原先 typeLastAt = now 写在 fireSound 之前 —— 于是当这一声没发出去
             （音频未就绪 / 素材还没解码好）时，间隔窗口白被消耗：
             接下来 150ms 内的文本变化都会被这个假时间戳挡掉。
             现在成功才更新时间戳与忙碌标志，失败就让下一次 tick 立刻重试。 */
          if (!fireSound('type')) return;
          typeLastAt = now;
          typeBusy = true;
          /* 忙碌时长 = 素材时长 × busyRatio（只覆盖"有效段"，见上面的推导）。
             取 decoded buffer 的 duration 而不是写死 —— 换素材这里自动跟上。
             拿不到就退回 640ms；下限 120ms 是防呆：万一素材极短或 duration
             读不到，也不至于把闸闸死。 */
          const full = (soundBuf.type && soundBuf.type.duration) ? soundBuf.type.duration * 1000 : 640;
          const busy = Math.max(120, Math.round(full * p.busyRatio));
          if (typeBusyTimer) clearTimeout(typeBusyTimer);
          typeBusyTimer = setTimeout(() => {
            typeBusy = false;
            typeBusyTimer = null;
          }, busy);
        };

        /* 【回合结束序列】用户的设计：叮声之后接一个复位。
             —— 于是整轮首尾呼应成环：
                开始 = 复位（上电/装载）→ 打字 → 结束 = 叮 → 复位（归位）

           时间用【实测时长】推出来的，不是猜的：
             roundEnd（叮）实测 0.55s，所以复位排在 0.52s ——
             留 30ms 交叠，避免两音之间出现可听的空档（"断开感"）。
           它比"等叮播完再响"更连贯，又不会把两个音糊在一起。

           音量：复位在这里降到 0.30（开始序列里是 0.45）。
             同一个样本、两种角色 —— 开头它是"招牌音"要立住，
             结尾它是"收尾"要退后。所以【按次传 volume】而不是改全局 gain。 */
        const playRoundEnd = () => {
          if (!audioReady()) { pendingPlay = { name: 'roundEnd' }; return; }
          fireSound('roundEnd', 0);
          if (prefs.endReset) fireSound('roundStart', 0.52, 0.11, { fadeOut: 0.45 });
        };

        /* 【试听序列】给设置面板的「▶ 试听」按钮用。
           ------------------------------------------------------------------
           动机：调音效强度 / 打字机速度时，若要靠"发一条消息、等回答结束"
                 才知道对不对，试错成本太高。所以做一段把四类音都走一遍的
                 演示，几秒钟内听全。

           编排（用 AudioContext 绝对时间，不用 setTimeout —— 与其它序列一致）：
             t=0.00s  复位（开始序列首音）
             t=1.15s  打字 ×3，间隔【按当前速度设定】—— 这样拖速度滑块后
                      点试听，能直接听出差别
             t=+1.30s 切换会话（单次切换）
             t=+0.55s 叮
             t=+0.52s 复位尾音（0.45s 淡出，与真实结束序列一致）

           打字那三声【故意不走 typeTicker】：
             typeTicker 依赖 contentTyping（只在生成中为真）与 typeBusy，
             试听时这两者都不该被牵动 —— 否则试听会打乱真实打字的节奏状态，
             而且试听期间正好生成的话会互相干扰。 */
        let previewBusy = false;
        let previewTimer = null;
        const playPreview = () => {
          if (previewBusy) return true;   /* 正在试听：忽略重复点击（返回 true 不报错） */
          if (!audioReady()) {
            /* 还没解锁。这里【不再顺手写 pendingPlay】—— 那是早期版本的遗留：
               现在解锁监听不会自动补播它，留着只会让状态含义模糊。
               直接返回 false，由按钮给出"请先点一下页面"的提示。 */
            return false;
          }
          /* 【闸门必须在副作用之前置位】自检发现的 BUG：原先 previewBusy = true
             写在所有 fireSound 之后，于是这一段内连点两次不会被拦 ——
             整段演示（复位+3打字+切换+叮+尾音）会叠加两遍，听感就是"炸"。
             现在紧贴 audioReady 之后置位，任何后续早退都不会漏掉它。 */
          previewBusy = true;
          const p = typeParams(prefs.typeSpeed);
          const gap = p.gapMs / 1000;
          /* 【演示要反映当前开关】关掉的音就不播 ——
             否则用户会以为"关了还在响"，也会误判自己的设置没生效。
             后续时间戳按实际播出的内容推进，避免关掉某项后留下长空洞。 */
          if (prefs.startReset) fireSound('roundStart', 0);
          const typeAt = 1.15;
          const typeCount = prefs.startType ? 3 : 0;
          for (let i = 0; i < typeCount; i++) fireSound('type', typeAt + i * gap);
          const afterType = (typeCount > 0 ? typeAt + (typeCount - 1) * gap + 0.35 : 1.30) + 0.95;
          /* 每一类音都按自己的开关决定播不播 —— 演示必须如实反映开关状态，
             否则"关了还在响"会让人误判设置没生效（或以为有 bug）。 */
          if (prefs.sessionSound) fireSound('session', afterType);
          if (prefs.soundEnd) fireSound('roundEnd', afterType + 0.55);
          if (prefs.soundEnd && prefs.endReset) {
            fireSound('roundStart', afterType + 0.55 + 0.52, 0.11, { fadeOut: 0.45 });
          }
          /* 忙碌到整段放完（末音起于 afterType+1.07，长 1.455 但 0.45s 淡出） */
          if (previewTimer) clearTimeout(previewTimer);
          previewTimer = setTimeout(() => { previewBusy = false; previewTimer = null; },
            Math.round((afterType + 0.55 + 0.52 + 0.45) * 1000) + 150);
          return true;
        };
        /* 【不在这里挂 previewFn】它的所有权归 applySound()（它按总闸与
           开关状态决定赋 playPreview 还是 null）。两处都写同一个变量会导致
           时序问题 —— 这正是自检发现的"清理了派生物、重建时没恢复"的第三个
           同族问题。setupSounds 只负责建立观察者与解锁监听。 */


        /* ── 音效的启停 ──────────────────────────────────────────────────────
           与其它"有建立必有回收"的探针同构：用一个可重入的 applySound()，
           开关变化与初始挂载走同一条路径，不会出现"开了两次"或"关不干净"。
           【开关】开始侧两项 startReset / startType、结束侧 soundEnd、
           sessionSound、endReset —— 各自独立判断，互不牵连。
           只要有一个开着就得建立 —— 它们共用一个观察者，
           分成多个实例会各自观察同一属性、互相干扰。 */
        /* 【重入守卫】
           evalStateAchievements() 命中时会调用 markFound → setPref → 再次广播，
           于是 onPref 会在自己还没跑完时被【重入】一次 —— 那一次会把
           applySound 建的观察者拆了再建（音效自检因此报"打字声观察者缺失"）。
           守卫的语义：一次广播只跑一次完整处理。内层那次什么都不做，
           因为外层用的就是同一份 prefs，状态不会漏。 */
        let prefReentrant = false;
        const onPref = () => {
          if (prefReentrant) return;
          prefReentrant = true;
          try {
          /* 【状态型成就放在最前面】末尾可能被前面任何一次异常跳过，
             power cycle 那条就是这么死的。 */
          evalStateAchievements();
          if (prefs.enabled) {
            applyInline();
            pushTokens();
          } else {
            clearInline();
            releaseTokens();
          }
          /* 高对比层跟着总开关走：关掉主题时它也必须撤掉，
             否则会留下一层"只改了边框与次要文字"的孤立覆盖。 */
          syncHighContrast();
          reflectRoot();
          /* 音效跟随「终端外观」总闸与自身开关两重条件 */
          applySound();
          /* 关掉总闸时把街机一并收起 —— 否则那个面板会悬在那里，
             失去全部主题令牌（颜色/边框/字体都回落到宿主默认），很突兀。
             它不是"偏好"（不进 DEFAULTS），所以在这里强制关掉即可。 */
          if (!prefs.enabled && arcadeOpen) setArcadeOpen(false);
          /* 彩蛋总开关关掉时，街机立即收起（入口也会失效，见 StatusBar） */
          if (!prefs.eggs && arcadeOpen) setArcadeOpen(false);

          /* 【电源效果】放在最后：此时主题状态已全部切换完毕，
             动画只是盖在上面演一遍。它【不依赖任何主题令牌】——
             因为关机时 data-phosphor 已被 reflectRoot 摘掉，
             依赖令牌的样式会在那一刻失效（见 CSS 里的说明）。 */
          if (prefs.enabled !== prevEnabled) {
            const wasOn = prevEnabled;
            prevEnabled = prefs.enabled;
            /* 【动画照旧，成就已删】这里只负责播电源效果。
               曾经在同一分支里 markFound('power') 记一条"完成一次电源循环"，
               但实测触发不了，所以把那条日志行撤了 —— 撤的是记录，不是动画。
               两者本来就不该绑在一起：一个是观感，一个是成就。 */
            if (prefs.powerFx) setPowerPhase(wasOn ? 'off' : 'on');
          }
          } finally {
            prefReentrant = false;
          }
        };
        listeners.add(onPref);
        /* 已经处在该状态的人（例如系统一直开着高对比）也要补记上 */
        evalStateAchievements();

        /* 【为什么不在挂载时立刻建立上下文】
           自检后改的：applySound() 内部会 primeDecode()，也就是【在用户交互之前
           创建 AudioContext】。部分 Chromium 版本会因此把上下文标为未解锁，
           之后的 resume() 可能不生效 —— 表现正是"点了试听没声音、控制台也不报错"。

           现在改成：首次用户交互时才建立上下文并解码。
             · 本监听用 capture 且只生效一次；它与 audioUnlock 不冲突 ——
               本监听负责"建立"，audioUnlock 负责"唤醒被系统重新挂起的"。
             · 在此之前 applySound() 仍会跑（按钮可用性要立刻反映开关状态），
               只是它内部的 primeDecode 会被 soundPrimed 挡掉。 */
        let soundPrimed = false;
        const primeOnce = () => {
          if (soundPrimed) return;
          soundPrimed = true;
          applySound();          /* 此刻才真正创建上下文并解码 */
        };
        try {
          document.addEventListener('pointerdown', primeOnce, { capture: true, passive: true });
          document.addEventListener('keydown', primeOnce, { capture: true, passive: true });
        } catch { /* noop */ }
        /* 若用户此前已经与本页交互过（页面已"参与"），就无需再等下一次点击。
           navigator.userActivation 在较新 Chromium 可用；拿不到就等首次点击。 */
        try {
          if (navigator.userActivation && navigator.userActivation.hasBeenActive) primeOnce();
        } catch { /* noop */ }

        function setupSounds() {
          try {
            document.addEventListener('pointerdown', audioUnlock, { capture: true, passive: true });
            document.addEventListener('keydown', audioUnlock, { capture: true, passive: true });
          } catch { /* noop */ }

          /* 解码交给 primeDecode（见它的注释）—— 这里【不再重复一份解码逻辑】。
             原先这里和初始化各写了一遍，自检时正是"两处各写一遍"导致
             清理逻辑漏了一边（跨上下文的 AudioBuffer）。现在只有一个解码处。
             解码是异步的，首次 setup 时可能还没完成；那一声会被 fireSound 的
             `if (!buf) return false` 挡掉（静默不响），而不是抛错。 */
          if (!useCtx()) { console.warn('[phosphor] 音频上下文不可用，音效停用'); return () => {}; }
          primeDecode();

          /* 【回合开始/结束的触发：必须是【独立观察者】】
             ------------------------------------------------------------------
             ★ 这里我犯过一个真实且严重的错误，记下来避免重犯：
             我曾"优化"成由 runProbes 主动调用 syncSoundRunState，理由是
             "data-phosphor-stop 本来就是 runProbes 写的，同一条变更流上
             不必挂两条链"。**这个推理是错的**，而且直接把音效弄坏了：

                runProbes 有一个【早退分支】——
                  if (composerHoldsEditable() && isLive(markedToolbar) && isLive(markedSend)) return;
                它跳过 markComposerCard / markComposerToolbar / markSendState。
                而 markSendState 是【唯一】会 removeAttribute('data-phosphor-stop')
                的地方（按 aria-label 决定 set 还是 remove）。
                于是只要探针认为"状态已就绪"而长期早退，
                data-phosphor-stop 就【永远不会被摘掉】→
                  · running 恒为真 → "真→假"分支永不执行 → 一轮结束【不响叮】
                  · soundWasRunning 恒为真 → 下一轮开始【不响复位音】
                  · contentTyping 恒为真 → 打字声【停不下来】

             【关键教训】那个属性能否被摘掉，取决于【另一个组件的控制流】。
             观察者【直接盯着属性】才是解耦的；改成"顺带调用"就把音效的
             正确性绑到了别人的早退条件上。所谓"少一条链"省下的代价，
             远小于换来这个隐蔽故障。

             语义（与修复前一致）：
               · 假→真（闲变忙）→ 放开始序列（复位音；打字音由 typeTicker 另判）
               · 真→假（忙变闲）→ 放结束序列（并关掉打字声的 contentTyping） */
          /* 轨迹用模块级的 tracePush（见它的注释）。这里补上音效状态字段，
             便于事后判断「当时是不是正在生成」。 */
          const traceState = (ev, extra) => tracePush(ev, Object.assign({
            running: !!document.querySelector('[data-phosphor-stop]'),
            typing: contentTyping,
            wasRunning: soundWasRunning,
            busy: typeBusy,
          }, extra || {}));

          syncSoundRunState = () => {
            const running = !!document.querySelector('[data-phosphor-stop]');
            if (running) {
              if (!soundWasRunning) {
                soundArmed = true;
                /* 开始序列：复位音由 playRoundStart 内部判 startReset；
                   打字音由 typeTicker 判 startType —— 两者互不牵连。 */
                playRoundStart();
                traceState('round-start');
              }
              /* ★ running 为真但 soundWasRunning 已是真 —— 这是"属性又回来了"的
                 典型情形（同一 microtask 内摘掉又加回，MutationObserver 会把
                 多条记录合并，于是这里只看到"还在"）。
                 记一条，用来分辨"没摘掉"与"摘了又加"。 */
              else if (contentTyping === false) {
                traceState('running-still-true-but-typing-was-false');
              }
              soundWasRunning = true;
              contentTyping = true;    /* 生成中：允许内容到达时出打字声 */
              return;
            }
            /* 真→假：一轮结束 */
            const wasTyping = contentTyping;
            if (soundWasRunning && soundArmed && prefs.soundEnd) playRoundEnd();
            soundWasRunning = false;
            contentTyping = false;     /* 生成结束：打字声立即停 */
            traceState('round-end', { firedEndSound: !!(soundArmed && prefs.soundEnd), wasTyping });
          };
          /* 初始态：若挂载时已经在运行，先置位 —— 避免把"已经在跑"当成"刚开始"，
             否则挂载瞬间会补放一次开始序列。 */
          soundWasRunning = !!document.querySelector('[data-phosphor-stop]');
          if (soundWasRunning) soundArmed = true;

          /* 观察者：只盯这一个属性，属性一变就同步一次。
             为什么用 attributeFilter 而不是全子树 attributes：代价极低，
             而且本插件自己的 runProbes 会频繁改【别的】属性
             （composer 标记、溢出标记），不限定过滤器会白跑很多次。 */
          const runStateObs = new MutationObserver(() => { runStateObsHits++; syncSoundRunState(); });
          try {
            runStateObs.observe(document.documentElement, {
              attributes: true, attributeFilter: ['data-phosphor-stop'], subtree: true,
            });
          } catch { /* noop */ }

          /* ── 切换会话的提示音 ─────────────────────────────────────────────
             【为什么监听 selected 标记的移动，而不是点击委托】
               ① 点"已经选中的那一行"不该响 —— 而点击委托收不到这个区分
               ② 键盘切换（上下方向键）也会换会话 —— 点击委托同样收不到
               ③ 宿主自己也可能改变选中项（新建会话、恢复会话）
             "selected 标记换了持有者"是"会话确实换了"的唯一可靠信号。

             【选择器是实测确认的】用户跑探针得到：
               会话行数 4 / 选中数 1 / 选中行类名 "hIlkoa_sessionRow hIlkoa_selected"
             hIlkoa_ 是稳定哈希（不是 _text_1rdzk_17 那种带行号的），可放心用。

             【成本控制】侧栏随时会因为流式输出而增删节点，所以不能为此常驻一个
             全子树的 childList 观察。这里只：
               · 观察 class 属性变化（attributeFilter 限定，代价低）
               · 观察 childList（行被新建/删除时重新定位）
             两者都只做一件事：把"当前选中行"与上次记录比对，变了才继续。
             比对用【元素引用】而不是文本，避免同名会话误判。 */
          let lastSelectedRow = null;
          const readSelectedRow = () =>
            document.querySelector('[class*="hIlkoa_sessionRow"][class*="hIlkoa_selected"]');
          /* 初始基线：记录挂载时选中的那一行，但【不播】——
             否则每次开面板/切工作区都会"凭空"响一声。 */
          lastSelectedRow = readSelectedRow();

          const sessionCheck = () => {
            let row = null;
            try { row = readSelectedRow(); } catch { return; }
            if (row === lastSelectedRow) return;      /* 引用未变 → 不是切换 */
            const isFirstMove = lastSelectedRow === null;
            lastSelectedRow = row;
            /* 从未选中 → 有选中：可能是首次进入会话（不算用户主动切换），
               也可能是新建后选中。这里仍然播 —— 因为对用户而言
               "画面从无会话变成某会话"确实是一次切换。
               若日后觉得吵，把 isFirstMove 这一支去掉即可。 */
            if (prefs.sessionSound) { try { fireSound('session'); } catch { /* noop */ } }
          };

          const sessionObs = new MutationObserver((records) => {
            for (let i = 0; i < records.length; i++) {
              const t = records[i].target;
              /* class 变化：只有当它是会话行（或其后代）时才可能是切换 */
              if (records[i].type === 'attributes') {
                if (t && t.nodeType === 1 && t.matches &&
                    (t.matches('[class*="hIlkoa_sessionRow"]') ||
                     (t.closest && t.closest('[class*="hIlkoa_sessionRow"]')))) {
                  sessionCheck();
                  return;
                }
              } else {
                /* childList：行被增删，可能同时改了选中项。
                   【必须先做廉价过滤】这个观察覆盖 document.body 整个子树，
                   而流式输出会不断增删节点 —— 每个 token 都会进到这里。
                   若直接 sessionCheck()（内部要 querySelector），
                   等于给每次流式渲染都加一次全文档查询。
                   过滤条件：只有"增删的节点自身带 hIlkoa_selected"才可能
                   意味着选中项变了 —— 其余早退，代价是一次字符串比较。 */
                const added = records[i].addedNodes, gone = records[i].removedNodes;
                let hit = false;
                for (let k = 0; k < added.length && !hit; k++) {
                  const nd = added[k];
                  if (nd && nd.nodeType === 1 && typeof nd.className === 'string' &&
                      nd.className.indexOf('hIlkoa_selected') >= 0) hit = true;
                }
                for (let k = 0; k < gone.length && !hit; k++) {
                  const nd = gone[k];
                  if (nd && nd.nodeType === 1 && typeof nd.className === 'string' &&
                      nd.className.indexOf('hIlkoa_selected') >= 0) hit = true;
                }
                if (hit) { sessionCheck(); return; }
              }
            }
          });
          try {
            sessionObs.observe(document.body, {
              attributes: true, attributeFilter: ['class'], subtree: true,
              childList: true,
            });
          } catch { /* noop */ }

          /* ── 打字声的触发监听 ──────────────────────────────────────────────
             只在"生成中"才理会（contentTyping 由上面的主观察者维护）。
             两类记录都要收：
               · characterData —— 流式追加通常改写已有文本节点
               · childList     —— 新段落 / 新代码块插入
             不做"是否属于聊天区"的判定：生成中时页面上真正的文本变化
             基本只来自助手输出，多判一层反而增加成本与误判。
             代价很低 —— 回调只做一次时间戳比较，且有 110ms 节流兜底。 */
          const typeObs = new MutationObserver(typeTicker);
          try {
            typeObs.observe(document.body, {
              characterData: true, childList: true, subtree: true,
            });
          } catch { /* noop */ }

          /* 返回停止函数：受开关控制 —— 关掉时断开观察者并移除解锁监听，
             不留悬空资源（与本文件其它探针一样的纪律：有建立必有回收）。 */
          return () => {
            /* 【钩子换回空实现】runStateObs 下面就被断开，还原成空实现是第二层保险：
               万一将来新增了别的调用路径，也不会执行到一段已失效的音频逻辑。 */
            syncSoundRunState = () => {};
            try { runStateObs.disconnect(); } catch { /* noop */ }
            try { sessionObs.disconnect(); } catch { /* noop */ }
            try { typeObs.disconnect(); } catch { /* noop */ }
            /* 清掉打字声的忙碌计时器与状态 —— 否则卸载后它还会触发一次状态复位
               （虽无害，但属于"留了悬空定时器"，与本文件其它地方的纪律不符）。 */
            if (typeBusyTimer) { clearTimeout(typeBusyTimer); typeBusyTimer = null; }
            typeBusy = false;
            if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
            previewBusy = false;
            /* 【不要在这里置 previewFn = null】它的所有权归 applySound() ——
               它按"总闸 + 是否有任一音效开关"决定赋 playPreview 还是 null。
               若这里也置空，会与 applySound 争同一个变量：teardown 恰好发生在
               新实例已经挂好回调之后时，会把新实例的回调清掉（试听按钮失效）。 
               这与 soundBuf / audioBus 是同一纪律：一个派生物只由一处负责。 */
            contentTyping = false;
            try {
              document.removeEventListener('pointerdown', audioUnlock, { capture: true });
              document.removeEventListener('keydown', audioUnlock, { capture: true });
              /* primeOnce 是一次性的，但仍成对移除 —— 否则卸载后一次迟到的点击
                 会去建一个属于旧实例的上下文。 */
              document.removeEventListener('pointerdown', primeOnce, { capture: true });
              document.removeEventListener('keydown', primeOnce, { capture: true });
            } catch { /* noop */ }
            soundPrimed = true;   /* 防卸载后还有迟到调用去建上下文 */
          };
        }

        function markSendState() {
          const card = document.querySelector('[data-phosphor-composer]');
          if (!card) return;          ensureSudoWatch(card);   /* 整蛊用的输入探针，见 LOG_ENTRIES 上方 */
          /* 【修一个实测隐患】运行中卡片里可能【同时存在两个】_primary 按钮：
             宿主 InputBar 的 children 里，interruptible 时先渲染一个
             aria-label = input.stop 的中断键，再渲染发送键。
             宿主原文案（从 app.asar 逐字取出）：
               input.stop        = "停止生成" / "Stop generating"
               input.send        = "发送消息" / "Send message"
               input.send.queue  = "排队发送"
               input.send.steer  = "插话发送"
             原实现用 querySelector 取第一个 —— 运行中取到的正是【停止键】，
             停止标记因此打在了错误的按钮上。
             现在：优先选「标签不含停止词」的那一个（即真正的发送键）；
             若全部都是停止词，退回最后一个 —— 宿主把发送键排在中断键之后。
             这个判据成立的前提是 input.send 系列文案都不含停止词，
             上面的原文案已确认（"发送消息/排队发送/插话发送"均无停止词）。 */
          const primaries = [...card.querySelectorAll('[class$="_primary"]')];
          if (!primaries.length) return;
          const labelOf = (el) => el.getAttribute('aria-label') || el.getAttribute('title') || '';
          let send = primaries.find((el) => !stopWords.test(labelOf(el)));
          if (!send) send = primaries[primaries.length - 1];

          /* 换了元素 → 先摘掉旧元素上的停止标记，避免残留属性留在历史元素上
             （原实现只从"最近一次标记的那个"上摘除，换代后会漏）。 */
          if (markedSend && markedSend !== send) {
            try { markedSend.removeAttribute('data-phosphor-stop'); } catch { /* noop */ }
          }
          markedSend = send;

          if (stopWords.test(labelOf(send))) send.setAttribute('data-phosphor-stop', '');
          else send.removeAttribute('data-phosphor-stop');

          /* 元素换了（React 重建）→ 断开旧的，避免留下无效观察者 */
          if (lastObservedSend && lastObservedSend !== send) {
            const prev = sendObserved.get(lastObservedSend);
            if (prev) { try { prev.disconnect(); } catch { /* noop */ } }
            sendObserved.delete(lastObservedSend);
            lastObservedSend = null;
          }

          if (!sendObserved.has(send)) {
            const obs = new MutationObserver(() => markSendState());
            obs.observe(send, {
              attributes: true,
              attributeFilter: ['aria-label', 'title'],
              childList: true,
              subtree: true,
            });
            sendObserved.set(send, obs);
            lastObservedSend = send;
          }
        }

        markSendState();

        /* 【补偿校准】每 1 秒重算一次发送键状态 —— 这是"指示灯常亮"的兜底。
           ------------------------------------------------------------------
           data-phosphor-stop 只有一个写入者（markSendState），而它的触发点
           各有失效路径：
             · runProbes 有早退分支（见 3179），探针长期早退时根本不跑；
             · 发送键的观察者挂在元素上，宿主换了元素就挂在旧元素上了；
             · 初始化只跑一次。
           任何一条失效，属性就【永久留在 DOM 里】—— 而它是三个功能的共同输入：
             状态栏 RUN 灯（常亮不灭）、结束音（不响）、街机自动暂停（不恢复）。
           实测症状就是"灯一直卡在 RUN"。

           【为什么用定时器而不是再加一个观察者】这是一次"对账"，不是"监听"：
           我们要的不是"变化发生时知道"，而是"无论之前发生了什么，现在必须正确"。
           一次 querySelector 加几次属性读取，代价可以忽略；
           换来的是"最多 1 秒自愈"，而不是"叫用户刷新页面"。
           正常情况下它什么都不会改（状态本来就对），所以不会引起任何抖动。 */
        let stopReconcile = null;
        try {
          stopReconcile = setInterval(() => {
            try { markSendState(); } catch { /* noop */ }
          }, 1000);
        } catch { /* noop */ }

        /* 6.6 偏好变化时：三层总闸 —— 属性 / 内联变量 / 令牌层。
               ------------------------------------------------------------------
               原先只做 `pushTokens(); reflectRoot();`，于是主开关关闭时：
                 · reflectRoot 摘掉 data-phosphor（只停装饰层）
                 · 64 条内联变量仍在 <html> 上（宿主 :root / * 规则照旧消费）
                 · 22 条令牌覆盖仍在活动快照里（overrideTokens 不理会 enabled）
               结果是「关掉终端外观」只关了一半：扫描线停了，调色板与方角还在。
               现在 enabled 为假时一并撤销内联变量与令牌层。 */
        /* ── 音效的启停 ──────────────────────────────────────────────────────
           与其它"有建立必有回收"的探针同构：用一个可重入的 applySound()，
           开关变化与初始挂载走同一条路径，不会出现"开了两次"或"关不干净"。
           【开关】开始侧两项 startReset / startType、结束侧 soundEnd、
           sessionSound、endReset —— 各自独立判断，互不牵连。
           只要有一个开着就得建立 —— 它们共用一个观察者，
           分成多个实例会各自观察同一属性、互相干扰。 */
        let stopSounds = null;
        const applySound = () => {
          /* 只要"可能有音效"（含会话音、结束音后的复位尾音）就值得解码 ——
             因为预览按钮与 sessionSound/endReset 都不依赖开始/结束那几项。
             条件放宽到"总闸开着且有任意一个音效开关"，避免出现：
             只开了「切换会话音」，结果 soundBuf 全空 → 点了没声。 */
          const anySound = !!(prefs.startReset || prefs.startType || prefs.soundEnd ||
                              prefs.sessionSound || prefs.endReset);
          /* 【必须在首次交互之后才真正建上下文】见 primeOnce。
             未交互时这里只是把状态接上，不碰 AudioContext。 */
          if (prefs.enabled && anySound && soundPrimed) primeDecode();

          /* 【必须在每次启用时都重新挂上】自检后发现的第三个同类 BUG：
             teardown 里把 previewFn 置空了（那是对的，音效已拆），
             但重新打开音效时只重新 setupSounds，没人把它赋回去 ——
             于是"关掉音效再打开"之后，试听按钮永久失效（点了没反应）。
             这与 soundBuf / audioBus 那两个是同一模式：
             【清理了派生物，重建时却没恢复】。
             挂在这里（而不是 setupSounds 内）的原因是：
             setupSounds 只在开始/结束那几项开着时才跑，
             而试听还要覆盖"只开了会话音"的情形。 */
          if (prefs.enabled && anySound) {
            previewFn = playPreview;
            audioDiagFn = audioDiag;   /* 诊断通道（与 previewFn 同理） */
          } else {
            previewFn = null;
            audioDiagFn = null;
          }

          /* 【街机音效通道】吃到一个数据包时响一声「切换会话」音（用户指定）。
             音量压到 0.09：session 的默认增益是 0.20，而游戏里大约每一秒
             就吃一个 —— 照 0.20 连响会盖过主题自己的回合音。
             用 fireSound 的【按次 volume 参数】，不碰 SOUND_GAIN 的全局配比
             （那是按各音之间的相对关系调过的，见 SOUND_GAIN 的注释）。
             总闸关掉时置 null —— 街机在"关了主题"时就是纯静音的。
             若用户把所有事件音都关了，缓冲不会被解码，
             fireSound 会在 `if (!buf) return false` 那里静默失败 —— 正是想要的。 */
          gameSoundFn = prefs.enabled
            ? () => {
                try {
                  if (!audioReady()) return;
                  fireSound('session', 0, 0.09);
                } catch { /* noop */ }
              }
            : null;

          const want = !!(prefs.enabled && (prefs.soundEnd || prefs.startReset || prefs.startType));
          if (want && !stopSounds) {
            try { stopSounds = setupSounds(); } catch (e) { console.warn('[phosphor] 音效启动失败', e); }
          } else if (!want && stopSounds) {
            try { stopSounds(); } catch { /* noop */ }
            stopSounds = null;
          }

          /* 运行态探针：把内部状态读出来（见模块级 soundStateFn 的说明）。
             读的是闭包里的实时值，不是快照 —— 所以能反映「此刻」的真相。

             【为什么这一条【不】加 DEBUG_ON 门禁】
             其余调试出口（__phosphorPrefs / __phMathProbe）需要显式开启才挂，
             是为了不在公开版里污染全局。但这一条不同：
               · 它**只读状态**，不改变任何行为，挂载零成本
               · 它要解决的是**线上已经出现的 bug**（打字声停不下来），
                 如果还要求用户先设 localStorage 再重启，等于让诊断本身有门槛
             所以它无条件挂载，用独立的 key，只暴露一个返回普通对象的函数。 */
          soundStateFn = () => ({
            running: !!document.querySelector('[data-phosphor-stop]'),
            wasRunning: soundWasRunning,
            armed: soundArmed,
            contentTyping,
            typeBusy,
            obsHits: runStateObsHits,
            hasStopSounds: !!stopSounds,
            /* 最近的状态转换（时间倒序无关，按发生顺序） */
            trace: soundTrace.slice(-25),
          });
          try {
            window.__phosphorSoundState = soundStateFn;
          } catch { /* noop */ }
        };

        /* 初始态：先按偏好把面板回调接上（按钮是否可用由渲染时的 soundOn 决定），
           但【不解码】—— 解码推迟到 primeOnce。 */
        applySound();   /* 它内部会挂 previewFn 与 audioDiagFn（含下面的初始态） */

        return () => {
          listeners.delete(onPref);
          if (tokenRetry) { clearTimeout(tokenRetry); tokenRetry = null; }
          /* 高对比层与它的媒体查询监听 —— 成对拆除。
             先撤层再置空 MQ：syncHighContrast 依赖 MQ 判断，
             若先置空它会算出 want=false 而顺手撤层（结果相同，但顺序更明确）。 */
          if (hcLayer) { try { hcLayer(); } catch { /* noop */ } hcLayer = null; }
          /* 【不撤销 locale 词典】见 apply 开头的说明：它是全局常量表，
             注册一次、永不撤销。撤销会与 window 守卫互相矛盾 ——
             撤了词典但标记仍为 true，重载后就不再注册，词典永久丢失。 */
          if (contrastMQ) {
            try {
              if (typeof contrastMQ.removeEventListener === 'function') {
                contrastMQ.removeEventListener('change', syncHighContrast);
              } else if (typeof contrastMQ.removeListener === 'function') {
                contrastMQ.removeListener(syncHighContrast);
              }
            } catch { /* noop */ }
            contrastMQ = null;
          }
          /* 停掉探针观察者，并【取消】已排队的合并任务 ——
             不取消的话它会在卸载后照常执行 runProbes；
             而那时标记刚被摘干净，runProbes 会重新探测并把标记打回去，
             等于卸载不完整。 */
          probeObserver.disconnect();
          if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
          probeScheduled = false;
          /* 停掉音效：断开观察者与解锁监听（有建立必有回收） */
          if (stopSounds) { try { stopSounds(); } catch { /* noop */ } stopSounds = null; }
          if (markedComposer) { try { markedComposer.removeAttribute('data-phosphor-composer'); } catch { /* noop */ } }
          if (markedToolbar) { try { markedToolbar.removeAttribute('data-phosphor-toolbar'); } catch { /* noop */ } }
          if (markedTrailing) { try { markedTrailing.removeAttribute('data-phosphor-trailing'); } catch { /* noop */ } }
          /* 摘掉停止标记。同时清 lastObservedSend 上的那一份：
             markSendState 现在可能把 markedSend 与 lastObservedSend 指向
             不同的元素（前者是"真正的发送键"、后者是"当前被观察的那个"），
             只清 markedSend 会漏。 */
          for (const el of [markedSend, lastObservedSend]) {
            if (el) { try { el.removeAttribute('data-phosphor-stop'); } catch { /* noop */ } }
          }
          if (stopReconcile) {
            try { clearInterval(stopReconcile); } catch { /* noop */ }
            stopReconcile = null;
          }
          /* sudo 探针的监听器也要摘：卡片元素在主题关闭后仍留在文档里 */
          if (sudoCard && sudoHandler) {
            try { sudoCard.removeEventListener('input', sudoHandler, true); } catch { /* noop */ }
          }
          sudoCard = null;
          sudoHandler = null;
          markedSend = null;
          /* 断开发送键的专用观察者（WeakMap 里的条目会随元素回收自动消失，
             但观察者本身必须先停，否则它仍在观察那个仍被引用的元素） */
          if (lastObservedSend) {
            const last = sendObserved.get(lastObservedSend);
            if (last) { try { last.disconnect(); } catch { /* noop */ } }
            sendObserved.delete(lastObservedSend);
            lastObservedSend = null;
          }
          /* 【顺序很重要】先还原语义层（令牌 + 内联变量 + 属性），再拆 DOM。
             原先的顺序是「先 remove 四个 DOM 节点，最后才撤销令牌与变量」——
             若中间任一 remove 抛错，后面三步（才是"主题必须还原"的部分）就全部跳过，
             留下"CSS 没了但令牌还在"的最糟中间态。这里把还原提前，
             并用 releaseTokens / clearInline 复用主开关那套逻辑，避免两处不一致。 */
          releaseTokens();
          clearInline();
          root.removeAttribute('data-phosphor');

          scan.remove();
          vignette.remove();
          bootHost.remove();
          styleEl.remove();
        };
      }, 'phosphor: tokens + stylesheet + overlays');

      /* 6.7 底部终端状态栏 —— shell.overlay 全框浮层座位。 */
      /* 6.7b 从实时 DOM 读宿主状态（模型 / 访问模式）。
             ------------------------------------------------------------------
             【为什么需要这一步】StatusBar 通过 slot 注册，props 里【没有】任何
             宿主会话数据 —— 只有主题自己的 12 个偏好。模型名与权限模式因此
             必须从界面上已有的元素里读。

             读什么、为什么不读别的：
               模型名  ← 工具行"选择模型"按钮的 aria-label
               权限模式 ← 工具行"访问模式"按钮的 aria-label
             这两个是【语义属性】，不是哈希类名 —— 与工具卡那次成功的依据相同。
             宿主原文模板（中英双语，从 asar 逐字取出）：
               mode:                "访问模式，当前：{name}" / "Access mode, current: {name}"
               modelSelect:         "选择模型，当前 {model}，推理等级 {effort}"
               modelSelectNoEffort: "选择模型，当前 {model}"
             注意两条的分隔符不同（一个全角冒号、一个空格），且推理等级可能缺席，
             所以解析写成"取『当前』之后的全部 → 再按推理等级切开"，
             而不是假定固定位置。解析不出来就留空，绝不猜。
             带推理等级时合并显示（如 "DeepSeek-V41-Flash · High"），
             与输入行那个按钮上的写法一致。

             【刻意不做的事】不去刮取输入行下方那三个指示器（token 数 / 缓存命中 /
             上下文占用）。那些是宿主的临时文字，只在有会话时出现，刮取既重复
             （宿主自己已经显示）又容易随版本失效 —— 属于用户一直反对的脆弱耦合。 */
      function readHostStatus() {
        const out = { model: '', perm: '' };
        const card = document.querySelector('[data-phosphor-composer]');
        if (!card) return out;
        const triggers = [...card.querySelectorAll('[class*="_trigger"]')];
        if (!triggers.length) return out;
        const pick = (keywords) => {
          for (const el of triggers) {
            const label = el.getAttribute('aria-label') || '';
            if (!keywords.some((k) => label.includes(k))) continue;
            return label;
          }
          return '';
        };
        const after = (label) => {
          const i = label.indexOf('当前');
          const j = label.indexOf('current');
          const at = i >= 0 ? i + 2 : (j >= 0 ? j + 7 : -1);
          return at < 0 ? '' : label.slice(at).trim().replace(/^[：:\s]+/, '');
        };
        out.perm = after(pick(['访问模式', 'Access mode']));
        let m = after(pick(['选择模型', 'Select model']));
        /* 合并推理等级：把「，推理等级 High」并成「 · High」 */
        m = m.replace(/[，,]\s*(?:推理等级|reasoning effort)\s*/i, ' · ');
        out.model = m;
        return out;
      }

      /* 余额：从宿主 deepseekAccount 服务取（经 ctx.remote.account）。
         ------------------------------------------------------------------
         数据链路（都从 asar 里逐字确认过）：
           host 服务 deepseekAccount.getBalance(client) → AccountDetails.balance
             balance.value        = 充值钱包数组 [ { amount: "十进制串", currency } ]
             balance.bonusWallets = 赠送钱包数组（同结构）
         宿主另有 formatBalance(amount, symbol) 做平台的两小数格式化，
         但那个实现依赖 Big.js —— 我不引入依赖，用 Intl 复刻同样的规则：
           0        → symbol 0.00
           负数     → -symbol 0.01（若绝对值 < 0.01）否则四舍五入到分
           0 < x<.01→ <symbol 0.01
           其它     → 四舍五入到分，千分位分组
         注意 round(2, roundDown) 是【向下取整】—— Intl 的默认四舍五入会
         让 1.999 显示成 2.00，与宿主不一致；这里用 Math.floor 复刻。

         【为什么要防御 ctx.remote.account 不存在】
         inject 声明的是 'remote'，它保证 ctx.remote 这个对象在，
         但不保证 remote 上挂了 account 命名空间（那取决于 profile 是否
         加载了账号插件）。所以取用前判空，缺失时余额栏只是不渲染。 */
      /* 余额格式化：输出「CNY 43.82」这种【币种代码 + 空格 + 金额】。
         ------------------------------------------------------------------
         用户要求用币种代码而非货币符号，中间留一个空格。
         数据里的 currency 字段就是 'CNY'（探针实测），直接用它当单位，
         不做符号映射 —— 少一层映射就少一处出错的地方，
         而且终端风格里「代码 + 数值」本来就比「符号」更贴题。

         数值规则仍复刻宿主的 formatBalance（两小数、向下取整、千分位）：
           0        → CNY 0.00
           < 0.01   → <CNY 0.01
           负数     → -CNY 0.01（绝对值 < 0.01）否则 -CNY 1,234.56
           其它     → CNY 1,234.56
         注意 Math.floor 而非四舍五入 —— 宿主用的是 Big.roundDown，
         用 toFixed 的默认行为会让 1.999 显示成 2.00，与宿主不一致。 */
      const fmtBalance = (amount, currency) => {
        const unit = currency ? currency + ' ' : '';
        const n = Number(amount);
        if (!Number.isFinite(n)) return '';
        const round2 = (v) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        if (n === 0) return unit + '0.00';
        if (n < 0) {
          const a = Math.abs(n);
          return '-' + unit + (a < 0.01 ? '0.01' : round2(a));
        }
        if (n < 0.01) return '<' + unit + '0.01';
        return unit + round2(Math.floor(n * 100) / 100);
      };
      /* 读一次余额；任何异常都吞掉并返回空字符串 —— 余额是附加信息，
         不能因为它失败而影响状态栏的其它字段。 */
      const readBalance = async (remote) => {
        try {
          const acct = remote && remote.account;
          if (!acct || typeof acct.getBalance !== 'function') return '';
          /* 【参数必须是 AccountClientMetadata】实测传 {} 会被拒：
               ok:false, code:"gateway/input-invalid",
               details:{ endpoint:"account/getBalance", field:"client" }
             三个字段（从 asar 的类型定义逐字取出）：
               version: string / locale: string / timezoneOffsetSeconds: number */
          const meta = {
            version: '1.0.0',
            locale: (typeof navigator !== 'undefined' && navigator.language) || 'zh-CN',
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          };
          const res = await acct.getBalance(meta);
          /* 【字段路径以实测为准】探针抓到的真实返回：
               { ok: true,
                 value: { status: 'ready',
                          value: [ { currency: 'CNY', balance: '43.8214700200000000' } ],
                          bonusWallets: [ { currency: 'CNY', balance: '0' } ] } }
             我原先按类型定义猜的是 details.balance.value 与 wallet.amount ——
             两处都错，实际是 details.value.value 与 wallet.balance。
             教训与第 9/10 条一致：先拿到真实返回再写解析，不要按类型猜。 */
          if (!res || res.ok !== true) return '';
          const details = res.value;
          if (!details || details.status !== 'ready') return '';
          const wallet = Array.isArray(details.value) ? details.value[0] : null;
          if (!wallet || wallet.balance === undefined) return '';
          return fmtBalance(wallet.balance, wallet.currency);
        } catch { return ''; }
      };

      function StatusBar() {
        const state = usePrefs();
        const [now, setNow] = React.useState(() => new Date());
        const [host, setHost] = React.useState(() => readHostStatus());
        /* 模型是否正在输出 —— 读 markSendState 写在发送键上的 data-phosphor-stop。
           这是【已经实测可用】的通道（用户运行态探测得到 stop: true），
           而且它顺带处理了"运行中卡片里有两个 _primary 按钮"那个坑。
           用它来点亮状态栏的活动指示灯。 */
        const [running, setRunning] = React.useState(
          () => !!document.querySelector('[data-phosphor-stop]'),
        );
        /* 余额：空字符串表示"取不到/未登录/加载中"，此时不渲染该字段。
           拉一次 + 每 10 分钟刷新 —— 余额变化很慢，高频轮询没有意义。 */
        const [balance, setBalance] = React.useState('');

        /* 余额拉取：挂载时一次 + 每 10 分钟一次。
           余额变动很慢（充值/消耗），高频轮询没有意义；
           而 getBalance 是一次远程调用，不该频繁打。
           任何失败都走 readBalance 的 catch → 空串 → 该字段不渲染，
           绝不影响状态栏的其它字段。 */
        React.useEffect(() => {
          let alive = true;
          let timer = null;
          const pull = () => {
            try {
              const p = readBalance(ctx.remote);
              if (p && typeof p.then === 'function') {
                p.then((text) => { if (alive && text) setBalance(text); })
                 .catch(() => { /* 远程失败：保持空串 */ });
              }
            } catch { /* 同步异常同样吞掉 */ }
          };
          pull();
          try { timer = setInterval(pull, 600000); } catch { /* noop */ }
          return () => { alive = false; if (timer) clearInterval(timer); };
        }, []);

        React.useEffect(() => {
          const id = setInterval(() => setNow(new Date()), 1000);
          return () => clearInterval(id);
        }, []);

        /* 活动灯：只订阅 data-phosphor-stop 这一个属性的变化，代价极低。
           不用轮询 —— 运行态切换需要"立刻亮/灭"，1~2 秒的轮询延迟在
           指示灯上会明显滞后（灯已经该灭了还亮着）。 */
        React.useEffect(() => {
          const refresh = () => setRunning(!!document.querySelector('[data-phosphor-stop]'));
          refresh();
          const obs = new MutationObserver(refresh);
          try {
            obs.observe(document.documentElement, {
              attributes: true, attributeFilter: ['data-phosphor-stop'], subtree: true,
            });
          } catch { /* noop */ }
          return () => obs.disconnect();
        }, []);

        /* 宿主状态每 2 秒读一次：模型与权限都可能被用户随时改动。
           低频轮询而不是 MutationObserver —— 后者要为工具行子树常驻一个观察者，
           而这两个值变化很少，轮询的代价（一次 querySelectorAll）远低于它。
           读到空值就保持上一次的结果，避免解析偶发失败时字段闪没。 */
        React.useEffect(() => {
          const tick = () => {
            const next = readHostStatus();
            setHost((prev) => ({
              model: next.model || prev.model,
              perm: next.perm || prev.perm,
            }));
          };
          tick();
          const id = setInterval(tick, 2000);
          return () => clearInterval(id);
        }, []);

        /* 余额：见下方模块级 balanceTicker（不在组件里用 hook）。 */

        if (!state.enabled || !state.statusbar) return null;

        const pad = (n) => String(n).padStart(2, '0');
        const clock = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());

        /* 中间段：PHOSPHOR 之后依次是模型与访问模式。两者都可能读不到（例如工具行
           还没挂载），此时对应项为 null，React 会跳过它 —— 不会留下空的分隔符。
           窄窗口降级见 CSS §6b：访问模式先收（__opt），模型随后收（__opt2）。 */
        const mid = [];
        if (host.model) {
          mid.push(React.createElement('span', {
            key: 'model', className: 'ph-statusbar__opt2',
          }, host.model));
        }
        if (host.perm) {
          mid.push(React.createElement('span', {
            key: 'perm', className: 'ph-statusbar__opt',
          }, host.perm));
        }
        /* 余额：只在真的取到时渲染（空串 = 未登录 / 查询失败 / 加载中）。
           归入 __opt 这一档（与访问模式一起在窄窗口先收）——
           它是"参考信息"，不是操作态，优先级低于模型名。 */
        if (balance) {
          mid.push(React.createElement('span', {
            key: 'balance', className: 'ph-statusbar__opt',
            title: '充值余额',
          }, balance));
        }

        /* 街机最高分：只在真的玩过（>0）时渲染，所以没人玩过就完全看不出痕迹。
           放进 mid（参考信息档），并作为彩蛋的第二重线索 —— 看到 HI 会想知道那是什么。 */
        const hiScore = Number(state.hiScore) || 0;
        if (hiScore > 0) {
          mid.push(React.createElement('span', {
            key: 'hi', className: 'ph-statusbar__hi',
            title: '街机最高分 —— 点一下 ▮ 或 SESSION LIVE 开始',
          }, 'HI ' + hiScore));
        }

        /* 街机入口。两处都可点：
             · SESSION LIVE —— 文字长、好点
             · ▮ 光标      —— 终端里"这里能输入"的通用信号，点它开控制台最自然
           状态栏本身是 pointer-events:none，所以给这两个元素单独开指针
           （见 CSS 的 .ph-statusbar__hit）。点它们不会误触别的东西 ——
           状态栏底下就是 body 的 padding-bottom，本来没有内容。 */
        const eggsOn = state.eggs !== false;
        /* 彩蛋总开关关掉后入口失效。
           【这里只做早退，不记日志】—— 因为两个命中区在关闭时会打上 is-off，
           而 .ph-statusbar__hit.is-off 带 pointer-events: none，
           点击【根本到不了这个函数】。曾经在这里记过一条 access denied，
           它永远不会触发：整蛊的设计与"彻底禁用"的实现在互相抵消。 */
        const toggleArcade = () => {
          if (!eggsOn) return;
          setArcadeOpen(!arcadeOpen);
        };

        return React.createElement(
          'div',
          { className: 'ph-statusbar', role: 'status', 'aria-live': 'off' },
          React.createElement('span', {
            className: 'ph-statusbar__live ph-statusbar__hit' + (eggsOn ? '' : ' is-off'),
            title: '点我：嗯？',
            onClick: toggleArcade,
          },
            React.createElement('span', { className: 'ph-statusbar__dot' }),
            'SESSION LIVE'),
          React.createElement('span', { className: 'ph-statusbar__sep' }, '|'),
          /* 【活动指示灯 + 读数】原来这里是常量 'PHOSPHOR'。
             改成由 data-phosphor-stop 驱动的 RUN / IDLE 读数 ——
             它是有真实数据源的（模型是否在输出），不是装饰。
             这是"指示灯"语言里唯一不必编造数据的那个位置：
             宿主只把运行态写在发送键的属性上，这里把它引到状态栏。 */
          React.createElement('span', {
            className: 'ph-statusbar__run' + (running ? ' is-run' : ''),
            title: running ? '模型正在输出' : '空闲',
          },
            React.createElement('span', { className: 'ph-statusbar__lamp' }),
            running ? 'RUN' : 'IDLE'),
          React.createElement('span', {
            className: 'ph-statusbar__caret ph-statusbar__hit' + (eggsOn ? '' : ' is-off'),
            title: '点我：嗯？',
            onClick: toggleArcade,
          }),
          ...mid.map((node, i) => [
            React.createElement('span', { className: 'ph-statusbar__sep', key: 'sep' + i }, '|'),
            node,
          ]).flat(),
          React.createElement('span', { className: 'ph-statusbar__right' },
            React.createElement('span', null, clock),
            React.createElement('span', { className: 'ph-statusbar__sep' }, '|'),
            React.createElement('span', null, 'UTF-8')),
        );
      }

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'phosphor-statusbar', order: 90, label: 'PHOSPHOR status bar' },
        StatusBar,
      ));

      /* ── 街机彩蛋：字符画贪吃蛇（「数据包」皮）────────────────────────────────
         用户点的方案：
           · 入口 = 状态栏的 `▮` 光标 与 `SESSION LIVE` 都可点
           · 皮   = 你是网络里的一个数据包，吃 ◆ 变长，撞墙 = PACKET LOST
           · 声音 = 吃包时响一声「切换会话」音
           · 最高分记录并显示在状态栏

         【为什么用"文本帧缓冲"而不是 canvas / DOM 网格】
           · 终端里长大的东西本来就该是字符画出来的 —— canvas 反而"不像"
           · 每帧只做一次字符串拼接 + 一次 textContent 赋值，成本极低
           · 不需要 30×13 个格子元素，也没有逐格样式
           · 想换皮只改下面 ARCADE_ART 里那几个字符

         【为什么是独立组件而不是状态栏的子元素】
           · `.ph-statusbar` 有 `overflow: hidden`，子元素会被裁掉
           · 状态栏里有个每秒跑的时钟（setNow），整条栏每秒重渲染；
             游戏挂在它下面就会跟着每秒重渲染，还可能被 React 打断
           所以它自成一个 slot 条目，用 position:fixed 定位在右下角。

         【资源纪律】游戏只有一个 requestAnimationFrame 循环，
         生命周期完全交给 React 的 effect（开关一次 = 挂载/卸载一次）。
         这是本文件里唯一"不用我手工配对"的资源 —— 因为 React 替我配对了。
         键盘也【不】用全局监听：只挂在面板自己的 onKeyDown 上，
         所以用户在输入框打字时，面板结构上就收不到键。 */
      const ARCADE_COLS = 30;
      const ARCADE_ROWS = 13;
      const ARCADE_STEP_MS = 130;    /* 每步间隔 → 约 7.7 步/秒，经典手感 */
      /* 【开机仪式】逐行揭示，而不是"停一屏再开始"。
         节奏与主题自己的启动自检（BOOT_LINES）保持一致：
         头部、空行、若干 xxx ..... OK、空行、操作提示、INIT ... OK。
         想调快/调慢只需要改 ARCADE_BOOT_LINE_MS 一个数；
         想改文案只改 ARCADE_BOOT_LINES。 */
      const ARCADE_BOOT_LINE_MS = 150;   /* 每行揭示间隔 */
      const ARCADE_BOOT_HOLD_MS = 420;   /* 最后一行停留多久再进游戏 */
      const ARCADE_BOOT_CURSOR_MS = 320; /* 末尾光标闪烁节奏 */
      const ARCADE_BOOT_LINES = [
        '',
        'PHOSPHOR ARCADE v0.1',
        '',
        '  bus .......... ready',
        '  cartridge .... packet.bin',
        '  load ......... OK',
        '  handshake .... OK',
        '',
        '  \u2191\u2193\u2190\u2192 / WASD  move     ESC  exit',
        '',
        'INIT PACKET ... OK',
      ];
      const ARCADE_ART = {
        head: '@',     /* 数据包（你） */
        body: '▓',     /* 走过留下的路径 */
        food: '◆',     /* 下一个数据包 */
        empty: '·',
      };

      const arcadeFresh = () => {
        const midY = Math.floor(ARCADE_ROWS / 2);
        return {
          snake: [{ x: 5, y: midY }, { x: 4, y: midY }, { x: 3, y: midY }],
          dir: { x: 1, y: 0 },
          pending: null,
          food: { x: Math.min(ARCADE_COLS - 4, 22), y: midY },
          score: 0,
          /* 单局撞墙次数 —— flawless 20 要用它判断"这一局没撞过墙" */
          walls: 0,
          phase: 'boot',      /* boot | play | over */
          paused: false,      /* 宿主正在生成时自动暂停 */
          bootAt: 0,
          bootShown: 0,       /* 开机文字已揭示到第几行 */
          nowT: 0,            /* 最近一帧的时间戳（渲染要用它算光标闪烁） */
          lastAt: 0,
          acc: 0,
        };
      };

      /* 【食物只放在内圈，不贴墙】
         用户实测反馈："不要把豆子放在边缘，这个对玩家太不友好"。
         原因很实在：一步 130ms，贴墙的豆子要求"吃到之后立刻转向"，
         而它往往和下一格墙只隔一步 —— 对玩家来说那是【必死】而非难度。
         所以排除最外一圈。margin 想再放宽就改这一个数。 */
      const ARCADE_MARGIN = 1;

      /* 随机找一个空格子放食物。
         先在内圈找；只有当内圈真的没有空格了（蛇已经很长）才退回整盘 ——
         否则会误判成"填满通关"，而实际上边角还有空位。
         两者都空 = 真的填满了，返回 null 表示通关。 */
      const arcadePlaceFood = (snake) => {
        const taken = {};
        for (const s of snake) taken[s.x + ',' + s.y] = true;
        const inner = [];
        const anywhere = [];
        const minX = ARCADE_MARGIN;
        const maxX = ARCADE_COLS - ARCADE_MARGIN - 1;
        const minY = ARCADE_MARGIN;
        const maxY = ARCADE_ROWS - ARCADE_MARGIN - 1;
        for (let y = 0; y < ARCADE_ROWS; y++) {
          for (let x = 0; x < ARCADE_COLS; x++) {
            if (taken[x + ',' + y]) continue;
            anywhere.push({ x, y });
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) inner.push({ x, y });
          }
        }
        const pool = inner.length ? inner : anywhere;
        if (!pool.length) return null;
        return pool[Math.floor(Math.random() * pool.length)];
      };

      /* 在字符网格里居中写一行字（used by GAME OVER 覆盖层） */
      const arcadeStamp = (rows, dy, text) => {
        const y = Math.floor(rows.length / 2) + dy;
        if (y < 0 || y >= rows.length) return;
        const row = rows[y];
        const start = Math.floor((ARCADE_COLS - text.length) / 2);
        for (let i = 0; i < text.length; i++) {
          const x = start + i;
          if (x >= 0 && x < ARCADE_COLS) row[x] = text[i];
        }
      };

      const arcadeRender = (st) => {
        if (st.phase === 'boot') {
          const shown = Math.max(0, Math.min(ARCADE_BOOT_LINES.length, st.bootShown || 0));
          const elapsed = (st.nowT || 0) - (st.bootAt || 0);
          /* 末尾光标按固定节奏闪 —— 让"还在启动"这件事看得出来。
             空行补齐到与游戏场同样的行数，否则面板会在进游戏时突然变高。 */
          const cursorOn = (Math.floor(elapsed / ARCADE_BOOT_CURSOR_MS) % 2) === 0;
          const boot = [];
          for (let i = 0; i < ARCADE_BOOT_LINES.length; i++) {
            let line = (i < shown) ? ARCADE_BOOT_LINES[i] : '';
            if (i === shown - 1 && cursorOn) line += '\u258c';
            boot.push(line);
          }
          while (boot.length < ARCADE_ROWS + 2) boot.push('');
          return boot.join('\n');
        }
        const rows = [];
        for (let y = 0; y < ARCADE_ROWS; y++) {
          rows.push(new Array(ARCADE_COLS).fill(ARCADE_ART.empty));
        }
        if (st.food) rows[st.food.y][st.food.x] = ARCADE_ART.food;
        for (let i = st.snake.length - 1; i >= 0; i--) {
          const seg = st.snake[i];
          if (seg.x >= 0 && seg.x < ARCADE_COLS && seg.y >= 0 && seg.y < ARCADE_ROWS) {
            rows[seg.y][seg.x] = (i === 0) ? ARCADE_ART.head : ARCADE_ART.body;
          }
        }
        if (st.phase === 'over') {
          arcadeStamp(rows, -1, ' PACKET LOST ');
          arcadeStamp(rows, 1, ' SPACE restart ');
        }
        const out = ['┌' + '─'.repeat(ARCADE_COLS) + '┐'];
        for (const row of rows) out.push('│' + row.join('') + '│');
        out.push('└' + '─'.repeat(ARCADE_COLS) + '┘');
        return out.join('\n');
      };

      /* 走一步。原地修改 st，返回事件：
           null 正常 / 'eat' 吃到 / 'dead' 撞死 / 'win' 填满 */
      const arcadeStep = (st) => {
        if (st.pending) {
          const cur = st.dir;
          const nxt = st.pending;
          st.pending = null;
          /* 不能 180° 掉头 —— 否则下一步立刻撞到自己 */
          if (!(nxt.x === -cur.x && nxt.y === -cur.y)) st.dir = nxt;
        }
        const head = st.snake[0];
        const nx = head.x + st.dir.x;
        const ny = head.y + st.dir.y;
        if (nx < 0 || ny < 0 || nx >= ARCADE_COLS || ny >= ARCADE_ROWS) {
          /* 只数【撞墙】；撞自己走下面那条分支，不算"墙" */
          st.walls += 1;
          if (bumpLogStat('wallHits') >= 3) markFound('wall3');
          return 'dead';
        }
        /* 撞自己：最后一节这一步会移走，所以不算 */
        for (let i = 0; i < st.snake.length - 1; i++) {
          if (st.snake[i].x === nx && st.snake[i].y === ny) {
            /* 咬到自己 —— 和撞墙分开记：撞墙是技术问题，这个有点丢人 */
            markFound('selfbite');
            return 'dead';
          }
        }
        st.snake.unshift({ x: nx, y: ny });
        if (st.food && nx === st.food.x && ny === st.food.y) {
          st.score += 1;
          /* markFound 幂等，所以每吃一颗都调一次也没关系（只在首次写偏好） */
          if (st.score >= 20) markFound('score20');
          if (st.score >= 50) markFound('score50');
          /* flawless 20：这一局到 20 分且一次墙都没撞 */
          if (st.score >= 20 && st.walls === 0) markFound('flawless20');
          st.food = arcadePlaceFood(st.snake);
          return st.food ? 'eat' : 'win';
        }
        st.snake.pop();
        return null;
      };

      /* 入口组件：订阅开关，关着就渲染 null。
         把游戏放进子组件，是为了让"开/关"等价于"挂载/卸载"，
         于是 rAF 与键盘监听都能靠 React 的 effect 清理 —— 不需要我手工配对。 */
      function PhosphorArcade() {
        const [, bump] = React.useState(0);
        React.useEffect(() => subscribeArcade(() => bump((n) => n + 1)), []);
        if (!arcadeOpen) return null;
        return React.createElement(ArcadeGame);
      }

      function ArcadeGame() {
        const prefState = usePrefs();
        const wrapRef = React.useRef(null);
        const preRef = React.useRef(null);
        const hudRef = React.useRef(null);
        const stRef = React.useRef(null);
        /* konami 序列进度（必须是 ref：处理器每次渲染都会重建，但进度得留住） */
        const konamiRef = React.useRef(0);


        React.useEffect(() => {
          const nowOf = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
          /* 打开街机即记 'cartridge mounted' —— 入口在状态栏，见 StatusBar */
          markFound('arcade');
          arcadeStateFn = () => stRef.current;
          const st0 = arcadeFresh();
          st0.bootAt = nowOf();
          stRef.current = st0;

          /* 焦点交给自己：键盘只在面板持有焦点时生效（见 onKeyDown）。
             于是"在输入框打字"与"操控游戏"在结构上就互不干扰。 */
          try { if (wrapRef.current && wrapRef.current.focus) wrapRef.current.focus(); } catch { /* noop */ }

          let hi = Number(prefState.hiScore) || 0;
          let raf = 0;
          let frame = 0;
          let lastScreen = '';
          let lastHud = '';

          const paint = () => {
            const st = stRef.current;
            if (!st) return;
            const screen = arcadeRender(st);
            if (preRef.current && screen !== lastScreen) {
              lastScreen = screen;
              preRef.current.textContent = screen;
            }
            let hud;
            if (st.phase === 'boot') {
              hud = 'BOOTING' + (hi > 0 ? '   HI ' + hi : '   按方向键可跳过');
            } else if (st.phase === 'over') {
              hud = 'PACKET LOST   SCORE ' + st.score + '   HI ' + hi
                + '   [SPACE] 重开   [ESC] 退出';
            } else if (st.paused) {
              hud = 'PAUSED · MODEL BUSY   SCORE ' + st.score + '   HI ' + hi;
            } else {
              hud = 'SCORE ' + st.score + '   HI ' + hi;
            }

            if (hudRef.current && hud !== lastHud) { lastHud = hud; hudRef.current.textContent = hud; }
          };

          const loop = () => {
            const st = stRef.current;
            if (!st) return;
            const now = nowOf();
            const dt = st.lastAt ? Math.min(250, now - st.lastAt) : 0;
            st.lastAt = now;

            /* 【宿主运行态：每 30 帧采样一次】
               不用 MutationObserver —— 本文件已经有 7 个，再加一个不值得。
               "模型正在输出"这个信息只需要 0.5 秒级的精度（用来暂停游戏），
               帧计数采样完全够，而且零新增资源。 */
            if ((frame++ % 30) === 0) {
              st.paused = !!document.querySelector('[data-phosphor-stop]');
            }

            /* 【开机仪式】逐行揭示，最后一行停留一会儿再进游戏。
               总时长 = 行数 × ARCADE_BOOT_LINE_MS + ARCADE_BOOT_HOLD_MS
                      = 11 × 150 + 420 ≈ 2.07 秒
               想整体调快，只改 ARCADE_BOOT_LINE_MS 一个数即可。 */
            if (st.phase === 'boot') {
              st.nowT = now;
              const elapsed = now - st.bootAt;
              st.bootShown = Math.min(
                ARCADE_BOOT_LINES.length,
                1 + Math.floor(elapsed / ARCADE_BOOT_LINE_MS),
              );
              if (elapsed >= ARCADE_BOOT_LINES.length * ARCADE_BOOT_LINE_MS + ARCADE_BOOT_HOLD_MS) {
                st.phase = 'play';
                /* 不要把开机那两秒算成"该补走多少步" */
                st.lastAt = 0;
                st.acc = 0;
              }
            }

            if (st.phase === 'play' && !st.paused) {
              st.acc += dt;
              /* guard：切后台回来时 dt 可能很大，while 会一次补走几十步。
                 限制每帧最多补 4 步，宁可"慢一点"也不要在归位时直接撞死。 */
              let guard = 0;
              while (st.acc >= ARCADE_STEP_MS && guard++ < 4) {
                st.acc -= ARCADE_STEP_MS;
                const ev = arcadeStep(st);
                if (ev === 'dead' || ev === 'win') {
                  st.phase = 'over';
                  if (st.score > hi) {
                    /* new record —— 只要分数为 0 就不会触发（0 不大于初始 hi=0） */
                    if (st.score > 0) markFound('record');
                    hi = st.score;
                    setPref('hiScore', hi);   /* 广播 → 状态栏的 HI 立刻跟上 */
                  }
                  break;
                }
                if (ev === 'eat') {
                  try { if (typeof gameSoundFn === 'function') gameSoundFn(); } catch { /* noop */ }
                }
              }
            }
            paint();
            raf = requestAnimationFrame(loop);
          };

          /* rAF 不存在（桩环境 / 非浏览器）就不启动循环，只画一帧 —— 
             这样自检工具里也能把它挂起来而不抛错。 */
          if (typeof requestAnimationFrame === 'function') {
            raf = requestAnimationFrame(loop);
          } else {
            paint();
          }

          return () => {
            if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
            /* 关闭后把焦点还给输入框：否则用户得自己去点一下才能继续打字 */
            try {
              const ed = document.querySelector('[contenteditable="true"]');
              if (ed && ed.focus) ed.focus();
            } catch { /* noop */ }
          };
        }, []);

        const restart = () => {
          /* 【这里曾经是个必崩的 bug】
             原来写成：
                const nowOf = performance.now();   // 这是个数字
                st.bootAt = nowOf();               // 把数字当函数调 → TypeError
             于是【所有】重开路径（点击 / 空格 / Enter / 顶栏 RE）都在这里抛错，
             表现就是"按了完全没反应"，而读代码时看着毫无问题 ——
             因为错在"变量叫 nowOf，所以看起来像函数"这个错觉上。
             端到端测试（推帧到撞死，再按键）第一次跑就抓到了它。 */
          const st = arcadeFresh();
          st.bootAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          /* one more run —— 死了重开 10 次，抓"不服气" */
          if (bumpLogStat('runs') >= 10) markFound('onemore');
          stRef.current = st;
        };

        const onKeyDown = (e) => {
          const st = stRef.current;
          if (!st) return;
          /* 【不抢输入框的按键】
             原先靠"监听只挂在面板上"来保证这件事，但那要求面板一直持有焦点 ——
             而焦点一旦离开（点一下别处、切窗口），面板就再也收不到键：
             屏幕上印着 SPACE restart，按了却没用。
             现在改成挂 document，但用这条守卫显式排除输入区域，
             性质不变，且不再依赖焦点。 */
          const ae = document.activeElement;
          if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
            return;
          }
          const k = e.key;
          /* ── konami code：↑↑↓↓←→←→ ──
             最正统的彩蛋，而它恰好藏在一个街机里。
             用"逐个匹配、错一个就重置"的状态机：
             多按一个无关键不会永久打断进度，按下 ↑ 仍能重新开始。 */
          {
            const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
                            'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
            if (k === KONAMI[konamiRef.current]) {
              konamiRef.current += 1;
              if (konamiRef.current >= KONAMI.length) {
                konamiRef.current = 0;
                markFound('konami');
              }
            } else {
              konamiRef.current = (k === KONAMI[0]) ? 1 : 0;
            }
          }
          if (k === 'Escape') { e.preventDefault(); setArcadeOpen(false); return; }
          /* 【开机可跳过】仪式感是给第一次的；玩熟了不该每次等两秒。
             任何方向键/空格都会立刻跳过开机 —— 不算误触，
             因为此时面板刚拿到焦点，用户按方向键本来就是想动。 */
          if (st.phase === 'boot' && k !== 'Shift' && k !== 'Control' && k !== 'Alt' && k !== 'Meta') {
            st.phase = 'play';
            st.lastAt = 0;
            st.acc = 0;
          }
          /* 空格之外也接受 Enter —— 不必为"哪个键重开"纠结 */
          if (k === ' ' || k === 'Spacebar' || k === 'Space' || k === 'Enter') {
            if (st.phase === 'over') { e.preventDefault(); restart(); }
            return;
          }
          const map = {
            ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
            w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
            W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
          };
          const d = map[k];
          if (!d) return;
          e.preventDefault();
          st.pending = { x: d[0], y: d[1] };
        };

        /* 监听挂在 document、capture 阶段：
           面板是否持有焦点都不影响，靠 onKeyDown 开头的守卫排除输入区域。
           资源纪律照旧 —— 关掉街机就是卸载，effect 清理时摘掉。 */
        React.useEffect(() => {
          document.addEventListener('keydown', onKeyDown, true);
          return () => document.removeEventListener('keydown', onKeyDown, true);
        }, []);

        /* 【点击重开的兜底：挂在 document 上】
           为什么不能只靠面板自己的 onClick：如果宿主 overlay 根节点带
           pointer-events: none，面板里的元素根本不参与命中测试 ——
           onClick 永远不会触发，而页面上其它地方照常响应点击。
           挂在 document 上就绕开了这件事：结束画面时点【任何地方】都重开
           （除非点的是顶栏那两个按钮，它们自己处理）。
           代价是这期间点别处也会重开一局 —— 只在"游戏已结束"这个状态下成立，
           可以接受。 */
        React.useEffect(() => {
          const onClickAnywhere = (ev) => {
            const st = stRef.current;
            if (!st || st.phase !== 'over') return;
            const t = ev && ev.target;
            if (t && typeof t.closest === 'function'
                && t.closest('.ph-arcade__exit')) return;
            restart();
          };
          document.addEventListener('click', onClickAnywhere, true);
          return () => document.removeEventListener('click', onClickAnywhere, true);
        }, []);

        return React.createElement('div', {
          className: 'ph-arcade',
          ref: wrapRef,
          tabIndex: -1,
          /* 点击面板任意处把焦点收回来（光标/无障碍焦点，
             按键已不依赖它，这只是保持"我点了它就该激活"的直觉） */
          onPointerDown: () => {
            try { if (wrapRef.current && wrapRef.current.focus) wrapRef.current.focus(); } catch { /* noop */ }
          },
        },
          React.createElement('div', { className: 'ph-arcade__bar' },
            React.createElement('span', { className: 'ph-arcade__title' }, 'ARCADE'),
            React.createElement('span', {
              className: 'ph-arcade__exit',
              title: '关闭 (ESC)',
              onClick: () => setArcadeOpen(false),
            }, '×'),

          ),
          React.createElement('pre', {
            className: 'ph-arcade__screen',
            ref: preRef,
            /* 保底通路：结束画面点一下就重开。
               键盘若因焦点/宿主拦截收不到键，至少还有一条路。 */
            onClick: () => {
              const st = stRef.current;
              if (st && st.phase === 'over') restart();
            },
          }),
          React.createElement('div', { className: 'ph-arcade__hud', ref: hudRef }),
        );
      }

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'phosphor-arcade', order: 91, label: 'PHOSPHOR arcade (easter egg)' },
        PhosphorArcade,
      ));

      /* ── SKILL 库 ────────────────────────────────────────────────────────────
         为什么需要宿主半边：浏览器没有读文件的接口，skill 的正文只能由宿主递过来。
         宿主那侧提供三条路由（见 index.js）：
           GET  /__phosphor/skills        目录快照
           GET  /__phosphor/skills/<n>    单个正文
           POST /__phosphor/skills/open   在资源管理器里打开（宿主侧有白名单）

         【面板与设置行分开】和街机同一个理由：外层只订阅开关、关着就渲染 null，
         内层组件才放状态 —— 否则"关着"时 hook 数量会变，React 直接报错。 */

      function PhosphorSkillLib() {
        const [, bump] = React.useState(0);
        React.useEffect(() => subscribeSkillLib(() => bump((n) => n + 1)), []);
        if (!skillLibOpen) return null;
        return React.createElement(SkillLibPanel);
      }

      /** 未生效原因 → 人话 */
      const SKILL_REASON = {
        'no-skill-md': '缺少 SKILL.md',
        'no-name-in-frontmatter': 'frontmatter 里没有 name',
        shadowed: '同名被更高优先级覆盖',
        'not-loaded': '未被加载',
      };

      function SkillLibPanel() {
        const [snap, setSnap] = React.useState(null);
        const [err, setErr] = React.useState('');
        const [busy, setBusy] = React.useState(false);
        const [q, setQ] = React.useState('');
        const [sel, setSel] = React.useState('');       /* 选中的 name 或 dir */
        const [doc, setDoc] = React.useState(null);
        const [docErr, setDocErr] = React.useState('');
        const [note, setNote] = React.useState('');

        const load = React.useCallback(() => {
          setBusy(true);
          setErr('');
          fetch('/__phosphor/skills', { headers: { accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
            .then((j) => setSnap(j))
            .catch((e) => setErr((e && e.message) || String(e)))
            .finally(() => setBusy(false));
        }, []);

        React.useEffect(() => { load(); }, [load]);

        /* 每次打开都把焦点放到搜索框、滚动归零 —— 从"第一层"开始看，
           不沿用上一次的滚动位置。 */
        const searchRef = React.useRef(null);
        const listRef = React.useRef(null);
        React.useEffect(() => {
          try {
            if (searchRef.current && searchRef.current.focus) searchRef.current.focus();
            if (listRef.current) listRef.current.scrollTop = 0;
          } catch { /* noop */ }
        }, []);

        /* ESC 关闭。用 capture 挂 document：面板里的输入框有时拿焦点，
           挂在面板自己身上会漏掉那一种情况。 */
        React.useEffect(() => {
          const onKey = (e) => { if (e.key === 'Escape') setSkillLibOpen(false); };
          document.addEventListener('keydown', onKey, true);
          return () => document.removeEventListener('keydown', onKey, true);
        }, []);

        const pick = (item) => {
          setSel(item.name || item.dir);
          setDoc(null);
          setDocErr('');
          setNote('');
          if (!item.name) return;                    /* 未生效的没有可加载的名字 */
          /* 失败时把【响应体里的 error】带出来 —— 只显示 HTTP 404 等于没说，
             后端其实已经告诉我们它为什么找不到。 */
          fetch('/__phosphor/skills?skill=' + encodeURIComponent(item.name), { headers: { accept: 'application/json' } })
            .then((r) => r.json().catch(() => ({})).then((body) => {
              if (r.ok) return body;
              const detail = body && body.error ? body.error : ('HTTP ' + r.status);
              throw new Error(detail + (body && body.getError ? ' · ' + body.getError : ''));
            }))
            .then((j) => setDoc(j))
            .catch((e) => setDocErr((e && e.message) || String(e)));
        };

        const openDir = (dir) => {
          setNote('');
          fetch('/__phosphor/skills', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dir }),
          })
            .then((r) => r.json())
            .then((j) => setNote(j && j.error ? '打开失败：' + j.error : '已在资源管理器打开'))
            .catch((e) => setNote('打开失败：' + ((e && e.message) || e)));
        };

        const copyDir = (dir) => {
          try {
            navigator.clipboard.writeText(dir).then(
              () => setNote('路径已复制'),
              () => setNote('复制失败（浏览器拒绝）'),
            );
          } catch { setNote('复制失败'); }
        };

        /* ── 过滤与分组 ── */
        const ql = q.trim().toLowerCase();
        const hit = (s) => {
          if (!ql) return true;
          return [s.name, s.folder, s.description, s.whenToUse, s.dir, s.path]
            .filter(Boolean).some((t) => String(t).toLowerCase().indexOf(ql) >= 0);
        };

        const groups = [];
        if (snap) {
          const bySource = new Map();
          for (const a of snap.active || []) {
            if (!hit(a)) continue;
            const k = a.source || 'other';
            if (!bySource.has(k)) bySource.set(k, []);
            bySource.get(k).push(a);
          }
          for (const entry of bySource.entries()) {
            groups.push({ key: entry[0], label: entry[0] + ' (' + entry[1].length + ')', items: entry[1] });
          }
          const orph = (snap.orphans || []).filter(hit);
          if (orph.length) groups.push({ key: '__orphans', label: '未生效 (' + orph.length + ')', items: orph, orphan: true });
        }

        const selected = (() => {
          if (!snap || !sel) return null;
          const all = [...(snap.active || []), ...(snap.orphans || [])];
          return all.find((x) => (x.name || x.dir) === sel) || null;
        })();

        const counts = snap && snap.counts ? snap.counts : null;

        const panel = React.createElement('div', { className: 'ph-skilllib' },
          React.createElement('div', { className: 'ph-skilllib__bar' },
            React.createElement('span', { className: 'ph-skilllib__title' }, 'SKILL 库'),
            counts ? React.createElement('span', { className: 'ph-skilllib__counts' },
              counts.active + ' 生效 · ' + counts.orphans + ' 未生效') : null,
            React.createElement('span', {
              className: 'ph-skilllib__close',
              title: '关闭 (ESC)',
              onClick: () => setSkillLibOpen(false),
            }, '×'),
          ),

          React.createElement('div', { className: 'ph-skilllib__tools' },
            React.createElement('input', {
              className: 'ph-skilllib__search',
              ref: searchRef,
              type: 'text',
              placeholder: '搜索 name / 描述 / 路径…',
              value: q,
              onChange: (e) => setQ(e.target.value),
            }),
            React.createElement('span', {
              className: 'ph-skilllib__btn',
              title: '重新读取宿主数据',
              onClick: () => load(),
            }, busy ? '读取中…' : '重新扫描'),
          ),

          err ? React.createElement('div', { className: 'ph-skilllib__err' },
            '读取失败：' + err + '（宿主半边可能未加载）') : null,

          React.createElement('div', { className: 'ph-skilllib__body' },
            React.createElement('div', { className: 'ph-skilllib__list', ref: listRef },
              groups.length === 0 && snap ? React.createElement('div', { className: 'ph-skilllib__empty' }, '没有匹配项') : null,
              groups.map((g) => React.createElement('div', { className: 'ph-skilllib__group', key: g.key },
                React.createElement('div', { className: 'ph-skilllib__groupLabel' }, g.label),
                g.items.map((it) => {
                  const k = it.name || it.dir;
                  const on = k === sel;
                  return React.createElement('div', {
                    key: k,
                    className: 'ph-skilllib__item' + (on ? ' is-sel' : '') + (g.orphan ? ' is-orphan' : ''),
                    onClick: () => pick(it),
                    title: it.dir || it.path || '',
                  },
                    React.createElement('span', { className: 'ph-skilllib__itemName' },
                      it.name || it.folder || '(无名)'),
                    React.createElement('span', { className: 'ph-skilllib__itemMeta' },
                      g.orphan
                        ? (SKILL_REASON[it.reason] || it.reason || '未生效')
                        : (it.bytes ? Math.round(it.bytes / 1024) + ' KB' : '')),
                  );
                }),
              )),
            ),

            React.createElement('div', { className: 'ph-skilllib__detail' },
              !selected ? React.createElement('div', { className: 'ph-skilllib__empty' },
                '左侧选一条查看正文') : React.createElement('div', null,
                React.createElement('div', { className: 'ph-skilllib__name' }, selected.name || selected.folder || '(无名)'),
                selected.description ? React.createElement('div', { className: 'ph-skilllib__desc' }, selected.description) : null,
                selected.whenToUse ? React.createElement('div', { className: 'ph-skilllib__when' }, '何时使用：' + selected.whenToUse) : null,
                React.createElement('div', { className: 'ph-skilllib__dir' }, selected.dir || selected.path || '(无路径)'),
                React.createElement('div', { className: 'ph-skilllib__actions' },
                  React.createElement('span', {
                    className: 'ph-skilllib__btn',
                    onClick: () => copyDir(selected.dir || selected.path || ''),
                  }, '复制路径'),
                  React.createElement('span', {
                    className: 'ph-skilllib__btn',
                    onClick: () => openDir(selected.dir || ''),
                  }, '在资源管理器打开'),
                  note ? React.createElement('span', { className: 'ph-skilllib__note' }, note) : null,
                ),
                docErr ? React.createElement('div', { className: 'ph-skilllib__err' }, '正文读取失败：' + docErr) : null,
                doc ? React.createElement('pre', { className: 'ph-skilllib__content' }, doc.content || '(空)') : null,
              ),
            ),
          ),
        );

        /* portal 到 body：全局浮层不该受任何容器层叠上下文的限制。
           拿不到 react-dom 就退回原位渲染 —— 宁可层叠不对，也不能不显示。 */
        try {
          if (ReactDOM && typeof ReactDOM.createPortal === 'function'
              && typeof document !== 'undefined' && document.body) {
            return ReactDOM.createPortal(panel, document.body);
          }
        } catch { /* noop */ }
        return panel;
      }

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'phosphor-skilllib', order: 92, label: 'PHOSPHOR skill library' },
        PhosphorSkillLib,
      ));

      /* ── 电源效果（关机 / 开机）──────────────────────────────────────────────
         为什么它必须是一个【独立 slot 组件】：
         它要在"主题被关掉的那一刻"渲染出来。此时 apply 里的一切都在收尾，
         只有 slots 还是活的 —— 所以这是唯一能在那一刻画东西的地方。

         为什么不用 animationend 就够：
         万一样式没生效（例如 reduced-motion 或者宿主样式覆盖），
         animationend 永远不来，那块不透明黑层就会【永久盖住界面】。
         所以配一个超时兜底 —— 宁可动画不完整，也不能把界面吃掉。 */
      function PhosphorPowerFx() {
        const [, bump] = React.useState(0);
        React.useEffect(() => subscribePower(() => bump((n) => n + 1)), []);
        React.useEffect(() => {
          if (!powerPhase) return undefined;
          const t = setTimeout(() => setPowerPhase(null), 600);
          return () => clearTimeout(t);
        }, [powerPhase]);
        if (!powerPhase) return null;
        /* reduced-motion：直接不演（而不是演一个静止的黑色闪屏） */
        try {
          if (window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
        } catch { /* noop */ }
        return React.createElement('div', {
          className: 'ph-power ph-power--' + powerPhase,
        });
      }

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'phosphor-powerfx', order: 89, label: 'PHOSPHOR power fx' },
        PhosphorPowerFx,
      ));

      /* 6.7b 启动自检序列 —— 挂在 bootHost 上的 slot 条目。
              一次性：本会话首次装载时播放，之后 booted 置位不再重播。
              逐行揭示用 React state，不迁移 DOM。 */
      function BootSequence({ bootHostElement }) {
        const state = usePrefs();
        const [shown, setShown] = React.useState(0);
        const [fading, setFading] = React.useState(false);
        const [finished, setFinished] = React.useState(false);
        const active = state.enabled && state.boot;

        React.useEffect(() => {
          if (!active || !bootHostElement || !bootHostElement.isConnected) return undefined;
          /* 已经播过（本会话首次之后）→ 直接进入终态。
             【这一句是修一个严重缺陷】原先写的是 `if (!active || booted || …) return undefined;`
             即 booted 为真时直接返回。但 booted 是模块级变量、finished 是组件局部 state：
             组件一旦重挂载（React StrictMode 双调用、slot 条目重建、HMR），
             新实例的 shown=0、finished=false，而 booted 仍为 true →
             effect 立即返回、永远不会 setFinished(true) → 渲染出一个
             【没有任何子节点】的 .ph-boot —— 它带着 inset:0 + 不透明背景 +
             z-index 2147483200，等于一块全屏遮罩永久盖住整个界面。
             （pointer-events:none 只保证还能点到下面，但看不见。）
             现在改为：播过就直接置 finished，让组件走 return null 分支。 */
          if (booted) { setFinished(true); return undefined; }
          booted = true;
          const timers = [];
          let at = 0;
          for (let i = 0; i < BOOT_LINES.length; i++) {
            const idx = i + 1;
            timers.push(setTimeout(() => setShown(idx), at));
            at += BOOT_LINES[i][0].trim() === '' ? 26 : 58;
          }
          /* 两段式结束，让预览页的 .ph-boot.is-done{opacity:0} + transition .28s
             真正生效（此前该 CSS 是死代码：className 恒为 'ph-boot'，从不加 is-done，
             于是「淡出」实际是硬切）。 */
          timers.push(setTimeout(() => setFading(true), at + 120));
          timers.push(setTimeout(() => setFinished(true), at + 120 + 280));
          return () => { for (const id of timers) clearTimeout(id); };
        }, [active, bootHostElement]);

        /* 空容器绝不渲染 —— 这是上面那个全屏遮罩的第二道防线：
           即使 shown 仍为 0（effect 被中断、或刚置 finished 的这一帧），
           也不允许把 inset:0 的不透明层画出来。 */
        if (!active || finished || shown === 0) return null;

        return React.createElement('div', {
          className: fading ? 'ph-boot is-done' : 'ph-boot',
          'aria-hidden': 'true',
        },
          BOOT_LINES.slice(0, shown).map(([text, kind], i) => React.createElement(
            'div',
            { key: i, className: kind ? 'ph-boot__' + kind : undefined },
            text,
            kind === 'ok' ? React.createElement('span', { className: 'ph-boot__ok' }, 'OK') : null,
          )),
        );
      }

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'phosphor-boot',
          order: 95,
          label: 'PHOSPHOR boot sequence',
          inject: () => ({ bootHostElement: bootHost }),
        },
        BootSequence,
      ));

      /* 6.8 设置行 —— 设置 › 通用 的 settings.general.item 座位。
             ------------------------------------------------------------------
             【为什么要有分组标题与留白】用户实测截图指出「终端外观和上面的
             有点太挤了，而且也没有写终端的名字」。原因是这个座位直接以第一行
             开关开头，与上一节（宿主的「性能与用量」）之间只隔了宿主的行距，
             既没有主题标识、也没有视觉分隔。
             现在补上：
               · 一行带 PHOSPHOR 标识的标题（与状态栏、启动序列用的名字一致）
               · 三处分组小标题，把 9 个开关拆成「增强 / 极致 / 强度」，
                 与预览页 PHOSPHOR CONTROL 面板的分组一致
               · 组与组之间留白，并加一条顶部细分隔线把它与宿主内容分开 */
      /* 【数组第二项存的是"词典键"而不是文案】渲染时才 tr() 翻译。
         这样语言切换会跟着变 —— 若在这里写死中文，切换语言时不会更新。 */
      const TOGGLE_GROUPS = [
        {
          label: 'group.enhance',
          items: [
            ['glow',      'opt.glow'],
            ['scan',      'opt.scan'],
            ['statusbar', 'opt.statusbar'],
          ],
        },
        {
          label: 'group.extreme',
          items: [
            ['boot',   'opt.boot'],
            ['crt',    'opt.crt'],
            ['glitch', 'opt.glitch'],
            ['typew',  'opt.typew'],
            ['ascii',  'opt.ascii'],
          ],
        },
        {
          /* 音效单独成组：它和"外观"是两类东西，
             混在 B 组里会让"关掉音效"看起来像是在调外观。
             放在最后一组（字母序 B→C→E 也顺）。 */
          label: 'group.sound',
          items: [
            /* 开始序列拆成两项 —— 用户要求：只想听复位的可以关掉打字音。 */
            ['startReset',   'opt.startReset'],
            ['startType',    'opt.startType'],
            ['soundEnd',     'opt.soundEnd'],
            ['sessionSound', 'opt.sessionSound'],
            ['endReset',     'opt.endReset'],
          ],
        },
      ];
      const SLIDERS = [
        ['scanLine',  'slide.scanLine'],
        ['glowPower', 'slide.glowPower'],
        ['vignette',  'slide.vignette'],
        /* 音效强度：全局乘数，0 = 静音、100 = 基准、200 = 两倍。
           它是【乘在每组增益之上】的，所以不会改变各音之间的相对关系 ——
           复位/打字/叮/切换的相对配比在 SOUND_GAIN 里（那是我调过的），
           用户调总强度时不该把那个配比也改掉。
           之所以做成"强度"而不是"音量"：与上面三个滑块同一个语汇
           （本主题的控件都是硬件面板语言，旋钮/推子叫"强度"更贴）。
           注意：它只在有音效开关打开时才有效果。 */
        ['soundVolume', 'slide.soundVolume'],
        ['typeSpeed',   'slide.typeSpeed'],
      ];

      function TerminalAppearanceRow() {
        const state = usePrefs();

        /* ── LAB 入口：面板头部 PHOSPHOR 字标【连点三下】 ──────────────────
           【为什么连点而不是单击】
             单击太容易误触；而连点必须给"差一点就成功"的反馈 —— 否则用户
             点一两下没反应，就会以为它不可点。所以：
               第 1 下 → 字标微微变淡（我收到了）
               第 2 下 → 亮起来 + 提示"再点一下"
               第 3 下 → 展开 LAB
             这就是把"隐藏彩蛋"做成"能被意外发现"的关键：反馈本身就是线索。

           【为什么计数放 ref】每点一下都重渲染整张面板没有意义；
           只有视觉反馈需要 state。定时器在卸载时清掉。 */
        const [markFlash, setMarkFlash] = React.useState(0);
        const markTimer = React.useRef(null);
        const markClicks = React.useRef({ n: 0, at: 0 });
        React.useEffect(() => () => {
          if (markTimer.current) { clearTimeout(markTimer.current); markTimer.current = null; }
        }, []);
        const onMarkClick = () => {
          /* 【114 次】这个数字是刻意的：没有谁会"顺手"达成，只能是有意为之。
             计数落在 localStorage（见 LOG_ENTRIES 上方说明）——
             走 setPref 会让每一次点击都重建整套令牌。 */
          const clickN = bumpLogStat('markClicks');
          if (clickN >= 114) markFound('click114');
          if (clickN >= 200) markFound('revoked');
          const now = Date.now();
          const c = markClicks.current;
          if (now - c.at > 1000) c.n = 0;
          c.at = now;
          c.n += 1;
          if (c.n >= 3) {
            c.n = 0;
            setMarkFlash(0);
            const nextOpen = !state.labOpen;
            setPref('labOpen', nextOpen);
            if (nextOpen) markFound('lab');
            return;
          }
          setMarkFlash(c.n);
          if (markTimer.current) clearTimeout(markTimer.current);
          markTimer.current = setTimeout(() => {
            markTimer.current = null;
            setMarkFlash(0);
          }, 900);
        };
        /* 提示语跟连点次数走 —— 不直接写"连点三下"，否则一眼剧透 */
        const markTitle = markFlash >= 2 ? '再点一下' : (markFlash === 1 ? '…' : 'PHOSPHOR');
        /* ── 版本号点击：复制完整信息 ────────────────────────────────────────
           组装出的文本是给【测试者贴给我】用的，所以字段固定、每行一个：
             版本 / 构建日期 / profile / dsh 地址
           profile 只有宿主知道（process.env.DSH_PROFILE），走同一路由的
           ?version=1 取；宿主不可用时仍然复制，只是 profile 写"(未知)"——
           【复制不能依赖宿主】，否则半边缺失时这个功能就废了。 */
        const [verFlash, setVerFlash] = React.useState('');
        const verTimer = React.useRef(null);
        React.useEffect(() => () => {
          if (verTimer.current) { clearTimeout(verTimer.current); verTimer.current = null; }
        }, []);
        const flashVer = (text) => {
          setVerFlash(text);
          if (verTimer.current) clearTimeout(verTimer.current);
          verTimer.current = setTimeout(() => {
            verTimer.current = null;
            setVerFlash('');
          }, 1200);
        };
        const onVersionClick = () => {
          const host = (typeof location !== 'undefined' && location.host) ? location.host : '';
          const finish = (profile) => {
            const text = 'PHOSPHOR ' + PHOS_VERSION
              + '\nbuild   ' + PHOS_BUILD
              + '\nprofile ' + (profile || '(未知)')
              + '\ndsh     ' + host;
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(
                  () => flashVer('已复制'),
                  () => flashVer('复制失败'),
                );
                return;
              }
            } catch { /* 落到下面 */ }
            flashVer('复制失败');
          };
          fetch('/__phosphor/skills?version=1', { headers: { accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => finish(j && j.profile))
            .catch(() => finish(null));
        };

        /* 主开关单独一行放在最前：它是总闸，与分组里的细项不是同一层级 */
        const nodes = [
          React.createElement('div', { className: 'ph-head', key: 'head' },
            React.createElement('span', {
              className: 'ph-head__mark'
                + (state.labOpen ? ' is-lab' : '')
                + (markFlash > 0 ? ' is-flash' + markFlash : ''),
              title: markTitle,
              onClick: onMarkClick,
            }, 'PHOSPHOR'),
            React.createElement('span', { className: 'ph-head__sub' }, tr('general.title')),
            /* 版本号：常驻可见（LAB 里那个默认藏起来，等于没有）。
               点一下复制完整信息，方便报 bug 时直接粘贴。 */
            React.createElement('span', {
              className: 'ph-head__ver' + (verFlash ? ' is-flash' : ''),
              title: '点击复制版本信息（版本 / 构建日期 / profile）',
              onClick: onVersionClick,
            }, verFlash || PHOS_VERSION),
          ),
          React.createElement('label', { className: 'ph-row ph-row--master', key: 'enabled' },
            React.createElement('input', {
              type: 'checkbox',
              checked: Boolean(state.enabled),
              onChange: (e) => setPref('enabled', e.target.checked),
            }),
            React.createElement('span', null, tr('general.title')),
          ),
        ];

        for (const group of TOGGLE_GROUPS) {
          nodes.push(React.createElement(
            'div', { className: 'ph-sec', key: 'sec-' + group.label }, tr(group.label),
          ));
          for (const [key, title] of group.items) {
            nodes.push(React.createElement(
              'label',
              { className: 'ph-row', key },
              React.createElement('input', {
                type: 'checkbox',
                checked: Boolean(state[key]),
                onChange: (e) => setPref(key, e.target.checked),
              }),
              React.createElement('span', null, tr(title)),
            ));
          }
        }

        nodes.push(React.createElement('div', { className: 'ph-sec', key: 'sec-sliders' }, tr('section.intensity')));
        for (const [key, title] of SLIDERS) {
          const value = clampPct(state[key], 100);
          /* 【轨道填充需要一个"已走过比例"】给 input 写一个内联自定义属性
             --ph-fill，值域 0–100%，CSS 用它把轨道切成"已填充 / 未填充"两段。
             为什么走内联而不是 React 的 style 对象：自定义属性在 React 里
             必须用 style={{'--ph-fill': ...}} 这种字符串键，可读性差；
             而这里取值是纯派生值，写成 style 属性更直白。
             注意 max 是 200、min 是 0，所以百分比是 value/2 而不是 value。
             保留一位小数：gradient 里的 stop 用小数更平滑，整数值会在
             轨道较长时看到台阶。 */
          const fillPct = Math.round((value / 200) * 1000) / 10;
          nodes.push(React.createElement(
            'label',
            { className: 'ph-slide', key },
            React.createElement('span', { className: 'ph-slide__label' }, tr(title)),
            React.createElement('input', {
              type: 'range', min: 0, max: 200, step: 5, value,
              style: { '--ph-fill': fillPct + '%' },
              onChange: (e) => setPref(key, Number(e.target.value)),
            }),
            React.createElement('span', { className: 'ph-slide__value' }, value + '%'),
          ));
        }

        /* 【试听按钮】放在「强度」段末尾。
           动机：调音效强度/打字机速度若要靠"发消息→等回答"来验证，
           试错成本太高。这一段演示把四类音都走一遍，几秒内听全。
           禁用条件：总闸关闭、或四类音全关、或还没有可用的音频上下文
           （后者通常在"还没点过页面"时成立 —— 浏览器不允许未交互时播音）。 */
        {
          const soundOn = state.enabled &&
            (state.startReset || state.startType || state.soundEnd ||
             state.sessionSound || state.endReset);
          /* 【诊断信息放进 title，而不是 console.log】
             目的仍是"没声音时能分层定位"，但改成了悬停即见、不污染 Console：
               ctx   上下文状态（none = 从没交互过 / suspended = 未解锁 / running = 可用）
               buf   已解码音源数（0/4 多为解码失败）
               fn    试听回调是否已挂（false = 开关导致没挂）
               vol   强度乘数（0 = 被滑块静音）
             ★ 注意这里只能读【模块级通道】与 state —— 本组件在 apply 之外，
               直接写 audioCtx / soundBuf 会 ReferenceError（这正是本轮修过的错）。 */
          const diag = (typeof audioDiagFn === 'function') ? audioDiagFn() : null;
          const status = diag
            ? ('ctx=' + diag.ctx + '  buf=' + diag.buf + '  fn=' + diag.fn + '  vol=' + diag.vol)
            : (tr('preview.noAudio') + (clampPct(state.soundVolume, 100) / 100));
          nodes.push(React.createElement(
            'div',
            { className: 'ph-row ph-row--preview', key: 'preview' },
            React.createElement('button', {
              type: 'button',
              className: 'ph-btn ph-btn--preview',
              disabled: !soundOn,
              title: soundOn
                ? (tr('preview.title') + status)
                : tr('preview.disabled'),
              onClick: () => {
                const fn = previewFn;
                if (typeof fn !== 'function') return;   /* 未挂载：按钮本就会 disabled */
                /* 返回 false 表示音频还没解锁。不弹 alert（粗暴），
                   改为在标题里已写明状态 —— 用户悬停即可看到 ctx 是 none/suspended。 */
                fn();
              },
            }, tr('preview.button')),
          ));
        }


        /* ── SKILL 库入口 ────────────────────────────────────────────────────
           放在 LAB 之前、且不受 labOpen 影响：它是工具，不是隐藏内容。
           面板里显示的数量来自宿主，点开时才去取 —— 这里只放一行，不加载数据。 */
        nodes.push(React.createElement('div', { className: 'ph-skilllib__row', key: 'skilllib' },
          React.createElement('span', { className: 'ph-skilllib__rowLabel' }, 'SKILL 库'),
          React.createElement('span', { className: 'ph-skilllib__hint' }, '浏览本机 skill、搜索与查看正文'),
          React.createElement('span', {
            className: 'ph-skilllib__rowBtn',
            onClick: () => setSkillLibOpen(true),
          }, '打开'),
        ));

        /* ── LAB · 实验性 ────────────────────────────────────────────────────
           入口在头部 PHOSPHOR 字标（连点三下）。
           【默认收起】：没人发现它时，设置面板和以前一模一样 —— 零视觉变化。
           它刻意【不进】TOGGLE_GROUPS / SLIDERS：那不是分组，是隐藏内容。
           展开状态存进偏好，所以找到一次之后它会一直开着（实验室是拿来用的）。 */
        if (state.labOpen) {
          /* ── 系统日志的渲染数据 ────────────────────────────────────────────
             这里【不再有 uptime】。原来那行是"主题装载至今"的时长，
             但它有两个毛病：LAB 没有秒级刷新所以它不会自己走（看起来像卡死），
             而"uptime"这个名字又让人以为是系统运行时长 —— 名不副实。
             一个不动的假时钟不如没有。计数（n / 12）才是这一块真正的信息。 */
          const foundMap = state.found || {};
          const foundCount = LOG_ENTRIES.filter((e) => !!foundMap[e.id]).length;
          const allFound = foundCount === LOG_ENTRIES.length;
          nodes.push(React.createElement('div', { className: 'ph-lab', key: 'lab' },
            React.createElement('div', { className: 'ph-lab__head' },
              React.createElement('span', { className: 'ph-lab__tag' }, 'LAB'),
              React.createElement('span', { className: 'ph-lab__ver' }, 'PHOSPHOR ' + PHOS_VERSION),
            ),
            React.createElement('div', { className: 'ph-lab__hint' },
              '实验性选项 · 连点 PHOSPHOR 三下收起'),
            React.createElement('div', { className: 'ph-lab__row', key: 'tone' },
              React.createElement('span', { className: 'ph-lab__label' }, '磷光色'),
              React.createElement('span', { className: 'ph-seg' },
                React.createElement('button', {
                  type: 'button',
                  className: 'ph-seg__btn' + ((state.tone || 'p1') === 'p1' ? ' is-on' : ''),
                  title: 'P1 绿 —— 磷光绿，原始配色',
                  onClick: () => { setPref('tone', 'p1'); if (bumpLogStat('toneSwitches') >= 6) markFound('tone6'); },
                }, 'P1 绿'),
                React.createElement('button', {
                  type: 'button',
                  className: 'ph-seg__btn' + (state.tone === 'p3' ? ' is-on' : ''),
                  title: 'P3 琥珀 —— 老式琥珀单色显示器',
                  onClick: () => { setPref('tone', 'p3'); markFound('p3'); if (bumpLogStat('toneSwitches') >= 6) markFound('tone6'); },
                }, 'P3 琥珀'),
                React.createElement('button', {
                  type: 'button',
                  className: 'ph-seg__btn' + (state.tone === 'p4' ? ' is-on' : ''),
                  title: 'P4 白 —— 老式白磷光显示器',
                  onClick: () => { setPref('tone', 'p4'); markFound('p4'); if (bumpLogStat('toneSwitches') >= 6) markFound('tone6'); },
                }, 'P4 白'),
              ),
            ),
            React.createElement('label', { className: 'ph-row', key: 'powerFx' },
              React.createElement('input', {
                type: 'checkbox',
                checked: state.powerFx !== false,
                onChange: (e) => setPref('powerFx', e.target.checked),
              }),
              React.createElement('span', null, '开关机动画'),
            ),
            React.createElement('label', { className: 'ph-row', key: 'eggs' },
              React.createElement('input', {
                type: 'checkbox',
                checked: state.eggs !== false,
                onChange: (e) => setPref('eggs', e.target.checked),
              }),
              React.createElement('span', null, '彩蛋（状态栏街机入口）'),
            ),
            /* ── SYSTEM LOG ────────────────────────────────────────────────
               未解锁的条目显示成【红块】，长度就是原文长度。
               不用问号，是因为红块更贴"机密日志"，而且长度本身是个线索。 */
            React.createElement('div', { className: 'ph-log', key: 'log' },
              React.createElement('div', { className: 'ph-log__title' }, 'SYSTEM LOG'),
              React.createElement('div', { className: 'ph-log__row' },
                React.createElement('span', { className: 'ph-log__ok' }, '[ ok ]'),
                React.createElement('span', null, 'theme loaded'),
              ),
              ...LOG_ENTRIES.map((e) => {
                const got = !!foundMap[e.id];
                const tagCls = got
                  ? (e.kind === 'warn' ? 'ph-log__warn' : 'ph-log__ok')
                  : 'ph-log__lock';
                const txtCls = got
                  ? (e.kind === 'warn' ? 'ph-log__warn' : '')
                  : 'ph-log__lock';
                return React.createElement('div', { className: 'ph-log__row', key: e.id },
                  React.createElement('span', { className: tagCls },
                    got ? (e.kind === 'warn' ? '[warn]' : '[ ok ]') : '[ -- ]'),
                  React.createElement('span', { className: txtCls },
                    got ? e.text : '\u2588'.repeat(e.text.length)),
                );
              }),
              allFound
                ? React.createElement('div', { className: 'ph-log__row', key: 'clear' },
                    React.createElement('span', { className: 'ph-log__ok' }, '[ ok ]'),
                    React.createElement('span', { className: 'ph-log__clear' }, 'clearance granted'),
                  )
                : null,
              React.createElement('div', { className: 'ph-log__foot' },
                React.createElement('span', null, foundCount + ' / ' + LOG_ENTRIES.length),
              ),
            ),
          ));
        }
        return React.createElement('div', { className: 'ph-panel' }, ...nodes);
      }

      ctx.slots.inject('settings.general.item', () => ctx.slots.register(
        { name: 'settings.general.item', id: 'phosphor-appearance', order: 60,
          /* 声明 locale 命名空间：宿主会据此给组件注入 t 座（本文件用的是
             apply 作用域里 bind 出来的 tr，两者读同一份词典，行为一致）。 */
          locale: 'phosphor', label: 'PHOSPHOR 磷光绿' },
        TerminalAppearanceRow,
      ));

      /* 6.9 快速回复键 [ continue ] —— conversation.input.left 座位。
             ==================================================================
             需求：助手常问"要不要继续做某事"，希望有一个按一下就回复"继续"
             的键，放在输入工具行【最左】。

             位置由宿主决定。宿主原文的渲染顺序：
               renderSlot("conversation.input.permission")   ← 权限模式（工作区内修改）
               renderSlot("conversation.input.plan")
               renderSlot("conversation.input.left")         ← 本键在此（左区）
             座位契约（取自 asar）：kind "list"、scope "session"、
             说明 "Compact controls at the left of the composer tool row."

             【为什么用官方 props 而不是操作 DOM】
             该座位 standardProps 暴露 inputActions，其 7 个方法经【运行时探针】确认：
               captureInsertion / insertText / setDraft / addAttachments /
               removeAttachment / pruneAttachments / submit
             submit 就是宿主自己的提交入口（宿主实现：submit() → submit("queue")）。
             宿主源码里的真实签名：
               captureInsertion: () => ({ ...caretSpan(), draftRev: rev })
               insertText: (text, span) => {          // 注意 text 在前
                 if (phase === "adjudicating" || phase === "submitting" || disposed) return false;
                 if (span.draftRev !== rev) return false;       // 防竞态
                 return draftEditor.insertAsyncText(span, text);
               }
             insertAsyncText 的名字带 Async，实为【同步】：内部 applyEdit(...) 后
             return applied。所以整条链同步、每步可校验，可做原子提交：

               const span = inputActions.captureInsertion();
               if (inputActions.insertText("继续", span)) inputActions.submit();

             【为什么不用 setDraft】
             setDraft 会先 root.clear() 整段替换并切断撤销历史。用户可能已在输入框
             打了半句话，用它会把内容抹掉。insertText 是"在光标处插入一次可撤销
             编辑"，不破坏已有内容。另外宿主 setDraft 里有
             `if (clean === projection.clipboardText) return` —— 草稿恰好已是"继续"时
             它会静默不动作，比 insertText 更难判断结果。

             【运行中为什么禁用】
             宿主 insertText 在 submitting/adjudicating 阶段自己会返回 false，
             即写入必被拒绝；此时若仍 submit 就会提交空内容。所以禁用是
             【语义正确】而非仅防误触。判据复用已有的 data-phosphor-stop 标记
             （markSendState 写入、用户实测确认可用），不引入新通道。 */
      const CONTINUE_TEXT = '继续';

      /* 座位注入的 props 里，inputActions 就是那 7 个方法的容器
         （运行时探针实测：captureInsertion / insertText / setDraft / addAttachments /
          removeAttachment / pruneAttachments / submit）。
         直接用 props 里的它 —— 不做 DOM 查找、不做 WeakMap 绕路。
         少一层间接就少一处静默失效（这个项目已经吃过太多次"看起来接好了其实没接"）。 */
      /* 【二分定位的结论，值得记下来】
         第 1 步：只 return 一个 span（零 hook）→ 渲染成功。
         第 2 步：加 usePrefs() → 也成功。
         第 3 步（本轮）：加 useState + 观察 → 见下。
         原先一次性写完时整个座位报 data-slot-error 且不留日志，
         二分是唯一能定位的办法。教训：slot 组件首次接入时，
         先验证"零 hook 能渲染"，再逐层加 —— 不要一次写完再排查。 */
      function QuickContinue({ inputActions, useSession }) {
        const state = usePrefs();
        /* 【运行中判据改用官方 hook】
           原先读 DOM 上的 data-phosphor-stop。子智能体逆向确认：
           InputState.phase 只表示"提交面"状态（plain/claimed/adjudicating/submitting），
           【不代表模型是否在输出】—— 乐观提交设计下模型跑着时 phase 仍是 plain。
           正确判据是 SessionSnapshot.running，且本座位 standardProps 里就有 useSession。
           InputBar 自己也是这么写的：const running = useSession((s) => s.running) ?? false
           改为官方 hook 后不再需要 MutationObserver（React 会在 snapshot 变化时重渲染）。 */
        const running = typeof useSession === 'function'
          ? (useSession((s) => (s ? s.running : false)) ?? false)
          : false;
        const busy = !!running;

        if (!state.enabled) return null;

        const onContinue = () => {
          if (busy) return;                             /* 运行中不提交 */
          if (!inputActions || typeof inputActions.insertText !== 'function') {
            /* 不静默：拿不到能力时留明确日志，否则按钮"点了没反应"无从排查 */
            console.warn('[phosphor] quick continue: inputActions 不可用');
            return;
          }
          try {
            const span = inputActions.captureInsertion();
            if (!span) return;
            /* insertText 同步返回 boolean；【只有真的写进去才提交】，
               避免"提交了空内容"这种最糟的结果。 */
            if (inputActions.insertText(CONTINUE_TEXT, span)) inputActions.submit();
          } catch (err) {
            console.error('[phosphor] quick continue failed', err);
          }
        };

        return React.createElement('button', {
          type: 'button',
          className: 'ph-qc',
          disabled: busy,
          onClick: onContinue,
          title: busy ? '模型输出中，暂不可用' : '发送「继续」',
          'aria-label': '发送继续',
        }, 'continue');
      }

      ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
        {
          name: 'conversation.input.right',
          id: 'phosphor-quick-continue',
          order: 0,
          label: 'PHOSPHOR quick continue',
        },
        QuickContinue,
      ));

    }

    /* 服务声明是「可见性」声明，不只是依赖顺序。
       没在这里声明的服务，在 apply / effect 执行时取不到。两个实例：
         ① 早先只用 ctx.get('theme') 去软取，theme 不在 inject 里 → 值恒为
            undefined → 令牌层静默地从未注册（错误还被吞在 else 分支里）。
         ② 加余额栏时探测 remote.account：ctx.get('remote.account') 能拿到
            一个 Proxy，但访问 ctx.remote 直接抛
            "cannot get property \"remote\" without inject" —— 同一门槛。
       因此 inject 里【每一项都是硬依赖】：声明的服务不存在，插件会整体
       加载失败。加之前要先确认它真的在（②就是靠这句话确认的）。
       现在声明 slots / theme / remote 三项。 */
    return { inject: ['slots', 'theme', 'remote', 'remote.account'], apply };
    }
});
