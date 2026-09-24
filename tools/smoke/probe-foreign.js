/*
 * 冒烟测试第二阶段：页面上已经有「另一份 Codex 主题脚本」画的 UI 时，本脚本必须让位。
 * 断言全部围绕「什么都没做」：不注入样式、不加标记、不画第二套 UI、不改标题/favicon、
 * 也不接管 / 重写对方那份 .cx-modal。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail === undefined ? "" : String(detail) });
const qa = (s) => Array.from(document.querySelectorAll(s));
const key = (k, extra) => window.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));

ok("对方脚本的 rail 没被删掉", !!document.getElementById("foreign-rail"));
ok("对方脚本的主区没被删掉", !!document.getElementById("foreign-main"));
ok("没有画出第二套 rail", qa(".codex-rail").length === 1, qa(".codex-rail").length);
ok("没有画出第二套主区", qa(".codex-main").length === 1, qa(".codex-main").length);
ok("没有加激活标记 codex-theme", !document.documentElement.classList.contains("codex-theme"));
ok("没有加锁定标记 codex-locked", !document.documentElement.classList.contains("codex-locked"));
ok("没有注入自己的样式表", !document.getElementById("linuxdo-codex-theme"));
ok("没有替换 favicon", !document.getElementById("codex-favicon"));
ok("没有改标签页标题", !/platform/.test(document.title), document.title);
ok("没有伪装视图", !document.querySelector(".ldx-boss"));
ok("没有写页面层 CSS 变量", !document.documentElement.style.getPropertyValue("--cx-rail-w"), document.documentElement.style.getPropertyValue("--cx-rail-w"));

/* 对方也有一份 .cx-modal：Ctrl+, 不能把它的内容洗掉 */
key(",", { ctrlKey: true });
await sleep(200);
const foreignModal = document.getElementById("foreign-modal");
ok("对方那份设置面板还在", !!foreignModal);
ok("没有覆盖对方的设置面板内容", !!foreignModal && /旧的设置面板/.test(foreignModal.innerHTML));
ok("没有多出一个自己的设置面板", qa(".cx-modal").length === 1, qa(".cx-modal").length);
ok("没有把归属标记打到对方的面板上", !foreignModal || !foreignModal.hasAttribute("data-cx-owner"));
ok("没有把对方的面板改成可见", !foreignModal || foreignModal.hidden === true, foreignModal ? String(foreignModal.hidden) : "n/a");

return { results: out };
