// ブラウザで動かすときの入口。
// 計算は「1/60秒ぶん時間がたまったら1回」進め、描画はモニターの速さで行う。
// こうするとモニターが60Hzでも144Hzでも、ゲームの動きの速さは変わらない。
(function (root) {
  const SF = root.SF;
  const STEP_MS = 1000 / SF.constants.FPS;
  const MAX_STEPS_PER_DRAW = 5; // 重くなっても一度に進めすぎない

  const seed = (Date.now() & 0x7fffffff) >>> 0;
  let chars = ["kagetsu", "rin"];
  let state = SF.game.createGame(seed, chars);
  const keyboard = SF.keyboard.createKeyboard(root);
  const renderer = SF.renderer.createRenderer(document.getElementById("screen"));
  // 右の相手はCPU（4キーで強さを切り替え）か、練習相手（3キーで動きを切り替え）
  const dummy = SF.dummy.createDummy();
  let opponent = "cpu"; // "cpu" か "dummy"
  let cpuLevel = 1; // 0:よわい 1:ふつう 2:つよい
  let watch = false; // 5キー：左もCPUにして観戦する
  let cpus = [];
  let showBoxes = false;

  let matchCount = 0;
  function newMatch() {
    matchCount += 1;
    state = SF.game.createGame(seed + matchCount, chars);
    // CPUは試合ごとに作り直す（左のCPUは右と別の種）
    cpus = [SF.cpu.createCpu(cpuLevel, seed + matchCount * 2), SF.cpu.createCpu(cpuLevel, seed + matchCount * 2 + 1)];
  }
  newMatch();

  root.addEventListener("keydown", (e) => {
    // キャラ選択画面ができるまでの仮の切り替え：1キーでカゲツ、2キーでリン。
    // 右の相手は、選ばなかった方のキャラになる。切り替えると試合を最初から始める
    const pick = { Digit1: "kagetsu", Digit2: "rin", Numpad1: "kagetsu", Numpad2: "rin" }[e.code];
    if (pick) {
      chars = [pick, pick === "kagetsu" ? "rin" : "kagetsu"];
      newMatch();
    }
    if (e.code === "Digit3" || e.code === "Numpad3") {
      // CPUから練習相手に切り替えたときは、今の動きのまま。練習相手のときは次の動きへ
      if (opponent === "dummy") SF.dummy.nextMode(dummy);
      opponent = "dummy";
      watch = false;
    }
    if (e.code === "Digit4" || e.code === "Numpad4") {
      // 練習相手からCPUに切り替えたときは、今の強さのまま。CPUのときは次の強さへ
      if (opponent === "cpu") cpuLevel = (cpuLevel + 1) % SF.cpu.LEVELS.length;
      opponent = "cpu";
      newMatch();
    }
    if (e.code === "Digit5" || e.code === "Numpad5") {
      watch = !watch;
      opponent = "cpu";
      newMatch();
    }
    if (e.code === "KeyH") showBoxes = !showBoxes;
    if (e.code === "Enter" && state.round.phase === SF.game.PHASE.MATCH_END) newMatch();
  });

  let lastTime = performance.now();
  let accumulator = 0;
  let input = 0;

  // 1秒ごとに「計算」と「描画」が何回できたか数える
  let updates = 0;
  let draws = 0;
  let counterStart = lastTime;
  const info = { updatesPerSec: 0, drawsPerSec: 0, input: 0, seed, opponentLabel: "", showBoxes };

  function frame(now) {
    accumulator += now - lastTime;
    lastTime = now;

    let steps = 0;
    while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_DRAW) {
      input = keyboard.read();
      const left = watch ? SF.cpu.input(cpus[0], state, 0) : input;
      const right = opponent === "cpu" ? SF.cpu.input(cpus[1], state, 1) : SF.dummy.input(dummy, state, 1);
      if (watch) input = left;
      SF.game.step(state, [left, right]);
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
    const levelLabel = SF.cpu.LEVELS[cpuLevel].label;
    info.opponentLabel =
      opponent === "cpu" ? `CPU ${levelLabel}${watch ? "（観戦中：左もCPU）" : ""}` : `練習相手 ${SF.dummy.MODES[dummy.mode].label}`;
    info.showBoxes = showBoxes;
    renderer.draw(state, info);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame((now) => {
    lastTime = now;
    counterStart = now;
    requestAnimationFrame(frame);
  });
})(globalThis);
