// 種（シード）を指定できる乱数。
// 同じ種からは必ず同じ順番で同じ数が出るので、試合を再現できる。
// 状態はただの整数なので、ゲームの状態の中にそのまま保存できる。
(function (root) {
  const SF = (root.SF = root.SF || {});

  // 種から乱数の状態を作る
  function createRng(seed) {
    return { state: seed >>> 0 };
  }

  // 0以上 2^32 未満の整数を1つ出して、状態を進める（mulberry32）
  function nextUint32(rng) {
    rng.state = (rng.state + 0x6d2b79f5) >>> 0;
    let t = rng.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  // 0以上 max 未満の整数を1つ出す
  function nextInt(rng, max) {
    return nextUint32(rng) % max;
  }

  SF.rng = { createRng, nextUint32, nextInt };
})(globalThis);
