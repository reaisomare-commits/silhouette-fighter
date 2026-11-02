// CPU（コンピューターの対戦相手）。強さは「よわい・ふつう・つよい」の3段階。
// プレイヤーと同じ「キー入力（ボタンのビット）」を作って渡すだけで、特別な動きはしない。
// 相手の様子は「反応の速さ」のフレーム数だけ前のものしか見えない（人間が見てから動くのと同じ）。
// ガード・投げ抜け・ヒット確認も人間と同じく「見えてから」しか正しく反応できない：
//   ・相手の技は「見てから反応」のフレーム数がたってから種類（中段・下段）がわかる。それより速い技は、
//     その時の構え（立ちガード・しゃがみガード・投げ抜け狙いのどれで待っていたか）で受ける。読みが外れたら当たる
//   ・投げ抜けは、投げ抜けを狙って待っていたときだけ。そのかわり、その間は打撃をガードしそこないやすい
//   ・連続技は、当たったのを見てから次をつなぐ。見る前に技が終わってしまう弱攻撃からは、当たったか見ずに出しきるか止めるかを決める
// 乱数はCPUごとに自分の種を持つので、同じ種なら同じ試合になる。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const { BUTTON } = SF.input;
  const { CHARACTERS } = SF.characters;
  const S = SF.constants.SCALE;

  // 強さの数字。調整するときはここを書き換える（確率は%）
  //   reaction: 反応の速さ（相手の位置やジャンプが何フレーム遅れて見えるか。様子見の考え直しの間隔もこれ）
  //   see: 相手の技の種類（中段・下段）や、自分の技が当たったかガードされたかが、何フレームたつと見えるか
  //   guard: ガードできる確率（相手の技1つごとに決める）。見えていない速い技は、構えが合っていないと防げない
  //   antiAir: 相手が跳んできたときに対空技（S+O）を出す確率（1回のジャンプごとに決める）
  //   combo: 連続技を最後までつなぐ確率（失敗すると途中で止める）
  //   commit: 当たったかを見る前に技が終わってしまうとき（弱攻撃から）、見ずに連続技を出しきる確率
  //   tech: 投げ抜けを狙って待つ割合（構えを決めるたびに。投げ抜けできるのはこのときだけ）
  //   superUse: ゲージが満タンのとき、ゲージ技を使う確率（連続技の締め・切り返しなど、場面ごとに決める）
  const LEVELS = [
    { id: "easy", label: "よわい", reaction: 30, see: 30, guard: 30, antiAir: 20, combo: 30, commit: 20, tech: 0, superUse: 20 },
    { id: "normal", label: "ふつう", reaction: 18, see: 20, guard: 60, antiAir: 50, combo: 70, commit: 35, tech: 25, superUse: 50 },
    { id: "hard", label: "つよい", reaction: 10, see: 15, guard: 85, antiAir: 80, combo: 95, commit: 50, tech: 40, superUse: 80 },
    // 学習AI：反射神経（反応・ガード・対空・連続技・投げ抜け）は「つよい」と同じで、
    // 様子見で何をするかだけを機械学習（src/core/learn.js）の表で決める
    { id: "learn", label: "学習AI", reaction: 10, see: 15, guard: 85, antiAir: 80, combo: 95, commit: 50, tech: 40, superUse: 80, learned: true },
  ];
  const LEARN_LEVEL = LEVELS.findIndex((lv) => lv.learned);

  // 連続技のつなぎ方。始めの技ごとに、そのあと押すボタンの順番
  //   "light"＝U、"heavy"＝I、"special"＝O、"crouchSpecial"＝S+O（しゃがみ技からはS押しっぱなし）
  const COMBOS = {
    kagetsu: {
      standLight: ["heavy", "special"], // 柄打ち → 大振り斬り → 飛刃
      standHeavy: ["special"], // 大振り斬り → 飛刃（隙が少ないので、ガードされても出す）
      crouchLight: ["special"], // 足元突き → 飛刃
    },
    rin: {
      standLight: ["light", "heavy", "special"], // ジャブ → ジャブ → 回し蹴り → 突進拳
      standHeavy: ["special"], // 回し蹴り → 突進拳
      crouchLight: ["light", "heavy"], // 小足 → 小足 → 足払い
    },
    genma: {
      standLight: ["heavy", "crouchSpecial"], // 闇爪 → 影の鎌 → 闇柱
      standHeavy: ["crouchSpecial"], // 影の鎌 → 闇柱
      crouchLight: ["heavy"], // 影這い → 闇溜まり
    },
    // ゴウ：張り手やすね蹴りから四股踏み（のけぞり中の相手は掴めないので、投げは連続技に入れない）
    gou: {
      standLight: ["crouchHeavy"], // 張り手 → 四股踏み
      crouchLight: ["crouchHeavy"], // すね蹴り → 四股踏み
    },
  };
  // ガードされても続ける連続技（隙の少ないキャンセル）。カゲツの大振り斬り → 飛刃
  const BLOCK_COMBOS = {
    kagetsu: { standHeavy: ["special"] },
  };

  // 様子見のときに選ぶ行動と、その選びやすさ（重み）。距離は「近い・中くらい・遠い」の3つ
  //   近い＝弱攻撃が届く、中くらい＝強攻撃が届く、遠い＝それより外
  const PLANS = {
    kagetsu: {
      near: { light: 30, crouchLight: 20, throw: 20, crouchHeavy: 10, back: 12, wait: 8 },
      mid: { heavy: 35, forward: 25, crouchHeavy: 10, special: 10, wait: 15, back: 5 },
      far: { special: 40, forward: 40, wait: 20 },
    },
    rin: {
      near: { light: 30, crouchLight: 20, throw: 25, crouchHeavy: 10, back: 8, wait: 7 },
      mid: { heavy: 25, forward: 30, dash: 15, jump: 15, wait: 10, crouchHeavy: 5 },
      far: { forward: 40, dash: 25, jump: 20, wait: 15 },
    },
    // ゲンマ：近づかれたらワープで離れ、遠くから異空間弾。垂直ジャンプで浮いて空中からも撃つ
    genma: {
      near: { light: 25, crouchLight: 20, throw: 20, backdash: 15, crouchHeavy: 10, wait: 10 },
      mid: { heavy: 30, backdash: 20, crouchHeavy: 10, jumpUp: 10, back: 10, wait: 20 },
      far: { special: 40, jumpUp: 20, dash: 15, wait: 15, forward: 10 },
    },
    // ゴウ：踏み込みとガードで近づき、近ければ岩落とし（コマンド投げ）と投げ、張り手で止める
    gou: {
      near: { special: 30, throw: 15, light: 20, crouchLight: 15, crouchHeavy: 5, wait: 10, guardLow: 5 },
      mid: { forward: 30, dash: 25, light: 20, heavy: 10, crouchHeavy: 5, wait: 10 },
      far: { forward: 40, dash: 40, jump: 5, wait: 15 },
    },
  };

  // 浮遊できるキャラ（ゲンマ）が、1回のジャンプで浮くか・空中の飛び道具を撃つかを決める確率（%）
  const FLOAT_CHANCE = 60;
  const AIR_SHOT_CHANCE = 60;

  // 構えを決めるとき、投げ抜け狙いでなければ、しゃがみガードで待つ割合（%）。下段と中段を防げるので多め。
  // 立ちガードで待つと、中段（リンの回し蹴り）と跳び込みを防げる
  const CROUCH_GUESS = 65;
  const PROJECTILE_ALERT = 260; // 飛び道具がこれより近づいたらガードを考える（ピクセル）
  const ANTI_AIR_RANGE = 130; // 跳んできた相手がこれより近づいたら対空技を出す（ピクセル、横の距離）
  const HISTORY = 64;
  const SUPER = BUTTON.HEAVY | BUTTON.SPECIAL; // ゲージ技（I＋O の同時押し）
  // ゲージ技を様子見のときに使う場面。band＝距離（近い・中くらい・遠い）、rate＝superUse の何分の1の確率で使うか
  //   カゲツの月影斬は突進するので中くらい〜少し遠い所から、リンの練気は近づく前に、ゲンマの冥府球は離れた所から
  //   confirm: 様子見で使わず、相手が技（牽制など）を出したのを見て、届く距離なら撃つ（技1つごとに superUse の確率）
  //   カゲツの月影斬・ゴウの大地落としは「攻められているときの切り返し」と「相手が動いたのを見て」。リンの練気は近づいて攻めている最中に。
  //   ゲンマの冥府球は離れた所から（ガードさせたら、後ろからついて行って上りの空中攻撃と下段で崩す）
  const SUPER_PLAN = {
    kagetsu: { confirm: true, maxDist: 300 },
    rin: { bands: ["near"], maxDist: 999, rate: 2 },
    genma: { bands: ["mid", "far"], maxDist: 999, rate: 3 },
    gou: { confirm: true, maxDist: 240, grab: true },
  };
  // リンの練気で強くなっている間の連続技（すべての攻撃がキャンセルできるので長くつなぐ）
  //   回し蹴り・小足・足払いと突進拳を交互にキャンセルし続けて、ガードされても攻めを続ける
  const BUFF_COMBOS = {
    rin: {
      standLight: ["heavy", "special", "crouchLight", "special", "heavy", "special"], // ジャブ → 回し蹴り → 突進拳 → 小足 → 突進拳 → 回し蹴り → 突進拳
      standHeavy: ["special", "crouchLight", "special", "crouchHeavy", "special"], // 回し蹴り → 突進拳 → 小足 → 突進拳 → 足払い → 突進拳
      crouchLight: ["special", "heavy", "special", "crouchHeavy", "special"], // 小足 → 突進拳 → 回し蹴り → 突進拳 → 足払い → 突進拳
      crouchHeavy: ["special", "heavy", "special", "crouchLight", "special"], // 足払い → 突進拳 → 回し蹴り → 突進拳 → 小足 → 突進拳
    },
  }; // 相手の様子を何フレーム前まで覚えておくか（反応の速さより長く）

  // opts は学習AIのときだけ使う：brain＝使う頭脳（なければ今の頭脳）、train＝学習するか、explore＝わざと別の行動を試す確率、alpha＝表を直す強さ
  function createCpu(level = 1, seed = 1, opts = {}) {
    const learner = LEVELS[level].learned ? SF.learn.createLearner(opts.brain || SF.learn.currentBrain(), opts.train, opts.explore, opts.alpha) : null;
    return {
      learner, // 学習AIの記録（学習AIでなければ null）
      level,
      rng: SF.rng.createRng(seed ^ 0x5bd1e995),
      history: [], // 相手の様子（古い順）
      prev: 0, // 前のフレームに出した入力
      noGuard: 0, // このフレームで押さない方向キー（ガードしないと決めた技の間の「後ろ」）
      queue: [], // これから出す入力（1フレームに1つずつ）
      hold: 0, // 考え直すまで押し続ける方向キー
      thinkTimer: 0, // 次に様子見の行動を考え直すまでのフレーム
      // 相手の技と飛び道具に番号をつけて、1つごとにガードするかを1回だけ決める
      oppMoveId: 0,
      oppLastMove: null,
      oppLastFrame: 0,
      oppProjCount: 0,
      projId: 0,
      guardKey: null,
      guardOk: false, // 見えていない間に、構えで受けられるか（技1つごとに決める）
      seenOk: null, // 見えてから、正しい種類でガードできるか（見えたときに決める）
      stance: "stand", // 構え（読み）："stand"＝立ちガード、"crouch"＝しゃがみガード、"tech"＝投げ抜け狙い
      stanceTimer: 0, // 次に構えを決め直すまでのフレーム
      // 相手のジャンプにも番号をつけて、1回ごとに対空を出すかを決める
      jumpId: 0,
      oppWasAir: false,
      antiAirKey: null,
      antiAirOk: false,
      // 自分の技にも番号をつけて、連続技を続けるかを決める
      myMoveId: 0,
      myLastMove: null,
      myLastFrame: 0,
      comboStep: 0, // 今の連続技で何回つないだか
      comboFrom: null, // 連続技の始めの技
      comboStop: null, // 今の連続技で何回つないだら止めるか
      comboPressedFor: -1, // どの技のときにつなぎのボタンを押したか
      comboSuper: false, // 今の連続技の締めをゲージ技にするか
      contactFor: -1, // どの技（自分の技の番号）が当たったかガードされたのを、もう数えたか
      contactAt: 0, // 連続技の1発目が当たった（ガードされた）フレーム
      blind: false, // 当たったかを見る前に今の技が終わるので、見ずに決めるか
      blindGo: null, // 見ずに決めるとき、つなぐか（連続技1回ごとに決める）
      confirmKey: null, // 相手の技を見てゲージ技を撃つかを決めた、相手の技の番号
      chargeLeft: 0, // ためる技（リンの突進拳）で、あと何フレーム O を押し続けるか
      rising: false, // このジャンプで、跳んですぐ（上りで）空中攻撃を出すか
      macro: null, // 学習AIのひとまとまりの攻め（起き攻め・ダッシュからの崩し）：{ kind, move, timer }
      downWas: [false, false], // 前のフレームでダウンしていたか [自分, 相手]（学習AIの得点用に、ダウンした回数を数える）
      okiPlan: null, // ゴウの起き攻め：相手が倒れている間に決める（"grab"＝起き上がりに重ねて岩落とし、"watch"＝様子を見て対応）
      okiWatch: 0, // 起き上がりを見ている残りフレーム
      reversalOk: false, // 今の相手の技に、ゲージ技で切り返すか（無敵のあるゲージ技だけ）
      techAt: -1, // 投げ抜けのU＋Iを押すフレーム
      grabbed: 0, // 掴まれたフレーム（掴まれていなければ0）
      myAir: false, // 前のフレームで自分が空中にいたか（ジャンプ1回ごとに浮くかを決める）
      floatPlan: false, // このジャンプで浮くか
      airShotPlan: false, // このジャンプで空中の飛び道具を撃つか
    };
  }

  function nextLevel(cpu) {
    cpu.level = (cpu.level + 1) % LEVELS.length;
  }

  // 0〜99 の乱数が p より小さければ成功（p%の確率）
  function chance(cpu, p) {
    return SF.rng.nextInt(cpu.rng, 100) < p;
  }

  function pick(cpu, weights) {
    const keys = Object.keys(weights);
    let total = 0;
    for (const k of keys) total += weights[k];
    let r = SF.rng.nextInt(cpu.rng, total);
    for (const k of keys) {
      if (r < weights[k]) return k;
      r -= weights[k];
    }
    return keys[keys.length - 1];
  }

  // 今の相手の様子を覚える。技・飛び道具・ジャンプに番号をつける
  function observe(cpu, state, index) {
    const opp = state.fighters[1 - index];
    if (opp.move && (opp.move !== cpu.oppLastMove || opp.moveFrame < cpu.oppLastFrame)) cpu.oppMoveId += 1;
    cpu.oppLastMove = opp.move;
    cpu.oppLastFrame = opp.moveFrame;
    const projs = state.projectiles.filter((p) => p.owner === 1 - index);
    if (projs.length > cpu.oppProjCount) cpu.projId += 1;
    cpu.oppProjCount = projs.length;
    const air = !opp.onGround && opp.pose === SF.game.POSE.JUMP;
    if (air && !cpu.oppWasAir) cpu.jumpId += 1;
    cpu.oppWasAir = air;
    cpu.history.push({
      x: opp.x,
      y: opp.y,
      vx: opp.vx,
      vy: opp.vy,
      onGround: opp.onGround,
      pose: opp.pose,
      move: opp.move,
      moveFrame: opp.moveFrame,
      moveHit: opp.moveHit,
      moveId: cpu.oppMoveId,
      jumpId: cpu.jumpId,
      projs: projs.map((p) => ({ x: p.x, vx: p.vx })),
      projId: cpu.projId,
    });
    if (cpu.history.length > HISTORY) cpu.history.shift();
  }

  // 反応の速さのぶんだけ前の相手の様子
  function seen(cpu) {
    const delay = LEVELS[cpu.level].reaction;
    const i = Math.max(0, cpu.history.length - 1 - delay);
    return cpu.history[i];
  }

  // delay フレーム前の相手の様子
  function seenAgo(cpu, delay) {
    return cpu.history[Math.max(0, cpu.history.length - 1 - delay)];
  }

  // 今の脅威（相手の技・飛び道具）が、見てから反応のフレーム数より前から出ていた（＝もう見えている）か
  function visibleThreat(cpu, lv, t) {
    const ov = seenAgo(cpu, lv.see);
    if (t.kind === "p") return ov.projId >= t.id && ov.projs.length > 0;
    return ov.moveId === t.id && !!ov.move;
  }

  // 構え（読み）を決め直す：反応の速さごとに、立ちガード・しゃがみガード・投げ抜け狙いのどれで待つか。
  // 学習AIや様子見で後ろ（ガード）を押しているときは、その構え
  function updateStance(cpu, lv, back) {
    if (cpu.stanceTimer > 0) {
      cpu.stanceTimer -= 1;
      return;
    }
    cpu.stanceTimer = lv.reaction;
    if (cpu.hold & back) cpu.stance = cpu.hold & BUTTON.DOWN ? "crouch" : "stand";
    else cpu.stance = chance(cpu, lv.tech) ? "tech" : chance(cpu, CROUCH_GUESS) ? "crouch" : "stand";
  }

  // 見えている相手の技が、自分に届きそうなら { key, guard } を返す（ガードの種類 "mid"・"low"・"high"・"air"）
  function threat(cpu, me, opp, o) {
    const dist = Math.abs(me.x - o.x) / S;
    // 飛び道具がこちらに向かってきている
    for (const p of o.projs) {
      const toward = Math.sign(me.x - p.x) === Math.sign(p.vx);
      if (toward && Math.abs(me.x - p.x) / S < PROJECTILE_ALERT) return { key: "p" + o.projId, kind: "p", id: o.projId, guard: "mid" };
    }
    if (!o.move || o.moveHit) return null;
    const m = CHARACTERS[opp.charId].moves[o.move];
    // ガードできない投げの技（ゴウの岩落とし・大地落とし）：掴まれる前なら、弱攻撃で止めるか跳んで避ける（guard: "grab"）
    // （暗転のあとでは避けられない大地落としは除く）
    if (m && m.kind === "throw" && o.move !== "throw" && !m.antiAir && !m.catchAfterFreeze && o.moveFrame < m.startup) {
      let grabReach = m.hitbox.x2 + CHARACTERS[me.charId].width / 2 + 10;
      if (m.lunge) grabReach += (m.lunge.to - m.lunge.from + 1) * m.lunge.speed;
      return dist <= grabReach ? { key: "m" + o.moveId, kind: "m", id: o.moveId, guard: "grab", lunge: !!m.lunge } : null;
    }
    if (!m || m.kind === "throw" || !m.hitbox) return null;
    // 当たる時間が終わった技はもう怖くない
    if (o.moveFrame >= m.startup + m.active) return null;
    let reach = m.hitbox.x2 + CHARACTERS[me.charId].width / 2 + 30;
    if (m.lunge) reach += (m.lunge.to - m.lunge.from + 1) * m.lunge.speed;
    if (dist > reach) return null;
    return { key: "m" + o.moveId, kind: "m", id: o.moveId, guard: m.guard };
  }

  // 自分の技の届く距離（体の中心どうしの距離、ピクセル）
  function reachOf(me, opp, name) {
    const m = CHARACTERS[me.charId].moves[name];
    return m.hitbox.x2 + CHARACTERS[opp.charId].width / 2 - 6;
  }

  function buttonFor(kind) {
    return { light: BUTTON.LIGHT, heavy: BUTTON.HEAVY, special: BUTTON.SPECIAL }[kind];
  }

  // このフレームのCPUの入力を作る。index はCPUが何番目のキャラか
  function input(cpu, state, index) {
    const { POSE, PHASE, isFree } = SF.game;
    const lv = LEVELS[cpu.level];
    const me = state.fighters[index];
    const opp = state.fighters[1 - index];
    observe(cpu, state, index);
    const o = seen(cpu);
    // 学習AI：ダウンした回数を数える（学ぶ部分が、相手をダウンさせたら得点を足す）
    if (cpu.learner) {
      for (const k of [0, 1]) {
        const down = state.fighters[k === 0 ? index : 1 - index].pose === SF.game.POSE.DOWN;
        if (down && !cpu.downWas[k]) cpu.learner.downCount[k] += 1;
        cpu.downWas[k] = down;
      }
    }
    const forward = me.facing === 1 ? BUTTON.RIGHT : BUTTON.LEFT;
    const back = me.facing === 1 ? BUTTON.LEFT : BUTTON.RIGHT;

    let out = 0;
    cpu.noGuard = 0; // このフレームで押さない方向キー（ガードしないと決めた技の間の「後ろ」）
    if (state.round.phase !== PHASE.FIGHT) {
      if (cpu.learner) SF.learn.endRound(cpu.learner, state, index); // ラウンドの勝ち負けを学習に伝える
      cpu.queue = [];
      cpu.hold = 0;
      cpu.thinkTimer = 0;
      cpu.macro = null;
      return finish(cpu, 0);
    }

    // 自分の技に番号をつける（連続技の管理）。つなぎのボタンで出た技でなければ、連続技はここから
    if (me.move && (me.move !== cpu.myLastMove || me.moveFrame < cpu.myLastFrame)) {
      cpu.myMoveId += 1;
      if (cpu.comboPressedFor !== cpu.myMoveId - 1) {
        cpu.comboFrom = me.move;
        cpu.comboStep = 0;
        cpu.comboStop = null;
      }
    }
    cpu.myLastMove = me.move;
    cpu.myLastFrame = me.moveFrame;

    // 掴まれた：投げ抜けを狙って待っていたときだけ、少し遅れてU＋I（投げを読んでいなければ抜けられない）
    updateStance(cpu, lv, back);
    if (me.pose === POSE.THROWN) {
      cpu.queue = [];
      cpu.hold = 0;
      if (!cpu.grabbed) {
        cpu.grabbed = state.frame;
        cpu.techAt = cpu.stance === "tech" ? state.frame + 2 + SF.rng.nextInt(cpu.rng, 5) : -1;
      }
      if (state.frame === cpu.techAt) out = BUTTON.LIGHT | BUTTON.HEAVY;
      return finish(cpu, out);
    }
    cpu.grabbed = 0;

    // ためる技（リンの突進拳）：決めたフレーム数だけ O を押し続けてから離す
    if (cpu.chargeLeft > 0) {
      cpu.chargeLeft -= 1;
      if (me.move === "special" || (isFree(me) && cpu.chargeLeft > 0)) {
        cpu.prev = BUTTON.SPECIAL | cpu.hold;
        return cpu.prev;
      }
      cpu.chargeLeft = 0;
    }

    // 決めてある入力があればそれを出す（ボタンを押す・離す、しゃがんでからOなど）
    if (cpu.queue.length) return finish(cpu, cpu.queue.shift());

    // 連続技：自分の技が当たったら、決めた確率で次のボタンを押す
    //   ガードされたときは、ガードされても続ける連続技（BLOCK_COMBOS、リンの練気の間は BUFF_COMBOS）だけ
    //   ヒット確認：当たったかガードされたかは「見てから反応」のフレーム数がたってからわかる。
    //   それより前に技が終わってしまう（弱攻撃など）ときは、見ずに次をつなぐか（commit の確率、連続技1回ごとに決める）、そこで止めるかを決める。
    //   見ずにつなぐと、ガードされていてもつないでしまう（隙をさらす）。つないでいる間に見えたら、そこからは見て決める
    if (me.move && me.moveHit && (opp.pose === POSE.HIT || opp.pose === POSE.BLOCK) && cpu.contactFor !== cpu.myMoveId) {
      cpu.contactFor = cpu.myMoveId;
      // 連続技の1発目が当たった（ガードされた）時から数える。2発目・3発目の間に見えれば、そこで確認できる
      if (cpu.comboStep === 0) {
        cpu.contactAt = state.frame;
        cpu.blindGo = null;
      }
      // この技が終わるまでに見えるか（当たった瞬間に止まる時間は、ガードされたときの短い方で数える。どちらかはまだわからないので）
      const mm = CHARACTERS[me.charId].moves[me.move];
      const left = mm.startup - 1 + mm.active + mm.recovery - me.moveFrame + SF.characters.BATTLE.hitstopBlock;
      cpu.blind = state.frame - cpu.contactAt + left < lv.see;
      if (cpu.blind && cpu.blindGo === null) cpu.blindGo = chance(cpu, lv.commit);
    }
    const confirmed = state.frame - cpu.contactAt >= lv.see;
    const blocked = opp.pose === POSE.BLOCK && !(cpu.blind && cpu.blindGo);
    if (me.move && me.moveHit && (opp.pose === POSE.HIT || opp.pose === POSE.BLOCK) && cpu.comboPressedFor !== cpu.myMoveId && (confirmed || cpu.blind)) {
      const buffed = SF.game.cancelAllActive(me);
      const routes = buffed && BUFF_COMBOS[me.charId] ? BUFF_COMBOS[me.charId] : blocked ? BLOCK_COMBOS[me.charId] : COMBOS[me.charId];
      // 見ずに止めると決めたら、つながない。ただし弱攻撃へのつなぎ（ガードされても隙が少ない）は、見る時間をかせぐためにつなぐ。
      // リンの練気の間は、ガードされても続けられるのでつなぐ
      let route = (routes || {})[cpu.comboFrom];
      const nextMove = route && route[cpu.comboStep];
      if (cpu.blind && !cpu.blindGo && !buffed && nextMove !== "light" && nextMove !== "crouchLight") route = null;
      if (route && cpu.comboStep < route.length) {
        // 最後までつなぐかを1回だけ決める。失敗するときは途中のどこかで止める（1回もつながないこともある）
        if (cpu.comboStop === null) {
          cpu.comboStop = chance(cpu, lv.combo) ? route.length : SF.rng.nextInt(cpu.rng, route.length);
          // ゲージが満タンなら、最後のつなぎをゲージ技にするかを決める（当たる技で、そのまま連続技になるカゲツの月影斬だけ）
          const sup = CHARACTERS[me.charId].moves.super;
          cpu.comboSuper = !!(sup && sup.hitbox) && !(SUPER_PLAN[me.charId] || {}).confirm && SF.game.gaugeFull(me) && chance(cpu, lv.superUse);
        }
        if (cpu.comboStep < cpu.comboStop) {
          const last = cpu.comboStep === route.length - 1;
          const next = last && cpu.comboSuper && SF.game.gaugeFull(me) ? "super" : route[cpu.comboStep];
          cpu.comboStep += 1;
          cpu.comboPressedFor = cpu.myMoveId;
          const down = cpu.comboFrom.startsWith("crouch") ? BUTTON.DOWN : 0;
          if (next === "super") cpu.queue.push(down, down | SUPER);
          else if (next === "crouchSpecial") cpu.queue.push(BUTTON.DOWN, BUTTON.DOWN | BUTTON.SPECIAL);
          else if (next === "crouchLight") cpu.queue.push(BUTTON.DOWN, BUTTON.DOWN | BUTTON.LIGHT);
          else if (next === "crouchHeavy") cpu.queue.push(BUTTON.DOWN, BUTTON.DOWN | BUTTON.HEAVY);
          else if (next === "special") cpu.queue.push(0, BUTTON.SPECIAL); // O は S を離して（S＋O の対空技にならないように）
          else cpu.queue.push(0, buttonFor(next));
          return finish(cpu, cpu.queue.shift());
        }
        cpu.comboPressedFor = cpu.myMoveId;
      }
    }

    // ガード：相手が技を出したら、技1つごとに決める。
    //   見えるまで（see フレーム）は、構え（読み）で受ける：構えが合っていて guardOk なら防げる。下段に立ちガード、中段（上から）にしゃがみガードは外れ。
    //     投げ抜け狙いで待っていたときは、しゃがみガードで受けるが、打撃をガードできる確率が半分
    //   見えてからは、正しい種類のガードをする（技1つごとに guard の確率）。発生の遅い技なら間に合う
    const t = threat(cpu, me, opp, cpu.history[cpu.history.length - 1]);
    if (t) {
      if (cpu.guardKey !== t.key) {
        cpu.guardKey = t.key;
        cpu.guardOk = chance(cpu, cpu.stance === "tech" ? lv.guard / 2 : lv.guard);
        cpu.seenOk = null;
        cpu.reversalOk = false;
      }
      const visible = visibleThreat(cpu, lv, t);
      if (visible && cpu.seenOk === null) {
        cpu.seenOk = chance(cpu, lv.guard);
        // 切り返し：ゲージが満タンで、出だしが無敵のゲージ技があれば、見えた相手の技（飛び道具でないもの）にゲージ技を合わせるかを決める
        const sup = CHARACTERS[me.charId].moves.super;
        cpu.reversalOk = !!(sup && sup.invincible) && t.kind === "m" && SF.game.gaugeFull(me) && chance(cpu, lv.superUse / 2);
      }
      if (cpu.reversalOk && isFree(me) && me.onGround && me.landingTimer === 0) {
        cpu.reversalOk = false;
        cpu.hold = 0;
        cpu.thinkTimer = 0;
        return finish(cpu, SUPER);
      }
      // 跳んでいる相手の空中攻撃は、跳んだのが見えていれば立ちガードで待てる
      const airSeen = t.guard === "air" && !seenAgo(cpu, lv.see).onGround;
      let guardAs = null; // "stand"・"crouch"・null（ガードしない）
      if (t.guard === "grab") {
        // ガードできない投げの技：見えてから（突進するもの）か、投げ抜け狙いで待っていたときだけ逃げられる
        const dodge = visible ? cpu.seenOk : cpu.stance === "tech" && cpu.guardOk;
        // 突進して掴む技（大地落とし）は後ろへ跳んで避け、その場で掴む技（岩落とし）は弱攻撃で止める
        if (dodge && isFree(me) && me.onGround && me.landingTimer === 0) {
          cpu.guardOk = false;
          cpu.seenOk = false;
          cpu.hold = 0;
          cpu.thinkTimer = 0;
          if (t.lunge) {
            cpu.hold = back;
            cpu.thinkTimer = 50;
            return finish(cpu, BUTTON.JUMP | back);
          }
          return finish(cpu, BUTTON.LIGHT);
        }
      } else if (visible || airSeen) {
        if (visible ? cpu.seenOk : cpu.guardOk) guardAs = t.guard === "low" ? "crouch" : t.guard === "mid" && cpu.stance !== "stand" ? "crouch" : "stand";
      } else if (cpu.guardOk) {
        // 投げ抜け狙いのときは、しゃがみガードしながら投げに備える
        guardAs = cpu.stance === "stand" ? "stand" : "crouch";
      }
      if (t.guard !== "grab" && guardAs && me.onGround) {
        cpu.hold = 0;
        cpu.thinkTimer = 0;
        return finish(cpu, back | (guardAs === "crouch" ? BUTTON.DOWN : 0));
      } else if (t.guard !== "grab") {
        // ガードしないと決めた技の間は、何をしていても後ろを押さない（構えない）。
        // 学習AIが「下がる」「しゃがみガード」を選ぶと、決めた確率より多くガードできてしまうため
        cpu.noGuard = back;
        cpu.hold &= ~back;
      }
    }
    // ガード硬直の間は構えを続ける（次の技にも備える）
    if (me.pose === POSE.BLOCK && !cpu.noGuard) return finish(cpu, back | (me.crouching ? BUTTON.DOWN : 0));

    const free = isFree(me) && me.onGround && me.landingTimer === 0;
    const dist = Math.abs(me.x - o.x) / S;

    // 対空：相手が跳んできたら、ジャンプ1回ごとに対空技を出すかを決める
    if (free && !o.onGround && o.pose === POSE.JUMP && dist < ANTI_AIR_RANGE) {
      const key = o.jumpId;
      if (cpu.antiAirKey !== key) {
        cpu.antiAirKey = key;
        cpu.antiAirOk = chance(cpu, lv.antiAir);
      }
      if (cpu.antiAirOk && o.vy > -4 * S) {
        cpu.antiAirOk = false;
        cpu.hold = 0;
        cpu.queue.push(BUTTON.DOWN | BUTTON.SPECIAL);
        return finish(cpu, BUTTON.DOWN);
      }
    }

    // 浮遊できるキャラ：ジャンプ1回ごとに浮くか・空中の飛び道具を撃つかを決める
    const st = CHARACTERS[me.charId];
    if (!me.onGround && !cpu.myAir) {
      cpu.floatPlan = !!st.float && chance(cpu, FLOAT_CHANCE);
      cpu.airShotPlan = !!st.moves.airSpecial && chance(cpu, AIR_SHOT_CHANCE);
    }
    cpu.myAir = !me.onGround;
    if (!me.onGround && st.moves.airSpecial && cpu.airShotPlan && !me.move && !me.airAttackUsed && me.vy >= 0) {
      // 斜め下に飛ぶ（相手の高さへ少し曲がる）ので、相手の体に届く横の距離のときに撃つ
      const pr = st.moves.airSpecial.projectile;
      const above = (SF.constants.GROUND_Y * S - me.y) / S + pr.y;
      const realDist = Math.abs(me.x - o.x) / S;
      const land = pr.spawnX + above; // 地面に着く所までの横の距離
      if (o.onGround && realDist > land - 150 && realDist < land + 60 && !state.projectiles.some((p) => p.owner === index)) {
        cpu.airShotPlan = false;
        return finish(cpu, BUTTON.SPECIAL | (cpu.floatPlan ? BUTTON.JUMP : 0) | cpu.hold, true);
      }
    }
    if (!me.onGround && cpu.floatPlan && (me.floating || me.floatLeft > 0)) {
      // 浮く：頂上からジャンプのキーを押し続ける（押しっぱなしでよい）
      const out = BUTTON.JUMP | cpu.hold;
      const realDist = Math.abs(me.x - o.x) / S;
      if (!me.move && !me.airAttackUsed && !cpu.airShotPlan && me.vy >= 0 && realDist < reachOf(me, opp, "airHeavy") + 20 && o.onGround) {
        return finish(cpu, out | (cpu.prev & BUTTON.HEAVY ? 0 : BUTTON.HEAVY), true);
      }
      return finish(cpu, out, true);
    }

    if (me.onGround) cpu.rising = false;
    // 上りの空中攻撃（ゲンマの冥府球をガードさせたあと）：跳んですぐ出す
    if (!me.onGround && cpu.rising && !me.move && !me.airAttackUsed) {
      cpu.rising = false;
      return finish(cpu, BUTTON.HEAVY | cpu.hold);
    }
    // 空中：落ちてきて相手に届きそうなら空中攻撃
    if (!me.onGround && !me.move && !me.airAttackUsed && me.vy > 0) {
      const realDist = Math.abs(me.x - o.x) / S;
      if (realDist < reachOf(me, opp, "airHeavy") + 20 && o.onGround) {
        return finish(cpu, (cpu.prev & BUTTON.HEAVY ? 0 : BUTTON.HEAVY) | cpu.hold);
      }
    }

    if (!free) return finish(cpu, cpu.hold & ~(BUTTON.LIGHT | BUTTON.HEAVY | BUTTON.SPECIAL));

    // 学習AIのひとまとまりの攻め（起き攻め・ダッシュからの崩し）の続き
    if (cpu.macro) {
      const out = runMacro(cpu, state, me, opp, forward);
      if (out !== null) return finish(cpu, out);
    }

    // ゲージ技を「相手が動いたのを見て」撃つ（カゲツの月影斬・ゴウの大地落とし）。飛び道具だけの技には撃たない
    const sp = SUPER_PLAN[me.charId];
    if (sp && sp.confirm && SF.game.gaugeFull(me) && o.move && o.onGround && cpu.confirmKey !== o.moveId) {
      const om = CHARACTERS[opp.charId].moves[o.move];
      if (om && !om.projectile && om.recovery !== null && dist <= sp.maxDist) {
        cpu.confirmKey = o.moveId;
        if (chance(cpu, lv.superUse)) {
          cpu.hold = 0;
          cpu.thinkTimer = 0;
          return finish(cpu, SUPER);
        }
      }
    }

    // ゴウの起き攻め：相手が倒れている間に、起き上がりに岩落としを重ねるか、様子を見て対応するかを決める
    //   様子を見るとき：跳んだらつかみ上げ、バックステップしたら止まり際を張り手で叩き、何もしなければ岩落とし
    //   学習AIは、起き攻めも自分で選ぶ（行動の「起き攻め」）ので、ここは使わない
    if (me.charId === "gou" && !cpu.learner && opp.pose === POSE.DOWN && opp.health > 0) {
      if (!cpu.okiPlan) cpu.okiPlan = chance(cpu, lv.combo) ? (chance(cpu, 50) ? "grab" : "watch") : "none";
      const grabReach = reachOf(me, opp, "special") - 6;
      const realDist = Math.abs(me.x - opp.x) / S;
      if (cpu.okiPlan !== "none") {
        // 岩落としの発生に合わせて、起き上がりの瞬間に掴む所で押す
        if (cpu.okiPlan === "grab" && realDist <= grabReach + 4 && opp.downTimer === st.moves.special.startup - 1) {
          cpu.hold = 0;
          return finish(cpu, BUTTON.SPECIAL);
        }
        cpu.hold = realDist > grabReach - 10 ? forward : 0;
        if (cpu.okiPlan === "watch") cpu.okiWatch = 24;
        return finish(cpu, cpu.hold);
      }
    } else if (me.charId === "gou" && cpu.okiPlan) {
      cpu.okiPlan = null;
    }
    if (cpu.okiWatch > 0 && free) {
      cpu.okiWatch -= 1;
      cpu.hold = 0;
      if (!o.onGround && o.pose === POSE.JUMP) {
        cpu.okiWatch = 0;
        cpu.queue.push(BUTTON.DOWN | BUTTON.SPECIAL);
        return finish(cpu, BUTTON.DOWN);
      }
      if (o.pose === POSE.BACKSTEP || (o.pose === POSE.DASH_RECOVERY && dist > reachOf(me, opp, "special"))) {
        cpu.okiWatch = 0;
        return finish(cpu, BUTTON.LIGHT);
      }
      if (cpu.okiWatch === 0 && dist <= reachOf(me, opp, "special")) return finish(cpu, BUTTON.SPECIAL);
      return finish(cpu, 0);
    }

    // ゲンマの冥府球をガードさせている間：球の後ろについて行き、近づいたら上りの空中攻撃か下段で崩す
    const ball = state.projectiles.find((p) => p.owner === index && p.strong);
    if (ball && me.charId === "genma" && !cpu.learner) {
      if (opp.pose === POSE.BLOCK || dist < 200) {
        if (dist > 150) {
          cpu.hold = forward;
          return finish(cpu, forward);
        }
        cpu.thinkTimer = 30;
        if (chance(cpu, 50)) {
          cpu.rising = true;
          cpu.hold = forward;
          return finish(cpu, BUTTON.JUMP | forward);
        }
        cpu.queue.push(BUTTON.DOWN | (chance(cpu, 50) ? BUTTON.LIGHT : BUTTON.HEAVY), BUTTON.DOWN);
        return finish(cpu, BUTTON.DOWN);
      }
    }

    // 相手が倒れている・投げられているときは、近づいて待つ（学習AIは、倒れている間も表を見て選ぶ）
    if ((o.pose === POSE.DOWN && !cpu.learner) || o.pose === POSE.LAUNCH) {
      cpu.hold = dist > reachOf(me, opp, "standLight") ? forward : 0;
      return finish(cpu, cpu.hold);
    }

    // 様子見：考え直す時間になったら、距離に合わせて行動を選ぶ
    if (cpu.thinkTimer > 0) {
      cpu.thinkTimer -= 1;
      return finish(cpu, cpu.hold);
    }
    cpu.thinkTimer = lv.reaction;
    cpu.hold = 0;
    const plans = PLANS[me.charId] || PLANS.kagetsu;
    const band = dist <= reachOf(me, opp, "standLight") ? "near" : dist <= reachOf(me, opp, "standHeavy") ? "mid" : "far";
    let plan;
    // ゲージが満タンなら、場面に合えばゲージ技を使う（学習AIも同じ決まりで使う。学習した表には入っていない）
    const grabbable = !sp || !sp.grab || (o.onGround && o.pose !== POSE.HIT && o.pose !== POSE.BLOCK);
    if (sp && !sp.confirm && grabbable && SF.game.gaugeFull(me) && sp.bands.includes(band) && dist <= sp.maxDist && chance(cpu, lv.superUse / sp.rate)) {
      return finish(cpu, SUPER);
    }
    if (cpu.learner) {
      // 学習AI：表を見て選ぶ（届かない技を選んでも直さない。空振りして損をしたら、それも学習する）
      plan = SF.learn.decide(cpu.learner, cpu.rng, state, index, o);
    } else {
      plan = pick(cpu, plans[band]);
      // 飛刃は画面に1つまで
      if (plan === "special" && state.projectiles.some((p) => p.owner === index)) plan = "forward";
      // コマンド投げ（ゴウの岩落とし）は届く距離でだけ
      const spm = st.moves.special;
      if (plan === "special" && spm.kind === "throw" && dist > reachOf(me, opp, "special") + 4) plan = "forward";
      if (plan === "throw" && dist > reachOf(me, opp, "throw") + 4) plan = "light";
      if (plan === "crouchHeavy" && dist > reachOf(me, opp, "crouchHeavy")) plan = "forward";
    }

    switch (plan) {
      case "okiStrike":
      case "okiLow":
      case "okiThrow": {
        // 起き攻め：相手が倒れていれば、近づいて起き上がりに重ねる。倒れていなければ、ふつうの強攻撃・しゃがみ弱・投げ
        const move = okiMove(st, plan);
        if (opp.pose === POSE.DOWN && opp.health > 0) {
          cpu.macro = { kind: "oki", move, timer: 0 };
          const out = runMacro(cpu, state, me, opp, forward);
          if (out !== null) return finish(cpu, out);
          return finish(cpu, 0);
        }
        return pressMove(cpu, move);
      }
      case "dashThrow":
      case "dashLow": {
        // ダッシュで近づき、着いたら投げ（ゴウは岩落とし）・しゃがみ弱。届かなければ少し歩いてから
        cpu.macro = { kind: "dash", move: plan === "dashThrow" ? okiMove(st, "okiThrow") : "crouchLight", timer: 40 };
        cpu.queue.push(0, forward, forward, forward, forward, forward, forward, forward);
        cpu.thinkTimer = 40;
        return finish(cpu, forward);
      }
      case "special":
        // ためる技（リンの突進拳）は、ためながら近づく：15〜30フレーム押し続けてから離す
        if (st.moves.special.charge) {
          cpu.chargeLeft = 14 + SF.rng.nextInt(cpu.rng, 16);
          cpu.thinkTimer = Math.max(cpu.thinkTimer, cpu.chargeLeft + 10);
          cpu.prev = BUTTON.SPECIAL;
          return BUTTON.SPECIAL;
        }
        return finish(cpu, buttonFor(plan));
      case "light":
      case "heavy":
        return finish(cpu, buttonFor(plan));
      case "crouchLight":
        cpu.queue.push(BUTTON.DOWN | BUTTON.LIGHT, BUTTON.DOWN);
        return finish(cpu, BUTTON.DOWN);
      case "crouchHeavy":
        cpu.queue.push(BUTTON.DOWN | BUTTON.HEAVY, BUTTON.DOWN);
        return finish(cpu, BUTTON.DOWN);
      case "crouchSpecial":
        cpu.queue.push(BUTTON.DOWN | BUTTON.SPECIAL, BUTTON.DOWN);
        return finish(cpu, BUTTON.DOWN);
      case "throw":
        return finish(cpu, BUTTON.LIGHT | BUTTON.HEAVY);
      case "forward":
        cpu.hold = forward;
        return finish(cpu, forward);
      case "back":
        cpu.hold = back;
        return finish(cpu, back);
      case "guardLow":
        cpu.hold = back | BUTTON.DOWN;
        return finish(cpu, cpu.hold);
      case "dash":
        // 前を素早く2回（リンは押している間走る）
        cpu.queue.push(0, forward, forward, forward, forward, forward, forward, forward);
        cpu.thinkTimer = Math.max(cpu.thinkTimer, 10);
        return finish(cpu, forward);
      case "backdash":
        // 後ろを素早く2回
        cpu.queue.push(0, back);
        cpu.thinkTimer = Math.max(cpu.thinkTimer, 10);
        return finish(cpu, back);
      case "jump":
        cpu.hold = forward;
        cpu.thinkTimer = 50; // 着地するまで考え直さない
        return finish(cpu, BUTTON.JUMP | forward);
      case "jumpUp":
        cpu.hold = 0;
        cpu.thinkTimer = 50;
        return finish(cpu, BUTTON.JUMP);
      case "jumpBack":
        cpu.hold = back;
        cpu.thinkTimer = 50;
        return finish(cpu, BUTTON.JUMP | back);
      default:
        return finish(cpu, 0);
    }
  }

  // 起き攻め・ダッシュからの崩しで使う技の名前。投げは、コマンド投げ（ゴウの岩落とし）があればそちら
  function okiMove(st, plan) {
    if (plan === "okiStrike") return "standHeavy";
    if (plan === "okiLow") return "crouchLight";
    return st.moves.special.kind === "throw" ? "special" : "throw";
  }

  // 技を出す入力（しゃがみ技は、しゃがんでから押す）
  function pressMove(cpu, move) {
    if (move === "crouchLight" || move === "crouchHeavy") {
      cpu.queue.push(BUTTON.DOWN | (move === "crouchLight" ? BUTTON.LIGHT : BUTTON.HEAVY), BUTTON.DOWN);
      return finish(cpu, BUTTON.DOWN);
    }
    if (move === "throw") return finish(cpu, BUTTON.LIGHT | BUTTON.HEAVY);
    return finish(cpu, { standLight: BUTTON.LIGHT, standHeavy: BUTTON.HEAVY, special: BUTTON.SPECIAL }[move]);
  }

  // ひとまとまりの攻めを1フレーム進める。このフレームの入力を返す（終わったら null）
  //   oki：相手が倒れている間に、技が届く所まで歩き、起き上がりの瞬間に当たる（掴む）フレームで押す
  //   dash：ダッシュのあと、技が届けば押す。届かなければ timer の間は歩いて近づく
  function runMacro(cpu, state, me, opp, forward) {
    const mc = cpu.macro;
    const st = CHARACTERS[me.charId];
    const m = st.moves[mc.move];
    const reach = reachOf(me, opp, mc.move === "special" && m.kind === "throw" ? "special" : mc.move) - 6;
    const realDist = Math.abs(me.x - opp.x) / S;
    if (mc.kind === "oki") {
      if (opp.pose !== POSE_DOWN() || opp.health <= 0) {
        cpu.macro = null;
        return null;
      }
      // 起き上がりの瞬間（downTimer が 0 になったフレームの次）に、技の当たる時間（投げは掴む時間）の始めが来るように押す
      const crouch = mc.move === "crouchLight";
      const pressAt = m.startup - 1 + (crouch ? 1 : 0);
      if (realDist <= reach + 4 && opp.downTimer === pressAt) {
        cpu.macro = null;
        cpu.hold = 0;
        cpu.thinkTimer = Math.max(cpu.thinkTimer, m.startup + 4);
        if (crouch) {
          cpu.queue.push(BUTTON.DOWN | BUTTON.LIGHT, BUTTON.DOWN);
          return BUTTON.DOWN;
        }
        return mc.move === "throw" ? BUTTON.LIGHT | BUTTON.HEAVY : mc.move === "special" ? BUTTON.SPECIAL : BUTTON.HEAVY;
      }
      cpu.hold = realDist > reach - 10 ? forward : 0;
      cpu.thinkTimer = Math.max(cpu.thinkTimer, 2);
      return cpu.hold;
    }
    // dash
    mc.timer -= 1;
    if (realDist <= reach + 4 && (mc.move === "crouchLight" || opp.onGround)) {
      cpu.macro = null;
      cpu.hold = 0;
      cpu.thinkTimer = Math.max(cpu.thinkTimer, m.startup + 4);
      if (mc.move === "crouchLight") {
        cpu.queue.push(BUTTON.DOWN | BUTTON.LIGHT, BUTTON.DOWN);
        return BUTTON.DOWN;
      }
      return mc.move === "throw" ? BUTTON.LIGHT | BUTTON.HEAVY : BUTTON.SPECIAL;
    }
    if (mc.timer <= 0) {
      cpu.macro = null;
      return null;
    }
    cpu.hold = forward;
    return forward;
  }
  const POSE_DOWN = () => SF.game.POSE.DOWN;

  // 前のフレームから押しっぱなしのボタンは、いったん離さないと「押した」にならない。
  // 方向キーは押しっぱなしでよいが、攻撃ボタンとジャンプは押しっぱなしにしない
  // holdJump＝浮くために、ジャンプのキーを押しっぱなしにしてよい
  function finish(cpu, out, holdJump = false) {
    out &= ~(cpu.noGuard || 0);
    const taps = BUTTON.LIGHT | BUTTON.HEAVY | BUTTON.SPECIAL | (holdJump ? 0 : BUTTON.JUMP);
    if (out & cpu.prev & taps) {
      // 押しっぱなしになってしまうので、このフレームは離して次のフレームで押し直す
      cpu.queue.unshift(out);
      out &= ~taps;
    }
    cpu.prev = out;
    return out;
  }

  SF.cpu = { LEVELS, LEARN_LEVEL, createCpu, nextLevel, input };
})(globalThis);
