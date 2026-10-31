// 画面なしで計算部分だけを動かして確かめるスクリプト。
// 使い方: node tools/headless-check.js
//   1. 同じ種と同じ入力なら、何度やっても同じ結果になるか（試合の再現）
//   2. 画面なしでどれくらい速く進められるか
const assert = require("node:assert");
require("../src/core/constants.js");
require("../src/core/rng.js");
require("../src/core/input.js");
require("../src/core/characters.js");
require("../src/core/game.js");
require("../src/core/dummy.js");

const SF = globalThis.SF;
// ラウンド開始の表示を飛ばして、すぐ動ける試合を作る
const newGame = (seed, chars) => SF.game.createGame(seed, chars, { intro: false });

// 種から決まるでたらめな入力で、指定フレーム数だけ試合を進める
function runMatch(seed, frames) {
  const state = SF.game.createGame(seed);
  const inputRng = SF.rng.createRng(seed ^ 0x9e3779b9);
  for (let i = 0; i < frames; i++) {
    const p1 = SF.rng.nextInt(inputRng, 128);
    const p2 = SF.rng.nextInt(inputRng, 128);
    SF.game.step(state, [p1, p2]);
  }
  return state;
}

// 1. 再現性：60秒ぶん（3600フレーム）を2回やって同じになるか
const a = runMatch(12345, 3600);
const b = runMatch(12345, 3600);
assert.strictEqual(SF.game.hashState(a), SF.game.hashState(b), "同じ種なのに結果が違う");
assert.strictEqual(a.frame, 3600);
const c = runMatch(54321, 3600);
assert.notStrictEqual(SF.game.hashState(a), SF.game.hashState(c), "違う種なのに結果が同じ");
console.log(`OK 再現性: 同じ種なら同じ結果（${SF.game.hashState(a)}）`);

// 地面より下にもぐらず、画面の外にも出ていないか
for (const f of a.fighters) {
  assert.ok(f.y <= SF.constants.GROUND_Y * SF.constants.SCALE, "地面にもぐった");
  assert.ok(f.x > 0 && f.x < SF.constants.STAGE_WIDTH * SF.constants.SCALE, "画面の外に出た");
}
console.log("OK 位置: 地面と画面端の中にいる");

// 3. キャラごとの動き
const { BUTTON } = SF.input;
const { POSE } = SF.game;
const S = SF.constants.SCALE;

function run(chars, frames, inputFn) {
  const st = newGame(1, chars);
  for (let i = 0; i < frames; i++) SF.game.step(st, inputFn(i, st));
  return st;
}

// 30フレーム右に歩いた距離：リンの方が速い
function walkDist(id) {
  const st = run([id, id], 30, () => [BUTTON.RIGHT, 0]);
  return st.fighters[0].x - newGame(1, [id, id]).fighters[0].x;
}
assert.ok(walkDist("rin") > walkDist("kagetsu"), "リンの方が歩きが速いはず");
console.log(`OK 歩き: 30Fでカゲツ ${walkDist("kagetsu") / S}px、リン ${walkDist("rin") / S}px`);

// ジャンプの高さ：リンの方が高い。着地後は3F動けない
function jumpInfo(id) {
  const st = newGame(1, [id, id]);
  const ground = st.fighters[0].y;
  let top = ground;
  let air = 0;
  for (let i = 0; i < 120; i++) {
    SF.game.step(st, [i === 0 ? BUTTON.JUMP : 0, 0]);
    top = Math.min(top, st.fighters[0].y);
    if (!st.fighters[0].onGround) air++;
  }
  return { height: (ground - top) / S, air };
}
const kj = jumpInfo("kagetsu");
const rj = jumpInfo("rin");
assert.ok(rj.height > kj.height, "リンの方がジャンプが高いはず");
console.log(`OK ジャンプ: カゲツ 高さ${kj.height}px/${kj.air}F、リン 高さ${rj.height}px/${rj.air}F`);

{
  const st = newGame(1);
  const f = st.fighters[0];
  let i = 0;
  SF.game.step(st, [BUTTON.JUMP, 0]);
  while (!f.onGround) SF.game.step(st, [0, 0]);
  assert.strictEqual(f.pose, POSE.LANDING);
  const x = f.x;
  for (i = 0; i < 3; i++) {
    SF.game.step(st, [BUTTON.RIGHT | BUTTON.DOWN, 0]);
    assert.strictEqual(f.pose, POSE.LANDING, "着地後3Fは動けないはず");
  }
  assert.strictEqual(f.x, x, "着地硬直中に動いた");
  SF.game.step(st, [BUTTON.RIGHT, 0]);
  assert.strictEqual(f.pose, POSE.WALK_FORWARD, "4F目からは動けるはず");
  console.log("OK 着地硬直: 着地後3Fは動けない");
}

// ガード：相手と反対の向きで立ちガード、S＋反対でしゃがみガード。空中ではガードしない
{
  const st = newGame(1); // 左のキャラは右向き＝後ろは左（A）
  SF.game.step(st, [BUTTON.LEFT, 0]);
  assert.strictEqual(st.fighters[0].pose, POSE.GUARD_STAND);
  SF.game.step(st, [BUTTON.LEFT | BUTTON.DOWN, 0]);
  assert.strictEqual(st.fighters[0].pose, POSE.GUARD_CROUCH);
  SF.game.step(st, [BUTTON.RIGHT | BUTTON.DOWN, 0]);
  assert.strictEqual(st.fighters[0].pose, POSE.CROUCH);
  // 右のキャラは左向き＝後ろは右（D）
  SF.game.step(st, [0, BUTTON.RIGHT]);
  assert.strictEqual(st.fighters[1].pose, POSE.GUARD_STAND);
  SF.game.step(st, [BUTTON.JUMP | BUTTON.LEFT, 0]);
  SF.game.step(st, [BUTTON.LEFT, 0]);
  assert.strictEqual(st.fighters[0].pose, POSE.JUMP, "空中ではガードできないはず");
  console.log("OK ガード: 立ちガード・しゃがみガードが向きに合わせて出る");
}

// ぶつかり：歩いて近づいても体は重ならない。ジャンプなら飛び越えられる
{
  const st = run(["kagetsu", "rin"], 300, () => [BUTTON.RIGHT, BUTTON.LEFT]);
  const [a, b] = st.fighters;
  const minDist = ((SF.characters.CHARACTERS.kagetsu.width + SF.characters.CHARACTERS.rin.width) / 2) * S;
  assert.ok(b.x - a.x >= minDist, "体が重なった");
  assert.ok(a.x < b.x, "地上ですり抜けた");
  // 右のキャラを端まで下げ、左のキャラが前ジャンプで飛び越える
  const st2 = newGame(1, ["rin", "kagetsu"]);
  for (let i = 0; i < 400; i++) SF.game.step(st2, [i > 200 ? BUTTON.RIGHT : 0, i < 200 ? BUTTON.RIGHT : 0]);
  let crossed = false;
  for (let k = 0; k < 6 && !crossed; k++) {
    for (let i = 0; i < 60; i++) SF.game.step(st2, [(i === 0 ? BUTTON.JUMP : 0) | BUTTON.RIGHT, 0]);
    crossed = st2.fighters[0].x > st2.fighters[1].x;
  }
  assert.ok(crossed, "ジャンプで飛び越えられるはず");
  console.log("OK ぶつかり: 地上では重ならない、ジャンプなら飛び越えられる");
}

// ステップ・ダッシュ・バックステップ：方向キーを素早く2回
{
  // 入力の並び（1要素=1フレーム）を流して、左のキャラの動きを返す
  function play(id, seq, extra = 0) {
    const st = newGame(1, [id, id === "rin" ? "kagetsu" : "rin"]);
    // 相手を端まで離しておく
    st.fighters[1].x = 900 * S;
    st.fighters[0].x = 300 * S;
    const x0 = st.fighters[0].x;
    const poses = [];
    for (let i = 0; i < seq.length + extra; i++) {
      SF.game.step(st, [seq[i] ?? 0, 0]);
      poses.push(st.fighters[0].pose);
    }
    return { dist: (st.fighters[0].x - x0) / S, poses, f: st.fighters[0] };
  }
  const R = BUTTON.RIGHT;
  const L = BUTTON.LEFT;
  const tapTap = (b) => [b, b, 0, 0, b];

  const k = play("kagetsu", tapTap(R), 40);
  assert.ok(k.poses.includes(POSE.STEP), "カゲツは前2回でステップするはず");
  assert.ok(!k.poses.includes(POSE.RUN));
  assert.strictEqual(k.poses.at(-1), POSE.STAND, "ステップのあとは立ちに戻るはず");
  // 押しっぱなしでも距離は同じ（決まった距離だけ踏み込む）
  const kHold = play("kagetsu", [...tapTap(R), ...Array(40).fill(R)], 0);
  assert.ok(kHold.poses.includes(POSE.STEP));

  const rShort = play("rin", tapTap(R), 40);
  const rLong = play("rin", [...tapTap(R), ...Array(40).fill(R)], 40);
  assert.ok(rShort.poses.includes(POSE.RUN), "リンは前2回でダッシュするはず");
  assert.ok(rLong.dist > rShort.dist + 150, "リンは押している間ずっと走るはず");
  assert.strictEqual(rLong.poses.at(-1), POSE.STAND);

  const kb = play("kagetsu", tapTap(L), 40);
  const rb = play("rin", tapTap(L), 40);
  assert.ok(kb.poses.includes(POSE.BACKSTEP) && rb.poses.includes(POSE.BACKSTEP), "後ろ2回でバックステップ");
  assert.ok(kb.dist < -50 && rb.dist < -50, "バックステップで下がるはず");

  // ゆっくり2回押しても出ない
  const slow = play("kagetsu", [R, 0, ...Array(20).fill(0), R], 10);
  assert.ok(!slow.poses.includes(POSE.STEP), "ゆっくり2回ではステップしないはず");

  // ステップ中はガードできない
  const noGuard = play("kagetsu", [...tapTap(R), L, L, L], 0);
  assert.strictEqual(noGuard.poses.at(-1), POSE.STEP, "ステップ中はガードできないはず");

  console.log(
    `OK ステップ: カゲツ ステップ${k.dist}px / リン ダッシュ 短く${rShort.dist}px・長く${rLong.dist}px / バックステップ カゲツ${kb.dist}px・リン${rb.dist}px`,
  );
}

// 4. 戦い：攻撃・ガード・体力・ラウンド
const CH = SF.characters.CHARACTERS;
const U = BUTTON.LIGHT;
const I = BUTTON.HEAVY;
const D = BUTTON.DOWN;

// 2人を近くに並べた試合を作る（左が攻める側）
function closeGame(att, def, gap = 70) {
  const st = newGame(1, [att, def]);
  st.fighters[0].x = 400 * S;
  st.fighters[1].x = (400 + gap) * S;
  return st;
}

// 地上技を当てて（ガードさせて）、そのあと両者が次に技を出せたフレームの差＝硬直差を測る
function measureAdvantage(att, def, moveName, blocking) {
  const m = CH[att].moves[moveName];
  const crouchMove = moveName.startsWith("crouch");
  const btn = moveName.endsWith("Heavy") ? I : U;
  const st = closeGame(att, def);
  const [a, b] = st.fighters;
  // 守る側の構え：ガードなら後ろ（右側のキャラは右＝D）、下段ならしゃがみガード
  const guard = blocking ? BUTTON.RIGHT | (m.guard === "low" ? D : 0) : 0;
  let hitAt = -1;
  const healthBefore = b.health;
  let damage = 0;
  let result = null;
  const startA = [];
  const startB = [];
  for (let i = 0; i < 120; i++) {
    const after = hitAt >= 0;
    // 当たったあとは両者とも毎フレーム「ジャンプを押した瞬間」にして、動けるようになった瞬間を調べる
    // （攻撃の連打だと、先に動けた側の攻撃が当たって測れなくなるため）
    const mash = after ? BUTTON.JUMP : 0;
    if (after) {
      a.prevInput &= ~BUTTON.JUMP;
      b.prevInput &= ~BUTTON.JUMP;
    }
    const inA = (i === 0 ? btn : 0) | (crouchMove ? D : 0) | mash;
    const inB = guard | mash;
    SF.game.step(st, [inA, inB]);
    if (!after && a.moveHit) {
      hitAt = i;
      result = b.pose;
      damage = healthBefore - b.health;
    } else if (after) {
      if (!a.onGround && startA.length === 0) startA.push(i);
      if (!b.onGround && startB.length === 0) startB.push(i);
    }
  }
  assert.ok(hitAt >= 0, `${att}の${m.name}が当たらない`);
  // 押したフレームを1F目として、発生のフレームに当たる
  assert.strictEqual(hitAt + 1, m.startup, `${m.name}の発生が違う`);
  return { adv: startB[0] - startA[0], result, damage, b };
}

for (const att of ["kagetsu", "rin"]) {
  const def = att === "kagetsu" ? "rin" : "kagetsu";
  const lines = [];
  for (const name of ["standLight", "standHeavy", "crouchLight", "crouchHeavy"]) {
    const m = CH[att].moves[name];
    const hit = measureAdvantage(att, def, name, false);
    const block = measureAdvantage(att, def, name, true);
    assert.strictEqual(hit.damage, m.damage, `${m.name}のダメージが違う`);
    if (m.hitAdv === "down") {
      assert.strictEqual(hit.result, POSE.DOWN, `${m.name}はダウンするはず`);
    } else {
      assert.strictEqual(hit.result, POSE.HIT);
      assert.strictEqual(hit.adv, m.hitAdv, `${m.name}のヒット時の硬直差が違う`);
    }
    assert.strictEqual(block.result, POSE.BLOCK, `${m.name}をガードできるはず`);
    assert.strictEqual(block.damage, 0, "ガードしたらダメージは0のはず");
    assert.strictEqual(block.adv, m.blockAdv, `${m.name}のガード時の硬直差が違う`);
    lines.push(`${m.name} ${m.hitAdv === "down" ? "ダウン" : (hit.adv > 0 ? "+" : "") + hit.adv}/${block.adv > 0 ? "+" : ""}${block.adv}`);
  }
  console.log(`OK 発生・ダメージ・硬直差（ヒット/ガード）${CH[att].name}: ${lines.join("、")}`);
}

// 上段・下段：下段は立ちガードでは防げない。しゃがみガードなら防げる
{
  function lowVs(guardInput) {
    const st = closeGame("rin", "kagetsu");
    for (let i = 0; i < 30; i++) SF.game.step(st, [D | (i === 0 ? U : 0), guardInput]);
    return st.fighters[1];
  }
  assert.notStrictEqual(lowVs(BUTTON.RIGHT).health, CH.kagetsu.health, "下段は立ちガードで防げないはず");
  assert.strictEqual(lowVs(BUTTON.RIGHT | D).health, CH.kagetsu.health, "下段はしゃがみガードで防げるはず");
  console.log("OK 下段: 立ちガードでは当たり、しゃがみガードで防げる");
}

// 空中攻撃：立ちガードで防げる。しゃがみガードでは防げない。1回のジャンプで1回だけ
function jumpIn(guardInput, att = "kagetsu", btn = U, pressAt = 22) {
  const st = newGame(1, [att, "rin"]);
  st.fighters[0].x = 330 * S;
  st.fighters[1].x = 450 * S;
  let attacks = 0;
  for (let i = 0; i < 70; i++) {
    const inA = (i === 0 ? BUTTON.JUMP | BUTTON.RIGHT : 0) | (i === pressAt || i === pressAt + 6 ? btn : 0);
    SF.game.step(st, [inA, guardInput]);
    if (st.fighters[0].move && st.fighters[0].moveFrame === 1) attacks++;
  }
  return { def: st.fighters[1], attacks };
}
{
  const standG = jumpIn(BUTTON.RIGHT);
  const crouchG = jumpIn(BUTTON.RIGHT | D);
  const none = jumpIn(0);
  assert.strictEqual(standG.def.health, CH.rin.health, "空中攻撃は立ちガードで防げるはず");
  assert.ok(crouchG.def.health < CH.rin.health, "空中攻撃はしゃがみガードで防げないはず");
  assert.ok(none.def.health < CH.rin.health, "空中攻撃が当たらない");
  assert.strictEqual(none.attacks, 1, "空中攻撃は1回のジャンプで1回だけのはず");
  console.log("OK 空中攻撃: 立ちガードで防げ、しゃがみガードでは当たる。1ジャンプ1回");
}

// ダウン中は攻撃が当たらない
{
  const st = closeGame("kagetsu", "rin");
  for (let i = 0; i < 20; i++) SF.game.step(st, [D | (i === 0 ? I : 0), 0]);
  const b = st.fighters[1];
  assert.strictEqual(b.pose, POSE.DOWN);
  const hp = b.health;
  st.fighters[0].x = b.x - 70 * S;
  for (let i = 0; i < 20; i++) SF.game.step(st, [i === 0 ? U : 0, 0]);
  assert.strictEqual(b.health, hp, "ダウン中に攻撃が当たった");
  for (let i = 0; i < 60; i++) SF.game.step(st, [0, 0]);
  assert.strictEqual(b.pose, POSE.STAND, "しばらくすると起き上がるはず");
  console.log("OK ダウン: 倒れている間は当たらず、起き上がる");
}

// ラウンド：体力0でKO、2本先取で試合終了
{
  const { PHASE } = SF.game;
  const st = SF.game.createGame(1, ["kagetsu", "rin"]);
  assert.strictEqual(st.round.phase, PHASE.INTRO);
  for (let i = 0; i < 10; i++) SF.game.step(st, [BUTTON.RIGHT, 0]);
  assert.strictEqual(st.fighters[0].pose, POSE.STAND, "開始の表示中は動けないはず");
  // 2ラウンドとも、リンの体力を1発で倒せるところまで減らしてから大振り斬り
  for (let round = 1; round <= 2; round++) {
    while (st.round.phase !== PHASE.FIGHT) SF.game.step(st, [0, 0]);
    assert.strictEqual(st.round.number, round);
    st.fighters[1].health = 50;
    st.fighters[0].x = 400 * S;
    st.fighters[1].x = 480 * S;
    for (let i = 0; i < 40 && st.round.phase === PHASE.FIGHT; i++) SF.game.step(st, [i === 0 ? I : 0, 0]);
    assert.strictEqual(st.round.phase, PHASE.ROUND_END, "体力0でラウンドが終わるはず");
    assert.strictEqual(st.round.winner, 0);
    assert.strictEqual(st.round.reason, "ko");
  }
  for (let i = 0; i < 200; i++) SF.game.step(st, [0, 0]);
  assert.strictEqual(st.round.phase, PHASE.MATCH_END, "2本取ったら試合終了のはず");
  assert.strictEqual(st.round.matchWinner, 0);
  console.log("OK ラウンド: 体力0でKO、2本先取で試合終了");

  // 時間切れ：体力の割合が多い方の勝ち。同じなら引き分けで両方に1本
  const t = newGame(1, ["kagetsu", "rin"]);
  t.fighters[0].health = 600; // 60%
  t.fighters[1].health = 450; // 50%
  for (let i = 0; i < 60 * 60; i++) SF.game.step(t, [0, 0]);
  assert.strictEqual(t.round.phase, PHASE.ROUND_END, "60秒で時間切れのはず");
  assert.strictEqual(t.round.reason, "time");
  assert.strictEqual(t.round.winner, 0);
  const d = newGame(1, ["kagetsu", "rin"]);
  for (let i = 0; i < 60 * 60; i++) SF.game.step(d, [0, 0]);
  assert.strictEqual(d.round.winner, "draw");
  assert.deepStrictEqual(d.round.wins, [1, 1]);
  console.log("OK 制限時間: 60秒で時間切れ、体力が多い方の勝ち、同じなら両方に1本");
}

// 練習相手：ガードの設定なら攻撃を防ぎ、攻撃の設定なら攻撃してくる
{
  function withDummy(mode, frames, p1) {
    const st = newGame(7, ["rin", "kagetsu"]);
    st.fighters[0].x = 380 * S;
    st.fighters[1].x = 460 * S;
    const d = SF.dummy.createDummy();
    d.mode = SF.dummy.MODES.findIndex((m) => m.id === mode);
    for (let i = 0; i < frames; i++) SF.game.step(st, [p1(i), SF.dummy.input(d, st, 1)]);
    return st;
  }
  const g = withDummy("guardStand", 60, (i) => (i === 0 ? U : 0));
  assert.strictEqual(g.fighters[1].health, CH.kagetsu.health, "立ちガードの練習相手が防がない");
  const gl = withDummy("guardStand", 60, (i) => D | (i === 0 ? U : 0));
  assert.ok(gl.fighters[1].health < CH.kagetsu.health, "立ちガードの練習相手に下段が当たらない");
  const at = withDummy("attack", 60 * 15, () => 0);
  assert.ok(at.fighters[0].health < CH.rin.health, "攻撃の練習相手が攻撃してこない");
  console.log(`OK 練習相手: ガードする・攻撃してくる（15秒で${CH.rin.health - at.fighters[0].health}ダメージ）`);
}

// 2. 速さ：60秒の試合を100回ぶん、画面なしで進める
const t0 = process.hrtime.bigint();
for (let i = 0; i < 100; i++) runMatch(i + 1, 3600);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`OK 速さ: 60秒の試合100回ぶんを ${ms.toFixed(0)} ミリ秒で計算`);
