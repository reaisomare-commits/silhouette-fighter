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
assert.deepStrictEqual(rj, kj, "ジャンプは2人とも同じはず");
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
function jumpIn(guardInput, att = "kagetsu", btn = U, pressAt = 30) {
  const st = newGame(1, [att, "rin"]);
  st.fighters[0].x = 330 * S;
  st.fighters[1].x = 450 * S;
  let attacks = 0;
  for (let i = 0; i < 100; i++) {
    const inA = (i === 0 ? BUTTON.JUMP | BUTTON.RIGHT : 0) | (i === pressAt || i === pressAt + 6 ? btn : 0);
    SF.game.step(st, [inA, guardInput]);
    const mv = st.fighters[0].move;
    if (mv && mv.startsWith("air") && st.fighters[0].moveFrame === 1) attacks++;
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

// 空中攻撃の硬直差：どの高さで当てても表どおり
{
  function airAdv(att, btn, pressAt, blocking) {
    const st = newGame(1, [att, att === "rin" ? "kagetsu" : "rin"]);
    const [a, b] = st.fighters;
    a.x = 300 * S;
    b.x = 430 * S;
    let hitAt = -1;
    let pose = null;
    let sa = -1;
    let sb = -1;
    let landedA = false;
    let airHit = false;
    for (let i = 0; i < 150; i++) {
      const after = hitAt >= 0;
      if (after) {
        a.prevInput &= ~BUTTON.JUMP;
        b.prevInput &= ~BUTTON.JUMP;
      }
      const inA = after ? BUTTON.JUMP : (i === 0 ? BUTTON.JUMP | BUTTON.RIGHT : 0) | (i === pressAt ? btn : 0);
      // ガードは相手が技を出している間だけ（押しっぱなしだと歩いて離れてしまう）
      const inB = (blocking && (a.move || b.pose === POSE.BLOCK) ? BUTTON.RIGHT : 0) | (after ? BUTTON.JUMP : 0);
      SF.game.step(st, [inA, inB]);
      if (!after && a.moveHit) {
        hitAt = i;
        pose = b.pose;
        airHit = a.move.startsWith("air");
        // 当たった直後の入力では先行入力が入らないよう、ここで消しておく
        a.buffer = null;
        b.buffer = null;
      } else if (after) {
        // 攻めた側は一度着地してから、次に跳んだフレーム
        if (a.onGround) landedA = true;
        if (sa < 0 && landedA && !a.onGround) sa = i;
        if (sb < 0 && !b.onGround) sb = i;
      }
    }
    return { hitAt, pose, adv: sb - sa, airHit };
  }
  const out = [];
  for (const att of ["kagetsu", "rin"]) {
    for (const [name, btn] of [["airLight", U], ["airHeavy", I]]) {
      const m = CH[att].moves[name];
      // ボタンを押すフレームをずらして、高い所から低い所まで当ててみる
      const res = [];
      for (let pressAt = 1; pressAt < 50; pressAt++) {
        const h = airAdv(att, btn, pressAt, false);
        const g = airAdv(att, btn, pressAt, true);
        if (h.hitAt < 0 || g.hitAt < 0 || !h.airHit || !g.airHit || h.pose !== POSE.HIT || g.pose !== POSE.BLOCK) continue;
        res.push({ pressAt, hit: h.adv, block: g.adv });
      }
      assert.ok(res.length >= 3, `${CH[att].name}の${m.name}が当たらない`);
      const low = res.at(-1);
      const high = res[0];
      // 低い所で当てたら表どおり。高い所で当てたら有利が減る。遅く当てるほど有利は減らない
      assert.strictEqual(low.hit, m.hitAdv, `${CH[att].name}の${m.name}（低い所）のヒット時の硬直差が違う`);
      assert.strictEqual(low.block, m.blockAdv, `${CH[att].name}の${m.name}（低い所）のガード時の硬直差が違う`);
      assert.ok(high.hit < m.hitAdv - 5, `${CH[att].name}の${m.name}は高い所で当てると有利が減るはず`);
      // ジャンプしてすぐ出して当てても、着地して出した弱攻撃は間に合わない（連続技にならない）
      assert.ok(high.hit < CH[att].moves.standLight.startup, `${CH[att].name}の${m.name}を高い所で当てても連続技にならないはず`);
      for (let i = 1; i < res.length; i++) assert.ok(res[i].hit >= res[i - 1].hit, "遅く当てた方が有利が減った");
      out.push(`${CH[att].name}${m.name} 高い所${high.hit > 0 ? "+" : ""}${high.hit}〜低い所+${low.hit}`);
    }
  }
  console.log(`OK 空中攻撃の硬直差（ヒット時、低い所で当てると表どおり）: ${out.join("、")}`);
}

// ガードしたら守った側は下がらず、攻めた側が下がる（影縫い）
{
  const st = closeGame("kagetsu", "rin");
  const [a, b] = st.fighters;
  const ax = a.x;
  const bx = b.x;
  for (let i = 0; i < 40; i++) SF.game.step(st, [i === 0 ? I : 0, BUTTON.RIGHT]);
  assert.strictEqual(b.pose === POSE.BLOCK || b.health === CH.rin.health, true);
  assert.strictEqual(b.health, CH.rin.health);
  // ガード中は後ろを押していても下がらない（ガードが終わったあと歩いて下がる分は除く）
  const st2 = closeGame("kagetsu", "rin");
  let blockedX = null;
  for (let i = 0; i < 40; i++) {
    SF.game.step(st2, [i === 0 ? I : 0, BUTTON.RIGHT]);
    if (st2.fighters[1].pose === POSE.BLOCK) {
      if (blockedX === null) blockedX = st2.fighters[1].x;
      assert.strictEqual(st2.fighters[1].x, blockedX, "ガード中に後ろに下がった");
    }
  }
  assert.ok(blockedX !== null, "ガードが成立しない");
  assert.ok(st2.fighters[0].x < 400 * S, "ガードされたら攻めた側が下がるはず");
  console.log(`OK 影縫い: ガードした側はその場に残り、攻めた側が${(400 * S - st2.fighters[0].x) / S}px下がる`);
}

// 影縫い：技の影縫い範囲に入っていると、後ろを押しても下がらずガードできる
{
  // カゲツの大振り斬りの先端ぎりぎりにリンを置き、ボタンを押した瞬間からリンが後ろを押し続ける
  function stitch(gap) {
    const st = closeGame("kagetsu", "rin", gap);
    let blocked = false;
    let pinned = false;
    for (let i = 0; i < 30; i++) {
      SF.game.step(st, [i === 0 ? I : 0, BUTTON.RIGHT]);
      if (st.fighters[1].pose === POSE.BLOCK) blocked = true;
      if (st.fighters[1].pinned) pinned = true;
    }
    return { blocked, pinned, hp: st.fighters[1].health, x: st.fighters[1].x };
  }
  const reach = CH.kagetsu.moves.standHeavy.hitbox.x2 + CH.rin.width / 2;
  const edge = stitch(reach - 5);
  assert.ok(edge.pinned && edge.blocked, "先端ぎりぎりでも影縫いでガードになるはず");
  assert.strictEqual(edge.hp, CH.rin.health);
  // 影縫い範囲の外なら、ふつうに後ろに歩いて下がれる
  const far = stitch(reach + SF.characters.BATTLE.shadowStitchX + 20);
  assert.ok(!far.pinned && !far.blocked, "影縫い範囲の外では下がれるはず");
  console.log("OK 影縫い範囲: 技の先端ぎりぎりでも下がらずガード、範囲の外では下がれる");
}

// 先行入力：硬直中に押したボタンは、動けるようになった最初のフレームで出る。最後に押したものが優先
{
  function bufferTest(seq) {
    const st = newGame(1, ["kagetsu", "rin"]); // 離れているので空振り
    const a = st.fighters[0];
    const m = CH.kagetsu.moves.standLight;
    const total = m.startup - 1 + m.active + m.recovery;
    let second = null;
    let at = -1;
    for (let i = 0; i < 40; i++) {
      SF.game.step(st, [seq[i] || 0, 0]);
      if (i > 0 && a.move && a.moveFrame === 1 && at < 0) {
        at = i;
        second = a.move;
      }
    }
    return { at, second, total };
  }
  const seq1 = [U];
  seq1[5] = I;
  seq1[8] = U; // 最後に押したのは U
  const r1 = bufferTest(seq1);
  assert.strictEqual(r1.second, "standLight", "最後に押した弱攻撃が出るはず");
  assert.strictEqual(r1.at, r1.total, "動けるようになった最初のフレームで出るはず");
  const seq2 = [U];
  seq2[3] = U;
  seq2[9] = I; // 最後に押したのは I
  const r2 = bufferTest(seq2);
  assert.strictEqual(r2.second, "standHeavy", "最後に押した強攻撃が出るはず");
  assert.strictEqual(r2.at, r2.total);
  console.log(`OK 先行入力: 硬直中に押した最後のボタンが最速（${r1.total + 1}F目）で出る`);
}

// 先行入力：硬直中に方向キーを2回押すと、動けるようになった最初のフレームでステップ・ダッシュ・バックステップが出る
{
  const R = BUTTON.RIGHT;
  const L = BUTTON.LEFT;
  for (const [id, dir, expect] of [
    ["kagetsu", R, POSE.STEP],
    ["rin", R, POSE.RUN],
    ["kagetsu", L, POSE.BACKSTEP],
  ]) {
    const st = newGame(1, [id, "rin"]);
    const a = st.fighters[0];
    const mt = CH[id].moves.standLight;
    const tot = mt.startup - 1 + mt.active + mt.recovery;
    // 弱攻撃の硬直中（終わる少し前）に方向キーを2回押す。ダッシュは押しっぱなしにする
    const seq = [U];
    seq[tot - 5] = dir;
    seq[tot - 3] = dir;
    for (let i = tot - 2; i < tot + 5; i++) seq[i] = dir;
    let at = -1;
    for (let i = 0; i < tot + 5; i++) {
      SF.game.step(st, [seq[i] || 0, 0]);
      if (at < 0 && a.pose === expect) at = i;
    }
    assert.strictEqual(at, tot, `${CH[id].name}: 硬直明けの最初のフレームで${expect}が出るはず`);
  }
  console.log("OK 先行入力（移動）: 硬直中の2回押しで、硬直明けすぐにステップ・ダッシュ・バックステップが出る");
}

// 空中攻撃から地上の弱攻撃がつながる（相手が動けるようになる前に当たる）
{
  for (const att of ["kagetsu", "rin"]) {
    const st = newGame(1, [att, att === "rin" ? "kagetsu" : "rin"]);
    const [a, b] = st.fighters;
    a.x = 330 * S;
    b.x = 430 * S;
    let hits = 0;
    let freeBetween = false;
    for (let i = 0; i < 110; i++) {
      // ジャンプ強攻撃のあと、着地前に弱攻撃を連打（先行入力）
      const inA = (i === 0 ? BUTTON.JUMP | BUTTON.RIGHT : 0) | (i === 26 ? I : 0) | (i > 30 && i % 2 === 0 ? U : 0);
      const before = b.health;
      SF.game.step(st, [inA, 0]);
      if (b.health < before) hits++;
      if (hits === 1 && SF.game.isFree(b) && b.onGround) freeBetween = true;
      if (hits >= 2) break;
    }
    assert.ok(hits >= 2, `${CH[att].name}: 空中攻撃のあとの弱攻撃が当たらない`);
    assert.ok(!freeBetween, `${CH[att].name}: 空中攻撃から弱攻撃がつながらない`);
  }
  console.log("OK 連続技: ジャンプ強攻撃 → 着地して弱攻撃 がつながる（両キャラ）");
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

// 5. 必殺技・キャンセル・連続技・コンボ補正・投げ
const O = BUTTON.SPECIAL;
const BT = SF.characters.BATTLE;

// 必殺技を当てて（ガードさせて）硬直差・ダメージ・削りを測る。gap は2人の間の距離
function measureSpecial(att, def, name, blocking, gap = 70) {
  const m = CH[att].moves[name];
  const st = closeGame(att, def, gap);
  const [a, b] = st.fighters;
  const guard = blocking ? BUTTON.RIGHT : 0;
  const hp0 = b.health;
  let hitAt = -1;
  let result = null;
  let damage = 0;
  let sa = -1;
  let sb = -1;
  for (let i = 0; i < 200; i++) {
    const after = hitAt >= 0;
    if (after) {
      a.prevInput &= ~BUTTON.JUMP;
      b.prevInput &= ~BUTTON.JUMP;
    }
    const inA = after ? BUTTON.JUMP : (i === 0 ? O : 0) | (name === "crouchSpecial" ? D : 0);
    // ガードは当たる直前から（早くから後ろを押すと歩いて下がり、距離が変わってしまうため）
    const nearHit = i >= m.startup - 2 && (a.move || st.projectiles.length);
    const inB = (after ? BUTTON.JUMP : 0) | (!after && nearHit ? guard : 0) | (after && b.pose === POSE.BLOCK ? guard : 0);
    SF.game.step(st, [inA, inB]);
    if (!after && (b.pose === POSE.HIT || b.pose === POSE.BLOCK || b.pose === POSE.DOWN)) {
      hitAt = i;
      result = b.pose;
      damage = hp0 - b.health;
      a.buffer = null;
      b.buffer = null;
    } else if (after) {
      if (sa < 0 && !a.onGround) sa = i;
      if (sb < 0 && !b.onGround) sb = i;
    }
  }
  assert.ok(hitAt >= 0, `${CH[att].name}の${m.name}が当たらない`);
  return { hitAt, result, damage, adv: sb - sa };
}

for (const att of ["kagetsu", "rin"]) {
  const def = att === "kagetsu" ? "rin" : "kagetsu";
  const lines = [];
  for (const name of ["special", "crouchSpecial"]) {
    const m = CH[att].moves[name];
    const hit = measureSpecial(att, def, name, false);
    const block = measureSpecial(att, def, name, true);
    assert.strictEqual(hit.hitAt + 1, m.startup, `${m.name}の発生が違う`);
    assert.strictEqual(hit.damage, m.damage, `${m.name}のダメージが違う`);
    if (m.hitAdv === "down") assert.strictEqual(hit.result, POSE.DOWN, `${m.name}はダウンするはず`);
    else assert.strictEqual(hit.adv, m.hitAdv, `${m.name}のヒット時の硬直差が違う`);
    assert.strictEqual(block.result, POSE.BLOCK, `${m.name}をガードできるはず`);
    assert.strictEqual(block.adv, m.blockAdv, `${m.name}のガード時の硬直差が違う`);
    assert.strictEqual(block.damage, Math.floor(m.damage / 10), `${m.name}の削りダメージが違う`);
    lines.push(`${m.name} 発生${m.startup}F ${m.hitAdv === "down" ? "ダウン" : "+" + hit.adv}/${block.adv} 削り${block.damage}`);
  }
  console.log(`OK 必殺技 ${CH[att].name}: ${lines.join("、")}`);
}

// 飛刃：離れて当てるほど有利。画面に1つまで
{
  const near = measureSpecial("kagetsu", "rin", "special", true);
  const far = measureSpecial("kagetsu", "rin", "special", true, 350);
  assert.ok(far.adv > near.adv, "飛刃は離れて当てるほど有利なはず");
  const st = newGame(1, ["kagetsu", "rin"]);
  st.fighters[0].x = 100 * S;
  st.fighters[1].x = 900 * S;
  const tot = CH.kagetsu.moves.special.startup - 1 + CH.kagetsu.moves.special.active + CH.kagetsu.moves.special.recovery;
  let second = false;
  for (let i = 0; i < tot + 10; i++) {
    SF.game.step(st, [i === 0 || i === tot + 2 ? O : 0, 0]);
    if (i > tot && st.fighters[0].move === "special") second = true;
  }
  assert.strictEqual(st.projectiles.length, 1, "飛刃は画面に1つまで");
  assert.ok(!second, "飛刃が画面にあるときは2発目が出ないはず");
  console.log(`OK 飛刃: 目の前でガードさせて${near.adv}、離れてガードさせて${far.adv}。画面に1つまで`);
}

// 連続技を入れて、合計ダメージと「途中で相手が動けなかったか」を調べる。
// steps は [技の名前, 次に押すボタン] の並び。前の技が当たったら次のボタンを押す
function combo(att, def, first, steps, gap = 60, guard = 0) {
  const st = closeGame(att, def, gap);
  const [a, b] = st.fighters;
  const hp0 = b.health;
  let k = 0;
  let started = false;
  let maxHits = 0;
  const used = [];
  let held = first & D; // しゃがみ（S）は押したままにする
  let ready = false;
  for (let i = 0; i < 150; i++) {
    let inA = (i === 0 ? first : 0) | held;
    // 前のボタンで出た技が当たってから、次のボタンを押す
    if (ready && k < steps.length && a.move === steps[k][0] && a.moveHit) {
      inA = steps[k][1];
      held = steps[k][1] & D;
      a.prevInput &= D;
      k++;
      ready = false;
    }
    SF.game.step(st, [inA, guard]);
    if (a.move && a.moveFrame === 1) {
      used.push(a.move);
      ready = true;
    }
    if (b.health < hp0) started = true;
    if (st.comboInfo[0]) maxHits = Math.max(maxHits, st.comboInfo[0].hits);
  }
  return { damage: hp0 - b.health, hits: maxHits, used, b, st };
}
{
  const r1 = combo("kagetsu", "rin", I, [["standHeavy", D | O]], 80);
  assert.deepStrictEqual(r1.used, ["standHeavy", "crouchSpecial"]);
  assert.strictEqual(r1.hits, 2, "大振り斬り → 昇り斬り がつながるはず");
  assert.strictEqual(r1.damage, 190, "大振り斬り → 昇り斬り は190のはず");
  const r2 = combo("kagetsu", "rin", U, [["standLight", I], ["standHeavy", O]]);
  assert.deepStrictEqual(r2.used, ["standLight", "standHeavy", "special"]);
  assert.strictEqual(r2.hits, 3, "柄打ち → 大振り斬り → 飛刃 がつながるはず");
  assert.strictEqual(r2.damage, 40 + 90 + 64);
  const r3 = combo("rin", "kagetsu", U, [["standLight", U], ["standLight", I], ["standHeavy", O]], 55);
  assert.deepStrictEqual(r3.used, ["standLight", "standLight", "standHeavy", "special"]);
  assert.strictEqual(r3.hits, 4, "ジャブ → ジャブ → 回し蹴り → 突進拳 がつながるはず");
  assert.strictEqual(r3.damage, 177, "ジャブ → ジャブ → 回し蹴り → 突進拳 は177のはず");
  // しゃがみの U からも
  const r4 = combo("rin", "kagetsu", D | U, [["crouchLight", D | U], ["crouchLight", D | I]], 55);
  assert.deepStrictEqual(r4.used, ["crouchLight", "crouchLight", "crouchHeavy"]);
  assert.strictEqual(r4.hits, 3, "小足 → 小足 → 足払い がつながるはず");
  console.log(`OK 連続技とコンボ補正: カゲツ 大振り斬り→昇り斬り ${r1.damage}、柄打ち→大振り斬り→飛刃 ${r2.damage}、リン ジャブ→ジャブ→回し蹴り→突進拳 ${r3.damage}、小足→小足→足払い ${r4.damage}`);

  // ガードされてもキャンセルできる。ガードさせた必殺技は不利
  const g = combo("kagetsu", "rin", U, [["standLight", O]], 60, BUTTON.RIGHT);
  assert.deepStrictEqual(g.used, ["standLight", "special"], "ガードされた柄打ちから飛刃が出るはず");
  console.log("OK キャンセル: ガードされた通常技からも必殺技が出る");
}
// つなげられない組み合わせ：カゲツの U → U、I → I、リンの U → U → U、空振りからのキャンセル
{
  // 1つ目の技の途中で2つ目の技が出たか（＝キャンセル・連続技になったか）
  function cancels(att, firstBtn, secondBtn, from, gap = 60) {
    const st = closeGame(att, att === "rin" ? "kagetsu" : "rin", gap);
    const a = st.fighters[0];
    const tot = (m) => m.startup - 1 + m.active + m.recovery;
    let pressed = false;
    let prevFrame = 0;
    let count = 0;
    let result = null;
    for (let i = 0; i < 80 && result === null; i++) {
      let inA = i === 0 ? firstBtn : 0;
      if (!pressed && a.move === from && (a.moveHit || gap > 200) && a.moveFrame >= 7) {
        inA = secondBtn;
        a.prevInput = 0;
        pressed = true;
      }
      prevFrame = a.move === from ? a.moveFrame : prevFrame;
      SF.game.step(st, [inA, 0]);
      if (a.moveFrame === 1 && a.move && ++count === 2) result = prevFrame < tot(CH[att].moves[from]);
    }
    assert.ok(result !== null, "2つ目の技が出ない");
    return result;
  }
  assert.ok(!cancels("kagetsu", U, U, "standLight"), "カゲツは U → U をつなげないはず");
  assert.ok(!cancels("kagetsu", I, I, "standHeavy"), "I → I はつなげないはず");
  assert.ok(cancels("rin", U, U, "standLight", 55), "リンは U → U をつなげるはず");
  assert.ok(cancels("kagetsu", U, O, "standLight"), "当たった柄打ちから飛刃が出るはず");
  assert.ok(!cancels("kagetsu", U, O, "standLight", 400), "空振りした技からはキャンセルできないはず");
  assert.ok(!cancels("kagetsu", D | I, O, "crouchHeavy"), "カゲツの S+I はキャンセルできないはず");
  assert.ok(!cancels("rin", D | I, O, "crouchHeavy", 55), "リンの S+I はキャンセルできないはず");
  // リンの U → U → U は3回目が途中から出ない（2回目を最後まで出しきってから出る）
  {
    const st = closeGame("rin", "kagetsu", 55);
    const a = st.fighters[0];
    const jab = CH.rin.moves.standLight;
    let lights = 0;
    let prevFrame = 0;
    let thirdCanceled = null;
    for (let i = 0; i < 80 && thirdCanceled === null; i++) {
      let inA = i === 0 ? U : 0;
      if (a.move === "standLight" && a.moveHit && a.moveFrame >= 5) {
        inA = U;
        a.prevInput = 0;
      }
      prevFrame = a.move === "standLight" ? a.moveFrame : prevFrame;
      SF.game.step(st, [inA, 0]);
      if (a.move === "standLight" && a.moveFrame === 1 && ++lights === 3) {
        thirdCanceled = prevFrame < jab.startup - 1 + jab.active + jab.recovery;
      }
    }
    assert.strictEqual(thirdCanceled, false, "リンの U → U → U の3回目はつながらないはず");
  }
  console.log("OK キャンセルできない組み合わせ: カゲツ U→U、I→I、リン U→U→U、S+I から必殺技、空振りから必殺技 はつながらない");
}
// コンボ補正の割合
{
  const rates = [];
  for (let n = 1; n <= 12; n++) rates.push(SF.game.comboRate(n));
  assert.deepStrictEqual(rates, [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 10, 10]);
  console.log(`OK コンボ補正: ${rates.join("%→")}%`);
}

// 投げ
{
  // 2人を並べて投げる。techAt＝投げが決まってから何フレーム目に相手がU＋Iを押すか（null＝押さない）
  function throwTest(att, def, gap, { techAt = null, defInput = 0, delay = 0 } = {}) {
    const st = closeGame(att, def, gap);
    const [a, b] = st.fighters;
    let grabbedAt = -1;
    let result = null;
    for (let i = 0; i < 70; i++) {
      let inA = i === 0 ? U : 0;
      if (i === delay) inA |= I;
      if (i < delay) inA |= U;
      let inB = defInput;
      if (grabbedAt >= 0 && techAt !== null && i - grabbedAt === techAt) inB = U | I;
      SF.game.step(st, [inA, inB]);
      if (grabbedAt < 0 && b.pose === POSE.THROWN) grabbedAt = i;
      if (result === null && grabbedAt >= 0 && b.pose !== POSE.THROWN) result = b.pose;
    }
    return { grabbedAt, result, damage: CH[def].health - b.health, a, b, st };
  }
  for (const [att, def] of [["kagetsu", "rin"], ["rin", "kagetsu"]]) {
    const m = CH[att].moves.throw;
    const t = throwTest(att, def, 60, { defInput: BUTTON.RIGHT });
    assert.strictEqual(t.grabbedAt + 1, m.startup, `${CH[att].name}の投げの発生が違う`);
    assert.strictEqual(t.result, POSE.DOWN, "投げはガードできずダウンするはず");
    assert.strictEqual(t.damage, m.damage, "投げのダメージが違う");
    const in8 = throwTest(att, def, 60, { techAt: BT.throwTechWindow });
    assert.strictEqual(in8.result, POSE.TECH, "8F目のU＋Iで投げ抜けできるはず");
    assert.strictEqual(in8.damage, 0, "投げ抜けしたらダメージなし");
    const in9 = throwTest(att, def, 60, { techAt: BT.throwTechWindow + 1 });
    assert.strictEqual(in9.result, POSE.DOWN, "9F目では投げ抜けできないはず");
    // 1Fずれて押しても同時押し
    const late = throwTest(att, def, 60, { delay: 1 });
    assert.strictEqual(late.result, POSE.DOWN, "UとIが1Fずれても投げになるはず");
  }
  // 投げ抜けしたら五分（同時に動ける）で離れる
  {
    const t = throwTest("kagetsu", "rin", 60, { techAt: 3 });
    const { a, b, st } = t;
    assert.strictEqual(a.stun, b.stun);
    assert.ok(Math.abs(a.x - b.x) > 100 * S, "投げ抜けしたら離れるはず");
  }
  // 掴める範囲：リンの方が広い。どちらも体が触れていなくても届く
  function reach(att, def) {
    let g = 50;
    while (throwTest(att, def, g).grabbedAt >= 0) g++;
    return g - 1;
  }
  const kr = reach("kagetsu", "rin");
  const rr = reach("rin", "kagetsu");
  assert.ok(rr - CH.kagetsu.width / 2 > kr - CH.rin.width / 2, "リンの投げはカゲツより届くはず");
  // ガード硬直・のけぞり中の相手は投げられない
  {
    const st = closeGame("kagetsu", "rin", 70);
    st.fighters[1].pose = POSE.BLOCK;
    st.fighters[1].stun = 30;
    for (let i = 0; i < 10; i++) SF.game.step(st, [i === 0 ? U | I : 0, 0]);
    assert.notStrictEqual(st.fighters[1].pose, POSE.THROWN, "ガード硬直中は投げられないはず");
  }
  // 空振りすると、同じくらいの発生の技より長く動けない
  const lines = [];
  for (const [id, similar] of [["kagetsu", "standLight"], ["rin", "standLight"]]) {
    const st = newGame(1, [id, "rin"]);
    st.fighters[0].x = 100 * S;
    st.fighters[1].x = 900 * S;
    const a = st.fighters[0];
    let free = -1;
    for (let i = 0; i < 60 && free < 0; i++) {
      SF.game.step(st, [i === 0 ? U | I : 0, 0]);
      if (i > 0 && SF.game.isFree(a)) free = i;
    }
    const t = CH[id].moves.throw;
    const s2 = CH[id].moves[similar];
    const total = t.startup - 1 + t.active + t.recovery;
    assert.strictEqual(free, total, "投げの空振りの全体フレームが違う");
    assert.ok(t.recovery > s2.recovery, "投げの空振り硬直は同じくらいの発生の技より長いはず");
    lines.push(`${CH[id].name} 硬直${t.recovery}F（${s2.name}は${s2.recovery}F）`);
  }
  console.log(`OK 投げ: ガードできずダウン、8F以内のU＋Iで投げ抜け（9Fは不可）、掴める距離 カゲツ${kr}px・リン${rr}px、空振り ${lines.join("・")}`);
}

// 練習相手：投げ抜けの設定なら投げ抜けする
{
  const st = closeGame("kagetsu", "rin", 60);
  const d = SF.dummy.createDummy();
  d.mode = SF.dummy.MODES.findIndex((m) => m.id === "guardTech");
  let teched = false;
  for (let i = 0; i < 40; i++) {
    SF.game.step(st, [i === 0 ? U | I : 0, SF.dummy.input(d, st, 1)]);
    if (st.fighters[1].pose === POSE.TECH) teched = true;
  }
  assert.ok(teched, "投げ抜けの練習相手が投げ抜けしない");
  console.log("OK 練習相手: 投げ抜けする設定");
}

// 同時に当たったとき：弱と強なら強だけ、同じ強さなら相打ち、投げと攻撃なら攻撃
{
  // 左（カゲツ）が btnA を0F目に、右（リン）が btnB を delayF目に押す
  function clash(btnA, btnB, delay, gap = 70) {
    const st = closeGame("kagetsu", "rin", gap);
    const [a, b] = st.fighters;
    for (let i = 0; i < 30; i++) SF.game.step(st, [i === 0 ? btnA : 0, i === delay ? btnB : 0]);
    return { a: CH.kagetsu.health - a.health, b: CH.rin.health - b.health, aPose: a.pose, bPose: b.pose };
  }
  const kh = CH.kagetsu.moves.standHeavy.startup;
  const rl = CH.rin.moves.standLight.startup;
  const lh = clash(I, U, kh - rl);
  assert.strictEqual(lh.a, 0, "弱と強が同時なら弱は当たらないはず");
  assert.strictEqual(lh.b, CH.kagetsu.moves.standHeavy.damage, "弱と強が同時なら強が当たるはず");
  const kl = CH.kagetsu.moves.standLight.startup;
  const ll = clash(U, U, kl - rl);
  assert.ok(ll.a > 0 && ll.b > 0, "同じ強さなら相打ちのはず");
  const kt = CH.kagetsu.moves.throw.startup;
  const tl = clash(U | I, U, kt - rl);
  assert.ok(tl.a > 0 && tl.b === 0, "投げと攻撃が同時なら攻撃が勝つはず");
  console.log("OK 同時に当たったとき: 弱と強なら強、同じ強さなら相打ち、投げと攻撃なら攻撃");
}

// 技を出すと、やられる範囲が伸びる。当たる時間は当たる範囲と同じくらい、発生前と硬直中はその半分
{
  const st = closeGame("kagetsu", "rin", 200); // 大振り斬りが届かない距離
  const [a, b] = st.fighters;
  const m = CH.kagetsu.moves.standHeavy;
  const reach = () => {
    const box = SF.game.limbHurtbox(a);
    return box ? Math.round(box.right - a.x / S) : 0;
  };
  const seen = {};
  for (let i = 0; i < 45; i++) {
    // カゲツの大振り斬りが当たる時間に、リンのジャブも当たる時間になるように押す
    SF.game.step(st, [i === 0 ? I : 0, i === m.startup - CH.rin.moves.standLight.startup ? U : 0]);
    if (a.move === "standHeavy" && st.hitstop === 0) {
      const phase = a.moveFrame < m.startup ? "startup" : a.moveFrame < m.startup + m.active ? "active" : "recovery";
      seen[phase] = Math.max(seen[phase] || 0, reach());
    }
  }
  // 体には届かない距離でも、伸ばした腕と刀が触れて、強い大振り斬りの方が当たる
  assert.strictEqual(b.health, CH.rin.health - m.damage, "伸ばしたジャブの腕に大振り斬りが当たるはず");
  assert.strictEqual(a.health, CH.kagetsu.health, "弱と強なら強が勝つはず");
  const half = Math.round((m.hitbox.x1 + m.hitbox.x2) / 2);
  assert.strictEqual(seen.startup, half, "発生前は半分まで伸びるはず");
  // 当たる時間はジャブで潰されるので、そのあと別に確かめる
  const st2 = closeGame("kagetsu", "rin", 300);
  const a2 = st2.fighters[0];
  const r2 = [];
  for (let i = 0; i < 40; i++) {
    SF.game.step(st2, [i === 0 ? I : 0, 0]);
    const box = SF.game.limbHurtbox(a2);
    if (a2.move) r2.push(box ? Math.round(box.right - a2.x / S) : 0);
  }
  assert.ok(r2.includes(m.hitbox.x2), "当たる時間は当たる範囲まで伸びるはず");
  assert.strictEqual(r2.at(-1), half, "硬直中は半分まで伸びるはず");
  // 対空技は上に伸びるやられる範囲が少ない
  for (const id of ["kagetsu", "rin"]) {
    const aa = CH[id].moves.crouchSpecial;
    assert.ok(aa.hurtExtend.y2 < aa.hitbox.y2 - 50, "対空技の上側のやられる範囲は小さいはず");
    assert.ok(aa.hurtExtend.y2 <= CH[id].height, "対空技のやられる範囲は頭の高さまで");
  }
  // 投げ（掴みにいく手）と飛刃（振る刀）にもやられる範囲が伸びる
  for (const [btn, name] of [[U | I, "throw"], [O, "special"]]) {
    const st3 = closeGame("kagetsu", "rin", 300);
    let found = false;
    for (let i = 0; i < 20; i++) {
      SF.game.step(st3, [i === 0 ? btn : 0, 0]);
      if (st3.fighters[0].move === name && SF.game.limbHurtbox(st3.fighters[0])) found = true;
    }
    assert.ok(found, `${name} にもやられる範囲が伸びるはず`);
  }
  console.log(`OK 技のやられる範囲: 発生前・硬直中は${(m.hitbox.x1 + m.hitbox.x2) / 2}px、当たる時間は${m.hitbox.x2}pxまで伸び、伸ばした腕や刀にも当たる。対空技は上側が小さい`);
}

// 6. CPU（よわい・ふつう・つよい・学習AI）
require("../src/core/cpu.js");
require("../src/core/learn.js");
require("../src/core/learned-data.js");
{
  const LV = SF.cpu.LEVELS;
  // CPU同士の試合。同じ種なら同じ結果になり、出す入力はボタンのビットだけ
  function cpuMatch(seed, chars, levels, maxFrames = 60 * 60 * 6) {
    const st = SF.game.createGame(seed, chars);
    const cpus = levels.map((lv, i) => SF.cpu.createCpu(lv, seed * 31 + i));
    for (let n = 0; n < maxFrames && st.round.phase !== SF.game.PHASE.MATCH_END; n++) {
      const ins = [SF.cpu.input(cpus[0], st, 0), SF.cpu.input(cpus[1], st, 1)];
      for (const x of ins) assert.ok(Number.isInteger(x) && x >= 0 && x < 128, "CPUの入力はボタンのビットだけのはず");
      SF.game.step(st, ins);
    }
    return st;
  }
  const m1 = cpuMatch(3, ["kagetsu", "rin"], [1, 1]);
  const m2 = cpuMatch(3, ["kagetsu", "rin"], [1, 1]);
  assert.strictEqual(SF.game.hashState(m1), SF.game.hashState(m2), "同じ種のCPU同士の試合は同じ結果になるはず");
  assert.strictEqual(m1.round.phase, SF.game.PHASE.MATCH_END, "CPU同士の試合が終わらない");

  // 強いCPUは弱いCPUにほとんど勝つ（同じキャラ同士、左右も入れ替える）
  const wins = {};
  for (const [hi, lo] of [[1, 0], [2, 1], [2, 0]]) {
    let w = 0;
    let n = 0;
    for (const id of ["kagetsu", "rin"]) {
      for (let s = 1; s <= 5; s++) {
        w += cpuMatch(s, [id, id], [hi, lo]).round.matchWinner === 0 ? 1 : 0;
        w += cpuMatch(s, [id, id], [lo, hi]).round.matchWinner === 1 ? 1 : 0;
        n += 2;
      }
    }
    wins[`${LV[hi].label}対${LV[lo].label}`] = Math.round((100 * w) / n);
    assert.ok(w / n >= 0.8, `${LV[hi].label}が${LV[lo].label}に勝てていない（${w}/${n}）`);
  }

  // 近づいてきて弱攻撃（下段も）をくり返す相手に、CPUがどれだけガードできるか。
  // CPUが自分の技などで動けないときに来た攻撃は数えない
  function guardRate(lv, low) {
    let hit = 0;
    let block = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const st = newGame(seed, ["rin", "kagetsu"]);
      const cpu = SF.cpu.createCpu(lv, seed);
      const [a, b] = st.fighters;
      let wait = 0;
      let counted = false;
      for (let i = 0; i < 1800; i++) {
        a.health = CH.rin.health;
        b.health = CH.kagetsu.health;
        let inp = low && a.move === "crouchLight" ? D : 0;
        if (SF.game.isFree(a) && a.onGround) {
          if (Math.abs(a.x - b.x) / S > 80) inp = a.facing === 1 ? BUTTON.RIGHT : BUTTON.LEFT;
          else if (wait <= 0) {
            inp = low ? D | U : U;
            wait = 40;
          }
        }
        wait--;
        const before = b.pose;
        const free = SF.game.isFree(b) && b.onGround && !b.move;
        SF.game.step(st, [inp, SF.cpu.input(cpu, st, 1)]);
        if (a.move && a.moveFrame === 1) counted = free;
        if (counted && b.pose === POSE.HIT && before !== POSE.HIT) hit++;
        if (counted && b.pose === POSE.BLOCK && before !== POSE.BLOCK) block++;
      }
    }
    return Math.round((100 * block) / (hit + block));
  }
  const guards = LV.map((_, i) => [guardRate(i, false), guardRate(i, true)]);
  guards.forEach(([mid, lowRate], i) => {
    assert.ok(Math.abs(mid - LV[i].guard) <= 15, `${LV[i].label}のガード率（中段）が表とずれている: ${mid}%`);
    assert.ok(Math.abs(lowRate - LV[i].guard) <= 15, `${LV[i].label}のガード率（下段）が表とずれている: ${lowRate}%`);
  });

  // 投げをくり返す相手に、CPUがどれだけ投げ抜けできるか
  function techRate(lv) {
    let grabs = 0;
    let techs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const st = newGame(seed, ["rin", "kagetsu"]);
      st.fighters[0].x = 420 * S;
      st.fighters[1].x = 470 * S;
      const cpu = SF.cpu.createCpu(lv, seed);
      let grabbed = false;
      for (let i = 0; i < 60; i++) {
        // 投げ抜け以外でCPUがU＋Iを押さないよう、掴まれている間の入力だけ使う
        const cin = SF.cpu.input(cpu, st, 1);
        SF.game.step(st, [i === 0 ? U | I : 0, st.fighters[1].pose === POSE.THROWN ? cin : 0]);
        if (st.fighters[1].pose === POSE.THROWN) grabbed = true;
        if (st.fighters[1].pose === POSE.TECH) {
          techs++;
          break;
        }
      }
      if (grabbed) grabs++;
    }
    return Math.round((100 * techs) / grabs);
  }
  const techs = LV.map((_, i) => techRate(i));
  techs.forEach((r, i) => assert.ok(Math.abs(r - LV[i].tech) <= 15, `${LV[i].label}の投げ抜け率が表とずれている: ${r}%`));
  assert.strictEqual(techs[0], 0, "よわいCPUは投げ抜けしないはず");

  // 前ジャンプで跳び込んでくる相手に、CPUがどれだけ対空技を出すか
  function antiAirRate(lv) {
    let jumps = 0;
    let aa = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const st = newGame(seed, ["rin", "kagetsu"]);
      st.fighters[0].x = 300 * S;
      st.fighters[1].x = 480 * S;
      const cpu = SF.cpu.createCpu(lv, seed);
      jumps++;
      for (let i = 0; i < 70; i++) {
        SF.game.step(st, [i === 0 ? BUTTON.JUMP | BUTTON.RIGHT : 0, SF.cpu.input(cpu, st, 1)]);
        if (st.fighters[1].move === "crouchSpecial") {
          aa++;
          break;
        }
      }
    }
    return Math.round((100 * aa) / jumps);
  }
  const aas = LV.map((_, i) => antiAirRate(i));
  aas.forEach((r, i) => assert.ok(Math.abs(r - LV[i].antiAir) <= 20, `${LV[i].label}の対空を出す率が表とずれている: ${r}%`));

  // 連続技：ジャブが当たったあと、どれだけ最後（突進拳）までつなぐか
  function comboRate(lv) {
    let full = 0;
    const N = 40;
    for (let seed = 1; seed <= N; seed++) {
      const st = newGame(seed, ["rin", "kagetsu"]);
      st.fighters[0].x = 440 * S;
      st.fighters[1].x = 500 * S;
      const cpu = SF.cpu.createCpu(lv, seed);
      // CPUを左に置いて、何もしない相手にジャブを当てさせる
      let usedSpecial = false;
      for (let i = 0; i < 120; i++) {
        const cin = SF.cpu.input(cpu, st, 0);
        SF.game.step(st, [i === 0 ? U : cin & ~(BUTTON.LEFT | BUTTON.RIGHT) & (i < 3 ? 0 : 127), 0]);
        if (st.fighters[0].move === "special") usedSpecial = true;
      }
      if (usedSpecial) full++;
    }
    return Math.round((100 * full) / N);
  }
  const combos = LV.map((_, i) => comboRate(i));
  combos.forEach((r, i) => assert.ok(Math.abs(r - LV[i].combo) <= 20, `${LV[i].label}の連続技を最後までつなぐ率が表とずれている: ${r}%`));

  const show = (arr) => arr.map((r, i) => `${LV[i].label}${r}%`).join("・");
  console.log(`OK CPU: 同じ種なら同じ試合、勝率 ${Object.entries(wins).map(([k, v]) => `${k} ${v}%`).join("・")}`);
  console.log(`OK CPUの強さ: ガード（中段/下段） ${guards.map((g, i) => `${LV[i].label}${g[0]}/${g[1]}%`).join("・")}、投げ抜け ${show(techs)}、対空 ${show(aas)}、連続技を最後まで ${show(combos)}`);
}

// メニュー：タイトル → モード選択 → キャラと強さの選択 → 試合の設定が正しく作られるか
{
  require("../src/core/menu.js");
  const M = SF.menu;
  const go = (menu, ...actions) => actions.map((a) => M.press(menu, a)).pop();

  // プレイヤー VS CPU：自分をリン、相手をカゲツ、CPUをつよいに
  const m = M.createMenu();
  assert.strictEqual(m.screen, M.SCREEN.TITLE);
  go(m, "back"); // タイトルでもどるを押しても何も起きない
  assert.strictEqual(m.screen, M.SCREEN.TITLE);
  go(m, "ok");
  assert.strictEqual(m.screen, M.SCREEN.MODE);
  go(m, "ok");
  assert.strictEqual(m.screen, M.SCREEN.SELECT);
  let r = go(m, "right", "down", "right", "down", "right", "right", "right");
  assert.strictEqual(r, null);
  r = go(m, "down", "ok");
  assert.deepStrictEqual(r.start, { mode: "pvc", chars: ["rin", "kagetsu"], levels: [null, SF.cpu.LEARN_LEVEL] }, "プレイヤー VS CPU の設定がちがう");

  // 強さは端で止まる（学習AIの右は学習AI、よわいの左はよわい）
  go(m, "up", "left", "left", "left", "left");
  assert.strictEqual(M.matchConfig(m).levels[1], 0, "よわいより下にいってしまう");

  // もどる → モード選択 → CPU VS CPU。左右で別の強さを選べる
  go(m, "back");
  assert.strictEqual(m.screen, M.SCREEN.MODE);
  go(m, "down", "ok");
  assert.strictEqual(m.screen, M.SCREEN.SELECT);
  assert.strictEqual(m.cursor, 0, "モードを変えたら一番上から選ぶ");
  // 左：カゲツ・よわい　右：カゲツ・つよい。Enterを続けて押すと次の行へ進み、最後に始まる
  r = go(m, "ok", "left", "ok", "left", "ok", "right", "ok", "ok");
  assert.deepStrictEqual(r.start, { mode: "cvc", chars: ["kagetsu", "kagetsu"], levels: [0, 2] }, "CPU VS CPU の設定がちがう");

  // モードごとに前に選んだものを覚えている
  go(m, "back", "up", "ok");
  assert.deepStrictEqual(M.matchConfig(m), { mode: "pvc", chars: ["rin", "kagetsu"], levels: [null, 0] }, "前に選んだものを忘れている");

  // 作った設定で試合とCPUが動く（CPU VS CPU を最後まで）
  const cfg = { mode: "cvc", chars: ["rin", "kagetsu"], levels: [0, 2] };
  const st = SF.game.createGame(7, cfg.chars);
  const cpus = cfg.levels.map((lv, i) => SF.cpu.createCpu(lv, 7 + i));
  for (let i = 0; i < 60 * 60 * 6 && st.round.phase !== SF.game.PHASE.MATCH_END; i++) {
    SF.game.step(st, [SF.cpu.input(cpus[0], st, 0), SF.cpu.input(cpus[1], st, 1)]);
  }
  assert.strictEqual(st.round.phase, SF.game.PHASE.MATCH_END, "CPU VS CPU が終わらない");
  console.log("OK メニュー: モード選択、キャラと強さの選択（左右別の強さ・同キャラ・端で止まる・選んだものを覚える）から試合の設定ができる");
}

// 7. 自動対戦と記録
require("../src/core/autobattle.js");
{
  const AB = SF.autobattle;
  const M = SF.menu;
  // メニューの3つ目「自動対戦と記録」で、記録の画面を開く合図が返る
  const mm = M.createMenu();
  M.press(mm, "ok");
  M.press(mm, "down");
  M.press(mm, "down");
  assert.deepStrictEqual(M.press(mm, "ok"), { auto: true }, "自動対戦と記録が選べない");
  assert.strictEqual(mm.screen, M.SCREEN.MODE, "自動対戦はキャラ選択画面に進まない");

  // 記録をとっても試合の中身は変わらない（記録なしと同じ結果）
  const chars = ["kagetsu", "rin"];
  const play = (record) => {
    const st = SF.game.createGame(11, chars, record ? { record: true } : {});
    const cpus = [0, 1].map((i) => SF.cpu.createCpu(1, 22 + i));
    const taken = [0, 0]; // ラウンドごとに減った体力の合計
    let prev = st.round.phase;
    for (let i = 0; i < 60 * 60 * 6 && st.round.phase !== SF.game.PHASE.MATCH_END; i++) {
      SF.game.step(st, [SF.cpu.input(cpus[0], st, 0), SF.cpu.input(cpus[1], st, 1)]);
      if (prev === SF.game.PHASE.FIGHT && st.round.phase === SF.game.PHASE.ROUND_END) {
        st.fighters.forEach((f, j) => (taken[j] += CH[f.charId].health - f.health));
      }
      prev = st.round.phase;
    }
    return { st, taken };
  };
  const plain = play(false);
  const rec = play(true);
  assert.strictEqual(SF.game.hashState(plain.st), SF.game.hashState(rec.st), "記録をとると試合が変わってしまう");
  assert.ok(rec.st.log && !Object.keys(rec.st).includes("log"), "記録は見えない形で持つはず");

  // 与えたダメージの記録は、相手の減った体力と同じ。当たった＋ガードされた＋投げ抜けされた は使った回数以下
  for (let i = 0; i < 2; i++) {
    const rows = Object.values(rec.st.log.moves[i]);
    const dmg = rows.reduce((s, r) => s + r.damage, 0);
    assert.strictEqual(dmg, rec.taken[1 - i], `${i === 0 ? "左" : "右"}の与えたダメージの記録が合わない`);
    for (const [name, r] of Object.entries(rec.st.log.moves[i])) {
      assert.ok(r.hits + r.blocks + r.techs <= r.uses, `${name} の当たった回数が使った回数より多い`);
    }
  }

  // 柄打ちを1回当てると、使った1・当たった1・ダメージ40と数える
  {
    const st = SF.game.createGame(1, ["kagetsu", "kagetsu"], { record: true, intro: false });
    st.fighters[1].x = st.fighters[0].x + 70 * S;
    for (let i = 0; i < 30; i++) SF.game.step(st, [i === 0 ? BUTTON.LIGHT : 0, 0]);
    assert.deepStrictEqual(st.log.moves[0].standLight, { uses: 1, hits: 1, blocks: 0, techs: 0, damage: 40 }, "柄打ちの記録がちがう");
  }

  // 同じ条件と種なら同じ集計。左右を入れ替えると半分ずつになる
  const setup = { chars: ["kagetsu", "rin"], levels: [1, 1], matches: 20, seed: 5, swap: true };
  const summarize = () => {
    const sum = AB.createSummary();
    for (const m of AB.schedule(setup)) AB.addMatch(sum, AB.runMatch(m.seed, m.chars, m.levels));
    return sum;
  };
  const s1 = summarize();
  assert.deepStrictEqual(s1, summarize(), "同じ条件なのに集計が違う");
  assert.strictEqual(AB.schedule(setup).filter((m) => m.chars[0] === "rin").length, 10, "左右の入れ替えが半分になっていない");
  const k = s1.entries["kagetsu:1"];
  const r = s1.entries["rin:1"];
  assert.strictEqual(k.matches, 20);
  assert.strictEqual(k.wins + k.losses + k.draws, 20);
  assert.strictEqual(k.wins, r.losses, "カゲツの勝ちとリンの負けが合わない");
  assert.ok(s1.rounds >= 40 && s1.rounds <= 60, "1試合は2〜3ラウンドのはず");

  // 表とCSV
  const ts = AB.tables(s1);
  assert.deepStrictEqual(ts.map((t) => t.id), ["overview", "winrate", "moves-kagetsu-1", "moves-rin-1"]);
  const csv = AB.toCsv(s1, [["左", "カゲツ"]]);
  assert.ok(csv.startsWith("条件\r\n左,カゲツ"), "CSVの先頭に条件が書かれていない");
  assert.ok(csv.includes("キャラごとの勝率") && csv.includes("柄打ち,U,"), "CSVに表が入っていない");
  const win = ts[1].rows.map((row) => `${row[0]} ${row[5]}`).join("・");

  const t1 = process.hrtime.bigint();
  const sum = AB.createSummary();
  for (const m of AB.schedule({ ...setup, matches: 100 })) AB.addMatch(sum, AB.runMatch(m.seed, m.chars, m.levels));
  const ms1 = Number(process.hrtime.bigint() - t1) / 1e6;
  console.log(`OK 自動対戦と記録: 記録しても試合は同じ、ダメージの記録は減った体力と一致、集計とCSV（20試合の勝率 ${win}）、CPU同士100試合を ${ms1.toFixed(0)} ミリ秒`);
}

// 8. 学習AI（機械学習）
{
  const L = SF.learn;
  const AB = SF.autobattle;
  const LEARN = SF.cpu.LEARN_LEVEL;
  assert.ok(SF.cpu.LEVELS[LEARN].learned, "学習AIの強さがない");
  assert.ok(SF.menu.MODES.some((m) => m.id === "learn"), "モード選択に学習AIの画面がない");

  // 状況番号は表の大きさの中におさまる
  const st0 = SF.game.createGame(1, ["kagetsu", "rin"], { intro: false });
  const cpu0 = SF.cpu.createCpu(LEARN, 1);
  for (let i = 0; i < 600; i++) SF.game.step(st0, [SF.cpu.input(cpu0, st0, 0), 0]);
  const s0 = L.stateOf(st0, 0, cpu0.history[cpu0.history.length - 1]);
  assert.ok(Number.isInteger(s0) && s0 >= 0 && s0 < L.STATES, "状況番号が表の外");
  assert.ok(cpu0.learner.decisions > 0, "学習AIが一度も考えていない");

  // 同じ頭脳・同じ種なら、学習AIの試合も同じ結果になる（学習しないとき）
  const brainA = L.defaultBrain();
  const m1 = AB.runMatch(11, ["rin", "kagetsu"], [LEARN, 2], { brain: brainA });
  const m2 = AB.runMatch(11, ["rin", "kagetsu"], [LEARN, 2], { brain: brainA });
  assert.deepStrictEqual(m1.health, m2.health, "同じ種なのに学習AIの試合が違う");
  assert.deepStrictEqual(L.serialize(brainA), L.serialize(L.defaultBrain()), "学習しないのに頭脳が変わった");

  // 保存して読み込むと同じ頭脳にもどる。形のちがうデータは読まない
  const saved = JSON.parse(JSON.stringify(L.serialize(brainA)));
  assert.deepStrictEqual(L.serialize(L.deserialize(saved)), L.serialize(brainA), "保存と読み込みで頭脳が変わった");
  assert.strictEqual(L.deserialize({ version: 999 }), null, "古い版のデータを読んでしまう");

  // 何も覚えていない頭脳から学習すると、勝率が上がる（カゲツ学習AI 対 リン つよい）
  function winRate(brain, n) {
    let w = 0;
    for (let i = 0; i < n; i++) {
      const side = i % 2;
      const chars = side ? ["rin", "kagetsu"] : ["kagetsu", "rin"];
      const levels = side ? [2, LEARN] : [LEARN, 2];
      if (AB.runMatch(50000 + i, chars, levels, { brain }).winner === side) w += 1;
    }
    return Math.round((100 * w) / n);
  }
  const t1 = process.hrtime.bigint();
  const fresh = L.createBrain();
  const before = winRate(fresh, 40);
  for (let i = 0; i < 400; i++) {
    const side = i % 2;
    L.trainMatch(fresh, i + 1, side ? ["rin", "kagetsu"] : ["kagetsu", "rin"], side, 2, 0.3);
  }
  const after = winRate(fresh, 40);
  const ms = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.strictEqual(L.tableFor(fresh, "kagetsu", "rin").matches, 400, "学習した試合数が数えられていない");
  assert.ok(after >= before + 30, `学習しても強くならない（${before}% → ${after}%）`);

  // ゲームに入っている学習データの学習AIは「つよい」CPUにしっかり勝つ（どの組み合わせでも）
  const ids = Object.keys(SF.characters.CHARACTERS);
  const def = [];
  for (const me of ids) {
    for (const opp of ids) {
      let w = 0;
      for (let i = 0; i < 20; i++) {
        const side = i % 2;
        const chars = side ? [opp, me] : [me, opp];
        const levels = side ? [2, LEARN] : [LEARN, 2];
        if (AB.runMatch(80000 + i, chars, levels).winner === side) w += 1;
      }
      def.push(`${SF.characters.CHARACTERS[me].name}対${SF.characters.CHARACTERS[opp].name} ${w * 5}%`);
      assert.ok(w >= 14, `学習AI（${me}）が つよい（${opp}）に勝てていない（${w}/20）`);
    }
  }
  console.log(`OK 学習AI: 何も覚えていない状態から400試合の学習で つよい への勝率 ${before}% → ${after}%（${(ms / 1000).toFixed(1)}秒）、入っている学習データは つよい に ${def.join("・")}`);
}

// 2. 速さ：60秒の試合を100回ぶん、画面なしで進める
const t0 = process.hrtime.bigint();
for (let i = 0; i < 100; i++) runMatch(i + 1, 3600);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`OK 速さ: 60秒の試合100回ぶんを ${ms.toFixed(0)} ミリ秒で計算`);
