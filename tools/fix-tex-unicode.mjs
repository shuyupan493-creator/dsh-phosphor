/*
  fix-tex-unicode.mjs —— 修"中文标点/圈号进了数学模式"导致的 KaTeX 报警与缺字

  ── 症状（浏览器控制台）──
    Unrecognized Unicode character "①" (9312) [unknownSymbol]
    No character metrics for '①' in style 'Main-Regular' and mode 'text'
    Unicode text character "、" used in math mode [unicodeTextInMathMode]

  ── 根因 ──
    KaTeX 在数学模式里是【按字形查字体表】的。中文字体不在 KaTeX 的字体里，
    所以数学模式内的中文标点、圈号（①②③④）会：
      · 报警告（strict: warn）
      · 显示成缺字方块，或宽度/位置错乱
    即使包在 \text{} 里，【全角标点】仍会触发 unicodeTextInMathMode。

  ── 修法（本脚本只做"等价替换"，不改数学含义）──
    ① 数学区段内 \text{…} 里的【全角标点】→ 半角等价物
       （， → ,   。 → .   （） → ()   ： → :   、 → ,  ）
       —— 这些字符在 \text{} 里是纯文本，换成半角不会改变可读性，
          且半角 ASCII 一定有字形。
    ② \tag{①} → \tag{1}（圈号 → 数字）
       —— \tag 的参数会进 text 模式的字体表，圈号没有字形。
          用数字编号最稳，且与正文"①②③"的引用关系不受影响（正文里的圈号是普通文本）。
    ③ 报告"数学区段里裸的中文"（未包 \text{}）—— 这类【不自动改】，
       因为改动会影响语义与排版，必须人工判断该不该包 \text{}。

  用法：
    node tools/fix-tex-unicode.mjs <文件.md>            # 干跑，只报告
    node tools/fix-tex-unicode.mjs <文件.md> --write    # 写入（自动备份 .bak）
*/
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const file = process.argv[2];
const doWrite = process.argv.includes('--write');
if (!file || !existsSync(file)) {
  console.error('用法: node tools/fix-tex-unicode.mjs <文件.md> [--write]');
  process.exit(2);
}

// 全角 → 半角（只用于 \text{} 内部）
const FULLWIDTH = [
  ['，', ','], ['。', '.'], ['（', '('], ['）', ')'], ['：', ':'],
  ['；', ';'], ['、', ','], ['！', '!'], ['？', '?'],
  ['“', '"'], ['”', '"'], ['‘', "'"], ['’', "'"],
  ['【', '['], ['】', ']'], ['《', '<'], ['》', '>'],
];
const CIRCLED = [['①', '1'], ['②', '2'], ['③', '3'], ['④', '4'], ['⑤', '5'],
                 ['⑥', '6'], ['⑦', '7'], ['⑧', '8'], ['⑨', '9'], ['⑩', '10']];
// 数学区段里"裸着的"中文（不在 \text{} 里）
const CJK = /[\u4e00-\u9fa5]/;

const original = readFileSync(file, 'utf8');
let text = original;
const report = { tagFixed: 0, textPunctFixed: 0, bareCjk: [] };

/* ── ① \tag{…} 里的圈号 → 数字 ─────────────────────────────────────────────── */
text = text.replace(/\\tag\*?\{([^}]*)\}/g, (whole, arg) => {
  let fixed = arg;
  for (const [c, d] of CIRCLED) fixed = fixed.split(c).join(d);
  if (fixed !== arg) { report.tagFixed++; return whole.replace(arg, fixed); }
  return whole;
});

/* ── ② \text{…} 里的全角标点 → 半角 ────────────────────────────────────────── */
text = text.replace(/\\text\{([^{}]*)\}/g, (whole, arg) => {
  let fixed = arg;
  for (const [c, d] of FULLWIDTH) fixed = fixed.split(c).join(d);
  if (fixed !== arg) { report.textPunctFixed++; return '\\text{' + fixed + '}'; }
  return whole;
});

/* ── ③ 报告：数学区段里裸的中文 ────────────────────────────────────────────── */
function scanMathRegions(src, cb) {
  const reD = /\$\$([\s\S]{0,600}?)\$\$/g;
  let m;
  while ((m = reD.exec(src))) cb('$$', m[1], m.index);
  const stripped = src.replace(reD, (s) => ' '.repeat(s.length));
  const reS = /(?<!\$)\$([^$\n]{1,300})\$(?!\$)/g;
  while ((m = reS.exec(stripped))) cb('$', m[1], m.index);
}
scanMathRegions(text, (kind, body, at) => {
  // 去掉所有 \text{…} 后再看是否还有中文 —— 剩下的就是"裸中文"
  const withoutText = body.replace(/\\text\{[^{}]*\}/g, '');
  if (CJK.test(withoutText)) {
    report.bareCjk.push({ kind, at, snippet: body.replace(/\s+/g, ' ').slice(0, 120) });
  }
});

/* ── 报告 ─────────────────────────────────────────────────────────────────── */
console.log('文件: ' + file + '  (' + original.length + ' 字符)');
console.log('');
console.log('  ① \\tag{} 内圈号 → 数字        : ' + report.tagFixed + ' 处');
console.log('  ② \\text{} 内全角标点 → 半角   : ' + report.textPunctFixed + ' 处');
console.log('  ③ 数学区段内【裸中文】(需人工) : ' + report.bareCjk.length + ' 处');
if (report.bareCjk.length) {
  console.log('');
  const kinds = {};
  for (const h of report.bareCjk) {
    const chs = h.snippet.match(/[\u4e00-\u9fa5]/g) || [];
    for (const c of chs) kinds[c] = (kinds[c] || 0) + 1;
  }
  console.log('      常见字: ' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + '×' + v).join(' '));
  console.log('      示例:');
  for (const h of report.bareCjk.slice(0, 5)) console.log('        [' + h.kind + '] ' + h.snippet);
  console.log('');
  console.log('      这类【不自动改】—— 该包 \\text{} 还是改用符号，取决于语义。');
}

if (!doWrite) {
  console.log('');
  console.log('（干跑，未写入。加 --write 应用 ①② 两类替换。）');
  process.exit(0);
}

if (text === original) {
  console.log('');
  console.log('无需改动，未写入。');
  process.exit(0);
}
copyFileSync(file, file + '.bak');
writeFileSync(file, text, 'utf8');
console.log('');
console.log('已写入（备份 ' + file.split(/[\\/]/).pop() + '.bak）');
