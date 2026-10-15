/*
 * 冒烟测试第四阶段：**整页就是 Cloudflare 挑战中间页**（标题 "Just a moment..."，
 * #challenge-running / #challenge-form / turnstile 字段都在）。userscript 的
 * @match 依然会命中，所以脚本确实会在这页上跑 —— 它必须彻底安静：
 *
 *   1. 不注入样式、不加 ROOT_CLASS、不画 rail / 主区；
 *   2. 不改伪装标题（挑战页的标题是 CF 的，改了既没用又误导）；
 *   3. 不换 favicon；
 *   4. 一个 API 请求都不发（含阅读进度上报那类后台请求）。
 *
 * run.js 在导航过来之前会 reset 计数。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const stats = async () => (await (await fetch("/__ctl/stats")).json());

const before = await stats();
await sleep(2500); // 等过 startCfWatcher 的第一个 1.5s 轮询
const after = await stats();

/* 只统计脚本自己的 API 请求：/__ctl/* 是本探针自己的流量，静态资源不算 */
const apiDelta = (a, b) => Object.entries(b.counts)
  .filter(([k]) => k.endsWith(".json") && !k.startsWith("/__ctl"))
  .reduce((sum, [k]) => sum + Math.max(0, b.counts[k] - (a.counts[k] || 0)), 0);

ok("挑战页上没加激活标记", !document.documentElement.classList.contains("codex-theme"),
  document.documentElement.className);
ok("挑战页上没画 rail / 主区", !q(".codex-rail") && !q(".codex-main"));
ok("挑战页上没注入自己的样式表", !document.getElementById("linuxdo-codex-theme"));
ok("挑战页标题没被改写", /just a moment/i.test(document.title), document.title);
ok("挑战页没换 favicon", !document.getElementById("codex-favicon"));
ok("挑战页上没发任何 API 请求", apiDelta(before, after) === 0,
  "API 请求增量=" + apiDelta(before, after) + "（全站请求 " + before.total + " -> " + after.total + "，含探针自己的 /__ctl/stats）");
ok("挑战页上没有任何重试请求", after.retries === before.retries, "_cx_retry=" + after.retries);

return { results: out };
