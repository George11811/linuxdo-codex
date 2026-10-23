/*
 * 用本机 Chrome/Edge 的 headless + CDP 跑一次真实浏览器冒烟测试。
 *
 *   node tools/smoke/run.js
 *
 * 它做三件事：
 *   1. 起 tools/smoke/stub-server.js（假的 linux.do：外壳 HTML + Discourse JSON 端点）
 *   2. 用 --headless=new 打开 http://127.0.0.1:<port>/，页面里 <script src> 加载被测脚本
 *   3. 通过 CDP 在页面里跑 probe*.js 的断言，收集异常与 console.error
 *
 * 六个阶段：正常接管 → 给别的主题让位 → 整站 JSON 被 CF 拦 → 整页是 CF 挑战页
 *          → 页面不透明度（黑夜）→ 页面不透明度（浅色）
 * 最后两个阶段的收官断言读**截图像素**（见 sampleRegion）：只有它能证明「合成之后
 * 颜色是对的」，DOM 全绿但画面泛灰白正是这次要防的回归。
 *
 * 退出码 0 = 全部通过；1 = 有断言失败或页面异常。
 */
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");

const PORT = Number(process.env.SMOKE_PORT || 8791);
/*
 * CDP 端口每次随机：上一轮如果没被干净地杀掉（Chrome 会 fork 出独立进程，
 * child.kill() 只杀启动器），固定端口会让这一轮连上「上一轮那个浏览器里的旧页面」，
 * 测出来的是带旧 localStorage / 旧路由的僵尸状态，排查起来极其误导。
 */
const CDP_PORT = Number(process.env.SMOKE_CDP_PORT || (9400 + Math.floor(Math.random() * 500)));
const URL = `http://127.0.0.1:${PORT}/`;

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[smoke]", ...a);

/** 所有网络等待都必须带超时：否则一旦 Chrome 没起来 / 端口被占，脚本会静默挂死 */
async function withTimeout(promise, ms, what) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout: " + what)), ms); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function pickBrowser() {
  for (const c of CHROME_CANDIDATES) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  throw new Error("找不到 Chrome / Edge，可用 CHROME 环境变量指定路径");
}

/** 极简 CDP 客户端：够用就行（send + 事件订阅） */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const cb of this.listeners.get(msg.method) || []) cb(msg.params);
      }
    });
  }
  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(cb);
  }
  send(method, params, timeoutMs) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP timeout: " + method));
      }, timeoutMs || 15000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const list = await withTimeout(
        fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json()),
        2000, "query CDP targets"
      );
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (err) { lastErr = err.message; }
    await sleep(150);
  }
  throw new Error("等不到调试目标（CDP 端口没起来）：" + lastErr);
}

async function evaluate(cdp, source) {
  return cdp.send("Runtime.evaluate", {
    expression: source,
    awaitPromise: true,
    returnByValue: true
  }, 180000);
}

/*
 * 极简 PNG 解码：只认 Chrome 截图会给出的 8bit / 非隔行格式（RGB / RGBA / 灰度）。
 * 为什么要它：有些问题是**合成之后才存在**的 —— 比如「页面层半透明时透出了
 * 底下的浅色原生页，整页泛灰白」。DOM 里每个元素的样式都正常，只有真正画出来的
 * 像素错了。所以这一处必须读截图，而不是读 getComputedStyle。
 * 只为一个取样点引依赖不值，索性自己解 ZLIB + PNG 那四行 filter。
 */
function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error("不是 PNG");
  }
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (!ihdr) throw new Error("PNG 缺 IHDR");
  if (ihdr.depth !== 8 || ihdr.interlace !== 0) throw new Error("不支持的 PNG 编码：" + JSON.stringify(ihdr));
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
  if (!channels) throw new Error("不支持的 PNG 色彩类型：" + ihdr.colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const out = Buffer.alloc(stride * ihdr.height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;   // 左
      const b = prev[i];                                 // 上
      const c = i >= channels ? prev[i - channels] : 0;  // 左上
      let v = row[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  return { width: ihdr.width, height: ihdr.height, channels, data: out };
}

/** 对页面上某块区域截屏，返回平均 RGB —— 「实际画出来是什么颜色」的证据 */
async function sampleRegion(cdp, clip) {
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: clip.x, y: clip.y, width: clip.size, height: clip.size, scale: 1 },
    captureBeyondViewport: false
  }, 20000);
  const img = decodePng(Buffer.from(shot.data, "base64"));
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < img.data.length; i += img.channels) {
    r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), w: img.width, h: img.height };
}

/**
 * 页面不透明度那一阶段的流程：把设置写进 localStorage → 整页重载 →
 * 跑 probe-dim.js 量 DOM + 取一个取样点 → 截屏读像素，证明「调暗后还是主题底色」。
 */
async function runDimPhase(cdp, port, phase) {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const k = "linuxdo-codex:settings";
      let v = {};
      try { v = JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { v = {}; }
      v.theme = ${JSON.stringify(phase)};
      v.pageOpacity = 60;
      localStorage.setItem(k, JSON.stringify(v));
      return localStorage.getItem(k);
    })()`,
    returnByValue: true
  }, 5000);
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, 20000);
  await sleep(2600);
  const src = fs.readFileSync(path.join(__dirname, "probe-dim.js"), "utf8");
  const res = await evaluate(cdp, `(async () => {\nconst DIM_PHASE = ${JSON.stringify(phase)};\n${src}\n})()`);
  if (res.exceptionDetails) {
    return { exception: "不透明度阶段（" + phase + "）probe 抛错：" + JSON.stringify(res.exceptionDetails).slice(0, 800) };
  }
  const value = (res.result && res.result.value) || {};
  return {
    results: value.results || [],
    sample: value.sample,
    expect: value.expect,
    label: value.label || phase
  };
}

async function main() {
  const browser = pickBrowser();
  log("browser:", browser);
  const server = spawn(process.execPath, [path.join(__dirname, "stub-server.js"), String(PORT)], { stdio: "inherit" });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "linuxdo-smoke-"));
  log("cdp port:", CDP_PORT, "profile:", profile);
  const child = spawn(browser, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--window-size=1440,900",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    URL
  ], { stdio: "ignore" });
  child.on("error", (err) => log("浏览器启动失败：", err.message));
  child.on("exit", (code) => log("浏览器进程退出：", code));

  const pageErrors = [];
  const consoleErrors = [];
  let exitCode = 1;
  try {
    const target = await waitForTarget(25000);
    log("target:", target.url);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await withTimeout(new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    }), 10000, "websocket open");
    const cdp = new Cdp(ws);

    cdp.on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails || {};
      pageErrors.push(`${d.text || "exception"} ${(d.exception && (d.exception.description || d.exception.value)) || ""}`.trim());
    });
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error") {
        consoleErrors.push((p.args || []).map((a) => a.value || a.description || "").join(" "));
      }
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    log("runtime ready");

    // 等页面 + 脚本起来，并确认登场的是这一轮新开的 /（不是上一轮的僵尸页）
    let booted = false;
    for (let i = 0; i < 40; i++) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "location.pathname + '|' + !!document.querySelector('.codex-rail')",
        returnByValue: true
      }, 5000);
      const v = r.result && r.result.value;
      if (v === "/|true") { booted = true; break; }
      await sleep(250);
    }
    if (!booted) pageErrors.push("页面没能在 / 上完成启动（可能连到了残留的浏览器实例）");
    log("page booted, running assertions");

    const probe = fs.readFileSync(path.join(__dirname, "probe.js"), "utf8");
    const res = await evaluate(cdp, `(async () => {\n${probe}\n})()`);
    if (res.exceptionDetails) {
      pageErrors.push("probe 抛错：" + JSON.stringify(res.exceptionDetails).slice(0, 800));
    }
    const results = (res.result && res.result.value && res.result.value.results) || [];

    // 第二阶段：页面上已有别的 Codex 主题 UI → 本脚本应让位
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/foreign` }, 20000);
    await sleep(2500);
    const probe2 = fs.readFileSync(path.join(__dirname, "probe-foreign.js"), "utf8");
    const res2 = await evaluate(cdp, `(async () => {\n${probe2}\n})()`);
    if (res2.exceptionDetails) {
      pageErrors.push("让位阶段 probe 抛错：" + JSON.stringify(res2.exceptionDetails).slice(0, 800));
    }
    const results2 = (res2.result && res2.result.value && res2.result.value.results) || [];

    // 第三阶段：整站 JSON 都被 CF 拦（probe.js 结束时故意留着 block），
    // 全新加载一个帖子页，验证列表 + 详情都靠页面内预加载数据顶住。
    // reset?block=1 = 清请求计数但保留拦截开关，这样第三阶段的计数是干净的。
    await fetch(`http://127.0.0.1:${PORT}/__ctl/reset?block=1`);
    await fetch(`http://127.0.0.1:${PORT}/__ctl/block?on=1`);
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/t/12345` }, 20000);
    await sleep(3000);
    const probe3 = fs.readFileSync(path.join(__dirname, "probe-blocked.js"), "utf8");
    const res3 = await evaluate(cdp, `(async () => {\n${probe3}\n})()`);
    if (res3.exceptionDetails) {
      pageErrors.push("被拦阶段 probe 抛错：" + JSON.stringify(res3.exceptionDetails).slice(0, 800));
    }
    const results3 = (res3.result && res3.result.value && res3.result.value.results) || [];

    // 第四阶段：整页是 CF 挑战中间页 → 脚本必须彻底安静（不改标题、不换标、零请求）。
    // 先清计数并关掉「接口拦截」开关（这一阶段要验证的是「页面本身就是挑战页」）。
    await fetch(`http://127.0.0.1:${PORT}/__ctl/reset`);
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/challenge` }, 20000);
    await sleep(1500);
    const probe4 = fs.readFileSync(path.join(__dirname, "probe-challenge.js"), "utf8");
    const res4 = await evaluate(cdp, `(async () => {\n${probe4}\n})()`);
    if (res4.exceptionDetails) {
      pageErrors.push("挑战页阶段 probe 抛错：" + JSON.stringify(res4.exceptionDetails).slice(0, 800));
    }
    const results4 = (res4.result && res4.result.value && res4.result.value.results) || [];

    // 第五 / 第六阶段：页面不透明度（a. 黑夜、b. 浅色）。
    // 这一阶段的最后一条断言必须读截图像素：DOM 里一切正常，只有合成后的颜色是错的
    // （页面层半透明 → 透出底下浅色原生页 → 黑夜模式下整页泛灰白）。
    const resultsDim = [];
    for (const [phase, wantLight] of [["dark", false], ["light", true]]) {
      const dim = await runDimPhase(cdp, PORT, phase);
      if (dim.exception) { pageErrors.push(dim.exception); continue; }
      let px = null;
      try {
        px = await sampleRegion(cdp, dim.sample);
      } catch (err) {
        pageErrors.push("取样像素失败：" + err.message);
      }
      const expect = dim.expect || { r: -1, g: -1, b: -1 };
      const tol = 14; // 截图有过色彩管理，留一点余量
      const near = !!px &&
        Math.abs(px.r - expect.r) <= tol && Math.abs(px.g - expect.g) <= tol && Math.abs(px.b - expect.b) <= tol;
      const tone = !!px && (wantLight ? Math.min(px.r, px.g, px.b) > 200 : Math.max(px.r, px.g, px.b) < 70);
      resultsDim.push(...dim.results, {
        pass: near && tone,
        name: (dim.label || phase) + "：调暗后仍是主题底色（不是灰白）",
        detail: px
          ? `取样 ${px.w}×${px.h}px = rgb(${px.r}, ${px.g}, ${px.b})，期望 ≈ rgb(${expect.r}, ${expect.g}, ${expect.b})；旧实现会透出浅色原生页 ≈ rgb(116,116,116)`
          : "没取到像素"
      });
    }

    const pad = (s, n) => String(s).padEnd(n);
    console.log("\n=== linuxdo-codex 冒烟测试 ===");
    let failed = 0;
    for (const r of [...results, ...results2, ...results3, ...results4, ...resultsDim]) {
      if (!r.pass) failed++;
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${pad(r.name, 42)} ${r.detail}`);
    }
    const total = results.length + results2.length + results3.length + results4.length + resultsDim.length;
    console.log(`\n断言：${total - failed}/${total} 通过`);
    if (pageErrors.length) {
      console.log("\n--- 页面异常 ---");
      for (const e of pageErrors) console.log("  " + e);
    }
    if (consoleErrors.length) {
      console.log("\n--- console.error ---");
      for (const e of consoleErrors) console.log("  " + e);
    }
    exitCode = failed === 0 && pageErrors.length === 0 && total > 0 ? 0 : 1;
    cdp.close();
  } catch (err) {
    console.error("冒烟测试自身出错：", err);
    exitCode = 1;
  } finally {
    // Chrome 会 fork 出真正的浏览器进程：只 kill 启动器会留下僵尸，
    // 下一轮就可能连上去（所以上面用随机 CDP 端口 + 这里整棵树一起杀）
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    } catch { /* ignore */ }
    try { server.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(exitCode);
}

main();
