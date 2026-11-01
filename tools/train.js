// 学習AIを画面なしで学習させ、ゲームに入れる学習データ（src/core/learned-data.js）を作る。
// 使い方: node tools/train.js [1回あたりの試合数] [回数] [--fresh]
//   例: node tools/train.js 4000 4
//   --watch をつけると、回ごとに学習AI同士の勝率を表示する（学習が落ち着いているかを見る）
//   --matrix をつけると、最後に最近の6世代どうしを、ちがうキャラの組み合わせごとに総当たりで戦わせ、平均の勝率を出す（バランス調整はこの平均を見る）
//   今の学習データの続きから学ぶ。--fresh をつけると、何も覚えていない状態から学び直す。
//   「1回」の中で、組み合わせ（カゲツ対リン、リン対カゲツ、同キャラ同士）ごとに指定の試合数だけ学ぶ。
//   相手は半分が「つよい」CPU、半分が「これまでの回の始めの学習AIのコピー」（学習しない）の中からでたらめに1つ。左右も入れ替える。
//   コピーは最近の POOL 回分を取っておく。直前のコピーだけを相手にすると、その弱点だけをつく戦い方を覚えては
//   次の回に相手に対応されて…をくり返し、学習AI同士の勝率が回ごとに 0%〜100% と大きく振れたため、何世代か前の自分とも戦わせる。
//   探検の確率（わざと別の行動を試す確率）は、1回目は 0.3、2回目からは 0.15 から始めて 0.03 まで下げる。
const fs = require("node:fs");
const path = require("node:path");
for (const f of ["constants", "rng", "input", "characters", "game", "cpu", "autobattle", "learn"]) require(`../src/core/${f}.js`);
const dataFile = path.join(__dirname, "../src/core/learned-data.js");
const fresh = process.argv.includes("--fresh");
if (!fresh && fs.existsSync(dataFile)) require(dataFile);
const SF = globalThis.SF;
const L = SF.learn;

const nums = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const perBlock = nums[0] || 4000;
const rounds = nums[1] || 4;
const brain = fresh ? L.createBrain() : L.defaultBrain();
const ids = Object.keys(SF.characters.CHARACTERS);
const matchups = [];
for (const me of ids) for (const opp of ids) matchups.push([me, opp]);

const HARD = 2;
const POOL = 6;
const pool = [];
const t0 = Date.now();
// 種は今までに学習した試合数から決める（同じデータから同じ試合数を学ばせれば、同じ結果になる）
let seed = 1 + Object.values(brain.tables).reduce((n, t) => n + t.matches, 0) * 7;
for (let round = 1; round <= rounds; round++) {
  pool.push({ brain: L.clone(brain) }); // この回の始めのコピー（学習しない）を相手の候補に加える
  if (pool.length > POOL) pool.shift();
  const young = Object.keys(brain.tables).length < matchups.length || L.tableFor(brain, ids[0], ids[0]).matches < 3000;
  const exploreStart = young && round === 1 ? 0.3 : 0.15;
  for (const [me, opp] of matchups) {
    for (let i = 0; i < perBlock; i++) {
      const learnSide = i % 2;
      const chars = learnSide ? [opp, me] : [me, opp];
      const opponent = (i >> 1) % 2 === 0 ? HARD : pool[(seed * 2654435761 >>> 0) % pool.length];
      const explore = Math.max(0.03, exploreStart * (1 - i / (perBlock * 0.7)));
      L.trainMatch(brain, seed++, chars, learnSide, opponent, explore);
    }
  }
  const watch = process.argv.includes("--watch") ? `、学習AI同士 ${ids[0]} の勝率 ${winRate(ids[0], ids[1], SF.cpu.LEARN_LEVEL)}` : "";
  console.log(`${round}回目：${matchups.length}つの組み合わせを ${perBlock} 試合ずつ学習（${((Date.now() - t0) / 1000).toFixed(0)}秒）${watch}`);
}

// 総当たり（--matrix）：最近の何世代か（各回の始めのコピーと最後の学習AI）を、キャラの組み合わせ（カゲツ対リン・カゲツ対ゲンマ・リン対ゲンマ）ごとに全部の世代の組み合わせで戦わせ、
// 平均の勝率を出す。1世代だけだと「直前の相手の弱点をついた戦い方」で勝率が大きく振れるため、
// いろいろな世代の相手との平均で、キャラそのものの強さを見る
if (process.argv.includes("--matrix")) {
  const gens = [...pool.map((p) => p.brain), brain].slice(-POOL);
  const n = 50;
  // キャラの組み合わせ（ちがうキャラどうし）ごとに総当たりする
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      let total = 0;
      const rows = [];
      for (let i = 0; i < gens.length; i++) {
        const row = [];
        for (let j = 0; j < gens.length; j++) {
          let w = 0;
          for (let k = 0; k < n; k++) {
            const side = k % 2; // 0＝ids[a] が左
            const chars = side ? [ids[b], ids[a]] : [ids[a], ids[b]];
            const brains = side ? [gens[j], gens[i]] : [gens[i], gens[j]];
            const r = SF.autobattle.runMatch(700000 + k, chars, [SF.cpu.LEARN_LEVEL, SF.cpu.LEARN_LEVEL], { brains });
            if (r.winner === side) w += 1;
          }
          row.push((100 * w) / n);
          total += w;
        }
        rows.push(row);
      }
      console.log(`\n総当たり：${ids[a]} の世代（行）対 ${ids[b]} の世代（列）、${ids[a]} の勝率（${n}試合ずつ）`);
      for (const row of rows) console.log("  " + row.map((v) => `${v.toFixed(0).padStart(3)}%`).join(" "));
      console.log(`  平均 ${((100 * total) / (n * gens.length * gens.length)).toFixed(1)}%`);
    }
  }
}

// 腕だめし：学習しないで戦わせて勝率を見る
function winRate(me, opp, oppLevel, n = 200) {
  let w = 0;
  for (let i = 0; i < n; i++) {
    const side = i % 2;
    const chars = side ? [opp, me] : [me, opp];
    const levels = side ? [oppLevel, SF.cpu.LEARN_LEVEL] : [SF.cpu.LEARN_LEVEL, oppLevel];
    const r = SF.autobattle.runMatch(900000 + i, chars, levels, { brain });
    if (r.winner === side) w += 1;
  }
  return `${((100 * w) / n).toFixed(1)}%`;
}
console.log("\n学習AIの勝率（200試合ずつ）");
for (const me of ids) for (const opp of ids) console.log(`  ${me} 学習AI 対 ${opp} つよい: ${winRate(me, opp, HARD)}`);
for (let i = 0; i < ids.length; i++)
  for (let j = i + 1; j < ids.length; j++) console.log(`  学習AI同士 ${ids[i]} 対 ${ids[j]}: ${ids[i]} の勝率 ${winRate(ids[i], ids[j], SF.cpu.LEARN_LEVEL)}`);

const json = JSON.stringify(L.serialize(brain));
fs.writeFileSync(
  dataFile,
  "// 学習AIの学習データ（tools/train.js が作るファイル。手で書きかえない）\n" +
    "// 状況ごと・行動ごとの数字（Q値）と、経験した回数が入っている\n" +
    `globalThis.SF = globalThis.SF || {};\nglobalThis.SF.learnedData = ${json};\n`,
);
console.log(`\n学習データを保存しました: ${path.relative(process.cwd(), dataFile)}（${(json.length / 1024).toFixed(0)}KB）`);
