/**
 * DSH // PHOSPHOR — Host half.
 *
 * 主题的渲染全部在 Client 半边。这里只做一件 Client 做不到的事：
 * **读 skill 库**。浏览器没有文件读取接口，所以由宿主把数据递过去。
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 为什么用 HTTP 路由，而不是 @Remote                                       │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │ @Remote 是 TS 装饰器机制，纯 JS 手写等价物容易翻车。                     │
 * │ webServer.register({ kind, path, handler }) 是公开方法，签名直白：       │
 * │ 一个 Node 的 (req, res)，自己负责写响应。                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 为什么既不用 export const inject，也不用裸 ctx.get()                     │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │ export const inject 是【硬依赖】：服务缺失时插件根本不激活 ——            │
 * │ 为了一个附加面板把整个主题赔掉，不可接受。                               │
 * │ 但只用 ctx.get() 也不行：apply 阶段服务可能还没就绪，取到 undefined，    │
 * │ 整段静默跳过 —— 第一版就是这个行为，探针文件根本没生成。                 │
 * │ 正解是官方的软依赖写法 ctx.inject([...], cb)：服务就绪时回调才跑，       │
 * │ 没就绪时插件照常激活。                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 路由（宿主侧，访问需浏览器鉴权）：
 *   GET /__phosphor/skills          → 目录快照（生效 + 磁盘 + 未生效）
 *   GET /__phosphor/skills/<name>   → 单个 skill 的正文（按需）
 *
 * 临时诊断：启动阶段把每一步写进 tmpdir 的探针文件。
 * Web 载体带鉴权（/ 返回 401），shell 无法 curl 路由，开发期只能靠落盘观察。
 * UI 做好后删掉这些探针。
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '/__phosphor/skills';

/* 【为什么需要这个】
   skills.list() 的 options.scope 决定"看哪一层"。从插件的根 ctx 调用 = 全局层，
   只能看到 1 条 bundled —— 用户那 22 个 skill 在 agent 作用域的层里。
   而 agent/created 监听器的 `this` 就是【该 agent 的作用域上下文】，
   在它上面调用才会合并到那一层的链。这和人设实验里的 systemPrompt 完全同一个机制。
   这里保留最近一次捕获到的服务；设置面板是全局 UI，用最近活跃 agent 的视角即可。 */
let scopedSkills = null;
/* 取正文的调用日志（最近 20 次）。404 是我的处理器自己生成的 ——
   说明请求到了 handler，但 skills.get() 返回 undefined。
   到底为什么，只有把它看到的入参与结果记下来才知道。 */
const getLog = [];
const pushGetLog = (entry) => {
  getLog.push(entry);
  if (getLog.length > 20) getLog.shift();
  void probe('07-get-log', getLog.slice());
};
/* 作用域句柄：按 preset 缓存，插件卸载时释放 */
let scopeHandle = null;
let scopeKey = null;
let scopePresetId = null;

/* 探针写两处：
   ① 插件自己的目录（这里我们一直在写，宿主任意进程都能写）
   ② 系统临时目录
   只写 tmpdir 的话，"写失败"与"没加载"看起来一模一样 —— 上一轮就吃了这个亏。 */
const PKG_DIR = dirname(fileURLToPath(import.meta.url));
const PROBE_TARGETS = [join(PKG_DIR, '.probe'), join(tmpdir(), 'phosphor-skills-probe')];

const probe = async (step, data) => {
  const body = JSON.stringify(data, null, 2);
  for (const dir of PROBE_TARGETS) {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, step + '.json'), body, 'utf8');
    } catch { /* noop */ }
  }
};

/* 【模块顶层就写】它出现 = 模块被 import 了；它不出现 = 宿主根本没加载这个文件。
   这两件事的修法完全不同，所以必须分开观察。 */
void probe('00-module-imported', {
  at: new Date().toISOString(),
  pkgDir: PKG_DIR,
  cwd: process.cwd(),
  node: process.version,
});

/** 只认这些根：打开目录时用它做白名单，绝不接受客户端传来的任意路径 */
const knownRoots = () => ([
  { label: 'user-dsh', dir: join(homedir(), '.dsh', 'skills') },
  { label: 'project-dsh', dir: join(process.cwd(), '.dsh', 'skills') },
]);

/* 【打开目录的白名单】
   来源不是"用户传什么"，而是【我们自己枚举出来的目录】—— 每次 buildSnapshot
   把 active 与 orphans 的 dir 收进来。这样客户端只能请求确实存在于 skill 库里的
   路径，无法用它去打开任意目录（那会是一个代码执行面）。 */
const allowedDirs = new Set();

const openInFileManager = (dir) => {
  /* 跨平台：Windows 资源管理器 / macOS Finder / Linux 桌面 */
  const [cmd, args] = process.platform === 'win32'
    ? ['explorer.exe', [dir]]
    : process.platform === 'darwin'
      ? ['open', [dir]]
      : ['xdg-open', [dir]];
  /* detached + stdio:ignore：不把子进程绑在宿主生命周期上，也不接管它的输出 */
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
};

const json = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body, null, 2));
};

/** 读 SKILL.md 的 frontmatter；没有 SKILL.md 返回 null */
const readSkillMeta = async (dir) => {
  try {
    const raw = await readFile(join(dir, 'SKILL.md'), 'utf8');
    const m = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    const meta = {};
    if (m) {
      for (const line of m[1].split(/\r?\n/)) {
        const kv = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line.trim());
        if (kv) meta[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '').trim();
      }
    }
    let bytes = 0;
    try { bytes = (await stat(join(dir, 'SKILL.md'))).size; } catch { /* noop */ }
    return { name: meta.name || null, description: meta.description || '', bytes };
  } catch {
    return null;
  }
};

const scanRoot = async ({ label, dir }) => {
  const out = [];
  let names = [];
  try { names = await readdir(dir); } catch { return out; }
  for (const name of names) {
    const sub = join(dir, name);
    try { if (!(await stat(sub)).isDirectory()) continue; } catch { continue; }
    const meta = await readSkillMeta(sub);
    out.push({
      dir: sub,
      folder: name,
      source: label,
      skillMd: !!meta,
      name: meta ? meta.name : null,
      description: meta ? meta.description : '',
      bytes: meta ? meta.bytes : 0,
    });
  }
  return out;
};

export function apply(ctx) {
  /* 第 0 步就落盘：这个文件若没出现，说明宿主根本没加载这个模块。 */
  void probe('01-apply-called', {
    at: new Date().toISOString(),
    hasGet: typeof ctx.get === 'function',
    hasInject: typeof ctx.inject === 'function',
    hasEffect: typeof ctx.effect === 'function',
  });

  if (typeof ctx.inject !== 'function') {
    void probe('01-abort', { reason: 'ctx.inject 不可用' });
    return;
  }


  /* 软依赖：webServer 就绪后才注册路由；没有它时本插件照常激活。 */
  ctx.inject(['webServer'], (scoped) => {
    const webServer = (scoped && scoped.webServer)
      || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined);
    const skills = typeof ctx.get === 'function' ? ctx.get('skills') : undefined;

    void probe('02-injected', {
      at: new Date().toISOString(),
      hasWebServer: !!webServer,
      hasRegister: !!(webServer && typeof webServer.register === 'function'),
      hasSkills: !!(skills && typeof skills.list === 'function'),
    });

    if (!webServer || typeof webServer.register !== 'function') return;

    const buildSnapshot = async () => {
      /* ① 权威层：模型实际能看到的（同名遮蔽后每个名字只剩赢家） */
      let active = [];
      let activeError = null;
      /* 优先用 agent 作用域的那份服务（能看到用户层与预设层），
         退回到全局服务。usedScoped 会写进快照，便于确认到底走了哪条。 */
      const svc = scopedSkills || skills;
      const usedScoped = !!scopedSkills;
      if (svc && typeof svc.list === 'function') {
        try {
          const list = await svc.list({});
          active = (list || []).map((s) => {
            /* 【path 是 SKILL.md 文件，目录在 resourceBase】
               上一版拿 path 去和目录比，于是 22 条全被误判成"被遮蔽"。
               dirOf 统一归一化出目录，显示与对账都用它。 */
            const dir = (s.resourceBase && s.resourceBase.kind === 'directory' && s.resourceBase.path)
              ? resolve(s.resourceBase.path)
              : (s.path ? resolve(dirname(s.path)) : '');
            return {
              name: s.name,
              description: s.description || '',
              whenToUse: s.whenToUse || '',
              source: s.source || '',
              provider: s.provider || '',
              path: s.path || '',
              dir,
              resourceBase: s.resourceBase || null,
            };
          });
        } catch (e) {
          activeError = e && e.message ? e.message : String(e);
        }
      } else {
        activeError = 'skills 服务不可用';
      }

      /* ② 磁盘层：物理上存在的 */
      const roots = knownRoots();
      const onDisk = [];
      for (const r of roots) onDisk.push(...await scanRoot(r));

      /* ③ 对账：磁盘里没赢的，要么同名被遮蔽，要么压根没被加载 */
      const byName = new Map();
      for (const a of active) if (a.name) byName.set(a.name, a);
      const activeDirs = new Set(active.map((a) => a.dir).filter(Boolean));

      const orphans = [];
      for (const d of onDisk) {
        if (activeDirs.has(resolve(d.dir))) continue;
        if (!d.skillMd) orphans.push({ ...d, reason: 'no-skill-md' });
        else if (d.name && byName.has(d.name)) {
          const w = byName.get(d.name);
          orphans.push({ ...d, reason: 'shadowed', wonBy: w.source, wonByPath: w.path });
        } else if (!d.name) orphans.push({ ...d, reason: 'no-name-in-frontmatter' });
        else orphans.push({ ...d, reason: 'not-loaded' });
      }

      /* 登记白名单（每次重建，保证只包含当前真实存在的目录） */
      allowedDirs.clear();
      for (const a of active) if (a.dir) allowedDirs.add(resolve(a.dir));
      for (const o of orphans) if (o.dir) allowedDirs.add(resolve(o.dir));

      return {
        generatedAt: new Date().toISOString(),
        cwd: process.cwd(),
        roots,
        counts: { active: active.length, onDisk: onDisk.length, orphans: orphans.length },
        usedScoped,
        providers: Array.from(new Set(active.map((a) => a.provider).filter(Boolean))),
        sources: Array.from(new Set(active.map((a) => a.source).filter(Boolean))),
        activeError,
        active,
        orphans,
      };
    };

    /* ── 找到"能看到用户层"的 skills 视图 ──────────────────────────────────
       【上一版的教训】直接在监听器里读 `this.skills` 会抛
       `cannot get property "skills" without inject` —— Cordis 只允许访问
       已声明 inject 的服务。所以这里测两条官方路径，把结果写进探针，
       不再靠猜：

         A. agentPresets.serviceFor(agent, 'skills')
            文档签名：serviceFor(agent: {ctx}, name) → 该 agent 的服务实例
         B. agentPresets.composedPreset(agent.ctx) + acquireScope(id)
            → 得到 ScopeKey，再 skills.list({ scope })

       监听器必须【同步返回】：它是 serial 且被 await 的，不能让一次
       skill 发现拖慢会话创建。所以真正的探测在 IIFE 里跑。 */
    if (typeof ctx.on === 'function') {
      ctx.on('agent/created', function (payload) {
        const agent = payload && payload.agent;
        if (!agent) return;
        void (async () => {
          const out = { at: new Date().toISOString(), a: null, b: null, picked: null };
          const presets = typeof ctx.get === 'function' ? ctx.get('agentPresets') : undefined;
          const globalSkills = typeof ctx.get === 'function' ? ctx.get('skills') : undefined;

          /* A：按 agent 取服务实例 */
          try {
            if (presets && typeof presets.serviceFor === 'function') {
              const svc = presets.serviceFor(agent, 'skills');
              if (svc && typeof svc.list === 'function') {
                const list = await svc.list({});
                out.a = { ok: true, count: (list || []).length };
                if ((list || []).length > 1) { scopedSkills = svc; out.picked = 'A'; }
              } else out.a = { ok: false, why: 'no service' };
            } else out.a = { ok: false, why: 'no serviceFor' };
          } catch (e) { out.a = { ok: false, why: e && e.message ? e.message : String(e) }; }

          /* B：取 ScopeKey 再显式传 scope */
          try {
            if (presets && typeof presets.composedPreset === 'function'
                && typeof presets.acquireScope === 'function'
                && globalSkills && typeof globalSkills.list === 'function') {
              const presetId = presets.composedPreset(agent.ctx);
              out.b = { presetId: presetId || null };
              if (presetId) {
                /* 【句柄必须留着】上一版探测完就 asyncDispose，却把拿着
                   handle.key 的包装器留给后续请求用 —— 那是在用一个已释放的
                   作用域，能跑通只是侥幸。现在按 preset 缓存句柄，
                   到插件卸载时再释放。 */
                if (scopePresetId !== presetId || !scopeHandle) {
                  if (scopeHandle) { try { await scopeHandle[Symbol.asyncDispose](); } catch { /* noop */ } }
                  scopeHandle = await presets.acquireScope(presetId);
                  scopeKey = scopeHandle.key;
                  scopePresetId = presetId;
                }
                const list = await globalSkills.list({ scope: scopeKey });
                out.b.count = (list || []).length;
                if ((list || []).length > 1) {
                  scopedSkills = {
                    list: (o) => globalSkills.list({ ...(o || {}), scope: scopeKey }),
                    get: (n, o) => globalSkills.get(n, { ...(o || {}), scope: scopeKey }),
                  };
                  out.picked = 'B';
                }
              }
            } else out.b = { ok: false, why: 'presets 或 skills 不可用' };
          } catch (e) { out.b = { ok: false, why: e && e.message ? e.message : String(e) }; }

          await probe('05-scope-probe', out);
          if (scopedSkills) {
            try { await probe('06-snapshot-scoped', await buildSnapshot()); } catch { /* noop */ }
          }
        })();
      });
    }
    const disposers = [
      /* 一条 exact 路由干三件事（同一个 path 注册第二条 exact 会抛错，
         而 prefix 实测到不了 handler，所以合并）：
             GET                     → 目录快照
             GET  ?skill=<name>      → 单个正文
             POST { dir }            → 在资源管理器打开 */
      webServer.register({
        kind: 'exact',
        path: BASE,
        handler: async (req, res) => {
          try {
            /* ① POST：打开目录 */
            if (req.method === 'POST') {
              let raw = '';
              for await (const chunk of req) {
                raw += chunk;
                if (raw.length > 8192) { json(res, 413, { error: 'body too large' }); return; }
              }
              let body = null;
              try { body = JSON.parse(raw || '{}'); } catch { json(res, 400, { error: 'bad json' }); return; }
              const want = body && typeof body.dir === 'string' ? resolve(body.dir) : '';
              if (!want) { json(res, 400, { error: 'missing dir' }); return; }
              /* 白名单是这个接口唯一的安全边界：只打开我们自己枚举过的目录 */
              if (!allowedDirs.has(want)) { json(res, 403, { error: 'dir not in skill library', dir: want }); return; }
              openInFileManager(want);
              json(res, 200, { opened: want });
              return;
            }

            const url = new URL(req.url || '/', 'http://localhost');

            /* ?version=1 —— 给"复制版本信息"用。客户端知道版本号，
               但 profile 只有宿主知道（process.env.DSH_PROFILE）。 */
            if (url.searchParams.get('version') === '1') {
              json(res, 200, {
                profile: process.env.DSH_PROFILE || null,
                cwd: process.cwd(),
                platform: process.platform,
              });
              return;
            }

            const name = url.searchParams.get('skill');

            /* ② GET 无参数：目录快照 */
            if (!name) { json(res, 200, await buildSnapshot()); return; }

            /* ③ GET ?skill=<name>：单个正文 */
            const getter = scopedSkills || skills;
            if (!getter || typeof getter.get !== 'function') {
              json(res, 503, { error: 'skills 服务不可用' });
              return;
            }
            let def = null;
            let getErr = null;
            try { def = await getter.get(name, {}); }
            catch (e) { getErr = (e && e.message) ? e.message : String(e); }
            pushGetLog({
              at: new Date().toISOString(),
              name,
              usedScoped: !!scopedSkills,
              got: def ? { name: def.name, contentLen: (def.content || '').length } : null,
              err: getErr,
            });
            if (!def) {
              json(res, 404, { error: 'skill not found: ' + name, usedScoped: !!scopedSkills, getError: getErr });
              return;
            }
            json(res, 200, {
              name: def.name,
              description: def.description || '',
              whenToUse: def.whenToUse || '',
              source: def.source || '',
              path: def.path || '',
              resourceBase: def.resourceBase || null,
              content: def.content || '',
            });
          } catch (e) {
            json(res, 500, { error: e && e.message ? e.message : String(e) });
          }
        },
      }),
    ];

    void probe('03-registered', { at: new Date().toISOString(), routes: [BASE + '（快照 / ?skill= / POST open）'] });

    /* 启动时落一份快照：开发期读这个文件，而不是 curl（会 401）。 */
    void (async () => {
      try {
        await probe('04-snapshot', await buildSnapshot());
      } catch (e) {
        await probe('04-snapshot-error', { error: e && e.message ? e.message : String(e) });
      }
    })();

    return () => {
      for (const d of disposers) { try { if (typeof d === 'function') d(); } catch { /* noop */ } }
      if (scopeHandle) {
        try { void scopeHandle[Symbol.asyncDispose](); } catch { /* noop */ }
        scopeHandle = null; scopeKey = null; scopePresetId = null;
      }
    };
  });
}
