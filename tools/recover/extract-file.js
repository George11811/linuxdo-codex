/*
 * 从 dump-session.js 导出的 JSONL 会话记录里，把某个文件的完整源码捞出来。
 *
 *   node tools/recover/extract-file.js <session.jsonl> <输出路径> <必须包含的片段...>
 *
 * 做法：逐行 JSON.parse，递归遍历所有字符串值（含「字符串里套 JSON」的双重编码），
 * 收集同时包含所有指定片段的候选，取最长的一个；再用「以 // ==UserScript== 开头、
 * 以 })(); 结尾」这种完整性判据筛一遍，打印候选清单供人工核对。
 */
"use strict";

const fs = require("fs");

const [, , jsonlPath, outPath, ...needles] = process.argv;
if (!jsonlPath || !outPath || !needles.length) {
  console.error("用法：node tools/recover/extract-file.js <session.jsonl> <输出> <片段1> [片段2 ...]");
  process.exit(2);
}

const candidates = [];

function consider(str, where) {
  if (typeof str !== "string" || str.length < 500) return;
  if (!needles.every((n) => str.includes(n))) return;
  candidates.push({ len: str.length, where, str });
}

function walk(node, where, depth) {
  if (depth > 8) return;
  if (typeof node === "string") {
    consider(node, where);
    // 字符串里套着 JSON（工具参数被双重编码）时再钻一层
    const t = node.trim();
    if ((t.startsWith("{") || t.startsWith("[")) && t.length < 4_000_000) {
      try { walk(JSON.parse(node), where + ">json", depth + 1); } catch { /* 不是 JSON */ }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${where}[${i}]`, depth + 1));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`, depth + 1);
  }
}

const lines = fs.readFileSync(jsonlPath, "utf8").split("\n");
let lineNo = 0;
for (const line of lines) {
  lineNo++;
  if (!line.trim()) continue;
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  walk(obj, `L${lineNo}`, 0);
}

candidates.sort((a, b) => b.len - a.len);
console.log(`候选 ${candidates.length} 个：`);
for (const c of candidates.slice(0, 8)) {
  const complete = c.str.startsWith("// ==UserScript==") && c.str.trimEnd().endsWith("})();");
  console.log(`  len=${c.len} complete=${complete} where=${c.where}`);
  console.log("    head: " + JSON.stringify(c.str.slice(0, 60)));
  console.log("    tail: " + JSON.stringify(c.str.slice(-40)));
}

const best = candidates.find((c) => c.str.startsWith("// ==UserScript==") && c.str.trimEnd().endsWith("})();"));
if (!best) {
  console.error("没找到完整的脚本候选（缺少以 ==UserScript== 开头、以 }); 结尾的那个）");
  process.exit(1);
}
fs.writeFileSync(outPath, best.str);
console.log(`\n已写出：${outPath}（${best.len} 字符，来自 ${best.where}）`);
