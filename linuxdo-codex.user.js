// ==UserScript==
// @name         Linux DO · Codex 外观（伪装版）
// @namespace    https://linux.do/
// @version      1.0.0
// @description  将 Linux DO 换成 Codex 桌面 app 风格：左 rail + 线程主区 + 右侧「代码面板」，明暗双模式；新增伪装模式（应急键 / 侧边栏模式）、缩略图与悬浮大图预览。仅改变外观，保留站点原有内容与交互。
// @author       link
// @match        https://linux.do/*
// @icon         https://linux.do/favicon.ico
// @grant        none
// @run-at       document-start
// @updateURL    https://github.com/George11811/linuxdo-codex/blob/master/linuxdo-codex.user.js
// ==/UserScript==

/*
 * ── 本文件与另外两份脚本的关系 ──────────────────────────────────────────────
 *
 * 1. 数据流：沿用 linuxdo.user.js（Discourse / Ember 那一套）——
 *    /latest.json、/top.json、/t/<id>.json 取数，DiscourseURL 软跳转，
 *    通知菜单收养、composer、阅读进度上报、书签、点赞、投票、引用跳源楼
 *    全部保持原实现。本文件只在下面这几处碰过既有代码（其余都是新增）：
 *      · 进详情时写 document.title 的那行 → 改走 syncTitle()（伪装要用）
 *      · syncChrome / syncRail 末尾追加品牌名与标题同步
 *      · ensureRail / ensureMain / renderRailDynamic / bindRailClicks / syncRail
 *        加「只认自己画的节点」的归属判断（互斥避让要用，见下）
 *      · removeApp 只拆带归属标记的节点
 *      · openLightbox 打开前收起悬浮预览；applySplash / makeCodexFaviconUri
 *        配合 favicon 设置项
 *      · decorateCooked 末尾多调一次 markSmallImages()；图片 CSS 从
 *        「hover 原地放大」换成「缩略图 + 悬浮浮层」
 *      · rail 配色 token 与正文图片相关的 CSS 段
 *
 * 2. 外观与玩法：移植自 reference/v2ex-codex.user.js 1.0.0 ——
 *    · rail 配色按实测有效对比度重调（底色压暗 + 文字提到近白）
 *    · 伪装模式：品牌名 → Codex、标签页标题 → 源码文件名、应急伪装键
 *      （连按两下 Esc / F2 / Ctrl+Shift+H，Ctrl+Shift+H 始终有效）
 *    · 伪装视图：整个视口变成「代码编辑器 + 构建日志」，再按一次恢复
 *    · 侧边栏模式：鼠标离开页面区域 / 窗口失焦自动伪装，回来自动恢复
 *      （只撤它自己触发的那次，手动按出的伪装不受影响）
 *    · 品牌名 / 项目名 / favicon / 缩略图尺寸 / 悬浮大图预览 等设置项
 *
 * 3. 与旧的 linuxdo.user.js 互斥：两份脚本会画同一套 UI，**只应启用一个**。
 *    本脚本认领自己画的节点（data-cx-owner），检测到「不是自己画的
 *    .codex-rail / .codex-main」就让位，避免 rails 叠罗汉（见 otherThemeActive）。
 * ───────────────────────────────────────────────────────────────────────────
 */

(function () {
  "use strict";

  /* ============================== 常量 ============================== */

  const STYLE_ID = "linuxdo-codex-theme";
  const FAVICON_ID = "codex-favicon";
  const ROOT_CLASS = "codex-theme";   // 本脚本激活标记（互斥检测也看它）
  const LIGHT_CLASS = "codex-light";  // 浅色模式
  const LOCK_CLASS = "codex-locked";  // 锁定路由：隐藏原生主内容
  const DIMMED_CLASS = "codex-page-dim"; // 页面层不透明度 < 100%（只在真的调暗时才加）
  const BOSS_CLASS = "ldx-boss-on";   // 伪装视图激活标记

  /**
   * 本脚本在自己画出来的节点上打的归属标记。
   *
   * 用途只有一个：区分「这份 UI 是我画的」和「是另一份 Codex 主题脚本画的」。
   * 同名 class（.codex-rail / .codex-main）两边都会用，光看 class 分不出来，
   * 而互斥避让必须分得出来 —— 否则我们会在别人的 rail 上再叠一个。
   */
  const OWNER_ATTR = "data-cx-owner";
  const OWNER_ID = "linuxdo-codex-v1";

  /**
   * 「页面层」= 会被设置面板里的不透明度滑杆影响的东西。
   *
   * 三条规矩（加新的一层时照这个来）：
   *   1. **只放脚本自绘的界面** —— 现在是左 rail 和主区（列表 / 详情 / 代码面板 /
   *      底部输入框都长在 .codex-main 里）。linux.do 自己的页面（未接管路由下的
   *      #main-outlet）**不放进来**：那是站点的东西，滑杆叫「页面不透明度」，
   *      但只该作用于本脚本画出来的这套 UI，不该顺手把原生页面也调淡；
   *   2. **浮层永远不进来**：灯箱 / 设置面板 / toast / 引用跳回按钮都是挂在
   *      <body> 上的兄弟节点，不在这个名单里。设置面板调暗了就找不着滑杆拖回来
   *      （toast 更是拿 opacity 做显隐的），灯箱调暗则等于自废武功；
   *   3. 这里的字符串是**唯一来源**：RAW_CSS 里的规则由它拼出来（见 buildCss），
   *      所以 CSS 和 JS 不可能对不上（不用手抄两遍）。
   */
  const PAGE_LAYER_SELECTOR = [
    ".codex-rail",  // 脚本自绘：左 rail
    ".codex-main"   // 脚本自绘：主区（含代码面板、底部输入框）
  ].join(", ");

  const RAIL_WIDTH = 306; // 左侧 rail，宽度按原版 app 截图比例（~20% 窗宽）校准

  /* ============================== 设置 ==============================
   *
   * 默认值全在 DEFAULTS 里；用户改过的项统一存成一个 JSON
   * （localStorage 的 linuxdo-codex:settings），读走 cfg()、写走 setCfg()。
   *
   * 早期版本是「一个设置一个独立的 localStorage 键」（linuxdo-codex-mode /
   * -rail-w / -panel-w / -code-lang / -code-mode / -code-panel /
   * -compose-preview），这里按 LEGACY_KEYS 做一次性迁移，老用户不会丢设置。
   * 读取时旧键只是先垫一层，新键永远覆盖它；只有「恢复默认」会清掉旧键
   * （不清的话下次读取又被垫回来）。
   * ============================================================== */

  const DEFAULTS = {
    /* —— 外观 —— */
    /** "auto" 跟随 linux.do 自己的配色 | "dark" | "light" */
    theme: "auto",
    /** 左栏宽度（Codex 原版约 20% 窗宽，306 是按截图校准的） */
    railWidth: RAIL_WIDTH,
    /**
     * 代码面板宽度。0 = 自动 —— 不写 CSS 变量，交给 .cx-code-panel 的
     * `width: var(--cx-panel-w, 50%)` 兜底，也就是脚本原本的「与中间栏 1:1」
     * 默认值；用户拖过把手或拉过滑杆才变成固定像素。
     */
    panelWidth: 0,
    /** 正文最大宽度 */
    threadMaxWidth: 760,
    /** 是否显示右侧代码面板（纯氛围装饰） */
    codePanel: true,
    /** 代码面板语言：rust / python / typescript / go / java */
    lang: "rust",
    /** 代码面板视图："code" | "diff" */
    codeMode: "code",
    /**
     * 页面层不透明度（%）。100 = 完全不透明。
     * 只作用于「页面层」= 脚本自绘的 rail + 主区（见 PAGE_LAYER_SELECTOR）。
     * linux.do 自己的页面（未接管路由下的 #main-outlet），以及灯箱、设置面板、
     * toast 这类浮层永远是 100%。
     */
    pageOpacity: 100,

    /* —— 装饰（内容全是假的，纯装饰）—— */
    /** 总开关：列表行之间的痕迹 + 楼内英文思考块 / 工具调用行 */
    decorations: true,
    /** 列表里行与行之间穿插痕迹的比例（%）。0 = 列表里不插 */
    listTraceRate: 46,
    /** 列表里的思考块是否默认展开（关掉只占一行 ✻ Worked for Ns ▸） */
    listThinkingOpen: false,
    /** 楼内（详情页）的思考块是否默认展开 */
    detailThinkingOpen: true,
    /** 把 Discourse 引用（aside.quote / blockquote）渲染成可折叠引用卡片 */
    quoteCard: true,
    /** 引用卡片默认展开 */
    quoteOpen: false,

    /* —— 撰写 —— */
    /** 输入框「实时预览」默认开启（对应工具栏上那个按钮） */
    composePreview: false,
    /**
     * 底部输入框是否收起成一条细栏。
     * 这是「当前状态」不是「一次性默认值」：面板里的开关和输入框上的收起按钮
     * 改的是同一个值，刷新 / 换路由都保持。
     */
    composerCollapsed: false,

    /* —— 伪装（移植自 v2ex-codex 1.0.0）—— */
    /**
     * 伪装模式。上班摸鱼用：
     *   - 左栏品牌名 → "Codex"（brandName 留空时）
     *   - 标签页标题 → 源码文件名（不再出现 "Linux DO" / 帖子标题 字样）
     *   - 启用下面的应急伪装键
     */
    stealth: true,
    /**
     * 应急伪装键：按下后整个视口变成「代码编辑器 + 构建日志」，再按一次恢复。
     *   "esc2"          连按两下 Esc（默认，最好按）
     *   "f2"            单键
     *   "ctrl+shift+h"  组合键
     * 无论配成什么，Ctrl+Shift+H 始终有效。
     */
    stealthKey: "esc2",
    /**
     * 侧边栏模式：鼠标一离开页面区域，就自动做和「连按两下 Esc」一样的事
     * （切进伪装视图）。鼠标回到页面上自动切回来 —— 但只撤它自己触发的那一次，
     * 手动按 Esc² / Ctrl+Shift+H 进的伪装状态不会被鼠标带出来。
     */
    sidebarMode: false,
    /**
     * 侧边栏模式的第二个触发源：窗口失焦 / 标签页切走时也自动伪装。
     * 独立开关 —— 有人只在「鼠标移出去」时想伪装，不想在切标签页时被切走。
     */
    sidebarHideOnBlur: false,
    /**
     * 侧边栏模式：鼠标回到页面（或标签页重新可见）时，要不要自动撤销那次自动伪装。
     *   true  —— 鼠标走开就藏、回来就还原（默认，最省事）
     *   false —— 走开就藏，但**不会自己回来**：得自己按 Esc² / Ctrl+Shift+H 退出。
     */
    sidebarAutoRestore: true,
    /** 左栏品牌名。空字符串 = 由 stealth 决定（Codex / Linux DO） */
    brandName: "",
    /**
     * 代码面板 / 面包屑 / 标签页标题里显示的项目名。
     * 默认取一个不含站点痕迹的通用名：标签页标题会变成
     * "lib.rs — platform"，扫一眼就是普通工程目录。
     */
    projectName: "platform",
    /** favicon："codex" = Codex 风格圆角图标 | "site" = 保留 linux.do 原图标 */
    favicon: "codex",

    /* —— 正文图片（移植自 v2ex-codex 1.0.0）—— */
    /** 缩略图尺寸上限 */
    thumbWidth: 260,
    thumbHeight: 170,
    /** 鼠标悬停时浮出大图预览 */
    thumbPreview: true
  };

  const SETTINGS_KEY = "linuxdo-codex:settings";
  /** 旧版本用过的独立键 → 新设置的字段名（值语义不同的在 loadSettings 里换算） */
  const LEGACY_KEYS = {
    theme: "linuxdo-codex-mode",
    railWidth: "linuxdo-codex-rail-w",
    panelWidth: "linuxdo-codex-panel-w",
    codePanel: "linuxdo-codex-code-panel",
    lang: "linuxdo-codex-code-lang",
    codeMode: "linuxdo-codex-code-mode",
    composePreview: "linuxdo-codex-compose-preview"
  };

  let SETTINGS = null;

  /**
   * 侧边栏模式的控制器（bootstrap 里建一次，页面生命周期内复用）。
   * 声明放在设置区：applyVisualSettings() 会用它做 refresh()，而那个函数
   * 在 bootstrap / resetSettings 等早期路径上就会跑，放在后面会踩 TDZ。
   */
  let sidebarAutoHide = null;

  /**
   * 正在拖拽中的三栏宽度状态（null = 没在拖）。
   *
   * 存在的理由有两个：
   *   1. applyVisualSettings() 要据此跳过宽度变量，别把实时宽度顶回旧值；
   *   2. 松手时按这里记下的数字落盘，而不是回头去读 CSS 变量 ——
   *      变量在拖拽期间可能被别的路径写过。
   */
  let dragState = null;

  function loadSettings() {
    const out = Object.assign({}, DEFAULTS);
    // 1) 先吃旧键（迁移）
    for (const k of Object.keys(LEGACY_KEYS)) {
      let v = null;
      try { v = localStorage.getItem(LEGACY_KEYS[k]); } catch { /* 隐私模式等 */ }
      if (v === null || v === "") continue;
      if (k === "codePanel" || k === "composePreview") {
        out[k] = v === "1"; // 旧键存 "0"/"1"，新设置是布尔
      } else if (k === "railWidth" || k === "panelWidth") {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) out[k] = n;
      } else {
        out[k] = v;
      }
    }
    // 2) 再吃新键，覆盖旧键
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        for (const k of Object.keys(DEFAULTS)) {
          // 类型不符就忽略，避免手工改坏 localStorage 后整个面板崩掉
          if (obj[k] !== undefined && typeof obj[k] === typeof DEFAULTS[k]) out[k] = obj[k];
        }
      }
    } catch { /* 坏了就用默认值 */ }
    return out;
  }

  function cfg(key) {
    if (!SETTINGS) SETTINGS = loadSettings();
    return SETTINGS[key] !== undefined ? SETTINGS[key] : DEFAULTS[key];
  }

  /** 写设置。visualOnly = 只刷新 CSS 变量 / class，不重建 DOM（拖滑块时用） */
  function setCfg(key, value, opts) {
    if (!SETTINGS) SETTINGS = loadSettings();
    SETTINGS[key] = value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch { /* 隐私模式等 */ }
    if (opts && opts.visualOnly) {
      applyVisualSettings();
      syncSettingControls();
    } else {
      applySettings(key);
    }
  }

  /** 一次落盘多项设置，只走一遍应用（跨栏拖拽松手时两个宽度一起写） */
  function setCfgMany(pairs) {
    if (!SETTINGS) SETTINGS = loadSettings();
    for (const [k, v] of pairs) SETTINGS[k] = v;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch { /* 隐私模式等 */ }
    applyVisualSettings();
    syncSettingControls();
  }

  function resetSettings() {
    SETTINGS = Object.assign({}, DEFAULTS);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS));
      for (const k of Object.keys(LEGACY_KEYS)) localStorage.removeItem(LEGACY_KEYS[k]);
    } catch { /* ignore */ }
    applySettings();
  }

  /* ---- 品牌名 / 标签页标题（伪装模式的两个消费点）------------------------ */

  /** 左栏品牌名：用户填了就用用户的，否则由 stealth 决定（Codex / Linux DO） */
  function brandName() {
    const custom = cfg("brandName");
    return custom || (cfg("stealth") ? "Codex" : "Linux DO");
  }

  /** 把当前品牌名写进左栏（rail 可能还没建，所以整体是幂等的） */
  function syncBrandName() {
    // 只写自己那份 rail（.codex-rail-brand-name 同名 class 别的脚本也用）
    const el = ownNode(".codex-rail")?.querySelector("[data-brand-name]");
    if (!el) return;
    const name = brandName();
    if (el.textContent !== name) el.textContent = name;
    const link = el.closest(".codex-rail-brand-name");
    if (link) link.title = cfg("stealth") ? "Codex（伪装模式）" : "回到话题列表";
  }

  /**
   * 标签页标题。
   *
   * 伪装模式下换成「源码文件名 — 项目名」（和代码面板 / 伪装视图保持一致），
   * 扫一眼就是普通工程目录；关掉伪装时还原成站点的「帖子标题 - Linux DO」。
   *
   * 站点自己的 Ember 路由也会写 document.title，所以这个函数不只在启动时跑：
   * syncChrome() / syncRail() 里各调一次，后写的那个负责盖住站点的标题。
   *
   * 但**整页正在 CF 挑战时一律不动**：那时的标题是挑战页自己的
   * （"Just a moment..."），改写成源码文件名既没意义，又让人误以为挑战已经过了；
   * 挑战通过后（cfBlocked 变 false）下一拍自然会写上。
   */
  function syncTitle() {
    if (cfBlocked()) return;
    const file = (CODE_LANGS[getCodeLang()] || {}).file || "lib.rs";
    if (cfg("stealth")) {
      const want = file + " \u2014 " + (cfg("projectName") || "platform");
      if (document.title !== want) document.title = want;
      return;
    }
    // 退出伪装：尽量还原一个像原站的标题（拿不到帖子标题时退回站点名）
    const want = threadState.title
      ? `${threadState.title} - Linux DO`
      : (isTopicPath(location.pathname) ? "Linux DO" : `${listTitleForPath(location.pathname)} - Linux DO`);
    if (document.title !== want) document.title = want;
  }

  /* ---- 分层不透明度 ------------------------------------------------------
   *
   * 通用件 + 一层薄封装，想再挂一个不透明度滑杆（比如只调代码面板）时
   * 只要多加一条 spec + 一段消费变量的 CSS：
   *   - applyLayerOpacity(percent, { varName, dimClass, fallback })
   *     写 CSS 变量、按需切 class，不碰存储、不重渲染，任何一层都能用；
   *   - applyPageOpacity(percent) 只是它针对「页面层」的调用
   *     （变量名 = --cx-page-opacity，class = DIMMED_CLASS）。
   *
   * 为什么走 CSS 变量而不是给每个元素写 inline style：变量写在 <html> 上，
   * 页面层自己 `opacity: var(...)`，「哪些算一层」只有一处定义。
   * ---------------------------------------------------------------------- */

  /**
   * 把 0–100 的不透明度作用到某一层上。
   * 100 = 去掉 dim class（连 CSS 规则都不生效）；其余才真的调暗。
   * 预览路径（拖滑杆）和落盘路径共用它，避免两边逻辑漂移。
   */
  function applyLayerOpacity(percent, opt) {
    const o = opt || {};
    const root = document.documentElement;
    const pct = clampPercent(percent, o.fallback, o.min);
    const dim = pct < 100;
    root.style.setProperty(o.varName || "--cx-page-opacity", String(pct / 100));
    root.classList.toggle(o.dimClass || DIMMED_CLASS, dim);
    return pct;
  }

  /** 「页面层」那一层（PAGE_LAYER_SELECTOR 列的就是它） */
  function applyPageOpacity(percent) {
    const it = specItem("pageOpacity");
    return applyLayerOpacity(percent, {
      varName: "--cx-page-opacity",
      dimClass: DIMMED_CLASS,
      fallback: DEFAULTS.pageOpacity,
      // 下界直接读滑杆的 min，不另抄一份，免得两边漂移
      min: (it && it.min) || 0
    });
  }

  /** 代码面板宽度：0 = 不写变量，交回 CSS 的 50% 兜底（脚本原默认的 1:1 分屏） */
  function applyPanelWidth(px) {
    const root = document.documentElement;
    const w = Number(px);
    if (Number.isFinite(w) && w > 0) root.style.setProperty("--cx-panel-w", Math.round(w) + "px");
    else root.style.removeProperty("--cx-panel-w");
  }

  /* ---- 应用设置 ---------------------------------------------------------- */

  /**
   * 只改 CSS 变量 / class —— 不重建 DOM。
   * 拖宽度滑杆时走这条，否则每动一格都要重排整个列表。
   */
  function applyVisualSettings() {
    const root = document.documentElement;
    // 拖拽期间跳过宽度变量：拖拽的值要等松手才落盘，这里若按旧值重写一遍，
    // 手一停就被顶回去（见 applyTheme 里的 takingOver 注释）
    if (!dragState) {
      root.style.setProperty("--cx-rail-w", cfg("railWidth") + "px");
      applyPanelWidth(cfg("panelWidth"));
    }
    root.style.setProperty("--cx-thread-max", cfg("threadMaxWidth") + "px");
    root.style.setProperty("--ldx-thumb-w", cfg("thumbWidth") + "px");
    root.style.setProperty("--ldx-thumb-h", cfg("thumbHeight") + "px");
    applyPageOpacity(cfg("pageOpacity"));
    syncCxMode();                 // 主题：跟随站点 / 强制明暗
    syncModeBtn();                // 左下角明暗按钮的图标
    makeFavicon();                // favicon 底色跟着明暗走
    syncBrandName();              // 左栏品牌名（brandName / stealth）
    syncTitle();                  // 标签页标题（伪装模式下换成源码文件名）
    syncComposerCollapsed();      // 底部输入框收起 / 展开
    // 伪装模式关掉后不能把伪装视图留在屏幕上：setBoss(true) 进不去，但已经进去的
    // 那一次得有人负责退出（此外还挡掉「关开关时正好在伪装视图里」的僵态）
    if (!cfg("stealth") && bossOn()) setBoss(false, true);
    setCodePanelHidden(!cfg("codePanel"), false);
    // 侧边栏模式的 blur 监听器是按设置决定挂不挂的；放在这里是因为
    // 「任何改设置的路径」最终都会走到 applyVisualSettings()，
    // 这样开关无论 click 还是 change 触发的都会重新登记一次（refresh 幂等）。
    if (sidebarAutoHide) sidebarAutoHide.refresh();
  }

  /**
   * 改了这些设置要重建 DOM：装饰开关决定的是「建不建」，
   * 光靠 CSS 既藏不掉旧节点、也补不出新节点。
   * 列表痕迹和楼内装饰是两个视图各自消费的，所以分开列，改一边只重建那一边。
   */
  const LIST_STRUCTURAL_KEYS = new Set(["decorations", "listTraceRate", "listThinkingOpen"]);
  const DETAIL_STRUCTURAL_KEYS = new Set(["decorations", "quoteCard", "quoteOpen", "detailThinkingOpen"]);

  /**
   * 完整的应用。changedKey 用来跳过跟它无关的重活：
   * 拖宽度滑杆没必要把整屏帖子重建一遍，否则松手就跳滚动条。
   * 不传 = 全部重建（启动 / 恢复默认）。
   */
  function applySettings(changedKey) {
    applyVisualSettings();
    syncSettingControls();
    const all = !changedKey;
    if (all || changedKey === "lang" || changedKey === "codeMode") renderCodePanel();
    if (all || DETAIL_STRUCTURAL_KEYS.has(changedKey)) rerenderDetailPosts();
    if (all || LIST_STRUCTURAL_KEYS.has(changedKey)) renderListRows();
  }

  /* ============================== 内联 SVG 图标 ============================== */

  const ICONS = {
    sidebar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="3"/><line x1="9.5" y1="4" x2="9.5" y2="20"/></svg>`,
    chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="14 6 8 12 14 18"/></svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 6 16 12 10 18"/></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 9 12 14 17 9"/></svg>`,
    chevronUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 15 12 10 17 15"/></svg>`,
    chevronRightSm: `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>`,
    pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    branch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="8" r="2.4"/><path d="M6 8.4v7.2"/><path d="M18 10.4c0 4-4 3.6-7 4.6"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`,
    plugin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/></svg>`,
    folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>`,
    dots: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.8-1.1L5.5 6.4A1 1 0 0 1 6.4 5h11.2a1 1 0 0 1 .9 1.4l-1.7 3.3a2 2 0 0 1-1.8 1.1Z"/><path d="M9 10.8V15a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4.2"/></svg>`,
    bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
    bookmarkFill: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    quote: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-3-.4-4.2-1L3 20l1.2-5.3A8.5 8.5 0 1 1 21 11.5z"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`,
    tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.05 12.35 2a1.4 1.4 0 0 0-1-.4H3a1 1 0 0 0-1 1v8.35a1.4 1.4 0 0 0 .4 1l9.1 9.05a1.4 1.4 0 0 0 2 0l7.9-7.9a1.4 1.4 0 0 0 0-2Z"/><circle cx="7.5" cy="7.5" r="1"/></svg>`,
    send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/></svg>`,
    reply: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`,
    like: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>`,
    link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>`,
    menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    panel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="3"/><line x1="14.5" y1="4" x2="14.5" y2="20"/></svg>`,
    expand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7.5 7.5"/><path d="M3 21l7.5-7.5"/></svg>`,
    folderOpen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>`,
    terminal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><polyline points="7 9 10 12 7 15"/><path d="M12.5 15H17"/></svg>`,
    file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5h5"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.7 2.6 4 5.7 4 9s-1.3 6.4-4 9c-2.7-2.6-4-5.7-4-9s1.3-6.4 4-9Z"/></svg>`,
    layers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="7.5" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>`,
    inbox: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 13h-5.5l-2 3h-5l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
    bot: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M12 8V4"/></svg>`,
    dotsV: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a7.5 7.5 0 1 0 11 11Z"/></svg>`,
    filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v5.5L10 21v-8Z"/></svg>`
  };

  /* ============================== favicon（ChatGPT 风：圆角深底 + OpenAI 花） ============================== */

  let FAVICON_URI = null;
  let FAVICON_MODE = null;

  // OpenAI 花朵 path（simple-icons openai，公版 CC0）
  const CX_OPENAI_PATH = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

  /**
   * 圆角底 + OpenAI 花，明暗自适应底色。
   * 设置里选了「保留 linux.do 原图标」时返回 null —— 调用方据此整段跳过。
   */
  function makeCodexFaviconUri() {
    if (cfg("favicon") === "site") return null;
    const light = !isDarkMode();
    if (FAVICON_URI && FAVICON_MODE === (light ? "light" : "dark")) return FAVICON_URI;
    try {
      const bg = light ? "#f2f2f3" : "#171717";
      const fg = light ? "#0f0f0f" : "#ffffff";
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
        `<rect width="24" height="24" rx="5.5" fill="${bg}"/>` +
        `<path fill="${fg}" d="${CX_OPENAI_PATH}"/></svg>`;
      FAVICON_URI = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      FAVICON_MODE = light ? "light" : "dark";
    } catch {
      FAVICON_URI = "https://linux.do/favicon.ico";
      FAVICON_MODE = light ? "light" : "dark";
    }
    return FAVICON_URI;
  }

  /* ============================== 工具函数 ============================== */

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  /** 把百分比夹到 [min, fallback] 区间；不是数字就用 fallback（滑杆 / 手改 localStorage 都可能给脏值） */
  function clampPercent(value, fallback, min) {
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(fallback) ? fallback : 100;
    const n = Number(value);
    if (!Number.isFinite(n)) return hi;
    return Math.min(hi, Math.max(lo, n));
  }

  function debounce(fn, wait) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function formatTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = Date.now();
    const diff = now - date.getTime();
    const minute = 60e3, hour = 3600e3, day = 86400e3;
    if (diff < minute) return "刚刚";
    if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
    if (diff < day && date.getDate() === new Date().getDate()) {
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    }
    if (diff < 2 * day) return "昨天";
    if (diff < 365 * day) return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  /**
   * 这个响应是 Cloudflare 的挑战 / 拦截页，而不是 Discourse 的正常 JSON 吗？
   *
   * 判据（按可靠性排序）：
   *   - cf-mitigated 头：CF 自己标的 challenge / block，最准；
   *   - 403 + Content-Type: text/html：正常 JSON 接口不会这么回，
   *     拿到 HTML 就说明中间被插了一页挑战/拦截。
   * 用途不是「弹提示」而是「决定要不要重试」：CF 拦下来的请求重试多少次都没用，
   * 只会把自己送进更深的限流，所以这种情况直接换成页面内的兜底数据。
   */
  function isCfChallenge(resp) {
    try {
      const mitigated = String(resp.headers.get("cf-mitigated") || "").toLowerCase();
      if (mitigated === "challenge" || mitigated === "block") return true;
      const type = String(resp.headers.get("content-type") || "").toLowerCase();
      return resp.status === 403 && type.includes("text/html");
    } catch {
      return false;
    }
  }

  /** 带状态的取数错误：调用方要按 status / cfChallenge 决定重试还是换路子 */
  function apiError(status, cfChallenge) {
    const err = new Error(`HTTP ${status}`);
    err.status = status;
    err.cfChallenge = !!cfChallenge;
    return err;
  }

  /* ---- 出网闸门：挑战期间一个请求都不发 ------------------------------------
   *
   * 挑战页上每一次 XHR 都会被重新过一遍机器人判定，脚本自己那些后台请求
   * （列表 / 分类 / 阅读进度上报 / 翻页预取…）等于自己给自己加码，
   * 只会让挑战更容易升级。所以：
   *   - 整页被判成挑战（cfBlocked，DOM/标题判定）→ 直接不发；
   *   - 单次 XHR 被判成挑战（cf-mitigated / 403+HTML）→ 记一笔，静默 CF_HUSH_MS，
   *     期间同样不发 —— 这一条尤其重要：整页看着正常、只有接口被拦时，
   *     光靠 DOM 判定是拦不住的。
   * 静默期结束后、或挑战通过后，cfBlocked 自然变 false，一切照旧。
   * 拦下来时抛的错带 cfChallenge = true，调用方的兜底路径（页面内预加载数据 /
   * 原生 DOM）本来就不发请求，所以用户依然能看到内容。
   * ---------------------------------------------------------------------- */

  const CF_HUSH_MS = 30000; // 见过一次接口挑战后静默多久
  let cfHushUntil = 0;

  function noteCfChallenge() {
    cfHushUntil = Math.max(cfHushUntil, Date.now() + CF_HUSH_MS);
  }
  function cfHushed() {
    return Date.now() < cfHushUntil;
  }

  /** 闸门：该不该出网。抛出的错和「真的被拦了」同形，调用方无需特判 */
  function cfGate() {
    if (!cfBlocked() && !cfHushed()) return;
    const err = apiError(0, true);
    err.message = cfBlocked() ? "CF 挑战中，已暂停请求" : "刚被 CF 拦过，暂停请求中";
    err.paused = true;
    throw err;
  }

  async function api(path, extraHeaders) {
    cfGate();
    const resp = await fetch(path, {
      // X-Requested-With 跟站点自己的 XHR 口径一致。Cloudflare 的机器人规则
      // 对「裸 fetch」和「XHR」的判定并不一样，加上这个头能明显减少 403。
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", ...extraHeaders },
      credentials: "same-origin"
    });
    if (!resp.ok) {
      const challenge = isCfChallenge(resp);
      if (challenge) noteCfChallenge(); // 见过挑战 → 接下来一段时间不再发请求
      throw apiError(resp.status, challenge);
    }
    return resp.json();
  }

  /**
   * 带重试的取数。
   *
   * 只在「看起来还有救」的时候重试：CF 挑战 / 4xx（除 408/429）直接放弃，
   * 免得把限流踩得更深；网络抖动 / 5xx / 408 / 429 才重试一次，
   * 并在第二次请求上挂一个 cache-buster —— CDN 有时会把一次 403 缓存住。
   */
  async function apiWithRetry(path, extraHeaders) {
    try {
      return await api(path, extraHeaders); // 闸门在 api() 里；挑战错误不会走到重试
    } catch (err) {
      const retryable = !err.cfChallenge && (!err.status || err.status >= 500 ||
        err.status === 408 || err.status === 429);
      if (!retryable) throw err;
      await new Promise((r) => setTimeout(r, 600));
      const sep = path.includes("?") ? "&" : "?";
      return api(`${path}${sep}_cx_retry=${Date.now()}`, extraHeaders);
    }
  }

  /* ---- 接口被拦时的兜底数据源 ----------------------------------------------
   *
   * linux.do 挂在 Cloudflare 后面，`/latest.json` 之类的 JSON 端点偶尔会回 403
   * （页面 HTML 本身能打开，只有 XHR 被拦）。这时候不能只剩一个错误框：
   *   1. 页面里其实**已经有**站点自己预加载的 JSON（#data-preloaded）；
   *   2. 站点自己渲染好的原生列表 / 帖子流也还在 DOM 里。
   * 两个都试一遍，通常第一种就够（零请求、不可能被拦）。
   * ---------------------------------------------------------------------- */

  /** Discourse 把当前路由要用的数据塞在 #data-preloaded 里，值是「JSON 字符串套 JSON」 */
  function readPreloadedJson(pick) {
    try {
      const el = document.getElementById("data-preloaded");
      if (!el) return null;
      const raw = el.getAttribute("data-preloaded") || el.textContent || "";
      if (!raw) return null;
      let map;
      try { map = JSON.parse(raw); } catch { return null; }
      if (!map || typeof map !== "object") return null;
      for (const [key, value] of Object.entries(map)) {
        let data = value;
        if (typeof data === "string") {
          try { data = JSON.parse(data); } catch { continue; }
        }
        if (!data || typeof data !== "object") continue;
        try { if (pick(key, data)) return data; } catch { /* 单个 key 坏了不影响其它 */ }
      }
    } catch { /* ignore */ }
    return null;
  }

  function preloadedTopicList() {
    return readPreloadedJson((key, data) =>
      /topic.?list/i.test(key) &&
      data.topic_list && Array.isArray(data.topic_list.topics) && data.topic_list.topics.length > 0);
  }

  function preloadedTopic(topicId) {
    return readPreloadedJson((key, data) => {
      if (!data.post_stream || !Array.isArray(data.post_stream.posts) || !data.post_stream.posts.length) return false;
      if (Number(data.id) === Number(topicId)) return true;
      return new RegExp(`(^|_)${topicId}($|_)`).test(key) && /topic/i.test(key);
    });
  }

  /** "2026-10-14 11:00:00 +0800" / ISO 都能吃，统一成 Date 能解析的字符串 */
  function toIsoTime(text) {
    if (!text) return "";
    const s = String(text).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2})?/);
    if (!m) return "";
    const tz = (m[7] || "").replace(/^([+-]\d{2})(\d{2})$/, "$1:$2") || "Z";
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}${tz}`;
  }

  /** 从 "23" / "1,234" / "188 views" 这类文本里取数字（linuxdo 这版没有通用的 num()） */
  function numFromText(text) {
    const m = String(text == null ? "" : text).replace(/,/g, "").match(/-?\d+/);
    return m ? Number(m[0]) : 0;
  }

  /**
   * 最后一道兜底：从站点**已经渲染好的**原生话题列表里读数据。
   * 选择器写得比较宽（Discourse 各版本 class 名改过几轮），匹配不上就返回空数组，
   * 调用方会退回错误提示 —— 不会比现在更糟。
   */
  function scrapeNativeTopicList() {
    const out = [];
    const seen = new Set();
    const rows = document.querySelectorAll(
      "#main-outlet .topic-list-item, #main-outlet tr[data-topic-id], .topic-list-item"
    );
    for (const row of rows) {
      const link = row.querySelector("a.title, a.raw-topic-link, a.raw-link, .main-link a[href*='/t/']");
      if (!link) continue;
      const href = link.getAttribute("href") || "";
      const m = href.match(/\/t\/([^/?#]+)\/(\d+)/);
      const id = Number(row.getAttribute("data-topic-id")) || (m ? Number(m[2]) : 0);
      const title = (link.textContent || "").trim();
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);

      const cellText = (sel) => {
        const el = row.querySelector(sel);
        return el ? el.textContent : "";
      };
      const timeEl = row.querySelector(".activity .relative-date, .relative-date, .age span[title], span[title]");
      const catEl = row.querySelector("a.badge-category[href], .badge-category__wrapper[href], a[href^='/c/']");
      const catId = catEl ? Number((String(catEl.getAttribute("href") || "").match(/\/(\d+)(?:[/?]|$)/) || [])[1]) || null : null;
      const cls = String(row.className || "");
      // 原生列表里那一格显示的是「回复数」，而我们的 trowHtml 用 posts_count - 1 去渲染它
      // （见 trowHtml），所以这里 +1 换算一下：屏幕上看到的数字才能和原生列表一致。
      const shownCount = numFromText(cellText(".posts, .num.posts, .badge-posts, .posts-map .number"));

      out.push({
        id,
        title,
        slug: m ? m[1] : "",
        posts_count: Math.max(1, shownCount + 1),
        views: numFromText(cellText(".views, .num.views")),
        category_id: catId,
        pinned: /\bpinned\b/.test(cls),
        closed: /\bclosed\b/.test(cls),
        unread: /\bunread\b/.test(cls) ? 1 : 0,
        new_posts: /\bnew\b/.test(cls) ? 1 : 0,
        last_activity_at: toIsoTime(timeEl ? (timeEl.getAttribute("title") || timeEl.textContent) : ""),
        excerpt: (() => {
          const ex = row.querySelector(".topic-excerpt");
          return ex ? (ex.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) : "";
        })()
      });
    }
    return out;
  }

  /** 话题浏览上报头（对齐 Discourse 前端 trackNextAjaxAsTopicView，views +1 且服务端按天/IP 去重） */
  function trackViewHeaders(topicId) {
    return {
      "Discourse-Track-View": "true",
      "Discourse-Track-View-Topic-Id": String(topicId)
    };
  }

  /** 写请求（PUT/POST/DELETE），带 CSRF；失败抛 HTTP 状态（移植自 im bridge/api.js） */
  async function apiSend(path, method, body) {
    cfGate(); // 挑战期间连写请求也不发（这些请求此刻也不可能成功）
    const resp = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrfToken(),
        "X-Requested-With": "XMLHttpRequest",
        ...(body ? { "Content-Type": "application/json; charset=UTF-8" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json().catch(() => ({}));
  }

  function csrfToken() {
    const meta = document.querySelector("meta[name='csrf-token']");
    return meta ? meta.content : "";
  }

  /* ============================== CF 盾检测（移植自 im 皮肤 cf-guard.js 36a4cc5） ============================== */

  /** 整页被 Cloudflare challenge / 拦截时返回 true；命中后脚本停用回原皮，挑战通过后自动恢复 */
  function cfBlocked() {
    try {
      if (document.querySelector("#challenge-running, #cf-challenge-running, form#challenge-form")) {
        return true;
      }
      const title = String(document.title || "").toLowerCase().replace(/…/g, "...");
      if (
        title.startsWith("just a moment") ||
        title.includes("attention required") ||
        title.includes("请稍候")
      ) {
        return true;
      }
      if (
        document.querySelector("input[type=hidden][id^='cf-chl-widget-'][name='cf-turnstile-response']") &&
        document.querySelector(".main-wrapper[role='main'], #challenge-error-text")
      ) {
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  /* ============================== 图片灯箱（移植自 terminal 皮肤 35bd821，改 Codex 配色） ============================== */

  let activeLightbox = null;

  function lightboxKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeLightbox(); }
  }

  function closeLightbox() {
    if (activeLightbox) {
      activeLightbox.remove();
      activeLightbox = null;
      document.removeEventListener("keydown", lightboxKeydown, true);
    }
  }

  /** 点击帖子内图片：完整显示原图，滚轮缩放 / 拖动平移 / 双击在 100% 与 200% 间切换 */
  function openLightbox(src) {
    if (!src) return;
    hideImgPreview(); // 灯箱和悬浮预览别叠在一起
    closeLightbox();
    const lb = document.createElement("div");
    lb.className = "cx-lightbox";
    lb.tabIndex = -1;
    lb.innerHTML =
      `<span class="lb-side lb-open">open original ↗</span>` +
      `<span class="lb-side lb-close">esc close</span>` +
      `<img src="${escapeHtml(src)}" alt="" draggable="false">`;
    const img = lb.querySelector("img");
    let scale = 1, tx = 0, ty = 0, dragging = false, sx = 0, sy = 0;
    const apply = (smooth) => {
      img.style.transition = smooth ? "transform .18s ease" : "none";
      img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
    };
    lb.addEventListener("click", (e) => {
      if (e.target === lb || e.target.classList?.contains("lb-close")) closeLightbox();
    });
    lb.querySelector(".lb-open").addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(src, "_blank", "noopener");
    });
    img.addEventListener("wheel", (e) => {
      e.preventDefault();
      scale = Math.min(Math.max(scale * (e.deltaY < 0 ? 1.15 : 0.88), 0.3), 6);
      apply(false);
    }, { passive: false });
    img.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true; sx = e.clientX - tx; sy = e.clientY - ty;
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      tx = e.clientX - sx; ty = e.clientY - sy; apply(false);
    });
    window.addEventListener("mouseup", () => { dragging = false; });
    img.addEventListener("dblclick", () => {
      if (scale > 1.1) { scale = 1; tx = 0; ty = 0; }
      else scale = 2;
      apply(true);
    });
    document.addEventListener("keydown", lightboxKeydown, true);
    document.body.appendChild(lb);
    activeLightbox = lb;
    requestAnimationFrame(() => { lb.classList.add("open"); apply(true); lb.focus(); });
  }

  /* ============================== composer 拖图片上传（移植自 terminal 皮肤 35bd821） ============================== */

  let cxComposerSubmitting = false;
  let composerUploading = false;

  function cxTransferImages(event) {
    const list = [...(event.clipboardData?.files || event.dataTransfer?.files || [])];
    const isImage = (f) => String(f.type || "").toLowerCase().startsWith("image/");
    if (list.length) return list.filter(isImage);
    // 部分剪贴板只在 items 里暴露文件（.files 为空）
    return [...(event.clipboardData?.items || [])]
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile?.())
      .filter((f) => f && isImage(f));
  }

  async function cxUploadImage(file) {
    const form = new FormData();
    form.append("file", file, file.name || "image");
    form.append("upload_type", "composer");
    form.append("type", "composer");
    form.append("synchronous", "true");
    const response = await fetch("/uploads.json", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": csrfToken(), "X-Requested-With": "XMLHttpRequest" },
      body: form
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.errors?.[0] || payload.error || `HTTP ${response.status}`);
    }
    // Discourse 三种返回形态：扁平对象（新版）/ upload 包裹 / uploads 数组
    let upload = payload.upload || (Array.isArray(payload.uploads) ? payload.uploads[0] : null);
    if (!upload && payload && payload.id && payload.url) upload = payload;
    if (!upload) throw new Error("站点未返回图片地址");
    return upload;
  }

  function cxImageMarkdown(upload, file) {
    const url = upload.short_url || upload.url || upload.thumbnail_url;
    if (!url) throw new Error("站点未返回图片地址");
    const rawLabel = String(upload.original_filename || file?.name || "图片");
    const label = rawLabel.replace(/\.[^.]+$/, "").replace(/[[\]\\|]/g, "_");
    const width = Number(upload.thumbnail_width || upload.width) || 0;
    const height = Number(upload.thumbnail_height || upload.height) || 0;
    const dims = width > 0 && height > 0 ? `|${width}x${height}` : "";
    return `![${label}${dims}](${String(url).replace(/[\\()]/g, (ch) => `\\${ch}`)})`;
  }

  /** 原生 composer textarea 就绪后把 markdown 插入光标处（codex 的真实输入交给原生编辑器） */
  function insertMdIntoNative(md) {
    const ta = document.querySelector("#reply-control.open textarea, #reply-control.fullscreen textarea");
    if (!ta) return false;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    ta.focus();
    ta.setRangeText(md, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true })); // 触发原生 markdown 预览 / 计数
    return true;
  }

  function setComposerStatus(text, state) {
    const el = document.querySelector(".codex-composer .cx-composer-status");
    if (el) {
      el.textContent = text || "";
      el.className = "cx-composer-status" + (state ? ` cx-${state}` : "");
    }
    // 收起时工具栏整条是隐藏的：把状态同时写到细栏上，
    // 否则「正在发送…」「已发送 ✓」「发送失败」这些提示全都看不见
    const hint = document.querySelector(".codex-composer [data-composer-hint]");
    if (hint && composerCollapsed()) {
      if (text) {
        hint.textContent = text;
        hint.className = "cx-composer-mini-hint" + (state ? ` cx-${state}` : "");
        clearTimeout(hint._statusTimer);
        hint._statusTimer = setTimeout(() => syncComposerCollapsed(), 2500);
      } else {
        syncComposerCollapsed();
      }
    }
  }

  /* ============================== 嵌入 im 式 markdown 输入框（移植自 im ui/composer.js + markdown-lite.js） ==============================
     结构自上而下：目标条 → 预览条 → contenteditable 输入（Typora 式块）→ 工具栏（按用户要求置于下方）→ 隐藏 file。
     发送走后端 API（/posts.json），失败再落原生编辑器；图片粘贴/拖拽/选择统一上传后以 markdown 插入本皮输入框。 */

  /** upload:// 短链 → 直链（预览条按 short_url 登记后直接出图） */
  const CX_UPLOAD_URLS = new Map();
  function cxRegisterUploadUrl(shortUrl, url) {
    if (shortUrl && url) CX_UPLOAD_URLS.set(String(shortUrl), String(url));
  }

  /* ---- 轻量 markdown → 富文本（输入粒度按「块」渲染，预览条/渲染块共用） ---- */

  const CX_ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  function cxEsc(s) { return String(s).replace(/[&<>"]/g, (c) => CX_ESC_MAP[c]); }

  let cxEmojiMod;
  const CX_EMOJI_URLS = new Map();
  let cxEmojiScanAt = 0;
  function cxEmojiUrl(name) {
    if (cxEmojiMod === undefined) {
      cxEmojiMod = discourseRequire("pretty-text/addon/emoji") || discourseRequire("pretty-text/emoji") || null;
    }
    const url = cxEmojiMod?.emojiUrlFor?.(name);
    if (url) return url;
    if (CX_EMOJI_URLS.has(name)) return CX_EMOJI_URLS.get(name);
    const now = Date.now();
    if (now - cxEmojiScanAt > 5000) {
      cxEmojiScanAt = now;
      for (const img of document.querySelectorAll("img.emoji")) {
        const m = (img.getAttribute("alt") || "").match(/^:([a-z0-9_+-]+(?::t[2-6])?):$/i);
        if (m && img.src && !CX_EMOJI_URLS.has(m[1])) CX_EMOJI_URLS.set(m[1], img.src);
      }
    }
    return CX_EMOJI_URLS.get(name) || null;
  }

  function cxResolveImgUrl(url) {
    if (!String(url).startsWith("upload://")) return url;
    return CX_UPLOAD_URLS.get(url) || `/uploads/short-url/${url.slice("upload://".length)}`;
  }
  function cxInlineMd(src) {
    let s = cxEsc(src);
    // 图片必须先于链接：![alt|WxH](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
      const [label, dims] = alt.split("|");
      const [w, h] = String(dims || "").split("x").map((n) => parseInt(n, 10) || 0);
      const size = w > 0 && h > 0 ? ` width="${w}" height="${h}"` : "";
      return `<img class="cx-md-img" src="${cxResolveImgUrl(url)}" alt="${label}"${size}>`;
    });
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    s = s.replace(/(^|\s)@([a-zA-Z0-9_.-]+)/g, '$1<a class="cx-mention" href="/u/$2">@$2</a>');
    s = s.replace(/\[blur\]([\s\S]*?)\[\/blur\]/g, '<span class="cx-md-blur">$1</span>');
    s = s.replace(/\[date=([^\]]+)\]/g, (m, attrs) => {
      const d = attrs.match(/^([\d-]+)/)?.[1] || "";
      const t = attrs.match(/time=([\d:]+)/)?.[1] || "";
      return `<span class="cx-md-date">🕐 ${[d, t].filter(Boolean).join(" ") || attrs}</span>`;
    });
    s = s.replace(/\[\^(\d+)\]/g, "<sup>[$1]</sup>");
    s = s.replace(/:([a-z0-9_+-]+(?::t[2-6])?):/gi, (m, name) => {
      const url = cxEmojiUrl(name);
      return url ? `<img class="emoji" src="${url}" alt=":${name}:" title=":${name}:">` : m;
    });
    return s.replace(/\n/g, "<br>");
  }
  function cxSplitRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  }
  function cxParseTable(lines) {
    if (lines.length < 2 || !lines[0].includes("|")) return null;
    const sepCells = cxSplitRow(lines[1]);
    if (!sepCells.length || !sepCells.every((c) => /^:?-{3,}:?$/.test(c))) return null;
    const aligns = sepCells.map((c) =>
      (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
    const row = (cells, tag) =>
      `<tr>${cells.map((c, i) => `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${cxInlineMd(c)}</${tag}>`).join("")}</tr>`;
    const body = lines.slice(2).filter((l) => l.includes("|")).map((l) => row(cxSplitRow(l), "td")).join("");
    return `<table class="cx-md-table"><thead>${row(cxSplitRow(lines[0]), "th")}</thead><tbody>${body}</tbody></table>`;
  }
  function cxRenderInner(src) {
    const text = (src || "").trim();
    if (!text) return "";
    return text.split(/\n{2,}/).map((part) => cxMdToHtml(part)).join("");
  }
  function cxMdToHtml(src) {
    const lines = src.split("\n");
    if (/^\s*```/.test(lines[0])) {
      const body = lines.slice(1).join("\n").replace(/\n?```\s*$/, "");
      return `<pre><code>${cxEsc(body)}</code></pre>`;
    }
    if (lines.length === 1 && /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(src)) return "<hr>";
    if (/^\s*\$\$/.test(lines[0])) {
      const body = lines.slice(1).join("\n").replace(/\n?\$\$\s*$/, "");
      return `<pre class="cx-md-math"><code>${cxEsc(body)}</code></pre>`;
    }
    const details = src.match(/^\[details(?:="([^"]*)")?\]\s*\n?([\s\S]*?)\n?\[\/details\]\s*$/);
    if (details) {
      return `<details class="cx-md-details"><summary>${cxEsc(details[1] || "详细信息")}</summary>${cxRenderInner(details[2])}</details>`;
    }
    const quote = src.match(/^\[quote(?:="([^"]*)")?\]\s*\n?([\s\S]*?)\n?\[\/quote\]\s*$/);
    if (quote) {
      const who = (quote[1] || "").split(",")[0].trim();
      return `<blockquote>${who ? `<div class="cx-md-quote-head">${cxEsc(who)}：</div>` : ""}${cxRenderInner(quote[2])}</blockquote>`;
    }
    const poll = src.match(/^\[poll[^\]]*\]\s*\n?([\s\S]*?)\n?\[\/poll\]\s*$/);
    if (poll) {
      const opts = poll[1].split("\n").filter((l) => /^- /.test(l))
        .map((l) => `<li>${cxInlineMd(l.slice(2))}</li>`).join("");
      return `<div class="cx-md-poll"><div class="cx-md-poll-title">🗳 投票（发送后生效）</div><ul>${opts}</ul></div>`;
    }
    const table = cxParseTable(lines);
    if (table) return table;
    if (lines.every((l) => /^\[\^\d+\]:/.test(l))) {
      return lines.map((l) => {
        const m = l.match(/^\[\^(\d+)\]:\s*(.*)$/);
        return `<div class="cx-md-footnote"><sup>[${m[1]}]</sup> ${cxInlineMd(m[2])}</div>`;
      }).join("");
    }
    if (lines.every((l) => l.startsWith(">") || !l.trim()) && lines.some((l) => l.startsWith(">"))) {
      return `<blockquote>${lines.map((l) => cxInlineMd(l.replace(/^> ?/, ""))).join("<br>")}</blockquote>`;
    }
    if (lines.every((l) => /^- /.test(l) || !l.trim()) && lines.some((l) => /^- /.test(l))) {
      return `<ul>${lines.filter((l) => /^- /.test(l)).map((l) => {
        const item = l.slice(2);
        const task = item.match(/^\[( |x|X)\]\s+(.*)$/);
        if (task) {
          return `<li class="cx-md-task"><input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> ${cxInlineMd(task[2])}</li>`;
        }
        return `<li>${cxInlineMd(item)}</li>`;
      }).join("")}</ul>`;
    }
    if (lines.every((l) => /^\d+\. /.test(l) || !l.trim()) && lines.some((l) => /^\d+\. /.test(l))) {
      return `<ol>${lines.filter((l) => /^\d+\. /.test(l)).map((l) => `<li>${cxInlineMd(l.replace(/^\d+\. /, ""))}</li>`).join("")}</ol>`;
    }
    const heading = src.match(/^(#{1,4}) (.*)$/s);
    if (heading) {
      const tag = `h${heading[1].length + 1}`; // Discourse 语义：# 渲染为 h2
      return `<${tag}>${cxInlineMd(heading[2])}</${tag}>`;
    }
    return `<p>${cxInlineMd(src)}</p>`;
  }

  /* ---- 工具条图标（Font Awesome 6 Free，与 Discourse 原生 composer 同源） ---- */

  const CX_EDITOR_ICONS = {
    bold: `<svg width="16" height="16" viewBox="0 0 384 512" fill="currentColor"><path d="M0 64C0 46.3 14.3 32 32 32l48 0 16 0 128 0c70.7 0 128 57.3 128 128c0 31.3-11.3 60.1-30 82.3c37.1 22.4 62 63.1 62 109.7c0 70.7-57.3 128-128 128L96 480l-16 0-48 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l16 0 0-160L48 96 32 96C14.3 96 0 81.7 0 64zM224 224c35.3 0 64-28.7 64-64s-28.7-64-64-64L112 96l0 128 112 0zM112 288l0 128 144 0c35.3 0 64-28.7 64-64s-28.7-64-64-64l-32 0-112 0z"/></svg>`,
    italic: `<svg width="16" height="16" viewBox="0 0 384 512" fill="currentColor"><path d="M128 64c0-17.7 14.3-32 32-32l192 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-58.7 0L160 416l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 480c-17.7 0-32-14.3-32-32s14.3-32 32-32l58.7 0L224 96l-64 0c-17.7 0-32-14.3-32-32z"/></svg>`,
    heading: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.7955 5.57376C8.16545 5.57379 7.7574 6.01638 7.7574 6.33616V7.96517C7.7574 8.58191 9.1145 8.58191 9.1145 7.96517V7.1343H11.0822L11.1102 10.8732H10.1584C9.42007 10.8733 9.42004 12.4337 10.1584 12.4338H13.5884C14.3268 12.4337 14.3268 10.8733 13.5884 10.8732H12.6853L12.6574 7.1343H14.6174V7.96517C14.6174 8.58191 16 8.60641 16 7.98968V6.36066C16 6.04088 15.66 5.57379 15.03 5.57376H8.7955Z"/><path d="M0.778442 0C0.155688 0 0 0.66007 0 0.990106V2.57251C0 3.85876 1.715 3.85876 1.715 2.57251C1.715 1.28625 1.715 1.715 1.715 1.715H4.21453V10.5513H2.62724C1.89745 10.5513 1.84272 12.4338 2.57251 12.4338H7.30397C8.03376 12.4338 8.08849 10.5513 7.35871 10.5513H5.77141V1.715H8.57502V2.57251C8.57502 3.85876 10.29 3.70423 10.29 2.57251V0.857502C10.29 0.527467 9.83026 0 9.2075 0H0.778442Z"/></svg>`,
    strike: `<svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor"><path d="M161.3 144c3.2-17.2 14-30.1 33.7-38.6c21.1-9 51.8-12.3 88.6-6.5c11.9 1.9 48.8 9.1 60.1 12c17.1 4.5 34.6-5.6 39.2-22.7s-5.6-34.6-22.7-39.2c-14.3-3.8-53.6-11.4-66.6-13.4c-44.7-7-88.3-4.2-123.7 10.9c-36.5 15.6-64.4 44.8-71.8 87.3c-.1 .6-.2 1.1-.2 1.7c-2.8 23.9 .5 45.6 10.1 64.6c4.5 9 10.2 16.9 16.7 23.9L32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l448 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-209.9 0-.4-.1-1.1-.3c-36-10.8-65.2-19.6-85.2-33.1c-9.3-6.3-15-12.6-18.2-19.1c-3.1-6.1-5.2-14.6-3.8-27.4zM348.9 337.2c2.7 6.5 4.4 15.8 1.9 30.1c-3 17.6-13.8 30.8-33.9 39.4c-21.1 9-51.7 12.3-88.5 6.5c-18-2.9-49.1-13.5-74.4-22.1c-5.6-1.9-11-3.7-15.9-5.4c-16.8-5.6-34.9 3.5-40.5 20.3s3.5 34.9 20.3 40.5c3.6 1.2 7.9 2.7 12.7 4.3c24.9 8.5 63.6 21.7 87.6 25.6l.2 0c44.7 7 88.3 4.2 123.7-10.9c36.5-15.6 64.4-44.8 71.8-87.3c3.6-21 2.7-40.4-3.1-58.1l-75.7 0c7 5.6 11.4 11.2 13.9 17.2z"/></svg>`,
    link: `<svg width="16" height="16" viewBox="0 0 640 512" fill="currentColor"><path d="M579.8 267.7c56.5-56.5 56.5-148 0-204.5c-50-50-128.8-56.5-186.3-15.4l-1.6 1.1c-14.4 10.3-17.7 30.3-7.4 44.6s30.3 17.7 44.6 7.4l1.6-1.1c32.1-22.9 76-19.3 103.8 8.6c31.5 31.5 31.5 82.5 0 114L422.3 334.8c-31.5 31.5-82.5 31.5-114 0c-27.9-27.9-31.5-71.8-8.6-103.8l1.1-1.6c10.3-14.4 6.9-34.4-7.4-44.6s-34.4-6.9-44.6 7.4l-1.1 1.6C206.5 251.2 213 330 263 380c56.5 56.5 148 56.5 204.5 0L579.8 267.7zM60.2 244.3c-56.5 56.5-56.5 148 0 204.5c50 50 128.8 56.5 186.3 15.4l1.6-1.1c14.4-10.3 17.7-30.3 7.4-44.6s-30.3-17.7-44.6-7.4l-1.6 1.1c-32.1 22.9-76 19.3-103.8-8.6C74 372 74 321 105.5 289.5L217.7 177.2c31.5-31.5 82.5-31.5 114 0c27.9 27.9 31.5 71.8 8.6 103.9l-1.1 1.6c-10.3 14.4-6.9 34.4 7.4 44.6s34.4 6.9 44.6-7.4l1.1-1.6C433.5 260.8 427 182 377 132c-56.5-56.5-148-56.5-204.5 0L60.2 244.3z"/></svg>`,
    quote: `<svg width="16" height="16" viewBox="0 0 448 512" fill="currentColor"><path d="M448 296c0 66.3-53.7 120-120 120l-8 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l8 0c30.9 0 56-25.1 56-56l0-8-64 0c-35.3 0-64-28.7-64-64l0-64c0-35.3 28.7-64 64-64l64 0c35.3 0 64 28.7 64 64l0 32 0 32 0 72zm-256 0c0 66.3-53.7 120-120 120l-8 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l8 0c30.9 0 56-25.1 56-56l0-8-64 0c-35.3 0-64-28.7-64-64l0-64c0-35.3 28.7-64 64-64l64 0c35.3 0 64 28.7 64 64l0 32 0 32 0 72z"/></svg>`,
    code: `<svg width="16" height="16" viewBox="0 0 640 512" fill="currentColor"><path d="M392.8 1.2c-17-4.9-34.7 5-39.6 22l-128 448c-4.9 17 5 34.7 22 39.6s34.7-5 39.6-22l128-448c4.9-17-5-34.7-22-39.6zm80.6 120.1c-12.5 12.5-12.5 32.8 0 45.3L562.7 256l-89.4 89.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l112-112c12.5-12.5 12.5-32.8 0-45.3l-112-112c-12.5-12.5-32.8-12.5-45.3 0zm-306.7 0c-12.5-12.5-32.8-12.5-45.3 0l-112 112c-12.5 12.5-12.5 32.8 0 45.3l112 112c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256l89.4-89.4c12.5-12.5 12.5-32.8 0-45.3z"/></svg>`,
    listUl: `<svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor"><path d="M64 144a48 48 0 1 0 0-96 48 48 0 1 0 0 96zM192 64c-17.7 0-32 14.3-32 32s14.3 32 32 32l288 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L192 64zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l288 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-288 0zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l288 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-288 0zM64 464a48 48 0 1 0 0-96 48 48 0 1 0 0 96zm48-208a48 48 0 1 0 -96 0 48 48 0 1 0 96 0z"/></svg>`,
    listOl: `<svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor"><path d="M24 56c0-13.3 10.7-24 24-24l32 0c13.3 0 24 10.7 24 24l0 120 16 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-80 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l16 0 0-96-8 0C34.7 80 24 69.3 24 56zM86.7 341.2c-6.5-7.4-18.3-6.9-24 1.2L51.5 357.9c-7.7 10.8-22.7 13.3-33.5 5.6s-13.3-22.7-5.6-33.5l11.1-15.6c23.7-33.2 72.3-35.6 99.2-4.9c21.3 24.4 20.8 60.9-1.1 84.7L86.8 432l33.2 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-88 0c-9.5 0-18.2-5.6-22-14.4s-2.1-18.9 4.3-25.9l72-78c5.3-5.8 5.4-14.6 .3-20.5zM224 64l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32zm0 160l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32zm0 160l256 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-256 0c-17.7 0-32-14.3-32-32s14.3-32 32-32z"/></svg>`,
    folder: `<svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor"><path d="M288 109.3L288 352c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-242.7-73.4 73.4c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3l128-128c12.5-12.5 32.8-12.5 45.3 0l128 128c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L288 109.3zM64 352l128 0c0 35.3 28.7 64 64 64s64-28.7 64-64l128 0c35.3 0 64 28.7 64 64l0 32c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64l0-32c0-35.3 28.7-64 64-64zM432 456a24 24 0 1 0 0-48 24 24 0 1 0 0 48z"/></svg>`,
    emoji: `<svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor"><path d="M464 256A208 208 0 1 0 48 256a208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm177.6 62.1C192.8 334.5 218.8 352 256 352s63.2-17.5 78.4-33.9c9-9.7 24.2-10.4 33.9-1.4s10.4 24.2 1.4 33.9c-22 23.8-60 49.4-113.6 49.4s-91.7-25.5-113.6-49.4c-9-9.7-8.4-24.9 1.4-33.9s24.9-8.4 33.9 1.4zM144.4 208a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm192-32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/></svg>`,
    plus: `<svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM232 344l0-64-64 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l64 0 0-64c0-13.3 10.7-24 24-24s24 10.7 24 24l0 64 64 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-64 0 0 64c0 13.3-10.7 24-24 24s-24-10.7-24-24z"/></svg>`,
    preview: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>`
  };
  const CX_TOOL_TITLES = {
    bold: "粗体（⌘/Ctrl+B）",
    italic: "强调（⌘/Ctrl+I）",
    heading: "文本大小（循环 标题2→3→4→正文）",
    strike: "删除线",
    link: "链接（⌘/Ctrl+K）",
    quote: "块引用",
    code: "代码（⌘/Ctrl+E，多行自动围栏）",
    listUl: "无序列表",
    listOl: "有序列表",
    folder: "上传图片",
    emoji: "表情符号",
    plus: "更多（表格 / 日期 / 公式 / 投票…）",
    preview: "实时预览"
  };
  function cxComposerToolbarHtml() {
    const seq = ["bold", "italic", "heading", "strike", "link", "quote", "code", "listUl", "listOl", "folder", "emoji", "plus", "preview"];
    return seq.map((k) =>
      `<button type="button" class="cx-tool-btn" data-tool="${k}" title="${CX_TOOL_TITLES[k]}"${k === "folder" ? ` data-upload="1"` : ""}>${CX_EDITOR_ICONS[k]}</button>`
    ).join("") + `<span class="cx-composer-status"></span>` +
      `<button type="button" class="cx-tool-btn" data-composer-toggle="collapse" title="收起输入框（只留一条细栏）">${ICONS.chevronDown}</button>` +
      `<button type="button" class="codex-composer-send" title="发送（Enter）" disabled>${ICONS.send}</button>`;
  }

  /* ---- 底部输入框的收起 / 展开 -------------------------------------------
   *
   * 收起后只留一条细栏（草稿、目标楼、发送状态都还在），点细栏或箭头展开回来。
   * 状态存在设置里（composerCollapsed），刷新和换路由都保持；用户点「回复」某个
   * 楼层时必须自动展开，否则等于把回复入口藏了。
   * ---------------------------------------------------------------------- */

  function composerCollapsed() {
    return !!cfg("composerCollapsed");
  }

  /** 把收起状态刷到 DOM 上（幂等；composer 还没建时直接跳过） */
  function syncComposerCollapsed() {
    const card = document.querySelector(".codex-composer");
    if (!card) return;
    const collapsed = composerCollapsed();
    card.classList.toggle("cx-collapsed", collapsed);
    const hint = card.querySelector("[data-composer-hint]");
    if (hint) {
      const input = card.querySelector(".cx-md-edit");
      const draft = input && !cxMdIsEmpty(input);
      const target = card.querySelector(".cx-compose-target.active span");
      // 细栏上要能看出「这里现在是回复谁 / 有没有草稿」，不然收起来就瞎了
      hint.textContent = draft
        ? "草稿已收起（点这里继续写）"
        : target && target.textContent
          ? target.textContent
          : (input && input.dataset.placeholder) || "写点什么…";
    }
  }

  function setComposerCollapsed(on, persist) {
    const next = !!on;
    if (persist) {
      setCfg("composerCollapsed", next, { visualOnly: true }); // 落盘 + 刷视觉，不重建 DOM
    } else {
      if (!SETTINGS) SETTINGS = loadSettings();
      SETTINGS.composerCollapsed = next;
      syncComposerCollapsed();
      syncSettingControls();
    }
    if (!next) {
      // 展开时把光标送进输入框：收起 → 展开 → 直接能打字
      const input = document.querySelector(".codex-composer .cx-md-edit");
      input?.focus?.();
    }
  }

  /* ---- 块级编辑器核心（聚焦块显示原文，其余块实时渲染） ---- */

  function cxMdBlocks(input) { return [...input.querySelectorAll(".cx-md-block")]; }
  function cxMdEnsureBlock(input) {
    if (!input.querySelector(".cx-md-block")) {
      const b = document.createElement("div");
      b.className = "cx-md-block";
      input.appendChild(b);
    }
  }
  function cxMdIsEmpty(input) { return !cxMdGetSource(input); }
  function cxMdGetSource(input) {
    return cxMdBlocks(input).map((b) => (b.dataset.src ?? b.innerText).trim()).filter(Boolean).join("\n\n");
  }
  function cxMdSyncActive(input) {
    const sel = getSelection();
    const node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const block = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.(".cx-md-block");
    if (block?.parentNode === input) block.dataset.src = block.innerText;
    input.classList.toggle("has-content", !cxMdIsEmpty(input));
    cxSyncPreview(input);
    cxUpdateSendState();
  }
  function cxMdRenderBlock(block) {
    const src = (block.dataset.src ?? "").trim();
    block.classList.add("is-rendered");
    block.innerHTML = src ? cxMdToHtml(src) : "";
  }
  function cxMdEditBlock(block) {
    block.textContent = block.dataset.src ?? block.innerText;
    block.classList.remove("is-rendered");
  }
  function cxMdRenderAll(input) {
    const src = cxMdGetSource(input);
    const parts = src ? src.split(/\n{2,}/) : [""];
    input.innerHTML = "";
    for (const part of parts) {
      const b = document.createElement("div");
      b.className = "cx-md-block";
      b.dataset.src = part;
      input.appendChild(b);
      cxMdRenderBlock(b);
    }
    input.classList.toggle("has-content", !!src);
  }
  function cxMdClear(input) {
    input.innerHTML = "";
    cxMdEnsureBlock(input);
    input.classList.remove("has-content");
    cxSyncPreview(input);
    cxUpdateSendState();
  }
  function cxPlaceCaretEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function cxActiveBlock() {
    const sel = getSelection();
    const node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return el?.closest?.(".cx-md-block") ?? null;
  }
  function cxInsertAtCaret(text) {
    const lines = String(text).split("\n");
    document.execCommand("insertText", false, lines[0]);
    for (let i = 1; i < lines.length; i++) {
      document.execCommand("insertLineBreak");
      document.execCommand("insertText", false, lines[i]);
    }
  }
  function cxEnsureActiveBlock(input) {
    let block = cxActiveBlock();
    if (!block) {
      input.focus({ preventScroll: true });
      block = cxActiveBlock();
      if (!block) {
        block = cxMdBlocks(input).at(-1);
        if (block) cxPlaceCaretEnd(block);
      }
    }
    if (block?.classList.contains("is-rendered")) {
      cxMdEditBlock(block);
      cxPlaceCaretEnd(block);
    }
    return block ?? null;
  }
  function cxCurrentSelText() {
    const sel = getSelection();
    return sel.rangeCount ? sel.getRangeAt(0).toString() : "";
  }
  function cxSelectBack(skipTail, len) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    let node = r.startContainer;
    if (node.nodeType !== 3) node = node.lastChild;
    if (!node || node.nodeType !== 3) return;
    const end = node.length - skipTail;
    if (len <= 0 || end < 0 || end - len < 0) return;
    const range = document.createRange();
    range.setStart(node, end - len);
    range.setEnd(node, end);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function cxInsertComposeText(input, text) {
    if (!text) return;
    input.focus({ preventScroll: true });
    const sel = getSelection();
    if (!sel.rangeCount || !input.contains(sel.getRangeAt(0).startContainer)) {
      cxPlaceCaretEnd(input);
    }
    cxInsertAtCaret(text);
    cxMdSyncActive(input);
  }

  /* ---- Markdown 格式工具（语义参考 Discourse composer toolbar） ---- */

  function cxApplyWrap(mark, placeholder) {
    const text = cxCurrentSelText();
    if (text.length >= mark.length * 2 && text.startsWith(mark) && text.endsWith(mark)) {
      cxInsertAtCaret(text.slice(mark.length, text.length - mark.length));
      return;
    }
    cxInsertAtCaret(mark + (text || placeholder) + mark);
    if (!text) cxSelectBack(mark.length, placeholder.length);
  }
  function cxApplyLinePrefix(input, kind) {
    cxTransformBlock(input, (src) => {
      const lines = src.split("\n");
      const markOf = (i) => (kind === "quote" ? "> " : kind === "ul" ? "- " : `${i + 1}. `);
      const allMarked = lines.every((line, i) => !line.trim() || line.startsWith(markOf(i)));
      return lines
        .map((line, i) => {
          const mark = markOf(i);
          if (allMarked) return line.startsWith(mark) ? line.slice(mark.length) : line;
          return mark + line;
        })
        .join("\n");
    });
  }
  function cxTransformBlock(input, fn) {
    const block = cxEnsureActiveBlock(input);
    if (!block) return;
    block.dataset.src = fn(block.dataset.src ?? block.innerText);
    block.textContent = block.dataset.src;
    cxPlaceCaretEnd(block);
    cxMdSyncActive(input);
  }
  function cxApplyCodeFormat(selText) {
    if (selText.includes("\n")) cxInsertAtCaret("\n```\n" + selText.replace(/\n+$/, "") + "\n```\n");
    else cxApplyWrap("`", "代码");
  }
  function cxApplyLinkFormat() {
    const text = cxCurrentSelText();
    cxInsertAtCaret(`[${text || "链接文字"}](https://)`);
    if (text) cxSelectBack(1, 8);
    else cxSelectBack(10, "链接文字".length);
  }
  function cxApplyHeadingFormat(input) {
    cxTransformBlock(input, (src) => {
      const lines = src.split("\n");
      const levelOf = (line) => (line.match(/^#{1,4} /)?.[0].length ?? 0) - 1;
      const levels = lines.map(levelOf);
      const cur = levels[0];
      const next = levels.every((lv) => lv === cur) && cur > 0 ? (cur === 4 ? 0 : cur + 1) : 2;
      return lines
        .map((line, i) => {
          const stripped = line.replace(/^#{1,4} /, "");
          return next === 0 ? stripped : `${"#".repeat(next)} ${levels[i] > 0 ? stripped : line}`;
        })
        .join("\n");
    });
  }
  function cxApplyMarkdownFormat(input, kind) {
    if (!input) return;
    cxEnsureActiveBlock(input);
    const text = cxCurrentSelText();
    switch (kind) {
      case "bold": return cxApplyWrap("**", "加粗文字");
      case "italic": return cxApplyWrap("*", "斜体文字");
      case "strike": return cxApplyWrap("~~", "删除文字");
      case "heading": return cxApplyHeadingFormat(input);
      case "code": return cxApplyCodeFormat(text);
      case "link": return cxApplyLinkFormat();
      case "quote": return cxApplyLinePrefix(input, "quote");
      case "listUl": return cxApplyLinePrefix(input, "ul");
      case "listOl": return cxApplyLinePrefix(input, "ol");
    }
  }

  /* ---- 预览条 ---- */

  function cxIsPreviewOn() {
    return !!cfg("composePreview");
  }
  function cxSyncPreview(input) {
    const preview = input?.closest(".codex-composer")?.querySelector(".cx-compose-preview");
    if (!preview || !preview.classList.contains("active")) return;
    const src = cxMdGetSource(input);
    preview.innerHTML = src
      ? src.split(/\n{2,}/).map((part) => `<div class="cx-md-block is-rendered">${cxMdToHtml(part)}</div>`).join("")
      : "";
    preview.classList.toggle("is-empty", !src);
  }
  function cxTogglePreview(btn, input) {
    const preview = input.closest(".codex-composer")?.querySelector(".cx-compose-preview");
    if (!preview) return;
    const on = !preview.classList.contains("active");
    preview.classList.toggle("active", on);
    btn.classList.toggle("active", on);
    setCfg("composePreview", on);
    if (on) cxSyncPreview(input);
  }

  /* ---- 弹层（表情选择器 + 更多菜单） ---- */

  const CX_QUICK_EMOJI = [
    "😀", "😅", "😂", "🤣", "😊", "😍", "😘", "😜",
    "🤔", "😎", "🥳", "😴", "🙄", "😮", "😢", "😡",
    "🤝", "👍", "👎", "👏", "🙏", "💪", "🚀", "🔥",
    "✅", "❌", "⚡", "🎉", "❤️", "💔", "🤡", "🙈",
    "💯", "🤖", "👀", "🫡"
  ];
  let cxPopEl = null;
  let cxPopOutsideClose = null;
  function cxClosePop() {
    if (!cxPopEl) return;
    cxPopEl.remove();
    cxPopEl = null;
    if (cxPopOutsideClose) {
      document.removeEventListener("mousedown", cxPopOutsideClose);
      cxPopOutsideClose = null;
    }
  }
  function cxOpenPop(btn, className, html) {
    cxClosePop();
    cxPopEl = document.createElement("div");
    cxPopEl.className = className;
    cxPopEl.innerHTML = html;
    document.body.appendChild(cxPopEl);
    const rect = btn.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - cxPopEl.offsetWidth - 8));
    const top = Math.max(8, rect.top - cxPopEl.offsetHeight - 8);
    cxPopEl.style.left = left + "px";
    cxPopEl.style.top = top + "px";
    cxPopEl.addEventListener("mousedown", (e) => e.preventDefault());
    cxPopOutsideClose = (e) => {
      if (!cxPopEl?.contains(e.target)) cxClosePop();
    };
    document.addEventListener("mousedown", cxPopOutsideClose);
  }
  function cxNativeEmojiPicker(btn, onPick) {
    const owner = getEmberOwner();
    const menu = owner && safeLookup(owner, "service:menu");
    const detached = discourseRequire("discourse/components/emoji-picker/detached")?.default;
    if (!menu || !detached) return false;
    try {
      menu.show(btn, {
        identifier: "emoji-picker",
        groupIdentifier: "emoji-picker",
        component: detached,
        modalForMobile: true,
        data: { didSelectEmoji: (emoji) => onPick(emoji) }
      });
      return true;
    } catch { return false; }
  }
  function cxToggleEmojiPicker(btn, input) {
    if (cxNativeEmojiPicker(btn, (emoji) => cxInsertComposeText(input, `:${emoji}:`))) return;
    if (cxPopEl?.classList.contains("cx-emoji-pop")) return cxClosePop();
    cxOpenPop(btn, "cx-emoji-pop", `<div class="cx-emoji-grid">${CX_QUICK_EMOJI.map(
      (e) => `<button type="button" class="cx-emoji-item">${e}</button>`
    ).join("")}</div>`);
    cxPopEl.addEventListener("click", (e) => {
      const item = e.target.closest(".cx-emoji-item");
      if (!item) return;
      cxInsertComposeText(input, item.textContent);
      cxClosePop();
    });
  }
  function cxLocalDateMarkup() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
    return `[date=${date} time=${time} timezone="${tz}"] `;
  }
  function cxSurroundWith(input, before, after, placeholder) {
    const text = cxCurrentSelText();
    cxInsertComposeText(input, before + (text || placeholder) + after);
  }
  function cxInsertBlock(input, text) {
    cxInsertComposeText(input, text);
  }
  function cxEditorInsertQuoteOfTarget(input) {
    const targetPost = cxComposerTargetPost || Math.max(0, ...Object.keys(threadState.postsByNum || {}).map(Number));
    const post = threadState.postsByNum && threadState.postsByNum[targetPost];
    if (post?.id) {
      fetch(`/posts/${post.id}.json`, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => cxInsertBlock(input, `[quote="${data.username}, post:${data.post_number}"]\n${data.raw}\n[/quote]`))
        .catch(() => setComposerStatus("引用加载失败", "err"));
    } else {
      setComposerStatus("未找到可引用的楼层", "err");
    }
  }
  const CX_PLUS_ACTIONS = {
    quote: cxEditorInsertQuoteOfTarget,
    table: (input) => cxInsertBlock(input, "| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n"),
    scroll: (input) => cxSurroundWith(input, "[wrap=scroll]\n", "\n[/wrap]", "内容"),
    mermaid: (input) => cxInsertBlock(input, "```mermaid\nflowchart TD\n  A --> B\n```\n"),
    chart: (input) => cxInsertBlock(input, '```chart\n{"title":"图表标题","type":"bar","data":{"labels":["一","二"],"series":[[1,2]]}}\n```\n'),
    details: (input) => cxSurroundWith(input, '[details="标题"]\n', "\n[/details]\n", "内容"),
    graphviz: (input) => cxInsertBlock(input, "[graphviz]\ndigraph G {\n  A -> B;\n}\n[/graphviz]\n"),
    date: (input) => cxInsertBlock(input, cxLocalDateMarkup()),
    math: (input) => cxInsertBlock(input, "$$\n公式\n$$\n"),
    blur: (input) => cxSurroundWith(input, "[blur]", "[/blur]", "内容"),
    poll: (input) => cxInsertBlock(input, "[poll]\n- 选项一\n- 选项二\n[/poll]\n"),
    wrap: (input) => cxSurroundWith(input, "[wrap]\n", "\n[/wrap]", "内容")
  };
  const CX_PLUS_ITEMS = [
    { id: "quote", ico: "💬", label: "引用整个帖子" },
    { id: "table", ico: "▦", label: "插入表" },
    { id: "scroll", ico: "📜", label: "插入滚动内容" },
    { id: "mermaid", ico: "🧩", label: "Mermaid 图表" },
    { id: "chart", ico: "📈", label: "Build Chart" },
    { id: "details", ico: "▸", label: "隐藏详细信息" },
    { id: "graphviz", ico: "🕸", label: "插入 Graphviz" },
    { id: "date", ico: "🕐", label: "插入日期/时间" },
    { id: "math", ico: "√", label: "插入公式" },
    { id: "blur", ico: "🫧", label: "模糊剧透" },
    { id: "poll", ico: "🗳", label: "构建投票" },
    { id: "wrap", ico: "❏", label: "应用换行" }
  ];
  function cxTogglePlusPop(btn, input) {
    if (cxPopEl?.classList.contains("cx-plus-pop")) return cxClosePop();
    cxOpenPop(btn, "cx-plus-pop", CX_PLUS_ITEMS.map(
      (it) => `<button type="button" class="cx-plus-item" data-act="${it.id}"><span class="ico">${it.ico}</span>${it.label}</button>`
    ).join(""));
    cxPopEl.addEventListener("click", (e) => {
      const item = e.target.closest(".cx-plus-item");
      if (!item) return;
      const act = item.dataset.act;
      cxClosePop();
      input.focus();
      CX_PLUS_ACTIONS[act]?.(input);
    });
  }

  /* ---- 目标回复条 ---- */

  let cxComposerTargetPost = null;
  function cxComposerUi() {
    const card = document.querySelector(".codex-composer");
    return {
      card,
      input: card?.querySelector(".cx-md-edit"),
      target: card?.querySelector(".cx-compose-target"),
      send: card?.querySelector(".codex-composer-send"),
      status: card?.querySelector(".cx-composer-status")
    };
  }
  function cxSetComposerTarget(postNumber) {
    cxComposerTargetPost = postNumber ? Number(postNumber) : null;
    const { target, input } = cxComposerUi();
    if (!target) return;
    if (!cxComposerTargetPost) {
      target.classList.remove("active");
      return;
    }
    const post = threadState.postsByNum[String(cxComposerTargetPost)];
    const name = post?.name || post?.username;
    target.querySelector("span").textContent = name ? `回复 ${name} · #${cxComposerTargetPost}` : `回复 #${cxComposerTargetPost}`;
    target.classList.add("active");
    // 收起状态下点「回复」必须先把输入框放出来，不然用户以为没反应
    if (composerCollapsed()) setComposerCollapsed(false, true);
    input?.focus();
  }
  function cxHideComposerTarget() {
    cxComposerTargetPost = null;
    const { target } = cxComposerUi();
    if (target) target.classList.remove("active");
  }

  /* ---- 图片上传：选择 / 粘贴 / 拖拽 → markdown 插入输入框 ---- */

  function cxImageFile(file) {
    if (!file) return false;
    if (String(file.type || "").toLowerCase().startsWith("image/")) return true;
    return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(String(file.name || ""));
  }
  async function cxUploadComposerImages(files, input) {
    const selected = [...(files || [])].filter(cxImageFile);
    if (!selected.length) {
      setComposerStatus("请选择图片文件", "err");
      return;
    }
    if (composerUploading) {
      setComposerStatus("已有图片正在上传，请稍候", "err");
      return;
    }
    composerUploading = true;
    cxUpdateSendState();
    try {
      const marks = [];
      for (const file of selected) {
        setComposerStatus(`正在上传 ${file.name || "图片"}…`, "busy");
        const upload = await cxUploadImage(file);
        cxRegisterUploadUrl(upload.short_url, upload.url || upload.thumbnail_url);
        marks.push(cxImageMarkdown(upload, file));
      }
      const inputEl = input || cxComposerUi().input;
      if (inputEl) {
        cxInsertComposeText(inputEl, marks.join("\n"));
        setComposerStatus(`已添加 ${marks.length} 张图片`, "ok");
      } else {
        copyText(marks.join("\n"));
        setComposerStatus(`已上传，md 已复制到剪贴板`, "ok");
      }
    } catch (e) {
      setComposerStatus(`上传失败: ${(e && e.message) || "未知错误"}`, "err");
    } finally {
      composerUploading = false;
      cxUpdateSendState();
    }
  }
  function cxComposerTransferImages(event) {
    return cxTransferImages(event); // 复用顶层工具函数
  }

  /* ---- 发送：API 直发（/posts.json），失败转原生编辑器 ---- */

  function cxUpdateSendState() {
    const { input, send } = cxComposerUi();
    if (!input || !send) return;
    send.disabled = cxComposerSubmitting || composerUploading || cxMdIsEmpty(input);
  }
  async function cxApiReply(raw, topicId, replyTo) {
    const body = { raw, topic_id: Number(topicId) };
    if (replyTo) body.reply_to_post_number = Number(replyTo);
    const resp = await fetch("/posts.json", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-CSRF-Token": csrfToken(),
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify(body)
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(payload.errors?.[0] || payload.error || `HTTP ${resp.status}`);
    }
    const post = payload.post || payload.created_post || payload;
    if (!post || (!post.id && !post.post_id)) throw new Error("站点未确认回复");
    return post;
  }
  async function cxNativeReply(raw, replyTo) {
    openNativeComposer(replyTo);
    let ta = null;
    for (let i = 0; i < 60 && !ta; i++) {
      await new Promise((r) => setTimeout(r, 100));
      ta = document.querySelector("#reply-control.open textarea, #reply-control.fullscreen textarea, #reply-control textarea");
    }
    if (!ta) throw new Error("无法打开原生编辑器");
    ta.focus();
    ta.value = raw;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const btn = document.querySelector(
      "#reply-control .save-or-cancel button.create, .save-or-cancel button.btn-primary, #reply-control button.create.btn-primary"
    );
    if (!btn) throw new Error("找不到原生提交按钮");
    btn.click();
  }
  function cxCompleteComposerSend(input) {
    cxMdClear(input);
    cxHideComposerTarget();
  }
  async function cxSubmitComposer() {
    const { input } = cxComposerUi();
    const raw = input ? cxMdGetSource(input) : "";
    if (!input || !raw.trim() || cxComposerSubmitting || composerUploading) return;
    const topicId = Number(threadState.topicId || 0);
    // 列表视图：内容原样转入原生「发新帖」编辑器（标题由用户补）
    if (!topicId) {
      if (!getCurrentUsername()) {
        setComposerStatus("登录后才能发帖", "err");
        return;
      }
      setComposerStatus("正在打开发帖编辑器…", "busy");
      openNewTopicComposer();
      let inserted = false;
      for (let i = 0; i < 60 && !inserted; i++) {
        await new Promise((r) => setTimeout(r, 100));
        inserted = insertMdIntoNative(raw);
      }
      if (inserted) {
        cxCompleteComposerSend(input);
        setComposerStatus("正文已转入原生发帖编辑器 ✓", "ok");
      } else {
        setComposerStatus("打开发帖编辑器失败", "err");
      }
      return;
    }
    cxComposerSubmitting = true;
    cxUpdateSendState();
    setComposerStatus("正在发送…", "busy");
    const replyTo = cxComposerTargetPost || undefined;
    try {
      try {
        await cxApiReply(raw, topicId, replyTo);
        cxCompleteComposerSend(input);
        setComposerStatus("已发送 ✓", "ok");
        refreshAfterReply();
      } catch (apiError) {
        setComposerStatus(`接口发送失败，转入原生编辑器：${apiError.message || ""}`, "err");
        try {
          await cxNativeReply(raw, replyTo);
          cxCompleteComposerSend(input);
          setComposerStatus("已通过原生编辑器发送 ✓", "ok");
        } catch (nativeError) {
          setComposerStatus(`发送失败：${nativeError.message || apiError.message || "未知错误"}`, "err");
        }
      }
    } finally {
      cxComposerSubmitting = false;
      cxUpdateSendState();
    }
  }
  /** 发送成功后重拉话题，把新楼层并入线程（长帖也只显示最近一页，与 loadTopic 语义一致） */
  async function refreshAfterReply() {
    const topicId = threadState.topicId;
    if (!topicId) return;
    try {
      const data = await apiWithRetry(`/t/${topicId}.json`);
      if (threadState.topicId !== topicId) return;
      const posts = (data.post_stream && data.post_stream.posts) || [];
      threadState.stream = (data.post_stream && data.post_stream.stream) || posts.map((p) => p.id);
      threadState.renderedFirstIdx = 0;
      threadState.renderedLastIdx = threadState.stream.length - 1;
      threadState.hasOlder = false;
      threadState.hasNewer = false;
      threadState.postsCount = data.posts_count || posts.length;
      for (const p of posts) {
        if (p.post_number) threadState.postsByNum[p.post_number] = p;
      }
      const box = detailContainer();
      if (box && posts.length) {
        renderTurns(box, posts, "replace");
        syncThreadDivider();
        const scroller = document.querySelector(".cx-view-detail");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      }
      syncChrome();
    } catch { /* 保留现状 */ }
  }

  /* ---- 交互绑定（幂等） ---- */

  function cxWireComposer(card) {
    const input = card.querySelector(".cx-md-edit");
    if (!input || input.dataset.cxWired === "1") return;
    input.dataset.cxWired = "1";
    cxMdEnsureBlock(input);

    const send = card.querySelector(".codex-composer-send");
    const fileInput = card.querySelector(".cx-composer-file");
    const targetClose = card.querySelector(".cx-compose-target button");

    function onInput() {
      cxMdSyncActive(input);
    }
    input.addEventListener("input", onInput);
    // 点击已渲染块 → 还原原文编辑，光标落在点击处（同 im）
    input.addEventListener("mousedown", (e) => {
      const block = e.target.closest?.(".cx-md-block");
      if (!block?.classList.contains("is-rendered")) return;
      if (document.activeElement === input) {
        e.preventDefault();
        cxMdEditBlock(block);
        const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
        const sel = getSelection();
        if (r && block.contains(r.startContainer)) {
          sel.removeAllRanges();
          sel.addRange(r);
        } else {
          cxPlaceCaretEnd(block);
        }
      } else {
        input._caretAt = { x: e.clientX, y: e.clientY };
      }
    });
    input.addEventListener("focusin", () => {
      // 收起状态下被聚焦（比如点了「回复」某楼）→ 自动展开，否则等于把输入框藏了
      if (composerCollapsed()) setComposerCollapsed(false, true);
      const at = input._caretAt;
      input._caretAt = null;
      let hit = at && document.caretRangeFromPoint?.(at.x, at.y);
      let block = hit && (hit.startContainer.nodeType === 1 ? hit.startContainer : hit.startContainer.parentElement)?.closest?.(".cx-md-block");
      if (block) {
        if (block.classList.contains("is-rendered")) cxMdEditBlock(block);
        hit = document.caretRangeFromPoint?.(at.x, at.y);
        const sel = getSelection();
        if (hit && block.contains(hit.startContainer)) {
          sel.removeAllRanges();
          sel.addRange(hit);
        } else {
          cxPlaceCaretEnd(block);
        }
        return;
      }
      block = cxActiveBlock() ?? input.querySelector(".cx-md-block");
      if (!block) return;
      if (block.classList.contains("is-rendered")) {
        cxMdEditBlock(block);
        cxPlaceCaretEnd(block);
      }
    });
    input.addEventListener("focusout", () => {
      cxMdSyncActive(input);
      cxMdRenderAll(input);
    });
    input.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && !e.isComposing) {
        const act = { b: "bold", i: "italic", e: "code", k: "link" }[e.key.toLowerCase()];
        if (act) {
          e.preventDefault();
          e.stopPropagation();
          cxEnsureActiveBlock(input);
          cxApplyMarkdownFormat(input, act);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        e.stopPropagation();
        if (!cxMdIsEmpty(input)) cxSubmitComposer();
        return;
      }
      if (e.key === "Enter" && e.shiftKey && !e.isComposing) {
        e.preventDefault();
        document.execCommand("insertLineBreak");
        return;
      }
      if (e.key === "Backspace" && cxMdBlocks(input).length === 1 && !input.innerText.trim()) {
        e.preventDefault();
      }
    });

    send?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cxSubmitComposer();
    });

    // 点细栏本身（不只是箭头）也展开，并顺手把光标放进输入框
    card.querySelector("[data-composer-hint]")?.addEventListener("click", () => {
      if (composerCollapsed()) setComposerCollapsed(false, true);
      else input.focus();
    });

    // 工具栏：folder 走文件选择，其余按 data-tool 分发
    for (const btn of card.querySelectorAll(".cx-tool-btn")) {
      const kind = btn.dataset.tool;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 收起 / 展开按钮（工具栏上的箭头与细栏上的箭头共用这个属性）
        if (btn.dataset.composerToggle) {
          setComposerCollapsed(btn.dataset.composerToggle === "collapse", true);
          return;
        }
        if (kind === "folder") {
          fileInput?.click();
        } else if (kind === "emoji") {
          cxToggleEmojiPicker(btn, input);
        } else if (kind === "plus") {
          cxTogglePlusPop(btn, input);
        } else if (kind === "preview") {
          cxTogglePreview(btn, input);
        } else {
          cxApplyMarkdownFormat(input, kind);
        }
      });
    }
    fileInput?.addEventListener("change", (e) => {
      cxUploadComposerImages(e.target.files, input);
      e.target.value = "";
    });

    // 粘贴 / 拖拽图片 → 上传后插入输入框；纯文本粘贴统一走明文进 markdown 源
    input.addEventListener("paste", (e) => {
      const files = cxComposerTransferImages(e);
      if (files.length) {
        e.preventDefault();
        e.stopPropagation();
        cxUploadComposerImages(files, input);
        return;
      }
      const text = e.clipboardData?.getData?.("text/plain");
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        cxInsertComposeText(input, text);
      }
    });
    const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    card.addEventListener("dragover", swallow);
    card.addEventListener("drop", (e) => {
      const files = cxComposerTransferImages(e);
      if (!files.length) return;
      swallow(e);
      cxUploadComposerImages(files, input);
    });

    targetClose?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cxHideComposerTarget();
      input.focus();
    });

    // 预览条开关状态持久化恢复
    if (cxIsPreviewOn()) {
      card.querySelector(".cx-compose-preview")?.classList.add("active");
      card.querySelector('.cx-tool-btn[data-tool="preview"]')?.classList.add("active");
      cxSyncPreview(input);
    }
  }

  /* ---------- 当前用户名（移植自 feishu 脚本） ---------- */

  let cachedUsername = null;

  function normalizeUsername(name) {
    return (name || "").trim().replace(/^@/, "").toLowerCase();
  }

  function extractUsernameFromHref(href) {
    if (!href) return null;
    try {
      const path = href.startsWith("http") ? new URL(href, location.origin).pathname : href;
      const m = path.match(/^\/u\/([^/?#]+)/i);
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  }

  function readPreloadedCurrentUser() {
    try {
      const el = document.getElementById("data-preloaded");
      if (!el) return null;
      const raw = el.getAttribute("data-preloaded") || el.textContent;
      if (!raw) return null;
      const data = JSON.parse(raw);
      const candidates = [data.currentUser, data.current_user];
      for (const key of Object.keys(data || {})) {
        if (/current.?user/i.test(key)) candidates.push(data[key]);
      }
      for (const c of candidates) {
        if (!c) continue;
        const parsed = typeof c === "string" ? JSON.parse(c) : c;
        const name = parsed && (parsed.username || parsed.user?.username);
        if (name) return name;
      }
    } catch { /* ignore */ }
    return null;
  }

  function getCurrentUsername() {
    if (cachedUsername) return cachedUsername;
    try {
      const selectors = [
        "#current-user a[href*='/u/']",
        "#current-user button[data-user-card]",
        "#current-user [data-user-card]",
        "button.icon.btn-flat[data-user-card]",
        ".header-dropdown-toggle.current-user a[href*='/u/']",
        ".current-user a[href*='/u/']"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const fromHref = extractUsernameFromHref(el.getAttribute("href") || "");
        if (fromHref) {
          cachedUsername = fromHref;
          return cachedUsername;
        }
        const card = el.getAttribute("data-user-card");
        if (card) {
          cachedUsername = card;
          return cachedUsername;
        }
      }

      const img = document.querySelector("#current-user img[alt], .current-user img[alt]");
      if (img && img.alt && !/avatar|头像/i.test(img.alt)) {
        cachedUsername = img.alt.trim();
        return cachedUsername;
      }

      const preloaded = readPreloadedCurrentUser();
      if (preloaded) {
        cachedUsername = preloaded;
        return cachedUsername;
      }

      // Ember 容器兜底
      try {
        const owner =
          window.Discourse?.__container__ ||
          document.querySelector(".ember-application")?.__ember_meta__?.owner;
        const user = owner?.lookup?.("service:current-user") ||
          window.Discourse?.User?.current?.();
        const name = user?.username || user?.get?.("username");
        if (name) {
          cachedUsername = name;
          return cachedUsername;
        }
      } catch { /* ignore */ }
    } catch { /* ignore */ }
    return null;
  }

  /* ============================== 路由判定 ============================== */

  function isTopicPath(pathname) {
    return /^\/t\//.test(pathname);
  }

  function topicIdFromPath(pathname) {
    const m = pathname.match(/^\/t\/(?:[\w-]+\/)?(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function isHomePath(pathname) {
    return pathname === "/" ||
      /^\/(latest|new|unread|unseen|top|categories|hot|posted|read|bookmarks)\b/.test(pathname) ||
      /^\/c\//.test(pathname) || /^\/tag\//.test(pathname);
  }

  /** 列表 JSON 端点按路由映射 */
  function listApiForPath(pathname) {
    if (pathname === "/" || pathname === "/latest") return "/latest.json";
    if (pathname === "/new") return "/new.json";
    if (pathname === "/unread" || pathname === "/unseen") return "/unseen.json";
    if (pathname === "/top") return "/top.json";
    if (pathname === "/hot") return "/hot.json";
    if (pathname === "/posted") return "/posted.json";
    if (pathname === "/read") return "/read.json";
    if (pathname === "/bookmarks") return "/bookmarks.json";
    if (pathname === "/categories") return "/latest.json";
    const c = pathname.match(/^\/c\/([\w-]+(?:\/[\w-]+)?)/);
    if (c) return `/c/${c[1]}.json`;
    const t = pathname.match(/^\/tag\/([\w-]+)/);
    if (t) return `/tag/${t[1]}.json`;
    return "/latest.json";
  }

  /** 列表视图大标题 */
  function listTitleForPath(pathname) {
    if (pathname === "/" || pathname === "/latest") return "最新";
    if (pathname === "/new") return "新话题";
    if (pathname === "/unread" || pathname === "/unseen") return "未读";
    if (pathname === "/top") return "排行榜";
    if (pathname === "/hot") return "热门";
    if (pathname === "/posted") return "我的帖子";
    if (pathname === "/read") return "已读";
    if (pathname === "/bookmarks") return "稍后看";
    const c = pathname.match(/^\/c\/([\w-]+)/);
    if (c) {
      const idM = pathname.match(/\/(\d+)$/);
      const cat = idM ? categoryById(Number(idM[1])) : categoryBySlug(c[1]);
      if (cat) return cat.name;
      return c[1];
    }
    const t = pathname.match(/^\/tag\/([\w-]+)/);
    if (t) return `#${t[1]}`;
    return "最新";
  }

  /** 当前列表路由对应的分类 id（用于新话题 composer 预填分类） */
  function categoryIdFromPath(pathname) {
    const idM = pathname.match(/^\/c\/[\w-]+(?:\/[\w-]+)?\/(\d+)/);
    if (idM) return Number(idM[1]);
    const c = pathname.match(/^\/c\/([\w-]+)/);
    if (c) {
      const cat = categoryBySlug(c[1]);
      if (cat) return cat.id;
    }
    return null;
  }

  /* ============================== 互斥避让 ============================== */

  /**
   * 别的 Codex 主题脚本已激活时，本脚本全程避让。
   *
   * 前两条是历史约定（飞书 / IDEA 皮肤）；最后一条是本文件与旧版
   * linuxdo.user.js 的关系：两份脚本会画同一套 .codex-rail / .codex-main，
   * 同时跑就是 rails 叠罗汉。同名 class 分不出是谁画的，所以用 OWNER_ATTR
   * 认领自己画的节点 —— 页面上出现了「不是自己画的」这一套 UI，就说明
   * 另一份脚本先接管了，本脚本让位（正确的用法本来就是只启用一份）。
   */
  function otherThemeActive() {
    const root = document.documentElement;
    if (root.classList.contains("feishu-im-theme") ||
      root.classList.contains("idea-ide-home") ||
      root.classList.contains("idea-ide-theme") ||
      !!document.getElementById("linuxdo-idea-theme") ||
      !!document.getElementById("linuxdo-feishu-theme")) {
      return true;
    }
    for (const node of document.querySelectorAll(".codex-rail, .codex-main")) {
      if (node.getAttribute(OWNER_ATTR) !== OWNER_ID) return true;
    }
    return false;
  }

  /* ============================== CSS ============================== */

  // 视觉 token 实测自 Codex 桌面 app 深/浅两版截图；所有组件一律引用变量，明暗共用一套规则
  const RAW_CSS = String.raw`
    /* ---------- Token：深色（默认） ---------- */
    .${ROOT_CLASS} {
      /*
       * rail 配色（移植自 v2ex-codex：按真实截图的**有效对比度**校准过）。
       *
       * 名义对比度会骗人：14px 细体中文在深色底上经过抗锯齿后，文字像素的加权平均
       * 亮度远低于名义色值。实测（剪出真实截图里的 rail 区域做加权平均）：
       *   #27353b 底 + #c3ccd0 字 → 峰值 7.76:1，但有效值只有 3.38:1（看着就是看不清）
       *   #27353b 底 + 纯白字也只能到 ~4.0:1 —— 底色本身太亮，光提亮文字救不回来
       * 所以做法是：底色压暗 + 文字提到接近白 + 加半档字重（见 .codex-rail-item）。
       * 目标是对齐主区正文的有效对比度量级（~5:1）。
       */
      --cx-rail-bg: #1d272c;
      --cx-rail-bg-hover: #26343a;
      --cx-rail-bg-active: #2d3d45;
      --cx-rail-text: #f5f8f9;
      --cx-rail-text-dim: #dfe7ea;
      --cx-rail-text-faint: #b0babe;
      --cx-rail-border: rgba(255, 255, 255, 0.06);

      --cx-bg: #181818;
      --cx-bg-raised: #242424;
      --cx-bg-inset: #1c1c1c;
      --cx-bg-deep: #161616;       /* 代码面板 tab 条 */
      --cx-panel-bg: #181818;
      --cx-composer-bg: #2a2a2a;

      --cx-border: rgba(255, 255, 255, 0.08);
      --cx-border-soft: rgba(255, 255, 255, 0.05);
      --cx-border-strong: rgba(255, 255, 255, 0.14);
      --cx-text: #ececec;
      --cx-text-secondary: #b9b9b9;
      --cx-text-dim: #909090;
      --cx-text-faint: #646464;

      --cx-blue: #83c3fe;
      --cx-blue-soft: rgba(131, 195, 254, 0.15);
      --cx-chip-bg: #2e2e2e;
      --cx-chip-text: #ececec;
      --cx-btn-hover: #333333;
      --cx-wash: rgba(255, 255, 255, 0.03);
      --cx-scroll-thumb: rgba(255, 255, 255, 0.12);
      --cx-send-bg: #8a8a8a;
      --cx-send-icon: #1f1f1f;

      --cx-code-text: #cfcfcf;
      --cx-code-gutter: #565656;
      --cx-tok-k: #f0954e;
      --cx-tok-s: #78cf70;
      --cx-tok-c: #6f7a6f;
      --cx-tok-t: #b06dff;
      --cx-tok-f: #63c2f2;
      --cx-tok-n: #64b5e0;
      --cx-tok-m: #cf8b45;
      --cx-diff-add-bg: rgba(64, 201, 119, 0.10);
      --cx-diff-add-ln: #4d8f68;
      --cx-diff-del-bg: rgba(250, 66, 62, 0.09);
      --cx-diff-del-ln: #9a5a58;
      --cx-diff-hunk-bg: rgba(131, 195, 254, 0.07);
      --cx-diff-hunk-tx: #7ba6c9;

      --cx-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      --cx-font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas,
        "Liberation Mono", monospace;

      --cx-rail-w: ${RAIL_WIDTH}px;
      --cx-thread-max: 760px;
      --cx-radius: 10px;
    }

    /* ---------- Token：浅色 ---------- */
    .${ROOT_CLASS}.codex-light {
      /* rail 同上：按有效对比度校准（浅色底要用近黑文字，否则细体中文一样发灰） */
      --cx-rail-bg: #e4eaeb;
      --cx-rail-bg-hover: #d9e1e3;
      --cx-rail-bg-active: #ced8da;
      --cx-rail-text: #14191b;
      --cx-rail-text-dim: #333a3d;
      --cx-rail-text-faint: #41494c;
      --cx-rail-border: rgba(0, 0, 0, 0.07);

      --cx-bg: #f4f4f4;
      --cx-bg-raised: #ffffff;
      --cx-bg-inset: #fafafa;
      --cx-bg-deep: #ebebeb;
      --cx-panel-bg: #ffffff;
      --cx-composer-bg: #ffffff;

      --cx-border: rgba(0, 0, 0, 0.10);
      --cx-border-soft: rgba(0, 0, 0, 0.06);
      --cx-border-strong: rgba(0, 0, 0, 0.16);
      --cx-text: #1b1c1e;
      --cx-text-secondary: #55565a;
      --cx-text-dim: #737477;
      --cx-text-faint: #a2a3a5;

      --cx-blue: #2a98ff;
      --cx-blue-soft: rgba(42, 152, 255, 0.13);
      --cx-chip-bg: #ededed;
      --cx-chip-text: #1b1c1e;
      --cx-btn-hover: #e6e6e6;
      --cx-wash: rgba(0, 0, 0, 0.04);
      --cx-scroll-thumb: rgba(0, 0, 0, 0.18);
      --cx-send-bg: #3c3c3c;
      --cx-send-icon: #ffffff;

      --cx-code-text: #26282b;
      --cx-code-gutter: #9c9da1;
      --cx-tok-k: #aa3d00;
      --cx-tok-s: #1c7d28;
      --cx-tok-c: #8a9086;
      --cx-tok-t: #8a40d0;
      --cx-tok-f: #1670d8;
      --cx-tok-n: #2a62c9;
      --cx-tok-m: #b25f00;
      --cx-diff-add-bg: rgba(23, 160, 88, 0.10);
      --cx-diff-add-ln: #2e8352;
      --cx-diff-del-bg: rgba(230, 60, 55, 0.10);
      --cx-diff-del-ln: #b3403c;
      --cx-diff-hunk-bg: rgba(42, 152, 255, 0.08);
      --cx-diff-hunk-tx: #46769e;

      /* 字体 / 栅格类 token 与明暗无关，但这里也留一份：
         原先它们被漏在 .codex-light 规则体外面（成了顶层垃圾声明，
         浏览器会整段丢弃），单独用 .codex-light 时就拿不到这几个变量。 */
      --cx-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      --cx-font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas,
        "Liberation Mono", monospace;

      --cx-rail-w: ${RAIL_WIDTH}px;
      --cx-thread-max: 760px;
      --cx-radius: 10px;
    }

    /* ---------- 自绘 UI 统一盒模型 ---------- */
    .codex-rail, .codex-rail *,
    .codex-main, .codex-main * { box-sizing: border-box; }

    /* ---------- 页面层不透明度（设置面板 → 外观 → 页面不透明度） ----------
       选择器列表由 JS 常量 PAGE_LAYER_SELECTOR 展开（见 buildCss），
       「哪些算页面层」因此只在 JS 里写一遍，CSS 不会和它漂移。
       不透明度 = 100 时 dim class 不会加上，这条规则根本不生效。 */
    PAGE_LAYER_LIST {
      opacity: var(--cx-page-opacity, 1);
    }

    /* ---------- 顶栏视觉隐藏（保留 DOM，供 user-menu / composer 挂载点击） ---------- */
    .${ROOT_CLASS} .d-header-wrap,
    .${ROOT_CLASS} .d-header {
      position: fixed !important;
      left: 0 !important; top: 0 !important;
      width: 0 !important; height: 0 !important;
      max-width: 0 !important; max-height: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      margin: 0 !important; padding: 0 !important;
      border: none !important;
      clip: rect(0, 0, 0, 0) !important;
      z-index: -1 !important;
    }
    /* 允许脚本对原生按钮做 programmatic click */
    .${ROOT_CLASS} #current-user,
    .${ROOT_CLASS} #toggle-current-user,
    .${ROOT_CLASS} .header-dropdown-toggle.current-user,
    .${ROOT_CLASS} #create-topic,
    .${ROOT_CLASS} #search-button {
      pointer-events: auto !important;
    }

    /* ---------- 非锁定路由：rail 常驻，原生主内容右移 ---------- */
    .${ROOT_CLASS}:not(.${LOCK_CLASS}) #main-outlet-wrapper {
      margin-left: var(--cx-rail-w) !important;
      padding-top: 0 !important;
    }

    /* ---------- 锁定路由：隐藏原生主内容 ---------- */
    .${ROOT_CLASS}.${LOCK_CLASS} body { overflow: hidden !important; }
    .${ROOT_CLASS}.${LOCK_CLASS} #main-outlet > * {
      visibility: hidden !important;
      height: 0 !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
    }
    .${ROOT_CLASS}.${LOCK_CLASS} #main-outlet-wrapper,
    .${ROOT_CLASS}.${LOCK_CLASS} #main-outlet {
      pointer-events: none !important;
      padding-top: 0 !important;
    }

    /* ---------- 原生 Discourse 侧边栏：整条隐藏 ----------
     *
     * 它在 DOM 里是 #main-outlet-wrapper 的子节点、和 #main-outlet **平级**，
     * 所以上面「只隐藏 #main-outlet 子节点」那条规则管不到它。它又没有自己的
     * 背景色，于是 Topics / Upcoming events / All categories / Default 这些
     * 原生导航文字会直接压在我们自绘的 rail 上（用户截图里的「残留」就是它）。
     * 脚本自带 rail 就是导航，所以整条隐藏（含底部主题选择 / 分类快捷入口）。
     */
    .${ROOT_CLASS} .sidebar-wrapper,
    .${ROOT_CLASS} #d-sidebar,
    .${ROOT_CLASS} .sidebar-container,
    .${ROOT_CLASS} .sidebar-footer-wrapper,
    .${ROOT_CLASS} .sidebar-footer-container,
    .${ROOT_CLASS} .sidebar-hamburger-dropdown,
    .${ROOT_CLASS} .sidebar-more-section-links {
      display: none !important;
    }

    /* 底部聊天抽屉等会破坏观感，隐藏 */
    .${ROOT_CLASS} .chat-drawer-container,
    .${ROOT_CLASS} #chat-drawer,
    .${ROOT_CLASS} .chat-drawer,
    .${ROOT_CLASS} [id*="chat-drawer"] {
      display: none !important;
    }

    /* ---------- 原生 composer：关闭态隐藏，打开态铺到主区 ---------- */
    .${ROOT_CLASS}.${LOCK_CLASS} #reply-control:not(.open):not(.fullscreen):not(.edit-title) {
      display: none !important;
      pointer-events: none !important;
      z-index: 0 !important;
    }
    .${ROOT_CLASS}.${LOCK_CLASS} #reply-control.open,
    .${ROOT_CLASS}.${LOCK_CLASS} #reply-control.edit-title,
    .${ROOT_CLASS}.${LOCK_CLASS} #reply-control.fullscreen {
      display: block !important;
      left: calc(var(--cx-rail-w) + 12px) !important;
      right: 12px !important;
      width: auto !important;
      max-width: none !important;
      z-index: 700 !important;
      visibility: visible !important;
      pointer-events: auto !important;
      border-radius: 12px 12px 0 0 !important;
      background: var(--cx-bg-raised) !important;
      color: var(--cx-text) !important;
      box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.5) !important;
      /* 站点可能是浅色方案：composer 强制深色调色板 */
      --primary: var(--cx-text);
      --primary-medium: var(--cx-text-secondary);
      --primary-low: var(--cx-text-dim);
      --primary-very-low: var(--cx-chip-bg);
      --primary-50: var(--cx-bg-inset);
      --primary-100: var(--cx-bg-raised);
      --primary-200: var(--cx-btn-hover);
      --primary-300: var(--cx-border-strong);
      --secondary: var(--cx-bg-raised);
      --tertiary: var(--cx-blue);
      --quaternary: var(--cx-blue);
      --d-hover: var(--cx-wash);
    }
    .${ROOT_CLASS}.${LOCK_CLASS} #reply-control .reply-area {
      max-width: none !important;
      padding-left: 20px !important;
      padding-right: 20px !important;
    }

    /* ---------- 收养的原生用户菜单：仅 html.codex-notif-open 时可见 ---------- */
    .${ROOT_CLASS} .user-menu.codex-user-menu-float,
    .${ROOT_CLASS} .user-menu.revamped.menu-panel.codex-user-menu-float,
    .${ROOT_CLASS} .user-menu.menu-panel.codex-user-menu-float {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
    .${ROOT_CLASS}.codex-notif-open .user-menu.codex-user-menu-float,
    .${ROOT_CLASS}.codex-notif-open .user-menu.revamped.menu-panel.codex-user-menu-float,
    .${ROOT_CLASS}.codex-notif-open .user-menu.menu-panel.codex-user-menu-float {
      display: block !important;
      position: fixed !important;
      left: 12px !important;
      bottom: 60px !important;
      top: auto !important;
      right: auto !important;
      width: 340px !important;
      max-width: min(340px, calc(100vw - 24px)) !important;
      max-height: min(72vh, 640px) !important;
      margin: 0 !important;
      z-index: 900 !important;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55) !important;
      border-radius: 12px !important;
      overflow: auto !important;
      pointer-events: auto !important;
      opacity: 1 !important;
      visibility: visible !important;
      background: var(--cx-bg-raised) !important;
      color: var(--cx-text) !important;
      clip: auto !important;
      /* 深色调色板 */
      --primary: var(--cx-text);
      --primary-medium: var(--cx-text-secondary);
      --primary-low: var(--cx-text-dim);
      --primary-very-low: var(--cx-chip-bg);
      --primary-50: var(--cx-bg-inset);
      --primary-100: var(--cx-bg-raised);
      --primary-200: var(--cx-btn-hover);
      --secondary: var(--cx-bg-raised);
      --tertiary: var(--cx-blue);
      --d-hover: var(--cx-wash);
    }

    /* ---------- splash ---------- */
    .${ROOT_CLASS} #d-splash { background: var(--cx-bg) !important; }
    .${ROOT_CLASS} #d-splash .dots { background-color: var(--cx-blue) !important; filter: none !important; }

    /* ================= 左 rail ================= */
    .codex-rail {
      position: fixed;
      left: 0; top: 0; bottom: 0;
      width: var(--cx-rail-w);
      background: var(--cx-rail-bg);
      color: var(--cx-rail-text);
      display: flex;
      flex-direction: column;
      user-select: none;
      z-index: 800;
      font-family: var(--cx-font-ui);
      font-size: 14px;
    }

    .codex-rail-traffic {
      height: 46px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 2px;
      padding: 0 14px;
      color: var(--cx-rail-text-dim);
      flex: none;
    }
    .codex-rail-traffic svg { width: 20px; height: 20px; padding: 2px; border-radius: 6px; cursor: pointer; }
    .codex-rail-traffic svg:hover { background: var(--cx-rail-bg-hover); color: var(--cx-rail-text); }

    .codex-rail-brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 2px 14px 10px;
      flex: none;
    }
    .codex-rail-brand-name {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: 0.2px;
      cursor: pointer;
    }
    .codex-rail-brand-name svg { width: 12px; height: 12px; color: var(--cx-rail-text-dim); }
    .codex-rail-brand-actions { display: flex; gap: 2px; color: var(--cx-rail-text-dim); }
    .codex-rail-brand-actions svg { width: 19px; height: 19px; padding: 2px; border-radius: 6px; cursor: pointer; }
    .codex-rail-brand-actions svg:hover { background: var(--cx-rail-bg-hover); color: var(--cx-rail-text); }
    .codex-rail-bell { position: relative; display: inline-flex; }
    .codex-rail-bell.has-unread::after {
      content: "";
      position: absolute;
      top: 1px; right: 1px;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--cx-blue);
      border: 1.5px solid var(--cx-rail-bg);
    }

    .codex-rail-scroll { flex: 1; overflow-y: auto; padding-bottom: 8px; }
    .codex-rail-scroll::-webkit-scrollbar { width: 8px; }
    .codex-rail-scroll::-webkit-scrollbar-thumb { background: var(--cx-scroll-thumb); border-radius: 4px; }

    .codex-rail-nav { padding: 2px 8px; display: flex; flex-direction: column; gap: 1px; }
    .codex-rail-item {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 5px 10px;
      border-radius: var(--cx-radius);
      font-size: 13.5px;
      color: var(--cx-rail-text);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .codex-rail-item:hover { background: var(--cx-rail-bg-hover); }
    .codex-rail-item.active { background: var(--cx-rail-bg-active); }
    .codex-rail-item svg { width: 16px; height: 16px; flex: none; color: var(--cx-rail-text-dim); }
    .codex-rail-item.active svg { color: var(--cx-rail-text); }

    .codex-rail-section {
      padding: 18px 18px 4px;
      font-size: 12px;
      color: var(--cx-rail-text-faint);
    }
    .codex-rail-section-items { padding: 0 8px; display: flex; flex-direction: column; gap: 1px; }

    .codex-rail-item .cx-dot {
      margin-left: auto;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--cx-blue);
      flex: none;
    }
    .codex-rail-item .cx-count {
      margin-left: auto;
      font-size: 12px;
      color: var(--cx-rail-text-dim);
      flex: none;
    }
    .codex-rail-item.cx-faint { color: var(--cx-rail-text-faint); }
    /* 分类下的 session 子条目：缩进与父项文字对齐、更小更淡 */
    .codex-rail-subitem {
      padding: 4px 10px 4px 41px;
      font-size: 13px;
      color: var(--cx-rail-text-dim);
    }
    .codex-rail-subitem .cx-dot { width: 6px; height: 6px; }
    .codex-rail-item .cx-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .codex-rail-foot {
      border-top: 1px solid var(--cx-rail-border);
      padding: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex: none;
    }
    .codex-rail-foot-user {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 10px;
      border-radius: var(--cx-radius);
      cursor: pointer;
      font-size: 14px;
      min-width: 0;
    }
    .codex-rail-foot-user:hover { background: var(--cx-rail-bg-hover); }
    .codex-rail-foot-user svg { width: 17px; height: 17px; color: var(--cx-rail-text-dim); flex: none; }
    .codex-rail-foot-user .cx-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* 左下角明暗切换按钮：置于最高层，保证任何浮层之下都可点 */
    .codex-rail .cx-mode-btn {
      position: relative;
      z-index: 2147483000;
      flex: none;
      width: 36px; height: 36px;
      padding: 0;
      border: none;
      background: none;
      border-radius: 9px;
      color: var(--cx-rail-text-dim);
      display: grid;
      place-items: center;
      cursor: pointer;
    }
    .codex-rail .cx-mode-btn:hover { background: var(--cx-rail-bg-hover); color: var(--cx-rail-text); }
    .codex-rail .cx-mode-btn svg { width: 18px; height: 18px; pointer-events: none; }

    /* ================= 右侧主区 ================= */
    .codex-main {
      position: fixed;
      left: var(--cx-rail-w); right: 0; top: 0; bottom: 0;
      background: var(--cx-bg);
      color: var(--cx-text);
      display: flex;
      flex-direction: column;
      min-width: 0;
      z-index: 500;
      font-family: var(--cx-font-ui);
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    .codex-topbar {
      height: 46px;
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      border-bottom: 1px solid var(--cx-border-soft);
      color: var(--cx-text-secondary);
    }
    .codex-topbar svg { width: 16px; height: 16px; flex: none; }
    .codex-topbar .cx-crumb { display: flex; align-items: center; gap: 7px; font-size: 13px; min-width: 0; }
    .codex-topbar .cx-crumb .cx-proj { color: var(--cx-text); cursor: pointer; }
    .codex-topbar .cx-crumb .cx-model { color: var(--cx-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .codex-topbar .cx-spacer { flex: 1; }
    .codex-topbar .cx-icon-btn {
      padding: 5px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--cx-text-dim);
      display: grid;
      place-items: center;
      border: none;
      background: none;
    }
    .codex-topbar .cx-icon-btn:hover { background: var(--cx-bg-raised); color: var(--cx-text); }
    .codex-topbar .cx-menu-btn { display: none; }

    .codex-thread {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      padding: 28px 40px 40px;
      scrollbar-width: thin;
    }
    .codex-thread::-webkit-scrollbar { width: 8px; }
    .codex-thread::-webkit-scrollbar-thumb { background: var(--cx-scroll-thumb); border-radius: 4px; }
    .codex-thread-inner { max-width: var(--cx-thread-max, 760px); margin: 0 auto; }
    /* 详情视图整体紧凑一点 */
    .cx-view-detail { padding-top: 20px; padding-bottom: 28px; }

    /* —— 列表视图（分类 / 最新 / 热门 → Codex 项目视图）—— */
    .cx-proj-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin: 6px 0 2px;
    }
    .cx-proj-head h1 { font-size: 20px; font-weight: 600; letter-spacing: 0.2px; margin: 0; }
    .cx-new-topic-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--cx-font-ui);
      font-size: 12.5px;
      font-weight: 500;
      color: var(--cx-text);
      background: var(--cx-chip-bg);
      border: 1px solid var(--cx-border-strong);
      border-radius: 999px;
      padding: 6px 13px;
      cursor: pointer;
    }
    .cx-new-topic-btn:hover { background: var(--cx-btn-hover); }
    .cx-new-topic-btn svg { width: 13px; height: 13px; }
    .cx-proj-desc {
      font-size: 12.5px;
      color: var(--cx-text-dim);
      margin-bottom: 16px;
    }
    /* 列表头：筛选展开按钮 + 筛选项 chips（参考飞书中栏筛选） */
    .cx-head-title { display: flex; align-items: center; gap: 4px; min-width: 0; }
    .codex-main .cx-filter-btn {
      width: 26px; height: 26px;
      border-radius: 7px;
      color: var(--cx-text-dim);
      display: grid;
      place-items: center;
      cursor: pointer;
      border: none;
      background: none;
    }
    .codex-main .cx-filter-btn:hover { background: var(--cx-btn-hover); color: var(--cx-text); }
    .codex-main .cx-filter-btn svg { width: 14px; height: 14px; transition: transform 0.15s; }
    .codex-main.cx-filters-open .cx-filter-btn svg { transform: rotate(180deg); }
    .cx-filter-row { display: none; flex-wrap: wrap; gap: 6px; margin: 2px 0 10px; }
    .codex-main.cx-filters-open .cx-filter-row { display: flex; }
    .cx-fchip {
      font-size: 12px;
      color: var(--cx-text-secondary);
      background: var(--cx-chip-bg);
      border-radius: 999px;
      padding: 3px 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    .cx-fchip:hover { background: var(--cx-btn-hover); color: var(--cx-text); }
    .cx-fchip.cx-on { background: var(--cx-blue-soft); color: var(--cx-blue); }
    /* /new（新）列表下「所有 / 话题 / 回复」筛选条（吸附原生 toggle，参照 im） */
    .cx-new-toggle {
      display: none; flex-wrap: wrap; gap: 6px;
      margin: 0 0 10px;
    }
    .cx-new-toggle.cx-show { display: flex; }
    .cx-new-toggle-btn {
      height: 24px; padding: 0 12px;
      border: 1px solid var(--cx-border);
      border-radius: 999px;
      background: transparent; color: var(--cx-text-dim);
      font-size: 12px; cursor: pointer;
      font-family: var(--cx-font-ui);
      display: inline-flex; align-items: center; gap: 4px;
      white-space: nowrap; flex-shrink: 0;
    }
    .cx-new-toggle-btn + .cx-new-toggle-btn { margin-left: 2px; }
    .cx-new-toggle-btn:hover { background: var(--cx-chip-bg); color: var(--cx-text); }
    .cx-new-toggle-btn .n { font-weight: 600; }
    .cx-new-toggle-btn.active {
      background: var(--cx-blue-soft); border-color: var(--cx-blue); color: var(--cx-blue); font-weight: 600;
    }
    .cx-thread-rows { display: flex; flex-direction: column; }
    .cx-trow {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 10px;
      margin: 0 -10px;
      border-radius: var(--cx-radius);
      cursor: pointer;
      min-width: 0;
    }
    .cx-trow:hover { background: var(--cx-bg-raised); }
    .cx-trow-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      flex: none;
      background: transparent;
      border: 1.5px solid var(--cx-text-faint);
    }
    .cx-trow-dot.cx-unread { background: var(--cx-blue); border-color: var(--cx-blue); }
    .cx-trow-pin { width: 13px; height: 13px; flex: none; color: var(--cx-text-dim); }
    .cx-trow-title {
      font-size: 13.5px;
      color: var(--cx-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cx-trow.cx-read .cx-trow-title { color: var(--cx-text-secondary); }
    .cx-trow-meta {
      margin-left: auto;
      flex: none;
      font-size: 12px;
      color: var(--cx-text-faint);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cx-trow-sub {
      font-size: 12px;
      color: var(--cx-text-dim);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cx-trow-texts { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .cx-trow-sep { height: 1px; background: var(--cx-border-soft); margin: 2px 0; }
    /* 行与行之间的 agent 痕迹（设置面板 → 装饰）：夹在两条话题中间，
       左缩进对齐标题，视觉上比楼内那份更轻，别抢标题的视线 */
    .cx-thread-rows .cx-think,
    .cx-thread-rows .cx-runline { margin: 3px 0 3px 17px; }
    .cx-thread-rows .cx-runline code { font-size: 11px; }
    .cx-thread-rows .cx-think-body { font-size: 12px; margin-top: 5px; }
    .cx-list-status {
      padding: 14px;
      text-align: center;
      font-size: 12px;
      color: var(--cx-text-faint);
    }

    /* —— 用户 turn（楼主帖）—— */
    .cx-turn-user {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 6px;
    }
    .cx-turn-user-bubble {
      background: var(--cx-chip-bg);
      border-radius: 16px;
      padding: 10px 16px;
      max-width: 85%;
      font-size: 13.5px;
      line-height: 1.6;
      color: var(--cx-text);
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .cx-turn-user-bubble p { margin: 6px 0; }
    .cx-turn-user-bubble p:first-child { margin-top: 0; }
    .cx-turn-user-bubble p:last-child { margin-bottom: 0; }
    /*
     * 正文图片默认渲染成小缩略图（Discourse 的 cooked 里就是原图，
     * 所以这里只能靠 CSS 约束尺寸 —— 好处是浏览器已经把原图下载过了，
     * 悬浮预览和灯箱都是零延迟、也不会多发一个请求）。
     * 鼠标悬停不再把图本身撑大（那会把正文顶得跳来跳去），改为在旁边浮出大图。
     */
    .cx-turn-user-bubble img:not(.emoji),
    .cx-turn-agent img:not(.emoji) {
      max-width: var(--ldx-thumb-w, 260px);
      max-height: var(--ldx-thumb-h, 170px);
      width: auto;
      height: auto;
      object-fit: contain;
      margin: 8px 0;
      border-radius: 8px;
      border: 1px solid var(--cx-border-soft);
      background: var(--cx-bg-inset);
      cursor: zoom-in;
      display: block;
      transition: border-color 0.12s, box-shadow 0.12s;
    }
    .cx-turn-user-bubble img:not(.emoji):hover,
    .cx-turn-agent img:not(.emoji):hover {
      border-color: var(--cx-blue);
      box-shadow: 0 0 0 2px var(--cx-blue-soft);
    }
    /* 太小的图（表情、图标、分割线）不参与缩略/预览 */
    .cx-turn-user-bubble img[data-no-preview="1"],
    .cx-turn-agent img[data-no-preview="1"] { cursor: default; }
    .cx-turn-agent img.emoji, .cx-turn-user-bubble img.emoji { max-width: 100%; border-radius: 0; }

    /* ---------- 悬浮大图预览：fixed 定位，不参与文档流 → 不引起重排 ---------- */
    .ldx-imgpreview {
      position: fixed;
      left: 0; top: 0;
      z-index: 1300;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.12s;
      background: var(--cx-bg-raised);
      border: 1px solid var(--cx-border-strong);
      border-radius: 10px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
      padding: 8px;
      max-width: min(80vw, 900px);
      max-height: 80vh;
      font-family: var(--cx-font-ui);
    }
    .ldx-imgpreview.on { opacity: 1; visibility: visible; }
    /* 图还没到位时给个占位尺寸 + 居中提示，避免塌成小胶囊还带破图图标 */
    .ldx-imgpreview.loading { min-width: 240px; min-height: 150px; }
    .ldx-imgpreview.loading img { opacity: 0; }
    .ldx-imgpreview .ldx-ipv-load {
      display: none;
      position: absolute;
      inset: 0;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      color: var(--cx-text-faint);
    }
    .ldx-imgpreview.loading .ldx-ipv-load { display: flex; }
    .ldx-imgpreview img {
      display: block;
      opacity: 1;
      transition: opacity 0.12s;
      max-width: calc(min(80vw, 900px) - 18px);
      max-height: calc(80vh - 46px);
      width: auto;
      height: auto;
      border-radius: 6px;
      background: var(--cx-bg-inset);
    }
    .ldx-imgpreview .ldx-ipv-cap {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 2px 1px;
      font-size: 11.5px;
      color: var(--cx-text-dim);
      white-space: nowrap;
      overflow: hidden;
    }
    .ldx-imgpreview .ldx-ipv-name {
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: var(--cx-font-mono);
    }
    .ldx-imgpreview .ldx-ipv-size { flex: none; color: var(--cx-text-faint); }

    /* ---------- 图片灯箱：点击 [img] 完整显示原图（移植自 terminal 皮肤 35bd821） ---------- */
    .cx-lightbox {
      position: fixed; inset: 0; z-index: 2000;
      background: rgba(6, 8, 12, 0.86); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.16s ease; cursor: zoom-out;
    }
    .cx-lightbox.open { opacity: 1; }
    .cx-lightbox .lb-side {
      position: absolute; top: 12px; font-size: 12px; color: var(--cx-text-dim);
      font-family: var(--cx-font-ui); z-index: 2; cursor: pointer; user-select: none;
    }
    .cx-lightbox .lb-open { left: 14px; }
    .cx-lightbox .lb-close { right: 14px; }
    .cx-lightbox img {
      max-width: min(92vw, 1400px); max-height: 88vh; object-fit: contain;
      border-radius: 8px; box-shadow: 0 16px 60px rgba(0, 0, 0, 0.6);
      transform-origin: center center; cursor: grab; user-select: none;
    }
    .cx-turn-user-bubble a { color: var(--cx-blue); text-decoration: none; }
    .cx-turn-user-bubble a:hover { text-decoration: underline; }
    .cx-turn-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--cx-text-faint);
      font-size: 12.5px;
      padding: 3px 2px;
      opacity: 0.55;
      transition: opacity 0.15s;
    }
    .cx-turn-meta:hover { opacity: 0.9; }
    .cx-turn-meta .cx-status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      border: 1.5px solid var(--cx-text-dim);
    }
    .cx-turn-meta .cx-status-dot.cx-done { background: var(--cx-text-dim); }

    /* —— agent turn（回帖，全宽 markdown）—— */
    .cx-turn-agent { padding: 0; word-break: break-word; overflow-wrap: anywhere; }
    .cx-turn-agent h1, .cx-turn-agent h2, .cx-turn-agent h3,
    .cx-turn-agent h4, .cx-turn-agent h5 {
      color: var(--cx-text);
      font-weight: 600;
      margin: 14px 0 7px;
      line-height: 1.4;
    }
    .cx-turn-agent h2 { font-size: 17px; }
    .cx-turn-agent h3 { font-size: 15px; }
    .cx-turn-agent p { font-size: 13.5px; line-height: 1.75; color: var(--cx-text); margin: 9px 0; }
    .cx-turn-agent ul, .cx-turn-agent ol { margin: 8px 0 8px 20px; padding: 0; }
    .cx-turn-agent li { font-size: 13.5px; line-height: 1.8; color: var(--cx-text); margin: 4px 0; }
    .cx-turn-agent li::marker { color: var(--cx-text-dim); }
    .cx-turn-agent a { color: var(--cx-blue); text-decoration: none; }
    .cx-turn-agent a:hover { text-decoration: underline; }
    .cx-turn-agent hr { border: none; border-top: 1px solid var(--cx-border-soft); margin: 16px 0; }
    .cx-turn-agent table { border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    .cx-turn-agent th, .cx-turn-agent td {
      border: 1px solid var(--cx-border);
      padding: 6px 10px;
      color: var(--cx-text);
    }
    .cx-turn-agent th { background: var(--cx-bg-raised); font-weight: 600; }
    /* onebox 等嵌入卡片压成简约边框块 */
    .cx-turn-agent aside.onebox,
    .cx-turn-agent .onebox {
      border: 1px solid var(--cx-border) !important;
      border-radius: 10px;
      background: var(--cx-bg-raised);
      margin: 12px 0;
      padding: 10px 14px;
      color: var(--cx-text-secondary);
      font-size: 13px;
    }

    code.cx-inline-code {
      font-family: var(--cx-font-mono);
      font-size: 12px;
      background: var(--cx-chip-bg);
      color: var(--cx-chip-text);
      border-radius: 6px;
      padding: 2.5px 6px;
    }

    /* 代码块（带头栏 + 复制按钮） */
    .cx-codeblock {
      margin: 14px 0;
      background: var(--cx-bg-inset);
      border: 1px solid var(--cx-border-soft);
      border-radius: 10px;
      overflow: hidden;
    }
    .cx-codeblock-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 12px;
      font-family: var(--cx-font-mono);
      font-size: 12px;
      color: var(--cx-text-dim);
      border-bottom: 1px solid var(--cx-border-soft);
    }
    .cx-codeblock-head .cx-copy { cursor: pointer; display: flex; align-items: center; gap: 5px; }
    .cx-codeblock-head .cx-copy:hover { color: var(--cx-text); }
    .cx-codeblock-head .cx-copy svg { width: 13px; height: 13px; }
    .cx-codeblock pre {
      margin: 0;
      padding: 12px 14px;
      font-family: var(--cx-font-mono);
      font-size: 12.5px;
      line-height: 1.65;
      overflow-x: auto;
      color: var(--cx-code-text);
      background: transparent;
      border: none;
    }

    /* 引用 → 工具调用卡片 */
    .cx-tool-card {
      margin: 14px 0;
      border: 1px solid var(--cx-border);
      border-radius: 10px;
      background: var(--cx-bg-raised);
      overflow: hidden;
    }
    .cx-tool-card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font-family: var(--cx-font-mono);
      font-size: 12.5px;
      color: var(--cx-text-secondary);
      cursor: pointer;
    }
    .cx-tool-card-head svg { width: 14px; height: 14px; color: var(--cx-text-dim); flex: none; }
    .cx-tool-card-head .chev { margin-left: auto; transition: transform 0.15s; }
    .cx-tool-card.cx-open .cx-tool-card-head .chev { transform: rotate(90deg); }
    .cx-tool-card-body {
      display: none;
      border-top: 1px solid var(--cx-border-soft);
      padding: 10px 14px;
      font-size: 13.5px;
      line-height: 1.7;
      color: var(--cx-text-secondary);
    }
    .cx-tool-card-body p { margin: 6px 0; font-size: 13.5px; }
    .cx-tool-card.cx-open .cx-tool-card-body { display: block; }

    /* 分割线 turn 之间 */
    .cx-turn-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 6px 0 10px;
      color: var(--cx-text-faint);
      font-size: 12px;
      opacity: 0.7;
    }
    .cx-turn-divider::before, .cx-turn-divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--cx-border-soft);
    }

    /* 楼层间的 worked 状态行 */
    .cx-worked {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--cx-text-faint);
      font-size: 12.5px;
      margin: 0;
      opacity: 0.55;
      transition: opacity 0.15s;
    }
    .cx-worked:hover { opacity: 0.9; }
    .cx-worked svg { width: 14px; height: 14px; flex: none; }

    /* 楼内穿插的 agent 活动 / 思考行（装饰） */
    .cx-runline {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0;
      font-size: 12.5px;
      color: var(--cx-text-dim);
    }
    .cx-runline svg { width: 14px; height: 14px; flex: none; color: var(--cx-text-faint); }
    .cx-runline code {
      font-family: var(--cx-font-mono);
      font-size: 11.5px;
      color: var(--cx-chip-text);
      background: var(--cx-chip-bg);
      border-radius: 6px;
      padding: 1.5px 7px;
    }
    /* 楼内 agent 英文思考块（参考 cli 皮肤：可折叠，默认展开） */
    .cx-think {
      margin: 10px 0;
      font-size: 12.5px;
      color: var(--cx-text-dim);
    }
    .cx-think-head {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      cursor: pointer;
      user-select: none;
    }
    .cx-think-head:hover { color: var(--cx-text-secondary); }
    .cx-think-head .spin { color: var(--cx-blue); }
    .cx-think-chev { font-size: 10px; }
    .cx-think-body {
      display: none;
      margin: 7px 0 2px;
      line-height: 1.7;
      color: var(--cx-text-secondary);
      border-left: 1px solid var(--cx-border-soft);
      padding-left: 10px;
      white-space: pre-wrap;
    }
    .cx-think.open .cx-think-body { display: block; }
    .cx-think.open .cx-think-chev::after { content: "▾"; }
    .cx-think:not(.open) .cx-think-chev::after { content: "▸"; }

    /* 每楼底部操作行 */
    .cx-turn-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 0 0 0 auto; /* 与楼层信息同行，靠右 */
      opacity: 0;
      transition: opacity 0.15s;
    }
    .cx-turn-agent:hover + .cx-worked .cx-turn-actions,
    .cx-worked:hover .cx-turn-actions,
    .cx-turn-user:hover + .cx-turn-meta .cx-turn-actions,
    .cx-turn-meta:hover .cx-turn-actions,
    .cx-turn-actions.cx-has-liked { opacity: 1; }
    .cx-act {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid var(--cx-border);
      background: transparent;
      color: var(--cx-text-dim);
      font-family: var(--cx-font-ui);
      font-size: 12px;
      border-radius: 999px;
      padding: 3px 10px;
      cursor: pointer;
    }
    .cx-act:hover { background: var(--cx-bg-raised); color: var(--cx-text); }
    .cx-act svg { width: 13px; height: 13px; }
    .cx-act.cx-liked { color: var(--cx-blue); border-color: var(--cx-blue-soft); background: var(--cx-blue-soft); }

    /* —— 底部 composer（嵌入 im 式 markdown 输入框，工具栏置于下方） —— */
    .codex-composer-wrap {
      flex: none;
      padding: 8px 16px 14px;
    }
    .codex-composer {
      width: 100%;
      max-width: 600px; /* 收起代码面板时的宽度 */
      margin: 0 auto;
      background: var(--cx-composer-bg);
      border: 1px solid var(--cx-border);
      border-radius: 16px;
      padding: 10px 12px 8px;
    }

    /* 收起态：只留一条细栏（点它 / 点箭头展开回来）。
       收起只影响外观，草稿、目标楼、发送按钮都还在 DOM 里，展开即恢复。 */
    .cx-composer-mini {
      display: none;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .cx-composer-mini-hint {
      flex: 1;
      min-width: 0;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--cx-text-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: text;
    }
    .cx-composer-mini-hint.cx-busy { color: var(--cx-text-secondary); }
    .cx-composer-mini-hint.cx-ok { color: var(--cx-blue); }
    .cx-composer-mini-hint.cx-err { color: var(--cx-danger, #e0626a); }
    .codex-composer.cx-collapsed { padding: 6px 10px; border-radius: 12px; }
    .codex-composer.cx-collapsed .cx-compose-target,
    .codex-composer.cx-collapsed .cx-compose-preview,
    .codex-composer.cx-collapsed .cx-md-edit,
    .codex-composer.cx-collapsed .cx-composer-toolbar { display: none !important; }
    .codex-composer.cx-collapsed .cx-composer-mini { display: flex; }
    .cx-composer-mini .cx-tool-btn { width: 26px; height: 26px; padding: 4px; }

    /* 输入区：contenteditable，Typora 式块级渐进渲染 */
    .cx-md-edit {
      color: var(--cx-text);
      font-family: var(--cx-font-ui);
      font-size: 14px;
      line-height: 1.65;
      min-height: 48px;
      max-height: 220px;
      overflow-y: auto;
      outline: none;
      cursor: text;
      position: relative;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .cx-md-edit:not(.has-content)::before {
      content: attr(data-placeholder);
      position: absolute;
      color: var(--cx-text-faint);
      pointer-events: none;
    }
    .cx-md-block { min-height: 1.5em; }
    .cx-md-block p { margin: 0; }
    .cx-md-block h2, .cx-md-block h3, .cx-md-block h4, .cx-md-block h5 { margin: 3px 0 2px; line-height: 1.35; }
    .cx-md-block h2 { font-size: 1.3em; }
    .cx-md-block h3 { font-size: 1.18em; }
    .cx-md-block h4, .cx-md-block h5 { font-size: 1.05em; }
    .cx-md-block blockquote {
      margin: 2px 0;
      padding: 1px 0 1px 8px;
      border-left: 3px solid var(--cx-border-strong);
      color: var(--cx-text-secondary);
    }
    .cx-md-block pre {
      margin: 3px 0;
      padding: 8px;
      border-radius: 6px;
      background: var(--cx-bg-inset);
      overflow-x: auto;
      font-size: 12px;
    }
    .cx-md-block code { font-family: var(--cx-font-mono); }
    .cx-md-block :not(pre) > code {
      background: var(--cx-chip-bg);
      border-radius: 4px;
      padding: 1px 4px;
    }
    .cx-md-block ul, .cx-md-block ol { margin: 2px 0; padding-left: 20px; }
    .cx-md-block a { color: var(--cx-blue); text-decoration: none; }
    .cx-md-block a:hover { text-decoration: underline; }
    .cx-md-block img.cx-md-img { max-width: 100%; max-height: 140px; border-radius: 6px; vertical-align: middle; }
    .cx-md-block img.emoji { width: 1.25em; height: 1.25em; vertical-align: -0.2em; }
    .cx-md-block table.cx-md-table { border-collapse: collapse; margin: 3px 0; font-size: 12px; }
    .cx-md-table th, .cx-md-table td { border: 1px solid var(--cx-border-strong); padding: 2px 8px; }
    .cx-md-block hr { border: 0; border-top: 1px solid var(--cx-border-strong); margin: 6px 0; }
    .cx-md-block .cx-md-task { list-style: none; margin-left: -18px; }
    .cx-md-block .cx-md-blur { filter: blur(4px); cursor: pointer; transition: filter 0.15s; }
    .cx-md-block .cx-md-blur:hover { filter: none; }
    .cx-md-block .cx-md-details summary { cursor: pointer; color: var(--cx-blue); }
    .cx-md-block .cx-md-quote-head { font-size: 12px; color: var(--cx-text-faint); margin-bottom: 2px; }
    .cx-md-block .cx-md-poll { border: 1px solid var(--cx-border-strong); border-radius: 6px; padding: 4px 10px; margin: 3px 0; }
    .cx-md-block .cx-md-poll-title { font-size: 12px; color: var(--cx-text-faint); }
    .cx-md-block .cx-md-footnote { font-size: 12px; color: var(--cx-text-secondary); }
    .cx-md-block .cx-md-date { background: var(--cx-chip-bg); border-radius: 4px; padding: 1px 4px; font-size: 12px; }

    /* 预览条：开关式实时渲染 */
    .cx-compose-preview {
      display: none;
      max-height: 120px;
      overflow-y: auto;
      padding: 6px 2px 4px;
      margin-bottom: 6px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--cx-text-secondary);
      border-bottom: 1px dashed var(--cx-border);
      word-break: break-word;
    }
    .cx-compose-preview.active { display: block; }
    .cx-compose-preview.is-empty { display: none; }

    /* 目标回复条 */
    .cx-compose-target {
      display: none;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--cx-text-secondary);
      margin-bottom: 6px;
    }
    .cx-compose-target.active { display: flex; }
    .cx-compose-target button {
      border: none;
      background: none;
      color: var(--cx-text-dim);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
    }
    .cx-compose-target button:hover { color: var(--cx-text); }

    /* 工具栏（输入框下方）
     *
     * 这条工具条一共 13 个工具键 + 收起键 + 发送键，固有宽度约 430px；而卡片宽度受
     * 「主栏宽度」和 max-width 双重限制，窄窗口 + 代码面板开着时内容区可能只有 370px。
     * flex 默认 nowrap，超出的部分会被外层 .codex-body{overflow:hidden} 直接裁掉
     * —— 表现就是右端的收起 / 发送按钮「显示不全」。所以这里：
     *   - flex-wrap: wrap 兜底：真装不下就换行，绝不裁；
     *   - 工具键 28→26、发送键 30→28、状态左右 margin 8→6，把固有宽度压下来；
     *   - 状态条 min-width: 0，让它先被压缩（它是弹性项，压缩它比裁按钮合理）。 */
    .cx-composer-toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
      row-gap: 4px;
      padding-top: 8px;
      margin-top: 6px;
      border-top: 1px solid var(--cx-border-soft);
    }
    .cx-composer-toolbar .cx-tool-btn {
      width: 26px; height: 26px;
      border-radius: 6px;
      display: grid; place-items: center;
      border: none; background: none;
      color: var(--cx-text-dim);
      cursor: pointer;
      font-family: var(--cx-font-ui);
      flex: none;
    }
    .cx-composer-toolbar .cx-tool-btn:hover { background: var(--cx-btn-hover); color: var(--cx-text); }
    .cx-composer-toolbar .cx-tool-btn svg { width: 16px; height: 16px; }
    .cx-composer-toolbar .cx-tool-btn.active { color: var(--cx-blue); }
    .cx-composer-status {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 16px;
      font-size: 12px;
      color: var(--cx-text-faint);
      margin: 0 6px;
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cx-composer-status.cx-busy { color: var(--cx-blue); }
    .cx-composer-status.cx-ok { color: #52b36b; }
    .cx-composer-status.cx-err { color: #e0626a; }
    .codex-composer-send {
      flex: none;
      width: 28px; height: 28px;
      border-radius: 50%;
      background: var(--cx-send-bg);
      color: var(--cx-send-icon);
      border: none;
      display: grid;
      place-items: center;
      cursor: pointer;
    }
    .codex-composer-send svg { width: 15px; height: 15px; }
    .codex-composer-send:disabled { opacity: 0.45; cursor: default; }

    /* 表情 / 更多弹层 */
    .cx-md-pop {
      position: fixed;
      z-index: 3000;
      background: var(--cx-bg-raised);
      border: 1px solid var(--cx-border-strong);
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
      padding: 8px;
    }
    .cx-emoji-grid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 2px;
    }
    .cx-emoji-item {
      width: 30px; height: 30px;
      border: none; background: none;
      cursor: pointer; font-size: 16px;
      border-radius: 6px;
    }
    .cx-emoji-item:hover { background: var(--cx-btn-hover); }
    .cx-plus-pop {
      width: 252px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px;
    }
    .cx-plus-item {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      border: none; background: none;
      color: var(--cx-text-secondary);
      font-size: 12.5px;
      cursor: pointer;
      font-family: var(--cx-font-ui);
      text-align: left;
    }
    .cx-plus-item .ico { width: 16px; text-align: center; }
    .cx-plus-item:hover { background: var(--cx-btn-hover); color: var(--cx-text); }

    /* 代码面板展开时再收一档（原版输入框随分屏变窄） */
    .${ROOT_CLASS}:not(.codex-hide-code-panel) .codex-composer { max-width: 560px; }

    /* ================= 分屏：右侧代码面板（纯氛围，列表/详情共享同一实例） ================= */
    /* 内容区横排：左 = 当前视图滚动容器，右 = 共享代码面板 */
    .codex-body {
      flex: 1;
      min-height: 0;
      display: flex;
      overflow: hidden;
    }
    .codex-body { align-items: stretch; }
    .codex-thread-col {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .codex-thread-col .codex-thread { min-width: 0; }
    .cx-code-panel {
      width: var(--cx-panel-w, 50%);   /* 默认与中间栏 1:1，可拖拽改写 */
      min-width: 280px;
      flex: none;
      border-left: 1px solid var(--cx-border-soft);
      background: var(--cx-panel-bg);
      display: flex;
      flex-direction: column;
    }
    .cx-code-tabs {
      height: 42px;
      flex: none;
      background: var(--cx-bg-deep);
      display: flex;
      align-items: flex-end;
      gap: 2px;
      padding: 0 10px;
      border-bottom: 1px solid var(--cx-border-soft);
    }
    /* 经典编辑器 tab：上圆角、底边与内容区融合 */
    .cx-code-tab {
      position: relative;
      height: 34px;
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: -1px;
      padding: 0 13px;
      background: var(--cx-panel-bg);
      border-radius: 9px 9px 0 0;
      font-family: var(--cx-font-mono);
      font-size: 12px;
      color: var(--cx-text);
    }
    .cx-code-tab::before,
    .cx-code-tab::after {
      content: "";
      position: absolute;
      bottom: 0;
      width: 9px;
      height: 9px;
      background: radial-gradient(circle at 0 0, transparent 9.5px, var(--cx-bg-deep) 9.5px);
    }
    .cx-code-tab::before { left: -9px; transform: scaleX(-1); pointer-events: none; }
    .cx-code-tab::after { right: -9px; transform: none; pointer-events: none; }
    .cx-code-tabs-actions {
      margin-left: auto;
      display: flex;
      align-self: center;
      gap: 2px;
      color: var(--cx-text-dim);
      padding-bottom: 6px;
    }
    .cx-code-tabs-actions .cx-icon-btn { width: 28px; height: 26px; border-radius: 6px; cursor: pointer; display: grid; place-items: center; }
    .cx-code-tabs-actions .cx-icon-btn:hover { background: var(--cx-wash); color: var(--cx-text); }
    .cx-code-tabs-actions svg { width: 15px; height: 15px; }
    .cx-code-tab .cx-rs-ic {
      width: 15px; height: 15px;
      border-radius: 50%;
      background: #45494f;
      color: #e8e8e8;
      font-size: 8px;
      font-weight: 700;
      display: grid;
      place-items: center;
    }
    .cx-code-tab .cx-close { opacity: 0.55; cursor: pointer; font-size: 13px; line-height: 1; }
    .cx-code-tab .cx-close:hover { opacity: 1; color: var(--cx-text); }
    .cx-code-add { align-self: center; margin-bottom: 6px; color: var(--cx-text-dim); font-size: 15px; cursor: pointer; padding: 2px 6px; }
    .cx-code-crumb {
      flex: none;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      font-size: 12px;
      color: var(--cx-text-dim);
      border-bottom: 1px solid var(--cx-border-soft);
      white-space: nowrap;
      overflow: hidden;
    }
    .cx-code-crumb .cx-crumbs {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;            /* 路径过长时自身收缩，右侧控件保持可见 */
    }
    .cx-code-crumb .cx-seg { cursor: pointer; white-space: nowrap; flex: none; }
    .cx-code-crumb .cx-seg:hover { color: var(--cx-text); }
    .cx-code-crumb .cx-cur {
      color: var(--cx-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .cx-code-crumb .cx-spacer { flex: 1; }
    .cx-code-view-toggle {
      display: flex;
      background: var(--cx-chip-bg);
      border-radius: 999px;
      padding: 2px;
      font-size: 11px;
    }
    .cx-code-view-toggle span {
      padding: 3px 10px;
      border-radius: 999px;
      cursor: pointer;
      color: var(--cx-text-dim);
    }
    .cx-code-view-toggle span.cx-on { background: var(--cx-bg-raised); color: var(--cx-text); }
    .cx-open-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--cx-text);
      background: var(--cx-chip-bg);
      border: 1px solid var(--cx-border-strong);
      border-radius: 8px;
      padding: 4px 11px;
      cursor: pointer;
      font-family: var(--cx-font-ui);
    }
    /* 「打开」= 语言下拉入口 */
    .cx-open-btn { gap: 5px; font-weight: 500; }
    .cx-open-btn .cx-chev { width: 11px; height: 11px; opacity: 0.75; }
    .cx-lang-menu {
      position: fixed;
      z-index: 960;
      min-width: 150px;
      padding: 5px;
      border-radius: 12px;
      background: var(--cx-bg-raised);
      border: 1px solid var(--cx-border);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: 13px;
    }
    .cx-lang-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 11px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--cx-text);
      white-space: nowrap;
    }
    .cx-lang-item:hover { background: var(--cx-wash); }
    .cx-lang-item.cx-on svg { width: 13px; height: 13px; color: var(--cx-blue); }
    .cx-code-body {
      flex: 1;
      overflow: auto;
      font-family: var(--cx-font-mono);
      font-size: 12px;
      line-height: 1.75;
      padding: 8px 0 24px;
      scrollbar-width: thin;
    }
    .cx-cline { display: flex; }
    .cx-cline .cx-ln {
      width: 52px;
      flex: none;
      text-align: right;
      padding-right: 14px;
      color: var(--cx-code-gutter);
      user-select: none;
    }
    .cx-cline .cx-lc { white-space: pre; color: var(--cx-code-text); }
    .cx-cline:hover { background: var(--cx-wash); }
    /* 三栏拖拽把手：rail 右缘 + 中间栏与代码面板之间 */
    .cx-resizer { position: relative; flex: none; z-index: 90; }
    .codex-rail > .cx-resizer {
      position: absolute;
      top: 0; bottom: 0; right: -3px;
      width: 7px;
      cursor: col-resize;
      z-index: 70;
    }
    .codex-body > .cx-resizer {
      width: 6px;
      margin: 0 -3px;
      align-self: stretch;
      cursor: col-resize;
    }
    .cx-resizer::before {
      content: "";
      position: absolute;
      left: 50%; top: 0; bottom: 0;
      width: 1px;
      transform: translateX(-50%);
      background: transparent;
    }
    .cx-resizer:hover::before,
    .cx-resizer.cx-dragging::before { background: var(--cx-blue); }
    body.codex-resizing, body.codex-resizing * { cursor: col-resize !important; user-select: none !important; }

    /* 面板开关 */
    .${ROOT_CLASS}.codex-hide-code-panel .cx-code-panel { display: none; }
    .${ROOT_CLASS}.codex-hide-code-panel .cx-panel-toggle { color: var(--cx-text-faint); }
    /* 收起面板后对话列占满整宽；内容由各自的 max-width 约束居中 */

    /* diff 模式 */
    .cx-cline.cx-add { background: var(--cx-diff-add-bg); }
    .cx-cline.cx-del { background: var(--cx-diff-del-bg); }
    .cx-cline.cx-add .cx-ln { color: var(--cx-diff-add-ln); }
    .cx-cline.cx-del .cx-ln { color: var(--cx-diff-del-ln); }
    .cx-cline.cx-hunk { background: var(--cx-diff-hunk-bg); }
    .cx-cline.cx-hunk .cx-lc { color: var(--cx-diff-hunk-tx); }
    .cx-cline.cx-meta .cx-lc { color: var(--cx-text-dim); }
    /* 语法高亮（深色实测自原版，浅色用同色相加深） */
    .tk-k { color: var(--cx-tok-k); }   /* 关键字 */
    .tk-s { color: var(--cx-tok-s); }   /* 字符串 */
    .tk-c { color: var(--cx-tok-c); }   /* 注释 */
    .tk-t { color: var(--cx-tok-t); }   /* 类型 */
    .tk-f { color: var(--cx-tok-f); }   /* 函数 */
    .tk-n { color: var(--cx-tok-n); }   /* 数字 */
    .tk-m { color: var(--cx-tok-m); }   /* 宏/属性 */

    /* ---------- 较窄屏：仍是真分屏 1:1，只放宽最小宽度 ---------- */
    @media (max-width: 1200px) {
      .cx-code-panel {
        min-width: 300px;
      }
    }

    /* ---------- 窄屏降级：rail 收起为抽屉 ---------- */
    @media (max-width: 900px) {
      .codex-rail {
        transform: translateX(-105%);
        transition: transform 0.18s ease;
      }
      .${ROOT_CLASS}.codex-rail-open .codex-rail {
        transform: none;
        box-shadow: 8px 0 28px rgba(0, 0, 0, 0.5);
      }
      .codex-main { left: 0; }
      .codex-topbar .cx-menu-btn { display: grid; }
      .${ROOT_CLASS}:not(.${LOCK_CLASS}) #main-outlet-wrapper { margin-left: 0 !important; }
      .${ROOT_CLASS}.${LOCK_CLASS} #reply-control.open,
      .${ROOT_CLASS}.${LOCK_CLASS} #reply-control.edit-title,
      .${ROOT_CLASS}.${LOCK_CLASS} #reply-control.fullscreen {
        left: 8px !important;
        right: 8px !important;
      }
      .codex-thread { padding: 20px 16px 32px; }
      .codex-composer-wrap { padding: 8px 12px 14px; }
      /* 太窄时代码面板直接不可用（纯装饰，不占小屏空间） */
      .cx-code-panel { display: none !important; }
      .cx-resizer { display: none !important; }
      .${ROOT_CLASS}.codex-hide-code-panel .codex-thread-col { flex: 1; width: auto; }
      .codex-topbar .cx-panel-toggle { display: none; }
    }

    /* ================= 全局浮动元素：toast / 引用跳回按钮 ================= */
    .cx-toast {
      position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(8px);
      background: var(--cx-bg-raised); color: var(--cx-text);
      border: 1px solid var(--cx-border-strong); border-radius: 10px;
      padding: 8px 16px; font-size: 13px; font-family: var(--cx-font-ui);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4); z-index: 3000;
      opacity: 0; pointer-events: none; transition: opacity 0.18s ease, transform 0.18s ease;
    }
    .cx-toast.cx-show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .cx-toast.cx-err { border-color: rgba(224, 98, 106, 0.55); color: #ffb3b8; }
    .cx-jump-back {
      position: fixed; right: 20px; bottom: 24px; z-index: 2800;
      display: inline-flex; align-items: center; gap: 7px;
      background: var(--cx-bg-raised); color: var(--cx-text);
      border: 1px solid var(--cx-border-strong); border-radius: 999px;
      padding: 7px 14px; font-size: 12.5px; font-family: var(--cx-font-ui); cursor: pointer;
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35); opacity: 0; pointer-events: none;
      transform: translateY(6px); transition: opacity 0.18s ease, transform 0.18s ease;
    }
    .cx-jump-back.cx-show { opacity: 1; pointer-events: auto; transform: translateY(0); }
    .cx-jump-back .cx-jump-back-x { color: var(--cx-text-faint); margin-left: 6px; }
    .cx-jump-src {
      margin-left: auto; display: inline-flex; align-items: center; gap: 3px;
      color: var(--cx-blue); font-size: 12px; cursor: pointer; padding: 2px 6px; border-radius: 5px;
    }
    .cx-jump-src:hover { background: var(--cx-btn-hover); }
    .cx-jump-highlight { animation: cx-flash 1.6s ease-out; }
    @keyframes cx-flash {
      0% { box-shadow: 0 0 0 2px var(--cx-blue), 0 0 22px rgba(42, 152, 255, 0.4); }
      100% { box-shadow: 0 0 0 2px transparent, 0 0 0 transparent; }
    }

    /* ================= 投票组件（移植自 im features/polls.js，配色走 Codex token） ================= */
    .codex-thread-posts .poll {
      background: var(--cx-bg-raised);
      border: 1px solid var(--cx-border);
      border-radius: var(--cx-radius);
      padding: 14px 16px;
      margin: 12px 0;
      user-select: none;
    }
    .codex-thread-posts .poll ol, .codex-thread-posts .poll ul {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;
    }
    .cx-poll-option {
      display: flex; align-items: center; padding: 9px 13px;
      border-radius: 9px; background: var(--cx-bg-inset);
      border: 1.5px solid var(--cx-border);
      cursor: pointer; position: relative; overflow: hidden;
      transition: all 0.18s ease;
    }
    .cx-poll-option:hover { background: var(--cx-btn-hover); }
    .cx-poll-option.selected {
      border-color: var(--cx-blue);
      background: color-mix(in srgb, var(--cx-blue) 12%, var(--cx-bg-inset));
    }
    .cx-poll-radio {
      width: 17px; height: 17px; min-width: 17px; border-radius: 50%;
      border: 2px solid var(--cx-text-faint); margin-right: 11px;
      flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
      box-sizing: border-box; transition: all 0.15s ease;
    }
    .cx-poll-option[data-multi="1"] .cx-poll-radio { border-radius: 4px; }
    .cx-poll-option.selected .cx-poll-radio { background: var(--cx-blue); border-color: var(--cx-blue); }
    .cx-poll-option.selected .cx-poll-radio::after { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #fff; }
    .cx-poll-option[data-multi="1"].selected .cx-poll-radio::after { border-radius: 1px; }
    .cx-poll-title { flex: 1; font-size: 13.5px; color: var(--cx-text); line-height: 1.4; z-index: 1; }
    .cx-poll-count { font-size: 12px; color: var(--cx-text-secondary); margin-left: 10px; z-index: 1; white-space: nowrap; }
    .cx-poll-bar {
      position: absolute; left: 0; top: 0; bottom: 0;
      background: color-mix(in srgb, var(--cx-blue) 16%, transparent);
      pointer-events: none; width: 0%; transition: width 0.35s ease; z-index: 0;
    }
    .cx-poll-actions {
      display: flex; align-items: center; gap: 12px; margin-top: 12px; padding-top: 10px;
      border-top: 1px dashed var(--cx-border);
    }
    .cx-poll-submit {
      height: 30px; padding: 0 18px; border-radius: 7px; font-size: 12.5px; font-weight: 500;
      border: none; background: var(--cx-blue); color: #fff; cursor: pointer;
    }
    .cx-poll-submit:disabled { opacity: 0.45; cursor: not-allowed; }
    .cx-poll-undo {
      height: 30px; padding: 0 14px; border-radius: 7px; font-size: 12.5px;
      border: 1px solid var(--cx-border-strong); background: transparent;
      color: var(--cx-text-secondary); cursor: pointer;
    }
    .cx-poll-undo:hover { background: var(--cx-btn-hover); }
    .cx-poll-tip { font-size: 11.5px; color: var(--cx-text-faint); margin-left: 6px; }

    /* 书签：操作按钮选中态 */
    .cx-act.bookmarked { color: var(--cx-blue); }
    .cx-act.bookmarked svg { fill: currentColor; }

    /* ================= 设置面板 =================
       挂在 <body> 上、不在 PAGE_LAYER_SELECTOR 名单里 → 永远 100% 不透明。
       z-index 2900：盖住灯箱(2000) / 引用跳回(2800)，但让 toast(3000) 露在上面
       （「已恢复默认设置」得看得见）。 */
    .cx-modal {
      position: fixed;
      inset: 0;
      z-index: 2900;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      font-family: var(--cx-font-ui);
    }
    .cx-modal[hidden] { display: none; }

    .cx-modal-card {
      width: 100%;
      max-width: 640px;
      max-height: min(86vh, 820px);
      display: flex;
      flex-direction: column;
      background: var(--cx-bg-raised);
      color: var(--cx-text);
      border: 1px solid var(--cx-border-strong);
      border-radius: 14px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
      overflow: hidden;
    }
    .cx-modal-head {
      flex: none;
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 15px 18px 13px;
      border-bottom: 1px solid var(--cx-border-soft);
    }
    .cx-modal-title { font-size: 15px; font-weight: 600; }
    .cx-modal-sub { font-size: 11.5px; color: var(--cx-text-faint); }
    .cx-modal-x {
      margin-left: auto;
      align-self: center;
      width: 26px; height: 26px;
      border: none; background: none;
      border-radius: 6px;
      color: var(--cx-text-dim);
      font-size: 18px; line-height: 1;
      cursor: pointer;
      display: grid; place-items: center;
    }
    .cx-modal-x:hover { background: var(--cx-btn-hover); color: var(--cx-text); }

    .cx-modal-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 4px 18px 14px;
      scrollbar-width: thin;
    }
    .cx-modal-body::-webkit-scrollbar { width: 8px; }
    .cx-modal-body::-webkit-scrollbar-thumb { background: var(--cx-scroll-thumb); border-radius: 4px; }

    .cx-set-section {
      margin: 18px 0 6px;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.5px;
      color: var(--cx-text-faint);
    }
    .cx-set-row {
      display: flex;
      align-items: flex-start;
      gap: 18px;
      padding: 9px 0;
      border-bottom: 1px solid var(--cx-border-soft);
    }
    .cx-set-row:last-child { border-bottom: none; }
    .cx-set-label { flex: 1; min-width: 0; font-size: 13px; }
    .cx-set-hint {
      margin-top: 3px;
      font-size: 11.5px;
      line-height: 1.5;
      color: var(--cx-text-faint);
    }
    .cx-set-ctrl {
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 132px;
      justify-content: flex-end;
    }
    .cx-set-val {
      min-width: 46px;
      text-align: right;
      font-size: 12px;
      color: var(--cx-text-dim);
      font-variant-numeric: tabular-nums;
      font-family: var(--cx-font-mono);
    }

    /* 开关 */
    .cx-switch {
      width: 38px; height: 22px;
      flex: none;
      border-radius: 999px;
      border: 1px solid var(--cx-border-strong);
      background: var(--cx-bg-inset);
      cursor: pointer;
      padding: 0;
      position: relative;
      transition: background 0.14s, border-color 0.14s;
    }
    .cx-switch > span {
      position: absolute;
      top: 2px; left: 2px;
      width: 16px; height: 16px;
      border-radius: 50%;
      background: var(--cx-text-dim);
      transition: transform 0.14s, background 0.14s;
    }
    .cx-switch.on { background: var(--cx-blue-soft); border-color: var(--cx-blue); }
    .cx-switch.on > span { transform: translateX(16px); background: var(--cx-blue); }
    .cx-switch:focus-visible { outline: 2px solid var(--cx-blue); outline-offset: 2px; }

    /* 滑块 */
    .cx-range {
      flex: 1;
      min-width: 110px;
      max-width: 190px;
      height: 22px;
      accent-color: var(--cx-blue);
      cursor: pointer;
    }
    /* 下拉 / 输入框 */
    .cx-select,
    .cx-text {
      font-family: var(--cx-font-ui);
      font-size: 12.5px;
      color: var(--cx-text);
      background: var(--cx-bg-inset);
      border: 1px solid var(--cx-border);
      border-radius: 7px;
      padding: 5px 8px;
      outline: none;
      min-width: 0;
    }
    .cx-select { max-width: 200px; }
    .cx-text { width: 160px; }
    .cx-text::placeholder { color: var(--cx-text-faint); }
    .cx-select:focus,
    .cx-text:focus { border-color: var(--cx-blue); }

    .cx-modal-foot {
      flex: none;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      border-top: 1px solid var(--cx-border-soft);
      font-size: 11.5px;
      color: var(--cx-text-faint);
    }
    .cx-modal-btn {
      font-family: var(--cx-font-ui);
      font-size: 12.5px;
      color: var(--cx-text);
      background: var(--cx-chip-bg);
      border: 1px solid var(--cx-border-strong);
      border-radius: 999px;
      padding: 5px 14px;
      cursor: pointer;
    }
    .cx-modal-btn:hover { background: var(--cx-btn-hover); }

    /* ======================================================================
     * 应急伪装视图（移植自 v2ex-codex）
     *
     * 整个视口变成「代码编辑器 + 构建日志」，不露 rail、不露论坛内容。
     * 用的是同一套 token，所以从正常视图切过来像是同一个 IDE 里换了个面板，
     * 不会出现「网站突然变了」的观感。
     *
     * 注意：伪装视图故意**不在** PAGE_LAYER_SELECTOR 里 —— 它的职责就是
     * 「一眼扫过去不像论坛」，自己半透明会让底下的论坛内容透上来，伪装直接打折。
     * ====================================================================== */
    html.${ROOT_CLASS}.${BOSS_CLASS} .codex-rail,
    html.${ROOT_CLASS}.${BOSS_CLASS} .codex-main { visibility: hidden !important; }

    .ldx-boss {
      position: fixed;
      inset: 0;
      z-index: 1400;
      display: flex;
      flex-direction: column;
      background: var(--cx-bg);
      color: var(--cx-text);
      font-family: var(--cx-font-ui);
      font-size: 13px;
    }
    .ldx-boss[hidden] { display: none; }

    .ldx-boss-bar {
      height: 38px;
      flex: none;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 10px;
      background: var(--cx-bg-deep);
      border-bottom: 1px solid var(--cx-border-soft);
      font-size: 12px;
      color: var(--cx-text-dim);
    }
    .ldx-boss-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 6px 6px 0 0;
      color: var(--cx-text-dim);
      white-space: nowrap;
    }
    .ldx-boss-tab.on { background: var(--cx-bg); color: var(--cx-text); }
    .ldx-boss-tab .ic { font-size: 10.5px; font-weight: 600; color: var(--cx-tok-k); }
    .ldx-boss-spacer { flex: 1; }
    .ldx-boss-shell {
      flex: none;
      font-family: var(--cx-font-mono);
      font-size: 11.5px;
      color: var(--cx-text-faint);
      padding: 0 10px;
      white-space: nowrap;
    }

    .ldx-boss-editor {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 10px 0 20px;
      font-family: var(--cx-font-mono);
      font-size: 12.5px;
      line-height: 1.65;
      color: var(--cx-code-text);
      scrollbar-width: thin;
    }
    .ldx-boss-editor::-webkit-scrollbar { width: 10px; }
    .ldx-boss-editor::-webkit-scrollbar-thumb { background: var(--cx-scroll-thumb); border-radius: 5px; }

    .ldx-boss-term {
      flex: none;
      height: 34%;
      min-height: 150px;
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--cx-border);
      background: var(--cx-bg-inset);
    }
    .ldx-boss-term-head {
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      font-size: 11px;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: var(--cx-text-faint);
      border-bottom: 1px solid var(--cx-border-soft);
    }
    .ldx-boss-term-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      margin: 0;
      padding: 10px 14px 16px;
      font-family: var(--cx-font-mono);
      font-size: 12.5px;
      line-height: 1.6;
      color: var(--cx-text-secondary);
      white-space: pre-wrap;
      scrollbar-width: thin;
    }
    .ldx-boss-term-body::-webkit-scrollbar { width: 10px; }
    .ldx-boss-term-body::-webkit-scrollbar-thumb { background: var(--cx-scroll-thumb); border-radius: 5px; }
    .ldx-boss-term-body .ok { color: #52b36b; }
    .ldx-boss-term-body .warn { color: #d3a03c; }
    .ldx-boss-term-body .dim { color: var(--cx-text-faint); }
    .ldx-boss-term-body .cmd { color: var(--cx-text); }
    .ldx-boss-caret {
      display: inline-block;
      width: 7px;
      height: 14px;
      vertical-align: -2px;
      background: var(--cx-text-secondary);
      animation: ldx-blink 1.1s steps(1) infinite;
    }
    @keyframes ldx-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .ldx-boss-caret { animation: none; } }
  `;

  /* ============================== 基础设施 ============================== */

  /**
   * 把 RAW_CSS 变成真正注入的样式表。
   *
   * 目前只做一件事：把规则体里的 `PAGE_LAYER_LIST {` 占位符换成 JS 常量
   * PAGE_LAYER_SELECTOR 展开后的选择器列表（每个选择器前补上
   * `html.codex-theme.codex-page-dim `），这样「哪些算页面层」只在 JS 里写一遍，
   * CSS 不会和它漂移。
   *
   * 匹配时特意带上后面的 `{`：注释里可能也提到占位符名字，
   * 不带上 `{` 的话 String.replace 会替换到第一处（注释里那处），规则就废了。
   * 以后再有这种「一份名单、两处消费」的东西，照这个模式加占位符即可。
   */
  function buildCss() {
    const pageLayerRules = PAGE_LAYER_SELECTOR
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `html.${ROOT_CLASS}.${DIMMED_CLASS} ${s}`)
      .join(",\n    ");
    return RAW_CSS.replace(/PAGE_LAYER_LIST\s*\{/, () => pageLayerRules + " {");
  }

  function injectStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    // 始终刷新，避免旧版 CSS 残留
    style.textContent = buildCss();
  }

  let faviconObserver = null;
  let faviconApplying = false;
  /** 被我们改过的原生 icon 链接的原始属性（选「保留站点原图标」时用来还原），null = 还没记录 */
  let faviconOriginals = null;

  /**
   * 还原站点原生 favicon。
   * 只在设置里选回「保留 linux.do 原图标」时需要 —— 之前被写掉的 href / type / sizes
   * 得一个个还回去，否则换了设置标签页图标不会恢复。
   */
  function restoreSiteFavicon() {
    document.getElementById(FAVICON_ID)?.remove();
    document.querySelector("link[data-codex-shortcut='1']")?.remove();
    if (faviconOriginals) {
      for (const rec of faviconOriginals) {
        if (!rec.el || !rec.el.isConnected) continue;
        if (rec.href === null) rec.el.removeAttribute("href");
        else rec.el.setAttribute("href", rec.href);
        if (rec.type === null) rec.el.removeAttribute("type");
        else rec.el.setAttribute("type", rec.type);
        if (rec.sizes === null) rec.el.removeAttribute("sizes");
        else rec.el.setAttribute("sizes", rec.sizes);
      }
      faviconOriginals = null;
    }
  }

  function makeFavicon() {
    const head = document.head;
    if (!head || faviconApplying) return;
    // 挑战页上不换标：那是 CF 的页面，换成 Codex 图标只会让人以为站点正常
    if (cfBlocked()) return;
    const href = makeCodexFaviconUri();
    if (!href) {
      // 「保留原图标」：不用覆盖，但得把之前覆盖过的还回去
      faviconApplying = true;
      try { restoreSiteFavicon(); } finally { faviconApplying = false; }
      return;
    }
    faviconApplying = true;
    try {
      const imgType = href.startsWith("data:image/svg+xml") ? "image/svg+xml" : "image/png";
      // 覆盖所有常见 icon 链（含 shortcut / apple-touch），避免未选中标签仍用站点原图
      const icons = head.querySelectorAll(
        "link[rel='icon'], link[rel='shortcut icon'], link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='apple-touch-icon-precomposed'], link[rel='mask-icon']"
      );
      // 首次覆盖前把原值记下来（只记一次：第二次起 href 已经是我们的 data URI 了）
      if (!faviconOriginals) {
        faviconOriginals = [...icons]
          .filter((icon) => icon.id !== FAVICON_ID && !icon.dataset.codexShortcut)
          .map((icon) => ({
            el: icon,
            href: icon.getAttribute("href"),
            type: icon.getAttribute("type"),
            sizes: icon.getAttribute("sizes")
          }));
      }
      for (const icon of icons) {
        if (icon.id && icon.id !== FAVICON_ID) icon.removeAttribute("id");
        if (icon.getAttribute("href") !== href) icon.setAttribute("href", href);
        if (icon.rel === "mask-icon") continue;
        if (icon.getAttribute("type") !== imgType) icon.setAttribute("type", imgType);
        if (!icon.getAttribute("sizes")) icon.setAttribute("sizes", "any");
      }

      let link = document.getElementById(FAVICON_ID);
      if (!link) {
        link = document.createElement("link");
        link.id = FAVICON_ID;
        link.rel = "icon";
        link.type = imgType;
        link.sizes = "any";
        link.setAttribute("href", href);
        head.appendChild(link);
      } else if (link.getAttribute("href") !== href) {
        link.setAttribute("href", href);
      }

      // 再补一条 shortcut icon，部分浏览器未聚焦标签时优先读它
      let shortcut = head.querySelector("link[data-codex-shortcut='1']");
      if (!shortcut) {
        shortcut = document.createElement("link");
        shortcut.rel = "shortcut icon";
        shortcut.type = imgType;
        shortcut.dataset.codexShortcut = "1";
        shortcut.setAttribute("href", href);
        head.insertBefore(shortcut, head.firstChild);
      } else if (shortcut.getAttribute("href") !== href) {
        shortcut.setAttribute("href", href);
      }

      if (!faviconObserver) {
        faviconObserver = new MutationObserver(() => {
          if (faviconApplying) return;
          // 站点 SPA / 主题脚本可能写回原 favicon
          makeFavicon();
        });
        faviconObserver.observe(head, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["href", "rel", "type", "sizes"]
        });
      }
    } finally {
      faviconApplying = false;
    }
  }

  /** 加载闪屏：logo 换成 ChatGPT 图标（照 idea 皮肤换标手法，幂等） */
  function applySplash() {
    const splash = document.getElementById("d-splash");
    if (!splash || splash.dataset.cxSplash === "1") return;
    // 「保留站点原图标」时不动闪屏：也不打标记，用户切回 Codex 图标后还能补上
    const uri = makeCodexFaviconUri();
    if (!uri) return;
    splash.dataset.cxSplash = "1";
    const logo = splash.querySelector(".splash-logo-container");
    if (logo) {
      logo.style.setProperty("background-image", `url("${uri}")`, "important");
    }
  }

  /* ============================== Ember / composer 调用链（移植自 feishu 脚本） ============================== */

  function discourseRequire(moduleId) {
    try {
      if (typeof window.require === "function") return window.require(moduleId);
    } catch { /* module missing */ }
    return null;
  }

  function safeLookup(owner, key) {
    if (!owner || typeof owner.lookup !== "function") return null;
    try {
      return owner.lookup(key);
    } catch {
      return null;
    }
  }

  function getEmberOwner() {
    try {
      if (window.Discourse?.__container__) return window.Discourse.__container__;

      // Ember.Namespace 反查 Discourse 应用
      const Ember = window.Ember;
      const namespaces = Ember?.Namespace?.NAMESPACES;
      if (Array.isArray(namespaces)) {
        const app = namespaces.find((n) =>
          n && (n.name === "Discourse" || n.modulePrefix === "discourse" || n.NAMESPACE === "Discourse")
        );
        if (app?.__container__) return app.__container__;
        if (typeof app?.lookup === "function") return app;
      }

      const mod =
        discourseRequire("discourse-common/lib/get-owner") ||
        discourseRequire("discourse/lib/get-owner");
      if (mod) {
        const owner =
          (typeof mod.getOwnerWithFallback === "function" && mod.getOwnerWithFallback(window.Discourse)) ||
          (typeof mod.getOwner === "function" && mod.getOwner(window.Discourse)) ||
          null;
        if (owner) return owner;
      }

      try {
        const appMod = discourseRequire("discourse/app");
        const app = appMod?.default || appMod;
        if (app?.__container__) return app.__container__;
        if (typeof app?.lookup === "function") return app;
      } catch { /* ignore */ }
    } catch (err) {
      console.warn("[linuxdo-codex] getEmberOwner failed", err);
    }
    return null;
  }

  function getComposerService(owner) {
    return safeLookup(owner, "service:composer") || safeLookup(owner, "controller:composer");
  }

  function getTopicModel(owner) {
    const topicController = safeLookup(owner, "controller:topic");
    if (!topicController) return null;
    try {
      return topicController.get?.("model") || topicController.model || null;
    } catch {
      return null;
    }
  }

  function findLoadedPost(topic, postNumber) {
    if (!topic || !postNumber) return null;
    try {
      const stream = topic.get?.("postStream") || topic.postStream;
      const posts = stream?.get?.("posts") || stream?.posts || [];
      return [...posts].find((p) =>
        Number(p?.get?.("post_number") ?? p?.post_number) === Number(postNumber)
      ) || null;
    } catch { /* ignore */ }
    return null;
  }

  function isComposerOpen() {
    const el = document.querySelector("#reply-control");
    return !!(el && (el.classList.contains("open") || el.classList.contains("fullscreen") || el.classList.contains("edit-title")));
  }

  /** 关闭原生回复面板：优先 composer service，兜底点取消按钮 */
  function closeNativeComposer() {
    try {
      const svc = getComposerService(getEmberOwner());
      if (svc && typeof svc.close === "function") { svc.close(); return; }
    } catch { /* fall through */ }
    document.querySelector("#reply-control .cancel, #reply-control button.close")?.click?.();
  }

  /** 点击原生输入面板以外区域时收起它（皮肤自己的 composer 入口除外） */
  function bindOutsideCloseComposer() {
    if (window.__codexOutsideCloseBound) return;
    window.__codexOutsideCloseBound = true;
    document.addEventListener("pointerdown", (e) => {
      const rc = document.getElementById("reply-control");
      if (!rc || !isComposerOpen()) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || rc.contains(t) || t.closest(".codex-composer")) return;
      closeNativeComposer();
    }, true);
  }

  /** 临时让原生回复按钮可被程序点击（它们在 height:0 的 outlet 里） */
  function withClickableNativeReplyControls(fn) {
    let style = document.getElementById("codex-temp-reply-click");
    if (!style) {
      style = document.createElement("style");
      style.id = "codex-temp-reply-click";
      style.textContent = `
        html.codex-theme.codex-locked #main-outlet #topic-footer-buttons,
        html.codex-theme.codex-locked #main-outlet .topic-footer-main-buttons,
        html.codex-theme.codex-locked #main-outlet .topic-footer-main-buttons *,
        html.codex-theme.codex-locked #main-outlet #topic-footer-buttons *,
        html.codex-theme.codex-locked #main-outlet .post-stream article .post-controls,
        html.codex-theme.codex-locked #main-outlet .post-stream article .post-controls * {
          visibility: visible !important;
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
          pointer-events: auto !important;
          position: relative !important;
        }
        html.codex-theme.codex-locked #main-outlet .container.posts,
        html.codex-theme.codex-locked #main-outlet .topic-area,
        html.codex-theme.codex-locked #main-outlet .post-stream,
        html.codex-theme.codex-locked #main-outlet .topic-footer-buttons,
        html.codex-theme.codex-locked #main-outlet #topic-footer-buttons {
          visibility: visible !important;
          height: auto !important;
          overflow: visible !important;
        }
      `;
      document.documentElement.appendChild(style);
    }
    try {
      return fn();
    } finally {
      setTimeout(() => {
        document.getElementById("codex-temp-reply-click")?.remove();
      }, 800);
    }
  }

  function clickNativeReplyButton(postNumber) {
    return withClickableNativeReplyControls(() => {
      if (postNumber) {
        const article = document.querySelector(
          `.post-stream article[data-post-number="${postNumber}"], #post_${postNumber}, article[id="post_${postNumber}"]`
        );
        const postReply = article?.querySelector(
          "button.reply, .post-controls button.reply, button.create.reply, .reply.create"
        );
        if (postReply) {
          postReply.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          return true;
        }
      }
      const topicSelectors = [
        "#topic-footer-buttons button.create",
        "#topic-footer-buttons button.btn-primary.create",
        ".topic-footer-main-buttons button.create",
        ".topic-footer-main-buttons button.btn-primary",
        "button.btn-primary.create.reply",
        "button.create.reply"
      ];
      for (const sel of topicSelectors) {
        const btn = document.querySelector(sel);
        // 避开顶栏「发新帖」
        if (!btn || btn.id === "create-topic" || btn.closest(".d-header")) continue;
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      }
      return false;
    });
  }

  function openComposerViaService(postNumber) {
    const owner = getEmberOwner();
    if (!owner) return false;
    const composer = getComposerService(owner);
    if (!composer) return false;
    const topic = getTopicModel(owner);
    const Composer = discourseRequire("discourse/models/composer");
    const REPLY = Composer?.REPLY || Composer?.default?.REPLY || "reply";

    try {
      if (postNumber) {
        const post = findLoadedPost(topic, postNumber);
        if (post && typeof composer.replyTo === "function") {
          composer.replyTo(post);
          return true;
        }
        if (post && typeof composer.open === "function") {
          composer.open({
            action: REPLY,
            post,
            draftKey: topic?.get?.("draft_key") || topic?.draft_key || `topic_${threadState.topicId}`,
            draftSequence: topic?.get?.("draft_sequence") ?? topic?.draft_sequence
          });
          return true;
        }
      }

      if (topic && typeof composer.replyToTopic === "function") {
        composer.replyToTopic(REPLY, topic);
        return true;
      }
      if (topic && typeof composer.open === "function") {
        composer.open({
          action: REPLY,
          topic,
          draftKey: topic.get?.("draft_key") || topic.draft_key || `topic_${threadState.topicId}`,
          draftSequence: topic.get?.("draft_sequence") ?? topic.draft_sequence,
          title: topic.get?.("title") || topic.title,
          categoryId: topic.get?.("category_id") || topic.category_id
        });
        return true;
      }
    } catch (err) {
      console.warn("[linuxdo-codex] composer service open failed", err);
    }
    return false;
  }

  function openComposerViaKeyboard(postNumber) {
    try {
      // Discourse：r = 回复话题；若先聚焦某楼再 r 可带引用——这里做话题级兜底
      if (postNumber) {
        const article = document.querySelector(
          `.post-stream article[data-post-number="${postNumber}"], #post_${postNumber}`
        );
        article?.setAttribute?.("tabindex", "-1");
        article?.focus?.();
      } else {
        document.activeElement?.blur?.();
      }
      const opts = { key: "r", code: "KeyR", keyCode: 82, which: 82, bubbles: true, cancelable: true, view: window };
      document.dispatchEvent(new KeyboardEvent("keydown", opts));
      document.body.dispatchEvent(new KeyboardEvent("keydown", opts));
      return true;
    } catch {
      return false;
    }
  }

  /** 打开 Discourse 原生 composer（必须真正 open，禁止只 focus textarea） */
  function openNativeComposer(postNumber) {
    try {
      if (isComposerOpen()) {
        const ta = document.querySelector("#reply-control.open textarea, #reply-control.fullscreen textarea");
        ta?.focus?.();
        return true;
      }

      let opened = false;
      try { opened = !!openComposerViaService(postNumber); } catch { /* fall through */ }
      if (!opened) {
        try { opened = !!clickNativeReplyButton(postNumber); } catch { /* fall through */ }
      }
      if (!opened) {
        try { openComposerViaKeyboard(postNumber); } catch { /* fall through */ }
      }

      // 最后手段：短暂解锁 LOCK，再试一次
      setTimeout(() => {
        if (isComposerOpen()) return;
        const root = document.documentElement;
        const hadLock = root.classList.contains(LOCK_CLASS);
        const unlock = document.createElement("style");
        unlock.id = "codex-unlock-for-reply";
        unlock.textContent = `
          html.codex-theme.codex-locked #main-outlet-wrapper,
          html.codex-theme.codex-locked #main-outlet,
          html.codex-theme.codex-locked #main-outlet > * {
            pointer-events: auto !important;
            visibility: visible !important;
            height: auto !important;
            overflow: visible !important;
          }
          html.codex-theme #reply-control {
            display: block !important;
            pointer-events: auto !important;
            z-index: 700 !important;
          }
        `;
        document.documentElement.appendChild(unlock);
        if (hadLock) root.classList.remove(LOCK_CLASS);
        try {
          if (!openComposerViaService(postNumber) && !clickNativeReplyButton(postNumber)) {
            openComposerViaKeyboard(postNumber);
          }
        } catch { /* ignore */ }
        setTimeout(() => {
          if (hadLock) root.classList.add(LOCK_CLASS);
          document.getElementById("codex-unlock-for-reply")?.remove();
          if (!isComposerOpen()) {
            console.warn("[linuxdo-codex] openNativeComposer failed", {
              topicId: threadState.topicId,
              postNumber,
              hasOwner: !!getEmberOwner(),
              hasComposer: !!getComposerService(getEmberOwner())
            });
          }
        }, 250);
      }, 180);

      return true;
    } catch (err) {
      console.warn("[linuxdo-codex] openNativeComposer crashed", err);
      return false;
    }
  }

  function replyToPost(postNumber) {
    // 有嵌套输入框时走本皮回复：楼层目标条 + 直接发送；否则照旧开原生
    if (document.querySelector(".codex-composer .cx-md-edit")) {
      cxSetComposerTarget(postNumber);
      return;
    }
    openNativeComposer(postNumber);
  }

  /** 打开「新话题」composer（列表视图用；categoryId 尽量预填当前分类） */
  function openNewTopicComposer() {
    const categoryId = categoryIdFromPath(location.pathname);
    try {
      if (isComposerOpen()) {
        const ta = document.querySelector("#reply-control.open textarea, #reply-control.fullscreen textarea");
        ta?.focus?.();
        return true;
      }
      const owner = getEmberOwner();
      const composer = getComposerService(owner);
      const Composer = discourseRequire("discourse/models/composer");
      const CREATE = Composer?.CREATE_TOPIC || Composer?.default?.CREATE_TOPIC || "createTopic";
      const draftKey = Composer?.NEW_TOPIC_KEY || Composer?.default?.NEW_TOPIC_KEY || "new_topic";
      if (composer && typeof composer.open === "function") {
        composer.open({
          action: CREATE,
          draftKey,
          draftSequence: 0,
          ...(categoryId ? { categoryId } : {})
        });
        return true;
      }
    } catch (err) {
      console.warn("[linuxdo-codex] openNewTopicComposer service failed", err);
    }
    // 兜底一：点原生「新话题」按钮（顶栏被视觉隐藏，但 DOM 可点）
    try {
      const btn = document.querySelector("#create-topic");
      if (btn) {
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      }
    } catch { /* ignore */ }
    // 兜底二：Discourse 快捷键 c = 新话题
    try {
      const opts = { key: "c", code: "KeyC", keyCode: 67, which: 67, bubbles: true, cancelable: true, view: window };
      document.dispatchEvent(new KeyboardEvent("keydown", opts));
      document.body.dispatchEvent(new KeyboardEvent("keydown", opts));
    } catch { /* ignore */ }
    return false;
  }

  /* ============================== 通知 / 用户菜单收养（移植自 feishu 脚本） ============================== */

  let notifOpenInFlight = false;
  let notifMenuObserver = null;
  let notifPinned = false;   // 点击钉住；再点触发器 / 点外面取消
  let notifWantOpen = false; // 意向开关：避免收起后被 observer 再次捞起

  /** 读取 Discourse 未读通知数（与顶栏用户菜单角标同源） */
  function getUnreadNotificationCount() {
    try {
      const owner = getEmberOwner();
      const user =
        safeLookup(owner, "service:current-user") ||
        window.Discourse?.User?.current?.() ||
        null;
      if (user) {
        const pick = (key) => {
          try {
            const v = user.get?.(key);
            if (v != null && v !== "") return Number(v);
          } catch { /* ignore */ }
          const direct = user[key];
          return direct == null || direct === "" ? null : Number(direct);
        };
        const all = pick("all_unread_notifications_count");
        if (all != null && !Number.isNaN(all)) return Math.max(0, all);
        const unread = pick("unread_notifications");
        const high = pick("unread_high_priority_notifications");
        const pm = pick("new_personal_messages_notifications_count");
        const sum = (unread || 0) + (high || 0) + (pm || 0);
        if (sum > 0) return sum;
        if (unread != null && !Number.isNaN(unread)) return Math.max(0, unread);
      }
    } catch { /* ignore */ }

    const domBadge = document.querySelector(
      "#current-user .badge-notification, " +
      ".header-dropdown-toggle.current-user .badge-notification, " +
      "#toggle-current-user .badge-notification, " +
      ".current-user .badge-notification"
    );
    if (domBadge) {
      const text = (domBadge.textContent || "").replace(/\s+/g, "").trim();
      if (/^\d+$/.test(text)) return Number(text);
      if (/\d/.test(text)) {
        const n = parseInt(text, 10);
        if (!Number.isNaN(n)) return Math.min(n, 99);
      }
      if (domBadge.classList.contains("unread") || domBadge.querySelector("svg")) return 1;
    }
    return 0;
  }

  function findUserMenu() {
    return document.querySelector(".user-menu.revamped.menu-panel, .user-menu.menu-panel, .user-menu");
  }

  function findUserMenuToggle() {
    return document.querySelector(
      "#toggle-current-user, #current-user button, .header-dropdown-toggle.current-user button, .current-user button.icon, #current-user .icon, #current-user summary, button[aria-controls*='user'], .header-dropdown-toggle.current-user"
    );
  }

  function getHeaderService() {
    return safeLookup(getEmberOwner(), "service:header");
  }

  /** 打开/关闭 Discourse 原生 user-menu（优先 Ember header.userVisible） */
  function setUserMenuVisible(visible) {
    const header = getHeaderService();
    if (header) {
      try {
        if ("userVisible" in header) {
          header.userVisible = !!visible;
          return true;
        }
        if (typeof header.set === "function") {
          header.set("userVisible", !!visible);
          return true;
        }
      } catch (err) {
        console.warn("[linuxdo-codex] header.userVisible failed", err);
      }
    }

    const events = safeLookup(getEmberOwner(), "service:app-events");
    if (events && typeof events.trigger === "function") {
      try {
        const isOpen = !!findUserMenu();
        // keyboard-trigger 是 toggle：仅在状态需要变化时触发
        if (!!visible !== isOpen) {
          events.trigger("header:keyboard-trigger", { type: "user" });
        }
        return true;
      } catch (err) {
        console.warn("[linuxdo-codex] app-events user menu failed", err);
      }
    }
    return false;
  }

  function setNotifOpenClass(open) {
    document.documentElement.classList.toggle("codex-notif-open", !!open);
  }

  function positionNotifMenu(menu) {
    if (!menu || !notifWantOpen) return;
    // 顶栏被 opacity:0 / clip 藏起来；菜单必须挪到 body 才能看见
    if (menu.parentElement !== document.body) {
      document.body.appendChild(menu);
    }
    menu.classList.add("codex-user-menu-float", "show-avatars");
    // 显隐交给 html.codex-notif-open；这里清掉 Discourse 内联定位
    menu.style.display = "";
    menu.style.visibility = "";
    menu.style.opacity = "";
    menu.style.pointerEvents = "";
    menu.style.position = "";
    menu.style.left = "";
    menu.style.top = "";
    menu.style.right = "";
    menu.style.bottom = "";
    menu.style.transform = "";
    setNotifOpenClass(true);
  }

  function clickUserMenuToggle() {
    const toggle = findUserMenuToggle();
    if (!toggle) return false;
    try {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    } catch {
      try { toggle.click(); } catch { return false; }
    }
    return true;
  }

  /** 短暂解除顶栏隐藏，让原生 click / Ember 能创建菜单，再靠 observer 挪到 body */
  function unlockHeaderForNotifClick() {
    let style = document.getElementById("codex-unlock-header");
    if (!style) {
      style = document.createElement("style");
      style.id = "codex-unlock-header";
      style.textContent = `
        html.codex-theme.codex-notif-opening .d-header-wrap,
        html.codex-theme.codex-notif-opening .d-header {
          opacity: 1 !important;
          clip: auto !important;
          overflow: visible !important;
          width: auto !important;
          height: auto !important;
          max-width: none !important;
          max-height: none !important;
          pointer-events: auto !important;
          z-index: 850 !important;
          top: -9999px !important;
          left: 0 !important;
          position: fixed !important;
        }
      `;
      document.documentElement.appendChild(style);
    }
    document.documentElement.classList.add("codex-notif-opening");
  }

  function lockHeaderAfterNotif() {
    document.documentElement.classList.remove("codex-notif-opening");
  }

  function adoptNotifMenuIfAny() {
    if (!notifWantOpen) return false;
    const menu = findUserMenu();
    if (!menu) return false;
    positionNotifMenu(menu);
    lockHeaderAfterNotif();
    return true;
  }

  function openNotifMenu() {
    notifWantOpen = true;
    if (adoptNotifMenuIfAny()) {
      // 已打开则确保 Ember 状态同步为可见
      setUserMenuVisible(true);
      return true;
    }
    if (notifOpenInFlight) return false;
    notifOpenInFlight = true;
    ensureNotifMenuObserver();

    let opened = false;
    try {
      opened = setUserMenuVisible(true);
    } catch (err) {
      console.warn("[linuxdo-codex] setUserMenuVisible threw", err);
    }

    // Ember 失败或不立刻出 DOM → 解锁顶栏再点一次原生按钮
    if (!findUserMenu()) {
      unlockHeaderForNotifClick();
      clickUserMenuToggle();
    } else {
      opened = true;
    }

    let tries = 0;
    const poll = setInterval(() => {
      if (adoptNotifMenuIfAny()) {
        notifOpenInFlight = false;
        clearInterval(poll);
        return;
      }
      if (++tries > 24) {
        notifOpenInFlight = false;
        lockHeaderAfterNotif();
        clearInterval(poll);
        console.warn("[linuxdo-codex] openNotifMenu: menu not found", {
          opened,
          hasOwner: !!getEmberOwner(),
          hasHeader: !!getHeaderService(),
          hasToggle: !!findUserMenuToggle()
        });
      }
    }, 50);
    return opened;
  }

  function setNotifPinned(pinned) {
    notifPinned = !!pinned;
    document.documentElement.classList.toggle("codex-notif-pinned", notifPinned);
  }

  function hideNotifMenuNode(menu) {
    if (!menu) return;
    // 先靠 html.codex-notif-open 隐藏；再尽量拆掉节点，防止 Ember 残留
    menu.classList.remove("show-avatars");
    try {
      menu.remove();
    } catch {
      menu.classList.remove("codex-user-menu-float");
      menu.style.display = "none";
    }
  }

  function closeNotifMenu() {
    notifWantOpen = false;
    notifOpenInFlight = false;
    setNotifPinned(false);
    setNotifOpenClass(false); // 关键：立刻靠 CSS 藏掉
    lockHeaderAfterNotif();
    // 藏掉所有我们捞出来的浮层副本
    document.querySelectorAll(".user-menu.codex-user-menu-float, .codex-user-menu-float").forEach(hideNotifMenuNode);
    hideNotifMenuNode(findUserMenu());
    try { setUserMenuVisible(false); } catch { /* ignore */ }
    // 看过通知后刷新铃铛蓝点
    setTimeout(() => syncRail(), 400);
  }

  function ensureNotifMenuObserver() {
    if (notifMenuObserver) return;
    notifMenuObserver = new MutationObserver(() => {
      if (otherThemeActive()) return;
      if (!notifWantOpen) return;
      adoptNotifMenuIfAny();
    });
    notifMenuObserver.observe(document.body, { childList: true, subtree: true });
  }

  function isNotifMenuOpen() {
    return notifPinned || document.documentElement.classList.contains("codex-notif-open");
  }

  function ensureNotifOutsideClose() {
    if (window.__codexNotifOutsideBound) return;
    window.__codexNotifOutsideBound = true;
    const onOutside = (e) => {
      if (!isNotifMenuOpen()) return;
      const triggers = document.querySelectorAll("[data-codex-notif-trigger]");
      const menu = document.querySelector(".user-menu.codex-user-menu-float, .codex-user-menu-float");
      const t = e.target;
      for (const el of triggers) {
        if (el === t || el.contains(t)) return;
      }
      if (menu && (menu === t || menu.contains(t))) return;
      closeNotifMenu();
    };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("mousedown", onOutside, true);
  }

  /** 铃铛 / 底部用户行：点击钉住开菜单，再点收起（无 hover 逻辑，桌面窄屏都可用） */
  function bindNotifTrigger(el) {
    if (!el || el.dataset.notifBound === "1") return;
    el.dataset.notifBound = "1";
    ensureNotifOutsideClose();

    el.addEventListener("click", (e) => {
      if (otherThemeActive()) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

      if (notifPinned) {
        closeNotifMenu();
        return;
      }
      ensureNotifMenuObserver();
      openNotifMenu();
      setNotifPinned(true);
    });
  }

  /* ============================== 分类数据 ============================== */

  let categoriesCache = null; // [{id,name,slug,color,...}]

  async function loadCategories() {
    if (categoriesCache) return categoriesCache;
    try {
      const data = await apiWithRetry("/categories.json");
      categoriesCache = (data.category_list && data.category_list.categories) || [];
    } catch {
      // 被拦时退回页面内预加载的 site 数据（匿名也会带 categories）
      const site = readPreloadedJson((key, data) => Array.isArray(data.categories) && data.categories.length > 0);
      categoriesCache = (site && site.categories) || [];
    }
    return categoriesCache;
  }

  function categoryById(id) {
    return (categoriesCache || []).find((c) => c.id === id) || null;
  }

  function categoryBySlug(slug) {
    const s = String(slug || "").toLowerCase();
    return (categoriesCache || []).find((c) => String(c.slug).toLowerCase() === s) || null;
  }

  /* ============================== 站内软跳转 ============================== */

  function discourseRouteTo(url) {
    if (!url) return false;
    try {
      const mod = discourseRequire("discourse/lib/url");
      const DiscourseURL = mod?.default || mod;
      if (DiscourseURL && typeof DiscourseURL.routeTo === "function") {
        DiscourseURL.routeTo(url);
        return true;
      }
    } catch { /* ignore */ }
    try {
      if (typeof window.Discourse?.URL?.routeTo === "function") {
        window.Discourse.URL.routeTo(url);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  function navigateInApp(url) {
    if (!url) return;
    // 绝对地址收成站内路径
    let path = url;
    try {
      if (/^https?:/i.test(url)) {
        const u = new URL(url, location.origin);
        if (u.origin !== location.origin) { window.open(url, "_blank", "noopener"); return; }
        path = u.pathname + u.search + u.hash;
      }
    } catch { /* keep url */ }
    if (discourseRouteTo(path)) {
      scheduleApply();
      return;
    }
    history.pushState({}, "", path);
    scheduleApply();
  }

  /* ============================== 左 rail ============================== */

  let categoriesExpanded = false; // 「分类」分组「展开显示」
  const expandedCats = new Set(); // 分类下子线程的逐组展开
  let catsDefaultSeeded = false; // 首次渲染时默认展开第一个分类
  let recentTopicsCache = null;   // 「最近」分组：/latest.json 前几条

  // 分类下的装饰性「session 名」文案池：真实话题不够数时用来凑版面
  const MOCK_SESSIONS = [
    "分析一下当前项目",
    "只读分析前端界面与路由",
    "修复 CI 打包报错",
    "梳理一下接口鉴权协议",
    "重构设置页布局",
    "排查偶发白屏问题",
    "整理组件依赖关系",
    "调研跨平台路径兼容",
    "补充单元测试覆盖",
    "优化首屏加载性能",
    "对比两套缓存方案",
    "定位任务队列卡住的原因",
  ];

  /** 某分类的「session 列表」：真实话题优先，不足用文案池凑（按 catId 播种保证稳定） */
  function sessionsForCat(cat, idx) {
    const realPool = [...(listState.topics || []), ...(recentTopicsCache || [])]
      .filter((t) => t.category_id === cat.id);
    const seen = new Set();
    const out = [];
    for (const t of realPool) {
      if (!t.title || seen.has(t.title)) continue;
      seen.add(t.title);
      out.push({ label: t.title, href: topicHref(t), unread: topicUnread(t) > 0 });
      if (out.length >= 4) break;
    }
    for (let i = 0; out.length < 4 && i < MOCK_SESSIONS.length; i++) {
      const pick = MOCK_SESSIONS[(cat.id * 5 + idx * 3 + i * 7) % MOCK_SESSIONS.length];
      if (seen.has(pick)) { continue; }
      seen.add(pick);
      out.push({ label: pick, href: `/c/${cat.slug}/${cat.id}`, unread: false });
    }
    if (!out.length) {
      out.push({ label: "分析一下当前项目", href: `/c/${cat.slug}/${cat.id}`, unread: false });
    }
    return out;
  }

  function topicHref(topic) {
    return `/t/${topic.slug || "topic"}/${topic.id}`;
  }

  function topicUnread(topic) {
    return (topic.unread > 0 ? topic.unread : 0) + (topic.new_posts > 0 ? topic.new_posts : 0);
  }

  /**
   * 取「自己画的」节点。.codex-rail / .codex-main / .cx-modal 这些 class 名另一份
   * Codex 主题脚本也在用，凡是有全局副作用的入口（同步标题 / 重渲染 / 写 DOM）
   * 一律走这两个助手，避免改到对方头上。
   */
  function ownNode(selector) {
    return document.querySelector(`${selector}[${OWNER_ATTR}="${OWNER_ID}"]`);
  }
  function ownMain() { return ownNode(".codex-main"); }
  function ownModal() { return ownNode(".cx-modal"); }

  function ensureRail() {
    // 只复用「自己画的」rail
    let rail = ownNode(".codex-rail");
    if (rail) {
      syncRail();
      return rail;
    }
    rail = document.createElement("aside");
    rail.className = "codex-rail";
    rail.setAttribute("aria-label", "Codex 风导航");
    rail.setAttribute(OWNER_ATTR, OWNER_ID); // 互斥避让时靠它认出「这是自己画的」

    // 顶部窗口控制占位（收起/后退/前进装饰图标）
    const traffic = document.createElement("div");
    traffic.className = "codex-rail-traffic";
    traffic.innerHTML =
      ICONS.sidebar +
      ICONS.chevronLeft +
      `<span style="opacity:0.45;display:inline-flex">${ICONS.chevronRight}</span>`;
    // 收起图标：窄屏时收起抽屉；宽屏纯装饰
    traffic.firstElementChild?.addEventListener?.("click", () => {
      document.documentElement.classList.toggle("codex-rail-open");
    });
    rail.appendChild(traffic);

    // 品牌行：品牌名（伪装模式下是 Codex）⌄ + 搜索 + 通知铃铛
    const brand = document.createElement("div");
    brand.className = "codex-rail-brand";
    brand.innerHTML = `
      <div class="codex-rail-brand-name"><span data-brand-name></span> ${ICONS.chevronDown}</div>
      <div class="codex-rail-brand-actions">
        <span class="codex-rail-search-btn" title="搜索">${ICONS.search}</span>
        <span class="codex-rail-bell" title="通知" data-codex-notif-trigger="1">${ICONS.bell}</span>
      </div>`;
    brand.querySelector(".codex-rail-brand-name").addEventListener("click", () => navigateInApp("/latest"));
    brand.querySelector(".codex-rail-search-btn").addEventListener("click", () => openNativeSearch());
    rail.appendChild(brand);
    syncBrandName();

    // 可滚动区：导航项 + 动态分组（置顶/分类/最近）
    const scroll = document.createElement("div");
    scroll.className = "codex-rail-scroll";
    scroll.innerHTML = `
      <nav class="codex-rail-nav">
        <div class="codex-rail-item" data-nav="topics">${ICONS.layers}<span class="cx-label">话题</span></div>
        <div class="codex-rail-item" data-nav="drafts" title="草稿保存在原生编辑器中">${ICONS.user}<span class="cx-label">我的草稿</span></div>
        <div class="codex-rail-item" data-nav="messages">${ICONS.inbox}<span class="cx-label">我的消息</span></div>
        <div class="codex-rail-item cx-faint" data-nav="bots" title="装饰入口（Codex 风格占位，无实际功能）">${ICONS.bot}<span class="cx-label">AI 机器人</span></div>
        <div class="codex-rail-item" data-nav="activity">${ICONS.clock}<span class="cx-label">近期活动</span></div>
        <div class="codex-rail-item cx-faint" data-nav="more">${ICONS.dotsV}<span class="cx-label">更多</span></div>
      </nav>
      <div class="codex-rail-dynamic"></div>`;
    rail.appendChild(scroll);

    // 底部：当前用户名 + 明暗切换（收养原生用户菜单）
    const foot = document.createElement("div");
    foot.className = "codex-rail-foot";
    foot.innerHTML = `
      <div class="codex-rail-foot-user" data-codex-notif-trigger="1" title="账户与通知">
        ${ICONS.gear}<span class="cx-label" data-username>…</span>
      </div>
      <button class="cx-mode-btn" data-mode-toggle title="切换明暗模式"></button>`;
    rail.appendChild(foot);

    // 右缘拖拽把手：调整左栏宽度
    rail.insertAdjacentHTML("beforeend", `<div class="cx-resizer" data-resize="rail" title="拖拽调整侧栏宽度"></div>`);

    // 明暗切换按钮：光/暗二态翻转，偏好交给设置面板（theme）落盘
    foot.querySelector("[data-mode-toggle]").addEventListener("click", () => {
      setCfg("theme", isDarkMode() ? "light" : "dark");
    });

    document.body.appendChild(rail);

    // 导航项行为
    scroll.querySelector('[data-nav="topics"]').addEventListener("click", () => {
      closeRailDrawer();
      navigateInApp("/latest");
    });
    scroll.querySelector('[data-nav="drafts"]').addEventListener("click", () => {
      closeRailDrawer();
      openNewTopicComposer();
    });
    scroll.querySelector('[data-nav="messages"]').addEventListener("click", () => {
      closeRailDrawer();
      navigateInApp("/messages");
    });
    scroll.querySelector('[data-nav="bots"]').addEventListener("click", () => {
      closeRailDrawer();
    });
    scroll.querySelector('[data-nav="activity"]').addEventListener("click", () => {
      closeRailDrawer();
      navigateInApp("/my/activity");
    });
    scroll.querySelector('[data-nav="more"]').addEventListener("click", () => {
      categoriesExpanded = !categoriesExpanded;
      delete rail.querySelector(".codex-rail-dynamic")?.dataset.sig;
      renderRailDynamic();
    });
    // AI 机器人之外均为真实路由；bots 仅装饰（tooltip 已标）

    bindNotifTrigger(brand.querySelector(".codex-rail-bell"));
    bindNotifTrigger(foot.querySelector(".codex-rail-foot-user"));

    renderRailDynamic();
    syncRail();
    loadRailExtras();
    bindResizers();
    return rail;
  }

  function closeRailDrawer() {
    document.documentElement.classList.remove("codex-rail-open");
  }

  /** rail 动态分组：置顶 / 分类 / 最近 */
  function renderRailDynamic() {
    const box = document.querySelector(".codex-rail-dynamic");
    // 别人的 rail 里也有同名容器：只渲染自己这份
    if (!box || box.closest(".codex-rail")?.getAttribute(OWNER_ATTR) !== OWNER_ID) return;
    const parts = [];

    // 置顶
    const pins = (listState.topics || []).filter((t) => t.pinned).slice(0, 5);
    if (pins.length) {
      parts.push(`<div class="codex-rail-section">置顶</div><div class="codex-rail-section-items">`);
      for (const t of pins) {
        parts.push(
          `<div class="codex-rail-item" data-href="${escapeHtml(topicHref(t))}" title="${escapeHtml(t.title)}">` +
          `<span class="cx-label">${escapeHtml(t.title)}</span>` +
          (topicUnread(t) ? `<span class="cx-dot"></span>` : "") +
          `</div>`
        );
      }
      parts.push(`</div>`);
    }

    // 分类
    const cats = categoriesCache || [];
    if (cats.length) {
      // 首次渲染默认展开第一个分类（用户手动收起后不再重置）
      if (!catsDefaultSeeded) {
        catsDefaultSeeded = true;
        expandedCats.add(cats[0].id);
      }
      const shown = categoriesExpanded ? cats : cats.slice(0, 5);
      parts.push(`<div class="codex-rail-section">分类</div><div class="codex-rail-section-items">`);
      const curPath = location.pathname;
      for (const [idx, c] of shown.entries()) {
        const href = `/c/${c.slug}/${c.id}`;
        const active = curPath.startsWith(`/c/${c.slug}`);
        // 分类下的「session」子条目：默认收起，点击分类下的「展开显示」才展开
        // （对齐原版项目线程列表；避免每个分类下都挂子条目显得全部铺开）
        const open = expandedCats.has(c.id);
        parts.push(
          `<div class="codex-rail-item${active ? " active" : ""}" data-href="${escapeHtml(href)}" title="${escapeHtml(c.name)}">` +
          `${open ? ICONS.folderOpen : ICONS.folder}<span class="cx-label">${escapeHtml(c.name)}</span>` +
          (c.unread > 0 ? `<span class="cx-dot"></span>` : "") +
          `</div>`
        );
        const subs = sessionsForCat(c, idx);
        const shownSubs = open ? subs : [];
        for (const s of shownSubs) {
          parts.push(
            `<div class="codex-rail-item codex-rail-subitem" data-href="${escapeHtml(s.href)}" title="${escapeHtml(s.label)}">` +
            `<span class="cx-label">${escapeHtml(s.label)}</span>` +
            (s.unread ? `<span class="cx-dot"></span>` : "") +
            `</div>`
          );
        }
        if (subs.length) {
          parts.push(
            `<div class="codex-rail-item cx-faint codex-rail-subitem" data-toggle-cat="${c.id}">` +
            (open ? "收起 ↑" : "展开显示 ↓") +
            `</div>`
          );
        }
      }
      if (cats.length > 5) {
        parts.push(
          `<div class="codex-rail-item cx-faint" data-toggle-cats="1">` +
          (categoriesExpanded ? "收起" : "展开显示") +
          `</div>`
        );
      }
      parts.push(`</div>`);
    }

    // 最近
    const recent = (recentTopicsCache || []).slice(0, 4);
    if (recent.length) {
      parts.push(`<div class="codex-rail-section">最近</div><div class="codex-rail-section-items">`);
      for (const t of recent) {
        parts.push(
          `<div class="codex-rail-item" data-href="${escapeHtml(topicHref(t))}" title="${escapeHtml(t.title)}">` +
          `<span class="cx-label">${escapeHtml(t.title)}</span>` +
          (topicUnread(t) ? `<span class="cx-dot"></span>` : "") +
          `</div>`
        );
      }
      parts.push(`</div>`);
    }

    const html = parts.join("");
    if (box.dataset.sig === html) return; // 避免无变化时触发 MutationObserver 空转
    box.dataset.sig = html;
    box.innerHTML = html;
  }

  /** rail 点击委托：动态分组里的跳转 + 展开显示 */
  function bindRailClicks() {
    const rail = document.querySelector(".codex-rail");
    // 只绑自己画的 rail，别人的界面不碰
    if (!rail || rail.getAttribute(OWNER_ATTR) !== OWNER_ID) return;
    if (rail.dataset.clickBound === "1") return;
    rail.dataset.clickBound = "1";
    rail.addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-toggle-cats]");
      if (toggle && rail.contains(toggle)) {
        categoriesExpanded = !categoriesExpanded;
        delete rail.querySelector(".codex-rail-dynamic")?.dataset.sig;
        renderRailDynamic();
        return;
      }
      const catToggle = e.target.closest("[data-toggle-cat]");
      if (catToggle && rail.contains(catToggle)) {
        const id = Number(catToggle.getAttribute("data-toggle-cat"));
        expandedCats.has(id) ? expandedCats.delete(id) : expandedCats.add(id);
        delete rail.querySelector(".codex-rail-dynamic")?.dataset.sig;
        renderRailDynamic();
        return;
      }
      const item = e.target.closest("[data-href]");
      if (!item || !rail.contains(item)) return;
      closeRailDrawer();
      navigateInApp(item.getAttribute("data-href"));
    });
  }

  /** 额外数据：分类 / 最近 / 书签数（失败静默） */
  function loadRailExtras() {
    loadCategories().then(() => {
      renderRailDynamic();
      // 分类名到位后刷新列表视图标题/面包屑
      syncChrome();
    });
    if (!recentTopicsCache) {
      apiWithRetry("/latest.json")
        .then((data) => {
          recentTopicsCache = (data.topic_list && data.topic_list.topics) || [];
          renderRailDynamic();
        })
        .catch(() => { recentTopicsCache = []; });
    }
  }

  /** 同步 rail 状态：用户名 / 铃铛蓝点 / 书签数 / 导航 active */
  function syncRail() {
    const rail = document.querySelector(".codex-rail");
    // 别人的 rail 不动（syncTitle 就挂在下面，改到人家头上会把对方标签页标题也换了）
    if (!rail || rail.getAttribute(OWNER_ATTR) !== OWNER_ID) return;
    bindRailClicks();

    const name = getCurrentUsername();
    const nameEl = rail.querySelector("[data-username]");
    if (nameEl && name && nameEl.textContent !== name) nameEl.textContent = name;
    if (nameEl && !name && nameEl.textContent === "…") nameEl.textContent = "未登录";

    const bell = rail.querySelector(".codex-rail-bell");
    if (bell) bell.classList.toggle("has-unread", getUnreadNotificationCount() > 0);
    syncModeBtn();
    // 这个函数被 15 秒一次的定时器复用，顺手把站点写回的标题再盖一次
    syncBrandName();
    syncTitle();

    // 导航 active：话题 / 我的消息 / 近期活动
    const path = location.pathname;
    rail.querySelector('[data-nav="topics"]')?.classList.toggle(
      "active",
      path === "/" || /^(\/(latest|new|unread|unseen|top|hot)|\/c\/|\/t\/)/.test(path)
    );
    rail.querySelector('[data-nav="messages"]')?.classList.toggle("active", path.startsWith("/messages"));
    rail.querySelector('[data-nav="activity"]')?.classList.toggle("active", path.startsWith("/my"));
  }

  /** 搜索图标：优先打开原生搜索面板，失败退回 /search 页 */
  function openNativeSearch() {
    try {
      const btn = document.querySelector(
        "#search-button, .d-header .search-dropdown button, .d-header li.search-dropdown .icon, button.search-dropdown"
      );
      if (btn) {
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return;
      }
    } catch { /* ignore */ }
    navigateInApp("/search");
  }

  /* ============================== 主区骨架与顶栏 ============================== */

  function ensureMain() {
    // 同 ensureRail：只认自己画的 .codex-main
    let main = document.querySelector(`.codex-main[${OWNER_ATTR}="${OWNER_ID}"]`);
    if (main) {
      bindMainEvents(main);
      return main;
    }
    main = document.createElement("main");
    main.className = "codex-main";
    main.setAttribute(OWNER_ATTR, OWNER_ID); // 互斥避让时靠它认出「这是自己画的」
    main.innerHTML = `
      <div class="codex-body">
        <div class="codex-thread-col">
          <header class="codex-topbar">
            <button class="cx-icon-btn cx-menu-btn" title="打开侧栏">${ICONS.menu}</button>
            <span class="cx-icon-btn cx-back-btn" title="返回列表">${ICONS.folder}</span>
            <div class="cx-crumb">
              <span class="cx-proj"></span>
              <span style="color:var(--cx-text-faint)">/</span>
              <span class="cx-model"></span>
            </div>
            <div class="cx-spacer"></div>
            <div class="cx-icon-btn" data-settings-open title="设置（Ctrl+,）">${ICONS.gear}</div>
            <div class="cx-icon-btn cx-panel-toggle" title="显示 / 隐藏代码面板" data-panel-toggle>${ICONS.panel}</div>
            <div class="cx-icon-btn" title="在原生界面打开" data-open-native>${ICONS.external}</div>
            <div class="cx-icon-btn" title="更多（装饰）">${ICONS.dots}</div>
          </header>
          <div class="codex-thread cx-view-list">
            <div class="codex-thread-inner">
              <div class="cx-proj-head">
                <div class="cx-head-title">
                  <button class="cx-icon-btn cx-filter-btn" title="筛选列表">${ICONS.filter}</button>
                  <h1></h1>
                </div>
                <button class="cx-new-topic-btn">${ICONS.plus}新话题</button>
              </div>
              <div class="cx-filter-row">
                <span class="cx-fchip" data-filter-path="/latest">最新</span>
                <span class="cx-fchip" data-filter-path="/new">新</span>
                <span class="cx-fchip" data-filter-path="/unread">未读</span>
                <span class="cx-fchip" data-filter-path="/hot">热门</span>
                <span class="cx-fchip" data-filter-path="/top">排行榜</span>
              </div>
              <div class="cx-new-toggle"></div>
              <div class="cx-proj-desc"></div>
              <div class="cx-thread-rows"></div>
            </div>
          </div>
          <div class="codex-thread cx-view-detail" style="display:none">
            <div class="codex-thread-inner cx-thread-posts"></div>
          </div>
          <div class="codex-composer-wrap">
            <div class="codex-composer">
              <div class="cx-composer-mini">
                <span class="cx-composer-mini-hint" data-composer-hint title="点这里展开输入框">写点什么…</span>
                <button type="button" class="cx-tool-btn" data-composer-toggle="expand" title="展开输入框">${ICONS.chevronUp}</button>
              </div>
              <div class="cx-compose-target"><span></span><button type="button" title="取消回复">×</button></div>
              <div class="cx-compose-preview" aria-live="polite"></div>
              <div class="cx-md-edit" data-cx-compose="1" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="发送消息…"></div>
              <div class="cx-composer-toolbar">${cxComposerToolbarHtml()}</div>
              <input type="file" class="cx-composer-file" accept="image/*" multiple hidden>
            </div>
          </div>
        </div>
        <div class="cx-resizer" data-resize="panel" title="拖拽调整分栏宽度"></div>
        <!-- 右侧代码面板：列表 / 详情共享同一实例（纯氛围装饰） -->
        <aside class="cx-code-panel">
          <div class="cx-code-tabs">
            <div class="cx-code-tab"><span class="cx-rs-ic">RS</span><span data-code-file-name>lib.rs</span><span class="cx-close" title="关闭代码面板">×</span></div>
            <span class="cx-code-add" title="新建标签（装饰）">＋</span>
            <div class="cx-code-tabs-actions">
              <span class="cx-icon-btn" title="放大（装饰）">${ICONS.expand}</span>
              <span class="cx-icon-btn" title="分栏（装饰）">${ICONS.panel}</span>
              <span class="cx-icon-btn" data-panel-toggle2 title="关闭面板">${ICONS.sidebar}</span>
            </div>
          </div>
          <div class="cx-code-crumb">
            <div class="cx-crumbs"><span class="cx-seg" data-code-crumb-root>linux-do</span> › <span class="cx-seg" data-code-crumb-cat>topics</span> › <span class="cx-seg" data-code-crumb-dir>engine</span> › <span class="cx-cur" data-code-crumb-file>lib.rs</span></div>
            <span class="cx-spacer"></span>
            <div class="cx-code-view-toggle" data-code-view-toggle><span class="cx-on" data-v="code">代码</span><span data-v="diff">diff</span></div>
            <button class="cx-open-btn" title="切换语言（装饰）" data-open-menu-btn><span data-open-lang-label>Java</span><svg class="cx-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 9 12 14 17 9"/></svg></button>
          </div>
          <div class="cx-code-body" data-code-body></div>
        </aside>
      </div>`;
    document.body.appendChild(main);
    bindMainEvents(main);

    // 滚动加载（两个视图各自的滚动容器；代码面板为共享兄弟节点）
    main.querySelector(".cx-view-list").addEventListener("scroll", (e) => {
      const el = e.target;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadMoreList();
    });
    main.querySelector(".cx-view-detail").addEventListener("scroll", (e) => {
      const el = e.target;
      if (el.scrollTop < 80) loadOlderPosts();
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadNewerPosts();
    });

    syncCodePanelVisibility();
    renderCodePanel();
    bindResizers();
    return main;
  }

  function bindMainEvents(main) {
    if (main.dataset.eventsBound === "1") return;
    main.dataset.eventsBound = "1";

    main.addEventListener("click", (e) => {
      // 窄屏抽屉开关
      if (e.target.closest(".cx-menu-btn")) {
        document.documentElement.classList.toggle("codex-rail-open");
        return;
      }
      // 顶栏文件夹图标 / 面包屑项目名 → 返回列表
      if (e.target.closest(".cx-back-btn")) {
        backToList();
        return;
      }
      if (e.target.closest("[data-open-native]")) {
        window.open(location.href, "_blank", "noopener");
        return;
      }
      // 代码面板显隐：顶栏分屏按钮 / tab 行右侧按钮 / tab 上的 ×
      if (e.target.closest("[data-panel-toggle]") || e.target.closest("[data-panel-toggle2]") || e.target.closest(".cx-code-tab .cx-close")) {
        setCodePanelHidden(!isCodePanelHidden(), true);
        return;
      }
      // 「打开 ∨」→ 语言下拉；菜单项 → 切语言重渲染
      if (e.target.closest("[data-open-menu-btn]")) {
        toggleCodeLangMenu(main);
        return;
      }
      const langItem = e.target.closest("[data-code-lang-item]");
      if (langItem && main.contains(langItem)) {
        setCodeLang(langItem.dataset.codeLangItem);
        closeCodeLangMenu();
        renderCodePanel();
        return;
      }
      // 代码 / diff 切换
      const vt = e.target.closest("[data-code-view-toggle] span");
      if (vt && main.contains(vt)) {
        main.querySelectorAll("[data-code-view-toggle] span").forEach((x) =>
          x.classList.toggle("cx-on", x === vt)
        );
        setCodeMode(vt.dataset.v || "code");
        renderCodePanel();
        return;
      }
      // 「新话题」胶囊
      if (e.target.closest(".cx-new-topic-btn")) {
        openNewTopicComposer();
        return;
      }
      // 列表头筛选：展开 / 收起 + chip 切路由
      if (e.target.closest(".cx-filter-btn")) {
        main.classList.toggle("cx-filters-open");
        return;
      }
      const fchip = e.target.closest(".cx-fchip");
      if (fchip && main.contains(fchip)) {
        navigateInApp(fchip.dataset.filterPath);
        return;
      }
      // 引用卡片「跳转源楼」
      const jumpSrc = e.target.closest(".cx-jump-src");
      if (jumpSrc && main.contains(jumpSrc)) {
        const num = jumpSrc.closest(".cx-tool-card")?.dataset.jumpPost;
        if (num) jumpToSource(Number(num));
        return;
      }
      // 引用卡片折叠
      const toolHead = e.target.closest(".cx-tool-card-head");
      if (toolHead && main.contains(toolHead)) {
        toolHead.parentElement.classList.toggle("cx-open");
        return;
      }
      // 代码块复制
      const copyBtn = e.target.closest(".cx-copy");
      if (copyBtn && main.contains(copyBtn)) {
        const pre = copyBtn.closest(".cx-codeblock")?.querySelector("pre");
        if (pre) copyText(pre.innerText || pre.textContent || "");
        return;
      }
      // 楼层操作行
      const act = e.target.closest(".cx-act");
      if (act && main.contains(act)) {
        const action = act.dataset.action;
        if (action === "like") {
          toggleLike(Number(act.dataset.postId), act);
        } else if (action === "reply") {
          replyToPost(Number(act.dataset.postNumber) || undefined);
        } else if (action === "bookmark") {
          toggleBookmark(Number(act.dataset.postId), act);
        } else if (action === "link") {
          copyPostLink(Number(act.dataset.postNumber));
        }
        return;
      }
      // 话题行 → 详情
      const row = e.target.closest(".cx-trow");
      if (row && main.contains(row)) {
        const href = row.getAttribute("data-href");
        if (href) navigateInApp(href);
        return;
      }
      // 面包屑项目名 → 该分类列表
      if (e.target.closest(".cx-crumb .cx-proj")) {
        backToList();
        return;
      }
      // 正文内站内链接软跳转
      const a = e.target.closest(".cx-view-detail a[href], .cx-view-list a[href]");
      if (a && main.contains(a)) {
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        const href = a.getAttribute("href");
        if (!href || href === "#" || href.startsWith("javascript:")) return;
        if (/^https?:/i.test(href)) {
          try {
            if (new URL(href).origin !== location.origin) return; // 外链默认行为
          } catch { return; }
        }
        e.preventDefault();
        e.stopPropagation();
        navigateInApp(href);
      }
    });

    // 嵌入 im 式 markdown 输入框：输入 / 工具栏 / 图片上传 / 发送全部在本皮内完成
    const composerCard = main.querySelector(".codex-composer");
    if (composerCard) cxWireComposer(composerCard);
  }

  function backToList() {
    const catId = threadState.categoryId;
    const cat = catId ? categoryById(catId) : null;
    navigateInApp(cat ? `/c/${cat.slug}/${cat.id}` : (listState.path || "/latest"));
  }

  function copyText(text) {
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      } catch { /* ignore */ }
    }
  }

  let toastTimer = null;
  /** 轻量底部提示（供楼层操作等失败回滚/成功反馈） */
  function cxToast(message, state) {
    let el = document.querySelector(".cx-toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "cx-toast";
      document.body.appendChild(el);
    }
    el.textContent = message || "";
    el.classList.toggle("cx-err", state === "error");
    el.classList.add("cx-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("cx-show"), 2600);
  }

  function copyPostLink(postNumber) {
    if (!threadState.topicId) return;
    const slug = threadState.slug || "topic";
    copyText(`${location.origin}/t/${slug}/${threadState.topicId}/${postNumber || ""}`);
  }

  function showView(view) {
    const main = ownMain();
    if (!main) return;
    const list = main.querySelector(".cx-view-list");
    const detail = main.querySelector(".cx-view-detail");
    if (list) list.style.display = view === "list" ? "" : "none";
    if (detail) detail.style.display = view === "detail" ? "" : "none";
  }

  /** 顶栏面包屑 + 大标题 + composer placeholder 随路由同步 */
  /* —— /new「新」下的「所有 / 话题 / 回复」筛选条（吸附原生 toggle，参照 im new-toggle.js）——
     原生 wrapper 被本皮肤隐藏但仍留在 DOM：计数文本可读、点击可转发，
     原生自行切换列表过滤；本地仅记忆选中态并跟手高亮，顺手 force 重拉当前列表。 */
  const CX_NEW_TOGGLE_WRAPPER = ".topic-replies-toggle-wrapper";
  const CX_NEW_TITLES = { all: "所有新话题和过去几天回复的话题", topics: "新话题", replies: "新回复" };
  let cxNewToggleMod = null; // null = 尚未选择：首次访问读原生当前态作为初始值

  function cxNativeNewBtn(mod) {
    try { return document.querySelector(`${CX_NEW_TOGGLE_WRAPPER} .topics-replies-toggle.${mod}`); }
    catch { return null; }
  }

  function cxNewCount(el) {
    if (!el) return 0;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    const m = text.match(/[（(]\s*(\d+)\s*[）)]/);
    if (m) return Number(m[1]);
    const n = parseInt(text.replace(/[^\d]/g, ""), 10);
    return Number.isNaN(n) ? 0 : n;
  }

  function cxNewButtonHtml(mod, label, count, active) {
    return `<button type="button" class="cx-new-toggle-btn --${mod}${active ? " active" : ""}" data-mod="${mod}" title="${CX_NEW_TITLES[mod] || ""}">${label}${count ? ` <span class="n">${count}</span>` : ""}</button>`;
  }

  function syncCxNewToggle() {
    const main = ownMain();
    if (!main) return;
    let row = main.querySelector(".cx-new-toggle");
    const show = location.pathname.replace(/\/+$/, "") === "/new";
    if (!show) {
      if (row) row.classList.remove("cx-show");
      return;
    }
    if (!row) { /* 理论上 ensureMain 已建好，兜底重建 */
      row = document.createElement("div");
      row.className = "cx-new-toggle";
      main.querySelector(".cx-filter-row")?.after(row);
    }
    if (!row.dataset.bound) {
      row.dataset.bound = "1";
      row.addEventListener("click", (e) => {
        const btn = e.target.closest(".cx-new-toggle-btn");
        if (!btn || !row.contains(btn)) return;
        const mod = btn.dataset.mod;
        cxNewToggleMod = mod; // 本地点选为选中项，立即高亮
        // 转发原生按钮：原生的过滤交互由其自身事件委托处理
        try { cxNativeNewBtn(mod)?.click?.(); } catch { /* ignore */ }
        // 顺手 force 重拉当前列表，尽量跟随
        if (listState.apiPath) loadList(listState.apiPath, true);
      });
    }
    // 选中态：优先本地记忆；首次访问（无记忆）才读原生当前态
    if (!cxNewToggleMod) {
      let nat = "all";
      const wrapper = document.querySelector(CX_NEW_TOGGLE_WRAPPER);
      if (wrapper) {
        for (const m of ["topics", "replies", "all"]) {
          if (wrapper.querySelector(`.topics-replies-toggle.${m}`)?.classList?.contains("active")) { nat = m; break; }
        }
      }
      cxNewToggleMod = nat;
    }
    const active = cxNewToggleMod;
    const html =
      cxNewButtonHtml("all", "所有", cxNewCount(cxNativeNewBtn("all")), active === "all") +
      cxNewButtonHtml("topics", "话题", cxNewCount(cxNativeNewBtn("topics")), active === "topics") +
      cxNewButtonHtml("replies", "回复", cxNewCount(cxNativeNewBtn("replies")), active === "replies");
    if (row.dataset.sig !== html) {
      row.dataset.sig = html;
      row.innerHTML = html;
    }
    row.classList.add("cx-show");
  }

  function syncChrome() {
    const main = ownMain();
    if (!main) return;
    const pathname = location.pathname;
    const proj = main.querySelector(".cx-crumb .cx-proj");
    const model = main.querySelector(".cx-crumb .cx-model");
    const h1 = main.querySelector(".cx-proj-head h1");
    const desc = main.querySelector(".cx-proj-desc");
    const mdEdit = main.querySelector(".codex-composer .cx-md-edit");

    if (isTopicPath(pathname)) {
      const title = threadState.title || "加载中…";
      const cat = threadState.categoryId ? categoryById(threadState.categoryId) : null;
      if (proj) proj.textContent = cat ? cat.name : "话题";
      if (model) {
        model.textContent = `${title} · ${threadState.postsCount || "–"} 楼`;
        // 顶栏那一行是 ellipsis 截断的：把完整标题挂成悬停提示，长标题才看得全
        model.title = threadState.title || "";
      }
      if (mdEdit) mdEdit.dataset.placeholder = `回复「${title}」…`;
    } else {
      const title = listTitleForPath(pathname);
      if (proj) proj.textContent = title;
      if (model) model.textContent = `全部线程 · ${listState.topics.length || "–"}`;
      if (h1 && h1.textContent !== title) h1.textContent = title;
      if (h1) h1.title = title;
      if (desc) {
        const catId = categoryIdFromPath(pathname);
        const cat = catId ? categoryById(catId) : null;
        desc.textContent = cat
          ? `${(cat.description_text || "").slice(0, 60)} · 共 ${cat.topic_count ?? "–"} 个话题`
          : `共 ${listState.topics.length} 个已加载话题`;
      }
      if (mdEdit) mdEdit.dataset.placeholder = `在 ${title} 发新话题…`;
    }
    // 筛选 chips 高亮跟随当前列表路由
    const onPath = location.pathname;
    main.querySelectorAll(".cx-fchip").forEach((chip) => {
      const p = chip.dataset.filterPath || "";
      const on = p === "/latest"
        ? onPath === "/" || onPath.startsWith("/latest")
        : !isTopicPath(onPath) && onPath.startsWith(p);
      chip.classList.toggle("cx-on", on);
    });
    // /new 路由下激活「所有/话题/回复」筛选条（吸附原生 toggle）
    syncCxNewToggle();
    // 伪装模式下的品牌名 / 标签页标题跟着路由刷新（站点自己的 Ember 也会写 title，
    // 每次渲染后盖一次最省事）
    syncBrandName();
    syncTitle();
    // 细栏上的提示文案跟着路由走（回复谁 / 在哪个版块发帖）
    syncComposerCollapsed();
    // 代码面板跟随路由换种子（列表 = 路由哈希，详情 = 话题 id；内部有签名去重）
    renderCodePanel();
  }

  /* ============================== 列表视图（话题 = Codex 项目线程） ============================== */

  const listState = {
    path: "",
    apiPath: "",
    moreUrl: null,
    loading: false,
    failedAt: 0,
    /** 兜底数据源生效时的一句话说明（显示在列表底部状态行），正常取数时为空 */
    notice: "",
    topics: []
  };

  function trowHtml(topic) {
    const unread = topicUnread(topic);
    const replies = Math.max(0, (topic.posts_count || 1) - 1);
    const cat = topic.category_id ? categoryById(topic.category_id) : null;
    const title = topic.title || "";
    // 副行只显示 60 字摘要（CSS 还会再 ellipsis 一刀），完整摘要留给悬停提示；
    // 没有摘要时副行退回「分类 · 最后回复人」，这种情况没有可提示的长文本
    const fullExcerpt = topic.excerpt
      ? String(topic.excerpt).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
      : "";
    const sub = fullExcerpt
      ? fullExcerpt.slice(0, 60)
      : [cat && cat.name, topic.last_poster_username && `@${topic.last_poster_username}`]
          .filter(Boolean).join(" · ");
    const status = topic.pinned
      ? `<span class="cx-trow-pin">${ICONS.pin}</span>`
      : `<span class="cx-trow-dot${unread ? " cx-unread" : ""}"></span>`;
    // title 属性 = 原生列表那个悬停显示全文的行为：标题被 CSS 截断后，鼠标停上去能看全
    return `
      <div class="cx-trow${unread ? "" : " cx-read"}" data-href="${escapeHtml(topicHref(topic))}" data-topic-id="${topic.id}" title="${escapeHtml(title)}">
        ${status}
        <div class="cx-trow-texts">
          <div class="cx-trow-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          ${sub ? `<div class="cx-trow-sub" title="${escapeHtml(fullExcerpt || sub)}">${escapeHtml(sub)}</div>` : ""}
        </div>
        <div class="cx-trow-meta">
          <span>${replies} 回复</span>
          <span>${topic.pinned ? "置顶" : escapeHtml(formatTime(topic.last_activity_at))}</span>
        </div>
      </div>`;
  }

  /**
   * 列表里行与行之间的 agent 痕迹（设置面板 → 装饰）。
   *
   * 列表页是最容易被一眼看穿的地方，所以在两条话题之间按种子插
   * 「思考块 / 工具调用行」，让整页读起来像一份 agent 会话日志而不是论坛帖子流。
   * 密度刻意压低（默认 46%，且每两行之间最多一条）：太密会盖住标题，反而更奇怪。
   *
   * 返回 { html, run } —— run 是本条用掉的工具调用样式下标，跨行传下去就是为了
   * 避免连着出现两个「Running command」，那一眼就看出是生成的。
   */
  function listTraceHtml(t, idx, avoidRun) {
    const sep = { html: `<div class="cx-trow-sep"></div>`, run: avoidRun };
    if (!cfg("decorations")) return sep;
    const rate = Math.max(0, Math.min(100, Number(cfg("listTraceRate")) || 0));
    if (rate <= 0) return sep;

    // 种子 = 行序号 + 话题 id：同一页刷新后痕迹位置和内容都稳定
    const rnd = mulberry32((((idx + 1) * 2654435761) ^ Number(t.id || 0)) >>> 0);
    const roll = rnd() * 100;
    if (roll >= rate) return sep;
    // 半数位置放思考块，半数放工具调用行
    if (roll < rate / 2) {
      return { html: thinkingHtml(rnd, !!cfg("listThinkingOpen")), run: avoidRun };
    }
    let i = Math.floor(rnd() * RUN_LINES.length);
    if (avoidRun != null && avoidRun >= 0 && i === avoidRun) i = (i + 1) % RUN_LINES.length;
    return { html: runlineHtmlFor(i, rnd), run: i };
  }

  function renderListRows() {
    const box = document.querySelector(".cx-thread-rows");
    if (!box) return;
    const rows = [];
    let lastRun = -1; // 跨行跟踪，避免连着两条一样的工具调用
    listState.topics.forEach((t, i) => {
      if (i > 0) {
        const trace = listTraceHtml(t, i, lastRun);
        lastRun = trace.run;
        rows.push(trace.html);
      }
      rows.push(trowHtml(t));
    });
    rows.push(
      `<div class="cx-list-status">${
        listState.notice ? escapeHtml(listState.notice) :
        listState.loading ? "加载中…" :
        listState.moreUrl ? "滚动加载更多…" :
        (listState.topics.length ? "没有更多了" : "暂无话题")
      }</div>`
    );
    box.innerHTML = rows.join("");
    // 列表思考块的折叠交互（楼内那份是 buildThinking 里逐节点挂的；
    // 这里的节点是拼字符串来的，所以渲染完统一挂一次）
    box.querySelectorAll(".cx-think-head").forEach((head) => {
      head.addEventListener("click", () => head.parentElement.classList.toggle("open"));
    });
    syncChrome();
    renderRailDynamic();
  }

  function applyListJson(data, append) {
    const topics = (data.topic_list && data.topic_list.topics) || [];
    const existing = new Set(append ? listState.topics.map((t) => t.id) : []);
    const fresh = topics.filter((t) => !existing.has(t.id));
    listState.topics = append ? listState.topics.concat(fresh) : topics;
    const more = data.topic_list && data.topic_list.more_topics_url;
    listState.moreUrl = more ? more.replace(/\.json\b/, ".json") : null;
    renderListRows();
  }

  /**
   * 把「接口被拦」变成「换个数据源继续用」。
   *
   * 顺序：页面内预加载 JSON（零请求）→ 已渲染的原生列表 DOM。
   * 成功就返回 true，并把来源写进 listState.notice 让底部状态行说明情况。
   */
  function recoverListData(err) {
    const why = err && err.cfChallenge ? "被 Cloudflare 拦截" : `HTTP ${(err && err.status) || "?"}`;
    // 静默期里说实话：不是请求失败，是我们主动停发（避免自己给自己加码）
    const paused = err && err.paused ? "（已暂停接口请求 30 秒）" : "";
    const preloaded = preloadedTopicList();
    if (preloaded) {
      listState.notice = `列表接口${why}${paused}，已改用页面内预加载数据`;
      applyListJson(preloaded, false);
      return true;
    }
    const scraped = scrapeNativeTopicList();
    if (scraped.length) {
      listState.notice = `列表接口${why}${paused}，已改用原生列表里已渲染的数据`;
      listState.moreUrl = null;
      listState.topics = scraped;
      renderListRows();
      return true;
    }
    return false;
  }

  async function loadList(apiPath, force) {
    if (!apiPath) return;
    // 用列表 API 做缓存键：进帖子时 pathname 会变，但不应重拉列表；
    // 缓存命中只同步面包屑 / rail，不重绘行（避免抽屉开关等场景重置滚动）
    if (!force && listState.apiPath === apiPath && listState.topics.length) {
      syncChrome();
      renderRailDynamic();
      return;
    }
    if (listState.loading) return;
    // 换路由 = 用户主动导航，该重新试一次：失败冷却只用来抑制同一路由上的
    // 「Ember DOM 抖动 → 重试风暴」，不该让 /top 一直显示 /new 的旧内容
    if (listState.apiPath !== apiPath) listState.failedAt = 0;
    // 失败冷却：30 秒内不重复请求（否则 Ember 的 DOM 抖动会触发 applyTheme → 重试风暴，
    // 而 linux.do 的 403 多半就是被自己这一串请求喂出来的）
    if (listState.failedAt && Date.now() - listState.failedAt < 30000) return;
    listState.loading = true;
    listState.apiPath = apiPath;
    listState.path = location.pathname;
    listState.notice = "";
    renderListRows();
    try {
      const data = await apiWithRetry(apiPath);
      if (listState.apiPath !== apiPath) return; // 路由已切走
      listState.failedAt = 0;
      applyListJson(data, false);
    } catch (err) {
      if (listState.apiPath !== apiPath) return; // 路由已切走，别再动列表
      listState.failedAt = Date.now();
      // 先试兜底数据源；实在没有才显示错误
      if (recoverListData(err)) return;
      const status = err && err.status;
      const box = document.querySelector(".cx-thread-rows");
      if (box) box.innerHTML = `<div class="cx-list-status">列表加载失败${
        err && err.cfChallenge
          ? "（被 Cloudflare 拦截：刷新页面过一下验证，或先登录再试）"
          : status === 403
            ? "（HTTP 403：可能被 Cloudflare 拦截或未登录，刷新页面或登录后重试）"
            : status ? `（HTTP ${status}）` : "（网络错误）"
      }，点击重试</div>`;
      // 点错误行手动重试
      box?.querySelector(".cx-list-status")?.addEventListener("click", () => {
        listState.failedAt = 0;
        loadList(apiPath, true);
      }, { once: true });
    } finally {
      listState.loading = false;
    }
  }

  async function loadMoreList() {
    if (!listState.moreUrl || listState.loading) return;
    listState.loading = true;
    try {
      const data = await apiWithRetry(listState.moreUrl);
      applyListJson(data, true);
    } catch (err) {
      // 加载更多被拦：不动已有内容，只在状态行说明（翻页没有「页面内兜底」可用）
      listState.moreUrl = null;
      listState.notice = `加载更多失败（${err && err.cfChallenge ? "被 Cloudflare 拦截" : `HTTP ${(err && err.status) || "?"}`}）`;
      renderListRows();
    } finally {
      listState.loading = false;
    }
  }

  /* ============================== cooked 装饰：Codex markdown 样式 ============================== */

  /**
   * 把原生 cooked DOM 装饰成 Codex 风格：
   * 行内 code → 芯片；pre → 带头栏的代码块；引用 → 可折叠工具卡片；图片 lazy
   */
  function decorateCooked(root) {
    if (!root) return;

    // 行内 code → 芯片
    root.querySelectorAll("code").forEach((code) => {
      if (code.closest("pre")) return;
      code.classList.add("cx-inline-code");
    });

    // 代码块 → 带头栏 + 复制按钮
    root.querySelectorAll("pre").forEach((pre) => {
      if (pre.closest(".cx-codeblock")) return;
      const code = pre.querySelector("code");
      const lang = (code && (code.className || "").match(/lang(?:uage)?-([\w#+-]+)/i) || [])[1] || "text";
      const wrap = document.createElement("div");
      wrap.className = "cx-codeblock";
      pre.replaceWith(wrap);
      const head = document.createElement("div");
      head.className = "cx-codeblock-head";
      head.innerHTML = `<span>${escapeHtml(lang)}</span><span class="cx-copy">${ICONS.copy}复制</span>`;
      wrap.appendChild(head);
      wrap.appendChild(pre);
    });

    // 引用 → 可折叠引用卡片（设置面板 → 装饰 → 引用卡片）。关掉就保持 Discourse 原样。
    if (cfg("quoteCard")) {
      // Discourse 引用 aside.quote → 可折叠工具调用卡片
      root.querySelectorAll("aside.quote").forEach((quote) => {
        if (quote.closest(".cx-tool-card")) return;
        const postNo = quote.getAttribute("data-post");
        const titleEl = quote.querySelector(":scope > .title");
        const username = (titleEl?.textContent || "").replace(/[:：]\s*$/, "").trim();
        const label = postNo
          ? `引用 ${postNo} 楼${username ? ` · ${username}` : ""}`
          : (username ? `引用 · ${username}` : "引用");
        const body = quote.querySelector(":scope > blockquote");
        const card = document.createElement("div");
        card.className = "cx-tool-card";
        if (postNo) card.dataset.jumpPost = postNo; // 引用跳源楼
        if (cfg("quoteOpen")) card.classList.add("cx-open");
        const head = document.createElement("div");
        head.className = "cx-tool-card-head";
        head.innerHTML =
          `${ICONS.quote}<span>${escapeHtml(label)}</span>` +
          (postNo ? `<span class="cx-jump-src" title="跳转源楼">${ICONS.external}</span>` : "") +
          `${ICONS.chevronRightSm}`;
        const bodyEl = document.createElement("div");
        bodyEl.className = "cx-tool-card-body";
        if (body) {
          while (body.firstChild) bodyEl.appendChild(body.firstChild);
        }
        card.appendChild(head);
        card.appendChild(bodyEl);
        quote.replaceWith(card);
      });

      // 普通 blockquote → 简约卡片（无楼层信息）
      root.querySelectorAll("blockquote").forEach((bq) => {
        if (bq.closest(".cx-tool-card") || bq.closest("aside.quote")) return;
        const card = document.createElement("div");
        card.className = "cx-tool-card";
        if (cfg("quoteOpen")) card.classList.add("cx-open");
        const head = document.createElement("div");
        head.className = "cx-tool-card-head";
        head.innerHTML = `${ICONS.quote}<span>引用</span>${ICONS.chevronRightSm}`;
        const bodyEl = document.createElement("div");
        bodyEl.className = "cx-tool-card-body";
        while (bq.firstChild) bodyEl.appendChild(bq.firstChild);
        card.appendChild(head);
        card.appendChild(bodyEl);
        bq.replaceWith(card);
      });
    }

    // 外链新标签打开；图片 lazy
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (/^https?:/i.test(href)) {
        try {
          if (new URL(href).origin !== location.origin) {
            a.target = "_blank";
            a.rel = "noopener";
          }
        } catch { /* ignore */ }
      }
    });
    root.querySelectorAll("img").forEach((img) => {
      if (!img.getAttribute("loading")) img.setAttribute("loading", "lazy");
      // 非 emoji 图片：点击开灯箱完整查看原图（原为 hover 缩略放大 / 点开新标签）
      if (img.classList.contains("emoji")) return;
      const href =
        img.closest("a[href]")?.getAttribute("href") ||
        img.getAttribute("src") ||
        "";
      if (!href || !/^\/(uploads|user_avatar|letter_avatar)/.test(href) && !/^https?:/.test(href)) {
        return;
      }
      img.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        openLightbox(href);
      });
    });
    // 太小的图（表情 / 图标 / 分割线）标成 no-preview：悬浮预览跳过它们
    markSmallImages(root);

    // 投票组件化（这条帖若含 .poll 则渲染为 Codex 风格投票卡）
    activatePolls(root);
  }

  /* ============================== 引用跳源楼 + 返回（移植自 im features/quote-jump.js） ============================== */

  const quoteJumpStack = []; // { topicId, scrollTop }

  function hideJumpBackBtn() {
    const btn = document.querySelector(".cx-jump-back");
    if (btn) btn.classList.remove("cx-show");
  }

  function clearQuoteJumpHistory() {
    quoteJumpStack.length = 0;
    hideJumpBackBtn();
  }

  function showJumpBackBtn() {
    let btn = document.querySelector(".cx-jump-back");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cx-jump-back";
      btn.innerHTML =
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/></svg>` +
        `<span>返回原处</span>` +
        `<span class="cx-jump-back-x" title="清除">×</span>`;
      btn.addEventListener("click", (e) => {
        if (e.target.closest(".cx-jump-back-x")) { clearQuoteJumpHistory(); return; }
        popQuoteJump();
      });
      document.body.appendChild(btn);
    }
    btn.classList.add("cx-show");
  }

  function popQuoteJump() {
    const item = quoteJumpStack.pop();
    if (!item) return;
    const scroller = document.querySelector(".cx-view-detail");
    if (item.topicId === threadState.topicId && scroller && typeof item.scrollTop === "number") {
      scroller.scrollTo({ top: item.scrollTop, behavior: "smooth" });
    }
    if (!quoteJumpStack.length) hideJumpBackBtn();
  }

  /** 点击引用卡片「跳转源楼」：记录当前位置，平滑滚到被引用楼层并高亮 */
  /** 引用卡片「跳转源楼」：本地命中直接滚；未加载则远端拉取包含该楼的窗口再滚，并高亮 */
  async function jumpToSource(postNumber) {
    const scroller = document.querySelector(".cx-view-detail");
    if (!scroller) return;
    const n = Math.floor(Number(postNumber));
    if (!n || n < 1) {
      cxToast("无法跳转：楼层号无效", "error");
      return;
    }
    if (scrollToTurnNum(scroller, n)) return;

    // 目标楼尚未加载：先从远端取一个包含它的窗口
    if (!threadState.topicId) {
      cxToast(`#${n} 楼尚未加载`, "error");
      return;
    }
    if (threadState.loading) {
      cxToast("楼层正在加载，请稍候", "info");
      return;
    }
    const topicId = threadState.topicId;
    threadState.loading = true;
    try {
      const data = await apiWithRetry(`/t/${topicId}/${n}.json`);
      if (threadState.topicId !== topicId) return; // 路由已切走
      const posts = (data.post_stream && data.post_stream.posts) || [];
      if (!posts.length) {
        cxToast(`#${n} 楼未找到`, "error");
        return;
      }
      threadState.stream = (data.post_stream && data.post_stream.stream) || posts.map((p) => p.id);
      threadState.postsCount = Number(data.posts_count) || threadState.postsCount || posts.length;
      for (const p of posts) {
        if (p.post_number) threadState.postsByNum[p.post_number] = p;
      }

      const box = detailContainer();
      if (!box) return;
      const known = new Set();
      for (const el of box.querySelectorAll(".cx-turn-user, .cx-turn-agent")) {
        const pn = Number(el.dataset.postNumber);
        if (pn) known.add(pn);
      }
      // 只补渲染窗口内缺失的楼：比已渲染最旧楼还旧 → prepend，其余 → append
      const fresh = posts.filter((p) => p.post_number && !known.has(p.post_number))
        .slice().sort((a, b) => a.post_number - b.post_number);
      if (fresh.length) {
        const holder = document.createElement("div");
        holder.innerHTML = turnsHtml(fresh);
        decorateCooked(holder);
        sprinkleActivity(holder);
        const edge = known.size ? Math.min(...known) : Infinity;
        if (fresh[0].post_number < edge) {
          const beforePrep = scroller.scrollHeight;
          box.prepend(...holder.childNodes);
          scroller.scrollTop += scroller.scrollHeight - beforePrep;
        } else {
          box.querySelector(".cx-turn-divider")?.remove();
          box.append(...holder.childNodes);
        }
      }

      // 更新已渲染区间，后续滚动续接（loadOlder/Newer）按新区间切流
      const wFirst = threadState.stream.indexOf(posts[0].id);
      const wLast = threadState.stream.indexOf(posts[posts.length - 1].id);
      if (wFirst >= 0) threadState.renderedFirstIdx = Math.min(threadState.renderedFirstIdx, wFirst);
      if (wLast >= 0) threadState.renderedLastIdx = Math.max(threadState.renderedLastIdx, wLast);
      threadState.hasOlder = threadState.renderedFirstIdx > 0;
      threadState.hasNewer = threadState.renderedLastIdx >= 0 &&
        threadState.renderedLastIdx < threadState.stream.length - 1;
      syncThreadDivider();

      // 目标楼不在窗口内（被删 / 尾楼）时落向窗口最近一楼
      const landed = posts.some((p) => p.post_number === n)
        ? n
        : (posts[posts.length - 1].post_number || n);
      scrollToTurnNum(scroller, landed);
    } catch {
      cxToast(`#${n} 楼加载失败`, "error");
    } finally {
      threadState.loading = false;
    }
  }

  /** 滚到指定楼层并高亮；未找到返回 false */
  function scrollToTurnNum(scroller, postNumber) {
    const target = scroller.querySelector(
      `.cx-turn-user[data-post-number="${postNumber}"], .cx-turn-agent[data-post-number="${postNumber}"]`
    );
    if (!target) return false;
    quoteJumpStack.push({ topicId: threadState.topicId, scrollTop: scroller.scrollTop });
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove("cx-jump-highlight");
    void target.offsetWidth;
    target.classList.add("cx-jump-highlight");
    showJumpBackBtn();
    return true;
  }

  /* ============================== 投票组件（移植自 im features/polls.js，改 Codex token） ============================== */

  async function apiVotePoll(postId, pollName, optionIds) {
    if (!postId || !optionIds.length) return null;
    const body = new URLSearchParams();
    body.append("post_id", String(postId));
    body.append("poll_name", String(pollName || "poll"));
    for (const opt of optionIds) body.append("options[]", String(opt));
    const resp = await fetch("/polls/vote", {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "X-CSRF-Token": csrfToken(),
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async function apiUndoVotePoll(postId, pollName) {
    if (!postId) return null;
    const body = new URLSearchParams();
    body.append("post_id", String(postId));
    body.append("poll_name", String(pollName || "poll"));
    const resp = await fetch("/polls/vote", {
      method: "DELETE",
      credentials: "same-origin",
      headers: {
        "X-CSRF-Token": csrfToken(),
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  function getVotedOptionIds(postId, pollName, postData) {
    if (postData && postData.polls_votes && postData.polls_votes[pollName]) {
      const v = postData.polls_votes[pollName];
      return (Array.isArray(v) ? v : [v]).map(String);
    }
    try {
      const cache = localStorage.getItem(`codex_poll_${postId}_${pollName}`);
      if (cache) return JSON.parse(cache).map(String);
    } catch { /* ignore */ }
    return [];
  }

  function saveVotedOptionIds(postId, pollName, optionIds) {
    try { localStorage.setItem(`codex_poll_${postId}_${pollName}`, JSON.stringify(optionIds)); } catch { /* ignore */ }
  }

  function clearVotedOptionIds(postId, pollName) {
    try { localStorage.removeItem(`codex_poll_${postId}_${pollName}`); } catch { /* ignore */ }
  }

  function applyPollResult(poll, pollData) {
    if (!poll || !pollData) return;
    const options = pollData.options || [];
    const totalVotes = options.reduce((sum, o) => sum + (Number(o.votes) || 0), 0);
    const infoNumber = poll.querySelector(".poll-info .info-number");
    if (infoNumber) infoNumber.textContent = String(pollData.voters != null ? pollData.voters : totalVotes);
    for (const opt of options) {
      const optEl = poll.querySelector(`.cx-poll-option[data-poll-option-id="${opt.id}"]`);
      if (!optEl) continue;
      const votes = Number(opt.votes) || 0;
      const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
      const countEl = optEl.querySelector(".cx-poll-count");
      if (countEl) { countEl.textContent = `${votes} 票 (${pct}%)`; countEl.style.display = ""; }
      const barEl = optEl.querySelector(".cx-poll-bar");
      if (barEl) barEl.style.width = `${pct}%`;
    }
  }

  /** 把 Discourse 原生 .poll 组件化为 Codex 投票卡（每批渲染只初始化一次） */
  function initPoll(poll) {
    if (poll.dataset.cxPoll === "1") return;
    const items = poll.querySelectorAll("li[data-poll-option-id]");
    if (!items.length) return;

    const holder = poll.closest(".cx-turn-agent") || poll.closest(".cx-turn-user");
    const postNumber = holder ? Number(holder.dataset.postNumber) : null;
    const postData = postNumber ? threadState.postsByNum[postNumber] : null;
    const postId = (postData && postData.id) || (holder && holder.dataset.postId) || null;
    const pollName = poll.dataset.pollName || "poll";
    const isMultiple = poll.dataset.pollType === "multiple";
    const pollInfo = postData && postData.polls && postData.polls.find((p) => p.name === pollName);
    const optionsData = (pollInfo && pollInfo.options) || [];
    const totalVotes = optionsData.reduce((sum, o) => sum + (Number(o.votes) || 0), 0);
    const voters = (pollInfo && pollInfo.voters != null) ? pollInfo.voters : totalVotes;
    const votedOptionIds = getVotedOptionIds(postId, pollName, { ...postData });
    const hasVoted = votedOptionIds.length > 0;

    const infoNumber = poll.querySelector(".poll-info .info-number");
    if (infoNumber && voters > 0) infoNumber.textContent = String(voters);

    const optionsBox = document.createElement("div");
    optionsBox.className = "cx-poll-options";

    items.forEach((li) => {
      const optId = li.dataset.pollOptionId;
      const rawText = (li.textContent || "").trim().replace(/\s*\d+\s*票\s*\(\d+%\)$/, "").trim();
      const matchedOpt = optionsData.find((o) => o.id === optId);
      const votes = matchedOpt ? Number(matchedOpt.votes) || 0 : 0;
      const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
      const countText = totalVotes > 0 ? `${votes} 票 (${pct}%)` : "";
      const isSelected = votedOptionIds.includes(optId);

      const optEl = document.createElement("div");
      optEl.className = "cx-poll-option" + (isSelected ? " selected" : "");
      optEl.dataset.pollOptionId = optId;
      optEl.dataset.multi = isMultiple ? "1" : "0";
      optEl.innerHTML =
        `<span class="cx-poll-radio"></span>` +
        `<span class="cx-poll-title">${escapeHtml(rawText)}</span>` +
        `<span class="cx-poll-count" style="${countText ? "" : "display:none"}">${escapeHtml(countText)}</span>` +
        `<div class="cx-poll-bar" style="width:${pct}%"></div>`;

      optEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isMultiple) {
          optionsBox.querySelectorAll(".cx-poll-option").forEach((el) => {
            if (el !== optEl) el.classList.remove("selected");
          });
        }
        optEl.classList.toggle("selected");
        const btn = poll.querySelector(".cx-poll-submit");
        if (btn && btn.textContent === "投票") {
          btn.disabled = !optionsBox.querySelector(".cx-poll-option.selected");
        }
      });

      optionsBox.appendChild(optEl);
    });

    // 替换原生选项列表（ol / ul 都兼容）
    const listEl = poll.querySelector("ol, ul");
    if (listEl) listEl.replaceWith(optionsBox);
    else poll.appendChild(optionsBox);

    if (!poll.querySelector(".cx-poll-actions")) {
      const actions = document.createElement("div");
      actions.className = "cx-poll-actions";
      actions.innerHTML =
        `<button type="button" class="cx-poll-submit" ${hasVoted ? "" : "disabled"}>${hasVoted ? "已投票" : "投票"}</button>` +
        `<button type="button" class="cx-poll-undo" style="${hasVoted ? "" : "display:none"}">撤销投票</button>` +
        `<span class="cx-poll-tip">${hasVoted ? "✓ 您已参与投票" : ""}</span>`;
      poll.appendChild(actions);

      const submitBtn = actions.querySelector(".cx-poll-submit");
      const undoBtn = actions.querySelector(".cx-poll-undo");
      const tip = actions.querySelector(".cx-poll-tip");

      submitBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (submitBtn.textContent === "已投票") return;
        const selected = Array.from(optionsBox.querySelectorAll(".cx-poll-option.selected"))
          .map((el) => el.dataset.pollOptionId);
        if (!selected.length || !postId) return;
        submitBtn.disabled = true;
        submitBtn.textContent = "正在提交…";
        try {
          const res = await apiVotePoll(postId, pollName, selected);
          saveVotedOptionIds(postId, pollName, selected);
          submitBtn.textContent = "已投票";
          undoBtn.style.display = "";
          tip.textContent = "✓ 投票成功";
          if (res && res.poll) applyPollResult(poll, res.poll);
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = "投票";
          tip.textContent = `投票失败: ${err.message || "未知错误"}`;
        }
      });

      undoBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        undoBtn.disabled = true;
        try {
          const res = await apiUndoVotePoll(postId, pollName);
          clearVotedOptionIds(postId, pollName);
          undoBtn.disabled = false;
          undoBtn.style.display = "none";
          submitBtn.textContent = "投票";
          submitBtn.disabled = true;
          optionsBox.querySelectorAll(".cx-poll-option.selected").forEach((el) => el.classList.remove("selected"));
          tip.textContent = "已撤销投票";
          if (res && res.poll) applyPollResult(poll, res.poll);
        } catch (err) {
          undoBtn.disabled = false;
          tip.textContent = "撤销失败";
        }
      });
    }
    poll.dataset.cxPoll = "1";
  }

  /** decorateCooked 内调用：把容器里全部 .poll 组件化 */
  function activatePolls(container) {
    if (!container) return;
    container.querySelectorAll(".poll").forEach((poll) => {
      try { initPoll(poll); } catch (err) { console.warn("[linuxdo-codex] poll init failed:", err); }
    });
  }

  /* ============================== 书签（直连 API，移植自 im features/interactions.js） ============================== */

  const bookmarkIds = new Map(); // postId -> bookmarkId（取消收藏需要 id，取不到时用 remove_bookmarks 兜底）

  function setBookmarkedUi(btn, on) {
    if (!btn) return;
    btn.classList.toggle("bookmarked", on);
    btn.title = on ? "取消收藏" : "收藏";
    const icon = btn.querySelector("svg");
    if (icon) icon.outerHTML = on ? ICONS.bookmarkFill : ICONS.bookmark;
  }

  async function toggleBookmark(postId, btn) {
    if (!postId) return;
    const bookmarked = btn.classList.contains("bookmarked");
    const headers = {
      "X-CSRF-Token": csrfToken(),
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json"
    };
    try {
      if (!bookmarked) {
        const resp = await fetch("/bookmarks.json", {
          method: "POST",
          credentials: "same-origin",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: `reminder_at=&auto_delete_preference=3&bookmarkable_id=${postId}&bookmarkable_type=Post`
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          const bid = data.bookmark?.id || data.id;
          if (bid) bookmarkIds.set(postId, bid);
          setBookmarkedUi(btn, true);
        } else if (resp.status === 422) {
          // 已收藏过：服务端只回 422，按已收藏对齐 UI
          setBookmarkedUi(btn, true);
        } else {
          throw new Error(data.errors?.[0] || `HTTP ${resp.status}`);
        }
      } else {
        const bid = bookmarkIds.get(postId);
        if (bid) {
          await apiSend(`/bookmarks/${bid}.json`, "DELETE");
        } else {
          // 拿不到 bookmark id（如初始即已收藏）：用话题级移除端点，无需 id
          const topicId = threadState.topicId;
          if (!topicId) { cxToast("无法取消收藏（话题信息缺失）", "error"); return; }
          const form = new URLSearchParams();
          form.append("post_ids[]", String(postId));
          const resp = await fetch(`/t/${topicId}/remove_bookmarks.json`, {
            method: "POST",
            credentials: "same-origin",
            headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: form.toString()
          });
          if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.errors?.[0] || `HTTP ${resp.status}`);
          }
        }
        bookmarkIds.delete(postId);
        setBookmarkedUi(btn, false);
      }
    } catch (err) {
      cxToast(`书签操作失败: ${err.message || "未知错误"}`, "error");
    }
  }

  /* ============================== 阅读进度上报（移植自 im features/read-track.js） ============================== */
  // 原生按原生楼层 DOM 可见性计时；codex 自渲染流屏蔽原生滚动 → 改按 .cx-thread-posts 可见楼层累计，
  // 其余规则照搬原生 screen-track：每秒 tick；停滚 3 分钟暂停（防挂机）；页面不可见不累计；
  // 60s 周期 / 切话题 / 页面隐藏 flush。只报真实读到的楼层。

  const READ_TICK_MS = 1000;
  const READ_PAUSE_UNLESS_SCROLLED = 3 * 60 * 1000;
  const READ_MAX_TRACKING = 6 * 60 * 1000; // 每楼每次会话最多报 6 分钟
  const READ_FLUSH_INTERVAL = 60 * 1000;
  const READ_MAX_GAP = 60 * 1000;          // 休眠恢复的巨大跳变整段丢弃

  const readTimings = new Map();   // post_number -> 本批 ms
  const readTotal = new Map();     // post_number -> 本会话已上报总量
  let readActiveTopic = null;
  let readTopicTime = 0;
  let readLastTick = 0;
  let readLastScrolled = 0;
  let readSinceFlush = 0;
  let readFlushing = false;

  function visiblePostNumbers() {
    const box = detailContainer();
    const scroller = document.querySelector(".cx-view-detail");
    if (!box || !scroller || !box.children.length) return [];
    const vr = scroller.getBoundingClientRect();
    const out = [];
    box.querySelectorAll(".cx-turn-user[data-post-number], .cx-turn-agent[data-post-number]")
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < vr.top || r.top > vr.bottom) return;
        const n = Number(el.dataset.postNumber);
        if (n > 0) out.push(n);
      });
    return out;
  }

  async function flushReadTrack() {
    if (readFlushing || !readTimings.size || !readActiveTopic) return;
    // 挑战期间连这一批也先攒着不发：它是最典型的「自己给自己加码」——
    // 每隔几秒一次后台 POST。放行后下一拍会把攒下的（有上限的）时长一起结算。
    if (cfBlocked() || cfHushed()) return;
    const id = readActiveTopic;
    const batch = [];
    for (const [n, ms] of readTimings) {
      const total = readTotal.get(n) || 0;
      if (ms > 0 && total < READ_MAX_TRACKING) {
        readTotal.set(n, total + ms);
        batch.push([n, ms]);
      }
    }
    readTimings.clear();
    const time = readTopicTime;
    readTopicTime = 0;
    readSinceFlush = 0;
    if (!batch.length) return;
    readFlushing = true;
    const params = batch.map(([n, ms]) => `timings[${n}]=${Math.round(ms)}`).join("&");
    const body = `${params}&topic_time=${Math.round(time)}&topic_id=${id}`;
    try {
      await fetch("/topics/timings", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true, // pagehide 时也尽量发出
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-CSRF-Token": csrfToken(),
          "X-Requested-With": "XMLHttpRequest",
          "X-SILENCE-LOGGER": "true",
          "Discourse-Background": "true"
        },
        body
      });
    } catch { /* 丢弃本批（原生 inProgress 期间同样丢） */ } finally { readFlushing = false; }
  }

  function tickReadTrack() {
    if (otherThemeActive()) return;
    if (cfBlocked() || cfHushed()) return; // 挑战期间不计时、不上报
    const now = Date.now();
    const diff = now - readLastTick;
    readLastTick = now;
    if (diff <= 0) return;

    // 话题切换：先结算旧话题再重置（loadTopic 只改 threadState.topicId，这里被动感知）
    if (threadState.topicId !== readActiveTopic) {
      flushReadTrack();
      readActiveTopic = threadState.topicId;
      readTimings.clear();
      readTotal.clear();
      readTopicTime = 0;
      readSinceFlush = 0;
    }
    if (!readActiveTopic) return;

    if (now - readLastScrolled > READ_PAUSE_UNLESS_SCROLLED) return;
    if (document.visibilityState !== "visible") return;
    if (diff > READ_MAX_GAP) return;

    readSinceFlush += diff;
    if (readSinceFlush > READ_FLUSH_INTERVAL) flushReadTrack();

    const nums = visiblePostNumbers();
    if (!nums.length) return;
    readTopicTime += diff;
    for (const n of nums) readTimings.set(n, (readTimings.get(n) || 0) + diff);
  }

  function startReadTracking() {
    if (window.__codexReadTrackBound) return;
    window.__codexReadTrackBound = true;
    // 滚动不冒泡，capture 阶段委托；只认详情滚动容器
    document.addEventListener("scroll", (e) => {
      if (e.target instanceof Element && e.target.closest(".cx-view-detail")) {
        readLastScrolled = Date.now();
      }
    }, true);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushReadTrack();
      readLastTick = Date.now();
    });
    window.addEventListener("pagehide", () => flushReadTrack());
    readLastTick = readLastScrolled = Date.now();
    setInterval(tickReadTrack, READ_TICK_MS);
  }

/* ============================== 右侧代码面板（纯氛围，移植自 codex-mock.html） ============================== */

  const CODE_LANG_NAMES = { rust: "Rust", python: "Python", typescript: "TypeScript", go: "Go", java: "Java" };

  /** 「打开 ∨」下拉：选择代码语言 */
  function closeCodeLangMenu() {
    document.querySelector(".cx-lang-menu")?.remove();
  }

  function toggleCodeLangMenu(main) {
    const exist = document.querySelector(".cx-lang-menu");
    if (exist) { exist.remove(); return; }
    const btn = main.querySelector("[data-open-menu-btn]");
    if (!btn) return;
    const cur = getCodeLang();
    const menu = document.createElement("div");
    menu.className = "cx-lang-menu";
    menu.innerHTML = Object.keys(CODE_LANGS)
      .map((k) =>
        `<div class="cx-lang-item${k === cur ? " cx-on" : ""}" data-code-lang-item="${k}">` +
        `<span>${CODE_LANG_NAMES[k] || k}</span>` +
        (k === cur
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
          : "") +
        `</div>`
      )
      .join("");
    main.appendChild(menu);
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
    // 下一次事件循环再挂一次性关闭监听，避免吞掉本次点击
    setTimeout(() => {
      document.addEventListener("click", closeCodeLangMenu, { once: true, capture: true });
    }, 0);
  }

  /* 代码面板的语言 / 视图 / 显隐都走统一设置（见文件开头「设置」区） */

  function getCodeLang() {
    const v = cfg("lang");
    return CODE_LANGS[v] ? v : DEFAULTS.lang;
  }

  function setCodeLang(lang) {
    setCfg("lang", CODE_LANGS[lang] ? lang : DEFAULTS.lang);
  }

  function getCodeMode() {
    const v = cfg("codeMode");
    return v === "diff" || v === "code" ? v : "code";
  }

  function setCodeMode(mode) {
    setCfg("codeMode", mode === "diff" ? "diff" : "code");
  }

  /** 面板显隐：默认打开；用户手动关过则记住 */
  function isCodePanelHidden() {
    return !cfg("codePanel");
  }

  function setCodePanelHidden(hidden, persist) {
    // persist 的路径只刷视觉（顶栏按钮 / 设置面板开关都能改它），
    // 重渲染由 applyVisualSettings → setCodePanelHidden(..., false) 统一收口，不会递归
    if (persist) setCfg("codePanel", !hidden, { visualOnly: true });
    document.documentElement.classList.toggle("codex-hide-code-panel", !!hidden);
  }

  function syncCodePanelVisibility() {
    setCodePanelHidden(isCodePanelHidden(), false);
  }

  /* ============================== 三栏拖拽调宽 ============================== */
  /* 宽度不再直接读写 localStorage：railWidth / panelWidth 是统一设置里的两项，
     启动时由 applyVisualSettings() 恢复，拖拽松手由 setCfgMany 落盘。 */

  /** 绑定 [data-resize] 把手：pointer 拖拽实时写 CSS 变量，松手落到设置里 */
  function bindResizers() {
    document.querySelectorAll("[data-resize]").forEach((rz) => {
      if (rz.dataset.resizerBound === "1") return;
      rz.dataset.resizerBound = "1";
      rz.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const rootEl = document.documentElement;
        const cs = getComputedStyle(rootEl);
        const kind = rz.dataset.resize;
        const startX = e.clientX;
        const railW = parseFloat(cs.getPropertyValue("--cx-rail-w")) || RAIL_WIDTH;
        const startW = kind === "rail"
          ? railW
          : (document.querySelector(".cx-code-panel")?.getBoundingClientRect().width || 500);
        // 记下这一轮的两个宽度：拖哪个改哪个，另一个保持设置里的值
        dragState = {
          kind,
          moved: false,
          rail: Math.round(railW),
          panel: cfg("panelWidth") > 0 ? Math.round(cfg("panelWidth")) : Math.round(startW)
        };
        rz.classList.add("cx-dragging");
        document.body.classList.add("codex-resizing");

        const move = (ev) => {
          if (!dragState) return;
          dragState.moved = true;
          const dx = ev.clientX - startX;
          if (dragState.kind === "rail") {
            const w = Math.round(Math.min(Math.max(startW + dx, 240), Math.min(520, window.innerWidth * 0.34)));
            dragState.rail = w;
            rootEl.style.setProperty("--cx-rail-w", w + "px");
          } else {
            const maxP = Math.max(320, window.innerWidth - railW - 420); // 中间栏至少留 420px
            const w = Math.round(Math.min(Math.max(startW - dx, 280), maxP));
            dragState.panel = w;
            rootEl.style.setProperty("--cx-panel-w", w + "px");
          }
        };

        /**
         * 结束拖拽。persist = 把最后看到的那对宽度落盘。
         * pointerup / pointercancel / 窗口失焦都走这里：中途被打断时 dragState
         * 必须清掉，否则 applyVisualSettings 会一直跳过宽度变量（宽度再也同步不了）。
         */
        const finish = () => {
          rz.classList.remove("cx-dragging");
          document.body.classList.remove("codex-resizing");
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", finish);
          document.removeEventListener("pointercancel", finish);
          window.removeEventListener("blur", finish);
          const state = dragState;
          dragState = null;
          // 只在真的拖动过之后才落盘：单纯点一下把手不该把「自动 1:1」钉成像素值
          if (!state || !state.moved) return;
          // 两个宽度一次落盘：分开写会各跑一遍 applyVisualSettings，
          // 中间会把 --cx-panel-w 先清掉再写回来（白闪一下）
          setCfgMany(state.kind === "rail"
            ? [["railWidth", state.rail], ["panelWidth", cfg("panelWidth")]]
            // 面板没被拖过时是 0 → 保持「自动 1:1」而不是钉一个像素值
            : [["railWidth", cfg("railWidth")], ["panelWidth", state.panel]]);
        };

        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", finish);
        document.addEventListener("pointercancel", finish);
        window.addEventListener("blur", finish);
      });
    });
  }

  // 伪随机（种子 = 话题 id + 语言，同一帖子刷新后内容稳定，不同帖子排列不同）
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CODE_LANGS = {
    rust: {
      file: "lib.rs", dir: "engine", icon: "RS", comment: "//",
      kw: ["fn","let","mut","impl","pub","use","struct","enum","match","if","else","for","in","return","mod","crate","self","Self","async","await","move","where","const","trait","loop","while","Ok","Err","Some","None","Box","Vec","String","Result","Option"],
      blocks: [
        ["use std::collections::HashMap;", "use std::sync::{Arc, Mutex};", ""],
        ["pub struct TopicCache {", "    entries: HashMap<u64, CachedTopic>,", "    ttl: Duration,", "    hits: Arc<Mutex<u64>>,", "}", ""],
        ["impl TopicCache {", "    pub fn new(ttl: Duration) -> Self {", "        Self { entries: HashMap::new(), ttl, hits: Arc::new(Mutex::new(0)) }", "    }", "}", ""],
        ["    pub fn get(&self, id: u64) -> Option<CachedTopic> {", "        match self.entries.get(&id) {", "            Some(t) if !t.expired(self.ttl) => Some(t.clone()),", "            _ => None,", "        }", "    }", ""],
        ["    pub async fn refresh(&mut self, id: u64) -> Result<(), FetchError> {", "        let fresh = fetch_topic(id).await?;", "        self.entries.insert(id, fresh.into());", "        *self.hits.lock().unwrap() += 1;", "        Ok(())", "    }", ""],
        ["#[derive(Debug, Clone)]", "pub enum RenderMode {", "    List,", "    Detail { topic_id: u64 },", "    Split { topic_id: u64, panel: PanelKind },", "}", ""],
        ["    fn evict_stale(&mut self) -> usize {", "        let before = self.entries.len();", "        self.entries.retain(|_, v| !v.expired(self.ttl));", "        before - self.entries.len()", "    }", ""],
        ["// 缓存淘汰策略：先按 TTL，再按 LRU 兜底", "// 注意保持与 metrics 上报的一致性", ""],
        ["    pub fn stats(&self) -> CacheStats {", "        CacheStats {", "            size: self.entries.len(),", "            hits: *self.hits.lock().unwrap(),", "            hit_rate: self.hits.lock().unwrap().checked_div(self.entries.len() as u64).unwrap_or(0),", "        }", "    }", ""],
        ["#[cfg(test)]", "mod tests {", "    use super::*;", "", "    #[test]", "    fn stale_entry_is_evicted() {", "        let mut c = TopicCache::new(Duration::from_secs(0));", "        c.entries.insert(1, CachedTopic::default());", "        assert_eq!(c.evict_stale(), 1);", "    }", "}", ""]
      ]
    },
    python: {
      file: "pipeline.py", dir: "workers", icon: "PY", comment: "#",
      kw: ["def","class","return","if","else","elif","for","while","in","import","from","as","with","try","except","finally","raise","lambda","None","True","False","async","await","yield","pass","self","is","not","and","or"],
      blocks: [
        ["import asyncio", "import hashlib", "from dataclasses import dataclass, field", "from typing import Optional", ""],
        ["@dataclass", "class TopicSnapshot:", "    topic_id: int", "    title: str", "    posts: list = field(default_factory=list)", "    fetched_at: float = 0.0", ""],
        ["class Pipeline:", '    """话题抓取流水线：拉取 -> 清洗 -> 落库。"""', "", "    def __init__(self, workers: int = 8):", "        self.workers = workers", "        self.queue: asyncio.Queue = asyncio.Queue(maxsize=1024)", "        self.seen: set[int] = set()", ""],
        ["    async def run(self) -> None:", "        producers = [asyncio.create_task(self.produce(i)) for i in range(2)]", "        consumers = [asyncio.create_task(self.consume(i)) for i in range(self.workers)]", "        await asyncio.gather(*producers, *consumers)", ""],
        ["    async def consume(self, idx: int) -> None:", "        while True:", "            snap = await self.queue.get()", "            try:", "                await self.persist(snap)", "            except Exception as exc:", '                logger.warning("persist failed: %s", exc)', "            finally:", "                self.queue.task_done()", ""],
        ["    def fingerprint(self, snap: TopicSnapshot) -> str:", "        digest = hashlib.sha256(snap.title.encode()).hexdigest()", "        return digest[:16]", ""],
        ["    async def persist(self, snap: TopicSnapshot) -> None:", "        key = self.fingerprint(snap)", "        if key in self.seen:", "            return", "        await store.upsert(key, snap)", "        self.seen.add(key)", ""],
        ["def backoff(attempt: int, base: float = 0.5) -> float:", "    # 指数退避 + 抖动，避免雪崩", "    return base * (2 ** attempt) * (0.5 + random.random())", ""],
        ["async def main() -> None:", "    pipe = Pipeline(workers=16)", "    await pipe.run()", "", 'if __name__ == "__main__":', "    asyncio.run(main())", ""]
      ]
    },
    typescript: {
      file: "app.ts", dir: "web", icon: "TS", comment: "//",
      kw: ["const","let","var","function","return","if","else","for","of","in","while","import","from","export","default","class","extends","interface","type","enum","new","this","async","await","try","catch","finally","throw","switch","case","break","readonly","public","private","void","string","number","boolean","Promise","Map","Set"],
      blocks: [
        ['import { EventEmitter } from "events";', 'import type { Topic, Post } from "./types";', ""],
        ["interface CacheEntry<T> {", "  value: T;", "  expiresAt: number;", "}", ""],
        ["export class TopicStore extends EventEmitter {", "  private cache = new Map<number, CacheEntry<Topic>>();", "  private readonly ttl = 30_000;", "", "  constructor(private readonly client: ApiClient) {", "    super();", "  }", "}", ""],
        ["  async get(id: number): Promise<Topic | null> {", "    const hit = this.cache.get(id);", "    if (hit && hit.expiresAt > Date.now()) return hit.value;", '    const fresh = await this.client.fetchTopic(id);', "    this.cache.set(id, { value: fresh, expiresAt: Date.now() + this.ttl });", '    this.emit("update", fresh);', "    return fresh;", "  }", ""],
        ["  invalidate(id?: number): void {", "    if (id === undefined) this.cache.clear();", "    else this.cache.delete(id);", "  }", ""],
        ["export function renderRow(topic: Topic): string {", '  const unread = topic.unread > 0 ? "●" : "○";', "  return `${unread} ${topic.title} (${topic.postsCount - 1} 回复)`;", "}", ""],
        ["// 状态机：idle -> loading -> ready | error", "type ViewState =", '  | { kind: "idle" }', '  | { kind: "loading" }', '  | { kind: "ready"; posts: Post[] }', '  | { kind: "error"; message: string };', ""],
        ["export function reduce(state: ViewState, ev: ViewEvent): ViewState {", "  switch (ev.type) {", '    case "load": return { kind: "loading" };', '    case "ok":  return { kind: "ready", posts: ev.posts };', '    case "err": return { kind: "error", message: ev.message };', "    default:    return state;", "  }", "}", ""],
        ["const store = new TopicStore(new ApiClient(BASE_URL));", 'store.on("update", (t) => console.log("topic updated", t.id));', ""]
      ]
    },
    go: {
      file: "main.go", dir: "cmd", icon: "GO", comment: "//",
      kw: ["func","package","import","return","if","else","for","range","go","chan","select","case","default","type","struct","interface","map","var","const","defer","nil","err","string","int","bool","error","true","false"],
      blocks: [
        ["package main", "", 'import (', '    "context"', '    "fmt"', '    "sync"', '    "time"', ')', ""],
        ["type TopicCache struct {", "    mu      sync.RWMutex", "    entries map[uint64]CachedTopic", "    ttl     time.Duration", "}", ""],
        ["func NewTopicCache(ttl time.Duration) *TopicCache {", "    return &TopicCache{entries: make(map[uint64]CachedTopic), ttl: ttl}", "}", ""],
        ["func (c *TopicCache) Get(id uint64) (CachedTopic, bool) {", "    c.mu.RLock()", "    defer c.mu.RUnlock()", "    t, ok := c.entries[id]", "    if !ok || t.Expired(c.ttl) {", "        return CachedTopic{}, false", "    }", "    return t, true", "}", ""],
        ["func (c *TopicCache) Refresh(ctx context.Context, id uint64) error {", "    fresh, err := FetchTopic(ctx, id)", "    if err != nil {", '        return fmt.Errorf("refresh topic %d: %w", id, err)', "    }", "    c.mu.Lock()", "    defer c.mu.Unlock()", "    c.entries[id] = fresh", "    return nil", "}", ""],
        ["// 后台定时清理过期条目", "func (c *TopicCache) EvictLoop(ctx context.Context) {", "    tick := time.NewTicker(time.Minute)", "    defer tick.Stop()", "    for {", "        select {", "        case <-ctx.Done():", "            return", "        case <-tick.C:", "            c.evictStale()", "        }", "    }", "}", ""],
        ["func main() {", "    ctx, cancel := context.WithCancel(context.Background())", "    defer cancel()", "    cache := NewTopicCache(30 * time.Second)", "    go cache.EvictLoop(ctx)", '    fmt.Println("listening on :8080")', "}", ""]
      ]
    },
    java: {
      file: "TopicService.java", dir: "src/main/java", icon: "JV", comment: "//",
      kw: ["public","private","protected","class","interface","enum","static","final","void","return","if","else","for","while","new","this","import","package","extends","implements","try","catch","finally","throw","throws","int","long","boolean","String","List","Map","Optional","var"],
      blocks: [
        ["package com.example.topics;", "", "import java.time.Duration;", "import java.util.Map;", "import java.util.Optional;", "import java.util.concurrent.ConcurrentHashMap;", ""],
        ["public class TopicService {", "", "    private final Map<Long, CachedTopic> cache = new ConcurrentHashMap<>();", "    private final Duration ttl;", "    private final TopicClient client;", ""],
        ["    public TopicService(TopicClient client, Duration ttl) {", "        this.client = client;", "        this.ttl = ttl;", "    }", ""],
        ["    public Optional<CachedTopic> get(long id) {", "        CachedTopic hit = cache.get(id);", "        if (hit == null || hit.expired(ttl)) {", "            return Optional.empty();", "        }", "        return Optional.of(hit);", "    }", ""],
        ["    public CachedTopic refresh(long id) throws FetchException {", "        CachedTopic fresh = client.fetchTopic(id);", "        cache.put(id, fresh);", "        return fresh;", "    }", ""],
        ["    // 惰性淘汰：读路径上顺手清理", "    public int evictStale() {", "        int before = cache.size();", "        cache.values().removeIf(t -> t.expired(ttl));", "        return before - cache.size();", "    }", ""],
        ["    public CacheStats stats() {", "        return new CacheStats(cache.size(), hits.get(), misses.get());", "    }", "}", ""]
      ]
    }
  };

  /** 迷你语法高亮（字符串 → 转义 → 关键字/数字/类型 → 注释） */
  function highlightCode(line, L) {
    let s = line, cm = "";
    const ci = s.indexOf(L.comment);
    if (ci >= 0) { cm = s.slice(ci); s = s.slice(0, ci); }
    const slots = [];
    const stash = (m) => { slots.push(m); return "\u0001" + (slots.length - 1) + "\u0002"; };
    s = s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => stash('<span class="tk-s">' + escapeHtml(m) + "</span>"));
    s = escapeHtml(s);
    s = s.replace(new RegExp("\\b(" + L.kw.join("|") + ")\\b", "g"), '<span class="tk-k">$1</span>');
    s = s.replace(/\b(\d[\d_]*(?:\.\d+)?)\b/g, '<span class="tk-n">$1</span>');
    s = s.replace(/\b([A-Z][A-Za-z0-9]+)\b/g, '<span class="tk-t">$1</span>');
    s = s.replace(/\u0001(\d+)\u0002/g, (_, i) => slots[+i]);
    if (cm) s += '<span class="tk-c">' + escapeHtml(cm) + "</span>";
    return s;
  }

  /** 按 话题id+语言 稳定生成一长段代码 */
  function genCodeLines(langKey, topicId) {
    const L = CODE_LANGS[langKey];
    const rnd = mulberry32(((topicId || 0) * 2654435761 + langKey.length * 97 + 7) | 0);
    const out = [];
    let guard = 0;
    while (out.length < 160 && guard++ < 60) {
      const block = L.blocks[Math.floor(rnd() * L.blocks.length)];
      out.push(...block);
    }
    return out;
  }

  let codePanelLastSig = "";

  /** 面板随机种子：详情 = 话题 id；列表 = 当前路由对应列表 API 的字符串哈希 */
  function codePanelSeed() {
    if (isTopicPath(location.pathname) && threadState.topicId) return threadState.topicId | 0;
    const s = listApiForPath(location.pathname) || location.pathname || "/";
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  function renderCodePanel() {
    const main = ownMain();
    if (!main) return;
    const body = main.querySelector("[data-code-body]");
    if (!body) return;
    const langKey = getCodeLang();
    const mode = getCodeMode();
    const seed = codePanelSeed();
    // 同种子同语言同模式不重复渲染（避免闪烁 / observer 空转）
    const sig = `${langKey}:${mode}:${seed}`;
    if (sig === codePanelLastSig && body.childElementCount) return;
    codePanelLastSig = sig;

    const L = CODE_LANGS[langKey];
    const fileEl = main.querySelector("[data-code-file-name]");
    const crumbRoot = main.querySelector("[data-code-crumb-root]");
    const crumbFile = main.querySelector("[data-code-crumb-file]");
    const crumbDir = main.querySelector("[data-code-crumb-dir]");
    const crumbCat = main.querySelector("[data-code-crumb-cat]");
    const iconEl = main.querySelector(".cx-code-tab .cx-rs-ic");
    if (fileEl) fileEl.textContent = L.file;
    if (crumbRoot) crumbRoot.textContent = cfg("projectName") || "platform";
    if (crumbFile) crumbFile.textContent = L.file;
    if (crumbDir) crumbDir.textContent = L.dir;
    if (iconEl) iconEl.textContent = L.icon;
    // 假路径：详情 = <项目名> › <分类 slug 或话题 slug> › …；列表 = <项目名> › <列表标题> › …
    if (crumbCat) {
      if (isTopicPath(location.pathname)) {
        const cat = threadState.categoryId ? categoryById(threadState.categoryId) : null;
        crumbCat.textContent = (cat && cat.slug) || threadState.slug || "topics";
      } else {
        crumbCat.textContent = listTitleForPath(location.pathname);
      }
    }
    const openLabel = main.querySelector("[data-open-lang-label]");
    if (openLabel) openLabel.textContent = CODE_LANG_NAMES[langKey] || langKey;
    main.querySelectorAll("[data-code-view-toggle] span").forEach((x) =>
      x.classList.toggle("cx-on", x.dataset.v === mode)
    );

    const lines = genCodeLines(langKey, seed);
    if (mode === "code") {
      body.innerHTML = lines.map((ln, i) =>
        '<div class="cx-cline"><span class="cx-ln">' + (i + 1) + '</span><span class="cx-lc">' + highlightCode(ln, L) + "</span></div>"
      ).join("");
      if (bossOn()) renderBoss();
      return;
    }
    // diff 模式：同一批代码切片，随机 +/−/上下文
    const rnd = mulberry32((seed * 97 + langKey.length * 13 + 13) | 0);
    const rows = [
      ["meta", "diff --git a/" + L.dir + "/" + L.file + " b/" + L.dir + "/" + L.file],
      ["meta", "index 8f3a2c1..e9d47b5 100644"],
      ["meta", "--- a/" + L.dir + "/" + L.file],
      ["meta", "+++ b/" + L.dir + "/" + L.file]
    ];
    let i = 0, guard = 0;
    while (i < lines.length - 12 && guard++ < 40) {
      const start = i + 1;
      const chunk = 6 + Math.floor(rnd() * 10);
      rows.push(["hunk", "@@ -" + start + "," + chunk + " +" + start + "," + (chunk + 2) + " @@"]);
      for (let k = 0; k < chunk && i < lines.length; k++, i++) {
        const r = rnd();
        const kind = r < 0.25 ? "del" : r < 0.5 ? "add" : "";
        const sign = kind === "del" ? "-" : kind === "add" ? "+" : " ";
        rows.push([kind, sign + " " + lines[i]]);
      }
      i += 2; // hunk 间隔
    }
    body.innerHTML = rows.map(([kind, ln], n) => {
      const isHead = kind === "meta" || kind === "hunk";
      const num = isHead ? "" : String(n);
      const sign = ln.startsWith("+") ? "+ " : ln.startsWith("-") ? "- " : "  ";
      const content = isHead ? escapeHtml(ln) : sign + highlightCode(ln.slice(2), L);
      const cls = kind ? " cx-" + kind : "";
      return '<div class="cx-cline' + cls + '"><span class="cx-ln">' + num + '</span><span class="cx-lc">' + content + "</span></div>";
    }).join("");
    if (bossOn()) renderBoss();
  }

  /* ============================== 详情视图（帖子 = agent thread） ============================== */

  const threadState = {
    topicId: null,
    loading: false,
    stream: [],            // 全部 post id 顺序
    renderedFirstIdx: 0,   // stream 中已渲染的起始下标
    renderedLastIdx: -1,   // stream 中已渲染的结束下标
    hasOlder: false,
    hasNewer: false,
    title: "",
    slug: "",
    categoryId: null,
    postsCount: 0,
    views: 0,
    postsByNum: {}         // post_number -> post（投票组件 / 引用跳转用）
  };

  const likedPosts = new Set();

  function postLiked(post) {
    if (post.id && likedPosts.has(post.id)) return true;
    return (post.actions_summary || []).some((a) => a.id === 2 && a.acted);
  }

  function postLikeCount(post) {
    const like = (post.actions_summary || []).find((a) => a.id === 2);
    return like && like.count ? like.count : 0;
  }

  /** 楼层底部小操作行：回复 / 点赞 / 复制链接 */
  function turnActionsHtml(post) {
    const liked = postLiked(post);
    const count = postLikeCount(post);
    return `
      <div class="cx-turn-actions${liked ? " cx-has-liked" : ""}">
        <button class="cx-act" data-action="reply" data-post-number="${post.post_number}">${ICONS.reply}回复</button>
        <button class="cx-act${liked ? " cx-liked" : ""}" data-action="like" data-post-id="${post.id || ""}">${ICONS.like}<span class="cx-like-label">${liked ? "已赞" : "赞"}${count ? ` ${count}` : ""}</span></button>
        <button class="cx-act${post.bookmarked ? " bookmarked" : ""}" data-action="bookmark" data-post-id="${post.id || ""}">${post.bookmarked ? ICONS.bookmarkFill : ICONS.bookmark}<span>${post.bookmarked ? "已收藏" : "收藏"}</span></button>
        <button class="cx-act" data-action="link" data-post-number="${post.post_number}">${ICONS.link}复制链接</button>
      </div>`;
  }

  /** 楼层元信息行的装饰小图标：按话题+楼层播种，稳定随机 */
  const FLOOR_ICONS = ["check", "branch", "terminal", "file", "globe", "clock"];
  function floorIcon(post) {
    const rnd = mulberry32(((post.id || post.post_number || 1) * 2246822519 ^ (threadState.topicId || 0)) >>> 0);
    return ICONS[FLOOR_ICONS[Math.floor(rnd() * FLOOR_ICONS.length)]] || ICONS.check;
  }

  /** 楼内随机穿插的「工具调用」淡色行（纯装饰；同楼层刷新不变；英文对齐 Codex app） */
  const RUN_LINES = [
    ["terminal", "Running command", true],
    ["file", "Reading file", false],
    ["search", "Searching codebase", false],
    ["folder", "Listing directory", false],
    ["check", "Applied changes", false],
    ["globe", "Fetched page", false],
    ["branch", "Pushed commits", false],
    [null, "Reconnecting", false]
  ];
  const RUN_CMDS = [
    "cargo build --release", "npm run build", "pytest -q tests/cache",
    "go test ./...", "git diff --stat", "ls src/", "make lint",
    "npm test -- --filter=auth", "cargo test --release", "go vet ./...",
    "docker compose up -d", "kubectl get pods -n prod", "curl -sI https://linux.do"
  ];

  /**
   * 一条「工具调用」淡色行的 HTML：列表和楼内共用同一套文案 / 图标 / 命令池。
   * idx 由调用方先定（楼内按 used 集合去重，列表按上一行的 idx 去重），
   * 这样两边各自消耗 rnd() 的顺序互不影响 —— 楼内的覆盖率不会因为列表而变。
   */
  function runlineHtmlFor(idx, rnd) {
    const [icon, text, withCmd] = RUN_LINES[idx];
    return '<div class="cx-runline">' +
      (icon ? ICONS[icon] : "") +
      `<span>${text}${icon === null ? ` ${1 + Math.floor(rnd() * 4)}/${2 + Math.floor(rnd() * 4)}` : ""}</span>` +
      (withCmd ? `<code>${escapeHtml(RUN_CMDS[Math.floor(rnd() * RUN_CMDS.length)])}</code>` : "") +
      "</div>";
  }

  /* 英文思考语料（参考 cli 皮肤 decorationForPost 的素材池） */
  const THINK_OPENERS = [
    "Okay, let me think through this properly.",
    "Alright, reading the post again — the claim hinges on one assumption.",
    "So the question is essentially about trade-offs, not correctness.",
    "Hmm, this is more subtle than it first looks.",
    "The framing is plausible but incomplete — let me reason about why.",
    "Let me unpack what's actually being claimed here before reacting.",
    "Interesting — the symptom and the cause are probably two different things.",
    "Before agreeing, I want to check the failure mode this implies.",
    "First instinct: this is a config issue masquerading as a bug.",
    "Let me separate the diagnosis from the proposed fix.",
    "There's a decent argument on both sides here, which is worth admitting up front.",
    "The subject line promises one thing; the body asks another.",
    "I've seen this pattern before — it usually ends up being permissions.",
    "Reproducing it locally would settle half of this thread instantly.",
    "I'm going to hold off on an opinion until the key numbers are clear."
  ];
  const THINK_MIDS = [
    "The most likely explanation is resource contention, not the code path itself.",
    "If the numbers hold under a controlled benchmark, the conclusion is solid; if not, it's measurement noise.",
    "There are two ways to verify this: profile it under load, or bisect the change.",
    "I should distinguish between what the author measured and what they inferred.",
    "The failure mode only shows up under load, which is exactly why it's easy to miss.",
    "Correlation is doing a lot of work in that argument — worth pointing out gently.",
    "The simple approach probably wins here; the clever one just moves the complexity.",
    "Backwards compatibility matters more than elegance in this specific case.",
    "Queueing delay would explain the tail latency better than throughput.",
    "The connection pooling detail probably matters more than the language choice.",
    "Caching is the obvious lever, but it only helps if the read path is actually hot.",
    "The version pin matters here — half of these reports turn out to be a dependency bump.",
    "This smells like an ordering problem: the cleanup runs before the flush.",
    "In practice the config default wins; nobody reads the docs that deeply.",
    "A single metric won't settle this — I'd want p50 and p99 side by side.",
    "The author's fix works, but it trades one race condition for a subtler one.",
    "If this were reproducible in CI, it would already be closed. That absence is itself a signal.",
    "The right comparison isn't between these two tools, but with the baseline you already trust.",
    "There's a naming collision lurking in there — prod and dev are using different feature flags.",
    "Retry logic usually hides the real fault; the first failure is the honest one.",
    "The throughput story looks good, but the memory graph tells a different one.",
    "I'd rather recommend the boring solution that survives a teammate leaving.",
    "Cache invalidation is the unstated dependency in this whole argument.",
    "The diff is small, but the semantics around the null case changed.",
    "Reaching for an abstraction here just relocates the special cases.",
    "Log noise is suspicious: healthy systems fail quietly, not chatty.",
    "The author is right about the symptom, wrong about the mechanism.",
    "That timing is too uniform to be network jitter — looks scheduled.",
    "Concurrent writers would explain both errors, and a transaction would fix both.",
    "The benchmark lacks a warm-up phase, so the interpreter jit is skewing the first numbers.",
    "Idempotency handles the retry storm better than a tighter timeout ever will.",
    "This passes in tests because tests never exercise the actual cross-origin path.",
    "The dependency was pinned a year ago; the latest release fixed exactly this.",
    "Two callers assume the same global — that's the actual coupling, not the shared file.",
    "I can't confirm the root cause without the request headers.",
    "Better to narrow the scope than to guess at infrastructure.",
    "The proposal optimizes clean-up but leaves the cold-start path untouched.",
    "Feature flags are the part that usually ages the worst in these codebases."
  ];
const THINK_CLOSERS = [
    "Let me structure the reply around the one number that matters.",
    "I'll keep it short and ask the question that actually needs answering.",
    "I should avoid sounding dismissive — the work is genuinely good.",
    "Okay, writing it out step by step is the right move here.",
    "One concrete suggestion beats three abstract ones. Going with that.",
    "I'll agree with the direction, then flag the one thing that could bite later.",
    "Better to leave a question than a lecture — keeping the reply to two points.",
    "Let me lead with the concrete number, then the caveat.",
    "I'll ask for the reproduction steps before committing to a diagnosis.",
    "Wrapping up with the fix I'd actually ship, not the one that sounds smart.",
    "I'll point at the trade-off and let them decide — it's their system.",
    "Closing with a single question keeps the thread productive.",
    "I'll keep the tone neutral; the claim is fine, the evidence is thin.",
    "That's enough analysis — the practical next step is obvious."
  ];

  /** 思考块正文：随机 1-3 句（开头句必有，中段 65%，收尾句 60%） */
  function thinkSentences(rnd) {
    const pick = (pool) => pool[Math.floor(rnd() * pool.length)];
    const out = [pick(THINK_OPENERS)];
    if (rnd() < 0.65) out.push(pick(THINK_MIDS));
    if (rnd() < 0.60) out.push(pick(THINK_CLOSERS));
    return out;
  }

  /**
   * ✻ Worked for 27s —— 可折叠思考块的 HTML。
   * 列表要拼字符串、楼内要插节点，所以这里只出 HTML，怎么放由调用方决定。
   * 默认展开与否也由调用方传（列表看 listThinkingOpen，楼内看 detailThinkingOpen），
   * 两种状态都能点标题行切换。
   */
  function thinkingHtml(rnd, openByDefault) {
    const secs = 2 + Math.floor(rnd() * 46);
    return '<div class="cx-think' + (openByDefault ? " open" : "") + '">' +
      '<div class="cx-think-head"><span class="spin">✻</span><span>Worked for ' + secs + 's</span>' +
      '<span class="cx-think-chev"></span></div>' +
      '<div class="cx-think-body">' + escapeHtml(thinkSentences(rnd).join("\n\n")) + "</div>" +
      "</div>";
  }

  /** 英文思考块（楼内）：HTML → 真实节点，并挂上折叠交互 */
  function buildThinking(rnd) {
    const holder = document.createElement("div");
    holder.innerHTML = thinkingHtml(rnd, !!cfg("detailThinkingOpen"));
    const node = holder.firstChild;
    node.querySelector(".cx-think-head").addEventListener("click", () => {
      node.classList.toggle("open");
    });
    return node;
  }

  function sprinkleActivity(holder) {
    if (!holder) return;
    // 装饰总开关：关掉时连 DOM 都不建（改了开关由 rerenderDetailPosts 重建视图）
    if (!cfg("decorations")) return;
    holder.querySelectorAll(".cx-turn-agent > .cx-cooked").forEach((cooked) => {
      const turn = cooked.closest(".cx-turn-agent");
      if (!turn || turn.dataset.sprinkled === "1") return;
      turn.dataset.sprinkled = "1";
      const pid = Number(turn.dataset.postId || 0);
      const no = Number(turn.dataset.postNumber || 0);
      const kids = [...cooked.children];
      if (!kids.length) return;
      const rnd = mulberry32((((pid || no * 7919) + 1) * 2654435761 ^ (threadState.topicId || 0)) >>> 0);
      // 70% 的回复楼都带英文思考块（独立于下方 runline 伪活动；判断须先于该 return 才达覆盖率）
      if (rnd() < 0.70) {
        cooked.prepend(buildThinking(rnd));
      }
      if (rnd() < 0.72) return;             // runline：大多数楼层保持素净，偶见一两条更像真的
      const n = rnd() < 0.22 ? 2 : 1;       // 至多 2 行
      const used = new Set();
      for (let k = 0; k < n; k++) {
        let li = Math.floor(rnd() * RUN_LINES.length);
        if (used.has(li)) li = (li + 1) % RUN_LINES.length;
        used.add(li);
        const el = document.createElement("div");
        el.innerHTML = runlineHtmlFor(li, rnd);
        const line = el.firstChild;
        const at = Math.min(kids.length, Math.max(1, Math.floor(rnd() * kids.length + 1)));
        kids[at - 1].insertAdjacentElement("afterend", line);
        kids.splice(at, 0, line);
      }
          });
  }

  /** 楼主帖 = 右上 user 气泡 + dim 元信息 */
  function opTurnHtml(post) {
    return `
      <div class="cx-turn-user" data-post-number="${post.post_number}">
        <div class="cx-turn-user-bubble">${post.cooked || ""}</div>
      </div>
      <div class="cx-turn-meta">
        <span class="cx-status-dot cx-done"></span>
        楼主 · ${escapeHtml(post.name || post.username)} · ${escapeHtml(formatTime(post.created_at))} · 阅读 ${threadState.views || "–"}
        ${turnActionsHtml(post)}
      </div>`;
  }

  /** 回帖 = 全宽 agent turn + worked 状态行（操作按钮同行右端，hover 显现） */
  function agentTurnHtml(post) {
    return `
      <div class="cx-turn-agent" data-post-number="${post.post_number}"${post.id ? ` data-post-id="${post.id}"` : ""}>
        <div class="cx-cooked">${post.cooked || ""}</div>
      </div>
      <div class="cx-worked">
        ${floorIcon(post)}
        ${post.post_number} 楼 · ${escapeHtml(post.name || post.username)} · ${escapeHtml(formatTime(post.created_at))}
        ${turnActionsHtml(post)}
      </div>`;
  }

  function turnsHtml(posts) {
    return posts.map((p) => (p.post_number === 1 ? opTurnHtml(p) : agentTurnHtml(p))).join("");
  }

  /** 渲染 + 装饰一组楼层，插入容器（where: "replace" | "prepend" | "append"） */
  function renderTurns(container, posts, where) {
    const holder = document.createElement("div");
    holder.innerHTML = turnsHtml(posts);
    decorateCooked(holder);
    sprinkleActivity(holder);
    if (where === "replace") {
      container.innerHTML = "";
      container.append(...holder.childNodes);
    } else if (where === "prepend") {
      container.prepend(...holder.childNodes);
    } else {
      container.append(...holder.childNodes);
    }
  }

  function detailContainer() {
    return document.querySelector(".cx-thread-posts");
  }

  /** 底部/顶部分割线（照 mockup：以上为 N 条回复中的最近 M 条） */
  function syncThreadDivider() {
    const box = detailContainer();
    if (!box) return;
    box.querySelector(".cx-turn-divider")?.remove();
    const total = Math.max(0, (threadState.postsCount || 0) - 1);
    const loaded = threadState.renderedLastIdx - threadState.renderedFirstIdx + 1;
    if (threadState.hasOlder && total > 0) {
      box.insertAdjacentHTML(
        "beforeend",
        `<div class="cx-turn-divider">以上为 ${total} 条回复中的最近 ${Math.max(0, loaded - 1)} 条 · 向上滚动加载更早</div>`
      );
    }
  }

  /**
   * 装饰类开关（agent 装饰 / 引用卡片）改的是 DOM 结构：关掉时节点根本没建，
   * 藏不掉；打开时又没有节点可露。所以按当前已加载的楼层窗口重建一遍详情视图，
   * 顺带保住滚动位置。
   */
  function rerenderDetailPosts() {
    const box = detailContainer();
    if (!box || !threadState.topicId) return;
    const byId = new Map();
    for (const p of Object.values(threadState.postsByNum)) {
      if (p.id) byId.set(p.id, p);
    }
    const posts = threadState.stream
      .slice(threadState.renderedFirstIdx, threadState.renderedLastIdx + 1)
      .map((id) => byId.get(id))
      .filter(Boolean);
    if (!posts.length) return;
    const scroller = document.querySelector(".cx-view-detail");
    const keep = scroller ? scroller.scrollTop : 0;
    renderTurns(box, posts, "replace");
    syncThreadDivider();
    if (scroller) scroller.scrollTop = keep;
  }

  /**
   * 把一份 topic JSON（接口拿到的，或页面内预加载的）灌进 threadState 并渲染。
   * 抽出来是为了让「接口被 CF 拦 → 改用预加载数据」能走同一条渲染路径。
   */
  function applyTopicJson(data, topicId, box) {
    const posts = (data.post_stream && data.post_stream.posts) || [];
    threadState.stream = (data.post_stream && data.post_stream.stream) || posts.map((p) => p.id);
    threadState.renderedFirstIdx = threadState.stream.indexOf(posts.length ? posts[0].id : -1);
    if (threadState.renderedFirstIdx < 0) threadState.renderedFirstIdx = 0;
    const lastLoadedId = posts.length ? posts[posts.length - 1].id : -1;
    threadState.renderedLastIdx = threadState.stream.indexOf(lastLoadedId);
    if (threadState.renderedLastIdx < 0) {
      threadState.renderedLastIdx = threadState.renderedFirstIdx + Math.max(posts.length - 1, 0);
    }
    threadState.hasOlder = threadState.renderedFirstIdx > 0;
    threadState.hasNewer = threadState.renderedLastIdx >= 0 &&
      threadState.renderedLastIdx < threadState.stream.length - 1;
    threadState.title = data.title || "";
    threadState.slug = data.slug || "";
    threadState.categoryId = data.category_id || null;
    threadState.postsCount = data.posts_count || posts.length;
    threadState.views = data.views || 0;
    // 标题统一走 syncTitle()：伪装模式下要写成「源码文件名 — 项目名」，
    // 直接写帖子标题会把伪装漏出去
    syncTitle();

    threadState.postsByNum = {};
    for (const p of posts) {
      if (p.post_number) threadState.postsByNum[p.post_number] = p;
      if (p.id && postLiked(p)) likedPosts.add(p.id);
    }

    if (box) {
      renderTurns(box, posts, "replace");
      syncThreadDivider();
      // 楼主在顶部，从头开始读
      const scroller = document.querySelector(".cx-view-detail");
      if (scroller) scroller.scrollTop = 0;
    }
    syncChrome();
    // 话题 id 是代码面板的随机种子：换帖重排一份代码
    renderCodePanel();
    return posts.length;
  }

  async function loadTopic(topicId) {
    if (!topicId || threadState.loading) return;
    if (threadState.topicId === topicId) {
      syncChrome();
      return;
    }
    threadState.loading = true;
    threadState.topicId = topicId;
    threadState.postsByNum = {};
    clearQuoteJumpHistory();
    ensureMain();
    showView("detail");
    const box = detailContainer();
    if (box) box.innerHTML = `<div class="cx-list-status">加载中…</div>`;
    syncChrome();
    try {
      const data = await apiWithRetry(`/t/${topicId}.json`);
      if (threadState.topicId !== topicId) return; // 路由已切走
      applyTopicJson(data, topicId, box);
      // 分类名异步到位后刷新面包屑与面板假路径
      if (!categoriesCache && threadState.categoryId) {
        loadCategories().then(() => { syncChrome(); codePanelLastSig = ""; renderCodePanel(); });
      }
    } catch (err) {
      if (threadState.topicId !== topicId) return; // 路由已切走
      // 接口被拦：帖子数据通常也已经在 #data-preloaded 里了（站点当前路由就是这条帖子）
      const preloaded = preloadedTopic(topicId);
      if (preloaded) {
        applyTopicJson(preloaded, topicId, box);
        cxToast("帖子接口被拦，已改用页面内预加载数据");
        return;
      }
      if (box) {
        box.innerHTML = `
          <div class="cx-list-status">
            话题加载失败（${
              err && err.cfChallenge ? "被 Cloudflare 拦截：刷新页面过一下验证再试"
                : `HTTP ${(err && err.status) || "?"}`
            }），可能无权限或已被删除
          </div>`;
      }
    } finally {
      threadState.loading = false;
    }
  }

  function sortPostsByStream(posts, ids) {
    const order = new Map(ids.map((id, i) => [id, i]));
    return posts.slice().sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  /** 向上滚动加载更早的楼层 */
  async function loadOlderPosts() {
    if (!threadState.hasOlder || threadState.loading || !threadState.topicId) return;
    const ids = threadState.stream.slice(Math.max(0, threadState.renderedFirstIdx - 20), threadState.renderedFirstIdx);
    if (!ids.length) return;
    threadState.loading = true;
    const scroller = document.querySelector(".cx-view-detail");
    try {
      const qs = ids.map((id) => `post_ids[]=${id}`).join("&");
      const data = await apiWithRetry(`/t/${threadState.topicId}/posts.json?${qs}`);
      const posts = sortPostsByStream(
        (data.post_stream && data.post_stream.posts) || data.posts || [],
        ids
      );
      threadState.renderedFirstIdx = Math.max(0, threadState.renderedFirstIdx - ids.length);
      threadState.hasOlder = threadState.renderedFirstIdx > 0;
      for (const p of posts) { if (p.post_number) threadState.postsByNum[p.post_number] = p; }
      const box = detailContainer();
      if (box && posts.length) {
        const prevHeight = scroller ? scroller.scrollHeight : 0;
        // 旧楼层插到最前（楼主若在其中会自然成为 user 气泡）
        const holder = document.createElement("div");
        holder.innerHTML = turnsHtml(posts);
        decorateCooked(holder);
        sprinkleActivity(holder);
        box.prepend(...holder.childNodes);
        if (scroller) scroller.scrollTop += scroller.scrollHeight - prevHeight;
      }
      syncThreadDivider();
    } catch { /* 保留现状 */ } finally {
      threadState.loading = false;
    }
  }

  /** 向下滚动加载更新的楼层（长帖不能只留首屏一页） */
  async function loadNewerPosts() {
    if (!threadState.hasNewer || threadState.loading || !threadState.topicId) return;
    const start = threadState.renderedLastIdx + 1;
    if (start <= 0 || start >= threadState.stream.length) {
      threadState.hasNewer = false;
      return;
    }
    const ids = threadState.stream.slice(start, start + 20);
    if (!ids.length) {
      threadState.hasNewer = false;
      return;
    }
    threadState.loading = true;
    try {
      const qs = ids.map((id) => `post_ids[]=${id}`).join("&");
      const data = await apiWithRetry(`/t/${threadState.topicId}/posts.json?${qs}`);
      const posts = sortPostsByStream(
        (data.post_stream && data.post_stream.posts) || data.posts || [],
        ids
      );
      threadState.renderedLastIdx = start + ids.length - 1;
      threadState.hasNewer = threadState.renderedLastIdx < threadState.stream.length - 1;
      for (const p of posts) { if (p.post_number) threadState.postsByNum[p.post_number] = p; }
      const box = detailContainer();
      if (box && posts.length) {
        box.querySelector(".cx-turn-divider")?.remove();
        const holder = document.createElement("div");
        holder.innerHTML = turnsHtml(posts);
        decorateCooked(holder);
        sprinkleActivity(holder);
        box.append(...holder.childNodes);
      }
      syncThreadDivider();
    } catch { /* 保留现状 */ } finally {
      threadState.loading = false;
    }
  }

  /* ============================== 点赞（CSRF 调原生 /post_actions） ============================== */

  async function toggleLike(postId, btn) {
    if (!postId) return;
    const wasLiked = likedPosts.has(postId);
    // 乐观更新，失败回滚
    const paint = (liked) => {
      btn.classList.toggle("cx-liked", liked);
      btn.closest(".cx-turn-actions")?.classList.toggle("cx-has-liked", liked);
      const label = btn.querySelector(".cx-like-label");
      if (label) {
        const n = (label.textContent.match(/\d+/) || [""])[0];
        label.textContent = `${liked ? "已赞" : "赞"}${n ? ` ${n}` : ""}`;
      }
    };
    if (wasLiked) likedPosts.delete(postId); else likedPosts.add(postId);
    paint(!wasLiked);
    try {
      const resp = await fetch(
        wasLiked ? `/post_actions/${postId}?post_action_type_id=2` : "/post_actions",
        wasLiked
          ? {
              method: "DELETE",
              credentials: "same-origin",
              headers: { "X-CSRF-Token": csrfToken(), "X-Requested-With": "XMLHttpRequest" }
            }
          : {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "X-CSRF-Token": csrfToken(),
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded"
              },
              body: `id=${postId}&post_action_type_id=2`
            }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch {
      if (wasLiked) likedPosts.add(postId); else likedPosts.delete(postId);
      paint(wasLiked);
    }
  }

  /* ============================== 正文图片：缩略图 + 悬浮预览 ==============================
   *
   * 默认小图（CSS 约束尺寸），鼠标停上去在旁边浮出大图，点击仍然开灯箱。
   * 预览用 fixed 定位、不进文档流，所以不会把正文顶得跳来跳去。
   *
  * 图源优先取 <img> 自己的 URL：多数情况下缩略图就是同一张原图（只是被 CSS 缩小了），
   * 浏览器已经下载过，所以悬浮预览是零延迟、也不会多发一个请求。
   * （少数带 srcset 的图（Discourse 的多尺寸上传）currentSrc 可能是另一档，
   *   那就等于多下一张 —— 换来的预览是「用户当下看到的那张」的放大版，值得。）
   * ================================================================= */

  let imgPreviewEl = null;
  let imgPreviewTarget = null;
  let imgPreviewTimer = null;

  const CONTENT_IMG_SEL = ".cx-turn-agent img:not(.emoji), .cx-turn-user-bubble img:not(.emoji)";

  function contentImgs(root) {
    return (root || document).querySelectorAll(CONTENT_IMG_SEL);
  }

  function fullImageUrl(img) {
    // 用 IDL 的 img.src：它返回浏览器实际请求的绝对 URL，
    // 与正文缩略图完全一致 → 保证命中缓存（currentSrc 要等加载完才有值）
    const raw = img.currentSrc || img.src || img.getAttribute("src") || "";
    if (raw) {
      try { return new URL(raw, location.href).href; } catch { /* fallthrough */ }
    }
    const link = img.closest("a[href]");
    const href = link ? link.getAttribute("href") : "";
    if (href && /\.(png|jpe?g|gif|webp|avif|bmp)(\?|#|$)/i.test(href)) {
      try { return new URL(href, location.href).href; } catch { /* fallthrough */ }
    }
    return "";
  }

  function ensureImgPreview() {
    if (imgPreviewEl && imgPreviewEl.isConnected) return imgPreviewEl;
    imgPreviewEl = document.createElement("div");
    imgPreviewEl.className = "ldx-imgpreview";
    imgPreviewEl.setAttribute(OWNER_ATTR, OWNER_ID);
    imgPreviewEl.innerHTML =
      '<img alt="">' +
      '<span class="ldx-ipv-load">载入中…</span>' +
      '<div class="ldx-ipv-cap"><span class="ldx-ipv-name" data-ipv-name></span>' +
      '<span class="ldx-ipv-size" data-ipv-size></span></div>';
    document.body.appendChild(imgPreviewEl);
    return imgPreviewEl;
  }

  function placeImgPreview(anchorImg) {
    const box = imgPreviewEl;
    if (!box || !anchorImg || !anchorImg.isConnected) return;
    const a = anchorImg.getBoundingClientRect();
    const p = box.getBoundingClientRect();
    const gap = 14;
    const vw = window.innerWidth, vh = window.innerHeight;

    // 优先放右侧，右侧放不下就放左侧，再放不下就夹在视口内
    let left = a.right + gap;
    if (left + p.width > vw - gap) left = a.left - gap - p.width;
    if (left < gap) left = Math.max(gap, Math.min(vw - p.width - gap, a.left));

    let top = a.top + (a.height - p.height) / 2;
    top = Math.max(gap, Math.min(vh - p.height - gap, top));

    box.style.left = Math.round(left) + "px";
    box.style.top = Math.round(top) + "px";
  }

  function showImgPreview(img) {
    if (!cfg("thumbPreview")) return;
    if (imgPreviewTarget === img && imgPreviewEl && imgPreviewEl.classList.contains("on")) return;
    const url = fullImageUrl(img);
    if (!url) return;
    imgPreviewTarget = img;
    const box = ensureImgPreview();
    const big = box.querySelector("img");
    if (big.getAttribute("src") !== url) big.setAttribute("src", url);

    const name = decodeURIComponent((url.split("/").pop() || "").split("?")[0]);
    box.querySelector("[data-ipv-name]").textContent = name;
    const w = img.naturalWidth, h = img.naturalHeight;
    box.querySelector("[data-ipv-size]").textContent = w && h ? w + "×" + h : "";

    box.classList.add("on");
    // 大图还没到位时给个占位尺寸，否则盒子会塌成一个小胶囊还带破图图标
    const pending = !big.complete || !big.naturalWidth;
    box.classList.toggle("loading", pending);
    placeImgPreview(img);

    if (pending) {
      big.addEventListener("load", () => {
        if (imgPreviewTarget !== img) return;
        box.classList.remove("loading");
        placeImgPreview(img);
      }, { once: true });
      big.addEventListener("error", () => {
        if (imgPreviewTarget === img) hideImgPreview();
      }, { once: true });
    } else {
      // 尺寸已知，等一帧让布局稳定后校正位置
      requestAnimationFrame(() => { if (box.classList.contains("on")) placeImgPreview(img); });
    }
  }

  function hideImgPreview() {
    imgPreviewTarget = null;
    if (imgPreviewEl) imgPreviewEl.classList.remove("on");
  }

  /** 太小的图（表情、分割线、图标）没必要缩略也没必要预览 */
  function markSmallImages(root) {
    contentImgs(root || document).forEach((img) => {
      if (img.dataset.sized === "1") return;
      img.dataset.sized = "1";
      const mark = () => {
        if (img.naturalWidth && img.naturalWidth <= 300 && img.naturalHeight <= 200) {
          img.dataset.noPreview = "1";
        }
      };
      if (img.complete) mark();
      else img.addEventListener("load", mark, { once: true });
    });
  }

  function bindImgPreview() {
    // 用捕获阶段 + mouseover：img 没有子节点，所以每个 img 只会触发一次
    document.addEventListener("mouseover", (e) => {
      const img = e.target && e.target.closest ? e.target.closest(CONTENT_IMG_SEL) : null;
      if (!img || img.dataset.noPreview === "1") return;
      clearTimeout(imgPreviewTimer);
      showImgPreview(img);
    }, true);

    document.addEventListener("mouseout", (e) => {
      const img = e.target && e.target.closest ? e.target.closest(CONTENT_IMG_SEL) : null;
      if (!img) return;
      clearTimeout(imgPreviewTimer);
      // 留一点延迟，避免鼠标在图片边缘抖动时闪来闪去（预览本身 pointer-events:none）
      imgPreviewTimer = setTimeout(hideImgPreview, 70);
    }, true);

    // 滚动会让 fixed 预览和缩略图错位，直接收起
    window.addEventListener("scroll", hideImgPreview, true);
    window.addEventListener("blur", hideImgPreview);
    document.addEventListener("visibilitychange", hideImgPreview);
  }

  /* ============================== 隐蔽性（伪装模式） ==============================
   *
   * 上班摸鱼场景下真正需要的不是「好看」，而是「一眼扫过去不像论坛」：
   *   1. 标签页标题伪装成源码文件名（stealth 模式下不再出现 Linux DO / 帖子标题）
   *   2. 应急伪装键：整个视口瞬间变成「代码编辑器 + 正在跑测试的终端」
   *   3. 侧边栏模式：鼠标一离开页面区域就自动做第 2 条（人走开的一瞬间页面自己变 IDE）
   *
   * 伪装视图沿用同一套 token 和同一份假代码生成器，所以切换时看起来像
   * 在同一个 IDE 里换了个面板，而不是「网页变了」。
   * ================================================================= */

  /* ---- 通用：检测「鼠标是不是已经不在当前页面区域里了」 ------------------
   *
   * 只做检测，不做任何业务决定 —— 决定什么（伪装、暂停刷新、隐藏浮层…）
   * 交给调用方的 onLeave / onReturn，检测这层不知道业务存在。
   *
   * 两个触发源，互相独立：
   *   mouseleave —— 鼠标移出页面区域（含移到浏览器地址栏 / 书签栏）。
   *                 必须挂在 documentElement 的捕获阶段：<html> 自己不会收到
   *                 冒泡的 mouseout（它是冒泡链的终点），只有捕获阶段能稳定收到。
   *                 另外只认 relatedTarget 为空（真的出页面）的那种。
   *   blur       —— 窗口失焦 / 标签页被切走。默认不监听；要不要看
   *                  getHideOnBlur() 的返回值，改完调 refresh() 就生效。
   *   visible    —— 标签页重新可见（visibilitychange），这是 blur 的配套「回来」信号：
   *                 Alt+Tab 回来时鼠标常常没跨边界，不会有 mouseenter。
   * ---------------------------------------------------------------------- */

  function createPageLeaveWatcher(opts) {
    const o = opts || {};
    const host = o.host || window;
    const doc = o.document || document;
    const root = doc.documentElement;
    const onLeave = typeof o.onLeave === "function" ? o.onLeave : null;
    const onReturn = typeof o.onReturn === "function" ? o.onReturn : null;
    /**
     * 要不要监听 blur。优先用 getHideOnBlur() 现读 —— 这个开关来自设置面板，
     * 如果在创建时把值快照下来，之后用户改成打开，blur 永远挂不上（refresh() 也救不了）。
     */
    const wantBlur = () =>
      typeof o.getHideOnBlur === "function" ? !!o.getHideOnBlur() : !!o.hideOnBlur;

    const onMouseLeave = (e) => {
      // relatedTarget 非空 = 只是移到了页面内另一个元素上，不算离开
      if (e.relatedTarget) return;
      if (onLeave) onLeave("mouseleave");
    };
    const onMouseEnter = () => {
      if (onReturn) onReturn("mouseenter");
    };
    const onBlur = () => {
      // window 的 blur = 整个窗口/标签页失去焦点（页面内的焦点变化走 focusout）
      if (!wantBlur()) return;
      if (onLeave) onLeave("blur");
    };
    const onVisibility = () => {
      if (doc.visibilityState === "hidden" || doc.hidden) return;
      if (onReturn) onReturn("visible");
    };

    root.addEventListener("mouseleave", onMouseLeave, true);
    root.addEventListener("mouseenter", onMouseEnter, true);
    doc.addEventListener("visibilitychange", onVisibility);
    return {
      /** 拆掉所有监听器（幂等） */
      destroy() {
        root.removeEventListener("mouseleave", onMouseLeave, true);
        root.removeEventListener("mouseenter", onMouseEnter, true);
        doc.removeEventListener("visibilitychange", onVisibility);
        host.removeEventListener("blur", onBlur);
      },
      /** 开关变了吗？变了就重新登记监听器（读的是最新值，不是创建时的快照） */
      refresh() {
        host.removeEventListener("blur", onBlur);
        if (wantBlur()) host.addEventListener("blur", onBlur);
      }
    };
  }

  /* ---- 侧边栏模式：把上面那几个信号接到 setBoss() 上 ---------------------- */

  /** 本次伪装是不是「侧边栏模式」自动触发的（只有它自己触发的才自动撤） */
  let bossAuto = false;

  /**
   * 侧边栏模式的「离开」迟滞（毫秒）。
   * 用来滤掉「鼠标划过页面内跨源 iframe」这种 relatedTarget=null 的假离开。
   */
  const SIDEBAR_LEAVE_DELAY = 160;

  /**
   * 现在适合自动伪装吗？
   * 不适合：功能没开 / 伪装总开关没开 / 本脚本正在让位 / 已经在伪装里 /
   * 设置面板开着（用户正在调设置，把页面藏起来等于把人锁在门外）。
   */
  function bossAutoHideAllowed() {
    if (!cfg("sidebarMode")) return false;
    if (!cfg("stealth")) return false;
    if (bossOn()) return false;
    if (settingsOpen()) return false;
    if (otherThemeActive()) return false;
    // 本脚本还没接管（CF 盾 / 让位状态）时 ROOT_CLASS 不在 <html> 上，
    // token 不生效、底色是错的，这时候弹伪装视图只会更难看
    if (!document.documentElement.classList.contains(ROOT_CLASS)) return false;
    return true;
  }

  /**
   * 侧边栏模式。
   *
   * 语义（写死在代码里，不额外加设置项）：
   *   - 鼠标离开页面区域 / 窗口失焦 → 自动切进伪装视图；
   *   - 鼠标回到页面 → 自动切回来，**但只撤它自己触发的那次**：
   *     手动按 Esc² / Ctrl+Shift+H 进的伪装，鼠标碰一下页面就被弹出来会很吓人；
   *   - 设置面板开着时不动手（见 bossAutoHideAllowed）。
   *
   * 配置全部在调用时读（cfg()），所以设置面板里一改开关，下一次鼠标移动 /
   * 切标签页就生效，不需要重建这个控制器。
   */
  function createSidebarAutoHide(env) {
    let watcher = null;
    let shown = false; // 「这一轮是它藏起来的」——防止重复触发和误恢复
    let leaveTimer = 0; // 离开后的迟滞计时器（见 hideSoon）

    const hide = () => {
      if (shown || !bossAutoHideAllowed()) return;
      shown = true;
      setBoss(true);
      // 只在「确实是我们切进去的」时才打标记 —— 关了「回来自动恢复」时，
      // 用户可能在伪装里继续用鼠标（不会自动退出），这时再次离开不该把
      // 手动那次伪装算成自动触发的。
      if (bossOn()) bossAuto = true;
    };
    /**
     * 离开页面后不立刻动手，先等一小会。
     *
     * 为什么要迟滞：鼠标从 <html> 移到页面里的**跨源 iframe** 上时，浏览器拿不到
     * relatedTarget，送来的就是「relatedTarget = null 的 mouseleave」，跟真的移出
     * 页面一模一样 —— 从 iframe 上划过去（登录页的 reCAPTCHA、嵌入视频）就会平白
     * 弹一次伪装。迟滞窗口内鼠标又回到页面就把这次取消掉，对「人真的走开」几乎无感。
     *
     * 只给 mouseleave 用：blur（窗口失焦 / 切标签页）是明确信号，没有 iframe 那类误报，
     * 而且用户按了别的窗口就希望页面马上藏好，所以它走 onLeave 后立刻 hide()。
     */
    const hideSoon = () => {
      if (shown || leaveTimer) return;
      leaveTimer = setTimeout(() => {
        leaveTimer = 0;
        hide();
      }, SIDEBAR_LEAVE_DELAY);
    };
    const cancelLeave = () => {
      if (!leaveTimer) return;
      clearTimeout(leaveTimer);
      leaveTimer = 0;
    };
    const restore = () => {
      cancelLeave();
      if (!shown) return;
      // 「回来自动恢复」可以关掉：关了以后这一轮就交给用户自己按 Esc² 退，
      // 但 shown 仍然要清掉（表示「这轮不用再等了」），免得留下一条僵着的状态。
      if (!cfg("sidebarAutoRestore")) {
        shown = false;
        return;
      }
      shown = false;
      // 只有「还停在自动触发的那次伪装里」才恢复
      if (bossOn() && bossAuto) setBoss(false);
    };

    return {
      /** 启动（幂等）：登记 mouseleave / mouseenter / visibilitychange，并按当前设置决定要不要看 blur */
      start() {
        if (watcher) return;
        watcher = createPageLeaveWatcher({
          host: env.host,
          document: env.document,
          getHideOnBlur: () => cfg("sidebarHideOnBlur"),
          // 鼠标离开要过迟滞；窗口失焦是明确信号，立刻办
          onLeave: (reason) => (reason === "blur" ? hide() : hideSoon()),
          onReturn: () => restore()
        });
        watcher.refresh();
      },
      /** 设置改了（比如刚打开「切换标签页时也伪装」）后重新登记 */
      refresh() {
        if (watcher) watcher.refresh();
      },
      /**
       * 停用：拆监听器 + 取消还没到点的迟滞。
       * 注意这里**不**去动已经切好的伪装视图 —— 「关掉功能」和「退出伪装」是两件事。
       */
      stop() {
        cancelLeave();
        if (watcher) watcher.destroy();
        watcher = null;
      },
      /**
       * 伪装被关掉了（不管是谁关的）：清掉这一轮的自动隐藏标记。
       *
       * 为什么需要：shown 只有 hide()/restore() 会动，而 setBoss() 不会。
       * 用户可能在「自动藏起来」的窗口里自己按 Esc² 退出，这时 shown 还挂在 true，
       * 下一轮 hide() 就会被 `if (shown)` 挡掉（症状是「有时鼠标走开不自动伪装」）。
       * 由 setBoss(false) 统一回调这里，两边状态就不会分叉。
       */
      forget() {
        cancelLeave();
        shown = false;
        bossAuto = false;
      }
    };
  }

  function bossOn() {
    return document.documentElement.classList.contains(BOSS_CLASS);
  }

  /** 终端里那串「看起来刚跑完」的构建日志（按种子稳定） */
  const BOSS_TESTS = [
    "cache::tests::stale_entry_is_evicted",
    "cache::tests::refresh_updates_ttl",
    "http::tests::etag_is_stable_across_calls",
    "store::tests::upsert_is_idempotent",
    "parse::tests::unescapes_html_entities",
    "config::tests::env_overrides_file"
  ];

  function bossLogHtml(seed) {
    const rnd = mulberry32(seed);
    const out = [];
    const root = cfg("projectName") || "platform";
    out.push('<span class="cmd">$ cargo build --release</span>');
    out.push('<span class="dim">   Compiling ' + escapeHtml(root) + '-engine v0.9.3 (/Users/dev/work/' + escapeHtml(root) + '-engine)</span>');
    out.push('<span class="dim">   Compiling topic-cache v0.2.4</span>');
    out.push('<span class="ok">    Finished</span> release [optimized] target(s) in ' + (6 + rnd() * 9).toFixed(1) + 's');
    out.push("");
    out.push('<span class="cmd">$ cargo test --release --quiet</span>');
    out.push('<span class="dim">running ' + BOSS_TESTS.length + ' tests</span>');
    for (const t of BOSS_TESTS) out.push("test " + t + " ... <span class=\"ok\">ok</span>");
    out.push("");
    out.push("test result: <span class=\"ok\">ok</span>. " + BOSS_TESTS.length + " passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in " + (0.2 + rnd() * 0.6).toFixed(2) + "s");
    out.push("");
    out.push('<span class="cmd">$ git diff --stat</span>');
    out.push(" 3 files changed, " + (20 + Math.floor(rnd() * 90)) + " insertions(+), " + Math.floor(rnd() * 20) + " deletions(-)");
    out.push("");
    out.push('<span class="cmd">$ <span class="ldx-boss-caret"></span></span>');
    return out.join("\n");
  }

  function ensureBoss() {
    let box = document.querySelector(".ldx-boss");
    if (box) return box;
    box = document.createElement("div");
    box.className = "ldx-boss";
    box.hidden = true;
    box.setAttribute(OWNER_ATTR, OWNER_ID);
    box.innerHTML = '' +
      '<div class="ldx-boss-bar">' +
      '  <span data-boss-tabs style="display:flex;align-items:center;gap:2px"></span>' +
      '  <span class="ldx-boss-spacer"></span>' +
      '  <span class="ldx-boss-shell" data-boss-shell></span>' +
      "</div>" +
      '<div class="ldx-boss-editor" data-boss-code></div>' +
      '<div class="ldx-boss-term">' +
      '  <div class="ldx-boss-term-head"><span>Terminal</span><span>zsh</span><span>cargo</span></div>' +
      '  <pre class="ldx-boss-term-body" data-boss-log></pre>' +
      "</div>";
    document.body.appendChild(box);
    return box;
  }

  function renderBoss() {
    const box = document.querySelector(".ldx-boss");
    if (!box) return;
    const cur = getCodeLang();
    const others = Object.keys(CODE_LANGS).filter((k) => k !== cur).slice(0, 2);
    const tabs = [cur].concat(others);

    const tabsEl = box.querySelector("[data-boss-tabs]");
    if (tabsEl) {
      tabsEl.innerHTML = tabs.map((k, i) => {
        const l = CODE_LANGS[k];
        return '<span class="ldx-boss-tab' + (i === 0 ? " on" : "") + '">' +
          '<span class="ic">' + escapeHtml(l.icon) + "</span>" + escapeHtml(l.file) + "</span>";
      }).join("");
    }

    const L = CODE_LANGS[cur];
    const seed = codePanelSeed();
    const codeEl = box.querySelector("[data-boss-code]");
    if (codeEl) {
      const lines = genCodeLines(cur, seed);
      codeEl.innerHTML = lines.map((line, i) =>
        '<div class="cx-code-line"><span class="cx-ln">' + (i + 1) + '</span>' +
        '<span class="cx-src">' + highlightCode(line, L) + "</span></div>").join("");
      codeEl.scrollTop = 0;
    }
    const logEl = box.querySelector("[data-boss-log]");
    if (logEl) {
      logEl.innerHTML = bossLogHtml(seed);
      // 滚到底 —— 让末尾那个光标可见（布局可能晚一拍，所以补两次）
      const toBottom = () => { logEl.scrollTop = logEl.scrollHeight; };
      toBottom();
      requestAnimationFrame(toBottom);
    }
    const shellEl = box.querySelector("[data-boss-shell]");
    if (shellEl) shellEl.textContent = "~/work/" + (cfg("projectName") || "platform") + "-engine";
  }

  /**
   * 切换应急伪装视图。注意：只切外观，不卸载任何真实 DOM，恢复时无损失。
   * 所有「进 / 出伪装」的路都走这里（应急键、侧边栏模式、设置开关纠错），
   * 统一在这里维护 bossAuto 标记，别在调用点各自改。
   *
   * forceOff = 忽略 stealth 开关强制退出（用于「用户在伪装视图里把伪装总开关关掉」）。
   */
  function setBoss(on, forceOff) {
    if (!cfg("stealth") && !forceOff) return;
    if (!on) {
      // 退出：没有节点就别为了关它造一个出来（applyVisualSettings 每次都会走这里）
      const box = document.querySelector(".ldx-boss");
      if (box) box.hidden = true;
      bossAuto = false;
      document.documentElement.classList.remove(BOSS_CLASS);
      // 通知侧边栏模式「这轮结束了」，否则它内部那份 shown 会僵着挡住下一次自动伪装
      if (sidebarAutoHide) sidebarAutoHide.forget();
      return;
    }
    if (!document.body) return; // document-start 阶段没地方挂
    // 切进去之前把输入焦点交出去，避免 composer 还在吃按键
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    hideImgPreview();
    // 注意顺序：renderBoss() 是往已有的 .ldx-boss 里填内容，节点必须先建出来
    const box = ensureBoss();
    renderBoss();
    box.hidden = false;
    bossAuto = false;
    document.documentElement.classList.add(BOSS_CLASS);
  }

  /** "ctrl+shift+h" / "f2" 这类组合键匹配 */
  function bossKeyMatch(e, spec) {
    const parts = String(spec || "").toLowerCase().split("+").map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return false;
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    const wantCtrl = mods.indexOf("ctrl") >= 0 || mods.indexOf("cmd") >= 0 || mods.indexOf("meta") >= 0;
    if (wantCtrl !== (e.ctrlKey || e.metaKey)) return false;
    if ((mods.indexOf("alt") >= 0) !== e.altKey) return false;
    if ((mods.indexOf("shift") >= 0) !== e.shiftKey) return false;
    return (e.key || "").toLowerCase() === key;
  }

  let lastEscAt = 0;

  function bindStealthKeys() {
    window.addEventListener("keydown", (e) => {
      // 设置面板开着时 Esc 先关面板（别再触发应急伪装）。
      // 这一条必须在这里办：本监听器注册在 bindSettingsKeys 之前，
      // 否则面板关掉之后这次 Esc 会被当成「第一下」，紧接着的第二下就误开伪装。
      if (e.key === "Escape" && settingsOpen()) {
        e.preventDefault();
        closeSettings();
        lastEscAt = 0; // 这次 Esc 被面板吃掉了，不能算进「连按两下」那一对
        return;
      }
      // 灯箱开着时 Esc 属于灯箱：同样不算进连按
      if (e.key === "Escape" && activeLightbox) {
        lastEscAt = 0;
        return;
      }
      const spec = String(cfg("stealthKey") || "esc2").toLowerCase();
      if (spec === "esc2" && e.key === "Escape") {
        // 应急键的价值就在于「任何时候一按就藏」，所以在输入框里打字也照样生效；
        // 想在输入框里取消输入，单次 Esc 即可（单次本来也不触发）
        const now = Date.now();
        if (now - lastEscAt < 450) {
          lastEscAt = 0;
          e.preventDefault();
          setBoss(!bossOn());
        } else {
          lastEscAt = now;
        }
        return;
      }
      if (bossKeyMatch(e, spec) || bossKeyMatch(e, "ctrl+shift+h")) {
        e.preventDefault();
        e.stopPropagation();
        setBoss(!bossOn());
      }
    }, true);
  }

  /* ============================== 设置面板 ==============================
   *
   * 控件用一张声明式表描述（SETTING_SPEC），加新设置只需要往表里加一行 ——
   * 不用改 HTML、不用改事件绑定。
   *
   * 交互细节：拖滑块时只改 CSS 变量（previewSetting），松手才 setCfg() 落盘 +
   * 按需重建 DOM；否则每动一格都要重排整个列表。
   * ================================================================= */

  /**
   * 该设置对应哪个 CSS 变量（拖拽时用来做即时预览）。
   * 值语义只有两种：数字 → px，百分比 → 0–1（不透明度）。
   * 需要在预览时做别的事的设置，直接在自己的 spec item 上写 preview: (v) => {...}
   * （panelWidth 就走 preview，因为 0 要变成「删掉变量」而不是写 0px）。
   */
  const SETTING_CSS_VAR = {
    railWidth: { name: "--cx-rail-w", unit: "px" },
    threadMaxWidth: { name: "--cx-thread-max", unit: "px" },
    pageOpacity: { name: "--cx-page-opacity", unit: "%" },
    thumbWidth: { name: "--ldx-thumb-w", unit: "px" },
    thumbHeight: { name: "--ldx-thumb-h", unit: "px" }
  };

  const SETTING_SPEC = [
    { section: "外观", items: [
      { key: "theme", type: "select", label: "主题", hint: "「跟随站点」会读 linux.do 自己的明暗设置",
        options: [["auto", "跟随站点"], ["dark", "深色"], ["light", "浅色"]] },
      { key: "railWidth", type: "range", label: "左栏宽度", min: 240, max: 520, step: 2, unit: "px" },
      { key: "panelWidth", type: "range", label: "代码面板宽度", min: 0, max: 900, step: 4, unit: "px",
        hint: "0 = 自动（与中间栏 1:1 分屏，脚本原本的默认值）",
        preview: (v) => applyPanelWidth(v),
        format: (v) => (v > 0 ? v + "px" : "自动") },
      { key: "threadMaxWidth", type: "range", label: "正文最大宽度", min: 560, max: 1100, step: 10, unit: "px" },
      { key: "pageOpacity", type: "range", label: "页面不透明度", min: 40, max: 100, step: 5, unit: "%",
        hint: "只调脚本自绘的界面（左栏 + 主区）。linux.do 自己的页面和灯箱、设置面板、toast 这类浮层始终 100%",
        // 单独写 preview：这条要连 dim 类一起切（规则挂在 .codex-page-dim 上，
        // 光改变量不生效）
        preview: (v) => applyPageOpacity(v) },
      { key: "codePanel", type: "toggle", label: "显示右侧代码面板", hint: "那块代码是假数据，纯氛围" },
      { key: "lang", type: "select", label: "代码面板语言",
        options: () => Object.keys(CODE_LANGS).map((k) => [k, CODE_LANG_NAMES[k] || k]) },
      { key: "codeMode", type: "select", label: "代码面板视图", options: [["code", "代码"], ["diff", "diff"]] }
    ] },
    { section: "装饰", items: [
      { key: "decorations", type: "toggle", label: "启用 agent 装饰",
        hint: "列表行之间穿插的痕迹，以及楼内的英文思考块和工具调用行。内容是按种子生成的假文案，跟帖子无关，纯装饰" },
      { key: "listTraceRate", type: "range", label: "列表痕迹密度", min: 0, max: 100, step: 2, unit: "%",
        hint: "列表里行与行之间插入痕迹（思考块 / 工具调用行）的比例。0 = 列表里不插" },
      { key: "listThinkingOpen", type: "toggle", label: "列表思考块默认展开",
        hint: "关掉时只占一行「✻ Worked for Ns ▸」，点一下展开" },
      { key: "detailThinkingOpen", type: "toggle", label: "楼内思考块默认展开" },
      { key: "quoteCard", type: "toggle", label: "把引用渲染成引用卡片",
        hint: "Discourse 的引用会变成可折叠卡片，带头部标签、可跳转被引用的楼层" },
      { key: "quoteOpen", type: "toggle", label: "引用卡片默认展开" }
    ] },
    { section: "撰写", items: [
      { key: "composePreview", type: "toggle", label: "输入框默认开启实时预览",
        hint: "对应工具栏上的「实时预览」按钮；这里只决定新打开输入框时的默认状态" },
      { key: "composerCollapsed", type: "toggle", label: "底部输入框收起",
        hint: "收起后只留一条细栏（点细栏或箭头展开）；和输入框工具栏右端的收起箭头是同一个开关，点「回复」某楼时会自动展开" }
    ] },
    { section: "伪装", items: [
      { key: "stealth", type: "toggle", label: "伪装模式",
        hint: "品牌名 → Codex、标签页标题 → 源码文件名、启用下面的应急键" },
      { key: "brandName", type: "text", label: "左栏品牌名",
        placeholder: "留空 = 跟随伪装模式" },
      { key: "projectName", type: "text", label: "项目名",
        hint: "出现在代码面板面包屑和标签页标题里（如 \"lib.rs — platform\"）" },
      { key: "stealthKey", type: "select", label: "应急伪装键", hint: "Ctrl+Shift+H 始终有效",
        options: [["esc2", "连按两下 Esc"], ["f2", "F2"], ["ctrl+shift+h", "Ctrl+Shift+H"]] },
      { key: "favicon", type: "select", label: "标签页图标",
        options: [["codex", "Codex 风格圆角图标"], ["site", "保留 linux.do 原图标"]] }
    ] },
    { section: "侧边栏模式", items: [
      { key: "sidebarMode", type: "toggle", label: "侧边栏模式",
        hint: "鼠标一离开页面区域就自动伪装（和连按两下 Esc 同一个视图），鼠标回来再自动恢复；只撤它自己触发的那次，手动按出的伪装不受影响" },
      { key: "sidebarHideOnBlur", type: "toggle", label: "切换标签页 / 窗口时也伪装",
        hint: "在「鼠标移出页面」之外再加一个触发源：窗口失焦或标签页被切走" },
      { key: "sidebarAutoRestore", type: "toggle", label: "鼠标回来自动恢复",
        hint: "关掉后：走开时照样自动伪装，但鼠标回来 / 标签页切回来都不会自己退出，得自己按 Esc² 或 Ctrl+Shift+H" }
    ] },
    { section: "正文图片", items: [
      { key: "thumbWidth", type: "range", label: "缩略图宽度上限", min: 120, max: 600, step: 10, unit: "px" },
      { key: "thumbHeight", type: "range", label: "缩略图高度上限", min: 80, max: 400, step: 10, unit: "px" },
      { key: "thumbPreview", type: "toggle", label: "鼠标悬停浮出大图" }
    ] }
  ];

  function specItem(key) {
    for (const g of SETTING_SPEC) {
      for (const it of g.items) if (it.key === key) return it;
    }
    return null;
  }

  /** 控件右侧显示的当前值：默认「值 + 单位」，带 format 的设置自己决定（如 panelWidth 的「自动」） */
  function settingValueLabel(it, value) {
    if (it && typeof it.format === "function") return it.format(value);
    return value + ((it && it.unit) || "");
  }

  function settingControlHtml(it) {
    const v = cfg(it.key);
    if (it.type === "toggle") {
      return '<button type="button" class="cx-switch' + (v ? " on" : "") + '"' +
        ' role="switch" aria-checked="' + (v ? "true" : "false") + '"' +
        ' data-set-toggle="' + it.key + '" aria-label="' + escapeHtml(it.label) + '"><span></span></button>';
    }
    if (it.type === "range") {
      return '<input type="range" class="cx-range" data-set-range="' + it.key + '"' +
        ' min="' + it.min + '" max="' + it.max + '" step="' + it.step + '" value="' + v + '">' +
        '<span class="cx-set-val" data-set-val="' + it.key + '">' + escapeHtml(settingValueLabel(it, v)) + "</span>";
    }
    if (it.type === "select") {
      const opts = typeof it.options === "function" ? it.options() : it.options;
      return '<select class="cx-select" data-set-select="' + it.key + '">' +
        opts.map(([val, text]) =>
          '<option value="' + escapeHtml(val) + '"' +
          (String(v) === String(val) ? " selected" : "") + ">" + escapeHtml(text) + "</option>").join("") +
        "</select>";
    }
    return '<input type="text" class="cx-text" data-set-text="' + it.key + '" value="' +
      escapeHtml(v) + '" placeholder="' + escapeHtml(it.placeholder || "") + '">';
  }

  function settingsOpen() {
    const m = ownModal();
    return !!m && !m.hidden;
  }

  function closeSettings() {
    const m = ownModal();
    if (m) m.hidden = true;
  }

  /**
   * 拖控件时的即时预览：只作用到页面上，不写存储、不重建 DOM。
   *
   * 通用规则：range 只要在 SETTING_CSS_VAR 里登记过就自动预览；
   * 需要在预览时做别的事（或不做 CSS 变量）的设置，在自己那条 spec 上写
   * preview(value) 即可 —— 加新设置不用回来改这个函数。
   */
  function previewSetting(key, value) {
    const it = specItem(key);
    if (it && typeof it.preview === "function") {
      it.preview(value);
      return;
    }
    const entry = SETTING_CSS_VAR[key];
    if (!entry) return;
    const cssValue = entry.unit === "%"
      ? String(clampPercent(value, DEFAULTS[key], (it && it.min) || 0) / 100)
      : value + entry.unit;
    document.documentElement.style.setProperty(entry.name, cssValue);
  }

  /**
   * 把面板里所有控件的状态刷成 cfg() 的当前值。
   * 用于「别处改了设置」的场景（左栏明暗按钮、面板显隐按钮、拖拽把手、恢复默认），
   * 面板没打开时直接跳过。
   */
  function syncSettingControls() {
    const m = ownModal();
    if (!m || m.hidden) return;
    m.querySelectorAll("[data-set-toggle]").forEach((el) => {
      const on = !!cfg(el.dataset.setToggle);
      el.classList.toggle("on", on);
      el.setAttribute("aria-checked", on ? "true" : "false");
    });
    m.querySelectorAll("[data-set-range]").forEach((el) => {
      const key = el.dataset.setRange;
      const it = specItem(key);
      el.value = cfg(key);
      const out = m.querySelector('[data-set-val="' + key + '"]');
      if (out) out.textContent = settingValueLabel(it, cfg(key));
    });
    m.querySelectorAll("[data-set-select]").forEach((el) => {
      el.value = cfg(el.dataset.setSelect);
    });
    m.querySelectorAll("[data-set-text]").forEach((el) => {
      el.value = cfg(el.dataset.setText);
    });
  }

  function renderSettingsPanel() {
    let m = ownModal();
    if (!m) {
      m = document.createElement("div");
      m.className = "cx-modal";
      m.hidden = true;
      m.setAttribute(OWNER_ATTR, OWNER_ID);
      document.body.appendChild(m);
    }
    const rows = SETTING_SPEC.map((g) =>
      '<div class="cx-set-section">' + escapeHtml(g.section) + "</div>" +
      g.items.map((it) =>
        '<div class="cx-set-row" data-row="' + it.key + '">' +
        '<div class="cx-set-label"><span>' + escapeHtml(it.label) + "</span>" +
        (it.hint ? '<div class="cx-set-hint">' + escapeHtml(it.hint) + "</div>" : "") +
        "</div>" +
        '<div class="cx-set-ctrl">' + settingControlHtml(it) + "</div>" +
        "</div>").join("")
    ).join("");

    m.innerHTML =
      '<div class="cx-modal-card" role="dialog" aria-modal="true" aria-label="设置">' +
      '<div class="cx-modal-head">' +
      '<span class="cx-modal-title">设置</span>' +
      '<span class="cx-modal-sub">改动即时生效并存在本机</span>' +
      '<button type="button" class="cx-modal-x" data-settings-close title="关闭（Esc）">×</button>' +
      "</div>" +
      '<div class="cx-modal-body">' + rows + "</div>" +
      '<div class="cx-modal-foot">' +
      '<button type="button" class="cx-modal-btn" data-settings-reset>恢复默认</button>' +
      '<span>设置存在 localStorage 的 <code>linuxdo-codex:settings</code>，清掉就回到初始状态</span>' +
      "</div>" +
      "</div>";
    return m;
  }

  function openSettings() {
    // 回退原皮时（CF 盾 / 其它主题接管）<html> 上没有 ROOT_CLASS，
    // 面板用的那批 token 也就不存在，开出来是掉色的 —— 干脆不开。
    // document-start 阶段 body 还没建好，同样没地方挂。
    if (!document.body || !document.documentElement.classList.contains(ROOT_CLASS)) return;
    const m = renderSettingsPanel();
    m.hidden = false;
    m.querySelector("[data-settings-close]")?.focus();
  }

  function toggleSettings() {
    if (settingsOpen()) closeSettings();
    else openSettings();
  }

  function bindSettingsPanel() {
    // 面板是常驻 DOM（懒建），所以事件只绑一次
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest && t.closest("[data-settings-open]")) { openSettings(); return; }
      if (!settingsOpen()) return;

      const m = ownModal();
      if (t.closest("[data-settings-close]")) { closeSettings(); return; }
      if (t.closest("[data-settings-reset]")) {
        resetSettings();
        renderSettingsPanel();
        cxToast("已恢复默认设置");
        return;
      }
      // 点遮罩关闭（点卡片内部不关）
      if (t === m) { closeSettings(); return; }

      const sw = t.closest("[data-set-toggle]");
      if (sw) {
        const key = sw.dataset.setToggle;
        const next = !cfg(key);
        sw.classList.toggle("on", next);
        sw.setAttribute("aria-checked", next ? "true" : "false");
        // 开关一律走完整应用（不做 visualOnly）：
        // 装饰 / 引用卡片这类开关决定 DOM 建不建，主题和面板显隐也要连带重渲染。
        setCfg(key, next);
        return;
      }
    });

    // 拖滑块：input 只预览，change 才落盘 + 按需重建
    document.addEventListener("input", (e) => {
      const r = e.target;
      if (!r.dataset || !r.dataset.setRange) return;
      const key = r.dataset.setRange;
      const it = specItem(key);
      previewSetting(key, Number(r.value));
      const out = document.querySelector('[data-set-val="' + key + '"]');
      if (out) out.textContent = settingValueLabel(it, Number(r.value));
    });

    // 文本类输入：即时反馈（改字就刷新标题 / rail），change 时统一落盘
    document.addEventListener("input", (e) => {
      const r = e.target;
      if (!r.dataset || !r.dataset.setText) return;
      if (!SETTINGS) SETTINGS = loadSettings();
      SETTINGS[r.dataset.setText] = r.value;
      applyVisualSettings();
    });

    // 落盘：range / select / text 都在 change 时做完整应用
    document.addEventListener("change", (e) => {
      const r = e.target;
      if (!r.dataset) return;
      if (r.dataset.setRange) setCfg(r.dataset.setRange, Number(r.value));
      else if (r.dataset.setSelect) setCfg(r.dataset.setSelect, r.value);
      else if (r.dataset.setText) setCfg(r.dataset.setText, r.value);
    });
  }

  /**
   * Ctrl/⌘ + ,（和 VS Code / macOS 的「设置」一致）开关面板；
   * Esc 先关面板 —— 注册在 window 捕获阶段，所以比灯箱挂在 document 上的
   * Esc 处理更早，面板开着时不会顺手把灯箱也关了。
   */
  function bindSettingsKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && settingsOpen()) {
        e.preventDefault();
        e.stopPropagation();
        closeSettings();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        e.stopPropagation();
        toggleSettings();
      }
    }, true);
  }

  /* ============================== 编排与 SPA ============================== */

  /** 跟随 linux.do 明暗配色：dark-scheme / light-scheme class，缺省按 body 底色亮度兜底；用户可在设置面板里手动覆盖 */
  function themeOverride() {
    const v = cfg("theme");
    return v === "light" || v === "dark" ? v : null;
  }

  function isDarkMode() {
    const want = themeOverride();
    if (want) return want === "dark";
    const cl = document.documentElement.classList;
    if (cl.contains("light-scheme")) return false;
    if (cl.contains("dark-scheme")) return true;
    try {
      const bg = getComputedStyle(document.body || document.documentElement).backgroundColor;
      const m = bg.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/);
      if (!m) return true;
      const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (alpha < 0.5) return true; // 半透明判不出来时维持深色
      const lum = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
      return lum < 128;
    } catch {
      return true;
    }
  }

  function syncCxMode() {
    document.documentElement.classList.toggle("codex-light", !isDarkMode());
  }

  /** 左下角明暗切换按钮：深色显示太阳（点击转亮），浅色显示月亮 */
  function syncModeBtn() {
    const btn = document.querySelector(".codex-rail [data-mode-toggle]");
    if (!btn) return;
    const dark = isDarkMode();
    btn.innerHTML = dark ? ICONS.sun : ICONS.moon;
    btn.title = dark ? "切换到光明模式" : "切换到黑暗模式";
  }

  function removeApp() {
    closeNotifMenu();
    // 只拆「自己画的」节点：.codex-rail / .codex-main / .cx-modal 这些 class 名
    // 另一份 Codex 主题脚本也在用，让位（otherThemeActive）时把别人的 UI 删掉
    // 就过分了 —— 认领标记 OWNER_ATTR 就是为这个存在的。
    for (const sel of [".codex-main", ".codex-rail", ".cx-modal", ".ldx-boss", ".ldx-imgpreview"]) {
      document.querySelectorAll(sel).forEach((node) => {
        if (node.getAttribute(OWNER_ATTR) === OWNER_ID) node.remove();
      });
    }
    hideImgPreview();
    imgPreviewEl = null;
    document.documentElement.classList.remove(BOSS_CLASS);
  }

  /** 低频率轮询 CF 盾状态：命中回退原皮，通过恢复套皮（与 applyTheme 的即时判断互补） */
  function startCfWatcher() {
    if (window.__codexCfWatch) return;
    window.__codexCfWatch = setInterval(() => {
      const blocked = cfBlocked();
      const active = document.documentElement.classList.contains(ROOT_CLASS);
      if (blocked && active) {
        document.documentElement.classList.remove(ROOT_CLASS, LOCK_CLASS, "codex-topic-open", "codex-rail-open");
        removeApp();
      } else if (!blocked && !active && !otherThemeActive()) {
        applyTheme();
      }
    }, 1500);
  }

  function applyTheme() {
    if (cfBlocked()) {
      // 整页被 CF 挑战拦截：停用回原皮（不注入 UI），挑战通过后 watcher 复检自动恢复
      document.documentElement.classList.remove(ROOT_CLASS, LOCK_CLASS, "codex-topic-open", "codex-rail-open");
      removeApp();
      return;
    }
    if (otherThemeActive()) {
      // 飞书 / IDEA 主题在跑：全程避让，恢复原样
      document.documentElement.classList.remove(ROOT_CLASS, LOCK_CLASS, "codex-topic-open", "codex-rail-open");
      removeApp();
      return;
    }

    // 这一趟是「从没接管 → 接管」吗？只有这种时刻才需要把设置整体重放一次。
    // 不能每次 applyTheme 都跑 applyVisualSettings：它会把三栏宽度变量按
    // localStorage 里**已落盘**的值重写，而拖拽期间的值还没落盘 ——
    // 表现在用户那边就是「拖的时候不变，松手才跳一下」（Discourse 的 SPA
    // 在拖拽期间会不断产生 DOM 变动 → MutationObserver → scheduleApply → applyTheme）。
    const takingOver = !document.documentElement.classList.contains(ROOT_CLASS);
    injectStyle();
    syncCxMode();
    document.documentElement.classList.add(ROOT_CLASS);
    if (takingOver) {
      // 让位期间 bootstrap 跳过了 applyVisualSettings（见那里的注释），
      // 真正接管时在这里补一次：三栏宽度 / 主题 / 不透明度 / 面板显隐 / 标题与品牌名
      applyVisualSettings();
    }
    makeFavicon();
    applySplash();
    if (!document.body) return;

    const pathname = location.pathname;
    const isTopic = isTopicPath(pathname);
    const isHome = isHomePath(pathname);
    const supported = isTopic || isHome;

    document.documentElement.classList.toggle(LOCK_CLASS, supported);
    document.documentElement.classList.toggle("codex-topic-open", isTopic);

    ensureRail();
    bindRailClicks();

    if (!supported) {
      // 非列表/帖子路由（设置、消息、搜索等）：rail 常驻，主区交还原生页面
      ownMain()?.remove();
      renderRailDynamic();
      return;
    }

    ensureMain();
    bindRailClicks();

    if (isTopic) {
      showView("detail");
      // 进帖子：保留当前列表，仅详情区加载（列表为空则后台补一份 latest 供 rail 分组用）
      if (listState.topics.length && listState.apiPath) {
        renderListRows();
      } else {
        loadList(listState.apiPath || "/latest.json", false);
      }
      loadTopic(topicIdFromPath(pathname));
    } else {
      showView("list");
      // 路由换了列表类型 → 重置缓存键强制重拉
      const apiPath = listApiForPath(pathname);
      if (listState.apiPath && listState.apiPath !== apiPath && listState.path !== pathname) {
        listState.topics = [];
      }
      loadList(apiPath, false);
    }
    syncChrome();
    syncRail();
  }

  let scheduled = false;
  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyTheme();
    });
  }

  function bootstrap() {
    if (!document.documentElement) {
      setTimeout(bootstrap, 0);
      return;
    }
    startCfWatcher(); // 无论当前是否被 CF 拦截，都先挂上恢复/回退轮询

    /*
     * 两件事都要等 CF 判定之后再做：
     *
     *   1. **整页正在 CF 挑战时什么都不做** —— 不注入样式、不加 ROOT_CLASS、
     *      不换 favicon、不写 CSS 变量、**不改伪装标题**（挑战页的 "Just a moment..."
     *      是它自己的，改成源码文件名既没意义又误导）。挑战通过后 startCfWatcher
     *      会调 applyTheme() 把一切补上。
     *   2. 让位时（飞书 / IDEA / 旧的 linuxdo.user.js 在跑）同样不做：这些动作都是
     *      全局副作用，做了就会踩到对方那套 UI 的头上（比如把对方的标签页标题
     *      改成 "lib.rs — platform"、或用自己的 .cx-* 规则盖掉对方的样式）。
     *
     * 出网则统一由 cfGate()（见 api/apiSend）把关：挑战期间一个请求都不发。
     */
    if (!otherThemeActive() && !cfBlocked()) {
      injectStyle();
      syncCxMode();
      document.documentElement.classList.add(ROOT_CLASS);
      makeFavicon(); // document-start 尽早换标，减少未聚焦标签仍显示原 icon
      applyVisualSettings(); // 恢复用户设置：三栏宽度 / 主题 / 页面不透明度 / 面板显隐…
    }

    // 标签重新可见时再刷一次（部分浏览器未聚焦时会缓存旧 favicon）
    if (!window.__codexFaviconVisibilityBound) {
      window.__codexFaviconVisibilityBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && !otherThemeActive()) {
          makeFavicon();
        }
      });
    }

    const CODEX_UI_SEL =
      ".codex-rail, .codex-main, #linuxdo-codex-theme, .codex-user-menu-float, " +
      ".cx-modal, .ldx-boss, .ldx-imgpreview, " +
      "#reply-control, .codex-unlock-header, #codex-unlock-header, #codex-temp-reply-click, #codex-unlock-for-reply";
    let cleanupDone = false;
    const observer = new MutationObserver((mutations) => {
      // 其它主题脚本激活 → 立刻避让（持续观察 html class / style 节点）
      if (otherThemeActive()) {
        if (!cleanupDone) {
          cleanupDone = true;
          scheduleApply();
          setTimeout(() => { cleanupDone = false; }, 300);
        }
        return;
      }
      // 忽略我们自己 UI 内部的 DOM 变动，否则渲染会触发 applyTheme 死循环；
      // class 属性变动只关心 <html> 本身（互斥标记 / 抽屉开关），子树里的 class 翻转不触发
      const external = mutations.some((m) => {
        const t = m.target;
        if (!(t instanceof Element) && !(t instanceof CharacterData)) return true;
        const el = t instanceof Element ? t : t.parentElement;
        if (!el) return true;
        if (m.type === "attributes" && el !== document.documentElement) return false;
        if (el.closest(CODEX_UI_SEL)) return false;
        return true;
      });
      if (external) scheduleApply();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });

    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        scheduleApply();
        return result;
      };
    }
    window.addEventListener("popstate", scheduleApply);
    window.addEventListener("hashchange", scheduleApply);
    document.addEventListener("DOMContentLoaded", scheduleApply, { once: true });
    document.addEventListener("turbo:load", scheduleApply);
    document.addEventListener("page:changed", scheduleApply);

    // 定时同步铃铛蓝点 / 用户名（currentUser 未读数会变）
    if (!window.__codexNotifBadgeTimer) {
      window.__codexNotifBadgeTimer = setInterval(() => {
        if (otherThemeActive()) return;
        if (!document.querySelector(".codex-rail")) return;
        syncRail();
      }, 15000);
    }

    // 点击原生回复面板以外区域自动收起
    bindOutsideCloseComposer();

    // 阅读进度上报（自渲染流按可见楼层累计，刷新未读计数）
    startReadTracking();

    // 设置面板：绑定入口 / 控件事件与 Ctrl+,（面板本身懒建，首次打开才进 DOM）
    // bindStealthKeys 先注册：Esc 关设置面板这件事由它负责，避免同一次 Esc
    // 先被它记成「第一下」、紧接着第二下误开伪装
    bindStealthKeys();
    bindSettingsPanel();
    bindSettingsKeys();

    // 伪装模式里的侧边栏模式：控制器一直挂着，是否动手由 cfg() 在鼠标事件那一刻决定
    sidebarAutoHide = createSidebarAutoHide({ host: window, document: document });
    sidebarAutoHide.start();

    // 正文图片：悬浮大图预览（缩略图尺寸由 CSS 变量控制）
    bindImgPreview();

    // ⌘/Ctrl+K → 原生搜索
    window.addEventListener("keydown", (e) => {      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if ((e.key || "").toLowerCase() !== "k") return;
      if (otherThemeActive()) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      e.preventDefault();
      e.stopPropagation();
      openNativeSearch();
    }, true);

    scheduleApply();
  }

  bootstrap();
})();
