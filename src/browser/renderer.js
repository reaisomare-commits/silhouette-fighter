// ゲームの状態を見て画面に描くだけの部分。状態は書き換えない。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const C = SF.constants;
  const { BUTTON, isDown } = SF.input;

  const ACCENT = ["#4da6ff", "#ff4d4d"]; // 仮の差し色（左：青、右：赤）

  const BUTTON_LABELS = [
    [BUTTON.LEFT, "A"],
    [BUTTON.RIGHT, "D"],
    [BUTTON.DOWN, "S"],
    [BUTTON.JUMP, "スペース"],
    [BUTTON.LIGHT, "U"],
    [BUTTON.HEAVY, "I"],
    [BUTTON.SPECIAL, "O"],
  ];

  function createRenderer(canvas) {
    const ctx = canvas.getContext("2d");
    canvas.width = C.STAGE_WIDTH;
    canvas.height = C.STAGE_HEIGHT;

    // 背景は毎回同じなので一度だけ作っておく
    const sky = ctx.createLinearGradient(0, 0, 0, C.GROUND_Y);
    sky.addColorStop(0, "#3b2a5c");
    sky.addColorStop(0.45, "#e0605a");
    sky.addColorStop(0.8, "#f6a95c");
    sky.addColorStop(1, "#fbd78a");

    function drawBackground() {
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, C.STAGE_WIDTH, C.GROUND_Y);
      // 沈む太陽
      ctx.fillStyle = "rgba(255, 236, 170, 0.85)";
      ctx.beginPath();
      ctx.arc(C.STAGE_WIDTH / 2, C.GROUND_Y - 20, 70, Math.PI, 0);
      ctx.fill();
      // 地面
      ctx.fillStyle = "#2a1a1a";
      ctx.fillRect(0, C.GROUND_Y, C.STAGE_WIDTH, C.STAGE_HEIGHT - C.GROUND_Y);
    }

    function drawFighter(f, index) {
      const x = f.x / C.SCALE;
      const y = f.y / C.SCALE;
      const w = SF.game.TEMP.WIDTH;
      const h = SF.game.fighterHeight(f);

      // 仮のシルエット（体）
      ctx.fillStyle = "#000";
      ctx.fillRect(x - w / 2, y - h, w, h);
      // 向きがわかるよう、顔の側に差し色の印をつける
      ctx.fillStyle = ACCENT[index];
      const markX = f.facing === 1 ? x + w / 2 - 12 : x - w / 2 + 4;
      ctx.fillRect(markX, y - h + 14, 8, 8);
    }

    function drawDebug(state, info) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(10, 10, 340, 112);
      ctx.fillStyle = "#fff";
      ctx.font = "14px sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(`計算: ${info.updatesPerSec} 回/秒（60なら正常）`, 20, 18);
      ctx.fillText(`描画: ${info.drawsPerSec} 回/秒（モニターに合わせて変わる）`, 20, 38);
      ctx.fillText(`経過フレーム: ${state.frame}`, 20, 58);
      const pressed = BUTTON_LABELS.filter(([b]) => isDown(info.input, b)).map(([, l]) => l);
      ctx.fillText(`押しているキー: ${pressed.length ? pressed.join(" ") : "なし"}`, 20, 78);
      ctx.fillText(`種（シード）: ${info.seed}`, 20, 96);
    }

    return {
      draw(state, info) {
        drawBackground();
        state.fighters.forEach(drawFighter);
        drawDebug(state, info);
      },
    };
  }

  SF.renderer = { createRenderer };
})(globalThis);
