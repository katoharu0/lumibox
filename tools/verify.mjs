// Lumibox レベル検証
//   node tools/verify.mjs          … 各レベルが解けるか / 最少手数を表示
//   node tools/verify.mjs --write  … 最少手数を index.html の PARS に書き込む
import fs from "node:fs";
import path from "node:path";
import { solve, loadLevels } from "./solver.mjs";

const HTML = path.resolve(new URL("../index.html", import.meta.url).pathname);
const LEVELS = loadLevels(HTML);

let allOk = true;
const pars = {};
LEVELS.forEach((def, i) => {
  const t0 = Date.now();
  const r = solve(def);
  const ms = Date.now() - t0;
  if (r.ok) {
    pars[i] = r.moves;
    console.log(`L${String(i + 1).padStart(2)} ✅ 最少 ${String(r.moves).padStart(3)}手  (${ms}ms)  ${def.name}`);
  } else {
    allOk = false;
    console.log(`L${String(i + 1).padStart(2)} ❌ ${r.reason}  (${ms}ms)  ${def.name}`);
  }
});

if (process.argv.includes("--write") && allOk) {
  const parStr = "const PARS = {" + Object.entries(pars).map(([k, v]) => k + ":" + v).join(", ") + "};";
  const src = fs.readFileSync(HTML, "utf8").replace(/const PARS = \{[^}]*\};/, parStr);
  fs.writeFileSync(HTML, src);
  console.log("\n✏️  PARS を index.html に書き込みました");
}

console.log("\n" + (allOk ? "🎉 全レベル解けることを確認" : "⚠️ 解けない/未確認のレベルがあります"));
process.exit(allOk ? 0 : 1);
