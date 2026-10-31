// キーボードの状態を読んで、計算部分が使う入力（ビット）に変える。
// 日本語キーボードでも同じ位置のキーで動くよう、文字ではなくキーの場所（code）で判定する。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const { BUTTON } = SF.input;

  const KEY_TO_BUTTON = {
    KeyA: BUTTON.LEFT,
    KeyD: BUTTON.RIGHT,
    KeyS: BUTTON.DOWN,
    Space: BUTTON.JUMP,
    KeyU: BUTTON.LIGHT,
    KeyI: BUTTON.HEAVY,
    KeyO: BUTTON.SPECIAL,
  };

  function createKeyboard(target) {
    const held = new Set();
    // 1フレームより短い一瞬の押し（押してすぐ離す）も取りこぼさないよう、
    // 次に読むまで「押された」ことを覚えておく
    let tapped = 0;

    function onKeyDown(e) {
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
