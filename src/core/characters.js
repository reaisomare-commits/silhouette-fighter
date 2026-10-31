// キャラごとの数値をまとめた表。調整するときはこのファイルだけ書き換えればよい。
// 速さや高さはピクセル（1フレームあたり）で書き、計算するときに整数（×100）に直す。
(function (root) {
  const SF = (root.SF = root.SF || {});

  const CHARACTERS = {
    kagetsu: {
      name: "カゲツ",
      // 体の大きさ（ピクセル）
      width: 56, // 体の幅（ぶつかり判定にも使う）
      height: 170, // 立っているときの高さ
      crouchHeight: 105, // しゃがんでいるときの高さ
      // 歩き（1フレームに何ピクセル進むか）
      walkForward: 2.4, // 相手に向かって歩く
      walkBack: 1.9, // 下がる（立ちガードしながら）
      // ジャンプ
      jumpVelocity: 14, // 跳んだ瞬間の上向きの速さ
      jumpForward: 2.6, // 斜めジャンプの横の速さ
      gravity: 0.75, // 毎フレーム下向きに加わる速さ
      // → 高さ約130ピクセル、滞空約37フレーム（0.6秒）
      landingLag: 3, // 着地してから動けない時間（フレーム）
    },
    rin: {
      name: "リン",
      width: 50,
      height: 135,
      crouchHeight: 85,
      walkForward: 3.6,
      walkBack: 2.8,
      jumpVelocity: 17,
      jumpForward: 3.4,
      gravity: 0.85,
      // → 高さ約170ピクセル、滞空約40フレーム（0.67秒）
      landingLag: 3,
    },
  };

  const IDS = Object.keys(CHARACTERS);

  SF.characters = { CHARACTERS, IDS };
})(globalThis);
