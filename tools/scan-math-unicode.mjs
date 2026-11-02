/*
  scan-math-unicode.mjs —— 在 DSH 会话记录里找"进了数学模式的 Unicode 字符"

  为什么：KaTeX 会报
      Unrecognized Unicode character "①" [unknownSymbol]
      Unicode text character "、" used in math mode [unicodeTextInMathMode]
  这类警告的根因是【数学定界符 $ … $ / $$ … $$ 内部放了中文标点或圈号】——
  在数学模式里它们按字形查表，查不到就报警（并可能显示成方框/缺字）。

  这个脚本把会话记录解压后，找出所有"数学区段内含可疑字符"的位置，
  直接给出原文片段与所属工作区，省得靠猜。

  用法：node tools/scan-math-unicode.mjs [会话目录]
*/
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';

/* 默认目录【不写死用户名】：这个脚本随仓库公开，别人也要能直接用。 */
const root = process.argv[2] || join(homedir(), '.dsh', 'sessions');

// 会在数学模式里出问题的字符（引号内是 KaTeX 的报法）
const SUSPECT = [
  ['\u3001', '、', 'unicodeTextInMathMode'],
  ['\u3002', '。', 'unicodeTextInMathMode'],
  ['\uff0c', '，', 'unicodeTextInMathMode'],
  ['\uff08', '（', 'unicodeTextInMathMode'],
  ['\uff09', '）', 'unicodeTextInMathMode'],
  ['\uff1a', '：', 'unicodeTextInMathMode'],
  ['\u2460', '①', 'unknownSymbol'],
  ['\u2461', '②', 'unknownSymbol'],
  ['\u2462', '③', 'unknownSymbol'],
  ['\u2463', '④', 'unknownSymbol'],
  ['\u2464', '⑤', 'unknownSymbol'],
  ['\u2014', '—', 'unknownSymbol'],
  ['\u2192', '→', 'unknownSymbol'],
  ['\u21d2', '⇒', 'unknownSymbol'],
  ['\u2018', '‘', 'unicodeTextInMathMode'],
  ['\u2019', '’', 'unicodeTextInMathMode'],
  ['\u201c', '“', 'unicodeTextInMathMode'],
  ['\u201d', '”', 'unicodeTextInMathMode'],
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl.zstd') || e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

const files = walk(root);
console.log('扫描 ' + files.length + ' 个会话文件');
console.log('');

let totalHits = 0;
const byWorkspace = new Map();

for (const f of files) {
  let text;
  try {
    const buf = readFileSync(f);
    text = f.endsWith('.zstd')
      ? zstdDecompressSync(buf).toString('utf8')
      : buf.toString('utf8');
  } catch (e) {
    console.log('  跳过（解压失败）' + f + ' :: ' + e.message);
    continue;
  }
  // 会话里的换行在 JSON 里是 \n 转义，先还原成真实换行便于按行处理
  const unescaped = text.replace(/\\n/g, '\n').replace(/\\"/g, '"');

  // 找所有 $...$ 与 $$...$$ 区段
  const regions = [];
  const reD = /\$\$([\s\S]{0,400}?)\$\$/g;
  let m;
  while ((m = reD.exec(unescaped))) regions.push({ kind: '$$', body: m[1], at: m.index });
  // 去掉已匹配的 $$ 段，再找单 $
  const stripped = unescaped.replace(reD, (s) => ' '.repeat(s.length));
  const reS = /(?<!\$)\$([^$\n]{1,200})\$(?!\$)/g;
  while ((m = reS.exec(stripped))) regions.push({ kind: '$', body: m[1], at: m.index });

  for (const r of regions) {
    for (const [ch, disp, kind] of SUSPECT) {
      if (r.body.includes(ch)) {
        totalHits++;
        const ws = f.split('sessions\\')[1]?.split('\\')[0] || '?';
        if (!byWorkspace.has(ws)) byWorkspace.set(ws, []);
        const snippet = r.body.replace(/\s+/g, ' ').slice(0, 110);
        byWorkspace.get(ws).push({ kind, ch: disp, katex: kind, snippet, file: f });
        break; // 一个区段只报一次
      }
    }
  }
}

console.log('=== 结果 ===');
if (totalHits === 0) {
  console.log('  未发现"数学模式内含可疑字符"的情况 ✓');
} else {
  console.log('  共 ' + totalHits + ' 处');
  console.log('');
  for (const [ws, hits] of byWorkspace) {
    console.log('--- 工作区: ' + ws + '（' + hits.length + ' 处）---');
    const kinds = {};
    for (const h of hits) kinds[h.ch] = (kinds[h.ch] || 0) + 1;
    console.log('    字符分布: ' + Object.entries(kinds).map(([k, v]) => k + '×' + v).join('  '));
    for (const h of hits.slice(0, 6)) {
      console.log('    例: ' + h.kind + ' 区段含「' + h.ch + '」 → ' + h.snippet);
    }
    console.log('');
  }
}
