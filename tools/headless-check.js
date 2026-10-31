// 画面なしで計算部分だけを動かして確かめるスクリプト。
// 使い方: node tools/headless-check.js
//   1. 同じ種と同じ入力なら、何度やっても同じ結果になるか（試合の再現）
//   2. 画面なしでどれくらい速く進められるか
const assert = require("node:assert");
require("../src/core/constants.js");
require("../src/core/rng.js");
require("../src/core/input.js");
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

// 2. 速さ：60秒の試合を100回ぶん、画面なしで進める
const t0 = process.hrtime.bigint();
for (let i = 0; i < 100; i++) runMatch(i + 1, 3600);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`OK 速さ: 60秒の試合100回ぶんを ${ms.toFixed(0)} ミリ秒で計算`);
