// ブラウザで動かすときの入口。
// 計算は「1/60秒ぶん時間がたまったら1回」進め、描画はモニターの速さで行う。
// こうするとモニターが60Hzでも144Hzでも、ゲームの動きの速さは変わらない。
//
// 画面は「メニュー（タイトル・モード選択・キャラ選択）」「試合」「資料」「キーコンフィグ」。
// 試合中は Esc で一時停止メニュー、試合が終わると「もう一度・キャラ選択・タイトル」のメニューが出る。
(function (root) {
  const SF = root.SF;
  const STEP_MS = 1000 / SF.constants.FPS;
  const MAX_STEPS_PER_DRAW = 5; // 重くなっても一度に進めすぎない

  const seed = (Date.now() & 0x7fffffff) >>> 0;
  const keyboard = SF.keyboard.createKeyboard(root);
  const renderer = SF.renderer.createRenderer(document.getElementById("screen"));
  const menu = SF.menu.createMenu();
  const sound = SF.sound.createSound();
  const canvas = document.getElementById("screen");

  // ---- キーコンフィグ：割り当てはこのブラウザ（localStorage）に保存する ----
  const KC = SF.keyconfig;
  const KEYS_STORE = "silhouette-fighter.keys";
  function loadBindings() {
    try {
      const text = root.localStorage.getItem(KEYS_STORE);
      return KC.fromSaved(text ? JSON.parse(text) : null);
    } catch (e) {
      return KC.defaults(); // 保存できない設定のブラウザや、こわれたデータのときは初期値
    }
  }
  function saveBindings() {
    try {
      root.localStorage.setItem(KEYS_STORE, JSON.stringify(KC.toSaved(bindings)));
    } catch (e) {
      // 保存できなくても、開いている間はその割り当てで遊べる
    }
  }
  const bindings = loadBindings();
  let keyScreen = KC.createScreen();

  let scene = "menu"; // "menu"（メニュー）、"battle"（試合・トレーニング）、"library"（資料）、"keys"（キーコンフィグ）
  // 資料の画面：見ているページと、閉じたらどこへもどるか（"menu" か、一時停止中の "battle"）
  const library = { page: 0, from: "menu" };
  let fullGauge = false; // トレーニング：G キーでゲージをずっと満タンにする
  let config = null; // 試合の設定（モード、キャラ、強さ）。メニューで決まる
  let state = null;
  let cpus = [null, null]; // CPUが動かす側だけ入る
  // 確認用：プレイヤー VS CPU のとき、3キーで右の相手を練習相手に、4キーでCPUにもどす
  const dummy = SF.dummy.createDummy();
  let useDummy = false;
  let showBoxes = false;
  // 試合の上に出す小さなメニュー（一時停止・試合終了）。出ていないときは null
  let overlay = null;

  // 一時停止のメニュー。BGM・効果音の行は ←→（または Enter）で音量を変える
  const pauseItems = () => ["つづける", `BGM：${sound.levelLabel("bgm")}`, `効果音：${sound.levelLabel("sfx")}`, "資料を見る", "キャラ選択にもどる", "タイトルにもどる"];
  const END_ITEMS = ["もう一度", "キャラ選択にもどる", "タイトルにもどる"];

  let matchCount = 0;
  let counted = false; // この試合を学習AIの「学んだ試合数」に数えたか
  // 学習AIが出ている試合か。学習AIは、出ている試合（対戦・観戦・トレーニング）すべてから学ぶ
  const learning = () => !!config && config.levels.some((lv) => lv !== null && SF.cpu.LEVELS[lv].learned);
  function newMatch() {
    matchCount += 1;
    const training = config.mode === "training";
    state = SF.game.createGame(seed + matchCount, config.chars, training ? { training: true, intro: false } : {});
    // トレーニングで練習相手を選んだときは、右を練習相手が動かす（3キーで動きを切り替え、4キーでCPUに）
    useDummy = training && config.dummy !== null;
    if (useDummy) {
      dummy.mode = config.dummy;
      dummy.t = 0;
    }
    // CPUは試合ごとに作り直す（左右で別の種）。練習相手のときも、4キーで切り替えられるよう「ふつう」のCPUを用意しておく
    const levels = useDummy ? [config.levels[0], 1] : config.levels;
    cpus = levels.map((lv, i) => {
      if (lv === null) return null;
      // 学習AIは、育てている頭脳を使い、試合をしながら表を直す（左右どちらでも同じ頭脳）
      if (SF.cpu.LEVELS[lv].learned) {
        return SF.cpu.createCpu(lv, seed + matchCount * 2 + i, {
          brain: SF.learnPage.playerBrain(),
          train: true,
          explore: SF.learn.PLAYER_EXPLORE,
          alpha: SF.learn.PLAYER_ALPHA,
        });
      }
      return SF.cpu.createCpu(lv, seed + matchCount * 2 + i);
    });
    counted = false;
    overlay = null;
    sound.begin(state);
    keyboard.read(); // メニューで押したキーが試合に残らないように捨てる
  }

  function startBattle(cfg) {
    config = cfg;
    fullGauge = false;
    showBoxes = cfg.mode === "training"; // トレーニングは当たり判定を見せて始める（H で消せる）
    scene = "battle";
    newMatch();
  }

  // 資料の画面を開く。from は閉じたあとにもどる所
  function openLibrary(from) {
    scene = "library";
    library.from = from;
  }
  function closeLibrary() {
    if (library.from === "battle") scene = "battle"; // 一時停止のメニューにもどる
    else backToMenu(SF.menu.SCREEN.MODE);
  }
  function pressLibrary(action) {
    const n = renderer.LIBRARY_PAGE_COUNT;
    if (action === "left" || action === "up") library.page = (library.page + n - 1) % n;
    else if (action === "right" || action === "down") library.page = (library.page + 1) % n;
    else if (action === "back") closeLibrary();
    else if (action === "ok" && library.page === n - 1) openKeyConfig(); // 最後のページ「キーの変更」
  }

  function backToMenu(screen) {
    // 試合の途中でやめても、終わったラウンドで学んだぶんは残す
    if (scene === "battle" && learning()) SF.learnPage.savePlayerBrain();
    scene = "menu";
    overlay = null;
    menu.screen = screen;
  }

  // キーをメニューの操作に変える。矢印キー・Enter・Esc はいつでも使える。
  // それに加えて、試合の操作のキーでも動かせる（初期値なら WASD でえらび、U・スペースで決定、I でもどる）
  const FIXED_MENU_KEYS = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Enter: "ok",
    NumpadEnter: "ok",
    Escape: "back",
    Backspace: "back",
  };
  let MENU_KEYS = {};
  function applyBindings() {
    keyboard.setBindings(bindings);
    renderer.setBindings(bindings);
    const m = {};
    if (!keyboard.isBound("KeyW")) m.KeyW = "up"; // 上はゲームの操作にないので、W がほかで使われていなければ W
    m[bindings.DOWN] = "down";
    m[bindings.LEFT] = "left";
    m[bindings.RIGHT] = "right";
    m[bindings.JUMP] = "ok";
    m[bindings.LIGHT] = "ok";
    m[bindings.HEAVY] = "back";
    MENU_KEYS = Object.assign(m, FIXED_MENU_KEYS); // 矢印キー・Enter・Esc を優先する
    updateHelp();
  }
  // ページの下の操作説明を、今のキーの割り当てに合わせて書き換える
  function updateHelp() {
    document.querySelectorAll("[data-key]").forEach((el) => {
      el.textContent = KC.keyLabel(bindings[el.dataset.key]);
    });
  }

  function openKeyConfig() {
    scene = "keys";
    keyScreen = KC.createScreen();
  }
  function onKeyConfigKey(e) {
    KC.rememberKey(e.code, e.key);
    if (keyScreen.waiting) {
      if (e.repeat) return; // 決定キーを押しっぱなしにしていても、そのキーが入らないように
      if (!KC.isReserved(e.code) || e.code === "Escape") e.preventDefault();
      const r = KC.pressKey(keyScreen, bindings, e.code);
      if (r && r.changed) {
        saveBindings();
        applyBindings();
      }
      return;
    }
    const action = MENU_KEYS[e.code];
    if (!action || (e.repeat && (action === "ok" || action === "back"))) return;
    const r = KC.press(keyScreen, bindings, action);
    if (r && r.changed) {
      saveBindings();
      applyBindings();
    }
    if (r && r.close) scene = "library"; // 資料のページにもどる
  }

  function pressOverlay(action) {
    const n = overlay.items.length;
    const pick = overlay.items[overlay.cursor];
    const volumeRow = pick.startsWith("BGM") ? "bgm" : pick.startsWith("効果音") ? "sfx" : null;
    if (volumeRow && (action === "left" || action === "right" || action === "ok")) {
      sound.change(volumeRow, action === "left" ? -1 : 1);
      overlay.items = pauseItems();
      return;
    }
    if (action === "up" || action === "down") sound.play("move");
    else if (action === "back" && overlay.kind === "pause") sound.play("back");
    else if (action === "ok") sound.play("ok");
    if (action === "up") overlay.cursor = (overlay.cursor + n - 1) % n;
    else if (action === "down") overlay.cursor = (overlay.cursor + 1) % n;
    else if (action === "back" && overlay.kind === "pause") overlay = null;
    else if (action === "ok") {
      if (pick === "つづける") overlay = null;
      else if (pick === "資料を見る") openLibrary("battle");
      else if (pick === "もう一度") newMatch();
      else if (pick === "キャラ選択にもどる") backToMenu(SF.menu.SCREEN.SELECT);
      else if (pick === "タイトルにもどる") backToMenu(SF.menu.SCREEN.TITLE);
    }
  }

  // メニューの操作の音
  function menuSound(action) {
    if (action === "ok") sound.play("ok");
    else if (action === "back") sound.play("back");
    else sound.play("move");
  }

  // M キーで音のオン／オフ（画面の右上に少しのあいだ表示する）
  let toast = null;
  function toggleMute() {
    const muted = sound.toggleMute();
    toast = { text: muted ? "音：オフ（M でオン）" : "音：オン", life: 90 };
    if (overlay && overlay.kind === "pause") overlay.items = pauseItems();
  }

  // ブラウザは、画面をクリックするかキーを押すまで音を出せないので、そのときに音の準備をする
  root.addEventListener("pointerdown", () => sound.unlock());

  root.addEventListener("keydown", (e) => {
    sound.unlock();
    const action = MENU_KEYS[e.code];
    if (e.code.startsWith("Arrow") || e.code === "Space" || e.code === "Backspace") e.preventDefault(); // 画面がスクロールしないように
    if (scene === "keys") {
      if (!keyScreen.waiting && action && !e.repeat) menuSound(action);
      onKeyConfigKey(e);
      return;
    }
    // M：音のオン／オフ（試合の操作に M を割り当てたときは、試合中だけ使わない）
    if (e.code === "KeyM" && !e.repeat && !(scene === "battle" && !overlay && keyboard.isBound("KeyM")) && !MENU_KEYS.KeyM) {
      toggleMute();
      return;
    }
    if (scene === "library") {
      if (action && !(e.repeat && (action === "ok" || action === "back"))) {
        if (action === "back") sound.play("back");
        else if (action !== "ok") sound.play("page");
        pressLibrary(action);
      }
      return;
    }

    if (scene === "menu") {
      if (!action || (e.repeat && (action === "ok" || action === "back"))) return;
      menuSound(action);
      const result = SF.menu.press(menu, action);
      if (result && result.start) startBattle(result.start);
      if (result && result.library) openLibrary("menu");
      return;
    }

    // ここから試合中
    if (overlay) {
      if (action && !(e.repeat && (action === "ok" || action === "back"))) pressOverlay(action);
      return;
    }
    if (e.code === "Escape" && !e.repeat) {
      sound.play("ok");
      overlay = { kind: "pause", items: pauseItems(), cursor: 0 };
      return;
    }
    // 確認用のキー（H・3・4）は、試合の操作に割り当てたときは使わない
    if (keyboard.isBound(e.code)) return;
    if (e.code === "KeyH") showBoxes = !showBoxes;
    if (config.mode === "training" && e.code === "KeyG") fullGauge = !fullGauge;
    if (config.mode === "pvc" || config.mode === "training") {
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
    if (fullGauge) state.fighters[0].gauge = SF.game.GAUGE_FULL;
    SF.game.step(state, inputs);
    sound.observe(state);

    if (state.round.phase === SF.game.PHASE.MATCH_END) {
      // 学習AIが学んだ頭脳を、試合が終わったら保存する
      if (learning() && !counted) {
        counted = true;
        SF.learnPage.playerBrain().played += 1;
        SF.learnPage.savePlayerBrain();
      }
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

    if (scene === "menu") {
      renderer.drawMenu(menu, tick);
    } else if (scene === "keys") {
      renderer.drawKeyConfig(keyScreen, tick);
    } else if (scene === "library") {
      renderer.drawLibrary(library.page, tick);
    } else {
      const label = (i) => {
        if (!cpus[i]) return "あなた";
        if (i === 1 && useDummy) return `練習相手 ${SF.dummy.MODES[dummy.mode].label}`;
        const lv = SF.cpu.LEVELS[cpus[i].level];
        if (lv.learned) return `CPU 学習AI（学習中・${SF.learnPage.playerBrain().played + (counted ? 0 : 1)}試合目）`;
        return `CPU ${lv.label}`;
      };
      info.input = input;
      info.sideLabels = [label(0), label(1)];
      info.mode = config.mode;
      info.training = config.mode === "training";
      info.showBoxes = showBoxes;
      info.fullGauge = fullGauge;
      info.overlay = overlay;
      renderer.draw(state, info);
    }
    // BGM：試合中は試合の曲（決着したら止める）、それ以外はメニューの曲。一時停止中は小さく
    const inBattle = scene === "battle";
    sound.music(inBattle ? (state.round.phase === SF.game.PHASE.MATCH_END ? null : "battle") : "menu");
    sound.duck(inBattle && !!overlay && overlay.kind === "pause");
    if (toast) drawToast();
    requestAnimationFrame(frame);
  }

  function drawToast() {
    const g = canvas.getContext("2d");
    toast.life -= 1;
    g.save();
    g.globalAlpha = Math.min(1, toast.life / 20);
    g.font = "bold 16px sans-serif";
    const w = g.measureText(toast.text).width + 28;
    g.fillStyle = "rgba(10, 8, 12, 0.8)";
    g.fillRect(canvas.width - w - 16, 16, w, 34);
    g.fillStyle = "#f3ead8";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(toast.text, canvas.width - w - 2, 34);
    g.restore();
    if (toast.life <= 0) toast = null;
  }

  applyBindings();

  requestAnimationFrame((now) => {
    lastTime = now;
    counterStart = now;
    requestAnimationFrame(frame);
  });
})(globalThis);
