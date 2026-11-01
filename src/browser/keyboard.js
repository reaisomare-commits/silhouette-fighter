// キーボードの状態を読んで、計算部分が使う入力（ビット）に変える。
// 計算部分はボタンのビットしか見ないので、キーを変えても先行入力・投げ・ため攻撃などの動きはそのまま。
// 日本語キーボードでも同じ位置のキーで動くよう、文字ではなくキーの場所（code）で判定する。
(function (root) {
  const SF = (root.SF = root.SF || {});
  // どのキーがどのボタンか。キーコンフィグで変えられる（初期値は A D S スペース U I O）
  let KEY_TO_BUTTON = SF.keyconfig.keyToButton(SF.keyconfig.DEFAULTS);

  function isFormField(t) {
    return !!t && /^(INPUT|SELECT|BUTTON|TEXTAREA)$/.test(t.tagName || "");
  }

  function createKeyboard(target) {
    const held = new Set();
    // 1フレームより短い一瞬の押し（押してすぐ離す）も取りこぼさないよう、
    // 次に読むまで「押された」ことを覚えておく
    let tapped = 0;

    function onKeyDown(e) {
      if (isFormField(e.target)) return; // 自動対戦の画面などで、入力欄やボタンを操作しているときは使わない
      if (KEY_TO_BUTTON[e.code] !== undefined) {
        held.add(e.code);
        tapped |= KEY_TO_BUTTON[e.code];
        e.preventDefault(); // スペースで画面がスクロールしないように
      }
    }
    function onKeyUp(e) {
      if (KEY_TO_BUTTON[e.code] !== undefined) {
        held.delete(e.code);
        e.preventDefault();
      }
    }
    // ほかのウィンドウに切り替えたら、押しっぱなし扱いにならないよう全部離す
    function onBlur() {
      held.clear();
      tapped = 0;
    }

    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    target.addEventListener("blur", onBlur);

    return {
      // キーの割り当てを変える。押しっぱなし扱いが残らないよう、いったん全部離す
      setBindings(bindings) {
        KEY_TO_BUTTON = SF.keyconfig.keyToButton(bindings);
        held.clear();
        tapped = 0;
      },
      // そのキーがゲームの操作に使われているか
      isBound(code) {
        return KEY_TO_BUTTON[code] !== undefined;
      },
      // 今押されているボタンをまとめて返す
      read() {
        let input = tapped;
        tapped = 0;
        for (const code of held) input |= KEY_TO_BUTTON[code];
        return input;
      },
    };
  }

  SF.keyboard = { createKeyboard };
})(globalThis);
