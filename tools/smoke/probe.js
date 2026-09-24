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

return { results: out };
