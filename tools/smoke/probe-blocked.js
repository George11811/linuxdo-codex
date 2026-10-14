/*
 * 冒烟测试第三阶段：**页面一打开，JSON 接口就是被 CF 拦的**（403 + 挑战页）。
 * 这个页面是全新加载的，所以列表和详情都必须靠页面内预加载数据顶住 ——
 * 也就是用户最常遇到的「刷新后内容刷不出来」那个场景。
 *
 * 前置：run.js 在导航到这里之前已经把 /__ctl/block?on=1 打开。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const stats = async () => (await (await fetch("/__ctl/stats")).json());
const countOf = (c, p) => c[p] || 0;

/* 列表：/latest.json 被拦 → 走 #data-preloaded 里的 topicList_latest */
await sleep(600);
const titles = qa(".cx-trow .cx-trow-title").map((el) => el.textContent);
ok("被拦时列表仍有内容（预加载兜底）", titles.length > 0, titles.length + " 行");
ok("列表用的确实是预加载那份", titles.length > 0 && titles.every((t) => t.startsWith("预加载·")),
  titles.slice(0, 2).join(" / ") + (titles.length > 2 ? " …" : ""));
const status = (q(".cx-thread-rows .cx-list-status") || {}).textContent || "";
ok("状态行说明了兜底来源", /预加载/.test(status), status.slice(0, 40));

/* 详情：/t/12345.json 也被拦 → 走 #data-preloaded 里的 topic_12345 */
history.pushState({}, "", "/t/12345");
window.dispatchEvent(new PopStateEvent("popstate"));
await sleep(1200);
ok("被拦时详情仍有内容（预加载兜底）", qa(".cx-turn-agent").length >= 3, qa(".cx-turn-agent").length + " 层");
const model = (q(".cx-crumb .cx-model") || {}).textContent || "";
ok("详情用的是预加载那份（标题带标记）", /（预加载）/.test(model), model.slice(0, 46));

const s = await stats();
/* /latest.json 在新页面里会被请求两次：一次是列表主数据，一次是 rail 的「最近」分组。
   两次都不该有重试 —— CF 挑战重试是白费，只会把限流踩得更深。 */
ok("被拦时没有任何重试请求", s.retries === 0, "_cx_retry 次数=" + s.retries);
ok("被拦时请求数没有失控",
  countOf(s.counts, "/latest.json") <= 2 && countOf(s.counts, "/t/12345.json") === 1,
  "/latest.json=" + countOf(s.counts, "/latest.json") + " /t/12345.json=" + countOf(s.counts, "/t/12345.json"));

return { results: out };
