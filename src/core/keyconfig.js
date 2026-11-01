// キーコンフィグ（操作キーの割り当て）。
// 「どのボタンをどのキーで押すか」と、キーコンフィグ画面の「どこを選んでいるか・キー待ちか」だけを持つ部分。
// 画面やブラウザの保存にはさわらない（描くのは renderer.js、保存とキーの受け取りは main.js）。
// キーは文字ではなくキーの場所（KeyboardEvent.code）で覚えるので、日本語キーボードでも同じ位置で動く。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const { BUTTON } = SF.input;

  // 変えられる操作。並びは画面に出す順
  const ACTIONS = [
    { id: "LEFT", label: "左に移動", button: BUTTON.LEFT },
    { id: "RIGHT", label: "右に移動", button: BUTTON.RIGHT },
    { id: "DOWN", label: "しゃがみ", button: BUTTON.DOWN },
    { id: "JUMP", label: "ジャンプ", button: BUTTON.JUMP },
    { id: "LIGHT", label: "弱攻撃", button: BUTTON.LIGHT },
    { id: "HEAVY", label: "強攻撃", button: BUTTON.HEAVY },
    { id: "SPECIAL", label: "必殺技", button: BUTTON.SPECIAL },
  ];

  const DEFAULTS = Object.freeze({
    LEFT: "KeyA",
    RIGHT: "KeyD",
    DOWN: "KeyS",
    JUMP: "Space",
    LIGHT: "KeyU",
    HEAVY: "KeyI",
    SPECIAL: "KeyO",
  });

  const defaults = () => Object.assign({}, DEFAULTS);

  // 割り当てられないキー。Esc はキー待ちの取り消しと一時停止に使う。
  // Tab・F1〜F12・Windows/⌘キーなどは、ブラウザやOSが先に使ってしまうことがある
  function isReserved(code) {
    return (
      !code ||
      code === "Escape" ||
      code === "Tab" ||
      /^F\d+$/.test(code) ||
      /^(Meta|OS)(Left|Right)$/.test(code) ||
      code === "ContextMenu" ||
      code === "Unidentified"
    );
  }

  // 画面に出すキーの名前
  const NAMED = {
    Space: "スペース",
    Enter: "Enter",
    NumpadEnter: "テンキーEnter",
    Backspace: "BackSpace",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ShiftLeft: "左Shift",
    ShiftRight: "右Shift",
    ControlLeft: "左Ctrl",
    ControlRight: "右Ctrl",
    AltLeft: "左Alt",
    AltRight: "右Alt",
    Minus: "-",
    Equal: "^",
    BracketLeft: "@",
    BracketRight: "[",
    Backslash: "]",
    Semicolon: ";",
    Quote: ":",
    Backquote: "半角/全角",
    Comma: ",",
    Period: ".",
    Slash: "/",
    IntlRo: "\\（ろ）",
    IntlYen: "￥",
    NonConvert: "無変換",
    Convert: "変換",
    KanaMode: "かな",
    CapsLock: "CapsLock",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
  };
  // 記号のキーは、キーボードの種類（日本語・英語）で書いてある文字がちがう。
  // 実際に押されたときの文字を覚えておき、それを名前に使う（覚えていなければ日本語キーボードの文字）
  const seen = {};
  function rememberKey(code, key) {
    if (typeof code === "string" && typeof key === "string" && key.length === 1 && key !== " " && !/^(Key|Digit|Numpad)/.test(code)) {
      seen[code] = key;
    }
  }
  function keyLabel(code) {
    if (!code) return "なし";
    if (seen[code]) return seen[code];
    if (NAMED[code]) return NAMED[code];
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    m = /^Numpad(.+)$/.exec(code);
    if (m) {
      const sym = { Add: "+", Subtract: "-", Multiply: "*", Divide: "/", Decimal: "." }[m[1]] || m[1];
      return `テンキー${sym}`;
    }
    return code;
  }

  // 操作 action にキー code を割り当てる。ほかの操作がそのキーを使っていたら、2つのキーを入れ替える。
  // 入れ替えた相手の操作の id を返す（入れ替えなしなら null）
  function assign(bindings, action, code) {
    const other = ACTIONS.find((a) => a.id !== action && bindings[a.id] === code);
    if (other) bindings[other.id] = bindings[action];
    bindings[action] = code;
    return other ? other.id : null;
  }

  // 保存してあったものを読み込む。おかしなところがあれば初期値にもどす
  function fromSaved(obj) {
    const b = defaults();
    if (!obj || typeof obj !== "object") return b;
    for (const a of ACTIONS) {
      const code = obj[a.id];
      if (typeof code === "string" && !isReserved(code)) b[a.id] = code;
    }
    const codes = ACTIONS.map((a) => b[a.id]);
    if (new Set(codes).size !== codes.length) return defaults(); // 同じキーが2つの操作に入っていたら使わない
    if (obj.labels && typeof obj.labels === "object") for (const [c, k] of Object.entries(obj.labels)) rememberKey(c, k);
    return b;
  }

  // 保存するもの（割り当てと、記号のキーの名前）
  function toSaved(bindings) {
    const out = {};
    for (const a of ACTIONS) out[a.id] = bindings[a.id];
    const labels = {};
    for (const a of ACTIONS) if (seen[bindings[a.id]]) labels[bindings[a.id]] = seen[bindings[a.id]];
    out.labels = labels;
    return out;
  }

  // キー（code）→ ボタンのビット
  function keyToButton(bindings) {
    const map = {};
    for (const a of ACTIONS) map[bindings[a.id]] = a.button;
    return map;
  }

  // ボタンのビット → キーの名前（画面の説明用）
  function buttonLabel(bindings, button) {
    const a = ACTIONS.find((x) => x.button === button);
    return a ? keyLabel(bindings[a.id]) : "";
  }

  // ---- キーコンフィグ画面 ----
  // 行：変えられる操作のあと、「初期値にもどす」「もどる」
  const ROWS = ACTIONS.map((a) => ({ kind: "action", id: a.id, label: a.label })).concat([
    { kind: "reset", label: "初期値にもどす" },
    { kind: "back", label: "もどる" },
  ]);

  function createScreen() {
    return { cursor: 0, waiting: false, message: "" };
  }

  // キー待ちでないときの操作。action は "up" "down" "ok" "back"（メニューと同じ）
  // 返すもの：{ changed: true }＝割り当てが変わった（保存する）、{ close: true }＝画面を閉じる、それ以外は null
  function press(screen, bindings, action) {
    const n = ROWS.length;
    const row = ROWS[screen.cursor];
    if (action === "up") screen.cursor = (screen.cursor + n - 1) % n;
    else if (action === "down") screen.cursor = (screen.cursor + 1) % n;
    else if (action === "back") return { close: true };
    else if (action === "ok") {
      if (row.kind === "back") return { close: true };
      if (row.kind === "reset") {
        Object.assign(bindings, DEFAULTS);
        screen.message = "初期値にもどしました";
        return { changed: true };
      }
      screen.waiting = true;
      screen.message = "";
      return null;
    }
    if (action === "up" || action === "down") screen.message = "";
    return null;
  }

  // キー待ちのときに押されたキー。Esc で取り消し
  function pressKey(screen, bindings, code) {
    if (!screen.waiting) return null;
    const row = ROWS[screen.cursor];
    if (code === "Escape") {
      screen.waiting = false;
      screen.message = "変更をやめました";
      return null;
    }
    if (isReserved(code)) {
      screen.message = `${keyLabel(code)} は使えません。ほかのキーを押してください`;
      return null;
    }
    const swapped = assign(bindings, row.id, code);
    screen.waiting = false;
    const label = (id) => ACTIONS.find((a) => a.id === id).label;
    screen.message = swapped
      ? `${label(row.id)}を ${keyLabel(code)} にしました（${label(swapped)}は ${keyLabel(bindings[swapped])} に入れ替え）`
      : `${label(row.id)}を ${keyLabel(code)} にしました`;
    // 決めたら次の操作へ進む（上から順に決めていける）
    screen.cursor = Math.min(screen.cursor + 1, ROWS.length - 1);
    return { changed: true };
  }

  SF.keyconfig = { ACTIONS, DEFAULTS, ROWS, defaults, isReserved, keyLabel, rememberKey, assign, fromSaved, toSaved, keyToButton, buttonLabel, createScreen, press, pressKey };
})(globalThis);
