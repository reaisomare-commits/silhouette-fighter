// CPU（コンピューターの対戦相手）。強さは「よわい・ふつう・つよい」の3段階。
// プレイヤーと同じ「キー入力（ボタンのビット）」を作って渡すだけで、特別な動きはしない。
// 相手の様子は「反応の速さ」のフレーム数だけ前のものしか見えない（人間が見てから動くのと同じ）。
// ただしガードだけは、発生の速い技を見てからでは間に合わないので、「ガードできる確率」で読んで構える。
// 乱数はCPUごとに自分の種を持つので、同じ種なら同じ試合になる。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const { BUTTON } = SF.input;
  const { CHARACTERS } = SF.characters;
  const S = SF.constants.SCALE;

  // 強さの数字。調整するときはここを書き換える（確率は%）
  //   reaction: 反応の速さ（相手の位置やジャンプが何フレーム遅れて見えるか。様子見の考え直しの間隔もこれ）
  //   guard: ガードできる確率（相手の技1つごとに決める）
  //   antiAir: 相手が跳んできたときに対空技（S+O）を出す確率（1回のジャンプごとに決める）
  //   combo: 連続技を最後までつなぐ確率（失敗すると途中で止める）
  //   tech: 投げ抜けする確率
  //   superUse: ゲージが満タンのとき、ゲージ技を使う確率（連続技の締め・切り返しなど、場面ごとに決める）
  const LEVELS = [
    { id: "easy", label: "よわい", reaction: 30, guard: 30, antiAir: 20, combo: 30, tech: 0, superUse: 20 },
    { id: "normal", label: "ふつう", reaction: 18, guard: 60, antiAir: 50, combo: 70, tech: 30, superUse: 50 },
    { id: "hard", label: "つよい", reaction: 10, guard: 85, antiAir: 80, combo: 95, tech: 60, superUse: 80 },
    // 学習AI：反射神経（反応・ガード・対空・連続技・投げ抜け）は「つよい」と同じで、
    // 様子見で何をするかだけを機械学習（src/core/learn.js）の表で決める
    { id: "learn", label: "学習AI", reaction: 10, guard: 85, antiAir: 80, combo: 95, tech: 60, superUse: 80, learned: true },
  ];
  const LEARN_LEVEL = LEVELS.findIndex((lv) => lv.learned);

  // 連続技のつなぎ方。始めの技ごとに、そのあと押すボタンの順番
  //   "light"＝U、"heavy"＝I、"special"＝O、"crouchSpecial"＝S+O（しゃがみ技からはS押しっぱなし）
  const COMBOS = {
    kagetsu: {
      standLight: ["heavy", "special"], // 柄打ち → 大振り斬り → 飛刃
      standHeavy: ["crouchSpecial"], // 大振り斬り → 昇り斬り
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
  };

  // 浮遊できるキャラ（ゲンマ）が、1回のジャンプで浮くか・空中の飛び道具を撃つかを決める確率（%）
  const FLOAT_CHANCE = 60;
  const AIR_SHOT_CHANCE = 60;

  const PROJECTILE_ALERT = 260; // 飛び道具がこれより近づいたらガードを考える（ピクセル）
  const ANTI_AIR_RANGE = 130; // 跳んできた相手がこれより近づいたら対空技を出す（ピクセル、横の距離）
  const HISTORY = 64;
  const SUPER = BUTTON.HEAVY | BUTTON.SPECIAL; // ゲージ技（I＋O の同時押し）
  // ゲージ技を様子見のときに使う場面。band＝距離（近い・中くらい・遠い）、rate＝superUse の何分の1の確率で使うか
  //   カゲツの月影斬は突進するので中くらい〜少し遠い所から、リンの練気は近づく前に、ゲンマの冥府球は離れた所から
  const SUPER_PLAN = {
    kagetsu: { bands: ["mid", "far"], maxDist: 300, rate: 4 },
    rin: { bands: ["mid", "far"], maxDist: 999, rate: 3 },
    genma: { bands: ["mid", "far"], maxDist: 999, rate: 3 },
  };
  // リンの練気で強くなっている間の連続技（すべての攻撃がキャンセルできるので長くつなぐ）
  const BUFF_COMBOS = {
    rin: {
      standLight: ["light", "heavy", "crouchLight", "heavy", "special"], // ジャブ → ジャブ → 回し蹴り → 小足 → 回し蹴り → 突進拳
      standHeavy: ["crouchLight", "heavy", "special"], // 回し蹴り → 小足 → 回し蹴り → 突進拳
      crouchLight: ["light", "special"], // 小足 → 小足 → 跳び蹴り上げ
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
      guardOk: false,
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

  // 見えている相手の技が、自分に届きそうなら { key, guard } を返す（ガードの種類 "mid"・"low"・"high"・"air"）
  function threat(cpu, me, opp, o) {
    const dist = Math.abs(me.x - o.x) / S;
    // 飛び道具がこちらに向かってきている
    for (const p of o.projs) {
      const toward = Math.sign(me.x - p.x) === Math.sign(p.vx);
      if (toward && Math.abs(me.x - p.x) / S < PROJECTILE_ALERT) return { key: "p" + o.projId, guard: "mid" };
    }
    if (!o.move || o.moveHit) return null;
    const m = CHARACTERS[opp.charId].moves[o.move];
    if (!m || m.kind === "throw" || !m.hitbox) return null;
    // 当たる時間が終わった技はもう怖くない
    if (o.moveFrame >= m.startup + m.active) return null;
    let reach = m.hitbox.x2 + CHARACTERS[me.charId].width / 2 + 30;
    if (m.lunge) reach += (m.lunge.to - m.lunge.from + 1) * m.lunge.speed;
    if (dist > reach) return null;
    return { key: "m" + o.moveId, guard: m.guard };
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
    const forward = me.facing === 1 ? BUTTON.RIGHT : BUTTON.LEFT;
    const back = me.facing === 1 ? BUTTON.LEFT : BUTTON.RIGHT;

    let out = 0;
    if (state.round.phase !== PHASE.FIGHT) {
      if (cpu.learner) SF.learn.endRound(cpu.learner, state, index); // ラウンドの勝ち負けを学習に伝える
      cpu.queue = [];
      cpu.hold = 0;
      cpu.thinkTimer = 0;
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

    // 掴まれた：投げ抜けするかを1回だけ決め、するなら少し遅れてU＋I
    if (me.pose === POSE.THROWN) {
      cpu.queue = [];
      cpu.hold = 0;
      if (!cpu.grabbed) {
        cpu.grabbed = state.frame;
        cpu.techAt = chance(cpu, lv.tech) ? state.frame + 2 + SF.rng.nextInt(cpu.rng, 5) : -1;
      }
      if (state.frame === cpu.techAt) out = BUTTON.LIGHT | BUTTON.HEAVY;
      return finish(cpu, out);
    }
    cpu.grabbed = 0;

    // 決めてある入力があればそれを出す（ボタンを押す・離す、しゃがんでからOなど）
    if (cpu.queue.length) return finish(cpu, cpu.queue.shift());

    // 連続技：自分の技が当たったら、決めた確率で次のボタンを押す
    if (me.move && me.moveHit && opp.pose === POSE.HIT && cpu.comboPressedFor !== cpu.myMoveId) {
      const buffed = SF.game.cancelAllActive(me);
      const route = ((buffed && BUFF_COMBOS[me.charId]) || COMBOS[me.charId] || {})[cpu.comboFrom];
      if (route && cpu.comboStep < route.length) {
        // 最後までつなぐかを1回だけ決める。失敗するときは途中のどこかで止める（1回もつながないこともある）
        if (cpu.comboStop === null) {
          cpu.comboStop = chance(cpu, lv.combo) ? route.length : SF.rng.nextInt(cpu.rng, route.length);
          // ゲージが満タンなら、最後のつなぎをゲージ技にするかを決める（当たる技で、そのまま連続技になるカゲツの月影斬だけ）
          const sup = CHARACTERS[me.charId].moves.super;
          cpu.comboSuper = !!(sup && sup.hitbox) && SF.game.gaugeFull(me) && chance(cpu, lv.superUse);
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
          else cpu.queue.push(down, down | buttonFor(next));
          return finish(cpu, cpu.queue.shift());
        }
        cpu.comboPressedFor = cpu.myMoveId;
      }
    }

    // ガード：相手が技を出したら、技1つごとにガードするかを決める。
    // 発生の速い技は見てからでは間に合わないので、ここは今の相手を見る（読んで構えるかどうかを確率で表す）
    const t = threat(cpu, me, opp, cpu.history[cpu.history.length - 1]);
    if (t) {
      if (cpu.guardKey !== t.key) {
        cpu.guardKey = t.key;
        cpu.guardOk = chance(cpu, lv.guard);
        // 切り返し：ゲージが満タンで、出だしが無敵のゲージ技があれば、相手の技（飛び道具でないもの）にゲージ技を合わせるかを決める
        const sup = CHARACTERS[me.charId].moves.super;
        cpu.reversalOk = !!(sup && sup.invincible) && t.key[0] === "m" && SF.game.gaugeFull(me) && chance(cpu, lv.superUse / 2);
      }
      if (cpu.reversalOk && isFree(me) && me.onGround && me.landingTimer === 0) {
        cpu.reversalOk = false;
        cpu.hold = 0;
        cpu.thinkTimer = 0;
        return finish(cpu, SUPER);
      }
      if (cpu.guardOk && me.onGround) {
        cpu.hold = 0;
        cpu.thinkTimer = 0;
        return finish(cpu, back | (t.guard === "low" ? BUTTON.DOWN : 0));
      }
    }
    // ガード硬直の間は構えを続ける（次の技にも備える）
    if (me.pose === POSE.BLOCK) return finish(cpu, back | (me.crouching ? BUTTON.DOWN : 0));

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

    // 空中：落ちてきて相手に届きそうなら空中攻撃
    if (!me.onGround && !me.move && !me.airAttackUsed && me.vy > 0) {
      const realDist = Math.abs(me.x - o.x) / S;
      if (realDist < reachOf(me, opp, "airHeavy") + 20 && o.onGround) {
        return finish(cpu, (cpu.prev & BUTTON.HEAVY ? 0 : BUTTON.HEAVY) | cpu.hold);
      }
    }

    if (!free) return finish(cpu, cpu.hold & ~(BUTTON.LIGHT | BUTTON.HEAVY | BUTTON.SPECIAL));

    // 相手が倒れている・投げられているときは、近づいて待つ
    if (o.pose === POSE.DOWN || o.pose === POSE.LAUNCH) {
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
    const sp = SUPER_PLAN[me.charId];
    if (sp && SF.game.gaugeFull(me) && sp.bands.includes(band) && dist <= sp.maxDist && chance(cpu, lv.superUse / sp.rate)) {
      return finish(cpu, SUPER);
    }
    if (cpu.learner) {
      // 学習AI：表を見て選ぶ（届かない技を選んでも直さない。空振りして損をしたら、それも学習する）
      plan = SF.learn.decide(cpu.learner, cpu.rng, state, index, o);
    } else {
      plan = pick(cpu, plans[band]);
      // 飛刃は画面に1つまで
      if (plan === "special" && state.projectiles.some((p) => p.owner === index)) plan = "forward";
      if (plan === "throw" && dist > reachOf(me, opp, "throw") + 4) plan = "light";
      if (plan === "crouchHeavy" && dist > reachOf(me, opp, "crouchHeavy")) plan = "forward";
    }

    switch (plan) {
      case "light":
      case "heavy":
      case "special":
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

  // 前のフレームから押しっぱなしのボタンは、いったん離さないと「押した」にならない。
  // 方向キーは押しっぱなしでよいが、攻撃ボタンとジャンプは押しっぱなしにしない
  // holdJump＝浮くために、ジャンプのキーを押しっぱなしにしてよい
  function finish(cpu, out, holdJump = false) {
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
