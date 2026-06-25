// 公開URL（または file://）をスマホ相当のビューポート＋タッチ有効で開き、
// レイアウト崩れがないか（Dパッド表示・盤面サイズ）を確認してスクショ保存する。
// 実行: node tools/shot-mobile.mjs [url] [levelIndex]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const URL_ARG = process.argv[2] || "https://katoharu0.github.io/lumibox/";
const LEVEL = Number(process.argv[3] ?? 5);
const PORT = 9344;
const SHOT_DIR = path.join(ROOT, "_shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
  "--hide-scrollbars", "--mute-audio", `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });

let ws, msgId = 0; const pending = new Map();
function send(method, params = {}) {
  const id = ++msgId; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => { pending.set(id, { res, rej }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("timeout " + method)); } }, 15000); });
}
const evalJS = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

async function main() {
  let target;
  for (let i = 0; i < 40; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = list.find(t => t.type === "page"); if (target) break; } catch (e) {}
    await sleep(150);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };

  await send("Page.enable"); await send("Runtime.enable");
  // iPhone 13 相当 + タッチ有効（これで body.touch が付き Dパッドが出る）
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: URL_ARG });
  await sleep(2000);

  const touch = await evalJS(`document.body.classList.contains("touch")`);
  const padShown = await evalJS(`getComputedStyle(document.getElementById("pad")).display !== "none"`);
  await evalJS(`loadLevel(${LEVEL}); hideOverlay("menuOverlay"); true`);
  await sleep(600);
  const info = await evalJS(`(function(){return {cell:cell, cols:cols, rows:rows, boardW:cell*cols, stageW:document.getElementById("stage").clientWidth, stageH:document.getElementById("stage").clientHeight};})()`);
  console.log("touchクラス:", touch, "/ Dパッド表示:", padShown);
  console.log("盤面:", JSON.stringify(info));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOT_DIR, "mobile.png"), Buffer.from(shot.data, "base64"));
  console.log("スクショ: _shots/mobile.png");
  const ok = touch && padShown && info.boardW <= info.stageW;
  console.log(ok ? "🎉 モバイル表示OK" : "⚠️ レイアウト要確認");
  try { ws.close(); } catch (e) {} chrome.kill("SIGKILL"); setTimeout(() => process.exit(ok ? 0 : 1), 200);
}
main().catch(e => { console.error("失敗:", e.message); chrome.kill("SIGKILL"); process.exit(1); });
