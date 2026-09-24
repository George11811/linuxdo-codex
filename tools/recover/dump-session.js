/*
 * 读取 DSH 的 session.v4.jsonl.zstd（多个 zstd frame 顺序拼接，Node 的
 * zstdDecompressSync / createZstdDecompress 都只吃第一个 frame），
 * 用「按 magic 逐 frame 解压」的方式拿到完整 JSONL 文本。
 *
 *   node tools/recover/dump-session.js <transcript.zstd> [输出文件]
 *
 * 用途：工作区里的文件被误删时，从会话记录里把当时 write/read 过的内容捞回来。
 */
"use strict";

const fs = require("fs");
const zlib = require("zlib");

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function decodeAll(buf) {
  const offsets = [];
  let i = buf.indexOf(MAGIC, 0);
  while (i >= 0) {
    offsets.push(i);
    i = buf.indexOf(MAGIC, i + 4);
  }
  const parts = [];
  let ok = 0, bad = 0;
  for (const off of offsets) {
    try {
      const out = zlib.zstdDecompressSync(buf.subarray(off));
      // 只接受能解析成 JSONL（每行一个 JSON 对象）的 frame，
      // 这样压缩数据里偶然出现的 magic 会被当成坏 frame 丢掉
      const text = out.toString("utf8");
      const firstLine = text.split("\n").find((l) => l.trim());
      if (!firstLine) continue;
      JSON.parse(firstLine);
      parts.push(text);
      ok++;
    } catch {
      bad++;
    }
  }
  return { text: parts.join(""), ok, bad, frames: offsets.length };
}

const src = process.argv[2];
const dst = process.argv[3];
if (!src) {
  console.error("用法：node tools/recover/dump-session.js <transcript.zstd> [输出文件]");
  process.exit(2);
}
const { text, ok, bad, frames } = decodeAll(fs.readFileSync(src));
console.error(`frames=${frames} decoded=${ok} skipped=${bad} chars=${text.length}`);
if (dst) fs.writeFileSync(dst, text);
else process.stdout.write(text);
