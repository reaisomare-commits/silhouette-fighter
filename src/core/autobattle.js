// 自動対戦と記録。画面を描かずにCPU同士を何試合も戦わせて、結果を数える。
// 画面やキーボードにはさわらないので、ブラウザでも node でも同じように動く。
//   runMatch   … 1試合を最後まで進めて、勝ち負け・ラウンドごとの終わり方・技ごとの記録を返す
//   createSummary / addMatch … 試合の結果を足し合わせる
//   tables     … 足し合わせた結果を表（見出しと行）にする。画面の表とCSVはここから作る
//   toCsv      … 表をCSV（Excelで開ける形）にする
(function (root) {
  const SF = (root.SF = root.SF || {});
  const FPS = SF.constants.FPS;

  // 技の並び順（表の上から）
  const MOVE_ORDER = ["standLight", "standHeavy", "crouchLight", "crouchHeavy", "airLight", "airHeavy", "special", "crouchSpecial", "throw"];
  const MOVE_INPUT = {
    standLight: "U",
    standHeavy: "I",
    crouchLight: "S+U",
    crouchHeavy: "S+I",
    airLight: "ジャンプ中U",
    airHeavy: "ジャンプ中I",
    special: "O",
    crouchSpecial: "S+O",
    throw: "U+I",
  };

  // 試合が終わらないときの打ち切り（3ラウンド×60秒に、ラウンドの合間を足しても十分な長さ）
  const MAX_FRAMES = 60 * 60 * 6;

  // 1試合を最後まで進める。chars＝[左のキャラ, 右のキャラ]、levels＝[左の強さ, 右の強さ]（0よわい・1ふつう・2つよい）
  function runMatch(seed, chars, levels) {
    const { PHASE } = SF.game;
    const state = SF.game.createGame(seed, chars, { record: true });
    const cpus = levels.map((lv, i) => SF.cpu.createCpu(lv, (seed * 2 + i) >>> 0));
    const rounds = [];
    let fightFrames = 0; // 実際に戦っている時間（ラウンド開始の表示や決着の場面は数えない）
    let prevPhase = state.round.phase;
    let n = 0;
    while (state.round.phase !== PHASE.MATCH_END && n < MAX_FRAMES) {
      SF.game.step(state, [SF.cpu.input(cpus[0], state, 0), SF.cpu.input(cpus[1], state, 1)]);
      n += 1;
      const r = state.round;
      if (prevPhase === PHASE.FIGHT) fightFrames += 1; // このフレームは戦っていた
      if (prevPhase === PHASE.FIGHT && r.phase === PHASE.ROUND_END) {
        rounds.push({ winner: r.winner, reason: r.reason });
      }
      prevPhase = r.phase;
    }
    const finished = state.round.phase === PHASE.MATCH_END;
    return {
      seed,
      chars: chars.slice(),
      levels: levels.slice(),
      winner: finished ? state.round.matchWinner : "draw", // 打ち切ったときは引き分け扱い
      finished,
      rounds,
      fightFrames,
      health: state.fighters.map((f) => f.health),
      moves: state.log.moves,
    };
  }

  // 「キャラ＋強さ」ごとに数える。同じキャラでも強さが違えば別に数える
  const entryKey = (charId, level) => `${charId}:${level}`;
  function entryLabel(charId, level) {
    return `${SF.characters.CHARACTERS[charId].name}（${SF.cpu.LEVELS[level].label}）`;
  }

  function createSummary() {
    return {
      matches: 0,
      unfinished: 0,
      rounds: 0,
      timeouts: 0,
      drawRounds: 0,
      fightFrames: 0,
      sides: [
        { wins: 0, losses: 0, draws: 0 },
        { wins: 0, losses: 0, draws: 0 },
      ],
      entries: {}, // entryKey → { charId, level, matches, wins, losses, draws, rounds, roundWins, moves: { 技 → 数 } }
    };
  }

  function entryOf(sum, charId, level) {
    const key = entryKey(charId, level);
    return (
      sum.entries[key] ||
      (sum.entries[key] = { charId, level, matches: 0, wins: 0, losses: 0, draws: 0, rounds: 0, roundWins: 0, moves: {} })
    );
  }

  function addMatch(sum, res) {
    sum.matches += 1;
    if (!res.finished) sum.unfinished += 1;
    sum.fightFrames += res.fightFrames;
    for (const r of res.rounds) {
      sum.rounds += 1;
      if (r.reason === "time") sum.timeouts += 1;
      if (r.winner === "draw") sum.drawRounds += 1;
    }
    for (let i = 0; i < 2; i++) {
      const result = res.winner === "draw" ? "draws" : res.winner === i ? "wins" : "losses";
      sum.sides[i][result] += 1;
      const e = entryOf(sum, res.chars[i], res.levels[i]);
      e.matches += 1;
      e[result] += 1;
      for (const r of res.rounds) {
        e.rounds += 1;
        if (r.winner === i) e.roundWins += 1;
      }
      for (const [name, row] of Object.entries(res.moves[i])) {
        const m = e.moves[name] || (e.moves[name] = { uses: 0, hits: 0, blocks: 0, techs: 0, damage: 0 });
        for (const k of Object.keys(m)) m[k] += row[k];
      }
    }
  }

  // 割合を「12.3%」の形にする。分母が0なら「ー」
  const pct = (a, b) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : "ー");
  const fixed1 = (a, b) => (b > 0 ? (a / b).toFixed(1) : "ー");

  // 表にする。返すのは [{ id, title, note, head: [見出し], rows: [[値...]] }]
  function tables(sum) {
    const out = [];
    const entries = Object.values(sum.entries).sort((a, b) => a.charId.localeCompare(b.charId) || a.level - b.level);

    out.push({
      id: "overview",
      title: "全体",
      head: ["項目", "値"],
      rows: [
        ["試合数", sum.matches],
        ["ラウンド数", sum.rounds],
        ["平均試合時間（秒、戦っている時間だけ）", fixed1(sum.fightFrames / FPS, sum.matches)],
        ["平均ラウンド時間（秒）", fixed1(sum.fightFrames / FPS, sum.rounds)],
        ["時間切れの割合（ラウンド）", pct(sum.timeouts, sum.rounds)],
        ["引き分けのラウンド", sum.drawRounds],
        ["左の勝ち / 右の勝ち / 引き分け（試合）", `${sum.sides[0].wins} / ${sum.sides[1].wins} / ${sum.sides[0].draws}`],
      ].concat(sum.unfinished ? [["終わらず打ち切った試合", sum.unfinished]] : []),
    });

    out.push({
      id: "winrate",
      title: "キャラごとの勝率",
      note: "引き分けは勝率の分母に入れています。同じキャラ同士の試合は両方に数えるので、そのぶん50%に近づきます。",
      head: ["キャラ（強さ）", "試合数", "勝ち", "負け", "引き分け", "勝率", "ラウンド勝率"],
      rows: entries.map((e) => [
        entryLabel(e.charId, e.level),
        e.matches,
        e.wins,
        e.losses,
        e.draws,
        pct(e.wins, e.matches),
        pct(e.roundWins, e.rounds),
      ]),
    });

    for (const e of entries) {
      const moves = SF.characters.CHARACTERS[e.charId].moves;
      const total = Object.values(e.moves).reduce((s, m) => s + m.damage, 0);
      const names = MOVE_ORDER.filter((n) => moves[n]).concat(Object.keys(e.moves).filter((n) => !MOVE_ORDER.includes(n)));
      out.push({
        id: `moves-${e.charId}-${e.level}`,
        title: `技ごとの記録：${entryLabel(e.charId, e.level)}`,
        note: "命中率＝当たった回数÷使った回数（ガードされた・空振りは外れ）。投げは「投げ抜けされた」も外れ。",
        head: ["技", "入力", "使った回数", "1試合あたり", "当たった", "ガードされた", "投げ抜けされた", "命中率", "与えたダメージ", "ダメージの割合"],
        rows: names.map((n) => {
          const m = e.moves[n] || { uses: 0, hits: 0, blocks: 0, techs: 0, damage: 0 };
          return [
            moves[n] ? moves[n].name : n,
            MOVE_INPUT[n] || "",
            m.uses,
            fixed1(m.uses, e.matches),
            m.hits,
            m.blocks,
            n === "throw" ? m.techs : "ー",
            pct(m.hits, m.uses),
            m.damage,
            pct(m.damage, total),
          ];
        }),
      });
    }
    return out;
  }

  // CSVの1つの値。カンマや改行、" が入っていたら " で囲む
  function csvCell(v) {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // 表をCSVにする。表と表の間は空行。settings があれば先頭に条件を書く
  function toCsv(sum, settings) {
    const lines = [];
    if (settings) {
      lines.push("条件");
      for (const [k, v] of settings) lines.push([k, v].map(csvCell).join(","));
      lines.push("");
    }
    for (const t of tables(sum)) {
      lines.push(csvCell(t.title));
      lines.push(t.head.map(csvCell).join(","));
      for (const r of t.rows) lines.push(r.map(csvCell).join(","));
      lines.push("");
    }
    return lines.join("\r\n");
  }

  // 試合の組み合わせの一覧を作る。swap＝左右を入れ替えた試合も同じ数だけやる（左右の有利不利を消すため）
  function schedule(setup) {
    const list = [];
    for (let i = 0; i < setup.matches; i++) {
      const flip = setup.swap && i % 2 === 1;
      list.push({
        seed: (setup.seed + i) >>> 0,
        chars: flip ? [setup.chars[1], setup.chars[0]] : setup.chars.slice(),
        levels: flip ? [setup.levels[1], setup.levels[0]] : setup.levels.slice(),
      });
    }
    return list;
  }

  SF.autobattle = { MOVE_ORDER, runMatch, createSummary, addMatch, tables, toCsv, schedule, entryLabel };
})(globalThis);
