// ブラウザで動かすときの入口。
// 計算は「1/60秒ぶん時間がたまったら1回」進め、描画はモニターの速さで行う。
// こうするとモニターが60Hzでも144Hzでも、ゲームの動きの速さは変わらない。
(function (root) {
  const SF = root.SF;
  const STEP_MS = 1000 / SF.constants.FPS;
  const MAX_STEPS_PER_DRAW = 5; // 重くなっても一度に進めすぎない

  const seed = (Date.now() & 0x7fffffff) >>> 0;
  const state = SF.game.createGame(seed);
  const keyboard = SF.keyboard.createKeyboard(root);
  const renderer = SF.renderer.createRenderer(document.getElementById("screen"));

  // キャラ選択画面ができるまでの仮の切り替え：1キーでカゲツ、2キーでリン。
  // 右の相手は、選ばなかった方のキャラになる
  root.addEventListener("keydown", (e) => {
    const pick = { Digit1: "kagetsu", Digit2: "rin", Numpad1: "kagetsu", Numpad2: "rin" }[e.code];
    if (!pick) return;
    SF.game.setCharacter(state, 0, pick);
    SF.game.setCharacter(state, 1, pick === "kagetsu" ? "rin" : "kagetsu");
  });

  let lastTime = performance.now();
  let accumulator = 0;
  let input = 0;

  // 1秒ごとに「計算」と「描画」が何回できたか数える
  let updates = 0;
  let draws = 0;
  let counterStart = lastTime;
  const info = { updatesPerSec: 0, drawsPerSec: 0, input: 0, seed };

  function frame(now) {
    accumulator += now - lastTime;
    lastTime = now;

    let steps = 0;
    while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_DRAW) {
      input = keyboard.read();
      // 右のプレイヤーはまだ動かない（CPUは制作順5で作る）
      SF.game.step(state, [input, SF.input.NONE]);
      accumulator -= STEP_MS;
      steps++;
      updates++;
    }
    // 追いつけなかった分は捨てる（タブを裏にしていたときなど）
    if (steps === MAX_STEPS_PER_DRAW) accumulator = 0;

    draws++;
    if (now - counterStart >= 1000) {
      info.updatesPerSec = Math.round((updates * 1000) / (now - counterStart));
      info.drawsPerSec = Math.round((draws * 1000) / (now - counterStart));
      updates = 0;
      draws = 0;
      counterStart = now;
    }

    info.input = input;
    renderer.draw(state, info);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame((now) => {
    lastTime = now;
    counterStart = now;
    requestAnimationFrame(frame);
  });
})(globalThis);
