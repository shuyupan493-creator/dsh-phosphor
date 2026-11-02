/*
  render-check.mjs —— 真正执行 client.js 的工厂函数，把设置面板渲染一遍

  为什么需要它：静态判据（正则 + 缩进 + 花括号深度）已经连续误报四次，
  因为 JS 的作用域/引用语义不是文本能可靠推断的
  （属性名、参数、解构、子串都会骗过正则）。

  这个检查换个思路：【真的把代码跑起来】。
    ① 提供 window.__ModuleLoader__.load 的桩
    ② 用最小 React 桩（只需 createElement 返回普通对象）
    ③ 调用 factory(stubRequire) 拿到 { inject, apply }
    ④ 造一个最小 ctx 桩（effect/slots/theme/remote/locale/get/on…）
    ⑤ 调 apply(ctx)
    ⑥ 从 slots.register 里取出设置面板组件并调用它
       —— 若面板引用了不可达的名字，这里会【真的抛 ReferenceError】

  注意：它不能覆盖所有路径（音频需要真实 DOM/WebAudio），
  但能立刻抓住"面板引用了作用域外的名字"这类我在本项目里反复犯的错。
  用法：  node tools/render-check.mjs
*/
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = process.argv[2] || join(here, '..', 'client.js');
const src = readFileSync(clientPath, 'utf8');

const problems = [];
function fail(where, e) { problems.push(where + ' :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e))); }

/* ── 最小 React 桩 ────────────────────────────────────────────────────────── */
let hookState = [];
let effectQueue = [];
const effectCleanups = [];
let hookIdx = 0;
const React = {
  createElement: (type, props, ...children) => ({ __el: true, type, props: props || {}, children }),
  Fragment: 'Fragment',
  useState: (init) => {
    const i = hookIdx++;
    if (hookState[i] === undefined) hookState[i] = typeof init === 'function' ? init() : init;
    return [hookState[i], (v) => { hookState[i] = typeof v === 'function' ? v(hookState[i]) : v; }];
  },
  /* 收集 effect 回调，而不是立刻执行 —— 测试里可以挑一个组件手动跑一遍。 */
  useEffect: (fn) => { hookIdx++; effectQueue.push(fn); },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
  useLayoutEffect: () => { hookIdx++; },
};

/* ── module loader 桩 ─────────────────────────────────────────────────────── */
let factoryFn = null;
globalThis.window = globalThis.window || {};
globalThis.window.__ModuleLoader__ = {
  load({ id, factory }) { factoryFn = factory; },
};
globalThis.window.localStorage = {
  /* 打开调试出口门禁 —— client.js 现在只在 DEBUG_ON 时才挂
     __phosphorPrefs / __phMathProbe，而本工具要用它们覆盖分支路径。 */
  _debug: true,
  _d: {},
  getItem(k) { if (k === 'phosphor.debug') return '1'; return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
globalThis.window.matchMedia = () => ({
  matches: false, addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {},
});
// 极简 document 桩：只为让 apply 不抛错
const elStub = () => ({
  style: { setProperty() {}, removeProperty() {} },
  setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
  appendChild() {}, removeChild() {}, remove() {},
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  classList: { add() {}, remove() {}, contains: () => false },
  contains: () => false, isConnected: true, dataset: {}, children: [],
});
globalThis.document = {
  documentElement: elStub(),
  body: elStub(),
  head: { appendChild() {}, },
  createElement: () => elStub(),
  querySelector: () => null,
  querySelectorAll: () => [],
  /* 记录监听器：街机的键盘处理器是【先注册、后调用】的 ——
     只渲染不会报错，作用域写错要等真的按键才炸（本项目刚踩过）。
     所以把监听器收起来，测试里主动派发。 */
  __listeners: [],
  addEventListener(type, fn) {
    if (!this.__listeners) this.__listeners = [];
    this.__listeners.push({ type, fn });
  },
  removeEventListener(type, fn) {
    if (!this.__listeners) return;
    this.__listeners = this.__listeners.filter((r) => !(r.type === type && r.fn === fn));
  },
  __dispatch(type, ev) {
    if (!this.__listeners) return 0;
    let n = 0;
    for (const r of this.__listeners.slice()) {
      if (r.type !== type) continue;
      r.fn(ev); n += 1;
    }
    return n;
  },
};
// navigator 在 Node 24 里只有 getter，必须用 defineProperty 覆盖
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userActivation: { hasBeenActive: false } },
    configurable: true, writable: true,
  });
} catch { /* 代码里对 navigator 有 try/catch 保护，拿不到也能继续 */ }
globalThis.AudioContext = function () {
  return {
    state: 'running', destination: {}, currentTime: 0,
    createGain: () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
    createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {}, disconnect() {} }),
    createBufferSource: () => ({ buffer: null, connect() {}, start() {}, stop() {}, disconnect() {} }),
    decodeAudioData: () => Promise.resolve({ duration: 1 }),
    resume: () => Promise.resolve(), close: () => Promise.resolve(),
    sampleRate: 44100,
  };
};
const observerRegistry = [];
globalThis.MutationObserver = class {
  constructor(cb) {
    this.cb = cb;
    const st = (new Error().stack || '').split('\n');
    this.stack = st.map(s => s.trim()).filter(s => s.includes('client-under-test'))[0] || st[2] || '';
    observerRegistry.push(this);
  }
  observe(target, opts) { this.target = target; this.opts = opts; }
  disconnect() { this.disconnected = true; }
  takeRecords() { return []; }
};
globalThis.window.AudioContext = globalThis.AudioContext;
globalThis.DOMParser = class { parseFromString() { return { body: { childNodes: [] } }; } };

/* rAF 桩：只执行【有限次】回调。
   目的：让街机游戏循环真的跑几帧（抓运行时错误），又不会无限递归。 */
let rafBudget = 8;
let rafCalls = 0;
globalThis.requestAnimationFrame = (cb) => {
  rafCalls++;
  if (rafBudget-- > 0) {
    try { cb(); } catch (e) { problems.push('rAF 回调 :: ' + (e && e.message ? e.message : e)); }
  }
  return rafCalls;
};
globalThis.cancelAnimationFrame = () => {};

/* 【可控的"运行中"标记】——这是模拟"模型是否正在输出"的唯一开关。
   注意：只有在"响应式系统是否运行到 markSendState"这一点上，
   这里与真实环境不同（真实环境由插件的 runProbes 维护该属性），
   但【音效只关心这个属性变没变】，所以用来验证音效链路是充分的。 */
globalThis.__phStop = false;
globalThis.document.querySelector = (sel) => (String(sel).includes('data-phosphor-stop') && globalThis.__phStop ? elStub() : null);

const requireStub = (name) => {
  if (name === 'react') return React;
  if (name === 'react-dom') return { createPortal: (x) => x };
  throw new Error('未预期的 require: ' + name);
};

/* ── 把 client.js 落盘成 .mjs 再动态 import ─────────────────────────────────
   为什么不用 eval：client.js 是模块形态（顶层有严格语义），
   而且 eval 会让出错行号失真、也没法处理顶层 await。 */
const tmpDir = mkdtempSync(join(tmpdir(), 'ph-check-'));
const tmpFile = join(tmpDir, 'client-under-test.mjs');
writeFileSync(tmpFile, src, 'utf8');
let evaluated = false;
try {
  await import(pathToFileURL(tmpFile).href);
  evaluated = true;
} catch (e) { fail('client.js 顶层求值', e); }
console.log('  顶层求值  : ' + (evaluated ? 'OK' : 'FAIL'));

/* ── 执行 factory ─────────────────────────────────────────────────────────── */
let mod = null;
if (typeof factoryFn === 'function') {
  try { mod = factoryFn(requireStub); }
  catch (e) { fail('factory() 执行', e); }
} else {
  fail('module loader', 'load() 未被调用（顶层求值阶段就失败了？）');
}

console.log('  语法/加载 : ' + (mod ? 'OK' : 'FAIL'));
if (mod) {
  console.log('  inject    : ' + JSON.stringify(mod.inject));
}
if (problems.length) {
  console.log('--- 加载阶段的错误 ---');
  for (const p of problems) console.log('  ★ ' + p);
}
if (!mod || typeof mod.apply !== 'function') {
  console.log('未能取得 apply，后续检查跳过');
  process.exit(problems.length ? 1 : 0);   // 见下方"提前退出会导致汇总缺失"的说明
}

/* ── ctx 桩 ───────────────────────────────────────────────────────────────── */
const registered = [];           // 收集 slot 注册
const localeDicts = [];
const disposeFns = [];
const fakeSnap = { active: 'zh', locales: [], revision: 1 };
const swallowed = [];
/* 单例 locale 桩：所有 apply 调用共享同一个闭包，才能验证"重复注册被挡住"。 */
const sharedLocale = {
  register: (ns, loc, dict) => { localeDicts.push([ns, loc, dict]); return () => {}; },
  bind: () => (k2) => k2,
  getSnapshot: () => fakeSnap,
  subscribe: () => () => {},
};
const ctx = {
  effect: (fn) => { try { fn(); } catch (e) { swallowed.push(e); } return () => {}; },
  /* 【locale 必须是单例】——这是"重复 apply"检查能否有效的关键。
     第一版把它写在 get 的返回值里，而我的 Proxy 对未知成员每次返回【新的】
      spy 对象，于是两次 apply 拿到的是两个不同的 locale 闭包，
      localeDicts 各记一份、都只记 2 条 —— 检查看起来通过，其实什么都没测。
     真实宿主里 locale 服务是单例，所以这里也必须预定义一个对象。 */
  get: (k) => (k === 'locale' ? sharedLocale : undefined),
  on: () => () => {},
  inject: (deps, fn) => { if (typeof fn === 'function') { try { fn(ctx); } catch (e) { fail('ctx.inject 回调', e); } } return () => {}; },
  slots: {
    register: (opts, comp) => { registered.push({ opts, comp }); return () => {}; },
    inject: (name, fn) => { if (typeof fn === 'function') { try { fn(); } catch (e) { fail('slots.inject ' + name, e); } } return () => {}; },
    installLocale: () => () => {},
  },
  theme: {
    getTheme: () => ({ preference: 'dark', fontSize: 14, active: {}, themes: [], revision: 1 }),
    overrideTokens: (src2, tok) => { disposeFns.push(src2); return () => {}; },
    register: () => () => {},
  },
  remote: {
    account: { getBalance: () => Promise.resolve({ value: { value: [{ balance: 43.82, currency: 'CNY' }] } }) },
  },
  locale: undefined,
  logger: { info() {}, warn() {}, error() {} },
};

/* 【关键：用 Proxy 兜底未知成员】
   client.js 会用到我桩里没预料的 ctx API。若那些成员是 undefined，
   调用时抛 TypeError，而 ctx.effect 的 try/catch 会把它吞掉 ——
   上一次就是 setupSounds 中途抛错但审计显示"全部通过"。
   Proxy 让未知成员变成可调用的 spy，从而让真正的错误暴露出来。 */
const ctxProxy = new Proxy(ctx, {
  get(t, k) {
    if (k in t) return t[k];
    if (typeof k === 'symbol') return undefined;
    return new Proxy(function () {}, {
      get() { return () => undefined; },
      apply() { return undefined; },
    });
  },
});

/* ── 调用 apply ───────────────────────────────────────────────────────────── */
try { mod.apply(ctxProxy); console.log('  apply()   : OK'); }
catch (e) { fail('apply(ctx)', e); console.log('  apply()   : FAIL'); }

console.log('  slot 注册 : ' + registered.length + ' 个 → ' + registered.map(r => r.opts.id).join(', '));
console.log('  词典注册  : ' + localeDicts.length + ' 条');

/* ── 真正渲染设置面板（这一步能抓 ReferenceError） ────────────────────────── */
const panel = registered.find(r => r.opts.name === 'settings.general.item');
if (!panel) {
  fail('设置面板', '未找到 settings.general.item 注册');
} else {
  hookIdx = 0; hookState = [];
  try {
    const tree = panel.comp({ t: (k) => k });
    console.log('  面板渲染  : OK（根节点 ' + (tree && tree.type) + '，子节点 ' + (tree && tree.children ? tree.children.length : 0) + '）');
  } catch (e) { fail('设置面板渲染', e); console.log('  面板渲染  : FAIL'); }
}

/* ── 渲染其它 slot 组件 ───────────────────────────────────────────────────── */
for (const r of registered) {
  if (r.opts.name === 'settings.general.item') continue;
  hookIdx = 0; hookState = [];
  const props = {};
  if (r.opts.inject) { try { Object.assign(props, r.opts.inject()); } catch (e) { fail('slot inject ' + r.opts.id, e); } }
  props.useSession = () => ({ running: false, id: 'x' });
  props.inputActions = { send: () => {}, stop: () => {} };
  try { r.comp(props); console.log('  ' + r.opts.id + ' 渲染 : OK'); }
  catch (e) { fail(r.opts.id + ' 渲染', e); console.log('  ' + r.opts.id + ' 渲染 : FAIL'); }
}

/* ── 音效链路验证（这一段是本次审计的重点） ────────────────────────────────
   为什么必须运行到这里：音效上一次坏的正是"观察者被合并进别人的早退分支"，
   那是【接线】问题，静态判据看不出来。这里手动驱动"闲→忙→闲"，
   检查音效的状态机确实跟着走。
   判据：syncSoundRunState 的效果是 contentTyping / soundWasRunning 的变化，
   它们不对外暴露，所以这里用【观察者回调是否被注册、触发时是否抛错】来验证。 */
console.log('');
console.log('--- 音效链路 ---');
console.log('  effect 内被吞的异常 : ' + swallowed.length + (swallowed.length ? '  ★' : '  ✓'));
for (const e of swallowed.slice(0, 5)) console.log('      ★ ' + (e && e.stack ? e.stack.split('\n').slice(0,2).join(' | ') : String(e)));
const audioObservers = observerRegistry.filter(o => typeof o.cb === 'function');
// 【断言必须按"配置"核对，不能按"总数"】
// 第一版写"应为 7"，那其实是【文件里 new MutationObserver 的出现次数】——
// 其中 3 个是拿到发送键/活动灯元素时才【惰性创建】的（属于别的功能）。
// 音效相关的只有 3 个，而且它们必须在 apply 期间就建好，否则音效完全不工作。
const expect = [
    { name: '回合开始/结束（音效）', f: 'stop' },
    { name: '会话切换（音效）',        f: 'class' },
    { name: '打字声（音效）',          f: 'chardata' },
];
for (const ex of expect) {
    const hit = audioObservers.find(o => {
        const oo = o.opts || {};
        if (ex.f === 'stop') return Array.isArray(oo.attributeFilter) && oo.attributeFilter.indexOf('data-phosphor-stop') >= 0;
        if (ex.f === 'class') return Array.isArray(oo.attributeFilter) && oo.attributeFilter.indexOf('class') >= 0;
        return oo.characterData === true;
    });
    if (!hit) fail('音效观察者缺失', ex.name);
    console.log('  ' + (hit ? 'OK   ' : '★    ') + ex.name);
}
const probe = audioObservers.find(o => {
    const oo = o.opts || {};
    return oo.childList === true && oo.subtree === true && !oo.attributeFilter && oo.characterData !== true;
});
if (!probe) fail('探针观察者缺失', 'markSendState 的驱动者');
console.log('  ' + (probe ? 'OK   ' : '★    ') + '探针（markSendState 的驱动者）');


/* ── 分支路径覆盖 ────────────────────────────────────────────────────────────
   只跑"默认全开"这一条路径是不够的：本插件历史上多个 bug 都藏在
   【非默认路径】上（关掉音效再打开、重复 apply、总闸关闭）。
   这里用 __phosphorPrefs 依次切换并重新驱动一遍，任一分支抛错都算失败。
   注意：setPref 会广播给已注册的 listeners，所以这等价于"用户改了设置面板"。 */
console.log('');
console.log('--- 分支路径 ---');
const prefApi = globalThis.window.__phosphorPrefs;
if (!prefApi) {
    fail('调试出口', '__phosphorPrefs 未挂到 window，无法覆盖分支路径');
} else {
    const cases = [
        ['总闸关闭',       { enabled: false }],
        ['总闸开 + 音效全关', { enabled: true, startReset: false, startType: false, soundEnd: false, sessionSound: false, endReset: false }],
        ['只留会话音',     { sessionSound: true }],
        ['只留打字音',     { startType: true, soundEnd: false }],
        ['恢复全开',       { enabled: true, startReset: true, startType: true, soundEnd: true, sessionSound: true, endReset: true }],
    ];
    for (const [name, patch] of cases) {
        const before2 = problems.length;
        try {
            for (const [k, v] of Object.entries(patch)) prefApi.set(k, v);
        } catch (e) { fail('分支 ' + name, e); }
        const bad = problems.length - before2;
        console.log('  ' + (bad === 0 ? 'OK   ' : '★    ') + name);
    }
}

/* ── 重复 apply（模拟 HMR 重载） ─────────────────────────────────────────────
   这是 locale 重复注册 bug 的来源：宿主 HMR 会再调一次 apply。
   判据：第二次 apply 不应抛错（locale 注册被 window 标记挡住）。
   同时清理第一次注册的观察者，避免累积（真实 HMR 里旧模块的 return 也会跑）。 */
console.log('');
console.log('--- 重复 apply（HMR 重载模拟） ---');
try {
    mod.apply(ctxProxy);
    console.log('  OK   第二次 apply 未抛错');
} catch (e) {
    fail('第二次 apply', e);
    console.log('  ★    第二次 apply 抛错');
}
const dictsAfter = localeDicts.length;
console.log('  词典注册累计 : ' + dictsAfter + (dictsAfter === 2 ? '（未重复注册）✓' : '  ★ 期望 2'));
if (dictsAfter !== 2) fail('词典重复注册', '期望 2 条，实际 ' + dictsAfter);
/* ── 街机彩蛋（PACKET） ─────────────────────────────────────────────────────
   为什么单独测它：街机是一个新的独立 slot 组件，如果它写错了，
   之前的检查【一条都不会报警】—— 它不属于设置面板、也不属于音效链路。
   验证三件事：
     ① 关闭时不渲染任何东西
     ② 打开后能渲染
     ③ 游戏循环能真的跑几帧（用上面有预算的 rAF 桩 + 假时钟推进，
        让 boot 阶段过去、真正走到 arcadeStep） */
console.log('');
console.log('--- 街机彩蛋 ---');
const arcadeEntry = registered.find(r => r.opts.id === 'phosphor-arcade');
if (!arcadeEntry) {
  fail('街机 slot', '未注册 phosphor-arcade');
  console.log('  ★    未注册');
} else {
  const arcadeApi = globalThis.window.__phosphorArcade;
  if (!arcadeApi) {
    fail('街机开关', '__phosphorArcade 未暴露（DEBUG_ON 没开？）');
    console.log('  ★    开关未暴露');
  } else {
    /* ① 关闭态 */
    hookIdx = 0; hookState = []; effectQueue = [];
    let closedTree = 'ERR';
    try { closedTree = arcadeEntry.comp({}); } catch (e) { fail('街机渲染（关闭态）', e); }
    const okClosed = (closedTree === null);
    console.log('  ' + (okClosed ? 'OK   ' : '★    ') + '关闭时不渲染');
    if (!okClosed) fail('街机关闭态', '应返回 null，实际 ' + typeof closedTree);

    /* ② 打开态 */
    arcadeApi.open(true);
    hookIdx = 0; hookState = []; effectQueue = [];
    let openedTree = null;
    try { openedTree = arcadeEntry.comp({}); } catch (e) { fail('街机渲染（打开态）', e); }

    if (!openedTree || typeof openedTree.type !== 'function') {
      console.log('  ★    打开后未渲染');
      fail('街机打开态', '没有拿到 ArcadeGame');
    } else {
      const Game = openedTree.type;
      /* ③ 假时钟：每次 now() 前进 400ms，让 boot(700ms) 迅速过去，
         这样循环会真的走到 arcadeStep，而不是一直停在开店画面上。 */
      const realNow = performance.now.bind(performance);
      let fakeT = 0;
      try {
        Object.defineProperty(performance, 'now', { value: () => (fakeT += 400), configurable: true });
      } catch { /* 拿不到就按真实时间走 */ }

      hookIdx = 0; hookState = []; effectQueue = [];
      const before3 = problems.length;
      let gameTree = null;
      try { gameTree = Game({}); } catch (e) { fail('街机游戏组件', e); }

      /* 跑 effect：其中会启动 rAF 循环 */
      const q = effectQueue; effectQueue = [];
      for (const fn of q) {
        let cleanup; try { cleanup = fn(); } catch (e) { fail('街机 effect', e); }
        if (typeof cleanup === 'function') effectCleanups.push(cleanup);
      }
      /* 【真的按几个键】—— 处理器里若引用了作用域外的名字，
         只渲染发现不了，按一下才抛。修 SPACE 时差点留下这个坑：
         计数器写在 effect 里、处理器却在组件体里（严格模式下赋值会抛）。
         放在 cleanup 之前，因为监听器在 cleanup 时会被摘掉。 */
      if (globalThis.document.__listeners) {
        let keyErr = null;
        let dispatched = 0;
        for (const key of ['ArrowUp', ' ', 'Enter', 'x', 'Escape']) {
          try {
            dispatched += globalThis.document.__dispatch('keydown', {
              key, preventDefault() {}, stopPropagation() {},
            });
          } catch (e) {
            keyErr = key + ' :: ' + (e && e.message ? e.message : String(e));
            break;
          }
        }
        /* 【防空转】派发了 0 次也"没抛错" —— 那这个测试等于没测。
           监听器必须真的挂在 document 上，这里要求至少命中 5 次。 */
        const okKeys = !keyErr && dispatched >= 5;
        console.log('  ' + (okKeys ? 'OK   ' : '★    ')
          + '街机键盘处理器可执行（派发 ' + dispatched + ' 次 / 5 个键）');
        if (keyErr) fail('街机键盘处理器', keyErr);
        else if (dispatched < 5) fail('街机键盘监听', '只派发到 ' + dispatched + ' 个监听器');
        if (keyErr) fail('街机键盘处理器', keyErr);
      }

      /* 取消循环（模拟关闭）—— 顺便验证 cleanup 不抛错 */
      for (const c of effectCleanups) { try { c(); } catch (e) { fail('街机 cleanup', e); } }
      effectCleanups.length = 0;

      try { Object.defineProperty(performance, 'now', { value: realNow, configurable: true }); } catch { /* noop */ }

      const bad3 = problems.length - before3;
      console.log('  ' + (bad3 === 0 ? 'OK   ' : '★    ') + '渲染 + 循环跑 ' + rafCalls + ' 帧 + cleanup');

      const kids = (gameTree && gameTree.children) || [];
      const hasScreen = kids.some((c) => c && c.props && c.props.className === 'ph-arcade__screen');
      console.log('  ' + (hasScreen ? 'OK   ' : '★    ') + '游戏场 <pre> 存在');
      if (!hasScreen) fail('街机结构', '缺少 .ph-arcade__screen');
    }
    arcadeApi.open(false);   /* 复位 */
  }
}
/* ── 街机：玩到死 → 重开（端到端）──────────────────────────────────────────
   为什么单独做这一节：重启失效这个问题，光读代码已经判过三次都是"逻辑没问题"，
   而用户实测三次都失败。所以这里用假时钟把蛇真的撞死在墙上，再验证：
     phase: boot → play → over（撞死）→ 按键重开 → boot
   同一个测试也保护了"相位机"本身：以后谁改了 arcadeFresh / arcadeStep
   的相位语义，这里会立刻失败。 */
console.log('');
console.log('--- 街机重启（端到端）---');
{
  const api = globalThis.window.__phosphorArcade;
  const entry = registered.find((r) => r.opts.id === 'phosphor-arcade');
  const stateOf = api && typeof api.state === 'function' ? api.state : null;
  if (!entry || !stateOf) {
    fail('街机端到端', '缺少 arcade slot 或 state 出口');
    console.log('  ★    缺少入口');
  } else {
    api.open(true);
    hookIdx = 0; hookState = []; effectQueue = [];
    let tree = null;
    try { tree = entry.comp({}); } catch (e) { fail('端到端渲染', e); }
    const Game = tree && tree.type;
    hookIdx = 0; hookState = []; effectQueue = [];
    const realNow = performance.now.bind(performance);
    let fakeT = 0;
    try {
      Object.defineProperty(performance, 'now', { value: () => (fakeT += 400), configurable: true });
    } catch { /* noop */ }
    /* 预算必须够：boot 约 2070ms（6 帧），之后蛇一路向右约 24 步（6 帧）才撞墙 */
    rafBudget = 60; rafCalls = 0;
    const cleanups = [];
    let gameTree = null;
    try { gameTree = (typeof Game === 'function') ? Game({}) : null; } catch (e) { fail('端到端游戏组件', e); }
    const q = effectQueue; effectQueue = [];
    for (const fn of q) {
      let cl; try { cl = fn(); } catch (e) { fail('端到端 effect', e); }
      if (typeof cl === 'function') cleanups.push(cl);
    }
    const st1 = stateOf();
    const okOver = !!(st1 && st1.phase === 'over');
    console.log('  ' + (okOver ? 'OK   ' : '★    ') + '跑到结束（phase=' + (st1 && st1.phase) + '，score=' + (st1 && st1.score) + '）');
    if (!okOver) fail('端到端', '推帧后没有进入 over，实际 ' + (st1 && st1.phase));

    /* 按键重开：空格 */
    try {
      globalThis.document.__dispatch('keydown', {
        key: ' ', preventDefault() {}, stopPropagation() {},
      });
    } catch (e) { fail('端到端按键', e); }
    const st2 = stateOf();
    const okRestart = !!(st2 && st2.phase === 'boot' && st2.score === 0);
    console.log('  ' + (okRestart ? 'OK   ' : '★    ') + '空格重开 → phase=' + (st2 && st2.phase) + '，score=' + (st2 && st2.score));
    if (!okRestart) fail('端到端重开', '空格没有把状态改回 boot（实际 ' + (st2 && st2.phase) + '）');

    /* new record：刚才那一局拿过分，而初始最高分是 0，所以必然刷新纪录 */
    const fm = () => (globalThis.window.__phosphorPrefs.get().found || {});
    console.log('  ' + (fm().record ? 'OK   ' : '★    ') + 'new record（破纪录）');
    if (!fm().record) fail('成就 record', '没记录');

    /* konami：真的按一遍 ↑↑↓↓←→←→ */
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
                       'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight']) {
      try {
        globalThis.document.__dispatch('keydown', { key, preventDefault() {}, stopPropagation() {} });
      } catch (e) { fail('konami 派发', e); }
    }
    console.log('  ' + (fm().konami ? 'OK   ' : '★    ') + 'konami code（8 键序列）');
    if (!fm().konami) fail('成就 konami', '按完 8 键没记录');

    /* 点击重开：再跑一次到 over，然后派发一次 document 点击 */
    for (const cl of cleanups) { try { cl(); } catch { /* noop */ } }
    try { Object.defineProperty(performance, 'now', { value: realNow, configurable: true }); } catch { /* noop */ }
    api.open(false);
  }
}

/* ── LAB（隐藏实验室）与电源效果 ─────────────────────────────────────────────
   LAB 默认收起 —— 这是它的设计前提（没人发现时面板零变化）。
   所以这里必须验证两件事：收起时确实没有多出内容，展开时确实多出两行。
   电源效果验证的是"平时不渲染"（它只在总闸跳变的那一刻出现）。 */
console.log('');
console.log('--- LAB 与电源效果 ---');

function hasClassIn(node, cls) {
  if (!node || typeof node !== 'object') return false;
  if (node.props && node.props.className === cls) return true;
  const kids = node.children || [];
  for (const kid of kids) {
    if (Array.isArray(kid)) {
      for (const k2 of kid) { if (hasClassIn(k2, cls)) return true; }
    } else if (hasClassIn(kid, cls)) return true;
  }
  return false;
}

const labApi = globalThis.window.__phosphorPrefs;
if (!labApi || !panel) {
  fail('LAB', '缺少 __phosphorPrefs 或面板');
  console.log('  ★    前置缺失');
} else {
  /* ① 收起时：不应出现 ph-lab */
  labApi.set('labOpen', false);
  hookIdx = 0; hookState = []; effectQueue = [];
  let closedTree = null;
  try { closedTree = panel.comp({ t: (k) => k }); } catch (e) { fail('LAB 收起态渲染', e); }
  const hasClosed = hasClassIn(closedTree, 'ph-lab');
  console.log('  ' + (hasClosed ? '★    ' : 'OK   ') + 'LAB 默认收起（无 ph-lab 节点）');
  if (hasClosed) fail('LAB 默认态', '收起时仍渲染了 ph-lab');

  /* ② 展开时：应出现 ph-lab，且多出两行（powerFx / eggs） */
  labApi.set('labOpen', true);
  hookIdx = 0; hookState = []; effectQueue = [];
  let openTree = null;
  try { openTree = panel.comp({ t: (k) => k }); } catch (e) { fail('LAB 展开态渲染', e); }
  const hasOpen = hasClassIn(openTree, 'ph-lab');
  console.log('  ' + (hasOpen ? 'OK   ' : '★    ') + 'LAB 展开后渲染出 ph-lab');
  if (!hasOpen) fail('LAB 展开态', '没渲染出 ph-lab');

  /* 磷光色三档按钮必须在 LAB 里【真的渲染出来】—— 只检查源码里有字符串
     是不够的（那正是我之前连错四次的那类假阳性）。 */
  const hasSeg = hasClassIn(openTree, 'ph-seg');
  console.log('  ' + (hasSeg ? 'OK   ' : '★    ') + 'LAB 内含磷光色分段控件');
  if (!hasSeg) fail('磷光色控件', 'LAB 展开后没有 ph-seg');

  /* 系统日志必须在 LAB 里真的渲染出来 */
  const hasLog = hasClassIn(openTree, 'ph-log');
  console.log('  ' + (hasLog ? 'OK   ' : '★    ') + 'LAB 内含 SYSTEM LOG');
  if (!hasLog) fail('系统日志', 'LAB 展开后没有 ph-log');

  /* 已解锁条目要显示原文，未解锁要显示实心块而不是 ??? */
  const logText = JSON.stringify(openTree);
  const okLocked = logText.indexOf('\\\\u2588') >= 0 || logText.indexOf('█') >= 0;
  console.log('  ' + (okLocked ? 'OK   ' : '★    ') + '未解锁条目渲染为实心块');
  if (!okLocked) fail('系统日志红块', '未找到实心块字符');

  /* ③ 电源层：正常情况下不应存在（只在总闸跳变时出现） */
  const pfxEntry = registered.find((r) => r.opts.id === 'phosphor-powerfx');
  if (!pfxEntry) {
    fail('电源 slot', '未注册 phosphor-powerfx');
    console.log('  ★    未注册');
  } else {
    const pfxApi = globalThis.window.__phosphorPowerFx;
    if (!pfxApi) {
      fail('电源出口', '__phosphorPowerFx 未暴露');
      console.log('  ★    出口未暴露');
    } else {
      /* ① 清除后应为空 */
      pfxApi.clear();
      hookIdx = 0; hookState = []; effectQueue = [];
      let t1 = 'ERR';
      try { t1 = pfxEntry.comp({}); } catch (e) { fail('电源组件（空态）', e); }
      const okEmpty = (t1 === null);
      console.log('  ' + (okEmpty ? 'OK   ' : '★    ') + '电源层：清除后不渲染');
      if (!okEmpty) fail('电源层空态', '应返回 null');

      /* ② 播放时应有节点，且类名带 phase */
      pfxApi.play('off');
      hookIdx = 0; hookState = []; effectQueue = [];
      let t2 = null;
      try { t2 = pfxEntry.comp({}); } catch (e) { fail('电源组件（播放态）', e); }
      const cls2 = (t2 && t2.props && t2.props.className) || '';
      const okPlay = cls2.indexOf('ph-power') >= 0 && cls2.indexOf('ph-power--off') >= 0;
      console.log('  ' + (okPlay ? 'OK   ' : '★    ') + '电源层：播放时渲染（' + cls2 + '）');
      if (!okPlay) fail('电源层播放态', '类名不对: ' + cls2);

      /* ③ 复位，避免影响后续 */
      pfxApi.clear();
    }
  }

  labApi.set('labOpen', false);   /* 复位，避免影响后续 */
}
/* ── 磷光色 P1 / P3 / P4 ─────────────────────────────────────────────────────
   两个必须验证的点：
     ① P1 必须是【恒等变换】—— 这是"这个功能不可能把现状改坏"的保证。
     ② P3/P4 的文字色在黑底上仍然可读 —— 颜色功能最坏的结果是
        "看着挺酷但字看不清"，所以直接算 WCAG 对比度，不靠肉眼判断。 */
console.log('');
console.log('--- 磷光色 ---');
const toneApi = globalThis.window.__phosphorTone;
if (!toneApi) {
  fail('磷光色出口', '__phosphorTone 未暴露');
  console.log('  ★    出口未暴露');
} else {
  /* ① P1 恒等 */
  const probe = ['#00ff9c', '#00d977', '#12a35f', '#10352a', '#ff4d4d', '#ffb000', '#04070a'];
  const bad = probe.filter((h) => toneApi.hex(h, 'p1') !== h);
  console.log('  ' + (bad.length === 0 ? 'OK   ' : '★    ') + 'P1 是恒等变换（' + probe.length + ' 个颜色原样返回）');
  if (bad.length) fail('P1 恒等', '被改动: ' + bad.join(','));

  /* ② P3 / P4 的可读性：算 WCAG 对比度 */
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a, b) => {
    const la = lum(a); const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const bg = '#04070a';
  const samples = [
    ['brand-primary', '#00ff9c'],
    ['label-primary', '#00d977'],
    ['label-secondary', '#12a35f'],
    ['label-tertiary', '#1d9e68'],
  ];
  const rows = [];
  for (const tone of ['p1', 'p3', 'p4']) {
    const cells = samples.map(([name, hex]) => {
      const t = toneApi.hex(hex, tone);
      return t + ' (' + ratio(t, bg).toFixed(1) + ':1)';
    });
    rows.push('    ' + tone + '  ' + cells.join('   '));
  }
  console.log('  三种色调的文字色与黑底对比度:');
  for (const r of rows) console.log(r);

  /* label-primary 是最常用的正文色：低于 4.5:1 就算不合格 */
  for (const tone of ['p1', 'p3', 'p4']) {
    const t = toneApi.hex('#00d977', tone);
    const cr = ratio(t, bg);
    const ok = cr >= 4.5;
    console.log('  ' + (ok ? 'OK   ' : '★    ') + tone + ' 正文色 ' + t + ' 对比度 ' + cr.toFixed(2) + ':1（需 ≥4.5）');
    if (!ok) fail('磷光色可读性', tone + ' 正文色对比度不足: ' + cr.toFixed(2));
  }
}
/* ── 状态型成就（判定"现在是什么"，所以必然可达）────────────────────────────
   上一轮那两条死条目的教训：能触发靠的不是"代码里写了 markFound"，
   而是"条件成立时那个分支一定会被执行"。状态型天生满足这一点。 */
console.log('');
console.log('--- 状态型成就 ---');
{
  const pref = globalThis.window.__phosphorPrefs;
  const fm = () => (pref.get().found || {});
  const DECOR = ['glow', 'scan', 'crt', 'boot', 'ascii', 'glitch'];
  const SOUND = ['startReset', 'startType', 'soundEnd', 'sessionSound', 'endReset'];

  for (const k of DECOR) pref.set(k, false);
  console.log('  ' + (fm().bare ? 'OK   ' : '★    ') + 'effects: none（六个装饰全关）');
  if (!fm().bare) fail('状态型 bare', '未记录');
  for (const k of DECOR) pref.set(k, true);

  for (const k of SOUND) pref.set(k, false);
  console.log('  ' + (fm().silence ? 'OK   ' : '★    ') + 'silence（五条音效全关）');
  if (!fm().silence) fail('状态型 silence', '未记录');
  for (const k of SOUND) pref.set(k, true);
}

/* ── 汇总（必须在所有检查之后） ──────────────────────────────────────────────
   这里曾经把汇总写在音效检查【之前】，结果 process.exit 让音效检查整段没跑，
   而输出还显示"全部通过"—— 一次典型的"自检本身有 bug"。
   现在汇总固定在文件末尾。 */
console.log('');
if (problems.length === 0) {
  console.log('=========== 运行时自检全部通过 ===========');
  process.exit(0);
} else {
  console.log('=========== ' + problems.length + ' 项运行时问题 ===========');
  for (const p of problems) console.log('  ★ ' + p);
  process.exit(1);
}
