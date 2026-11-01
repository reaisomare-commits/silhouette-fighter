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
      forwardDash: { ...c.forwardDash, speed: px(c.forwardDash.speed || 0), distance: px(c.forwardDash.distance || 0) },
      backDash: { ...c.backDash, speed: px(c.backDash.speed || 0), distance: px(c.backDash.distance || 0) },
      float: c.float ? { ...c.float, speed: px(c.float.speed) } : null,
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
    WARP: "warp", // ワープで消えている（ゲンマ。攻撃も投げも当たらない）
    DASH_RECOVERY: "dashRecovery", // ステップ・ダッシュ・バックステップの止まり際（動けない）
    ATTACK: "attack", // 技を出している（どの技かは move）
    HIT: "hit", // 攻撃を受けてのけぞっている
    BLOCK: "block", // ガードで攻撃を受け止めている
    LAUNCH: "launch", // 空中で攻撃を受けて落ちている（攻撃は当たらない）
    DOWN: "down", // 倒れている（攻撃は当たらない）
    THROW: "throw", // 相手を掴んでいる・投げている
    THROWN: "thrown", // 掴まれている（攻撃は当たらない。U＋Iで投げ抜け）
    TECH: "tech", // 投げ抜けして離れたところ（動けない）
  });

  // 通常技（地上のU・I）か。必殺技キャンセル・連続技ができるのはこれだけ
  const GROUND_NORMALS = ["standLight", "standHeavy", "crouchLight", "crouchHeavy"];
  const isLightMove = (name) => name === "standLight" || name === "crouchLight";
  // 空中で出す技（1回のジャンプで1回だけ）
  const isAirMove = (name) => name === "airLight" || name === "airHeavy" || name === "airSpecial";

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
      backstepRecovery: false, // 止まり際がバックステップのものか（攻撃を受けるとダメージが増える）
      punishedGrab: false,
      throwPressAge: 99, // U＋Iを押してから何フレームたったか（掴まれる少し前に押していても投げ抜けになる）
      bufferAge: 0, // 先行入力を覚えてから何フレームたったか
      charging: false, // ためる技（リンの突進拳）で、ボタンを押し続けてためている最中か
      chargeFrames: 0, // ためたフレーム数（長いほど遠くまで進む） // バックステップの止まり際に掴まれたか（投げのダメージが増える）
      actionTimer: 0, // その動きの残りフレーム（ダッシュは走ったフレーム数）
      move: null, // 出している技の名前（moves の中の名前）
      moveFrame: 0, // 技を出してから何フレーム目か（押したフレームが1）
      moveHit: false, // この技がもう当たった（ガードされた）か。1回の技で1回だけ当たる
      airAttackUsed: false, // このジャンプで空中攻撃を出したか
      floatLeft: 0, // このジャンプであと何フレーム浮けるか（浮遊できるキャラだけ）
      floating: false, // 浮いて止まっている最中か
      warpDir: 0, // ワープの向き（1＝前、-1＝後ろ）
      stun: 0, // のけぞり・ガード硬直の残りフレーム
      downTimer: 0, // ダウンの残りフレーム
      downFrame: 0, // 倒れてから何フレームたったか（倒れる・バウンド・起き上がりの動きを描くため）
      buffer: null, // 先行入力：動けない間に最後に押したボタン（"light"・"heavy"・"special"・"throw"・"jump" など）。動けるようになった最初のフレームで出る
      lightAge: 99, // Uを押してから何フレームたったか（U＋Iの同時押し判定用）
      heavyAge: 99, // Iを押してから何フレームたったか
      chainLights: 0, // 今の連続技で弱攻撃を何回出したか
      combo: 0, // 今受けている連続技の何発目まで当たったか（コンボ補正用）
      comboDamage: 0, // 今受けている連続技の合計ダメージ
      grab: null, // 相手を掴んでいる間 { timer: 掴んでから何フレームか }
      techInput: false, // 掴まれている間にU＋Iを押したか
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
      projectiles: [], // 飛んでいる飛び道具
      comboInfo: [null, null], // 連続技の表示（描画用）。[左のキャラが当てている連続技, 右]
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
    if (options.record) {
      Object.defineProperty(state, "log", { value: { moves: [{}, {}] }, enumerable: false });
    }
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
    state.projectiles = [];
    state.comboInfo = [null, null];
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
      !f.move &&
      f.stun === 0 &&
      f.pose !== POSE.DOWN &&
      f.pose !== POSE.LAUNCH &&
      f.pose !== POSE.THROWN &&
      !f.action
    );
  }

  // 自動対戦の記録（options.record で作った試合だけ）。技ごとに 使った回数・当たった・ガードされた・投げ抜けされた・与えたダメージ を数える。
  // 記録は state.log に入れるが、試合の再現の確認（hashState）には入らないよう、見えない形で持つ
  function record(state, f, name, field, amount = 1) {
    const log = state.log;
    if (!log || !name) return;
    const side = log.moves[state.fighters.indexOf(f)];
    const row = side[name] || (side[name] = { uses: 0, hits: 0, blocks: 0, techs: 0, damage: 0 });
    row[field] += amount;
  }

  // chain＝連続技（通常技や必殺技からのつなぎ）として出したか
  function startMove(state, f, name, chain = false) {
    record(state, f, name, "uses");
    f.move = name;
    f.moveFrame = 1;
    f.moveHit = false;
    f.pose = POSE.ATTACK;
    f.buffer = null;
    f.charging = !!CHARACTERS[f.charId].moves[name].charge;
    f.chargeFrames = 0;
    if (isAirMove(name)) f.airAttackUsed = true;
    if (!chain) f.chainLights = 0;
    if (isLightMove(name)) f.chainLights += 1;
  }

  // 最大までためた技（リンの突進拳）を出しているか。ためている間に最大になったときから、技が終わるまで
  function fullCharge(f) {
    const m = moveData(f);
    return !!(m && m.charge && m.charge.full && f.chargeFrames >= m.charge.max);
  }

  // 自分の飛び道具がまだ画面にあるか（飛刃は画面に1つまで）
  function hasProjectile(state, f) {
    return state.projectiles.some((p) => p.owner === state.fighters.indexOf(f));
  }

  // Oで出る必殺技の名前。しゃがみながらなら S+O の技。出せないときは null
  function specialName(state, f, down) {
    const name = down ? "crouchSpecial" : "special";
    const m = CHARACTERS[f.charId].moves[name];
    if (!m) return null;
    if (m.projectile && hasProjectile(state, f)) return null;
    return name;
  }

  // 当たった（ガードされた）地上の通常技から、今の先行入力で出せる技（キャンセル・連続技）。なければ null
  //   ・U・I → 必殺技（O / S+O）
  //   ・U → I（リンは U → U → I も）
  function cancelTarget(state, f, down) {
    if (!f.moveHit || !GROUND_NORMALS.includes(f.move)) return null;
    if (moveData(f).noCancel) return null;
    const b = f.buffer;
    if (b === "special") return specialName(state, f, down);
    if (!isLightMove(f.move)) return null;
    if (b === "heavy") return down ? "crouchHeavy" : "standHeavy";
    if (b === "light" && f.chainLights < CHARACTERS[f.charId].lightChainMax) {
      return down ? "crouchLight" : "standLight";
    }
    return null;
  }

  // 押した瞬間のボタンと方向キーの2回押しを先行入力として覚える。前に覚えていたものは上書き（最後の入力を優先）。
  // 攻撃を覚えたあとに左右の移動キーを押したら、その攻撃は取り消す（移動が最後の入力なので、動けるようになったら移動する）。
  // 同じフレームに2つ押したときは 投げ（U＋I） ＞ 必殺技 ＞ 強攻撃 ＞ 弱攻撃 ＞ ジャンプ ＞ ステップ・ダッシュ・バックステップ の順
  function registerPresses(f, input) {
    // 「前」と「後ろ」は押した時点の向きで決める
    const forwardBtn = f.facing === 1 ? BUTTON.RIGHT : BUTTON.LEFT;
    const backBtn = f.facing === 1 ? BUTTON.LEFT : BUTTON.RIGHT;
    // 方向キーの2回押しを見張る。押した瞬間に受付中なら2回押し成立
    if (f.tapForward > 0) f.tapForward -= 1;
    if (f.tapBack > 0) f.tapBack -= 1;
    if (f.lightAge < 99) f.lightAge += 1;
    if (f.throwPressAge < 99) f.throwPressAge += 1;
    if (f.bufferAge < 99) f.bufferAge += 1;
    const oldBuffer = f.buffer;
    if (f.heavyAge < 99) f.heavyAge += 1;
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
    const light = justPressed(input, f.prevInput, BUTTON.LIGHT);
    const heavy = justPressed(input, f.prevInput, BUTTON.HEAVY);
    if (light) f.lightAge = 0;
    if (heavy) f.heavyAge = 0;
    // UとIを（ほぼ）同時に押したら投げ。少しずれても THROW_INPUT_WINDOW フレーム以内なら同時押し
    // 攻撃ボタンのあとに左右の移動キーを押したら、覚えていた攻撃は取り消す（移動が最後の入力）。
    // ただし投げは取り消さない。ほぼ同時（THROW_INPUT_WINDOW フレーム以内）に押した方向キーでも取り消さない
    const moved = justPressed(input, f.prevInput, forwardBtn) || justPressed(input, f.prevInput, backBtn);
    if (moved && ["light", "heavy", "special"].includes(f.buffer) && f.bufferAge > BATTLE.throwInputWindow) f.buffer = null;
    const win = BATTLE.throwInputWindow;
    const both = (light && f.heavyAge <= win) || (heavy && f.lightAge <= win);
    if (both) {
      f.buffer = "throw";
      f.throwPressAge = 0;
      f.lightAge = 99;
      f.heavyAge = 99;
    } else if (justPressed(input, f.prevInput, BUTTON.SPECIAL)) f.buffer = "special";
    else if (heavy) f.buffer = "heavy";
    else if (light) f.buffer = "light";
    else if (justPressed(input, f.prevInput, BUTTON.JUMP)) f.buffer = "jump";
    else if (dash) f.buffer = dash;
    if (f.buffer !== oldBuffer) f.bufferAge = 0;
  }

  function updateFighter(state, f, input) {
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
    const wantAttack = ["light", "heavy", "special", "throw"].includes(f.buffer) ? f.buffer : null;
    const wantJump = f.buffer === "jump";
    const doubleForward = f.buffer === "dashForward";
    const doubleBack = f.buffer === "dashBack";

    if (f.pose === POSE.THROWN) {
      // 掴まれている。U＋Iを押したら投げ抜け（決まるのは投げの処理で）
      f.vx = 0;
      if (f.buffer === "throw") f.techInput = true;
      f.buffer = null;
    } else if (f.grab) {
      // 相手を掴んでいる。投げの処理が終わるまで動けない
      f.vx = 0;
    } else if (f.pose === POSE.LAUNCH) {
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
      // のけぞり・ガード硬直（投げのあと・投げ抜けのあとも）。動けない
      f.stun -= 1;
      f.vx = 0;
      if (f.stun === 0) {
        f.pose = f.crouching ? POSE.CROUCH : POSE.STAND;
      }
    } else if (f.onGround && f.move && f.charging && isDown(input, BUTTON.SPECIAL) && f.chargeFrames < moveData(f).charge.max) {
      // ためる技：ボタンを押している間は、出る前の構えのまま止まってためる（離したら出る）
      f.chargeFrames += 1;
      f.vx = 0;
    } else if (f.onGround && f.move) {
      f.charging = false;
      // 地上の技の最中。最後まで出しきるまで動けない。
      // ただし通常技が当たった（ガードされた）あとは、必殺技や次の通常技につなげられる
      const m = moveData(f);
      f.vx = 0;
      const next = cancelTarget(state, f, down);
      if (next) {
        f.crouching = next === "crouchLight" || next === "crouchHeavy";
        startMove(state, f, next, true);
      } else if (
        f.buffer === "throw" &&
        GROUND_NORMALS.includes(f.move) &&
        !f.moveHit &&
        f.moveFrame <= BATTLE.throwInputWindow + 1
      ) {
        // UかIを押した直後にもう片方を押したら、出かけた技を投げに変える（押し始めから数える）
        record(state, f, f.move, "uses", -1); // 出かけた技は出なかったことにして、投げを数える
        record(state, f, "throw", "uses");
        f.move = "throw";
        f.buffer = null;
        f.crouching = false;
        f.moveFrame += 1;
      } else if (f.moveFrame >= moveTotal(m)) {
        f.move = null;
        f.pose = f.crouching ? POSE.CROUCH : POSE.STAND;
        groundControl();
      } else {
        f.moveFrame += 1;
        if (m.projectile && f.moveFrame === m.startup) spawnProjectile(state, f, m);
      }
      // 前に突っ込む技
      const cur = moveData(f);
      if (cur && cur.lunge && f.moveFrame >= cur.lunge.from && f.moveFrame <= cur.lunge.to) {
        // ためた分だけ速く進む（＝遠くまで届く）
        const speed = cur.lunge.speed + (cur.charge && f.move === "special" ? f.chargeFrames * cur.charge.speedPerFrame : 0);
        f.vx = f.facing * Math.trunc(speed * S);
      }
    } else if (f.onGround && f.action) {
      // ステップ・ダッシュ・バックステップの最中
      updateAction(f, st, { forward, down, jump: wantJump });
    } else if (f.onGround) {
      groundControl();
    } else if (f.move) {
      // 空中攻撃の最中。着地するまで何もできない
      f.moveFrame += 1;
      const m = moveData(f);
      if (m.projectile && f.moveFrame === m.startup) spawnProjectile(state, f, m);
    } else if ((wantAttack === "light" || wantAttack === "heavy" || wantAttack === "throw") && !f.airAttackUsed) {
      // 空中攻撃は1回のジャンプで1回だけ（空中でU＋Iは強攻撃になる）
      startMove(state, f, wantAttack === "light" ? "airLight" : "airHeavy");
    } else if (wantAttack === "special" && !f.airAttackUsed && CHARACTERS[f.charId].moves.airSpecial) {
      // 空中の必殺技（ゲンマの異空間弾）。空中攻撃と合わせて1回のジャンプで1回。飛び道具がもう画面にあれば出ない（入力は捨てる）
      f.buffer = null;
      if (!hasProjectile(state, f)) startMove(state, f, "airSpecial");
    }

    // 浮遊：頂上を過ぎてからジャンプのキーを押し続けている間は、落ちずに浮く。離したらもう浮けない
    if (!f.onGround && st.float && f.pose !== POSE.LAUNCH) {
      const hold = isDown(input, BUTTON.JUMP);
      if (f.floating && (!hold || f.floatLeft <= 0)) {
        f.floating = false;
        f.floatLeft = 0;
      } else if (!f.floating && hold && f.floatLeft > 0 && f.vy >= 0) {
        f.floating = true;
        f.vy = 0;
      }
      if (f.floating) {
        f.floatLeft -= 1;
        // 浮いている間は左右のキーで自由に動ける（離すとその場で止まる）。浮遊をやめたら、そのときの横の速さのまま落ちる
        f.vx = forward ? f.facing * st.float.speed : back ? -f.facing * st.float.speed : 0;
        if (f.buffer === "jump") f.buffer = null; // 浮くために押したジャンプは、着地後のジャンプにしない
      }
    } else {
      f.floating = false;
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
        f.floatLeft = st.float ? st.float.frames : 0;
      } else if (wantAttack === "throw") {
        f.vx = 0;
        f.crouching = false;
        startMove(state, f, "throw");
      } else if (wantAttack === "special") {
        // しゃがみながら O で S+O の技。飛刃がもう画面にあるときは出ない（入力は捨てる）
        const name = specialName(state, f, down);
        f.vx = 0;
        f.buffer = null;
        if (name) {
          f.crouching = false;
          startMove(state, f, name);
        } else {
          f.crouching = down;
          f.pose = down ? POSE.CROUCH : POSE.STAND;
        }
      } else if (wantAttack) {
        // しゃがみながら押すとしゃがみ技
        f.vx = 0;
        f.crouching = down;
        const name = (down ? "crouch" : "stand") + (wantAttack === "heavy" ? "Heavy" : "Light");
        startMove(state, f, name);
      } else if ((doubleForward || doubleBack) && down) {
        // しゃがんでいるときはステップ類は出ない（覚えていた入力は捨てる）
        f.buffer = null;
        f.vx = 0;
        f.crouching = true;
        f.pose = back ? POSE.GUARD_CROUCH : POSE.CROUCH;
      } else if (doubleForward) {
        f.buffer = null;
        f.crouching = false;
        if (st.forwardDash.type === "warp") startWarp(f, st.forwardDash, 1);
        else startAction(f, st.forwardDash.type === "run" ? POSE.RUN : POSE.STEP, st);
      } else if (doubleBack) {
        f.buffer = null;
        f.crouching = false;
        if (st.backDash.type === "warp") startWarp(f, st.backDash, -1);
        else startAction(f, POSE.BACKSTEP, st);
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

    // 空中では横の速さはそのまま、重力で落ちる。ガードはできない。浮いている間は落ちず、横の速さも遅くなる
    if (!f.onGround && !f.floating) {
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
      f.floating = false;
      f.floatLeft = 0;
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

  // ワープを始める：その場で消える。dir は 1＝前、-1＝後ろ
  function startWarp(f, dash, dir) {
    f.action = POSE.WARP;
    f.pose = POSE.WARP;
    f.actionTimer = dash.frames;
    f.warpDir = dir;
    f.vx = 0;
  }

  // 止まり際（動けない時間）に入る
  function startRecovery(f, frames, keepSpeed, backstep = false) {
    f.backstepRecovery = backstep;
    f.action = POSE.DASH_RECOVERY;
    f.pose = POSE.DASH_RECOVERY;
    f.actionTimer = frames;
    if (!keepSpeed) f.vx = 0;
  }

  // ステップ・ダッシュ・バックステップを1フレーム進める。
  // 途中でガードや向きの切り替えはできない（ダッシュ中のジャンプだけはできる）
  function updateAction(f, st, { forward, down, jump }) {
    if (f.action === POSE.WARP) {
      // 消えている間は動かない。時間が来たら distance だけ先（後ろ）に現れる。相手の体は通り抜ける
      f.vx = 0;
      f.actionTimer -= 1;
      if (f.actionTimer <= 0) {
        const back = f.warpDir < 0;
        const dash = back ? st.backDash : st.forwardDash;
        f.x += f.facing * f.warpDir * dash.distance;
        clampToStage(f);
        startRecovery(f, dash.recovery, false, back);
      }
      return;
    }
    if (f.action === POSE.STEP || f.action === POSE.BACKSTEP) {
      f.actionTimer -= 1;
      if (f.actionTimer <= 0) {
        const back = f.action === POSE.BACKSTEP;
        startRecovery(f, back ? st.backDash.recovery : st.forwardDash.recovery, false, back);
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
        f.floatLeft = st.float ? st.float.frames : 0;
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
        f.warpDir = 0;
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
  // バックステップの初めの何フレームかは無敵（攻撃も投げも当たらない）
  function backstepInvincible(f) {
    const bd = CHARACTERS[f.charId].backDash;
    return f.action === POSE.BACKSTEP && bd.frames - f.actionTimer < (bd.invincible || 0);
  }

  // バックステップの止まり際（隙）か。ここで攻撃や投げを受けるとダメージが増える
  function backstepPunishable(f) {
    return f.action === POSE.DASH_RECOVERY && f.backstepRecovery;
  }

  function hurtbox(f) {
    if (f.pose === POSE.DOWN || f.pose === POSE.LAUNCH || f.pose === POSE.THROWN) return null;
    if (backstepInvincible(f) || f.action === POSE.WARP) return null;
    const w = CHARACTERS[f.charId].width;
    const x = f.x / S;
    const y = f.y / S;
    // 浮いている間は、やられる範囲の下側が小さくなる（ゲンマ）
    const cut = f.floating ? CHARACTERS[f.charId].float.hurtCut || 0 : 0;
    return { left: x - w / 2, right: x + w / 2, top: y - fighterHeight(f), bottom: y - cut };
  }

  // 技を出している間の、伸ばした手足・刀のやられる範囲（hurtExtend があればその範囲、なければ当たる範囲）。
  // 当たる時間はその範囲まで、発生前と硬直中は前への長さが半分になる。投げや飛び道具を撃つ技にもある
  function limbHurtbox(f) {
    const m = moveData(f);
    const ext = m && (m.hurtExtend || m.hitbox);
    if (!ext || !hurtbox(f)) return null;
    // 掴んでいる間・投げきったあとは伸ばさない
    if (f.grab) return null;
    const full = isActive(f);
    const half = { ...ext, x2: full ? ext.x2 : (ext.x1 + ext.x2) / 2 };
    return boxAt(f, half);
  }

  // やられる範囲をすべて（体と、伸ばした手足）
  function hurtboxes(f) {
    return [hurtbox(f), limbHurtbox(f)].filter(Boolean);
  }

  // box がどれかのやられる範囲に当たっていたら、その範囲を返す
  function touching(box, f) {
    return hurtboxes(f).find((b) => overlap(box, b)) || null;
  }

  // 同時に当たったときの強さ。強い方だけが当たり、同じなら相打ち（投げ＜弱＜強・必殺技）
  function hitRank(name) {
    if (name === "throw") return 0;
    if (name === "standLight" || name === "crouchLight" || name === "airLight") return 1;
    return 2;
  }

  // 当たる範囲（技の先）。当たる時間でなければ null
  function boxAt(f, h) {
    const x = f.x / S;
    const y = f.y / S;
    const a = x + h.x1 * f.facing;
    const b = x + h.x2 * f.facing;
    return { left: Math.min(a, b), right: Math.max(a, b), top: y - h.y2, bottom: y - h.y1 };
  }
  function hitbox(f) {
    if (!isActive(f) || f.moveHit) return null;
    const m = moveData(f);
    if (!m.hitbox || m.kind === "throw") return null;
    return boxAt(f, m.hitbox);
  }

  // 掴める範囲（投げ）。掴める時間でなければ null
  function grabBox(f) {
    if (!isActive(f) || f.moveHit) return null;
    const m = moveData(f);
    if (m.kind !== "throw") return null;
    return boxAt(f, m.hitbox);
  }

  // 飛び道具の当たる範囲
  function projectileBox(p) {
    const x = p.x / S;
    const y = p.y / S;
    return { left: x - p.w / 2, right: x + p.w / 2, top: y - p.h / 2, bottom: y + p.h / 2 };
  }

  function spawnProjectile(state, f, m) {
    const pr = m.projectile;
    state.projectiles.push({
      owner: state.fighters.indexOf(f),
      move: f.move,
      x: f.x + f.facing * pr.spawnX * S,
      y: f.y - pr.y * S,
      vx: f.facing * pr.speed * S,
      vy: (pr.fall || 0) * S, // 斜め下に飛ぶ飛び道具（空中の異空間弾）は下へも進む
      homing: pr.homing ? { turn: Math.round(pr.homing.turn * S), max: Math.round(pr.homing.max * S) } : null,
      facing: f.facing,
      w: pr.width,
      h: pr.height,
      age: 0,
    });
    // 異空間の門から出る飛び道具（ゲンマ）は、出た所に門の絵を少し残す（描画用）
    if (pr.portal) {
      const i = state.fighters.indexOf(f);
      const mirror = i === 1 && state.fighters[0].charId === f.charId;
      state.effects.push({ kind: "portal", charId: f.charId, mirror, x: (f.x + f.facing * pr.spawnX * S) / S, y: (f.y - pr.y * S) / S, h: pr.height, life: 16 });
    }
  }

  // 飛び道具を進める。画面の外に出たら消える。飛び道具同士がぶつかったら両方消える
  function moveProjectiles(state) {
    for (const p of state.projectiles) {
      if (p.homing && p.age > 0) {
        // ホーミング：相手の体の真ん中の高さに向かって、上下の速さを少しずつ変える（相手を通り過ぎたら変えない）
        const target = state.fighters[1 - p.owner];
        const ahead = Math.sign(target.x - p.x) === Math.sign(p.vx);
        if (ahead) {
          const ty = target.y - (fighterHeight(target) / 2) * S;
          const want = Math.max(-p.homing.max, Math.min(p.homing.max, ty - p.y));
          if (p.vy < want) p.vy = Math.min(want, p.vy + p.homing.turn);
          else if (p.vy > want) p.vy = Math.max(want, p.vy - p.homing.turn);
        }
      }
      if (p.age > 0) {
        // 出た瞬間のフレームは動かない（目の前の相手にはすぐ当たる）
        p.x += p.vx;
        p.y += p.vy;
      }
      p.age += 1;
      // 地面に着いたら消える
      if (p.y - (p.h / 2) * S > C.GROUND_Y * S) {
        p.dead = true;
      } else if (p.vy > 0 && p.y + (p.h / 2) * S >= C.GROUND_Y * S) {
        p.dead = true;
        state.effects.push({ kind: "block", x: p.x / S, y: C.GROUND_Y - 6, life: 12 });
      }
    }
    const list = state.projectiles;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].owner !== list[j].owner && !list[i].dead && !list[j].dead && overlap(projectileBox(list[i]), projectileBox(list[j]))) {
          list[i].dead = list[j].dead = true;
          state.effects.push({ kind: "block", x: (list[i].x + list[j].x) / 2 / S, y: list[i].y / S, life: 12 });
        }
      }
    }
    state.projectiles = list.filter((p) => !p.dead && p.x > -50 * S && p.x < (C.STAGE_WIDTH + 50) * S);
  }

  // 影縫い範囲：技を出してから当たる時間が終わるまで、当たる範囲を少し広げた四角。それ以外は null
  function shadowStitchBox(f) {
    const m = moveData(f);
    if (!m || !m.hitbox || m.kind === "throw" || f.moveHit || f.moveFrame >= m.startup + m.active) return null;
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

  // 連続技のn発目のダメージの割合（%）
  function comboRate(n) {
    return Math.max(100 - BATTLE.comboScaleStep * (n - 1), BATTLE.comboScaleMin);
  }

  // コンボ補正をかけたダメージを与える。n発目は 100% − 10%×(n−1)（最低10%）
  function dealDamage(state, att, def, amount, punish = false) {
    if (punish && def.combo === 0) {
      amount = Math.floor((amount * BATTLE.backstepPunishRate) / 100);
      state.effects.push({ kind: "text", text: "隙狩り！", x: def.x / S, y: def.y / S - 190, life: 45 });
    }
    def.combo += 1;
    const rate = comboRate(def.combo);
    const dmg = Math.floor((amount * rate) / 100);
    const before = def.health;
    def.health = Math.max(0, def.health - dmg);
    def.comboDamage += dmg;
    state.comboInfo[state.fighters.indexOf(att)] = { hits: def.combo, damage: def.comboDamage, timer: 90 };
    return before - def.health; // 実際に減った体力（記録用。体力が0より下には減らない）
  }

  // 掴んでいる最中に攻撃を受けたら、掴んでいた相手を放す
  function releaseGrab(state, f) {
    if (!f.grab) return;
    f.grab = null;
    const other = state.fighters[1 - state.fighters.indexOf(f)];
    if (other.pose === POSE.THROWN) other.pose = POSE.STAND;
  }

  // 当たった・ガードされたときの処理。
  // proj＝飛び道具が当たったとき。硬直の長さは「目の前で当てたとき」と同じにする（離れて当てるほど攻めた側が有利）
  // name＝当たった技の名前（記録用。相打ちで先に処理した当たりが技を止めても、正しい名前で数える）
  function applyHit(state, att, def, m, box, body, proj = null, name = proj ? proj.move : att.move) {
    const air = m.recovery === null;
    const blocked = canBlock(def, m);
    const moveName = name;
    record(state, att, moveName, blocked ? "blocks" : "hits");
    if (!proj) att.moveHit = true;
    // のけぞり・ガード硬直の長さは、硬直差がそのとおりになるように決める。
    // 空中攻撃は「着地して着地硬直が終わるまで」を数え、低い所で当てたときに表どおりになる
    const base = proj
      ? air
        ? // 空中から撃った飛び道具：低い所で撃って、すぐ着地したときと同じに数える
          BATTLE.airHitLow + toStats(att.charId).landingLag
        : moveTotal(m) - m.startup
      : air
        ? // 空中攻撃：着地の airHitLow フレーム前より低い所で当てたら表どおりの有利。
          // それより高い所（上りや頂上）で当てると、早く当てた分だけ有利が減る
          Math.min(framesUntilLanding(att), BATTLE.airHitLow) + toStats(att.charId).landingLag
        : attackerRemaining(att, m);
    const dir = att.facing;
    // 火花は当たる範囲と体が重なった所の真ん中に出す
    const fx = (Math.max(box.left, body.left) + Math.min(box.right, body.right)) / 2;
    const fy = (Math.max(box.top, body.top) + Math.min(box.bottom, body.bottom)) / 2;

    if (blocked) {
      def.pose = POSE.BLOCK;
      def.crouching = def.holdDown;
      // 最大までためた技は、ガードされたときの硬直差が変わる
      const blockAdv = !proj && fullCharge(att) && m.charge.full.blockAdv !== undefined ? m.charge.full.blockAdv : m.blockAdv;
      def.stun = Math.max(1, base + blockAdv);
      def.vx = 0;
      // 必殺技はガードされても少しだけ体力が減る（削り）
      if (m.kind === "special") {
        const chip = Math.min(def.health, Math.floor((m.damage * BATTLE.chipRate) / 100));
        def.health -= chip;
        record(state, att, moveName, "damage", chip);
      }
      state.hitstop = Math.max(state.hitstop, BATTLE.hitstopBlock);
      state.effects.push({ kind: "block", x: fx, y: fy, life: 12 });
    } else {
      record(state, att, moveName, "damage", dealDamage(state, att, def, m.damage, backstepPunishable(def)));
      releaseGrab(state, def);
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
      if (!proj) att.pushVx = (-dir * m.push * S) / 5;
    } else if (def.onGround) {
      // 当たったときは相手を押す。相手が画面端なら、押せなかった分だけ自分が下がる
      const push = m.push * S;
      const limits = stageLimits(def);
      const room = dir === 1 ? limits.max - def.x : def.x - limits.min;
      const defPush = Math.min(push, Math.max(0, room));
      def.pushVx = (dir * defPush) / 5;
      if (!air && !proj && defPush < push) att.pushVx = (-dir * (push - defPush)) / 5;
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

  // 両方の技（と飛び道具）の当たりを調べる。
  // 同時に当たったら強い方だけが当たる（弱と強なら強）。同じ強さなら両方当たる（相打ち）。
  // 打撃が先で、そのあと投げ。打撃を受けた側の投げは出ない（投げと攻撃が同時なら攻撃が勝つ）
  function checkHits(state) {
    const hits = [];
    for (let i = 0; i < 2; i++) {
      const att = state.fighters[i];
      const def = state.fighters[1 - i];
      const box = hitbox(att);
      const body = box && touching(box, def);
      if (body) hits.push({ att, def, m: moveData(att), box, body, p: null, rank: hitRank(att.move), name: att.move });
    }
    for (const p of state.projectiles) {
      const att = state.fighters[p.owner];
      const def = state.fighters[1 - p.owner];
      // 最大までためた突進拳は、飛び道具をすり抜ける（飛び道具は消えずにそのまま飛ぶ）
      if (fullCharge(def) && moveData(def).charge.full.projectileInvincible) continue;
      const box = projectileBox(p);
      const body = touching(box, def);
      if (body) hits.push({ att, def, m: CHARACTERS[att.charId].moves[p.move], box, body, p, rank: hitRank(p.move), name: p.move });
    }
    // 両方が当てていたら、相手より弱い方の当たりは消す
    const best = [0, 1].map((i) => Math.max(-1, ...hits.filter((h) => h.att === state.fighters[i]).map((h) => h.rank)));
    const win = hits.filter((h) => {
      const other = best[1 - state.fighters.indexOf(h.att)];
      return other < 0 || h.rank >= other;
    });
    for (const h of win) {
      if (h.p) h.p.dead = true;
      applyHit(state, h.att, h.def, h.m, h.box, h.body, h.p, h.name);
    }
    state.projectiles = state.projectiles.filter((p) => !p.dead);
    checkThrows(state);
  }

  // 投げられる状態か：地上にいて、のけぞり・ガード硬直・ダウン中・バックステップで下がっている最中・ジャンプの着地硬直中でない
  function throwable(f) {
    return f.onGround && f.stun === 0 && f.action !== POSE.BACKSTEP && f.action !== POSE.WARP && f.pose !== POSE.LANDING && !f.grab && f.pose !== POSE.DOWN && f.pose !== POSE.LAUNCH && f.pose !== POSE.THROWN;
  }

  function checkThrows(state) {
    const grabs = [];
    for (let i = 0; i < 2; i++) {
      const att = state.fighters[i];
      const def = state.fighters[1 - i];
      const box = grabBox(att);
      const body = hurtbox(def);
      if (box && body && throwable(def) && overlap(box, body)) grabs.push([att, def]);
    }
    if (grabs.length === 2) {
      // 同時に掴み合ったら、両方とも投げ抜けしたことにする
      const [a, b] = state.fighters;
      a.moveHit = b.moveHit = true;
      record(state, a, "throw", "techs");
      record(state, b, "throw", "techs");
      throwTech(state, a, b);
      return;
    }
    for (const [att, def] of grabs) {
      att.moveHit = true;
      att.grab = { timer: 0 };
      att.pose = POSE.THROW;
      att.vx = 0;
      def.punishedGrab = backstepPunishable(def);
      def.pose = POSE.THROWN;
      def.move = null;
      def.action = null;
      def.landingTimer = 0;
      def.crouching = false;
      def.vx = 0;
      def.buffer = null;
      // 掴まれる少し前（投げ抜けの受付と同じフレーム数以内）にU＋Iを押していたら、投げ抜けになる
      // （ガード硬直が終わる頃に投げ返そうとしたら、相手の投げのほうが早かったとき）
      def.techInput = def.throwPressAge <= BATTLE.throwTechWindow;
      // 相手を自分の目の前に引き寄せる
      const near = ((CHARACTERS[att.charId].width + CHARACTERS[def.charId].width) / 2 + 4) * S;
      def.x = att.x + att.facing * near;
      clampToStage(def);
    }
  }

  // 投げ抜け：両方が離れて、同じだけ動けない（五分）
  function throwTech(state, a, b) {
    for (const f of [a, b]) {
      f.grab = null;
      f.move = null;
      f.action = null;
      f.buffer = null;
      f.techInput = false;
      f.crouching = false;
      f.pose = POSE.TECH;
      f.stun = BATTLE.throwTechStun;
      f.vx = 0;
    }
    const dir = a.x < b.x ? 1 : -1;
    a.pushVx = (-dir * BATTLE.throwTechPush * S) / 5;
    b.pushVx = (dir * BATTLE.throwTechPush * S) / 5;
    state.effects.push({ kind: "text", text: "投げ抜け！", x: (a.x + b.x) / 2 / S, y: Math.min(a.y, b.y) / S - 150, life: 45 });
    state.effects.push({ kind: "block", x: (a.x + b.x) / 2 / S, y: Math.min(a.y, b.y) / S - 90, life: 12 });
  }

  // 掴んでいる投げを進める。投げ抜けの受付が終わったら投げる
  function updateThrows(state) {
    for (let i = 0; i < 2; i++) {
      const att = state.fighters[i];
      const def = state.fighters[1 - i];
      if (!att.grab) continue;
      att.grab.timer += 1;
      if (def.techInput && att.grab.timer <= BATTLE.throwTechWindow) {
        record(state, att, "throw", "techs");
        throwTech(state, att, def);
      } else if (att.grab.timer > BATTLE.throwTechWindow) {
        // 投げる：相手を前に放り投げてダウンさせる
        const m = CHARACTERS[att.charId].moves.throw;
        att.grab = null;
        att.move = null;
        att.pose = POSE.THROW;
        att.stun = BATTLE.throwFinish;
        def.techInput = false;
        record(state, att, "throw", "hits");
        record(state, att, "throw", "damage", dealDamage(state, att, def, m.damage, def.punishedGrab));
        def.punishedGrab = false;
        knockDown(def);
        def.pushVx = (att.facing * 60 * S) / 5;
        state.hitstop = Math.max(state.hitstop, BATTLE.hitstopHit);
        state.effects.push({ kind: "hit", x: def.x / S, y: def.y / S - 20, life: 14 });
      }
    }
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

  // お互いの方を向く（空中や技の最中は向きを変えない）
  // 向き直れるのは、地上で自由に動けるとき・着地硬直・ステップやワープの止まり際・のけぞりやガード硬直・投げ抜けのあと
  // （相手に裏に回られても、動けるようになる前に向き直っておく）。技の最中・空中・ダウン中は向きを変えない
  function canTurn(f) {
    if (!f.onGround) return false;
    if (isFree(f)) return true;
    if (f.move || f.grab) return false;
    if (f.action === POSE.DASH_RECOVERY) return true;
    return f.stun > 0 && (f.pose === POSE.HIT || f.pose === POSE.BLOCK || f.pose === POSE.TECH);
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
    // 連続技の表示を少しずつ消す
    for (let i = 0; i < 2; i++) {
      const info = state.comboInfo[i];
      if (info && --info.timer <= 0) state.comboInfo[i] = null;
    }
    // のけぞり・空中やられ・ダウン・投げられ中でなくなったら、連続技は途切れる（コンボ補正も戻る）
    for (const f of state.fighters) {
      if (f.pose !== POSE.HIT && f.pose !== POSE.LAUNCH && f.pose !== POSE.DOWN && f.pose !== POSE.THROWN) {
        f.combo = 0;
        f.comboDamage = 0;
      }
    }
    // 影縫い：動く前の位置で、相手の技の影縫い範囲に体が入っているか
    for (let i = 0; i < 2; i++) {
      const zone = shadowStitchBox(state.fighters[1 - i]);
      const body = hurtbox(state.fighters[i]);
      state.fighters[i].pinned = !!(zone && body && overlap(zone, body));
    }
    updateFighter(state, a, fighting ? inputs[0] | 0 : 0);
    updateFighter(state, b, fighting ? inputs[1] | 0 : 0);
    if (fighting) updateThrows(state);
    pushApart(a, b);
    moveProjectiles(state);
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
    limbHurtbox,
    grabBox,
    projectileBox,
    shadowStitchBox,
    isFree,
    moveData,
    fullCharge,
    comboRate,
    toStats,
    hashState,
  };
})(globalThis);
