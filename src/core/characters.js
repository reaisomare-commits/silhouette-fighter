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
      walkForward: 2.75, // 相手に向かって歩く
      walkBack: 2.2, // 下がる（立ちガードしながら）
      // ジャンプ
      jumpVelocity: 14.4, // 跳んだ瞬間の上向きの速さ
      jumpForward: 2.9, // 斜めジャンプの横の速さ
      gravity: 0.65, // 毎フレーム下向きに加わる速さ
      // → 高さ約160ピクセル、滞空約45フレーム（0.75秒）。前ジャンプで約130ピクセル進む
      landingLag: 3, // 着地してから動けない時間（フレーム）
      // 前を素早く2回：ステップ（決まった距離だけ踏み込む）
      forwardDash: {
        type: "step",
        frames: 16, // 動いている時間（フレーム）
        speed: 5.75, // 1フレームに進むピクセル → 約92ピクセル
        recovery: 5, // 止まってから動けるまで（フレーム）
      },
      // 後ろを素早く2回：バックステップ
      // 後ろを素早く2回：バックステップ。下がっている間は投げられない。
      // 初めの invincible フレームは攻撃も当たらない（無敵）。止まり際（recovery）に攻撃や投げを受けるとダメージが増える
      backDash: { frames: 14, speed: 5.2, recovery: 12, invincible: 8 }, // 約73ピクセル下がる
      health: 1000, // 体力
      // 技の表。時間はフレーム（1F＝1/60秒）。
      //   startup: 発生（ボタンを押したフレームを1として、何F目に当たり始めるか）
      //   active: 当たる時間の長さ（F）
      //   recovery: 硬直（当たる時間が終わってから動けるまで）。空中攻撃は null＝着地まで
      //   hitAdv / blockAdv: 硬直差（当たった／ガードされたあと、攻めた側が何F先に動けるか）。"down" はダウンさせる
      //     空中攻撃は「攻めた側が着地して着地硬直が終わったとき」から数え、下りの低い所（着地の airHitLow フレーム前より下）で
      //     当てたときの値。それより高い所で当てると、そのフレーム数だけ有利が減る（ジャンプして最速で出しても連続技にならない）
      //   damage: ダメージ
      //   guard: "mid"＝立ち・しゃがみどちらでも防げる、"low"＝しゃがみガードだけ、"high"＝立ちガードだけ（地上の中段技）、"air"＝立ちガードだけ（空中攻撃）
      //   hitbox: 当たる範囲（ピクセル）。x は体の中心から前へ、y は足元から上へ（マイナスは足元より下）
      //   push: 当たったときに相手を押し返す距離（ピクセル）。ガードされたときは自分がこの距離だけ下がる
      //   kind: "normal"＝通常技、"special"＝必殺技（ガードされても削りダメージ）、"throw"＝投げ（ガードできない）
      //   projectile: 飛び道具の大きさと速さ（ピクセル）。spawnX は体の中心から前へ、y は足元から上へ（飛び道具の中心）。
      //     fall は1フレームに下へ進む速さ（斜め下に飛ぶ）、portal: true なら出た所に門を描く。
      //     homing があれば、相手の体の真ん中の高さに向かって上下の速さを1フレームに turn ずつ変える（上下の速さは max まで）
      //   lunge: 技の途中で前に進む（from〜to フレーム目に、1フレーム speed ピクセル）
      //   noCancel: true なら当たっても必殺技キャンセルできない
      //   charge: ボタンを押している間ためて、離すと出る技（max フレームまで。ためた分 lunge の速さが speedPerFrame ずつ増える）。
      //     full は最大までためたときだけの性質（projectileInvincible: 飛び道具をすり抜ける、blockAdv: ガードされたときの硬直差）
      //   hurtExtend: 技を出している間に伸びるやられる範囲（書かなければ hitbox と同じ）。
      //     当たる時間はこの範囲まで、発生前と硬直中はその半分の長さまで伸びる
      //   投げの hitbox は掴める範囲。recovery は空振りしたときの硬直
      //   ゲージ技（super）：ゲージが満タンのとき 強＋必殺技の同時押し（I＋O）で出る。出すとゲージを全部使い、画面が一瞬止まる（暗転）
      //     invincible: 出してから何フレーム目まで攻撃も投げも飛び道具も当たらないか（無敵）
      //     guardBeforeFreeze: true なら、暗転する前からガード（後ろ）を押していた相手しかガードできない
      //     buff: 当たる技ではなく、出すと buff.frames フレームの間、強くなる（cancelAll: すべての攻撃が、当たるかガードされたら別の攻撃でキャンセルできる）
      //     projectile.multi: 何回も当たる飛び道具（hits 回まで、interval フレームごと）。最後の1発より前は hitAdv をこちらの値にする。
      //       当たってもガードされても消えずに進み、相手を push ピクセルずつ押していく（ガードしている相手も押し出す）。
      //       空中の相手に当たったら、上向きに airLift（1フレームのピクセル）だけ浮かせて球と同じ速さで運ぶので、空中でも最後まで当たり続ける
      // 1回の連続技で弱攻撃（U）を何回までつなげられるか（そのあと I や必殺技につなげられる）
      lightChainMax: 1,
      moves: {
        standLight: { name: "柄打ち", startup: 6, active: 2, recovery: 10, hitAdv: 3, blockAdv: 1, damage: 40, guard: "mid", hitbox: { x1: 15, x2: 78, y1: 75, y2: 135 }, push: 18 },
        standHeavy: { name: "大振り斬り", startup: 12, active: 3, recovery: 24, hitAdv: 2, blockAdv: -8, damage: 100, guard: "mid", hitbox: { x1: 25, x2: 150, y1: 55, y2: 120 }, push: 28 },
        crouchLight: { name: "足元突き", startup: 7, active: 2, recovery: 11, hitAdv: 2, blockAdv: 0, damage: 35, guard: "low", hitbox: { x1: 20, x2: 112, y1: 0, y2: 40 }, push: 18 },
        crouchHeavy: { name: "足払い斬り", startup: 14, active: 3, recovery: 24, hitAdv: "down", blockAdv: -10, damage: 90, guard: "low", hitbox: { x1: 20, x2: 132, y1: 0, y2: 35 }, push: 24, noCancel: true },
        airLight: { name: "空中攻撃（弱）", startup: 7, active: 6, recovery: null, hitAdv: 10, blockAdv: 3, damage: 35, guard: "air", hitbox: { x1: 0, x2: 72, y1: -15, y2: 55 }, push: 10 },
        airHeavy: { name: "空中攻撃（強）", startup: 11, active: 6, recovery: null, hitAdv: 14, blockAdv: 4, damage: 85, guard: "air", hitbox: { x1: -5, x2: 95, y1: -25, y2: 50 }, push: 14 },
        // 飛刃：飛び道具。画面に1つまで。硬直差は目の前で当てたときの値（離れて当てるほど攻めた側が有利）
        special: { name: "飛刃", kind: "special", startup: 16, active: 1, recovery: 25, hitAdv: 4, blockAdv: -8, damage: 80, guard: "mid", hitbox: null, hurtExtend: { x1: 0, x2: 70, y1: 60, y2: 120 }, push: 14, projectile: { speed: 7, width: 44, height: 30, spawnX: 50, y: 75 } },
        // 昇り斬り：対空。頭の上まで届く。外すと大きな隙
        // 上に伸びるやられる範囲は頭の高さまで（上から来る相手に負けにくい）
        crouchSpecial: { name: "昇り斬り", kind: "special", startup: 8, active: 5, recovery: 35, hitAdv: "down", blockAdv: -25, damage: 100, guard: "mid", hitbox: { x1: 0, x2: 85, y1: 40, y2: 240 }, hurtExtend: { x1: 0, x2: 70, y1: 40, y2: 170 }, push: 20 },
        // 投げ：空振りすると、同じくらいの発生の柄打ち（硬直10F）よりずっと長く動けない
        throw: { name: "投げ", kind: "throw", startup: 5, active: 2, recovery: 22, damage: 100, hitbox: { x1: 0, x2: 55, y1: 0, y2: 160 } },
        // ゲージ技「月影斬」：画面の半分くらいを一瞬で駆け抜けて斬る。出だしは無敵（当たる時間の始めまで）なので切り返しにも使える。
        //   暗転する前からガードを押していないとガードできない。ガードされても −2 だけ
        super: { name: "月影斬", kind: "special", startup: 6, active: 12, recovery: 30, hitAdv: "down", blockAdv: -2, damage: 250, guard: "mid", hitbox: { x1: 0, x2: 105, y1: 30, y2: 150 }, push: 30, lunge: { from: 4, to: 17, speed: 17 }, invincible: 10, guardBeforeFreeze: true },
      },
    },
    rin: {
      name: "リン",
      width: 50,
      height: 135,
      crouchHeight: 85,
      walkForward: 4.15,
      walkBack: 3.2,
      // ジャンプはカゲツと同じ
      jumpVelocity: 14.4,
      jumpForward: 2.9,
      gravity: 0.65,
      // → 高さ約160ピクセル、滞空約45フレーム（0.75秒）
      landingLag: 3,
      // 前を素早く2回：ダッシュ（押している間ずっと走る）
      forwardDash: {
        type: "run",
        speed: 7.5, // 走る速さ（1フレームに進むピクセル）
        minFrames: 8, // すぐ離しても最低これだけは走る
        recovery: 6, // 離してから止まるまでのブレーキ（フレーム）
      },
      backDash: { frames: 12, speed: 5.75, recovery: 10, invincible: 8 }, // 約69ピクセル下がる
      health: 900,
      lightChainMax: 2, // リンはUを2回つないでからIにもつなげられる
      moves: {
        standLight: { name: "ジャブ", startup: 4, active: 2, recovery: 8, hitAdv: 4, blockAdv: 2, damage: 30, guard: "mid", hitbox: { x1: 15, x2: 68, y1: 70, y2: 112 }, push: 16 },
        standHeavy: { name: "回し蹴り", startup: 9, active: 3, recovery: 16, hitAdv: 3, blockAdv: -2, damage: 80, guard: "high", hitbox: { x1: 15, x2: 98, y1: 60, y2: 125 }, push: 26 },
        crouchLight: { name: "小足", startup: 4, active: 2, recovery: 9, hitAdv: 3, blockAdv: 1, damage: 25, guard: "low", hitbox: { x1: 15, x2: 78, y1: 0, y2: 30 }, push: 16 },
        crouchHeavy: { name: "足払い", startup: 10, active: 3, recovery: 20, hitAdv: "down", blockAdv: -8, damage: 70, guard: "low", hitbox: { x1: 15, x2: 98, y1: 0, y2: 30 }, push: 22, noCancel: true },
        airLight: { name: "空中攻撃（弱）", startup: 5, active: 6, recovery: null, hitAdv: 9, blockAdv: 2, damage: 25, guard: "air", hitbox: { x1: 0, x2: 58, y1: -15, y2: 50 }, push: 10 },
        airHeavy: { name: "空中攻撃（強）", startup: 9, active: 6, recovery: null, hitAdv: 12, blockAdv: 3, damage: 70, guard: "air", hitbox: { x1: -5, x2: 78, y1: -20, y2: 45 }, push: 14 },
        // 突進拳：素早く前に突っ込む。当たるとダウン。ガードされても少し不利なだけ
        //   ためる技：O を押している間は構えてため、離すと出る（発生は離してから数える）。
        //   ためたフレーム数×speedPerFrame だけ進む速さが増える（最大 max フレーム。ためなし約99px、最大約198px）
        //   最大までためると（full）：技が終わるまで飛び道具をすり抜ける（ふつうの攻撃は当たる）、ガードされたときの硬直差が blockAdv になる
        special: { name: "突進拳", kind: "special", startup: 10, active: 3, recovery: 24, hitAdv: "down", blockAdv: -2, damage: 80, guard: "mid", hitbox: { x1: 15, x2: 75, y1: 65, y2: 115 }, push: 24, lunge: { from: 2, to: 12, speed: 9 }, charge: { max: 30, speedPerFrame: 0.3, full: { projectileInvincible: true, blockAdv: 1 } } },
        // 跳び蹴り上げ：対空。ガードされたときに下がる距離（push）は小さい
        crouchSpecial: { name: "跳び蹴り上げ", kind: "special", startup: 6, active: 4, recovery: 36, hitAdv: "down", blockAdv: -28, damage: 85, guard: "mid", hitbox: { x1: -20, x2: 90, y1: 50, y2: 210 }, hurtExtend: { x1: -5, x2: 55, y1: 50, y2: 135 }, push: 8 },
        // 投げ：掴める範囲がカゲツより少し広い。空振りすると、同じくらいの発生のジャブ（硬直8F）よりずっと長く動けない
        throw: { name: "投げ", kind: "throw", startup: 5, active: 2, recovery: 21, damage: 130, hitbox: { x1: 0, x2: 65, y1: 0, y2: 130 } },
        // ゲージ技「練気」：6秒（360F）の間、すべての攻撃（足払いや必殺技も）が当たるかガードされたら別の攻撃でキャンセルできる
        //   構えはなく、暗転が終わったらすぐ動ける（出しかけの技やためは取り消す。startup などの数字は使わない）
        super: { name: "練気", kind: "special", startup: 1, active: 0, recovery: 20, hitAdv: 0, blockAdv: 0, damage: 0, guard: "mid", hitbox: null, push: 0, buff: { frames: 360, cancelAll: true } },
      },
    },
    // ゲンマ（幻魔）：体力が少ない悪役。ワープで消えて間合いを変え、空中で浮いて止まり、異空間の門から飛び道具を出す
    genma: {
      name: "ゲンマ",
      width: 50,
      height: 165,
      crouchHeight: 100,
      walkForward: 2.3,
      walkBack: 2.3,
      // カゲツ・リンより少しふわっと跳ぶ
      jumpVelocity: 13.3,
      jumpForward: 2.45,
      gravity: 0.555,
      // → 高さ約160ピクセル、滞空約48フレーム
      landingLag: 4,
      // 浮遊：ジャンプの頂上を過ぎてからジャンプのキーを押し続けると、落ちずに浮いて止まる（1回のジャンプで1回）。
      //   frames: 浮いていられる最大のフレーム数、speed: 浮いている間に左右のキーで動く速さ（1フレームに何ピクセル）
      //   離すとそこから（そのときの横の速さのまま）落ち始め、もう浮けない
      //   hurtCut: 浮いている間は、やられる範囲の下側をこのピクセルだけ小さくする（衣のすそには当たらない）
      float: { frames: 40, speed: 2.5, hurtCut: 50 },
      // 前を素早く2回：ワープ（消えて、distance ピクセル先に現れる）。消えている frames の間は攻撃も投げも当たらない。
      // 相手をすり抜けて裏に回れる。recovery は現れてから動けるまで
      forwardDash: { type: "warp", frames: 12, distance: 190, recovery: 18 },
      // 後ろを素早く2回：後ろへワープ。現れたあとの recovery に攻撃や投げを受けると隙狩り（バックステップと同じ）
      backDash: { type: "warp", frames: 12, distance: 190, recovery: 20, invincible: 12 },
      health: 500,
      lightChainMax: 1,
      moves: {
        standLight: { name: "闇爪", startup: 5, active: 2, recovery: 10, hitAdv: 3, blockAdv: 1, damage: 50, guard: "mid", hitbox: { x1: 15, x2: 75, y1: 80, y2: 140 }, push: 16 },
        standHeavy: { name: "影の鎌", startup: 11, active: 4, recovery: 20, hitAdv: 2, blockAdv: -5, damage: 125, guard: "mid", hitbox: { x1: 20, x2: 130, y1: 60, y2: 120 }, push: 26 },
        crouchLight: { name: "影這い", startup: 6, active: 2, recovery: 10, hitAdv: 2, blockAdv: 0, damage: 45, guard: "low", hitbox: { x1: 15, x2: 90, y1: 0, y2: 35 }, push: 16 },
        crouchHeavy: { name: "闇溜まり", startup: 13, active: 4, recovery: 22, hitAdv: "down", blockAdv: -10, damage: 115, guard: "low", hitbox: { x1: 20, x2: 125, y1: 0, y2: 30 }, push: 22, noCancel: true },
        airLight: { name: "空中攻撃（弱）", startup: 6, active: 6, recovery: null, hitAdv: 9, blockAdv: 2, damage: 45, guard: "air", hitbox: { x1: 0, x2: 60, y1: -15, y2: 50 }, push: 10 },
        airHeavy: { name: "空中攻撃（強）", startup: 10, active: 6, recovery: null, hitAdv: 12, blockAdv: 3, damage: 110, guard: "air", hitbox: { x1: -5, x2: 85, y1: -20, y2: 45 }, push: 14 },
        // 異空間弾：少し先（spawnX）に開いた門から飛び道具が出て、相手の高さへ曲がっていく（ホーミング）。目の前の相手には当たらない。画面に1つまで（空中のものと合わせて）。
        // 硬直差は門の目の前で当てたときの値
        special: { name: "異空間弾", kind: "special", startup: 20, active: 1, recovery: 22, hitAdv: 4, blockAdv: -6, damage: 105, guard: "mid", hitbox: null, hurtExtend: { x1: 0, x2: 45, y1: 80, y2: 130 }, push: 14, projectile: { speed: 5, width: 36, height: 36, spawnX: 220, y: 90, portal: true, homing: { turn: 0.25, max: 4 } } },
        // 異空間弾（空中）：空中で O。前の門から斜め下へ飛び、相手の高さへ曲がっていく（fall＝はじめに1フレームに下へ進むピクセル）。1回のジャンプで空中攻撃とどちらか1回。
        // 硬直差は「自分が低い所で出して、すぐ着地したとき」の値
        airSpecial: { name: "異空間弾（空中）", kind: "special", startup: 12, active: 1, recovery: null, hitAdv: 6, blockAdv: 1, damage: 90, guard: "mid", hitbox: null, hurtExtend: { x1: 0, x2: 40, y1: 40, y2: 100 }, push: 10, projectile: { speed: 5, fall: 5, width: 32, height: 32, spawnX: 60, y: 40, portal: true, homing: { turn: 0.25, max: 5 } } },
        // 闇柱：対空。少し前の地面の門から、頭の上まで太い闇の柱が立つ（自分の少し後ろから前へ130pxまで）。柱は門から出るので、伸びるやられる範囲は小さい
        crouchSpecial: { name: "闇柱", kind: "special", startup: 9, active: 6, recovery: 22, hitAdv: "down", blockAdv: -14, damage: 120, guard: "mid", hitbox: { x1: -10, x2: 130, y1: 0, y2: 230 }, hurtExtend: { x1: 0, x2: 30, y1: 40, y2: 160 }, push: 16 },
        throw: { name: "闇引き", kind: "throw", startup: 5, active: 2, recovery: 22, damage: 135, hitbox: { x1: 0, x2: 55, y1: 0, y2: 160 } },
        // ゲージ技「冥府球」：目の前に大きな闇の球を出し、ゆっくり進ませる。当たると8回まで連続で当たり（最後の1発でダウン）、
        //   ガードされても消えずに、相手を押し出しながら連続でガードさせる。相手の飛び道具は消して進む
        //   1発40ダメージ（コンボ補正で 40＋36＋32＋28＋24＋20＋16＋12＝合計約210）
        super: { name: "冥府球", kind: "special", startup: 18, active: 1, recovery: 26, hitAdv: "down", blockAdv: -4, damage: 40, guard: "mid", hitbox: null, hurtExtend: { x1: 0, x2: 50, y1: 70, y2: 140 }, push: 40, projectile: { speed: 2.5, width: 120, height: 120, spawnX: 90, y: 85, portal: true, multi: { hits: 8, interval: 8, hitAdv: 0, push: 20, airLift: 3 } } },
      },
    },
    // ゴウ（剛）：投げの大男。体力が多くて大きいが遅い。近づけば、投げ抜けできないコマンド投げで一気に大ダメージを取る
    gou: {
      name: "ゴウ",
      width: 70,
      height: 185,
      crouchHeight: 120,
      walkForward: 1.95,
      walkBack: 1.6,
      // 低く重いジャンプ
      jumpVelocity: 12.8,
      jumpForward: 2.45,
      gravity: 0.64,
      // → 高さ約128ピクセル、滞空約40フレーム
      landingLag: 5,
      // 前を素早く2回：踏み込み（約58ピクセル）。出だしの invincible フレームは攻撃も投げも当たらない（無敵）。
      //   踏み込んでいる間（projectileInvincible フレーム）はずっと飛び道具が当たらない（すり抜ける）
      forwardDash: { type: "step", frames: 14, speed: 4.15, recovery: 8, invincible: 10, projectileInvincible: 14 },
      backDash: { frames: 10, speed: 4.6, recovery: 14, invincible: 6 }, // 約46ピクセル下がる
      health: 1300,
      lightChainMax: 1,
      // ゴウだけの性質：
      //   armor: 踏ん張り。from〜to フレーム目に攻撃を受けても、1発だけは技が止まらない（ダメージは受ける。ゲージ技は受け止められない）
      //   投げ（kind: "throw"）の noTech: true は投げ抜けできない投げ。掴んだら hold フレームかけて投げ、投げたあと finish フレーム動けない
      //   antiAir: true は空中の相手だけを掴む投げ（地上の相手は掴めない）。airInvincible: 出してからそのフレームまで、空中の相手の攻撃が当たらない
      //   projectileInvincible: 出してからそのフレームまで飛び道具が当たらない
      moves: {
        // 張り手：弱攻撃なのにリーチが長い（強攻撃なみ）。そのかわり腕のやられる範囲も同じだけ前に出るので、強攻撃を合わされると負ける。
        // 張り手・大張り手は当たる範囲の上側が低め（頭の上の相手には当たりにくい）。弱強の技は硬直が長く、ガードされると不利が大きい
        standLight: { name: "張り手", startup: 7, active: 3, recovery: 15, hitAdv: 2, blockAdv: -3, damage: 60, guard: "mid", hitbox: { x1: 20, x2: 125, y1: 95, y2: 135 }, hurtExtend: { x1: 0, x2: 125, y1: 95, y2: 150 }, push: 20 },
        // 大振りだが、出だしから当たり終わるまで1発だけ攻撃を受け止める（踏ん張り）
        standHeavy: { name: "大張り手", startup: 18, active: 4, recovery: 25, hitAdv: 3, blockAdv: -9, damage: 130, guard: "mid", hitbox: { x1: 25, x2: 125, y1: 80, y2: 140 }, push: 30, armor: { from: 3, to: 21 } },
        crouchLight: { name: "すね蹴り", startup: 8, active: 2, recovery: 15, hitAdv: 2, blockAdv: -4, damage: 50, guard: "low", hitbox: { x1: 20, x2: 100, y1: 0, y2: 35 }, push: 18 },
        crouchHeavy: { name: "四股踏み", startup: 16, active: 4, recovery: 27, hitAdv: "down", blockAdv: -13, damage: 120, guard: "low", hitbox: { x1: 10, x2: 125, y1: 0, y2: 25 }, push: 24, noCancel: true },
        airLight: { name: "肘落とし", startup: 7, active: 6, recovery: null, hitAdv: 10, blockAdv: 2, damage: 50, guard: "air", hitbox: { x1: 0, x2: 68, y1: -15, y2: 55 }, push: 10 },
        // ボディプレス：体ごと落ちてくる。下向きに広い
        airHeavy: { name: "ボディプレス", startup: 10, active: 8, recovery: null, hitAdv: 13, blockAdv: 3, damage: 110, guard: "air", hitbox: { x1: -25, x2: 72, y1: -35, y2: 40 }, push: 14 },
        // 岩落とし：コマンド投げ。普通の投げより遠くから掴めて、投げ抜けできない。空振りすると大きな隙
        special: { name: "岩落とし", kind: "throw", noTech: true, startup: 8, active: 2, recovery: 40, damage: 200, hitbox: { x1: 0, x2: 85, y1: 0, y2: 175 }, hurtExtend: { x1: 0, x2: 50, y1: 70, y2: 150 }, hold: 24, finish: 28 },
        // つかみ上げ：対空投げ。頭の上の空中の相手だけを掴んで叩きつける。出だしは空中の相手の攻撃が当たらない
        crouchSpecial: { name: "つかみ上げ", kind: "throw", noTech: true, antiAir: true, startup: 5, active: 8, recovery: 30, damage: 150, hitbox: { x1: -20, x2: 90, y1: 110, y2: 300 }, hurtExtend: { x1: 0, x2: 40, y1: 110, y2: 200 }, airInvincible: 12, hold: 20, finish: 24 },
        // 投げ：掴める範囲が広め、ダメージも普通の投げより大きい
        throw: { name: "ベアハッグ", kind: "throw", startup: 5, active: 2, recovery: 24, damage: 160, hitbox: { x1: 0, x2: 65, y1: 0, y2: 175 } },
        // ゲージ技「大地落とし」：約250ピクセル先まで突進して掴み、高く跳んで叩きつける。ガードも投げ抜けもできない。
        //   出だしは飛び道具が当たらない。catchAfterFreeze: 暗転したときに地上にいた相手は、暗転のあとで跳んでも
        //   バックステップやワープをしても掴む（カゲツの月影斬と同じく、暗転を見てからでは対応できない）。
        //   暗転する前から跳んでいた相手や、届かない距離の相手には空振りして、大きな隙（70F）
        super: { name: "大地落とし", kind: "throw", noTech: true, catchAfterFreeze: true, startup: 3, active: 13, recovery: 70, damage: 320, hitbox: { x1: 0, x2: 70, y1: 0, y2: 180 }, lunge: { from: 2, to: 15, speed: 14 }, projectileInvincible: 16, hold: 50, finish: 30 },
      },
    },
  };

  // 方向キーを2回押したとみなす間隔（1回目を押してから何フレーム以内に2回目を押すか）
  const DOUBLE_TAP_WINDOW = 12;

  // 共通の戦闘ルールの数値
  const BATTLE = {
    roundSeconds: 60, // 1ラウンドの時間（秒）
    winsToMatch: 2, // 何ラウンド先取で勝ちか
    // 影縫い：相手が技を出してから当たる時間が終わるまで、その技の当たる範囲をこれだけ広げた範囲に
    // 体が入っていると、後ろを押しても下がらずその場で立ちガードの構えになる（ピクセル）
    shadowStitchX: 30, // 前後に広げる幅
    shadowStitchY: 15, // 上下に広げる幅
    // コンボ補正：1発目100%、そこから1発ごとに comboScaleStep %ずつ下がり、comboScaleMin %より下がらない
    comboScaleStep: 10,
    comboScaleMin: 10,
    chipRate: 10, // 必殺技をガードしたときに減る体力（ダメージの何%か）
    backstepPunishRate: 125, // バックステップの止まり際に攻撃・投げを受けたときのダメージ（%。連続技の1発目だけ）
    throwInputWindow: 2, // UとIをこのフレーム数以内のずれで押せば「同時押し」とみなす
    throwTechWindow: 8, // 投げが決まってから何フレーム以内にU＋Iを押せば投げ抜けできるか
    throwFinish: 30, // 投げきったあと、投げた側が動けるまで（F）
    throwTechStun: 14, // 投げ抜けしたあと、両方が動けるまで（F）
    throwTechPush: 40, // 投げ抜けで離れる距離（ピクセル、それぞれ）
    airHitLow: 12, // 空中攻撃が表どおりの有利になる高さ（着地の何フレーム前より下で当てたか）
    hitstopHit: 8, // 当たった瞬間に止まる時間（F）
    hitstopBlock: 5, // ガードした瞬間に止まる時間（F）
    downFrames: 50, // ダウンしてから起き上がるまで（F、この間は攻撃が当たらない）
    introFrames: 100, // ラウンド開始の表示の時間（F）
    roundEndFrames: 150, // KO・時間切れの表示の時間（F）
    // ゲージ：満タン（max）でゲージ技を1回出せる。次のラウンドに持ち越す。
    //   溜まる量は「相手（自分）の体力をぜんぶ減らしたら」の値。1割減らせばその1割だけ溜まる
    gauge: {
      max: 100,
      dealt: 50, // 相手の体力を減らしたとき（攻めた側）
      taken: 40, // 自分の体力を減らされたとき（守った側）
      blocked: 15, // 技をガードさせたとき（攻めた側。技のダメージで数える）
      guarded: 20, // 技をガードしたとき（守った側。技のダメージで数える）
      guardedProjectile: 40, // 飛び道具をガードしたとき（守った側。食らったときと同じ）
    },
    superFreeze: 40, // ゲージ技を出した瞬間に、画面が止まる時間（F。暗転）
    // 消極的な動きのペナルティ：前に出ず（その場にいる・下がる・しゃがむ・バックステップ・前後に行ったり来たり）、飛び道具しか撃たない時間が
    // frames フレーム続くと、そこから every フレームごとにゲージが drain 減る。
    // 「自分から前に進んだ距離 − 自分から下がった距離」が advance ピクセル以上増えるか（歩く・走る・ステップ・ワープ・ジャンプ、どれでもよい）、
    // 飛び道具でない攻撃（投げ・ゲージ技も）をすると数え直し。下がってから同じだけ戻っても数え直しにならない
    // （大きく下がったときは、下がった所から back ピクセル＋ advance ピクセル前に出れば数え直し）。
    // 相手に体がくっつくくらい（すき間 closeGap ピクセル以下）で前に歩いているときも数え直し（押していて進めないだけなので）。
    // 攻撃を受けている・ガードしている・倒れている間は数えない（止まるだけで、数え直しにはならない）
    passive: { frames: 300, every: 60, drain: 3, advance: 40, back: 120, closeGap: 20 },
    // 積極的な動きのボーナス：上と同じ「前に進んだ距離 − 下がった距離」が、そのラウンドで一番前に出た記録を
    // distance ピクセル更新するたびに、ゲージが gain 増える（前に歩く・走る・前ジャンプなど）。
    // 攻撃で押し戻された分は引かれないが、自分から下がった分は取り戻すまで増えない（前後の往復では溜まらない）
    aggressive: { distance: 100, gain: 1 },
  };

  const IDS = Object.keys(CHARACTERS);

  SF.characters = { CHARACTERS, IDS, DOUBLE_TAP_WINDOW, BATTLE };
})(globalThis);
