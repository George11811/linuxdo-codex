/*
 * 冒烟测试在页面里跑的断言（CDP Runtime.evaluate 的表达式主体，外面包一层 async IIFE）。
 * 只用原生 DOM：不引测试框架，失败也只是 pass:false，不影响被测脚本。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const key = (k, extra) => window.dispatchEvent(new KeyboardEvent("keydown", Object.assign({
  key: k, bubbles: true, cancelable: true
}, extra || {})));
const dblEsc = async () => { key("Escape"); await sleep(60); key("Escape"); await sleep(140); };
const readSettings = () => { try { return JSON.parse(localStorage.getItem("linuxdo-codex:settings") || "{}"); } catch { return {}; } };
const clickToggle = async (key_) => {
  const b = q('[data-set-toggle="' + key_ + '"]');
  if (!b) return false;
  b.click();
  await sleep(140);
  return true;
};

/* ---------- 1. 启动 & 列表数据流 ---------- */
ok("rail 渲染且带归属标记", !!q('.codex-rail[data-cx-owner="linuxdo-codex-v1"]'));
ok("主区渲染且带归属标记", !!q('.codex-main[data-cx-owner="linuxdo-codex-v1"]'));
ok("html 上有激活标记", document.documentElement.classList.contains("codex-theme"));
ok("接管路由隐藏原生主内容", document.documentElement.classList.contains("codex-locked"));
await sleep(500);
ok("列表从 /latest.json 渲染出行", qa(".cx-trow").length >= 5, qa(".cx-trow").length + " 行");
ok("列表标题正确", (q(".cx-proj-head h1") || {}).textContent === "最新", (q(".cx-proj-head h1") || {}).textContent);
ok("rail 分类分组渲染", /开发调优/.test((q(".codex-rail-dynamic") || {}).textContent || ""));

/* 悬停提示：标题被 CSS 截断后，鼠标停上去要能看全（原生列表的 title 属性行为） */
const row0 = q(".cx-thread-rows .cx-trow");
const title0 = row0 && row0.querySelector(".cx-trow-title");
const sub0 = row0 && row0.querySelector(".cx-trow-sub");
ok("列表行带完整标题的悬停提示",
  !!row0 && !!title0 && row0.getAttribute("title") === title0.textContent &&
  title0.getAttribute("title") === title0.textContent,
  title0 ? JSON.stringify(title0.getAttribute("title")).slice(0, 40) : "无节点");
ok("副行是截断摘要 + 完整摘要的悬停提示",
  !!sub0 && (sub0.textContent || "").length <= 60 && (sub0.getAttribute("title") || "").length > 60,
  sub0 ? `显示 ${sub0.textContent.length} 字 / 提示 ${(sub0.getAttribute("title") || "").length} 字` : "无节点");

/* 原生 Discourse 侧边栏必须整条隐藏：它和 #main-outlet 平级、自己又没有背景色，
   不隐藏就会把 Topics / Upcoming events / All categories 这些文字压在我们的 rail 上 */
const nativeSidebar = q(".sidebar-wrapper");
ok("原生侧边栏节点存在（前提成立）", !!nativeSidebar);
ok("原生侧边栏已隐藏", !!nativeSidebar && getComputedStyle(nativeSidebar).display === "none",
  nativeSidebar ? getComputedStyle(nativeSidebar).display : "无节点");
const dSidebar = q("#d-sidebar");
ok("原生侧边栏内容已隐藏", !!dSidebar && getComputedStyle(dSidebar).display === "none",
  dSidebar ? getComputedStyle(dSidebar).display : "无节点");
const nativeFooter = q(".sidebar-footer-wrapper");
ok("原生侧边栏底栏已隐藏", !!nativeFooter && getComputedStyle(nativeFooter).display === "none",
  nativeFooter ? getComputedStyle(nativeFooter).display : "无节点");

/* ---------- 2. 伪装：标题 / 品牌名 / favicon ---------- */
ok("标签页标题已伪装成源码文件名", document.title === "lib.rs — platform", document.title);
ok("左栏品牌名 = Codex", (q("[data-brand-name]") || {}).textContent === "Codex", (q("[data-brand-name]") || {}).textContent);
const fav = document.getElementById("codex-favicon");
ok("favicon 换成 Codex 图标", !!fav && String(fav.getAttribute("href")).startsWith("data:image/svg+xml"));

/* ---------- 3. 缩略图 CSS 变量 ---------- */
const rs = getComputedStyle(document.documentElement);
ok("--ldx-thumb-w = 260px", rs.getPropertyValue("--ldx-thumb-w").trim() === "260px", rs.getPropertyValue("--ldx-thumb-w").trim());
ok("--ldx-thumb-h = 170px", rs.getPropertyValue("--ldx-thumb-h").trim() === "170px", rs.getPropertyValue("--ldx-thumb-h").trim());

/* ---------- 4. 应急伪装键 ---------- */
await dblEsc();
ok("连按两下 Esc 进入伪装视图", !!q(".ldx-boss") && !q(".ldx-boss").hidden && document.documentElement.classList.contains("ldx-boss-on"));
ok("伪装视图有构建日志", /cargo test/.test((q("[data-boss-log]") || {}).textContent || ""));
ok("伪装视图编辑器有代码行", qa(".ldx-boss-editor .cx-code-line").length > 20, qa(".ldx-boss-editor .cx-code-line").length);
ok("伪装视图用设置里的项目名", /platform-engine/.test((q(".ldx-boss-shell") || {}).textContent || ""), (q(".ldx-boss-shell") || {}).textContent);
await dblEsc();
ok("再按两下退出伪装", !!q(".ldx-boss") && q(".ldx-boss").hidden && !document.documentElement.classList.contains("ldx-boss-on"));
key("h", { ctrlKey: true, shiftKey: true });
await sleep(120);
ok("Ctrl+Shift+H 进入伪装", document.documentElement.classList.contains("ldx-boss-on"));
key("h", { ctrlKey: true, shiftKey: true });
await sleep(120);
ok("Ctrl+Shift+H 退出伪装", !document.documentElement.classList.contains("ldx-boss-on"));

/* ---------- 5. 设置面板 ---------- */
key(",", { ctrlKey: true });
await sleep(200);
const modal = q(".cx-modal");
ok("Ctrl+, 打开设置面板", !!modal && !modal.hidden);
const sections = qa(".cx-modal .cx-set-section").map((n) => n.textContent);
ok("设置面板含新增分组", ["伪装", "侧边栏模式", "正文图片"].every((s) => sections.includes(s)), sections.join(" | "));
ok("设置面板含新增控件",
  !!q('[data-set-toggle="stealth"]') && !!q('[data-set-toggle="thumbPreview"]') &&
  !!q('[data-set-range="thumbWidth"]') && !!q('[data-set-range="thumbHeight"]') &&
  !!q('[data-set-select="stealthKey"]') && !!q('[data-set-select="favicon"]') &&
  !!q('[data-set-toggle="sidebarMode"]') && !!q('[data-set-toggle="sidebarHideOnBlur"]') &&
  !!q('[data-set-toggle="sidebarAutoRestore"]') && !!q('[data-set-text="brandName"]') && !!q('[data-set-text="projectName"]'));

/* 开关落盘 */
await clickToggle("thumbPreview");
ok("开关改动写进 localStorage", readSettings().thumbPreview === false, JSON.stringify(readSettings().thumbPreview));
await clickToggle("thumbPreview");
ok("再点回来恢复 true", readSettings().thumbPreview === true, JSON.stringify(readSettings().thumbPreview));

/* 关掉伪装模式 → 标题 / 品牌名还原 */
await clickToggle("stealth");
ok("关掉伪装后标题还原为站点标题", /- Linux DO$/.test(document.title), document.title);
ok("关掉伪装后品牌名还原", (q("[data-brand-name]") || {}).textContent === "Linux DO", (q("[data-brand-name]") || {}).textContent);
/* 伪装模式关掉时如果在伪装视图里，必须被强制退出来 */
key("h", { ctrlKey: true, shiftKey: true });
await sleep(120);
ok("伪装关掉后 Ctrl+Shift+H 不再进入", !document.documentElement.classList.contains("ldx-boss-on"));
await clickToggle("stealth");
ok("重新打开伪装后标题恢复伪装", document.title === "lib.rs — platform", document.title);

/* favicon 选「保留原图标」→ 注入的 link 应被清掉 */
const favSel = q('[data-set-select="favicon"]');
favSel.value = "site";
favSel.dispatchEvent(new Event("change", { bubbles: true }));
await sleep(200);
ok("favicon=site 时清掉注入图标", !document.getElementById("codex-favicon"));
favSel.value = "codex";
favSel.dispatchEvent(new Event("change", { bubbles: true }));
await sleep(200);
ok("favicon 切回 codex 后重新注入", !!document.getElementById("codex-favicon"));

/* Esc 关面板，且不会顺手开伪装 */
key("Escape");
await sleep(150);
ok("Esc 关设置面板", !!q(".cx-modal") && q(".cx-modal").hidden);
ok("关面板的那次 Esc 不会开伪装", !document.documentElement.classList.contains("ldx-boss-on"));

/* ---------- 6. 侧边栏模式 ---------- */
key(",", { ctrlKey: true });
await sleep(200);
await clickToggle("sidebarMode");
ok("侧边栏模式已落盘", readSettings().sidebarMode === true, JSON.stringify(readSettings().sidebarMode));
key("Escape");
await sleep(150);
document.documentElement.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, relatedTarget: null }));
await sleep(450);
ok("鼠标离开页面 → 自动伪装", document.documentElement.classList.contains("ldx-boss-on"));
document.documentElement.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
await sleep(250);
ok("鼠标回到页面 → 自动恢复", !document.documentElement.classList.contains("ldx-boss-on"));
/* 手动进的伪装不该被鼠标带出来 */
await dblEsc();
ok("手动进入伪装（侧边栏模式开启中）", document.documentElement.classList.contains("ldx-boss-on"));
document.documentElement.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, relatedTarget: null }));
await sleep(300);
document.documentElement.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
await sleep(300);
ok("鼠标回来不会撤掉手动进的伪装", document.documentElement.classList.contains("ldx-boss-on"));
/* 手动退出之后，自动伪装必须还能工作（shown/bossAuto 不能僵住） */
await dblEsc();
ok("手动退出伪装", !document.documentElement.classList.contains("ldx-boss-on"));
document.documentElement.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, relatedTarget: null }));
await sleep(450);
ok("手动退出后自动伪装依然生效", document.documentElement.classList.contains("ldx-boss-on"));
document.documentElement.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
await sleep(250);
ok("随后回来自动恢复", !document.documentElement.classList.contains("ldx-boss-on"));

/* 设置面板：连续两下 Esc —— 第一下关面板，第二下不该被算成「连按两下」 */
key(",", { ctrlKey: true });
await sleep(200);
ok("面板已打开（准备测 Esc 状态机）", !!q(".cx-modal") && !q(".cx-modal").hidden);
key("Escape");
await sleep(80);
key("Escape");
await sleep(200);
ok("关面板的 Esc 不会被算成应急键第一下", !document.documentElement.classList.contains("ldx-boss-on"));

/* ---------- 7. 详情路由：数据流 + 缩略图 + 悬浮预览 ---------- */
history.pushState({}, "", "/t/12345");
window.dispatchEvent(new PopStateEvent("popstate"));
await sleep(900);
ok("详情页渲染出回复楼层", qa(".cx-turn-agent").length >= 3, qa(".cx-turn-agent").length + " 层");
ok("引用卡片由 aside.quote 生成", qa(".cx-tool-card").length >= 1, qa(".cx-tool-card").length);
ok("详情页面包屑用项目名", (q("[data-code-crumb-root]") || {}).textContent === "platform", (q("[data-code-crumb-root]") || {}).textContent);
const img = q(".cx-turn-user-bubble img:not(.emoji), .cx-turn-agent img:not(.emoji)");
ok("正文图片已渲染", !!img, img ? img.getAttribute("src") : "无");
if (img) {
  await sleep(300);
  const cs = getComputedStyle(img);
  ok("图片按缩略图变量收窄", cs.maxWidth === "260px" && cs.maxHeight === "170px", cs.maxWidth + " × " + cs.maxHeight);
  ok("大图没有被标成 no-preview", img.dataset.noPreview !== "1", "natural=" + img.naturalWidth + "×" + img.naturalHeight);
  img.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await sleep(350);
  ok("悬浮浮出大图预览", !!q(".ldx-imgpreview.on"));
  img.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
  await sleep(250);
  ok("移开鼠标收起预览", !q(".ldx-imgpreview.on"));
}
/* 详情页切语言：标题跟着换文件名 */
key(",", { ctrlKey: true });
await sleep(200);
const langSel = q('[data-set-select="lang"]');
if (langSel) {
  langSel.value = "python";
  langSel.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(250);
  ok("切语言后标签页标题换文件名", document.title === "pipeline.py — platform", document.title);
  langSel.value = "rust";
  langSel.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(200);
}

/* ---------- 8. 应急键改成 F2 之后，Esc² 应当失效、F2 生效 ---------- */
const stealthSel = q('[data-set-select="stealthKey"]');
stealthSel.value = "f2";
stealthSel.dispatchEvent(new Event("change", { bubbles: true }));
await sleep(200);
key("Escape"); await sleep(60); key("Escape"); await sleep(150);
ok("应急键改成 F2 后 Esc² 不再触发", !document.documentElement.classList.contains("ldx-boss-on"));
key("F2");
await sleep(150);
ok("F2 触发伪装", document.documentElement.classList.contains("ldx-boss-on"));
key("F2");
await sleep(150);
ok("F2 再按退出伪装", !document.documentElement.classList.contains("ldx-boss-on"));
stealthSel.value = "esc2";
stealthSel.dispatchEvent(new Event("change", { bubbles: true }));
await sleep(200);
key("Escape");
await sleep(120);

/* ---------- 9. 侧边栏模式：失焦触发 + 「回来不自动恢复」 ---------- */
key(",", { ctrlKey: true });
await sleep(200);
await clickToggle("sidebarHideOnBlur");
await clickToggle("sidebarAutoRestore");
ok("两个侧边栏子开关已落盘",
  readSettings().sidebarHideOnBlur === true && readSettings().sidebarAutoRestore === false,
  JSON.stringify({ blur: readSettings().sidebarHideOnBlur, restore: readSettings().sidebarAutoRestore }));
key("Escape");
await sleep(150);
window.dispatchEvent(new Event("blur"));
await sleep(250);
ok("窗口失焦 → 自动伪装", document.documentElement.classList.contains("ldx-boss-on"));
document.documentElement.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
await sleep(300);
ok("关掉「回来自动恢复」后鼠标回来也不退出", document.documentElement.classList.contains("ldx-boss-on"));
await dblEsc();
ok("手动按 Esc² 才能退出", !document.documentElement.classList.contains("ldx-boss-on"));
/* 复位：关掉这两个子开关，免得影响后续断言 */
key(",", { ctrlKey: true });
await sleep(200);
await clickToggle("sidebarHideOnBlur");
await clickToggle("sidebarAutoRestore");
await clickToggle("sidebarMode");
key("Escape");
await sleep(150);

/* ---------- 10. 撰写输入框仍然可用（回归） ---------- */
const composerCard = q(".codex-composer");
ok("底部输入框存在", !!composerCard);
ok("工具栏按钮齐备", qa(".codex-composer .cx-tool-btn").length >= 8, qa(".codex-composer .cx-tool-btn").length);
const mdBlock = q(".codex-composer .cx-md-block");
if (composerCard && mdBlock) {
  mdBlock.textContent = "冒烟测试草稿";
  mdBlock.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await sleep(160);
  ok("输入后发送按钮解禁", !q(".codex-composer .codex-composer-send")?.disabled);
  const previewBtn = q('.codex-composer .cx-tool-btn[data-tool="preview"]');
  if (previewBtn) {
    previewBtn.click();
    await sleep(160);
    const prev = q(".codex-composer .cx-compose-preview");
    ok("实时预览按钮生效", !!prev && /冒烟测试草稿/.test(prev.textContent || ""), (prev || {}).className);
    previewBtn.click();
    await sleep(120);
  }
}
/* 详情滚动不该抛异常（阅读进度上报的委托监听器） */
const detailScroller = q(".cx-view-detail");
if (detailScroller) {
  detailScroller.dispatchEvent(new Event("scroll", { bubbles: false }));
  await sleep(120);
  ok("详情滚动未抛异常", true);
}

/* ---------- 11. 三栏拖拽必须实时缩放 ----------
 *
 * 两个要点：
 *   a. 按住不放（pointermove 之后、pointerup 之前）宽度就得跟着动；
 *   b. 拖拽期间 Discourse 那边会不断产生 DOM 变动 → MutationObserver →
 *      scheduleApply → applyTheme，这条链**不能**把还没落盘的实时宽度顶回旧值
 *      （旧值只在松手时才写进 localStorage，所以顶回去的表现就是「松手才变」）。
 */
const pointer = (type, x, target, pointerId) => (target || document).dispatchEvent(
  new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 400, pointerId, buttons: 1, pointerType: "mouse" })
);

const railEl = q(".codex-rail");
const railHandle = q('[data-resize="rail"]');
const rw0 = railEl.getBoundingClientRect().width;
pointer("pointerdown", 300, railHandle, 11);
pointer("pointermove", 380, document, 11);
await sleep(90);
const rw1 = railEl.getBoundingClientRect().width;
ok("左栏：按住不放就已经变宽", rw1 - rw0 > 40, Math.round(rw0) + " -> " + Math.round(rw1));
/* 模拟 Discourse 在拖拽期间的 DOM 变动（外部节点，会触发 applyTheme） */
q("#main-outlet-inner").appendChild(document.createElement("span"));
await sleep(180);
const rw2 = railEl.getBoundingClientRect().width;
ok("左栏：拖拽期间外部重渲染不顶回宽度", Math.abs(rw2 - rw1) < 8, Math.round(rw1) + " -> " + Math.round(rw2));
pointer("pointerup", 380, document, 11);
await sleep(150);
const rw3 = railEl.getBoundingClientRect().width;
const savedAfterRail = readSettings().railWidth;
ok("左栏：松手后宽度保持并落盘", Math.abs(rw3 - rw1) < 8 && Math.abs(savedAfterRail - rw3) < 2,
  "width=" + Math.round(rw3) + " saved=" + savedAfterRail);

const panelEl = q(".cx-code-panel");
const panelHandle = q('[data-resize="panel"]');
const pw0 = panelEl.getBoundingClientRect().width;
pointer("pointerdown", 900, panelHandle, 12);
pointer("pointermove", 800, document, 12);
await sleep(90);
const pw1 = panelEl.getBoundingClientRect().width;
ok("代码面板：按住不放就已经变宽", pw1 - pw0 > 40, Math.round(pw0) + " -> " + Math.round(pw1));
q("#main-outlet-inner").appendChild(document.createElement("span"));
await sleep(180);
const pw2 = panelEl.getBoundingClientRect().width;
ok("代码面板：拖拽期间外部重渲染不顶回宽度", Math.abs(pw2 - pw1) < 8, Math.round(pw1) + " -> " + Math.round(pw2));
pointer("pointerup", 800, document, 12);
await sleep(150);
const pw3 = panelEl.getBoundingClientRect().width;
ok("代码面板：松手后宽度保持并落盘",
  Math.abs(pw3 - pw1) < 8 && Math.abs(readSettings().panelWidth - pw3) < 2,
  "width=" + Math.round(pw3) + " saved=" + readSettings().panelWidth);

/* 拖拽中途被打断（pointercancel）不能把宽度锁死 */
pointer("pointerdown", 300, railHandle, 13);
pointer("pointermove", 340, document, 13);
await sleep(60);
pointer("pointercancel", 340, document, 13);
await sleep(120);
const rwAfterCancel = railEl.getBoundingClientRect().width;
pointer("pointerdown", 300, railHandle, 14);
pointer("pointermove", 360, document, 14);
await sleep(80);
const rwAfterSecondDrag = railEl.getBoundingClientRect().width;
ok("拖拽被打断后还能继续拖", rwAfterSecondDrag - rwAfterCancel > 10,
  Math.round(rwAfterCancel) + " -> " + Math.round(rwAfterSecondDrag));
pointer("pointerup", 360, document, 14);
await sleep(120);

/* 复位，免得影响后续（本轮之后没有别的断言，只是保持环境干净） */
document.documentElement.style.setProperty("--cx-rail-w", "306px");

/* ---------- 12. 接口被拦时的兜底 ----------
 *
 * linux.do 挂在 Cloudflare 后面，`/latest.json` 这类 JSON 端点会间歇性回 403
 * （页面 HTML 能打开，只有 XHR 被拦）。这里把四种情况都跑一遍：
 *   a. 5xx → 重试一次就成功（且只多一次请求）；
 *   b. CF 挑战 → 不重试，改用页面内预加载数据；
 *   c. 预加载里也没有 → 改用原生 DOM 里已渲染的列表；
 *   d. 都没有 → 明确的错误行。
 */
const ctlStats = async () => (await (await fetch("/__ctl/stats")).json());
const countOf = (counts, p) => counts[p] || 0;
const listTitles = () => qa(".cx-trow .cx-trow-title").map((el) => el.textContent);
const statusLine = () => (q(".cx-thread-rows .cx-list-status") || {}).textContent || "";
const goto = async (path) => {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await sleep(1200);
};

/* a. 一次 5xx → 重试 */
await fetch("/__ctl/failnext?n=1");
const cBefore = await ctlStats();
await goto("/new");
const cAfter = await ctlStats();
ok("5xx 会重试一次并成功",
  listTitles().length >= 5 && countOf(cAfter.counts, "/new.json") - countOf(cBefore.counts, "/new.json") === 2,
  "行数=" + listTitles().length + " 请求=" + (countOf(cAfter.counts, "/new.json") - countOf(cBefore.counts, "/new.json")));
ok("重试确实带了 _cx_retry", cAfter.retries - cBefore.retries === 1, "_cx_retry 次数=" + (cAfter.retries - cBefore.retries));

/* b. CF 挑战 → 用 #data-preloaded 里的列表 */
await fetch("/__ctl/block?on=1");
const cB0 = await ctlStats();
await goto("/top");
const cB1 = await ctlStats();
const titlesTop = listTitles();
ok("CF 拦截时不重试（不把限流踩深）",
  countOf(cB1.counts, "/top.json") - countOf(cB0.counts, "/top.json") === 1 && cB1.retries === cB0.retries,
  "请求=" + (countOf(cB1.counts, "/top.json") - countOf(cB0.counts, "/top.json")) + " 重试=" + (cB1.retries - cB0.retries));
ok("CF 拦截时改用页面内预加载数据", titlesTop.length > 0 && titlesTop.every((t) => t.startsWith("预加载·")),
  titlesTop.slice(0, 2).join(" / ") + (titlesTop.length > 2 ? " …" : ""));
ok("状态行说明了兜底来源", /预加载/.test(statusLine()), statusLine().slice(0, 40));

/* c. 预加载里也没有 → 用原生 DOM 里已渲染的列表 */
const pre = JSON.parse(q("#data-preloaded").getAttribute("data-preloaded"));
delete pre.topicList_latest;
q("#data-preloaded").setAttribute("data-preloaded", JSON.stringify(pre));
q("#main-outlet-inner").innerHTML = `
  <table class="topic-list"><tbody>
    <tr class="topic-list-item" data-topic-id="3001"><td class="main-link">
      <a class="title raw-topic-link" href="/t/native-one/3001">原生列表·第一条</a></td>
      <td class="posts">7</td><td class="views">188</td>
      <td class="activity"><span class="relative-date" title="2026-10-14T10:00:00.000Z">1 小时前</span></td></tr>
    <tr class="topic-list-item unread pinned" data-topic-id="3002"><td class="main-link">
      <a class="title raw-topic-link" href="/t/native-two/3002">原生列表·第二条</a></td>
      <td class="posts">23</td><td class="views">904</td>
      <td class="activity"><span class="relative-date" title="2026-10-14T08:30:00.000Z">2 小时前</span></td></tr>
  </tbody></table>`;
await goto("/hot");
const titlesHot = listTitles();
ok("预加载也没有时改用原生列表 DOM",
  titlesHot.length === 2 && titlesHot.every((t) => t.startsWith("原生列表·")), titlesHot.join(" / "));
ok("原生列表解析出的回复数正确", /23 回复/.test(q(".cx-thread-rows").textContent || ""), "含 23 回复");

/* d. 两个兜底都没有 → 错误行 */
q("#main-outlet-inner").innerHTML = "";
const cD0 = await ctlStats();
await goto("/bookmarks");
const cD1 = await ctlStats();
ok("兜底数据也没有时给出错误行",
  /列表加载失败/.test(statusLine()) && !/预加载/.test(statusLine()), statusLine().slice(0, 46));
ok("换路由会重新尝试（不被失败冷却卡住）",
  countOf(cD1.counts, "/bookmarks.json") - countOf(cD0.counts, "/bookmarks.json") === 1,
  "请求=" + (countOf(cD1.counts, "/bookmarks.json") - countOf(cD0.counts, "/bookmarks.json")));

/* 这一节结束时故意让 CF 拦截保持打开：run.js 的第三阶段要在一个新页面里
   验证「刚打开就被拦」时列表与详情都走预加载兜底。 */

return { results: out };
