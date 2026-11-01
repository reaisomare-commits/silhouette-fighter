// 学習AIをきたえる画面（HTMLのボタンとグラフ）。学習のしくみは src/core/learn.js。
// 画面が固まらないよう、少しずつ（1回に約30ミリ秒ぶん）試合を進める。
// 学習した頭脳はこのブラウザ（localStorage）に保存し、ページを開き直しても続きから使える。
(function (root) {
  const SF = root.SF;
  const L = SF.learn;
  const doc = root.document;
  const $ = (id) => doc.getElementById(id);
  const STORE_KEY = "silhouette-fighter.learn-brain";
  const PLAYER_KEY = "silhouette-fighter.player-brain"; // あなたとの対戦から学んだ頭脳
  const BLOCK = 50; // グラフの1点が何試合ぶんか
  const HARD = 2;

  const panel = $("learning");
  const els = {
    chars: [$("ln-char0"), $("ln-char1")],
    opp: $("ln-opp"),
    matches: $("ln-matches"),
    start: $("ln-start"),
    stop: $("ln-stop"),
    evalBtn: $("ln-eval-btn"),
    back: $("ln-back"),
    bar: $("ln-bar"),
    status: $("ln-status"),
    evalText: $("ln-eval"),
    chart: $("ln-chart"),
    tables: $("ln-tables"),
    think: $("ln-think"),
    save: $("ln-save"),
    load: $("ln-load"),
    file: $("ln-file"),
    def: $("ln-default"),
    reset: $("ln-reset"),
    player: $("ln-player"),
    playerReset: $("ln-player-reset"),
  };

  // ---- 頭脳の保存と読み込み（このブラウザの中） ----
  function storeBrain() {
    try {
      root.localStorage.setItem(STORE_KEY, JSON.stringify(L.serialize(L.currentBrain())));
      return true;
    } catch (e) {
      return false;
    }
  }
  function restoreBrain() {
    try {
      const text = root.localStorage.getItem(STORE_KEY);
      const brain = text && L.deserialize(JSON.parse(text));
      if (brain) L.setCurrentBrain(brain);
    } catch (e) {
      // 保存できない・読めないときは、ゲームに入っている学習データを使う
    }
  }
  restoreBrain();

  // ---- あなたとの対戦から学ぶ頭脳 ----
  // はじめて使うときは、今の学習AIのコピーから始める。あなたと戦うたびに、この頭脳だけが変わっていく
  let player = null;
  function playerBrain() {
    if (player) return player;
    try {
      const text = root.localStorage.getItem(PLAYER_KEY);
      player = text && L.deserialize(JSON.parse(text));
    } catch (e) {
      player = null;
    }
    if (!player) {
      player = L.clone(L.currentBrain());
      player.played = 0;
    }
    return player;
  }
  function savePlayerBrain() {
    if (!player) return false;
    try {
      root.localStorage.setItem(PLAYER_KEY, JSON.stringify(L.serialize(player)));
      return true;
    } catch (e) {
      return false;
    }
  }
  function resetPlayerBrain() {
    player = L.clone(L.currentBrain());
    player.played = 0;
    savePlayerBrain();
  }

  // ---- 選ぶ欄 ----
  for (let i = 0; i < 2; i++) {
    for (const [id, c] of Object.entries(SF.characters.CHARACTERS)) els.chars[i].add(new Option(c.name, id));
  }
  els.chars[1].value = "rin";
  SF.cpu.LEVELS.forEach((lv, n) => {
    if (!lv.learned) els.opp.add(new Option(`CPU ${lv.label}`, String(n)));
  });
  els.opp.add(new Option("学習AI（少し前の自分のコピー）", "self"));
  els.opp.value = String(HARD);

  const charName = (id) => SF.characters.CHARACTERS[id].name;
  const oppLabel = (v) => (v === "self" ? "学習AIのコピー" : `CPU ${SF.cpu.LEVELS[v].label}`);
  const SNAPSHOT_EVERY = 500; // 学習AI同士のとき、相手のコピーを何試合ごとに新しくするか

  let run = null; // 実行中の情報。止まっているときは null
  let points = []; // グラフの点（勝率%）
  let chartTitle = "";
  let onBack = null;

  function setRunning(on) {
    els.start.disabled = on;
    els.stop.disabled = !on;
    for (const e of [...els.chars, els.opp, els.matches, els.evalBtn, els.save, els.load, els.def, els.reset, els.playerReset]) e.disabled = on;
  }

  // ---- グラフ ----
  function drawChart() {
    const c = els.chart;
    const ctx = c.getContext("2d");
    const W = c.width;
    const H = c.height;
    const pad = { l: 56, r: 16, t: 28, b: 36 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "14px sans-serif";
    ctx.textBaseline = "middle";
    // 目もり（0〜100%）
    for (let v = 0; v <= 100; v += 25) {
      const y = pad.t + ph * (1 - v / 100);
      ctx.strokeStyle = v === 50 ? "#777" : "#2c2c2c";
      ctx.setLineDash(v === 50 ? [6, 6] : []);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(W - pad.r, y);
      ctx.stroke();
      ctx.fillStyle = "#999";
      ctx.textAlign = "right";
      ctx.fillText(`${v}%`, pad.l - 8, y);
    }
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffd8a0";
    ctx.textAlign = "left";
    ctx.fillText(chartTitle || "学習中の勝率", pad.l, 14);
    if (!points.length) {
      ctx.fillStyle = "#777";
      ctx.textAlign = "center";
      ctx.fillText("学習を始めると、ここに勝率のグラフが出ます", pad.l + pw / 2, pad.t + ph / 2);
      return;
    }
    const total = run ? run.total : points.length * BLOCK;
    const n = Math.max(points.length, Math.ceil(total / BLOCK));
    const xOf = (i) => pad.l + (n <= 1 ? pw / 2 : (pw * i) / (n - 1));
    ctx.strokeStyle = "#ff8a4a";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    points.forEach((v, i) => {
      const y = pad.t + ph * (1 - v / 100);
      if (i === 0) ctx.moveTo(xOf(i), y);
      else ctx.lineTo(xOf(i), y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;
    const lastV = points[points.length - 1];
    ctx.fillStyle = "#ff8a4a";
    ctx.beginPath();
    ctx.arc(xOf(points.length - 1), pad.t + ph * (1 - lastV / 100), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#999";
    ctx.textAlign = "center";
    ctx.fillText(`試合数 → （全部で ${total} 試合、1点 = ${BLOCK} 試合）`, pad.l + pw / 2, H - 14);
  }

  // ---- 表 ----
  function fillTable(table, head, rows) {
    table.textContent = "";
    const tr = doc.createElement("tr");
    for (const h of head) tr.appendChild(Object.assign(doc.createElement("th"), { textContent: h }));
    table.appendChild(doc.createElement("thead")).appendChild(tr);
    const body = table.appendChild(doc.createElement("tbody"));
    for (const r of rows) {
      const row = doc.createElement("tr");
      r.forEach((v, i) => row.appendChild(Object.assign(doc.createElement(i === 0 ? "th" : "td"), { textContent: String(v) })));
      body.appendChild(row);
    }
  }

  function showInfo() {
    const brain = L.currentBrain();
    const ids = Object.keys(SF.characters.CHARACTERS);
    const rows = [];
    for (const me of ids) {
      for (const opp of ids) {
        const t = brain.tables[`${me}>${opp}`];
        let seen = 0;
        if (t) for (let s = 0; s < L.STATES; s++) {
          for (let a = 0; a < L.ACTIONS.length; a++) {
            if (t.n[s * L.ACTIONS.length + a]) {
              seen += 1;
              break;
            }
          }
        }
        rows.push([`${charName(me)} が ${charName(opp)} と戦うとき`, t ? t.matches : 0, `${seen} / ${L.STATES}`]);
      }
    }
    fillTable(els.tables, ["組み合わせ", "学習した試合数", "経験した場面の数"], rows);
    const n = playerBrain().played;
    els.player.textContent =
      n > 0
        ? `あなたと ${n} 試合戦って学んだ学習AIがいます。プレイヤー VS CPU で「あなたから学ぶ：する」にすると、この学習AIと戦い、さらに学んでいきます。`
        : "まだあなたとは戦っていません。プレイヤー VS CPU で強さを「学習AI」、「あなたから学ぶ」を「する」にして戦うと、今の学習AIのコピーがあなたとの試合から学び始めます。";

    const me = els.chars[0].value;
    const opp = els.chars[1].value;
    const top = L.topStates(brain, me, opp, 15);
    const yesNo = (b) => (b ? "あり" : "ー");
    fillTable(
      els.think,
      ["距離", "相手の様子", "自分の飛び道具", "相手の飛び道具", "画面端", "選ぶ行動", "経験した回数"],
      top.map((r) => [r.dist, r.opp, yesNo(r.myProj), yesNo(r.oppProj), r.wall, r.best, r.visits]),
    );
    if (!top.length) fillTable(els.think, ["まだこの組み合わせは学習していません"], []);
  }

  // ---- 学習 ----
  function start() {
    const me = els.chars[0].value;
    const opp = els.chars[1].value;
    const oppValue = els.opp.value === "self" ? "self" : Number(els.opp.value);
    const total = Number(els.matches.value);
    const brain = L.currentBrain();
    const table = L.tableFor(brain, me, opp);
    // まだあまり学習していなければ、はじめは色々試す（探検の確率を高く）。学習が進んでいれば控えめに
    const exploreStart = table.matches < 3000 ? 0.3 : 0.12;
    run = { me, opp, oppValue, total, done: 0, wins: 0, blockWins: 0, blockDone: 0, exploreStart, snapshot: null, seed: (Date.now() & 0x7fffffff) >>> 0, t0: performance.now() };
    points = [];
    chartTitle = `${charName(me)}（学習AI） 対 ${charName(opp)}（${oppLabel(oppValue)}）の勝率`;
    setRunning(true);
    step();
  }

  function step() {
    if (!run) return;
    const r = run;
    const until = performance.now() + 30;
    while (r.done < r.total && performance.now() < until) {
      const side = r.done % 2; // 左右を入れ替えながら
      const chars = side ? [r.opp, r.me] : [r.me, r.opp];
      const explore = Math.max(0.03, r.exploreStart * (1 - r.done / (r.total * 0.7)));
      // 学習AI同士のときは、相手に「少し前の自分のコピー」（学習しない）を使い、ときどき新しくする
      if (r.oppValue === "self" && r.done % SNAPSHOT_EVERY === 0) r.snapshot = { brain: L.clone(L.currentBrain()) };
      const opponent = r.oppValue === "self" ? r.snapshot : r.oppValue;
      const res = L.trainMatch(L.currentBrain(), r.seed + r.done, chars, side, opponent, explore);
      const win = res.winner === side ? 1 : 0;
      r.wins += win;
      r.blockWins += win;
      r.blockDone += 1;
      r.done += 1;
      if (r.blockDone === BLOCK) {
        points.push((100 * r.blockWins) / BLOCK);
        r.blockWins = 0;
        r.blockDone = 0;
      }
    }
    els.bar.value = r.done / r.total;
    const sec = ((performance.now() - r.t0) / 1000).toFixed(1);
    els.status.textContent = `学習中… ${r.done} / ${r.total} 試合（${sec}秒）　ここまでの勝率 ${((100 * r.wins) / r.done).toFixed(1)}%`;
    drawChart();
    if (r.done >= r.total) finish(`${r.total}試合の学習が終わりました（${sec}秒）。ここまでの勝率 ${((100 * r.wins) / r.done).toFixed(1)}%`);
    else setTimeout(step, 0);
  }

  function finish(message) {
    run = null;
    const saved = storeBrain();
    els.status.textContent = message + (saved ? "。学習した結果はこのブラウザに保存しました。" : "。（このブラウザには保存できませんでした。「ファイルに保存」で残せます）");
    setRunning(false);
    drawChart();
    showInfo();
  }

  function stop() {
    if (!run) return;
    finish(`途中で中止しました（${run.done}試合ぶん学習）`);
  }

  // 実力をはかる：学習しないで「つよい」CPUと200試合（左右入れ替え）。学習AIの「ふつうに戦うとき」と同じ動き
  function evaluate() {
    const me = els.chars[0].value;
    const opp = els.chars[1].value;
    const N = 200;
    let i = 0;
    let wins = 0;
    setRunning(true);
    els.stop.disabled = true;
    els.evalText.textContent = "はかっています…";
    const seed = 700000;
    (function chunk() {
      const until = performance.now() + 30;
      while (i < N && performance.now() < until) {
        const side = i % 2;
        const chars = side ? [opp, me] : [me, opp];
        const levels = side ? [HARD, SF.cpu.LEARN_LEVEL] : [SF.cpu.LEARN_LEVEL, HARD];
        if (SF.autobattle.runMatch(seed + i, chars, levels).winner === side) wins += 1;
        i += 1;
      }
      els.bar.value = i / N;
      if (i < N) return setTimeout(chunk, 0);
      els.evalText.textContent = `実力：${charName(me)}（学習AI）は ${charName(opp)}（CPU つよい）に ${N}試合中 ${wins}勝（勝率 ${((100 * wins) / N).toFixed(1)}%）`;
      setRunning(false);
    })();
  }

  // ---- 学習データのファイル ----
  async function saveToFile() {
    const blob = new Blob([JSON.stringify(L.serialize(L.currentBrain()))], { type: "application/json" });
    const ok = await SF.recordsPage.saveFile("silhouette-fighter-learn.json", blob);
    if (!ok) els.status.textContent = "ファイルに保存できませんでした";
  }

  function loadFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let brain = null;
      try {
        brain = L.deserialize(JSON.parse(reader.result));
      } catch (e) {
        brain = null;
      }
      if (!brain) {
        els.status.textContent = "このファイルは学習データとして読めませんでした（形がちがうか、古い版のデータです）";
        return;
      }
      L.setCurrentBrain(brain);
      storeBrain();
      els.status.textContent = "学習データを読み込みました";
      showInfo();
    };
    reader.readAsText(file);
  }

  function useBrain(brain, message) {
    L.setCurrentBrain(brain);
    storeBrain();
    points = [];
    chartTitle = "";
    drawChart();
    els.evalText.textContent = "";
    els.status.textContent = message;
    showInfo();
  }

  els.start.addEventListener("click", start);
  els.stop.addEventListener("click", stop);
  els.evalBtn.addEventListener("click", evaluate);
  els.save.addEventListener("click", saveToFile);
  els.load.addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", () => {
    if (els.file.files[0]) loadFromFile(els.file.files[0]);
    els.file.value = "";
  });
  els.def.addEventListener("click", () => useBrain(L.defaultBrain(), "最初から入っている学習データにもどしました"));
  els.reset.addEventListener("click", () => useBrain(L.createBrain(), "何も覚えていない状態にしました。学習させると、だんだん強くなる様子が見られます"));
  for (const e of els.chars) e.addEventListener("change", showInfo);
  els.playerReset.addEventListener("click", () => {
    resetPlayerBrain();
    els.status.textContent = "あなたとの対戦で学んだ分を消して、今の学習AIからやり直すようにしました";
    showInfo();
  });
  els.back.addEventListener("click", () => {
    stop();
    close();
  });

  function open(backHandler) {
    onBack = backHandler;
    doc.body.classList.add("records-open");
    panel.hidden = false;
    setRunning(false);
    drawChart();
    showInfo();
  }

  function close() {
    panel.hidden = true;
    doc.body.classList.remove("records-open");
    if (onBack) onBack();
  }

  SF.learnPage = { open, close, isOpen: () => !panel.hidden, playerBrain, savePlayerBrain, resetPlayerBrain };
})(globalThis);
