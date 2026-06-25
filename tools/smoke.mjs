// ヘッドレスChromeで index.html を実際に起動し、
//   ・JSエラー/例外が出ないか
//   ・ゲームが初期化されるか（LEVELS / PARS 読み込み）
//   ・各レベルを「ソルバの解の手順」でゲームの move() に流し、checkWin が true になるか
//   ・スクリーンショット保存
// を検証する。  実行: node tools/smoke.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { solve, loadLevels } from "./solver.mjs";

const CHROME = "/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const HTML = path.join(ROOT, "index.html");
const FILE_URL = "file://" + HTML;
const PORT = 9333;
const SHOT_DIR = path.join(ROOT, "_shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const LEVELS = loadLevels(HTML);

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
  "--hide-scrollbars", "--mute-audio", `--remote-debugging-port=${PORT}`,
  "--window-size=420,820", "about:blank",
], { stdio: "ignore" });

let ws, msgId = 0;
const pending = new Map();
const errors = [];

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("timeout " + method)); } }, 15000);
  });
}

async function evalJS(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { errors.push("eval例外: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return undefined; }
  return r.result.value;
}

async function main() {
  // 事前に各レベルの解の手順を計算
  const paths = LEVELS.map(def => solve(def));

  // ページターゲットの WebSocket URL を取得
  let target;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find(t => t.type === "page");
      if (target) break;
    } catch (e) {}
    await sleep(150);
  }
  if (!target) throw new Error("ページターゲットが見つからない");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown")
      errors.push("例外: " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      errors.push("console.error: " + m.params.args.map(a => a.value || a.description).join(" "));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: FILE_URL });
  await sleep(1500);

  const initOk = await evalJS(`(typeof LEVELS!=="undefined") && LEVELS.length>0 && (typeof PARS!=="undefined")`);
  const lvCount = await evalJS(`LEVELS.length`);
  console.log(`初期化: ${initOk ? "OK" : "NG"} / レベル数: ${lvCount}`);

  // 各レベルを解の手順で再生してクリア判定
  let allWin = true;
  for (let i = 0; i < lvCount; i++) {
    if (!paths[i].ok) { allWin = false; console.log(`L${i + 1} ▶ 解が無い: ${paths[i].reason}`); continue; }
    const seq = JSON.stringify(paths[i].path);
    const result = await evalJS(
      `(function(){ loadLevel(${i}); var p=${seq}; for(var k=0;k<p.length;k++){ move(p[k]); } return {won:won, moves:moveCount}; })()`
    );
    const okPar = result && result.moves === paths[i].moves;
    if (!result || result.won !== true) { allWin = false; console.log(`L${i + 1} ▶ クリア判定: NG (${JSON.stringify(result)})`); }
    else if (!okPar) console.log(`L${i + 1} ▶ クリアOKだが手数不一致 ゲーム:${result.moves} / 想定:${paths[i].moves}`);
  }
  if (allWin) console.log(`全レベル：ゲーム内ロジックでクリア判定 OK ✅`);

  // スクショ（レベル1表示）
  await evalJS(`loadLevel(0); hideOverlay("menuOverlay"); true`);
  await sleep(500);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOT_DIR, "smoke.png"), Buffer.from(shot.data, "base64"));
  console.log("スクショ: _shots/smoke.png");

  console.log("\nJSエラー: " + (errors.length ? "\n  " + errors.join("\n  ") : "なし ✅"));
  const ok = initOk && allWin && errors.length === 0;
  console.log("\n" + (ok ? "🎉 スモークテスト合格" : "⚠️ 問題あり"));
  cleanup(ok ? 0 : 1);
}

function cleanup(code) { try { ws && ws.close(); } catch (e) {} chrome.kill("SIGKILL"); setTimeout(() => process.exit(code), 200); }
main().catch(e => { console.error("失敗:", e.message); errors.length && console.error(errors.join("\n")); cleanup(1); });
