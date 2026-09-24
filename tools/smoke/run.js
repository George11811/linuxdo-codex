/*
 * 用本机 Chrome/Edge 的 headless + CDP 跑一次真实浏览器冒烟测试。
 *
 *   node tools/smoke/run.js
 *
 * 它做三件事：
 *   1. 起 tools/smoke/stub-server.js（假的 linux.do：外壳 HTML + Discourse JSON 端点）
 *   2. 用 --headless=new 打开 http://127.0.0.1:<port>/，页面里 <script src> 加载被测脚本
 *   3. 通过 CDP 在页面里跑 probe.js / probe-foreign.js 的断言，收集异常与 console.error
 *
 * 退出码 0 = 全部通过；1 = 有断言失败或页面异常。
 */
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

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

    const pad = (s, n) => String(s).padEnd(n);
    console.log("\n=== linuxdo-codex 冒烟测试 ===");
    let failed = 0;
    for (const r of [...results, ...results2]) {
      if (!r.pass) failed++;
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${pad(r.name, 42)} ${r.detail}`);
    }
    const total = results.length + results2.length;
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
