// タイトル・モード選択・キャラと強さの選択の「どこを選んでいるか」だけを持つ部分。
// 画面やキーボードにはさわらず、「上・下・左・右・決定・もどる」の操作を受けて状態を変えるだけ。
// 描くのは renderer.js、キーを操作に変えるのは main.js。
(function (root) {
  const SF = (root.SF = root.SF || {});

  const SCREEN = Object.freeze({
    TITLE: "title", // タイトル
    MODE: "mode", // モード選択
    SELECT: "select", // キャラと強さの選択
  });

  const MODES = [
    { id: "pvc", label: "プレイヤー VS CPU", note: "自分のキャラで、CPUと戦う" },
    { id: "cvc", label: "CPU VS CPU", note: "CPU同士の対戦を観る" },
    { id: "auto", label: "自動対戦と記録", note: "CPU同士を画面なしで何試合も戦わせ、勝率や技の記録を見る" },
  ];

  // キャラ選択画面の行。kind: char＝キャラ、level＝CPUの強さ、start＝はじめる
  const ROWS = {
    pvc: [
      { kind: "char", side: 0, label: "あなたのキャラ" },
      { kind: "char", side: 1, label: "相手のキャラ" },
      { kind: "level", side: 1, label: "CPUの強さ" },
      { kind: "start", label: "たたかう！" },
    ],
    cvc: [
      { kind: "char", side: 0, label: "左のキャラ" },
      { kind: "level", side: 0, label: "左のCPUの強さ" },
      { kind: "char", side: 1, label: "右のキャラ" },
      { kind: "level", side: 1, label: "右のCPUの強さ" },
      { kind: "start", label: "観戦スタート" },
    ],
  };

  const charIds = () => Object.keys(SF.characters.CHARACTERS);
  const levelCount = () => SF.cpu.LEVELS.length;

  function createMenu() {
    return {
      screen: SCREEN.TITLE,
      modeCursor: 0,
      cursor: 0, // キャラ選択画面で選んでいる行
      // モードごとに、前に選んだものを覚えておく（もどってきても選び直さなくてよい）
      picks: {
        pvc: { chars: ["kagetsu", "rin"], levels: [1, 1] },
        cvc: { chars: ["kagetsu", "rin"], levels: [1, 1] },
      },
    };
  }

  const modeId = (menu) => MODES[menu.modeCursor].id;
  const rows = (menu) => ROWS[modeId(menu)];
  const picks = (menu) => menu.picks[modeId(menu)];

  // 試合を始めるのに必要なもの。levels は CPU が動かす側だけ数字、プレイヤーの側は null
  function matchConfig(menu) {
    const id = modeId(menu);
    const p = menu.picks[id];
    return {
      mode: id,
      chars: p.chars.slice(),
      levels: id === "pvc" ? [null, p.levels[1]] : p.levels.slice(),
    };
  }

  const wrap = (i, n) => (i + n) % n;

  // 操作を1つ受け取る。action は "up" "down" "left" "right" "ok" "back"
  // 試合を始めるときだけ { start: 設定 }、自動対戦の画面を開くときは { auto: true } を返す。それ以外は null
  function press(menu, action) {
    if (menu.screen === SCREEN.TITLE) {
      if (action === "ok") menu.screen = SCREEN.MODE;
      return null;
    }

    if (menu.screen === SCREEN.MODE) {
      if (action === "up" || action === "left") menu.modeCursor = wrap(menu.modeCursor - 1, MODES.length);
      else if (action === "down" || action === "right") menu.modeCursor = wrap(menu.modeCursor + 1, MODES.length);
      else if (action === "ok") {
        if (modeId(menu) === "auto") return { auto: true }; // 自動対戦はキャラ選択画面を使わない（別の画面で選ぶ）
        menu.screen = SCREEN.SELECT;
        menu.cursor = 0;
      } else if (action === "back") menu.screen = SCREEN.TITLE;
      return null;
    }

    // キャラと強さの選択
    const list = rows(menu);
    const row = list[menu.cursor];
    const p = picks(menu);
    if (action === "up") menu.cursor = wrap(menu.cursor - 1, list.length);
    else if (action === "down") menu.cursor = wrap(menu.cursor + 1, list.length);
    else if (action === "left" || action === "right") {
      const d = action === "left" ? -1 : 1;
      if (row.kind === "char") {
        const ids = charIds();
        p.chars[row.side] = ids[wrap(ids.indexOf(p.chars[row.side]) + d, ids.length)];
      } else if (row.kind === "level") {
        // 強さは端で止める（よわい←→つよいが一周すると分かりにくいため）
        p.levels[row.side] = Math.max(0, Math.min(levelCount() - 1, p.levels[row.side] + d));
      }
    } else if (action === "ok") {
      if (row.kind === "start") return { start: matchConfig(menu) };
      menu.cursor += 1; // 決定で次の行へ。最後は「はじめる」なので、Enterを続けて押すだけで始められる
    } else if (action === "back") menu.screen = SCREEN.MODE;
    return null;
  }

  SF.menu = { SCREEN, MODES, ROWS, createMenu, press, matchConfig, rows, picks };
})(globalThis);
