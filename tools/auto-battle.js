// 自動対戦を画面なしで行い、結果を表示する（CSVでも保存できる）。
// 使い方: node tools/auto-battle.js [左のキャラ] [右のキャラ] [左の強さ] [右の強さ] [試合数] [CSVの保存先]
//   例: node tools/auto-battle.js kagetsu rin 1 1 1000 result.csv
//   キャラは kagetsu / rin、強さは 0（よわい）1（ふつう）2（つよい）。左右を入れ替えた試合も半分ずつ行う
const fs = require("node:fs");
for (const f of ["constants", "rng", "input", "characters", "game", "cpu", "autobattle"]) require(`../src/core/${f}.js`);
const SF = globalThis.SF;

const [c0 = "kagetsu", c1 = "rin", l0 = "1", l1 = "1", n = "1000", out] = process.argv.slice(2);
const setup = { chars: [c0, c1], levels: [Number(l0), Number(l1)], matches: Number(n), seed: 1, swap: true };
const sum = SF.autobattle.createSummary();
const t0 = Date.now();
for (const m of SF.autobattle.schedule(setup)) SF.autobattle.addMatch(sum, SF.autobattle.runMatch(m.seed, m.chars, m.levels));
const ms = Date.now() - t0;

for (const t of SF.autobattle.tables(sum)) {
  console.log(`\n■ ${t.title}`);
  console.log(t.head.join(" | "));
  for (const r of t.rows) console.log(r.join(" | "));
}
console.log(`\n${setup.matches}試合を ${(ms / 1000).toFixed(1)} 秒で計算`);
if (out) {
  fs.writeFileSync(out, "﻿" + SF.autobattle.toCsv(sum));
  console.log(`CSVを保存しました: ${out}`);
}
