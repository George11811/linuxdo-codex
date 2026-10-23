/*
 * 冒烟测试第五 / 第六阶段：设置面板 → 外观 → 页面不透明度（dim 模式）。
 *
 * 用户反馈：黑夜模式下把「页面不透明度」拉低，整页泛灰白、看着很怪。
 * 原因是页面层（rail / 主区）半透明后，透出来的是它下面那一层 —— 站点原生页面，
 * 而 Discourse 壳子默认是浅色的。等于「把暗色 UI 半透明地压在白纸上」。
 *
 * 修法：dim 时先垫一层 `--cx-bg` 实心底（html.codex-page-dim::before，z-index 400，
 * 在主区 500 / rail 800 之下），页面层再对**它**半透明 —— 效果变成「内容朝主题
 * 底色变淡」，明暗两种主题下都自然。
 *
 * 这个探针量 DOM（class / CSS 变量 / 计算样式 / 垫底伪元素 / 命中测试），
 * 并把取样点交回 run.js：**合成之后到底是什么颜色**只有截图像素能证明，
 * 那一步在 run.js 里做（CDP Page.captureScreenshot + 极简 PNG 解码）。
 *
 * run.js 在导航前会先往 localStorage 写好 { theme, pageOpacity: 60 }，
 * 并用 `const DIM_PHASE = "dark" | "light";` 注入本阶段的预期明暗。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
const q = (s) => document.querySelector(s);

/** "#181818" / "rgb(24, 24, 24)" → {r,g,b}；解析不了返回 null */
const toRgb = (s) => {
  const str = String(s || "").trim();
  let m = /^#([0-9a-f]{6})$/i.exec(str);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(str);
  if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]) };
  return null;
};
const same = (a, b) => !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
const rgbText = (c) => (c ? `rgb(${c.r}, ${c.g}, ${c.b})` : "解析失败");

const isLightPhase = typeof DIM_PHASE !== "undefined" && DIM_PHASE === "light";
const label = isLightPhase ? "浅色模式" : "黑夜模式";
const html = document.documentElement;
const main = q(".codex-main");
const rail = q(".codex-rail");
const thread = q(".codex-thread");

/* 等一拍，确保设置和布局都落定 */
await sleep(400);

const csHtml = getComputedStyle(html);
const tokenBg = toRgb(csHtml.getPropertyValue("--cx-bg").trim());

/* ---------- 1. 设置确实生效 ---------- */
const dim = html.classList.contains("codex-page-dim");
const opacityVar = Number(csHtml.getPropertyValue("--cx-page-opacity").trim());
ok(`${label}：不透明度设置已生效（dim 标记 + CSS 变量）`,
  dim && Math.abs(opacityVar - 0.6) < 0.001,
  `dim=${dim} --cx-page-opacity=${opacityVar}`);
ok(`${label}：页面层自身是半透明的（内容照旧会变淡）`,
  !!main && Number(getComputedStyle(main).opacity) === 0.6,
  main ? "主区 opacity=" + getComputedStyle(main).opacity : "无主区");
ok(`${label}：主题底色 token 是${isLightPhase ? "浅" : "深"}色（前提成立）`,
  !!tokenBg && (isLightPhase ? tokenBg.r > 200 : tokenBg.r < 60),
  "--cx-bg=" + (tokenBg ? rgbText(tokenBg) : "解析失败"));

/* ---------- 2. 垫底：真正修掉「泛灰白」的那一层 ---------- */
const before = getComputedStyle(html, "::before");
const beforeBg = toRgb(before.backgroundColor);
ok(`${label}：dim 时铺了一层主题底色的实心底`,
  before.content !== "none" && before.position === "fixed" && same(beforeBg, tokenBg),
  `content=${before.content} position=${before.position} bg=${before.backgroundColor} / token=${tokenBg ? rgbText(tokenBg) : "?"}`);
ok(`${label}：垫底铺满视口`,
  before.top === "0px" && before.left === "0px" && before.right === "0px" && before.bottom === "0px",
  `top=${before.top} left=${before.left} right=${before.right} bottom=${before.bottom}`);
ok(`${label}：垫底不抢点击`,
  before.pointerEvents === "none", "pointer-events=" + before.pointerEvents);

/* ---------- 3. 层级：垫底在主区 / rail 之下 ---------- */
const zBefore = parseInt(before.zIndex, 10);
const zMain = main ? parseInt(getComputedStyle(main).zIndex, 10) : NaN;
const zRail = rail ? parseInt(getComputedStyle(rail).zIndex, 10) : NaN;
ok(`${label}：垫底在主区与 rail 之下（不会盖掉自绘 UI）`,
  Number.isFinite(zBefore) && zBefore < zMain && zBefore < zRail,
  `垫底=${before.zIndex} 主区=${zMain} rail=${zRail}`);

/* ---------- 4. 取样点：主区里一块只有 --cx-bg 涂色的空白 ---------- */
const rect = thread ? thread.getBoundingClientRect() : null;
const sx = rect ? Math.round(rect.left + 12) : 0;
const sy = rect ? Math.round(rect.top + 14) : 0;
const hit = rect ? document.elementFromPoint(sx, sy) : null;
ok(`${label}：取样点落在主区空白处（只涂主题底色）`,
  !!rect && (hit === thread || hit === main),
  rect ? `(${sx},${sy}) 命中 ${hit ? (hit.className || hit.tagName) : "null"}` : "无 .codex-thread");

return {
  results: out,
  /* run.js 拿这个去截屏比色：合成后应当仍是主题底色，而不是「暗色 60% 叠白纸」的灰 */
  sample: { x: sx, y: sy, size: 6 },
  expect: tokenBg,
  label
};
