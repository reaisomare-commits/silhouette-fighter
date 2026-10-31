// 1フレームぶんの入力を「ボタンごとのビット」で表す。
// キーボードでもCPUでも、同じこの形で入力を渡す（CPUに特別な動きをさせないため）。
(function (root) {
  const SF = (root.SF = root.SF || {});

  const BUTTON = Object.freeze({
    LEFT: 1 << 0, // A
    RIGHT: 1 << 1, // D
    DOWN: 1 << 2, // S（しゃがみ）
    JUMP: 1 << 3, // スペース
    LIGHT: 1 << 4, // U（弱攻撃）
    HEAVY: 1 << 5, // I（強攻撃）
    SPECIAL: 1 << 6, // O（必殺技）
  });

  const NONE = 0;

  function isDown(input, button) {
    return (input & button) !== 0;
  }

  // 前のフレームでは押しておらず、今のフレームで押した
  function justPressed(input, prevInput, button) {
    return (input & button) !== 0 && (prevInput & button) === 0;
  }

  SF.input = { BUTTON, NONE, isDown, justPressed };
})(globalThis);
