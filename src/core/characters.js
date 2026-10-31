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
      // 前を素早く2回：ステップ（決まった距離だけ踏み込む）
      forwardDash: {
        type: "step",
        frames: 16, // 動いている時間（フレーム）
        speed: 5, // 1フレームに進むピクセル → 約80ピクセル
        recovery: 5, // 止まってから動けるまで（フレーム）
      },
      // 後ろを素早く2回：バックステップ
      backDash: { frames: 14, speed: 4.5, recovery: 6 }, // 約63ピクセル下がる
      health: 1000, // 体力
      // 技の表。時間はフレーム（1F＝1/60秒）。
      //   startup: 発生（ボタンを押したフレームを1として、何F目に当たり始めるか）
      //   active: 当たる時間の長さ（F）
      //   recovery: 硬直（当たる時間が終わってから動けるまで）。空中攻撃は null＝着地まで
      //   hitAdv / blockAdv: 硬直差（当たった／ガードされたあと、攻めた側が何F先に動けるか）。"down" はダウンさせる
      //     空中攻撃は「攻めた側が着地して着地硬直が終わったとき」から数える（どの高さで当てても同じ）
      //   damage: ダメージ
      //   guard: "mid"＝立ち・しゃがみどちらでも防げる、"low"＝しゃがみガードだけ、"air"＝立ちガードだけ
      //   hitbox: 当たる範囲（ピクセル）。x は体の中心から前へ、y は足元から上へ（マイナスは足元より下）
      //   push: 当たったときに相手を押し返す距離（ピクセル）。ガードされたときは自分がこの距離だけ下がる
      moves: {
        standLight: { name: "柄打ち", startup: 6, active: 2, recovery: 10, hitAdv: 3, blockAdv: 1, damage: 40, guard: "mid", hitbox: { x1: 15, x2: 78, y1: 75, y2: 135 }, push: 18 },
        standHeavy: { name: "大振り斬り", startup: 12, active: 3, recovery: 20, hitAdv: 2, blockAdv: -4, damage: 100, guard: "mid", hitbox: { x1: 25, x2: 150, y1: 55, y2: 150 }, push: 28 },
        crouchLight: { name: "足元突き", startup: 7, active: 2, recovery: 11, hitAdv: 2, blockAdv: 0, damage: 35, guard: "low", hitbox: { x1: 20, x2: 112, y1: 0, y2: 40 }, push: 18 },
        crouchHeavy: { name: "足払い斬り", startup: 14, active: 3, recovery: 24, hitAdv: "down", blockAdv: -10, damage: 90, guard: "low", hitbox: { x1: 20, x2: 132, y1: 0, y2: 35 }, push: 24 },
        airLight: { name: "空中攻撃（弱）", startup: 7, active: 6, recovery: null, hitAdv: 10, blockAdv: 3, damage: 35, guard: "air", hitbox: { x1: 0, x2: 72, y1: -35, y2: 55 }, push: 10 },
        airHeavy: { name: "空中攻撃（強）", startup: 11, active: 6, recovery: null, hitAdv: 14, blockAdv: 4, damage: 85, guard: "air", hitbox: { x1: -5, x2: 95, y1: -50, y2: 50 }, push: 14 },
      },
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
      // 前を素早く2回：ダッシュ（押している間ずっと走る）
      forwardDash: {
        type: "run",
        speed: 6.5, // 走る速さ（1フレームに進むピクセル）
        minFrames: 8, // すぐ離しても最低これだけは走る
        recovery: 6, // 離してから止まるまでのブレーキ（フレーム）
      },
      backDash: { frames: 12, speed: 5, recovery: 4 }, // 約60ピクセル下がる
      health: 900,
      moves: {
        standLight: { name: "ジャブ", startup: 4, active: 2, recovery: 8, hitAdv: 4, blockAdv: 2, damage: 30, guard: "mid", hitbox: { x1: 15, x2: 68, y1: 70, y2: 112 }, push: 16 },
        standHeavy: { name: "回し蹴り", startup: 9, active: 3, recovery: 16, hitAdv: 3, blockAdv: -2, damage: 80, guard: "mid", hitbox: { x1: 15, x2: 98, y1: 60, y2: 125 }, push: 26 },
        crouchLight: { name: "小足", startup: 4, active: 2, recovery: 9, hitAdv: 3, blockAdv: 1, damage: 25, guard: "low", hitbox: { x1: 15, x2: 78, y1: 0, y2: 30 }, push: 16 },
        crouchHeavy: { name: "足払い", startup: 10, active: 3, recovery: 20, hitAdv: "down", blockAdv: -8, damage: 70, guard: "low", hitbox: { x1: 15, x2: 98, y1: 0, y2: 30 }, push: 22 },
        airLight: { name: "空中攻撃（弱）", startup: 5, active: 6, recovery: null, hitAdv: 9, blockAdv: 2, damage: 25, guard: "air", hitbox: { x1: 0, x2: 58, y1: -30, y2: 50 }, push: 10 },
        airHeavy: { name: "空中攻撃（強）", startup: 9, active: 6, recovery: null, hitAdv: 12, blockAdv: 3, damage: 70, guard: "air", hitbox: { x1: -5, x2: 78, y1: -40, y2: 45 }, push: 14 },
      },
    },
  };

  // 方向キーを2回押したとみなす間隔（1回目を押してから何フレーム以内に2回目を押すか）
  const DOUBLE_TAP_WINDOW = 12;

  // 共通の戦闘ルールの数値
  const BATTLE = {
    roundSeconds: 60, // 1ラウンドの時間（秒）
    winsToMatch: 2, // 何ラウンド先取で勝ちか
    hitstopHit: 8, // 当たった瞬間に止まる時間（F）
    hitstopBlock: 5, // ガードした瞬間に止まる時間（F）
    downFrames: 50, // ダウンしてから起き上がるまで（F、この間は攻撃が当たらない）
    introFrames: 100, // ラウンド開始の表示の時間（F）
    roundEndFrames: 150, // KO・時間切れの表示の時間（F）
  };

  const IDS = Object.keys(CHARACTERS);

  SF.characters = { CHARACTERS, IDS, DOUBLE_TAP_WINDOW, BATTLE };
})(globalThis);
