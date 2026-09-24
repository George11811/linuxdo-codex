/*
 * 从会话记录里按顺序取出针对某个文件的 edit 调用（file_path / old_string / new_string），
 * 供「反向还原」使用。
 *
 *   node tools/recover/list-edits.js <session.jsonl> <文件名后缀>
 */
"use strict";

const fs = require("fs");

const [, , jsonlPath, suffix] = process.argv;
if (!jsonlPath || !suffix) {
  console.error("用法：node tools/recover/list-edits.js <session.jsonl> <文件名后缀>");
  process.exit(2);
}

const edits = [];

function walk(node, where) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${where}[${i}]`));
    return;
  }
  if (node.name === "edit" && node.input && typeof node.input === "object") {
    const fp = String(node.input.file_path || "");
    if (fp.endsWith(suffix)) {
      edits.push({
        where,
        file: fp,
        old: node.input.old_string,
        new: node.input.new_string,
        replaceAll: !!node.input.replace_all
      });
    }
  }
  // 工具结果里也可能回显参数（被双重编码成字符串）
  if (node.content !== node && node.content) walk(node.content, where + ".content");
  if (node.arguments && typeof node.arguments === "string") {
    try { walk(JSON.parse(node.arguments), where + ".arguments"); } catch { /* ignore */ }
  }
  if (node.input && typeof node.input === "string") {
    try { walk(JSON.parse(node.input), where + ".input"); } catch { /* ignore */ }
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "content" || k === "arguments" || k === "input") continue;
    if (v && typeof v === "object") walk(v, `${where}.${k}`);
  }
}

const lines = fs.readFileSync(jsonlPath, "utf8").split("\n");
for (const line of lines) {
  if (!line.trim()) continue;
  let obj;
  try { obj = JSON.parse(line); } catch { continue; }
  walk(obj, "root");
}

console.log(`找到 ${edits.length} 条针对 *${suffix} 的 edit：`);
edits.forEach((e, i) => {
  console.log(
    `${String(i).padStart(3)} ${e.where} replaceAll=${e.replaceAll} ` +
    `old=${JSON.stringify((e.old || "").slice(0, 50))} new=${JSON.stringify((e.new || "").slice(0, 50))}`
  );
});
fs.writeFileSync(jsonlPath.replace(/\.jsonl$/, ".edits.json"), JSON.stringify(edits, null, 1));
console.log(`\n已写出 ${jsonlPath.replace(/\.jsonl$/, ".edits.json")}`);
