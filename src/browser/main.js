// ブラウザで動かすときの入口。
// 計算は「1/60秒ぶん時間がたまったら1回」進め、描画はモニターの速さで行う。
// こうするとモニターが60Hzでも144Hzでも、ゲームの動きの速さは変わらない。
//
// 画面は「メニュー（タイトル・モード選択・キャラ選択）」と「試合」の2つ。
// 試合中は Esc で一時停止メニュー、試合が終わると「もう一度・キャラ選択・タイトル」のメニューが出る。
(function (root) {
  const SF = root.SF;
  const STEP_MS = 1000 / SF.constants.FPS;
  const MAX_STEPS_PER_DRAW = 5; // 重くなっても一度に進めすぎない

  const seed = (Date.now() & 0x7fffffff) >>> 0;
  const keyboard = SF.keyboard.createKeyboard(root);
  const renderer = SF.renderer.createRenderer(document.getElementById("screen"));
  const menu = SF.menu.createMenu();

  let scene = "menu"; // "menu"（メニュー）、"battle"（試合）、"records"（自動対戦と記録・学習AIをきたえる）
  let config = null; // 試合の設定（モード、キャラ、強さ）。メニューで決まる
  let state = null;
  let cpus = [null, null]; // CPUが動かす側だけ入る
  // 確認用：プレイヤー VS CPU のとき、3キーで右の相手を練習相手に、4キーでCPUにもどす
  const dummy = SF.dummy.createDummy();
  let useDummy = false;
  let showBoxes = false;
  // 試合の上に出す小さなメニュー（一時停止・試合終了）。出ていないときは null
  let overlay = null;

  const PAUSE_ITEMS = ["つづける", "キャラ選択にもどる", "タイトルにもどる"];
  const END_ITEMS = ["もう一度", "キャラ選択にもどる", "タイトルにもどる"];

  let matchCount = 0;
  function newMatch() {
    matchCount += 1;
    state = SF.game.createGame(seed + matchCount, config.chars);
    // CPUは試合ごとに作り直す（左右で別の種）
    cpus = config.levels.map((lv, i) => (lv === null ? null : SF.cpu.createCpu(lv, seed + matchCount * 2 + i)));
    overlay = null;
    keyboard.read(); // メニューで押したキーが試合に残らないように捨てる
  }

  function startBattle(cfg) {
    config = cfg;
    useDummy = false;
    scene = "battle";
    newMatch();
  }

  // 自動対戦と記録の画面を開く。閉じたらタイトルにもどる
  function openRecords() {
    scene = "records";
    SF.recordsPage.open(() => backToMenu(SF.menu.SCREEN.TITLE));
  }

  // 学習AIの画面を開く。閉じたらタイトルにもどる
  function openLearn() {
    scene = "records";
    SF.learnPage.open(() => backToMenu(SF.menu.SCREEN.TITLE));
  }

  function backToMenu(screen) {
    scene = "menu";
    overlay = null;
    menu.screen = screen;
  }

  // キーをメニューの操作に変える（矢印キーでも WASD でも動かせる）
  const MENU_KEYS = {
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    Enter: "ok",
    NumpadEnter: "ok",
    Space: "ok",
    KeyU: "ok",
    Escape: "back",
    Backspace: "back",
    KeyI: "back",
  };

  function pressOverlay(action) {
    const n = overlay.items.length;
    if (action === "up") overlay.cursor = (overlay.cursor + n - 1) % n;
    else if (action === "down") overlay.cursor = (overlay.cursor + 1) % n;
    else if (action === "back" && overlay.kind === "pause") overlay = null;
    else if (action === "ok") {
      const pick = overlay.items[overlay.cursor];
      if (pick === "つづける") overlay = null;
      else if (pick === "もう一度") newMatch();
      else if (pick === "キャラ選択にもどる") backToMenu(SF.menu.SCREEN.SELECT);
      else if (pick === "タイトルにもどる") backToMenu(SF.menu.SCREEN.TITLE);
    }
  }

  root.addEventListener("keydown", (e) => {
    if (scene === "records") return; // 自動対戦の画面はボタンとマウスで操作する（キーはふつうに入力欄で使う）
    const action = MENU_KEYS[e.code];
    if (e.code.startsWith("Arrow") || e.code === "Space" || e.code === "Backspace") e.preventDefault(); // 画面がスクロールしないように

    if (scene === "menu") {
      if (!action || (e.repeat && (action === "ok" || action === "back"))) return;
      const result = SF.menu.press(menu, action);
      if (result && result.start) startBattle(result.start);
      if (result && result.auto) openRecords();
      if (result && result.learn) openLearn();
      return;
    }

    // ここから試合中
    if (overlay) {
      if (action && !(e.repeat && (action === "ok" || action === "back"))) pressOverlay(action);
      return;
    }
    if (e.code === "Escape" && !e.repeat) {
      overlay = { kind: "pause", items: PAUSE_ITEMS, cursor: 0 };
      return;
    }
    if (e.code === "KeyH") showBoxes = !showBoxes;
    if (config.mode === "pvc") {
      if (e.code === "Digit3" || e.code === "Numpad3") {
        // CPUから練習相手に切り替えたときは、今の動きのまま。練習相手のときは次の動きへ
        if (useDummy) SF.dummy.nextMode(dummy);
        useDummy = true;
      }
      if (e.code === "Digit4" || e.code === "Numpad4") useDummy = false;
    }
  });

  // 試合が終わって少したったら、終了メニューを出す
  const END_MENU_DELAY = 60;
  let endTimer = 0;

  let lastTime = performance.now();
  let accumulator = 0;
  let input = 0;
  let tick = 0; // メニュー画面の動き用

  // 1秒ごとに「計算」と「描画」が何回できたか数える
  let updates = 0;
  let draws = 0;
  let counterStart = lastTime;
  const info = { updatesPerSec: 0, drawsPerSec: 0, input: 0, seed, sideLabels: ["", ""], opponentLabel: "", showBoxes, overlay: null };

  function stepBattle() {
    input = keyboard.read();
    const inputs = [0, 1].map((i) => {
      if (cpus[i]) {
        if (i === 1 && useDummy) return SF.dummy.input(dummy, state, 1);
        return SF.cpu.input(cpus[i], state, i);
      }
      return input;
    });
    if (config.mode === "cvc") input = inputs[0];
    SF.game.step(state, inputs);

    if (state.round.phase === SF.game.PHASE.MATCH_END) {
      endTimer += 1;
      if (endTimer >= END_MENU_DELAY && !overlay) overlay = { kind: "end", items: END_ITEMS, cursor: 0 };
    } else endTimer = 0;
  }

  function frame(now) {
    accumulator += now - lastTime;
    lastTime = now;

    let steps = 0;
    while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_DRAW) {
      tick++;
      // 一時停止中は試合を進めない（試合終了のメニューは、後ろで決着の場面を進めたままにする）
      if (scene === "battle" && !(overlay && overlay.kind === "pause")) stepBattle();
      else keyboard.read();
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

    if (scene === "records") {
      // 自動対戦の画面では何も描かない（計算の邪魔をしない）
    } else if (scene === "menu") {
      renderer.drawMenu(menu, tick);
    } else {
      const label = (i) => {
        if (!cpus[i]) return "あなた";
        if (i === 1 && useDummy) return `練習相手 ${SF.dummy.MODES[dummy.mode].label}`;
        return `CPU ${SF.cpu.LEVELS[config.levels[i]].label}`;
      };
      info.input = input;
      info.sideLabels = [label(0), label(1)];
      info.mode = config.mode;
      info.showBoxes = showBoxes;
      info.overlay = overlay;
      renderer.draw(state, info);
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame((now) => {
    lastTime = now;
    counterStart = now;
    requestAnimationFrame(frame);
  });
})(globalThis);
