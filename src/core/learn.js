// 機械学習（強化学習）で強くなるCPU「学習AI」の頭脳。
//
// しくみ（Q学習）：
//   CPUが「様子見で次に何をするか」を決めるたびに、今の状況を1つの番号（状況番号）にまとめる。
//   頭脳は「状況番号 × 行動」の表を持っていて、表の数字（Q値）は「その状況でその行動をとると、
//   このあとどれくらい得をするか」の見積もり。いちばん数字の大きい行動を選ぶ。
//   学習中は、行動したあと次に考えるときまでに「相手に与えたダメージ − 受けたダメージ」を得点として受け取り
//   （相手をダウンさせたら少し足し、自分がダウンしたら少し引く）、ラウンドに勝てば +1、負ければ −1 をもらう。その得点で表の数字を少しずつ直していく。
//   何千試合もくり返すと、「この距離・この状況ではこの行動が勝ちにつながる」が表に残っていく。
//   ときどき（探検の確率）わざと別の行動も試すので、まだ知らない良い行動も見つけられる。
//
// ガード・対空・連続技・投げ抜けといった「反射神経」の部分は、今のCPU（つよい）と同じ数字のまま（cpu.js）。
// 学習するのは「立ち回り（何をするかの判断）」だけ。
//
// ファイルの分け方：
//   learn.js（このファイル）… 戦うときに使う部分。状況の見方・行動の一覧・表から行動を選ぶ・頭脳の保存と読み込み
//   learn-train.js           … 学ぶ部分。得点の付け方・表の直し方・キャラごとの方針（学習の始めの手がかり）・学習の試合
//   学習とゲームは同じ「状況の見方」と「行動の一覧」を使うので、行動を足しても食い違わない。
//
// 頭脳は「自分のキャラ>相手のキャラ」ごとに別の表を持つ（例：kagetsu>rin はカゲツがリンと戦うときの表）。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const S = SF.constants.SCALE;

  // 学習AIが選べる行動（並び順を変えると今までの学習が使えなくなるので、足すときは最後に足し STATE_VERSION を上げる）
  const ACTIONS = [
    { id: "wait", label: "様子見" },
    { id: "forward", label: "前に歩く" },
    { id: "back", label: "下がる（立ちガード）" },
    { id: "guardLow", label: "しゃがみガード" },
    { id: "dash", label: "ステップ／ダッシュ" },
    { id: "backdash", label: "バックステップ" },
    { id: "jump", label: "前ジャンプ" },
    { id: "jumpUp", label: "垂直ジャンプ" },
    { id: "jumpBack", label: "後ろジャンプ" },
    { id: "light", label: "弱攻撃 U" },
    { id: "heavy", label: "強攻撃 I" },
    { id: "crouchLight", label: "しゃがみ弱 S+U" },
    { id: "crouchHeavy", label: "しゃがみ強 S+I" },
    { id: "special", label: "必殺技 O" },
    { id: "crouchSpecial", label: "対空必殺技 S+O" },
    { id: "throw", label: "投げ U+I" },
    // ひとまとまりの攻め（cpu.js が何フレームかかけて出しきる）
    //   起き攻め：相手が倒れているとき、近づいて起き上がりの瞬間に技を重ねる（強攻撃・下段）か、起き上がりに投げる（ゴウは岩落とし）。
    //   相手が倒れていなければ、ふつうの強攻撃・しゃがみ弱・投げと同じ
    { id: "okiStrike", label: "起き攻め：強攻撃を重ねる" },
    { id: "okiLow", label: "起き攻め：下段を重ねる" },
    { id: "okiThrow", label: "起き攻め：起き上がりに投げ" },
    // ダッシュで近づいて、着いたら投げ（ゴウは岩落とし）・しゃがみ弱（下段）。ガードを固める相手を崩す
    { id: "dashThrow", label: "ダッシュして投げ" },
    { id: "dashLow", label: "ダッシュして下段" },
    // ゲージが満タンのときだけ選べる
    { id: "super", label: "ゲージ技 I+O" },
  ];
  const ACTION_INDEX = Object.fromEntries(ACTIONS.map((a, i) => [a.id, i]));

  // 状況のまとめ方。数を変えたら STATE_VERSION を上げる（古い学習データは使わない）
  //   距離 6 × 相手の様子 7 × 自分の飛び道具 2 × 相手の飛び道具 2 × 画面端 3 × 自分のゲージ（満タンか）2
  const DIST_LABELS = ["投げの距離", "弱攻撃の距離", "強攻撃の距離", "少し遠い", "遠い", "とても遠い"];
  const OPP_LABELS = ["ふつう", "しゃがみ・ガード", "技を出している", "技のスキ", "のけぞり・ガード硬直", "空中", "倒れている"];
  const WALL_LABELS = ["端ではない", "自分が端", "相手が端"];
  const STATES = DIST_LABELS.length * OPP_LABELS.length * 2 * 2 * WALL_LABELS.length * 2;
  // 2：相手の様子に「倒れている」、行動に起き攻めとダッシュからの崩しを足した
  // 3：状況に「自分のゲージが満タンか」、行動に「ゲージ技」を足した
  const STATE_VERSION = 3;

  const PLAY_EXPLORE = 0.04; // 学習していないとき（ふつうに戦うとき）にも少しだけ別の行動を混ぜる（毎回同じ動きにならないように）
  const WALL_NEAR = 120; // 画面端からこれ以内なら「端」（ピクセル）
  const PROJ_NEAR = 420; // 相手の飛び道具がこれより近くで向かってきたら「飛び道具あり」（ピクセル）

  const tableKey = (me, opp) => `${me}>${opp}`;

  function createTable() {
    return { q: new Float32Array(STATES * ACTIONS.length), n: new Uint32Array(STATES * ACTIONS.length), matches: 0 };
  }

  function createBrain() {
    // played＝あなたとの対戦で学んだ試合数（あなたと戦って育てる頭脳だけが使う）
    return { version: STATE_VERSION, tables: {}, played: 0 };
  }

  // 表がまだなければ新しい表を作る（学ぶ部分 learn-train.js があれば、キャラごとの方針の手がかりを入れておく）
  function tableFor(brain, me, opp) {
    const k = tableKey(me, opp);
    if (brain.tables[k]) return brain.tables[k];
    const t = createTable();
    return (brain.tables[k] = SF.learnTrain ? SF.learnTrain.applyPolicyPrior(t, me) : t);
  }

  // 保存用の形（JSONにできる、ふつうの配列）にする
  function serialize(brain) {
    const tables = {};
    for (const [k, t] of Object.entries(brain.tables)) {
      tables[k] = {
        matches: t.matches,
        q: Array.from(t.q, (v) => Math.round(v * 10000) / 10000),
        n: Array.from(t.n),
      };
    }
    return { version: brain.version, actions: ACTIONS.map((a) => a.id), states: STATES, played: brain.played || 0, tables };
  }

  // 保存した形から頭脳にもどす。形が合わなければ null
  function deserialize(data) {
    if (!data || data.version !== STATE_VERSION || data.states !== STATES) return null;
    if (!Array.isArray(data.actions) || data.actions.join() !== ACTIONS.map((a) => a.id).join()) return null;
    const brain = createBrain();
    brain.played = data.played || 0;
    for (const [k, t] of Object.entries(data.tables || {})) {
      if (!t || !Array.isArray(t.q) || t.q.length !== STATES * ACTIONS.length) return null;
      const table = createTable();
      table.q.set(t.q);
      if (Array.isArray(t.n) && t.n.length === table.n.length) table.n.set(t.n);
      table.matches = t.matches || 0;
      brain.tables[k] = table;
    }
    return brain;
  }

  function clone(brain) {
    return deserialize(serialize(brain));
  }

  // ゲームに入っている学習済みの頭脳（src/core/learned-data.js）。なければ何も覚えていない頭脳
  function defaultBrain() {
    return (SF.learnedData && deserialize(SF.learnedData)) || createBrain();
  }

  // 保存してあった頭脳に、ない組み合わせの表があれば、ゲームに入っている学習データからコピーして足す
  // （キャラが増える前に保存した頭脳でも、新しいキャラとの組み合わせを学習済みの状態で戦えるように）
  function fillMissing(brain) {
    const base = defaultBrain();
    for (const [k, t] of Object.entries(base.tables)) if (!brain.tables[k]) brain.tables[k] = t;
    return brain;
  }

  // ふつうに戦うときに使う頭脳。ブラウザの学習画面で育てたものがあれば、そちらに差しかえる
  let current = null;
  function currentBrain() {
    return current || (current = defaultBrain());
  }
  function setCurrentBrain(brain) {
    current = brain;
  }

  // ---- 状況を番号にする ----

  // 自分の技の届く距離（cpu.js と同じ計算）
  function reachOf(me, opp, name) {
    const CH = SF.characters.CHARACTERS;
    const m = CH[me.charId].moves[name];
    return m.hitbox.x2 + CH[opp.charId].width / 2 - 6;
  }

  // o は「反応の速さ」ぶん前に見えた相手の様子（cpu.js の history の1つ）
  function stateOf(state, index, o) {
    const { POSE } = SF.game;
    const CH = SF.characters.CHARACTERS;
    const me = state.fighters[index];
    const opp = state.fighters[1 - index];
    const dist = Math.abs(me.x - o.x) / S;

    let d;
    if (dist <= reachOf(me, opp, "throw") + 4) d = 0;
    else if (dist <= reachOf(me, opp, "standLight")) d = 1;
    else if (dist <= reachOf(me, opp, "standHeavy")) d = 2;
    else if (dist <= reachOf(me, opp, "standHeavy") + 70) d = 3;
    else if (dist <= 420) d = 4;
    else d = 5;

    let os = 0;
    if (o.pose === POSE.DOWN) os = 6;
    else if (!o.onGround) os = 5;
    else if (o.pose === POSE.HIT || o.pose === POSE.BLOCK) os = 4;
    else if (o.move) {
      const m = CH[opp.charId].moves[o.move];
      os = m && o.moveFrame >= m.startup + m.active ? 3 : 2;
    } else if (o.pose === POSE.CROUCH || o.pose === POSE.GUARD_CROUCH || o.pose === POSE.GUARD_STAND) os = 1;

    const myProj = state.projectiles.some((p) => p.owner === index) ? 1 : 0;
    let oppProj = 0;
    for (const p of o.projs) {
      const toward = Math.sign(me.x - p.x) === Math.sign(p.vx);
      if (toward && Math.abs(me.x - p.x) / S < PROJ_NEAR) oppProj = 1;
    }

    const C = SF.constants;
    const left = (C.STAGE_MARGIN + WALL_NEAR) * S;
    const right = (C.STAGE_WIDTH - C.STAGE_MARGIN - WALL_NEAR) * S;
    // 自分の後ろが端か、相手の後ろが端か
    const meBack = me.x < o.x ? me.x < left : me.x > right;
    const oppBack = me.x < o.x ? o.x > right : o.x < left;
    const w = meBack ? 1 : oppBack ? 2 : 0;

    const g = SF.game.gaugeFull(me) ? 1 : 0;
    return ((((d * OPP_LABELS.length + os) * 2 + myProj) * 2 + oppProj) * WALL_LABELS.length + w) * 2 + g;
  }

  // 状況番号を言葉にする（画面の説明用）
  function describeState(s) {
    const g = s % 2;
    s = Math.floor(s / 2);
    const w = s % 3;
    s = Math.floor(s / 3);
    const op = s % 2;
    s = Math.floor(s / 2);
    const mp = s % 2;
    s = Math.floor(s / 2);
    const os = s % OPP_LABELS.length;
    const d = Math.floor(s / OPP_LABELS.length);
    return { dist: DIST_LABELS[d], opp: OPP_LABELS[os], myProj: !!mp, oppProj: !!op, wall: WALL_LABELS[w], gauge: !!g };
  }

  // 状況番号を、距離と相手の様子の番号に分ける（学ぶ部分の方針で使う）
  //   （1つの距離・相手の様子の中に、飛び道具 2 × 2 × 画面端 3 × ゲージ 2 ＝ 24 通りある）
  function stateParts(s) {
    const os = Math.floor(s / 24) % OPP_LABELS.length;
    const d = Math.floor(s / (24 * OPP_LABELS.length));
    return { d, os, gauge: s % 2 === 1 };
  }

  // ---- 行動を選ぶ ----

  // 選べない行動。s＝今の状況番号
  //   ・飛び道具は画面に1つまで
  //   ・起き攻めは相手が倒れているときだけ（倒れていないときに選ぶと、ただの強攻撃・下段・投げと同じで、表がむだに分かれるため）
  //   ・ゲージ技はゲージが満タンのときだけ
  const OKI = ["okiStrike", "okiLow", "okiThrow"];
  function allowed(state, index, a, s) {
    const id = ACTIONS[a].id;
    if (OKI.includes(id)) return stateParts(s).os === 6;
    if (id === "super") return stateParts(s).gauge;
    if (id === "special") {
      const me = state.fighters[index];
      const sp = SF.characters.CHARACTERS[me.charId].moves.special;
      if (sp.projectile && state.projectiles.some((p) => p.owner === index)) return false;
    }
    return true;
  }

  // CPUごとの学習の記録を作る。train＝学習する（表を直す。learn-train.js が要る）か、explore＝わざと別の行動を試す確率（0〜1）、
  // alpha＝表を直す強さを決めておくとき（なければ、経験した回数が増えるほど小さくする）
  function createLearner(brain, train, explore, alpha) {
    return {
      brain,
      train: !!train,
      explore: explore === undefined ? (train ? 0.2 : PLAY_EXPLORE) : explore,
      alpha: alpha || 0,
      table: null,
      lastS: -1, // 前に考えたときの状況番号（まだなければ -1）
      lastA: -1,
      hp: [0, 0], // 前に考えたときの体力 [自分, 相手]
      downCount: [0, 0], // このラウンドでダウンした回数 [自分, 相手]（cpu.js が数える）
      downs: [0, 0], // 前に考えたときの downCount
      decisions: 0,
    };
  }

  // 様子見のときに呼ぶ。行動の id を返す
  function decide(L, rng, state, index, o) {
    const me = state.fighters[index];
    const opp = state.fighters[1 - index];
    if (!L.table) L.table = tableFor(L.brain, me.charId, opp.charId);
    const s = stateOf(state, index, o);
    if (L.train && L.lastS >= 0) SF.learnTrain.learnStep(L, state, me, opp, s); // 前の行動の得点で表を直す

    let a;
    if (SF.rng.nextInt(rng, 10000) < L.explore * 10000) {
      // 探検：学ぶ部分があれば、キャラの方針の行動から選ぶこともある。残りはでたらめ
      if (SF.learnTrain) a = SF.learnTrain.explorePick(rng, state, index, s);
      if (a === undefined) {
        do a = SF.rng.nextInt(rng, ACTIONS.length);
        while (!allowed(state, index, a, s));
      }
    } else {
      // いちばん数字の大きい行動。同じ数字が並んだら、その中からでたらめに選ぶ
      const base = s * ACTIONS.length;
      let best = -Infinity;
      let ties = 0;
      for (let k = 0; k < ACTIONS.length; k++) {
        if (!allowed(state, index, k, s)) continue;
        const v = L.table.q[base + k];
        if (v > best + 1e-9) {
          best = v;
          a = k;
          ties = 1;
        } else if (Math.abs(v - best) <= 1e-9) {
          ties += 1;
          if (SF.rng.nextInt(rng, ties) === 0) a = k;
        }
      }
    }
    L.lastS = s;
    L.lastA = a;
    L.hp = [me.health, opp.health];
    L.downs = L.downCount.slice(); // このときまでにダウンした回数 [自分, 相手]（学ぶ部分の得点で使う）
    L.frame = state.frame; // 考えたときのフレーム（学ぶ部分で、勝っている・負けている時間の得点に使う）
    L.decisions += 1;
    return ACTIONS[a].id;
  }

  // どの状況で何を選ぶか（画面の「学習AIの考え」表用）。経験の多い状況から順に、上位 limit 件
  function topStates(brain, me, opp, limit = 12) {
    const t = brain.tables[tableKey(me, opp)];
    if (!t) return [];
    const rows = [];
    for (let s = 0; s < STATES; s++) {
      let visits = 0;
      let best = 0;
      for (let a = 0; a < ACTIONS.length; a++) {
        visits += t.n[s * ACTIONS.length + a];
        if (t.q[s * ACTIONS.length + a] > t.q[s * ACTIONS.length + best]) best = a;
      }
      if (visits > 0) rows.push({ s, visits, best: ACTIONS[best].label, value: t.q[s * ACTIONS.length + best], ...describeState(s) });
    }
    rows.sort((x, y) => y.visits - x.visits);
    return rows.slice(0, limit);
  }

  // ラウンドが終わったときに呼ぶ（学習中なら、勝ち負けの得点で最後の行動の表を直す）
  function endRound(L, state, index) {
    if (L.train && L.lastS >= 0 && L.table) SF.learnTrain.learnRoundEnd(L, state, index);
    L.lastS = -1;
    L.lastA = -1;
    L.downCount = [0, 0];
    L.downs = [0, 0];
  }

  SF.learn = {
    ACTIONS,
    ACTION_INDEX,
    OPP_LABELS,
    STATES,
    STATE_VERSION,
    createBrain,
    tableFor,
    serialize,
    deserialize,
    clone,
    defaultBrain,
    fillMissing,
    currentBrain,
    setCurrentBrain,
    stateOf,
    describeState,
    stateParts,
    allowed,
    createLearner,
    decide,
    endRound,
    topStates,
  };
})(globalThis);
