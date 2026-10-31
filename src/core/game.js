// ゲームの計算部分。画面やキーボードには一切さわらない。
// 「今の状態」と「両プレイヤーの入力」を受け取り、状態を1フレーム進めるだけ。
// そのため画面なしでも高速に試合を進められる（自動対戦・学習CPU用）。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const C = SF.constants;
  const { BUTTON, isDown, justPressed } = SF.input;
  const { CHARACTERS } = SF.characters;

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
  });

  function createFighter(charId, x, facing) {
    return {
      charId,
      x: x * S, // 足元の中心
      y: C.GROUND_Y * S, // 足元の高さ
      vx: 0,
      vy: 0,
      facing, // 1 = 右向き、-1 = 左向き
      onGround: true,
      pose: POSE.STAND,
      landingTimer: 0, // 着地硬直の残りフレーム
      prevInput: 0,
    };
  }

  // 新しい試合の状態を作る。chars は [左のキャラ, 右のキャラ]
  function createGame(seed = 1, chars = ["kagetsu", "rin"]) {
    return {
      frame: 0,
      rng: SF.rng.createRng(seed),
      fighters: [
        createFighter(chars[0], C.STAGE_WIDTH * 0.3, 1),
        createFighter(chars[1], C.STAGE_WIDTH * 0.7, -1),
      ],
    };
  }

  // キャラを入れ替える（キャラ選択画面ができるまでの仮の機能）。位置と向きはそのまま
  function setCharacter(state, index, charId) {
    const old = state.fighters[index];
    const f = createFighter(charId, 0, old.facing);
    f.x = old.x;
    state.fighters[index] = f;
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

    if (f.onGround) {
      if (f.landingTimer > 0) {
        // 着地硬直中は何もできない
        f.landingTimer -= 1;
        f.vx = 0;
        f.pose = POSE.LANDING;
      } else if (justPressed(input, f.prevInput, BUTTON.JUMP)) {
        // ジャンプは押した瞬間だけ（押しっぱなしで連続ジャンプしない）
        // 方向キーを押していれば斜めに跳ぶ
        f.onGround = false;
        f.vy = -st.jumpVelocity;
        f.vx = forward ? f.facing * st.jumpForward : back ? -f.facing * st.jumpForward : 0;
        f.pose = POSE.JUMP;
      } else if (down) {
        // しゃがみ中は歩けない。後ろを押していればしゃがみガード
        f.vx = 0;
        f.pose = back ? POSE.GUARD_CROUCH : POSE.CROUCH;
      } else if (forward) {
        f.vx = f.facing * st.walkForward;
        f.pose = POSE.WALK_FORWARD;
      } else if (back) {
        // 後ろに歩く＝立ちガードの構え
        f.vx = -f.facing * st.walkBack;
        f.pose = POSE.GUARD_STAND;
      } else {
        f.vx = 0;
        f.pose = POSE.STAND;
      }
    }

    // 空中では横の速さはそのまま、重力で落ちる。ガードはできない
    if (!f.onGround) {
      f.vy += st.gravity;
    }

    f.x += f.vx;
    f.y += f.vy;

    // 着地
    if (!f.onGround && f.y >= C.GROUND_Y * S) {
      f.y = C.GROUND_Y * S;
      f.vx = 0;
      f.vy = 0;
      f.onGround = true;
      f.landingTimer = st.landingLag;
      f.pose = POSE.LANDING;
    }

    clampToStage(f);
    f.prevInput = input;
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
  function fighterHeight(f) {
    const c = CHARACTERS[f.charId];
    const crouching = f.pose === POSE.CROUCH || f.pose === POSE.GUARD_CROUCH;
    return crouching ? c.crouchHeight : c.height;
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
    const overlap = minDist - dist;
    const half = Math.floor(overlap / 2);
    left.x -= half;
    right.x += overlap - half;

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

  // 地上ではお互いの方を向く（空中では向きを変えない）
  function updateFacing(a, b) {
    if (a.x === b.x) return;
    if (a.onGround) a.facing = a.x < b.x ? 1 : -1;
    if (b.onGround) b.facing = b.x < a.x ? 1 : -1;
  }

  // 状態を1フレーム進める。inputs は [左のプレイヤーの入力, 右のプレイヤーの入力]
  function step(state, inputs) {
    const [a, b] = state.fighters;
    updateFighter(a, inputs[0] | 0);
    updateFighter(b, inputs[1] | 0);
    pushApart(a, b);
    updateFacing(a, b);
    state.frame += 1;
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

  SF.game = { POSE, createGame, setCharacter, step, fighterHeight, toStats, hashState };
})(globalThis);
