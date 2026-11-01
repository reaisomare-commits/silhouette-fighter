// タイトル・モード選択・キャラと強さの選択の「どこを選んでいるか」だけを持つ部分。
// 画面やキーボードにはさわらず、「上・下・左・右・決定・もどる」の操作を受けて状態を変えるだけ。
// 描くのは renderer.js、キーを操作に変えるのは main.js。
//
// モードは3つ：
//   対戦　　　　…… あなた VS CPU か、CPU VS CPU（観戦）
//   トレーニング …… 時間無制限・体力が自動で戻る練習。相手の動き（練習相手かCPU）を選べる
//   資料　　　　…… 操作・ルール・キャラごとの技とフレーム。キーコンフィグもここから
(function (root) {
  const SF = (root.SF = root.SF || {});

  const SCREEN = Object.freeze({
    TITLE: "title", // タイトル
    MODE: "mode", // モード選択
    SELECT: "select", // キャラと強さの選択（対戦・トレーニング）
  });

  const MODES = [
    { id: "versus", label: "対戦", note: "CPUと戦う。CPU同士の対戦を観ることもできる" },
    { id: "training", label: "トレーニング", note: "時間無制限、体力も自動で戻る。技や連続技を練習する" },
    { id: "library", label: "資料", note: "操作のしかた・ルール・キャラごとの技とフレーム。キーの変更もここ" },
  ];

  // 対戦のしかた
  const VS_TYPES = [
    { id: "pvc", label: "あなた VS CPU" },
    { id: "cvc", label: "CPU VS CPU（観戦）" },
  ];

  // キャラ選択画面の行。kind: vsType＝対戦のしかた、char＝キャラ、level＝CPUの強さ、partner＝トレーニングの相手の動き、start＝はじめる
  const ROWS = {
    pvc: [
      { kind: "vsType", label: "対戦のしかた" },
      { kind: "char", side: 0, label: "あなたのキャラ" },
      { kind: "char", side: 1, label: "相手のキャラ" },
      { kind: "level", side: 1, label: "CPUの強さ" },
      { kind: "start", label: "たたかう！" },
    ],
    cvc: [
      { kind: "vsType", label: "対戦のしかた" },
      { kind: "char", side: 0, label: "左のキャラ" },
      { kind: "level", side: 0, label: "左のCPUの強さ" },
      { kind: "char", side: 1, label: "右のキャラ" },
      { kind: "level", side: 1, label: "右のCPUの強さ" },
      { kind: "start", label: "観戦スタート" },
    ],
    training: [
      { kind: "char", side: 0, label: "あなたのキャラ" },
      { kind: "char", side: 1, label: "相手のキャラ" },
      { kind: "partner", side: 1, label: "相手の動き" },
      { kind: "start", label: "練習スタート" },
    ],
  };

  const charIds = () => Object.keys(SF.characters.CHARACTERS);
  const levelCount = () => SF.cpu.LEVELS.length;

  // トレーニングの相手の動き：練習相手（SF.dummy の動き）のあとに、CPUの強さが並ぶ
  function partners() {
    const list = SF.dummy ? SF.dummy.MODES.map((m, i) => ({ dummy: i, label: m.label })) : [];
    SF.cpu.LEVELS.forEach((lv, i) => list.push({ level: i, label: `CPU ${lv.label}` }));
    return list;
  }

  function createMenu() {
    return {
      screen: SCREEN.TITLE,
      modeCursor: 0,
      cursor: 0, // キャラ選択画面で選んでいる行
      // 前に選んだものを覚えておく（もどってきても選び直さなくてよい）
      picks: {
        versus: { type: 0, chars: ["kagetsu", "rin"], levels: [1, 1] },
        training: { chars: ["kagetsu", "rin"], partner: 0 },
      },
    };
  }

  const modeId = (menu) => MODES[menu.modeCursor].id;
  const picks = (menu) => menu.picks[modeId(menu)];
  // 今の画面の行（対戦は「対戦のしかた」で行が変わる）
  function rows(menu) {
    const id = modeId(menu);
    if (id === "versus") return ROWS[VS_TYPES[menu.picks.versus.type].id];
    return ROWS[id] || [];
  }

  // 試合を始めるのに必要なもの。levels は CPU が動かす側だけ数字、プレイヤーの側は null。
  // トレーニングで練習相手を選んだときは dummy に練習相手の動きの番号が入る（そのとき levels[1] は null）
  function matchConfig(menu) {
    const id = modeId(menu);
    if (id === "training") {
      const p = menu.picks.training;
      const partner = partners()[p.partner];
      return {
        mode: "training",
        chars: p.chars.slice(),
        levels: [null, partner.level !== undefined ? partner.level : null],
        dummy: partner.dummy !== undefined ? partner.dummy : null,
      };
    }
    const p = menu.picks.versus;
    const type = VS_TYPES[p.type].id;
    return {
      mode: type,
      chars: p.chars.slice(),
      levels: type === "pvc" ? [null, p.levels[1]] : p.levels.slice(),
    };
  }

  const wrap = (i, n) => (i + n) % n;

  // 操作を1つ受け取る。action は "up" "down" "left" "right" "ok" "back"
  // 試合を始めるときだけ { start: 設定 }、資料の画面を開くときは { library: true } を返す。それ以外は null
  function press(menu, action) {
    if (menu.screen === SCREEN.TITLE) {
      if (action === "ok") menu.screen = SCREEN.MODE;
      return null;
    }

    if (menu.screen === SCREEN.MODE) {
      if (action === "up" || action === "left") menu.modeCursor = wrap(menu.modeCursor - 1, MODES.length);
      else if (action === "down" || action === "right") menu.modeCursor = wrap(menu.modeCursor + 1, MODES.length);
      else if (action === "ok") {
        if (modeId(menu) === "library") return { library: true }; // 資料は別の画面
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
      } else if (row.kind === "vsType") {
        p.type = wrap(p.type + d, VS_TYPES.length);
      } else if (row.kind === "partner") {
        p.partner = Math.max(0, Math.min(partners().length - 1, p.partner + d));
      }
    } else if (action === "ok") {
      if (row.kind === "start") return { start: matchConfig(menu) };
      menu.cursor += 1; // 決定で次の行へ。最後は「はじめる」なので、Enterを続けて押すだけで始められる
    } else if (action === "back") menu.screen = SCREEN.MODE;
    return null;
  }

  SF.menu = { SCREEN, MODES, VS_TYPES, ROWS, createMenu, press, matchConfig, rows, picks, partners };
})(globalThis);
