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

const SF = globalThis.SF;

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
  const st = SF.game.createGame(1, chars);
  for (let i = 0; i < frames; i++) SF.game.step(st, inputFn(i, st));
  return st;
}

// 30フレーム右に歩いた距離：リンの方が速い
function walkDist(id) {
  const st = run([id, id], 30, () => [BUTTON.RIGHT, 0]);
  return st.fighters[0].x - SF.game.createGame(1, [id, id]).fighters[0].x;
}
assert.ok(walkDist("rin") > walkDist("kagetsu"), "リンの方が歩きが速いはず");
console.log(`OK 歩き: 30Fでカゲツ ${walkDist("kagetsu") / S}px、リン ${walkDist("rin") / S}px`);

// ジャンプの高さ：リンの方が高い。着地後は3F動けない
function jumpInfo(id) {
  const st = SF.game.createGame(1, [id, id]);
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
  const st = SF.game.createGame(1);
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
  const st = SF.game.createGame(1); // 左のキャラは右向き＝後ろは左（A）
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
  const st2 = SF.game.createGame(1, ["rin", "kagetsu"]);
  for (let i = 0; i < 400; i++) SF.game.step(st2, [i > 200 ? BUTTON.RIGHT : 0, i < 200 ? BUTTON.RIGHT : 0]);
  let crossed = false;
  for (let k = 0; k < 6 && !crossed; k++) {
    for (let i = 0; i < 60; i++) SF.game.step(st2, [(i === 0 ? BUTTON.JUMP : 0) | BUTTON.RIGHT, 0]);
    crossed = st2.fighters[0].x > st2.fighters[1].x;
  }
  assert.ok(crossed, "ジャンプで飛び越えられるはず");
  console.log("OK ぶつかり: 地上では重ならない、ジャンプなら飛び越えられる");
}

// 2. 速さ：60秒の試合を100回ぶん、画面なしで進める
const t0 = process.hrtime.bigint();
for (let i = 0; i < 100; i++) runMatch(i + 1, 3600);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`OK 速さ: 60秒の試合100回ぶんを ${ms.toFixed(0)} ミリ秒で計算`);
