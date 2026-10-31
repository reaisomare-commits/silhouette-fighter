// 仮の練習相手。CPU（制作順5）ができるまで、右の相手をこれで動かす。
// プレイヤーと同じ「キー入力」を作って渡すだけで、特別な動きはしない。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const { BUTTON } = SF.input;

  const MODES = [
    { id: "idle", label: "何もしない" },
    { id: "guardStand", label: "立ちガード" },
    { id: "guardCrouch", label: "しゃがみガード" },
    { id: "attack", label: "攻撃をくり返す" },
  ];

  // 攻撃をくり返すときの順番
  const PATTERN = ["light", "heavy", "crouchLight", "crouchHeavy", "jumpLight", "jumpHeavy"];
  const CYCLE = 75; // 1つの技を出してから次の技までのフレーム
  const NEAR = 120; // これより離れていたら歩いて近づく（ピクセル）

  function createDummy() {
    return { mode: 0, t: 0 };
  }

  function nextMode(d) {
    d.mode = (d.mode + 1) % MODES.length;
    d.t = 0;
  }

  // 練習相手のこのフレームの入力を作る。index は練習相手が何番目のキャラか
  function input(d, state, index) {
    const me = state.fighters[index];
    const opp = state.fighters[1 - index];
    const back = me.facing === 1 ? BUTTON.LEFT : BUTTON.RIGHT;
    const forward = me.facing === 1 ? BUTTON.RIGHT : BUTTON.LEFT;
    const mode = MODES[d.mode].id;
    // 相手が技を出している間（とガード中）だけ後ろを押す。押しっぱなしだと端まで下がってしまうため
    const threatened = opp.move !== null || me.pose === SF.game.POSE.BLOCK;

    if (mode === "guardStand") return threatened ? back : 0;
    if (mode === "guardCrouch") return BUTTON.DOWN | (threatened ? back : 0);
    if (mode !== "attack") return 0;

    const dist = Math.abs(me.x - opp.x) / SF.constants.SCALE;
    const k = d.t % CYCLE;
    // 次の技を出す前に、離れていたら歩いて近づく
    if (k === 0 && dist > NEAR) return forward;

    const kind = PATTERN[Math.floor(d.t / CYCLE)];
    d.t = (d.t + 1) % (CYCLE * PATTERN.length);

    switch (kind) {
      case "light":
        return k < 2 ? BUTTON.LIGHT : 0;
      case "heavy":
        return k < 2 ? BUTTON.HEAVY : 0;
      case "crouchLight":
        return BUTTON.DOWN | (k >= 2 && k < 4 ? BUTTON.LIGHT : 0);
      case "crouchHeavy":
        return BUTTON.DOWN | (k >= 2 && k < 4 ? BUTTON.HEAVY : 0);
      case "jumpLight":
      case "jumpHeavy": {
        // 前ジャンプして、落ちてくるところで攻撃
        const btn = kind === "jumpLight" ? BUTTON.LIGHT : BUTTON.HEAVY;
        if (k === 0) return BUTTON.JUMP | forward;
        if (k >= 20 && k < 22) return btn;
        return 0;
      }
    }
    return 0;
  }

  SF.dummy = { MODES, createDummy, nextMode, input };
})(globalThis);
