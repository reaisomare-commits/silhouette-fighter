// ゲームの計算部分。画面やキーボードには一切さわらない。
// 「今の状態」と「両プレイヤーの入力」を受け取り、状態を1フレーム進めるだけ。
// そのため画面なしでも高速に試合を進められる（自動対戦・学習CPU用）。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const C = SF.constants;
  const { BUTTON, isDown, justPressed } = SF.input;
  const { CHARACTERS, DOUBLE_TAP_WINDOW, BATTLE } = SF.characters;

  const S = C.SCALE;

  // キャラの表（ピクセル）を、計算で使う整数（×100）に直す
  function toStats(id) {
    const c = CHARACTERS[id];
    if (!c) throw new Error(`知らないキャラ: ${id}`);
    const px = (v) => Math.round(v * S);
    return {
      width: c.width,
      height: c.height,
      crouchHeight: c.crouchHeight,
      walkForward: px(c.walkForward),
      walkBack: px(c.walkBack),
      jumpVelocity: px(c.jumpVelocity),
      jumpForward: px(c.jumpForward),
      gravity: px(c.gravity),
      landingLag: c.landingLag,
      forwardDash: { ...c.forwardDash, speed: px(c.forwardDash.speed) },
      backDash: { ...c.backDash, speed: px(c.backDash.speed) },
    };
  }

  // キャラの今の様子。描画やCPUが「何をしているか」を知るのに使う
  const POSE = Object.freeze({
    STAND: "stand", // 立っている
    WALK_FORWARD: "walkForward", // 前に歩いている
    GUARD_STAND: "guardStand", // 立ちガード（下がりながら構えている）
    CROUCH: "crouch", // しゃがんでいる
    GUARD_CROUCH: "guardCrouch", // しゃがみガード
    JUMP: "jump", // 空中
    LANDING: "landing", // 着地して動けない
    STEP: "step", // ステップで踏み込んでいる（カゲツ）
    RUN: "run", // ダッシュで走っている（リン）
    BACKSTEP: "backstep", // バックステップで下がっている
    DASH_RECOVERY: "dashRecovery", // ステップ・ダッシュ・バックステップの止まり際（動けない）
    ATTACK: "attack", // 技を出している（どの技かは move）
    HIT: "hit", // 攻撃を受けてのけぞっている
    BLOCK: "block", // ガードで攻撃を受け止めている
    LAUNCH: "launch", // 空中で攻撃を受けて落ちている（攻撃は当たらない）
    DOWN: "down", // 倒れている（攻撃は当たらない）
  });

  // ラウンドの進み具合
  const PHASE = Object.freeze({
    INTRO: "intro", // 「ラウンド1」「ファイト！」の表示中（動けない）
    FIGHT: "fight", // 戦っている
    ROUND_END: "roundEnd", // KO・時間切れの表示中
    MATCH_END: "matchEnd", // 試合が終わった
  });

  function createFighter(charId, x, facing) {
    return {
      charId,
      x: x * S, // 足元の中心
      y: C.GROUND_Y * S, // 足元の高さ
      vx: 0,
      vy: 0,
      pushVx: 0, // 攻撃で押し返されている速さ（少しずつ弱まる）
      facing, // 1 = 右向き、-1 = 左向き
      onGround: true,
      crouching: false, // しゃがんだ体の高さか
      pose: POSE.STAND,
      health: CHARACTERS[charId].health,
      landingTimer: 0, // 着地硬直の残りフレーム
      action: null, // ステップなど、途中で止められない動きの最中ならその種類（POSE と同じ名前）
      actionTimer: 0, // その動きの残りフレーム（ダッシュは走ったフレーム数）
      move: null, // 出している技の名前（moves の中の名前）
      moveFrame: 0, // 技を出してから何フレーム目か（押したフレームが1）
      moveHit: false, // この技がもう当たった（ガードされた）か。1回の技で1回だけ当たる
      airAttackUsed: false, // このジャンプで空中攻撃を出したか
      stun: 0, // のけぞり・ガード硬直の残りフレーム
      downTimer: 0, // ダウンの残りフレーム
      downFrame: 0, // 倒れてから何フレームたったか（倒れる・バウンド・起き上がりの動きを描くため）
      buffer: null, // 先行入力：動けない間に最後に押したボタン（"light"・"heavy"・"jump"）。動けるようになった最初のフレームで出る
      tapForward: 0, // 前を1回押してからの受付の残りフレーム（2回押し判定用）
      tapBack: 0, // 後ろを1回押してからの受付の残りフレーム
      holdBack: false, // このフレームで後ろを押しているか（ガードの判定に使う）
      holdDown: false, // このフレームで下を押しているか
      pinned: false, // 影縫い中か（相手の技の影縫い範囲に体が入っている）
      prevInput: 0,
    };
  }

  const START_X = [C.STAGE_WIDTH * 0.3, C.STAGE_WIDTH * 0.7];

  // 新しい試合の状態を作る。chars は [左のキャラ, 右のキャラ]
  // options.intro = false にすると、ラウンド開始の表示を飛ばしてすぐ戦える（確認用）
  function createGame(seed = 1, chars = ["kagetsu", "rin"], options = {}) {
    const state = {
      frame: 0,
      rng: SF.rng.createRng(seed),
      chars: chars.slice(),
      fighters: [],
      hitstop: 0, // 当たった瞬間に止まっている残りフレーム
      effects: [], // 当たった火花など（描画用）
      round: {
        number: 1,
        wins: [0, 0],
        timer: BATTLE.roundSeconds * C.FPS, // 残り時間（フレーム）
        phase: PHASE.INTRO,
        phaseTimer: BATTLE.introFrames,
        winner: null, // このラウンドの勝者（0, 1, "draw"）
        reason: null, // "ko" か "time"
        matchWinner: null, // 試合の勝者（0, 1, "draw"）
      },
    };
    resetFighters(state);
    if (options.intro === false) {
      state.round.phase = PHASE.FIGHT;
      state.round.phaseTimer = 0;
    }
    return state;
  }

  function resetFighters(state) {
    state.fighters = [
      createFighter(state.chars[0], START_X[0], 1),
      createFighter(state.chars[1], START_X[1], -1),
    ];
    state.hitstop = 0;
    state.effects = [];
  }

  function moveData(f) {
    return f.move ? CHARACTERS[f.charId].moves[f.move] : null;
  }

  // 技の全体の長さ（地上技だけ）
  function moveTotal(m) {
    return m.startup - 1 + m.active + m.recovery;
  }

  // 今この技が「当たる時間」か
  function isActive(f) {
    const m = moveData(f);
    if (!m) return false;
    return f.moveFrame >= m.startup && f.moveFrame < m.startup + m.active;
  }

  // 自分で動ける状態か（技・のけぞり・ダウン・ステップなどの最中でない）
  function isFree(f) {
    return (
      !f.move && f.stun === 0 && f.pose !== POSE.DOWN && f.pose !== POSE.LAUNCH && !f.action
    );
  }

  function startMove(f, name) {
    f.move = name;
    f.moveFrame = 1;
    f.moveHit = false;
    f.pose = POSE.ATTACK;
    f.buffer = null;
    if (name === "airLight" || name === "airHeavy") f.airAttackUsed = true;
  }

  // 押した瞬間のボタンと方向キーの2回押しを先行入力として覚える。前に覚えていたものは上書き（最後の入力を優先）。
  // 同じフレームに2つ押したときは 強攻撃 ＞ 弱攻撃 ＞ ジャンプ ＞ ステップ・ダッシュ・バックステップ の順
  function registerPresses(f, input) {
    // 「前」と「後ろ」は押した時点の向きで決める
    const forwardBtn = f.facing === 1 ? BUTTON.RIGHT : BUTTON.LEFT;
    const backBtn = f.facing === 1 ? BUTTON.LEFT : BUTTON.RIGHT;
    // 方向キーの2回押しを見張る。押した瞬間に受付中なら2回押し成立
    if (f.tapForward > 0) f.tapForward -= 1;
    if (f.tapBack > 0) f.tapBack -= 1;
    let dash = null;
    if (justPressed(input, f.prevInput, forwardBtn)) {
      if (f.tapForward > 0) dash = "dashForward";
      f.tapForward = dash ? 0 : DOUBLE_TAP_WINDOW;
      f.tapBack = 0;
    }
    if (justPressed(input, f.prevInput, backBtn)) {
      if (f.tapBack > 0) dash = "dashBack";
      f.tapBack = dash === "dashBack" ? 0 : DOUBLE_TAP_WINDOW;
      f.tapForward = 0;
    }
    if (justPressed(input, f.prevInput, BUTTON.HEAVY)) f.buffer = "heavy";
    else if (justPressed(input, f.prevInput, BUTTON.LIGHT)) f.buffer = "light";
    else if (justPressed(input, f.prevInput, BUTTON.JUMP)) f.buffer = "jump";
    else if (dash) f.buffer = dash;
  }

  function updateFighter(f, input) {
    const st = toStats(f.charId);
    // 「前」と「後ろ」は向きで決まる。後ろ＝相手と反対の方向
    const forwardBtn = f.facing === 1 ? BUTTON.RIGHT : BUTTON.LEFT;
    const backBtn = f.facing === 1 ? BUTTON.LEFT : BUTTON.RIGHT;
    const holdForward = isDown(input, forwardBtn);
    const holdBack = isDown(input, backBtn);
    // 左右を同時に押したときはどちらも押していない扱い
    const forward = holdForward && !holdBack;
    const back = holdBack && !holdForward;
    const down = isDown(input, BUTTON.DOWN);
    f.holdBack = back;
    f.holdDown = down;

    // 攻撃・ジャンプ・2回押しは先行入力として覚える（動けるならこのフレームですぐ出る）
    registerPresses(f, input);
    const wantAttack = f.buffer === "light" || f.buffer === "heavy" ? f.buffer : null;
    const wantJump = f.buffer === "jump";
    const doubleForward = f.buffer === "dashForward";
    const doubleBack = f.buffer === "dashBack";

    if (f.pose === POSE.LAUNCH) {
      // 空中で攻撃を受けて落ちている。着地したらダウン（下の着地の処理で）
    } else if (f.pose === POSE.DOWN) {
      f.vx = 0;
      f.crouching = false;
      f.downFrame += 1;
      // 体力0なら起き上がらない
      if (f.health > 0) f.downTimer -= 1;
      if (f.downTimer <= 0) {
        f.downTimer = 0;
        f.pose = POSE.STAND;
      }
    } else if (f.stun > 0) {
      // のけぞり・ガード硬直。動けない
      f.stun -= 1;
      f.vx = 0;
      if (f.stun === 0) {
        f.pose = f.crouching ? POSE.CROUCH : POSE.STAND;
      }
    } else if (f.onGround && f.move) {
      // 地上の技の最中。最後まで出しきるまで動けない
      const m = moveData(f);
      f.vx = 0;
      if (f.moveFrame >= moveTotal(m)) {
        f.move = null;
        f.pose = f.crouching ? POSE.CROUCH : POSE.STAND;
        groundControl();
      } else {
        f.moveFrame += 1;
      }
    } else if (f.onGround && f.action) {
      // ステップ・ダッシュ・バックステップの最中
      updateAction(f, st, { forward, down, jump: wantJump });
    } else if (f.onGround) {
      groundControl();
    } else if (f.move) {
      // 空中攻撃の最中。着地するまで何もできない
      f.moveFrame += 1;
    } else if (wantAttack && !f.airAttackUsed) {
      // 空中攻撃は1回のジャンプで1回だけ
      startMove(f, wantAttack === "heavy" ? "airHeavy" : "airLight");
    }

    // 地上で自由に動けるときの操作
    function groundControl() {
      if (f.landingTimer > 0) {
        // 着地硬直中は何もできない
        f.landingTimer -= 1;
        f.vx = 0;
        f.pose = POSE.LANDING;
      } else if (wantJump) {
        // ジャンプは押した瞬間だけ（押しっぱなしで連続ジャンプしない）
        // 方向キーを押していれば斜めに跳ぶ
        f.buffer = null;
        f.onGround = false;
        f.crouching = false;
        f.vy = -st.jumpVelocity;
        f.vx = forward ? f.facing * st.jumpForward : back ? -f.facing * st.jumpForward : 0;
        f.pose = POSE.JUMP;
      } else if (wantAttack) {
        // しゃがみながら押すとしゃがみ技
        f.vx = 0;
        f.crouching = down;
        const name = (down ? "crouch" : "stand") + (wantAttack === "heavy" ? "Heavy" : "Light");
        startMove(f, name);
      } else if ((doubleForward || doubleBack) && down) {
        // しゃがんでいるときはステップ類は出ない（覚えていた入力は捨てる）
        f.buffer = null;
        f.vx = 0;
        f.crouching = true;
        f.pose = back ? POSE.GUARD_CROUCH : POSE.CROUCH;
      } else if (doubleForward) {
        f.buffer = null;
        f.crouching = false;
        startAction(f, st.forwardDash.type === "run" ? POSE.RUN : POSE.STEP, st);
      } else if (doubleBack) {
        f.buffer = null;
        f.crouching = false;
        startAction(f, POSE.BACKSTEP, st);
      } else if (down) {
        // しゃがみ中は歩けない。後ろを押していればしゃがみガード
        f.vx = 0;
        f.crouching = true;
        f.pose = back ? POSE.GUARD_CROUCH : POSE.CROUCH;
      } else if (forward) {
        f.crouching = false;
        f.vx = f.facing * st.walkForward;
        f.pose = POSE.WALK_FORWARD;
      } else if (back) {
        // 後ろに歩く＝立ちガードの構え。影縫い中は下がらずその場で構える
        f.crouching = false;
        f.vx = f.pinned ? 0 : -f.facing * st.walkBack;
        f.pose = POSE.GUARD_STAND;
      } else {
        f.crouching = false;
        f.vx = 0;
        f.pose = POSE.STAND;
      }
    }

    // 空中では横の速さはそのまま、重力で落ちる。ガードはできない
    if (!f.onGround) {
      f.vy += st.gravity;
    }

    f.x += f.vx + f.pushVx;
    f.y += f.vy;
    // 押し返しは毎フレーム弱まる
    f.pushVx = Math.trunc((f.pushVx * 4) / 5);

    // 着地
    if (!f.onGround && f.y >= C.GROUND_Y * S) {
      f.y = C.GROUND_Y * S;
      f.vx = 0;
      f.vy = 0;
      f.onGround = true;
      f.airAttackUsed = false;
      if (f.pose === POSE.LAUNCH) {
        knockDown(f);
      } else {
        // 空中攻撃も着地で終わる
        f.move = null;
        f.landingTimer = st.landingLag;
        f.pose = POSE.LANDING;
      }
    }

    clampToStage(f);
    f.prevInput = input;
  }

  // ステップ・ダッシュ・バックステップを始める
  function startAction(f, action, st) {
    f.action = action;
    f.pose = action;
    if (action === POSE.STEP) {
      f.actionTimer = st.forwardDash.frames;
      f.vx = f.facing * st.forwardDash.speed;
    } else if (action === POSE.RUN) {
      f.actionTimer = 0; // 走ったフレーム数を数える
      f.vx = f.facing * st.forwardDash.speed;
    } else if (action === POSE.BACKSTEP) {
      f.actionTimer = st.backDash.frames;
      f.vx = -f.facing * st.backDash.speed;
    }
  }

  // 止まり際（動けない時間）に入る
  function startRecovery(f, frames, keepSpeed) {
    f.action = POSE.DASH_RECOVERY;
    f.pose = POSE.DASH_RECOVERY;
    f.actionTimer = frames;
    if (!keepSpeed) f.vx = 0;
  }

  // ステップ・ダッシュ・バックステップを1フレーム進める。
  // 途中でガードや向きの切り替えはできない（ダッシュ中のジャンプだけはできる）
  function updateAction(f, st, { forward, down, jump }) {
    if (f.action === POSE.STEP || f.action === POSE.BACKSTEP) {
      f.actionTimer -= 1;
      if (f.actionTimer <= 0) {
        const rec = f.action === POSE.STEP ? st.forwardDash.recovery : st.backDash.recovery;
        startRecovery(f, rec, false);
      }
    } else if (f.action === POSE.RUN) {
      f.actionTimer += 1;
      const canStop = f.actionTimer >= st.forwardDash.minFrames;
      if (jump) {
        // 走りながら前ジャンプ
        f.buffer = null;
        f.action = null;
        f.onGround = false;
        f.vy = -st.jumpVelocity;
        f.vx = f.facing * st.jumpForward;
        f.pose = POSE.JUMP;
      } else if (canStop && (!forward || down)) {
        // 前を離したらブレーキをかけながら止まる
        startRecovery(f, st.forwardDash.recovery, true);
      }
    } else if (f.action === POSE.DASH_RECOVERY) {
      f.actionTimer -= 1;
      // ダッシュのブレーキは少しずつ遅くなる。ステップの止まり際はその場で止まっている
      f.vx = f.vx === 0 ? 0 : Math.trunc((f.vx * f.actionTimer) / (f.actionTimer + 1));
      if (f.actionTimer <= 0) {
        f.action = null;
        f.vx = 0;
        f.pose = POSE.STAND;
      }
    }
  }

  // 画面の外に出ない
  function stageLimits(f) {
    const half = CHARACTERS[f.charId].width / 2;
    return {
      min: (C.STAGE_MARGIN + half) * S,
      max: (C.STAGE_WIDTH - C.STAGE_MARGIN - half) * S,
    };
  }
  function clampToStage(f) {
    const { min, max } = stageLimits(f);
    if (f.x < min) f.x = min;
    if (f.x > max) f.x = max;
  }

  // 描画用・判定用に体の高さを返す（ピクセル）
  const DOWN_HEIGHT = 34;
  function fighterHeight(f) {
    const c = CHARACTERS[f.charId];
    if (f.pose === POSE.DOWN) return DOWN_HEIGHT;
    return f.crouching ? c.crouchHeight : c.height;
  }

  // やられる範囲（体）。ピクセルの四角 { left, right, top, bottom }。攻撃が当たらない状態なら null
  function hurtbox(f) {
    if (f.pose === POSE.DOWN || f.pose === POSE.LAUNCH) return null;
    const w = CHARACTERS[f.charId].width;
    const x = f.x / S;
    const y = f.y / S;
    return { left: x - w / 2, right: x + w / 2, top: y - fighterHeight(f), bottom: y };
  }

  // 当たる範囲（技の先）。当たる時間でなければ null
  function hitbox(f) {
    if (!isActive(f) || f.moveHit) return null;
    const h = moveData(f).hitbox;
    const x = f.x / S;
    const y = f.y / S;
    const a = x + h.x1 * f.facing;
    const b = x + h.x2 * f.facing;
    return { left: Math.min(a, b), right: Math.max(a, b), top: y - h.y2, bottom: y - h.y1 };
  }

  // 影縫い範囲：技を出してから当たる時間が終わるまで、当たる範囲を少し広げた四角。それ以外は null
  function shadowStitchBox(f) {
    const m = moveData(f);
    if (!m || f.moveHit || f.moveFrame >= m.startup + m.active) return null;
    const h = m.hitbox;
    const x = f.x / S;
    const y = f.y / S;
    const a = x + (h.x1 - BATTLE.shadowStitchX) * f.facing;
    const b = x + (h.x2 + BATTLE.shadowStitchX) * f.facing;
    return {
      left: Math.min(a, b),
      right: Math.max(a, b),
      top: y - h.y2 - BATTLE.shadowStitchY,
      bottom: y - h.y1 + BATTLE.shadowStitchY,
    };
  }

  function overlap(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  // 守る側がこの技をガードできるか
  function canBlock(def, m) {
    // 自分で動ける地上の状態か、すでにガード中でないとガードできない
    const ready = def.onGround && ((isFree(def) && def.landingTimer === 0) || def.pose === POSE.BLOCK);
    if (!ready || !def.holdBack) return false;
    if (m.guard === "low") return def.holdDown; // 下段はしゃがみガードだけ
    if (m.guard === "air") return !def.holdDown; // 空中攻撃は立ちガードだけ
    return true;
  }

  // 攻めた側があと何フレーム動けないか（地上技だけ）
  function attackerRemaining(att, m) {
    return moveTotal(m) - att.moveFrame;
  }

  // 空中にいるキャラが、あと何フレームで着地するか
  function framesUntilLanding(f) {
    const g = toStats(f.charId).gravity;
    let y = f.y;
    let vy = f.vy;
    let n = 0;
    while (y < C.GROUND_Y * S) {
      vy += g;
      y += vy;
      n += 1;
    }
    return n;
  }

  // 当たった・ガードされたときの処理
  function applyHit(state, att, def, m, box, body) {
    const air = m.recovery === null;
    const blocked = canBlock(def, m);
    att.moveHit = true;
    // のけぞり・ガード硬直の長さは、硬直差がそのとおりになるように決める。
    // 空中攻撃は「着地して着地硬直が終わるまで」を数えるので、どの高さで当てても硬直差は同じ
    const base = air ? framesUntilLanding(att) + toStats(att.charId).landingLag : attackerRemaining(att, m);
    const dir = att.facing;
    // 火花は当たる範囲と体が重なった所の真ん中に出す
    const fx = (Math.max(box.left, body.left) + Math.min(box.right, body.right)) / 2;
    const fy = (Math.max(box.top, body.top) + Math.min(box.bottom, body.bottom)) / 2;

    if (blocked) {
      def.pose = POSE.BLOCK;
      def.crouching = def.holdDown;
      def.stun = Math.max(1, base + m.blockAdv);
      def.vx = 0;
      state.hitstop = Math.max(state.hitstop, BATTLE.hitstopBlock);
      state.effects.push({ kind: "block", x: fx, y: fy, life: 12 });
    } else {
      def.health = Math.max(0, def.health - m.damage);
      def.move = null;
      def.action = null;
      def.landingTimer = 0;
      def.buffer = null; // 当たる前の入力は捨てる（のけぞり中に押したものは出る）
      state.hitstop = Math.max(state.hitstop, BATTLE.hitstopHit);
      state.effects.push({ kind: "hit", x: fx, y: fy, life: 14 });
      if (!def.onGround) {
        // 空中で受けたら落ちてダウン
        def.pose = POSE.LAUNCH;
        def.stun = 0;
        def.crouching = false;
        def.vy = -5 * S;
        def.vx = dir * 2 * S;
      } else if (m.hitAdv === "down" || def.health === 0) {
        knockDown(def);
      } else {
        def.pose = POSE.HIT;
        def.stun = Math.max(1, base + m.hitAdv);
        def.vx = 0;
      }
    }

    // 押し返し。ガードされたときは守った側はその場に踏みとどまり、攻めた側が下がる（影縫い）
    if (blocked) {
      att.pushVx = (-dir * m.push * S) / 5;
    } else if (def.onGround) {
      // 当たったときは相手を押す。相手が画面端なら、押せなかった分だけ自分が下がる
      const push = m.push * S;
      const limits = stageLimits(def);
      const room = dir === 1 ? limits.max - def.x : def.x - limits.min;
      const defPush = Math.min(push, Math.max(0, room));
      def.pushVx = (dir * defPush) / 5;
      if (!air && defPush < push) att.pushVx = (-dir * (push - defPush)) / 5;
    }
  }

  function knockDown(f) {
    f.pose = POSE.DOWN;
    f.stun = 0;
    f.crouching = false;
    f.vx = 0;
    f.downTimer = BATTLE.downFrames;
    f.downFrame = 0;
  }

  // 両方の技の当たりを調べる。同時に当たったら両方当たる（相打ち）
  function checkHits(state) {
    const hits = [];
    for (let i = 0; i < 2; i++) {
      const att = state.fighters[i];
      const def = state.fighters[1 - i];
      const box = hitbox(att);
      const body = hurtbox(def);
      if (box && body && overlap(box, body)) hits.push([att, def, moveData(att), box, body]);
    }
    for (const [att, def, m, box, body] of hits) applyHit(state, att, def, m, box, body);
  }

  // 2人の体が重なっていたら、半分ずつ押し戻す。
  // 片方が画面端なら、もう片方が全部押し戻される。
  // 体の上下が重なっていなければ（ジャンプで相手の上にいるなど）押さないので、飛び越えられる
  // ぶつかり判定は体の下の方（高さの PUSH_HEIGHT_RATIO 倍）だけで見る。
  // 頭や肩まで含めると、相手より高く跳んでも飛び越えられなくなるため
  const PUSH_HEIGHT_RATIO = 0.6;

  function pushApart(a, b) {
    const aTop = a.y - Math.round(fighterHeight(a) * PUSH_HEIGHT_RATIO) * S;
    const bTop = b.y - Math.round(fighterHeight(b) * PUSH_HEIGHT_RATIO) * S;
    if (a.y <= bTop || b.y <= aTop) return; // 上下が重なっていない

    const minDist = ((CHARACTERS[a.charId].width + CHARACTERS[b.charId].width) / 2) * S;
    const dist = Math.abs(a.x - b.x);
    if (dist >= minDist) return;

    // どちらが左かを決める。ぴったり同じ位置なら向きで決める
    let left = a;
    let right = b;
    if (a.x > b.x || (a.x === b.x && a.facing === -1)) {
      left = b;
      right = a;
    }
    const overlapPx = minDist - dist;
    const half = Math.floor(overlapPx / 2);
    left.x -= half;
    right.x += overlapPx - half;

    // 画面端からはみ出したら、はみ出した分を相手側に回す
    const l = stageLimits(left);
    if (left.x < l.min) {
      right.x += l.min - left.x;
      left.x = l.min;
    }
    const r = stageLimits(right);
    if (right.x > r.max) {
      left.x -= right.x - r.max;
      right.x = r.max;
    }
    clampToStage(left);
  }

  // 地上で自由に動けるときだけお互いの方を向く（空中や技の最中は向きを変えない）
  function canTurn(f) {
    return f.onGround && isFree(f);
  }
  function updateFacing(a, b) {
    if (a.x === b.x) return;
    if (canTurn(a)) a.facing = a.x < b.x ? 1 : -1;
    if (canTurn(b)) b.facing = b.x < a.x ? 1 : -1;
  }

  // ラウンドの勝ち負けを調べる
  function checkRoundEnd(state) {
    const r = state.round;
    const [a, b] = state.fighters;
    let winner = null;
    if (a.health === 0 || b.health === 0) {
      r.reason = "ko";
      winner = a.health === 0 && b.health === 0 ? "draw" : a.health === 0 ? 1 : 0;
    } else if (r.timer === 0) {
      // 時間切れは体力の割合が多い方の勝ち（キャラで最大体力が違うため割合で比べる）
      r.reason = "time";
      const ra = a.health * CHARACTERS[b.charId].health;
      const rb = b.health * CHARACTERS[a.charId].health;
      winner = ra === rb ? "draw" : ra > rb ? 0 : 1;
    }
    if (winner === null) return;
    r.winner = winner;
    // 引き分けは両方に1本
    if (winner === "draw") {
      r.wins[0] += 1;
      r.wins[1] += 1;
    } else {
      r.wins[winner] += 1;
    }
    r.phase = PHASE.ROUND_END;
    r.phaseTimer = BATTLE.roundEndFrames;
  }

  function nextRound(state) {
    const r = state.round;
    const need = BATTLE.winsToMatch;
    if (r.wins[0] >= need || r.wins[1] >= need) {
      r.phase = PHASE.MATCH_END;
      r.matchWinner = r.wins[0] === r.wins[1] ? "draw" : r.wins[0] > r.wins[1] ? 0 : 1;
      return;
    }
    r.number += 1;
    r.timer = BATTLE.roundSeconds * C.FPS;
    r.winner = null;
    r.reason = null;
    r.phase = PHASE.INTRO;
    r.phaseTimer = BATTLE.introFrames;
    resetFighters(state);
  }

  // 状態を1フレーム進める。inputs は [左のプレイヤーの入力, 右のプレイヤーの入力]
  function step(state, inputs) {
    const r = state.round;
    state.frame += 1;
    for (const e of state.effects) e.life -= 1;
    state.effects = state.effects.filter((e) => e.life > 0);

    // 当たった瞬間は両者とも一瞬止まる（硬直差は変わらない）
    if (state.hitstop > 0) {
      state.hitstop -= 1;
      // 止まっている間に押したボタンも先行入力として覚える
      if (r.phase === PHASE.FIGHT) {
        state.fighters.forEach((f, i) => {
          const input = inputs[i] | 0;
          registerPresses(f, input);
          f.prevInput = input;
        });
      }
      return state;
    }

    // 戦っている間だけ操作できる
    const fighting = r.phase === PHASE.FIGHT;
    const [a, b] = state.fighters;
    // 影縫い：動く前の位置で、相手の技の影縫い範囲に体が入っているか
    for (let i = 0; i < 2; i++) {
      const zone = shadowStitchBox(state.fighters[1 - i]);
      const body = hurtbox(state.fighters[i]);
      state.fighters[i].pinned = !!(zone && body && overlap(zone, body));
    }
    updateFighter(a, fighting ? inputs[0] | 0 : 0);
    updateFighter(b, fighting ? inputs[1] | 0 : 0);
    pushApart(a, b);
    if (fighting) checkHits(state);
    updateFacing(a, b);

    if (r.phase === PHASE.INTRO) {
      r.phaseTimer -= 1;
      if (r.phaseTimer <= 0) r.phase = PHASE.FIGHT;
    } else if (r.phase === PHASE.FIGHT) {
      if (r.timer > 0) r.timer -= 1;
      checkRoundEnd(state);
    } else if (r.phase === PHASE.ROUND_END) {
      r.phaseTimer -= 1;
      if (r.phaseTimer <= 0) nextRound(state);
    }
    return state;
  }

  // 状態を短い数字にまとめる。同じ試合が再現できているかの確認に使う
  function hashState(state) {
    const text = JSON.stringify(state);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  SF.game = {
    POSE,
    PHASE,
    createGame,
    step,
    fighterHeight,
    hurtbox,
    hitbox,
    shadowStitchBox,
    isFree,
    moveData,
    toStats,
    hashState,
  };
})(globalThis);
