// Lumibox 共有ソルバ（verify.mjs / smoke.mjs から使う）
// アイス滑り版: 箱は壁か別の箱に当たるまで滑る
import fs from "node:fs";

export const DIRS = [
  { dx: 0, dy: -1, name: "up" }, { dx: 0, dy: 1, name: "down" },
  { dx: -1, dy: 0, name: "left" }, { dx: 1, dy: 0, name: "right" },
];

export function parse(def) {
  const g = def.grid;
  const W = Math.max(...g.map(r => r.length)), H = g.length;
  const walls = new Set(), targets = new Map(), boxes = [];
  let player = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = g[y][x] || " ";
    if (ch === "#") walls.add(x + "," + y);
    else if (ch === ".") targets.set(x + "," + y, -1);
    else if (ch === "$") boxes.push({ x, y, c: -1 });
    else if (ch === "*") { targets.set(x + "," + y, -1); boxes.push({ x, y, c: -1 }); }
    else if (ch === "@") player = { x, y };
    else if (ch === "+") { targets.set(x + "," + y, -1); player = { x, y }; }
    else if ("ABCD".includes(ch)) boxes.push({ x, y, c: ch.charCodeAt(0) - 65 });
    else if ("abcd".includes(ch)) targets.set(x + "," + y, ch.charCodeAt(0) - 97);
  }
  return { W, H, walls, targets, boxes, player };
}

// アイス滑り: 箱を (sx,sy) から (dx,dy) 方向へ滑らせた最終位置を返す
function slideBox(sx, sy, dx, dy, walls, boxes) {
  let x = sx, y = sy;
  while (!walls.has((x + dx) + "," + (y + dy)) && !boxes.some(b => b.x === x + dx && b.y === y + dy)) {
    x += dx; y += dy;
  }
  return { x, y };
}

export function solve(def) {
  const { walls, targets, boxes, player } = parse(def);
  const isGoal = bs => bs.every(b => targets.get(b.x + "," + b.y) === b.c);
  const keyOf = (px, py, bs) =>
    px + "," + py + "|" + bs.map(b => b.x + "," + b.y + "," + b.c).sort().join(";");

  const startBoxes = boxes.map(b => ({ x: b.x, y: b.y, c: b.c }));
  const startKey = keyOf(player.x, player.y, startBoxes);
  if (isGoal(startBoxes)) return { ok: true, moves: 0, path: [] };

  const parent = new Map();
  parent.set(startKey, null);
  let frontier = [{ px: player.x, py: player.y, bs: startBoxes, key: startKey }];
  let depth = 0;
  const LIMIT = 6_000_000;

  while (frontier.length) {
    depth++;
    const next = [];
    for (const st of frontier) {
      for (const { dx, dy, name } of DIRS) {
        const nx = st.px + dx, ny = st.py + dy;
        if (walls.has(nx + "," + ny)) continue;
        const bi = st.bs.findIndex(b => b.x === nx && b.y === ny);
        let nbs;
        if (bi >= 0) {
          // 箱を滑らせる
          const firstX = nx + dx, firstY = ny + dy;
          if (walls.has(firstX + "," + firstY)) continue; // 直後が壁 = 押せない
          if (st.bs.some(b => b.x === firstX && b.y === firstY)) continue; // 直後に別箱
          const { x: finalX, y: finalY } = slideBox(nx, ny, dx, dy, walls, st.bs.filter((_, i) => i !== bi));
          nbs = st.bs.map((b, i) => i === bi ? { x: finalX, y: finalY, c: b.c } : b);
        } else {
          nbs = st.bs;
        }
        const k = keyOf(nx, ny, nbs);
        if (parent.has(k)) continue;
        parent.set(k, { pk: st.key, dir: name });
        if (bi >= 0 && isGoal(nbs)) {
          const path = [];
          let cur = k;
          while (parent.get(cur)) { path.push(parent.get(cur).dir); cur = parent.get(cur).pk; }
          path.reverse();
          return { ok: true, moves: depth, path };
        }
        next.push({ px: nx, py: ny, bs: nbs, key: k });
        if (parent.size > LIMIT) return { ok: false, reason: "探索が大きすぎる(状態数 " + parent.size + ")" };
      }
    }
    frontier = next;
  }
  return { ok: false, reason: "解なし" };
}

// index.html から LEVELS 配列を取り出す
export function loadLevels(htmlPath) {
  const src = fs.readFileSync(htmlPath, "utf8");
  const m = src.match(/const LEVELS = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error("LEVELS が見つかりません");
  return eval(m[1]);
}
