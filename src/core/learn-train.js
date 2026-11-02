// 学習AIの「学ぶ部分」。学習のしくみの説明は learn.js の始めにある。
//   ・得点の付け方（与えたダメージ − 受けたダメージ、ラウンドの勝ち負け）
//   ・表の直し方（Q学習）
//   ・キャラごとの方針（学習の始めの手がかり）
//   ・学習のための1試合（tools/train.js とゲームの学習画面が使う）
// 戦うときに使う部分（状況の見方・行動の一覧・表から行動を選ぶ）は learn.js。このファイルは learn.js のあとに読む。
(function (root) {
  const SF = (root.SF = root.SF || {});

  // 学習の数字
  const GAMMA = 0.97; // 先の得点をどれくらい大事にするか（1回考えるごとにこの割合ずつ小さく見る。ダウンを取ってから起き攻めで取るまでを見通せるように）
  const MIN_ALPHA = 0.03; // 表を直す強さの下限（はじめは大きく、同じ場面を何度も経験すると小さくなる）
  const ROUND_REWARD = 1; // ラウンドの勝ち負けでもらう得点
  const DOWN_REWARD = 0.03; // 相手をダウンさせたらもらう得点（自分がダウンしたら引く）。起き攻めの機会を取りにいくように
  // 体力で勝っている間は時間がたつほど少しずつもらい、負けている間は少しずつ引かれる（1秒あたり）。
  //   勝っている側はタイムアップまで守りきってもよく、負けている側は攻めて取り返しに行かなければならないように。
  //   ラウンド1つ（60秒）ずっと勝っていても 0.3 で、ラウンドの勝ち負け（1）よりずっと小さい
  const LEAD_REWARD = 0.005;
  const PLAYER_ALPHA = 0.2; // あなたとの対戦から学ぶときの、表を直す強さ（試合数が少なくても戦い方が変わるように大きめ）
  const PLAYER_EXPLORE = 0.05; // あなたとの対戦から学ぶときに、わざと別の行動を試す確率

  // ---- キャラごとの方針（強そうな動きのまとめ） ----
  // 技の数値と、CPU同士の自動対戦の記録（どの技がダメージを取れているか）から決めた「このキャラはこう戦うと強い」。
  // 学習の始めの手がかりに使う：
  //   ・わざと別の行動を試すとき（探検）、POLICY_GUIDE の割合で、方針の行動から選ぶ（残りはでたらめ）
  //   ・まだ何も覚えていない表は、方針の行動の数字を少し高くしてから学び始める（POLICY_PRIOR）
  //   方針はあくまで手がかりで、試して損だった行動は学習で数字が下がり、選ばれなくなる。
  // 決まりは上から順に見て、最初に当てはまったものを使う。dist＝距離（DIST_LABELS の番号）、opp＝相手の様子（OPP_LABELS の番号、なければどれでも）
  //   距離：0 投げの距離、1 弱攻撃の距離、2 強攻撃の距離、3 少し遠い、4 遠い、5 とても遠い
  //   相手：0 ふつう、1 しゃがみ・ガード、2 技を出している、3 技のスキ、4 のけぞり・ガード硬直、5 空中、6 倒れている
  //   gauge: true の決まりは、自分のゲージが満タンのときだけ
  const POLICY = {
    // カゲツ：基本は待ち。大振り斬り（I）→ 飛刃（O）のキャンセルは隙が少ないので、とりあえず振りやすい。ジャンプ強攻撃は攻めに使う。
    //   跳んできたら昇り斬り。ゲージ技（月影斬）は攻められているときの切り返しと、相手が牽制などで動いたのを見て撃つ（cpu.js）
    kagetsu: [
      { gauge: true, opp: [2, 3], dist: [0, 1, 2, 3], act: { super: 3, heavy: 1 } },
      { opp: [6], dist: [0, 1, 2, 3], act: { okiStrike: 2, okiLow: 2, okiThrow: 2, wait: 1 } },
      { opp: [5], dist: [0, 1, 2, 3], act: { crouchSpecial: 4, back: 1 } },
      { opp: [3], dist: [0, 1, 2], act: { heavy: 3, special: 1 } },
      { dist: [4, 5], act: { wait: 3, special: 2, back: 1 } },
      { dist: [3], act: { wait: 2, heavy: 2, jump: 2, special: 1 } },
      { dist: [2], act: { heavy: 4, wait: 1, back: 1, jump: 1 } },
      { dist: [0, 1], act: { light: 2, heavy: 2, throw: 1, back: 1 } },
    ],
    // リン：ためた突進拳（O）も使いながら近づき、かかと落とし（I・中段、当たるとダウン）と下段で崩す。
    //   ゲージ技（練気）は攻めている最中に出し、I・S＋U・S＋I → O をくり返して攻め続ける（cpu.js）
    rin: [
      { gauge: true, opp: [0, 1, 4], dist: [0, 1, 2], act: { super: 2, heavy: 1, crouchLight: 1 } },
      { opp: [6], dist: [0, 1, 2, 3], act: { okiStrike: 2, okiLow: 2, okiThrow: 2, wait: 1 } },
      { opp: [1], dist: [2, 3], act: { dashThrow: 2, dashLow: 2, heavy: 1 } },
      { opp: [5], dist: [0, 1, 2, 3], act: { crouchSpecial: 4, back: 1 } },
      { opp: [3], dist: [0, 1, 2, 3], act: { special: 3, heavy: 2 } },
      { dist: [4, 5], act: { special: 3, dash: 2, forward: 1 } },
      { dist: [3], act: { special: 2, dash: 2, jump: 1 } },
      { dist: [2], act: { heavy: 3, crouchHeavy: 1, special: 1, dash: 1 } },
      { dist: [0, 1], act: { heavy: 3, crouchLight: 2, crouchHeavy: 2, light: 1, throw: 1 } },
    ],
    // ゲンマ：ジャンプと浮遊で逃げ回りながら異空間弾をまく。キャンセルの O は隙をさらしやすいので連続技には入れない。
    //   近づかれたら前後のワープで逃げる。ゲージ技（冥府球）をガードさせたら、上りの空中攻撃と下段で崩す（cpu.js）
    genma: [
      { gauge: true, opp: [0, 1, 2, 3], dist: [3, 4, 5], act: { super: 2, special: 1 } },
      { opp: [6], dist: [0, 1, 2], act: { okiLow: 2, okiThrow: 1, special: 1 } },
      { opp: [5], dist: [0, 1, 2], act: { backdash: 2, crouchSpecial: 1 } },
      { dist: [4, 5], act: { special: 3, jumpUp: 3, jumpBack: 1 } },
      { dist: [3], act: { special: 2, jumpUp: 2, jumpBack: 1, backdash: 1 } },
      { dist: [2], act: { backdash: 2, heavy: 2, jumpBack: 1, special: 1 } },
      { dist: [0, 1], act: { backdash: 3, dash: 2, light: 1 } },
    ],
    // ゴウ：張り手（U）で牽制し、当たったら四股踏み（S＋I）へキャンセル。大張り手（I・踏ん張り）で近づいて岩落とし（O）を狙う。
    //   ダウンさせたら、起き上がりに岩落とし、跳んだらつかみ上げ、バックステップには攻撃で択をかける（cpu.js）。ゲージ技はカゲツと同じ使い方
    gou: [
      { gauge: true, opp: [0, 1, 3], dist: [0], act: { super: 3, special: 1 } },
      { opp: [6], dist: [0, 1, 2, 3], act: { okiThrow: 3, okiStrike: 1, okiLow: 1, wait: 1 } },
      { opp: [1], dist: [2, 3], act: { dashThrow: 3, heavy: 1 } },
      { opp: [5], dist: [0, 1, 2, 3], act: { crouchSpecial: 4 } },
      { opp: [1, 4], dist: [0, 1], act: { special: 3, throw: 2, light: 1 } },
      { opp: [3], dist: [0, 1, 2], act: { special: 2, heavy: 2 } },
      { dist: [4, 5], act: { dash: 3, forward: 2, back: 1 } },
      { dist: [3], act: { heavy: 2, dash: 2, forward: 2, back: 1 } },
      { dist: [2], act: { light: 3, heavy: 2, forward: 1 } },
      { dist: [1], act: { heavy: 2, forward: 2, light: 1, special: 1 } },
      { dist: [0], act: { special: 4, throw: 1, light: 1 } },
    ],
    // ムクロ：頭転がし（O）を相手の後ろに置き、噛みつき（頭が外れているときの O）をガードさせて有利を取ってから、
    //   這い寄り（前2回）で近づいて振り下ろし（I・中段）・下段・投げで崩す。跳んできたら首伸ばし・跳ね戻り（S＋O）。
    //   ゲージ技（大口）は、頭が離れていれば攻められている最中でも出せる（cpu.js）
    mukuro: [
      { gauge: true, opp: [2, 3, 4], dist: [0, 1, 2, 3, 4], act: { super: 3, special: 1 } },
      { opp: [6], dist: [0, 1, 2, 3], act: { okiLow: 2, okiThrow: 2, okiStrike: 1, special: 1 } },
      { opp: [5], dist: [0, 1, 2, 3], act: { crouchSpecial: 4, back: 1 } },
      { opp: [1, 4], dist: [0, 1], act: { throw: 2, heavy: 2, crouchLight: 2 } },
      { dist: [4, 5], act: { dash: 3, special: 2, forward: 1 } },
      { dist: [2, 3], act: { special: 3, dash: 2, guardLow: 1 } },
      { dist: [0, 1], act: { light: 2, crouchLight: 2, special: 1, throw: 1 } },
    ],
    // カゲ：影走り（前2回）で近づいて弱攻撃と投げ（影縛りから連続技は cpu.js）で崩す。離れたら影苦無。跳んできたら朧月（S＋O）。
    //   分身（ゲージ技）は近い所で出し、入れ替えは cpu.js が攻撃の出だしで決める
    kage: [
      { gauge: true, opp: [0, 1, 2, 3], dist: [0, 1, 2], act: { super: 3, light: 1 } },
      { opp: [6], dist: [0, 1, 2, 3], act: { okiThrow: 2, okiLow: 2, okiStrike: 1 } },
      { opp: [5], dist: [0, 1, 2, 3], act: { crouchSpecial: 4, back: 1 } },
      { opp: [1, 4], dist: [0, 1], act: { throw: 3, light: 2, crouchLight: 1 } },
      { dist: [4, 5], act: { dash: 3, special: 2, forward: 1 } },
      { dist: [2, 3], act: { dash: 2, heavy: 2, special: 1, jump: 1 } },
      { dist: [0, 1], act: { light: 2, crouchLight: 2, throw: 2 } },
    ],
  };
  const POLICY_GUIDE = 0.6; // 探検のとき、方針の行動から選ぶ割合
  const POLICY_PRIOR = 0.03; // 何も覚えていない表で、方針の行動の数字をどれだけ高くしておくか（いちばん重い行動がこの値）

  // 状況番号に当てはまる方針（{ 行動の id: 重み }）。なければ null
  function policyFor(charId, s) {
    const rules = POLICY[charId];
    if (!rules) return null;
    const { d, os, gauge } = SF.learn.stateParts(s);
    const rule = rules.find((r) => r.dist.includes(d) && (!r.opp || r.opp.includes(os)) && (!r.gauge || gauge));
    return rule ? rule.act : null;
  }

  // 何も覚えていない表に、方針の手がかりを入れる
  function applyPolicyPrior(table, charId) {
    for (let s = 0; s < SF.learn.STATES; s++) {
      const act = policyFor(charId, s);
      if (!act) continue;
      const max = Math.max(...Object.values(act));
      for (const [id, w] of Object.entries(act)) table.q[s * SF.learn.ACTIONS.length + SF.learn.ACTION_INDEX[id]] = (POLICY_PRIOR * w) / max;
    }
    return table;
  }

  // 探検のとき、POLICY_GUIDE の割合で、キャラの方針の行動から重みに合わせて選ぶ。選ばなかったら undefined（でたらめに選ぶ）
  function explorePick(rng, state, index, s) {
    const L = SF.learn;
    const me = state.fighters[index];
    const act = policyFor(me.charId, s);
    if (!act || SF.rng.nextInt(rng, 100) >= POLICY_GUIDE * 100) return undefined;
    const ids = Object.keys(act).filter((id) => L.allowed(state, index, L.ACTION_INDEX[id], s));
    if (!ids.length) return undefined;
    let r = SF.rng.nextInt(rng, ids.reduce((t, id) => t + act[id], 0));
    for (const id of ids) {
      if (r < act[id]) return L.ACTION_INDEX[id];
      r -= act[id];
    }
    return undefined;
  }

  // ---- 得点と表の直し方 ----

  function bestValue(table, s) {
    const n = SF.learn.ACTIONS.length;
    let best = -Infinity;
    for (let a = 0; a < n; a++) if (table.q[s * n + a] > best) best = table.q[s * n + a];
    return best;
  }

  // 前に考えたときから今までに「相手に与えたダメージ − 受けたダメージ」（体力の割合）と、ダウンの得点
  function damageReward(L, me, opp) {
    const CH = SF.characters.CHARACTERS;
    const dealt = (L.hp[1] - opp.health) / CH[opp.charId].health;
    const taken = (L.hp[0] - me.health) / CH[me.charId].health;
    const downs = (L.downCount[1] - L.downs[1] - (L.downCount[0] - L.downs[0])) * DOWN_REWARD;
    return dealt - taken + downs;
  }

  // 前に考えたときから今までの時間で、体力（割合）で勝っていればプラス、負けていればマイナス
  function leadReward(L, state, me, opp) {
    const CH = SF.characters.CHARACTERS;
    const lead = me.health / CH[me.charId].health - opp.health / CH[opp.charId].health;
    if (Math.abs(lead) < 1e-9 || L.frame === undefined) return 0;
    const seconds = Math.max(0, state.frame - L.frame) / 60;
    return Math.sign(lead) * LEAD_REWARD * seconds;
  }

  // 前の行動の表の数字を、もらった得点と「次の状況でいちばん良い数字」に近づける（Q学習）。nextS が -1 ならラウンドの終わり
  function update(L, reward, nextS) {
    const t = L.table;
    const i = L.lastS * SF.learn.ACTIONS.length + L.lastA;
    t.n[i] += 1;
    const alpha = L.alpha || Math.max(MIN_ALPHA, 1 / t.n[i]);
    const target = reward + (nextS >= 0 ? GAMMA * bestValue(t, nextS) : 0);
    t.q[i] += alpha * (target - t.q[i]);
  }

  // 様子見で考えるたびに learn.decide から呼ばれる（学習中だけ）
  function learnStep(L, state, me, opp, s) {
    update(L, damageReward(L, me, opp) + leadReward(L, state, me, opp), s);
  }

  // ラウンドが終わったときに learn.endRound から呼ばれる（学習中だけ）
  function learnRoundEnd(L, state, index) {
    const me = state.fighters[index];
    const opp = state.fighters[1 - index];
    const w = state.round.winner;
    const bonus = w === index ? ROUND_REWARD : w === 1 - index ? -ROUND_REWARD : 0;
    update(L, damageReward(L, me, opp) + leadReward(L, state, me, opp) + bonus, -1);
  }

  // ---- 学習の実行（画面なしで1試合） ----

  // 学習のための1試合。learnSide＝学習AIの側（0か1）、explore＝探検の確率。
  // opponent＝相手：0〜2 ならその強さのCPU、{ brain } なら学習AI（その頭脳を使い、相手は学習しない）。
  //   学習AI同士は、相手に「少し前の自分のコピー（学習しない）」を使う。両方が同時に学ぶと、
  //   たまたま先に勝ち始めた方に引っぱられて片方が守りに閉じこもってしまうため。
  // 結果は autobattle.runMatch と同じ形
  function trainMatch(brain, seed, chars, learnSide, opponent, explore) {
    const LEARN = SF.cpu.LEARN_LEVEL;
    const levels = [0, 0];
    const brains = [brain, brain];
    levels[learnSide] = LEARN;
    if (typeof opponent === "number") levels[1 - learnSide] = opponent;
    else {
      levels[1 - learnSide] = LEARN;
      brains[1 - learnSide] = opponent.brain;
    }
    const train = [false, false];
    train[learnSide] = true;
    const res = SF.autobattle.runMatch(seed, chars, levels, { brains, train, explore });
    SF.learn.tableFor(brain, chars[learnSide], chars[1 - learnSide]).matches += 1;
    return res;
  }

  SF.learnTrain = {
    POLICY,
    policyFor,
    applyPolicyPrior,
    explorePick,
    PLAYER_ALPHA,
    PLAYER_EXPLORE,
    learnStep,
    learnRoundEnd,
    trainMatch,
  };
})(globalThis);
