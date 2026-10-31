// ゲームの計算部分。画面やキーボードには一切さわらない。
// 「今の状態」と「両プレイヤーの入力」を受け取り、状態を1フレーム進めるだけ。
// そのため画面なしでも高速に試合を進められる（自動対戦・学習CPU用）。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const C = SF.constants;
  const { BUTTON, isDown, justPressed } = SF.input;

  const S = C.SCALE;

  // 土台づくり用の仮の動き。正式な数値は制作順2でキャラごとに決める。
  const TEMP = Object.freeze({
    WALK_SPEED: 3 * S, // 1フレームに3ピクセル歩く
    JUMP_VELOCITY: -16 * S, // ジャンプの最初の上向きの速さ
    GRAVITY: 0.8 * S, // 毎フレーム下向きに加わる速さ
    WIDTH: 60, // 仮の体の幅（ピクセル）
    HEIGHT: 150, // 立っているときの高さ（ピクセル）
    CROUCH_HEIGHT: 90, // しゃがんでいるときの高さ（ピクセル）
  });

  function createFighter(x, facing) {
    return {
      x: x * S, // 足元の中心
      y: C.GROUND_Y * S, // 足元の高さ
      vx: 0,
      vy: 0,
      facing, // 1 = 右向き、-1 = 左向き
      onGround: true,
      crouching: false,
      prevInput: 0,
    };
  }

  // 新しい試合の状態を作る
  function createGame(seed = 1) {
    return {
      frame: 0,
      rng: SF.rng.createRng(seed),
      fighters: [
        createFighter(C.STAGE_WIDTH * 0.3, 1),
        createFighter(C.STAGE_WIDTH * 0.7, -1),
      ],
    };
  }

  function updateFighter(f, input) {
    if (f.onGround) {
      f.crouching = isDown(input, BUTTON.DOWN);

      // 歩き（しゃがみ中は歩けない）
      let dir = 0;
      if (!f.crouching) {
        if (isDown(input, BUTTON.LEFT)) dir -= 1;
        if (isDown(input, BUTTON.RIGHT)) dir += 1;
      }
      f.vx = dir * TEMP.WALK_SPEED;

      // ジャンプは押した瞬間だけ（押しっぱなしで連続ジャンプしない）
      if (justPressed(input, f.prevInput, BUTTON.JUMP)) {
        f.onGround = false;
        f.crouching = false;
        f.vy = TEMP.JUMP_VELOCITY;
      }
    }

    // 空中では横の速さはそのまま、重力で落ちる
    if (!f.onGround) {
      f.vy += TEMP.GRAVITY;
    }

    f.x += f.vx;
    f.y += f.vy;

    // 着地
    if (f.y >= C.GROUND_Y * S) {
      f.y = C.GROUND_Y * S;
      f.vy = 0;
      f.onGround = true;
    }

    // 画面の外に出ない
    const minX = (C.STAGE_MARGIN + TEMP.WIDTH / 2) * S;
    const maxX = (C.STAGE_WIDTH - C.STAGE_MARGIN - TEMP.WIDTH / 2) * S;
    if (f.x < minX) f.x = minX;
    if (f.x > maxX) f.x = maxX;

    f.prevInput = input;
  }

  // 地上ではお互いの方を向く
  function updateFacing(a, b) {
    if (a.onGround && a.x !== b.x) a.facing = a.x < b.x ? 1 : -1;
    if (b.onGround && a.x !== b.x) b.facing = b.x < a.x ? 1 : -1;
  }

  // 状態を1フレーム進める。inputs は [左のプレイヤーの入力, 右のプレイヤーの入力]
  function step(state, inputs) {
    updateFighter(state.fighters[0], inputs[0] | 0);
    updateFighter(state.fighters[1], inputs[1] | 0);
    updateFacing(state.fighters[0], state.fighters[1]);
    state.frame += 1;
    return state;
  }

  // 描画用に体の高さを返す（ピクセル）
  function fighterHeight(f) {
    return f.crouching ? TEMP.CROUCH_HEIGHT : TEMP.HEIGHT;
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

  SF.game = { TEMP, createGame, step, fighterHeight, hashState };
})(globalThis);
