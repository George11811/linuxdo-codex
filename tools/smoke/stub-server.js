/*
 * 冒烟测试用的假 linux.do（Discourse）服务端。
 *
 * 正常端点：
 *   /                      Discourse 外壳 HTML（#data-preloaded / #main-outlet / meta csrf）
 *   /t/12345               同一个外壳（脚本按 pathname 判定路由，服务端返回什么壳都行）
 *   /latest.json 等        topic_list.topics
 *   /categories.json       category_list.categories
 *   /t/12345.json          详情（post_stream.posts，含一张图片，验证缩略图/悬浮预览）
 *   /linuxdo-codex.user.js 被测脚本本身
 *
 * 测试用控制端点（只有冒烟测试会调）：
 *   /__ctl/stats           每个路径被请求了几次（用来断言「被 CF 拦时不要重试刷请求」）
 *   /__ctl/block?on=1|0    打开后所有 .json 端点返回 403 + cf-mitigated: challenge（模拟 CF 拦截）
 *   /__ctl/failnext?n=1    接下来 n 个 .json 请求回 500（用来验证「一次重试」）
 *   /__ctl/reset           清零计数与控制开关
 *
 * 用法：node tools/smoke/stub-server.js [port]
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(ROOT, "linuxdo-codex.user.js");
const PORT = Number(process.argv[2] || 8791);

/** 现造一张 400×300 的 PNG（脚本会把 ≤300×200 的图标成 no-preview，测试需要真大图） */
function makePng(w, h) {
  const crc32 = zlib.crc32 || ((buf) => {
    let c, crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = (crc ^ buf[i]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = (x * 255 / w) | 0;
      raw[off + 2 + x * 3] = (y * 255 / h) | 0;
      raw[off + 3 + x * 3] = 90;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const CATEGORIES = [
  { id: 4, name: "开发调优", slug: "develop", color: "0088CC", topic_count: 120, description_text: "代码与工程实践" },
  { id: 12, name: "资源荟萃", slug: "resource", color: "AB9364", topic_count: 80, description_text: "资源分享" },
  { id: 14, name: "搞七捻三", slug: "chat", color: "9EB83B", topic_count: 60, description_text: "闲聊" }
];

const TOPICS = [
  ["如何优雅地在 Discourse 里做皮肤接管", 4, "alice", 42],
  ["自建 RSS 阅读器的三年后复盘", 4, "bob", 17],
  ["[求助] Chrome 扩展的 contenteditable 光标定位", 4, "carol", 9],
  ["分享一个终端配色方案", 12, "dave", 3],
  ["你们公司的 CI 跑多久", 14, "erin", 88],
  ["用 Rust 重写抓取器的收益与代价", 4, "frank", 25],
  ["显示器 4K 60Hz 还是 2K 144Hz", 14, "grace", 120],
  ["自建 NAS 的功耗实测", 12, "heidi", 31],
  ["TypeScript 5.x 里的 satisfies 到底该怎么用", 4, "ivan", 11],
  ["周末爬山的路线推荐", 14, "judy", 5],
  ["Kubernetes 单节点集群踩坑记录", 4, "karl", 64],
  ["手机端 Linux 桌面环境的可行方案", 4, "leo", 27]
].map(([title, category_id, last_poster_username, posts_count], i) => ({
  id: 1000 + i,
  title,
  fancy_title: title,
  slug: "topic-" + (1000 + i),
  posts_count,
  reply_count: posts_count - 1,
  views: 100 + i * 37,
  like_count: i * 2,
  category_id,
  pinned: i === 0,
  closed: false,
  archived: false,
  created_at: new Date(Date.now() - (i + 1) * 3600e3).toISOString(),
  last_posted_at: new Date(Date.now() - i * 900e3).toISOString(),
  last_activity_at: new Date(Date.now() - i * 900e3).toISOString(),
  last_poster_username,
  excerpt: "这是一段刻意写得很长的列表摘要，用来验证副行只显示前六十个字，而完整摘要会出现在鼠标悬停提示里，跟前端原生列表的行为保持一致。",
  unread: i % 4 === 0 ? 3 : 0,
  new_posts: 0,
  unseen: false,
  has_accepted_answer: false,
  posters: [{ user_id: 1 + i, description: "Original Poster" }]
}));

/** 页面内预加载的话题列表：标题带「预加载」标记，便于断言用的是哪一份数据 */
const PRELOAD_TOPICS = TOPICS.slice(0, 4).map((t, i) => Object.assign({}, t, {
  id: 2000 + i,
  title: "预加载·" + t.title,
  slug: "preloaded-" + (2000 + i)
}));

const TOPIC = {
  id: 12345,
  title: "冒烟测试：这条帖子用来验证详情视图与正文图片",
  fancy_title: "冒烟测试：这条帖子用来验证详情视图与正文图片",
  slug: "smoke-topic",
  posts_count: 4,
  views: 777,
  like_count: 12,
  category_id: 4,
  created_at: new Date(Date.now() - 7200e3).toISOString(),
  post_stream: {
    stream: [90001, 90002, 90003, 90004],
    posts: [
      {
        id: 90001,
        post_number: 1,
        username: "alice",
        name: "Alice",
        created_at: new Date(Date.now() - 7200e3).toISOString(),
        updated_at: new Date(Date.now() - 7200e3).toISOString(),
        cooked:
          "<p>楼主正文，先放一张大图验证缩略图与悬浮预览：</p>" +
          '<p><img src="/uploads/default/original/1X/photo.png" alt="photo" width="1200" height="800"></p>' +
          "<p>再来一段代码：</p><pre><code class=\"lang-js\">const a = 1;</code></pre>",
        like_count: 3
      },
      {
        id: 90002,
        post_number: 2,
        username: "bob",
        name: "Bob",
        created_at: new Date(Date.now() - 3600e3).toISOString(),
        cooked: "<p>二楼来帮顶，顺便引用一下：</p>" +
          '<aside class="quote" data-post="1" data-topic="12345"><div class="title">alice:</div><blockquote><p>楼主正文</p></blockquote></aside>' +
          "<p>我的看法是先把数据流切过去。</p>",
        like_count: 1
      },
      {
        id: 90003,
        post_number: 3,
        username: "carol",
        name: "Carol",
        created_at: new Date(Date.now() - 1800e3).toISOString(),
        cooked: "<p>+1，另外 <code>getComputedStyle</code> 那个坑我也踩过。</p>",
        like_count: 0
      },
      {
        id: 90004,
        post_number: 4,
        username: "dave",
        name: "Dave",
        created_at: new Date(Date.now() - 600e3).toISOString(),
        cooked: "<p>冒烟测试结束。</p>",
        like_count: 0
      }
    ]
  }
};

/** 预加载里的详情副本：标题带标记，用来断言「接口被拦时用的是页面内数据」 */
const PRELOAD_TOPIC = Object.assign({}, TOPIC, { title: TOPIC.title + "（预加载）" });

/** Discourse 风格的原生话题列表（DOM 兜底路径要解析它） */
const NATIVE_LIST_HTML = `
<table class="topic-list">
  <tbody>
    <tr class="topic-list-item category-develop" data-topic-id="3001">
      <td class="topic-list-data main-link">
        <a class="title raw-link raw-topic-link" href="/t/native-one/3001">原生列表·第一条</a>
      </td>
      <td class="topic-list-data posts">7</td>
      <td class="topic-list-data views">188</td>
      <td class="topic-list-data activity"><span class="relative-date" title="2026-10-14T10:00:00.000Z">1 小时前</span></td>
    </tr>
    <tr class="topic-list-item unread pinned category-chat" data-topic-id="3002">
      <td class="topic-list-data main-link">
        <a class="title raw-link raw-topic-link" href="/t/native-two/3002">原生列表·第二条（置顶未读）</a>
      </td>
      <td class="topic-list-data posts">23</td>
      <td class="topic-list-data views">904</td>
      <td class="topic-list-data activity"><span class="relative-date" title="2026-10-14T08:30:00.000Z">2 小时前</span></td>
    </tr>
    <tr class="topic-list-item category-resource" data-topic-id="3003">
      <td class="topic-list-data main-link">
        <a class="title raw-link raw-topic-link" href="/t/native-three/3003">原生列表·第三条</a>
      </td>
      <td class="topic-list-data posts">2</td>
      <td class="topic-list-data views">31</td>
      <td class="topic-list-data activity"><span class="relative-date" title="2026-10-14T07:00:00.000Z">3 小时前</span></td>
    </tr>
  </tbody>
</table>`;

const PRELOAD_MAP = {
  currentUser: JSON.stringify({ username: "tester", id: 7 }),
  site: JSON.stringify({ categories: CATEGORIES }),
  topicList_latest: JSON.stringify({ topic_list: { can_create_topic: true, per_page: 30, topics: PRELOAD_TOPICS, more_topics_url: null } }),
  topic_12345: JSON.stringify(PRELOAD_TOPIC)
};

/** 外壳 HTML。opts.nativeList = 在 #main-outlet 里摆一份原生话题列表；opts.preload = 覆盖预加载表 */
function page(opts) {
  const o = opts || {};
  const preload = o.preload || PRELOAD_MAP;
  const preloadAttr = JSON.stringify(preload).replace(/'/g, "&#39;");
  return `<!doctype html>
<html class="dark-scheme">
<head>
<meta charset="utf-8">
<title>Linux DO</title>
<meta name="csrf-token" content="smoke-csrf-token">
<link rel="icon" href="/favicon.ico">
<script id="data-preloaded" data-preloaded='${preloadAttr}'></script>
</head>
<body>
<div id="d-splash"><div class="splash-logo-container"></div></div>
<header class="d-header"><div class="wrap"><div class="contents">
  <ul class="icons">
    <li class="search-dropdown"><button id="search-button" class="btn">search</button></li>
    <li class="current-user"><a href="/u/tester" class="icon">tester</a></li>
  </ul>
</div></div></header>
<div id="main-outlet-wrapper" class="wrap">
  <!-- Discourse 的原生侧边栏：和 #main-outlet 平级，且自己没有背景色。
       脚本必须把它整条隐藏，否则那些导航文字会压在自绘 rail 上。 -->
  <div class="sidebar-wrapper">
    <div id="d-sidebar" class="sidebar-container">
      <span>Topics</span><span>Upcoming events</span>
      <div class="sidebar-footer-wrapper"><span>All categories</span><span>Default</span></div>
    </div>
  </div>
  <div id="main-outlet" class="wrap"><div id="main-outlet-inner">
    <p>原生内容（被锁定路由时应隐藏）</p>
    ${o.nativeList ? NATIVE_LIST_HTML : ""}
  </div></div>
</div>
<div id="reply-control" class="reply-area closed"><textarea></textarea></div>
<script src="/linuxdo-codex.user.js"></script>
</body>
</html>`;
}

/*
 * 「另一份 Codex 主题脚本已经接管」的页面：body 里先摆一套不带归属标记的
 * .codex-rail / .codex-main / .cx-modal（= 旧版 linuxdo.user.js 画的），
 * 再加载本脚本。本脚本必须让位：不加 ROOT_CLASS、不再画第二套 UI。
 */
const FOREIGN_PAGE = page().replace(
  '<div id="reply-control"',
  '<aside class="codex-rail" id="foreign-rail"><div class="codex-rail-brand-name">旧的 Linux DO 皮肤</div></aside>\n' +
  '<main class="codex-main" id="foreign-main"><div class="codex-thread-inner">旧的皮肤主区</div></main>\n' +
  '<div class="cx-modal" id="foreign-modal" hidden><div class="cx-modal-card">旧的设置面板</div></div>\n' +
  '<div id="reply-control"'
);

/*
 * Cloudflare 挑战页：整页都是 CF 的中间页（`@match` 仍会命中，所以脚本确实会在
 * 这上面跑）。脚本必须彻底安静：不注入 UI、不改标题、不换 favicon、一个请求都不发。
 */
const CHALLENGE_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Just a moment...</title>
<link rel="icon" href="/favicon.ico">
</head>
<body class="no-js">
<div id="challenge-running" class="main-wrapper" role="main">
  <h1>Verifying you are human</h1>
  <p>This may take a few seconds…</p>
  <form id="challenge-form" action="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1" method="POST">
    <input type="hidden" id="cf-chl-widget-abc123_response" name="cf-turnstile-response" value="">
  </form>
</div>
<script src="/linuxdo-codex.user.js"></script>
</body>
</html>`;

/* ---- 测试控制状态 ---- */
const ctl = { blockJson: false, failNext: 0 };
const stats = { counts: Object.create(null), total: 0, retries: 0 };

function sendJson(res, obj, code, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code || 200, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  }, extraHeaders || {}));
  res.end(body);
}

function sendHtml(res, html, code, extraHeaders) {
  const body = Buffer.from(html);
  res.writeHead(code || 200, Object.assign({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length
  }, extraHeaders || {}));
  res.end(body);
}

/** 模拟 Cloudflare 的挑战响应：403 + cf-mitigated + HTML 正文 */
function sendCfChallenge(res) {
  sendHtml(res, "<html><body>Just a moment...</body></html>", 403, { "cf-mitigated": "challenge", server: "cloudflare" });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;
  stats.counts[p] = (stats.counts[p] || 0) + 1;
  stats.total++;
  // 带 _cx_retry 的请求 = 脚本的重试请求（用来断言「CF 拦下来时没有重试」）
  if (url.searchParams.has("_cx_retry")) stats.retries++;

  /* ---- 测试控制端点 ---- */
  if (p === "/__ctl/stats") return sendJson(res, { counts: stats.counts, total: stats.total, retries: stats.retries, ctl });
  if (p === "/__ctl/block") {
    ctl.blockJson = url.searchParams.get("on") === "1";
    return sendJson(res, { blockJson: ctl.blockJson });
  }
  if (p === "/__ctl/failnext") {
    ctl.failNext = Number(url.searchParams.get("n") || 1);
    return sendJson(res, { failNext: ctl.failNext });
  }
  if (p === "/__ctl/reset") {
    // ?block=1 = 只清计数，保留当前的拦截开关（第三阶段要在「已拦截」状态下开新页面）
    if (url.searchParams.get("block") !== "1") ctl.blockJson = false;
    ctl.failNext = 0;
    stats.counts = Object.create(null);
    stats.total = 0;
    stats.retries = 0;
    return sendJson(res, { ok: true, blockJson: ctl.blockJson });
  }

  if (p === "/linuxdo-codex.user.js") {
    const body = fs.readFileSync(SCRIPT_PATH);
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Content-Length": body.length });
    return res.end(body);
  }

  // 「接下来 n 个 JSON 请求失败」（验证重试：第一次 500、retry 拿到 200）
  if (/\.json$/.test(p) && ctl.failNext > 0) {
    ctl.failNext--;
    return sendJson(res, { errors: ["simulated server error"] }, 500);
  }
  // CF 拦截模式：JSON 端点全部 403 挑战页
  if (/\.json$/.test(p) && ctl.blockJson) {
    return sendCfChallenge(res);
  }

  if (p === "/latest.json" || p === "/top.json" || p === "/hot.json" || p === "/new.json" ||
    p === "/unseen.json" || p === "/posted.json" || p === "/read.json" || p === "/bookmarks.json") {
    return sendJson(res, {
      users: [],
      topic_list: { can_create_topic: true, per_page: 30, topics: TOPICS, more_topics_url: null }
    });
  }

  if (p === "/categories.json") {
    return sendJson(res, { category_list: { categories: CATEGORIES } });
  }

  if (p === "/t/12345.json") {
    return sendJson(res, TOPIC);
  }

  if (/^\/t\/12345\/posts\.json$/.test(p)) {
    return sendJson(res, { post_stream: { stream: TOPIC.post_stream.stream, posts: TOPIC.post_stream.posts } });
  }

  if (p === "/favicon.ico") {
    res.writeHead(200, { "Content-Type": "image/x-icon" });
    return res.end("");
  }

  // 正文里那张图（400×300，够大所以会走缩略图 + 悬浮预览）
  if (p.startsWith("/uploads/")) {
    const body = makePng(400, 300);
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": body.length });
    return res.end(body);
  }

  // 站点的其它 JSON（通知 / 阅读进度等）：给个空对象，别让脚本卡在 404 上
  if (/\.json$/.test(p)) return sendJson(res, {});

  // 「另一份 Codex 主题已接管」的页面：本脚本应当让位
  if (p === "/foreign") return sendHtml(res, FOREIGN_PAGE);

  // CF 挑战中间页：脚本必须完全不动作（见 CHALLENGE_PAGE 注释）
  if (p === "/challenge") return sendHtml(res, CHALLENGE_PAGE);

  // /scrape：预加载里没有列表数据，但原生 DOM 里有 —— 用来测 DOM 兜底
  if (p === "/scrape") {
    const map = Object.assign({}, PRELOAD_MAP);
    delete map.topicList_latest;
    return sendHtml(res, page({ nativeList: true, preload: map }));
  }

  if (p === "/" || /^\/t\/\d+/.test(p) || /^\/(latest|new|top|hot|unread|c\/|tag\/)/.test(p)) {
    return sendHtml(res, page());
  }

  return sendHtml(res, page());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`stub linux.do listening on http://127.0.0.1:${PORT}`);
});
