// 自動対戦と記録の画面（HTMLの表とボタン）。計算は src/core/autobattle.js。
// 画面が固まらないよう、少しずつ（1回に約30ミリ秒ぶん）試合を進めて、そのたびに進み具合を見せる。
(function (root) {
  const SF = root.SF;
  const AB = SF.autobattle;
  const doc = root.document;
  const $ = (id) => doc.getElementById(id);

  const panel = $("records");
  const els = {
    chars: [$("ab-char0"), $("ab-char1")],
    levels: [$("ab-level0"), $("ab-level1")],
    matches: $("ab-matches"),
    swap: $("ab-swap"),
    seed: $("ab-seed"),
    start: $("ab-start"),
    stop: $("ab-stop"),
    csv: $("ab-csv"),
    back: $("ab-back"),
    bar: $("ab-bar"),
    status: $("ab-status"),
    result: $("ab-result"),
  };

  // 選ぶ欄を作る
  for (let i = 0; i < 2; i++) {
    for (const [id, c] of Object.entries(SF.characters.CHARACTERS)) els.chars[i].add(new Option(c.name, id));
    SF.cpu.LEVELS.forEach((lv, n) => els.levels[i].add(new Option(lv.label, n)));
    els.levels[i].value = "1";
  }
  els.chars[1].value = "rin";

  let run = null; // 実行中の情報。止まっているときは null
  let last = null; // 最後に終わった（または途中で止めた）結果 { sum, settings }
  let onBack = null;

  function settingsOf(setup, done) {
    const name = (i) => AB.entryLabel(setup.chars[i], setup.levels[i]);
    return [
      ["左", name(0)],
      ["右", name(1)],
      ["試合数", done === setup.matches ? setup.matches : `${done}（${setup.matches}のうち途中で中止）`],
      ["左右の入れ替え", setup.swap ? "あり（半分ずつ）" : "なし"],
      ["種（シード）", setup.seed],
    ];
  }

  function el(tag, text, cls) {
    const e = doc.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function showTables(sum) {
    els.result.textContent = "";
    for (const t of AB.tables(sum)) {
      const sec = el("section");
      sec.appendChild(el("h3", t.title));
      if (t.note) sec.appendChild(el("p", t.note, "note"));
      const wrap = el("div", undefined, "table-wrap");
      const table = el("table");
      const head = el("tr");
      for (const h of t.head) head.appendChild(el("th", h));
      table.appendChild(el("thead")).appendChild(head);
      const body = table.appendChild(el("tbody"));
      for (const r of t.rows) {
        const tr = el("tr");
        r.forEach((v, i) => tr.appendChild(el(i === 0 ? "th" : "td", String(v))));
        body.appendChild(tr);
      }
      wrap.appendChild(table);
      sec.appendChild(wrap);
      els.result.appendChild(sec);
    }
  }

  function setRunning(on) {
    els.start.disabled = on;
    els.stop.disabled = !on;
    els.csv.disabled = on || !last;
    for (const e of [...els.chars, ...els.levels, els.matches, els.swap, els.seed]) e.disabled = on;
  }

  function start() {
    const setup = {
      chars: els.chars.map((e) => e.value),
      levels: els.levels.map((e) => Number(e.value)),
      matches: Number(els.matches.value),
      swap: els.swap.checked,
      seed: Math.max(0, Math.floor(Number(els.seed.value) || 0)),
    };
    run = { setup, list: AB.schedule(setup), done: 0, sum: AB.createSummary(), t0: performance.now() };
    last = null;
    setRunning(true);
    els.result.textContent = "";
    step();
  }

  function step() {
    if (!run) return;
    const until = performance.now() + 30;
    while (run.done < run.list.length && performance.now() < until) {
      const m = run.list[run.done];
      AB.addMatch(run.sum, AB.runMatch(m.seed, m.chars, m.levels));
      run.done += 1;
    }
    const n = run.list.length;
    els.bar.value = run.done / n;
    const sec = ((performance.now() - run.t0) / 1000).toFixed(1);
    els.status.textContent = `${run.done} / ${n} 試合（${sec}秒）`;
    if (run.done % 200 < 20 || run.done === n) showTables(run.sum); // ときどき途中の結果も見せる
    if (run.done >= n) finish(`${n}試合が終わりました（${sec}秒）`);
    else setTimeout(step, 0);
  }

  function finish(message) {
    showTables(run.sum);
    last = { sum: run.sum, settings: settingsOf(run.setup, run.done), setup: run.setup };
    els.status.textContent = message;
    run = null;
    setRunning(false);
  }

  function stop() {
    if (!run) return;
    finish(`途中で中止しました（${run.done}試合ぶんの結果）`);
  }

  function saveCsv() {
    if (!last) return;
    const csv = "﻿" + AB.toCsv(last.sum, last.settings); // 先頭の印（BOM）でExcelでも文字化けしない
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = doc.createElement("a");
    const s = last.setup;
    a.href = URL.createObjectURL(blob);
    a.download = `auto-battle_${s.chars[0]}${s.levels[0]}_vs_${s.chars[1]}${s.levels[1]}_${last.sum.matches}.csv`;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  els.start.addEventListener("click", start);
  els.stop.addEventListener("click", stop);
  els.csv.addEventListener("click", saveCsv);
  els.back.addEventListener("click", () => {
    stop();
    close();
  });

  function open(backHandler) {
    onBack = backHandler;
    doc.body.classList.add("records-open");
    panel.hidden = false;
    setRunning(false);
  }

  function close() {
    panel.hidden = true;
    doc.body.classList.remove("records-open");
    if (onBack) onBack();
  }

  SF.recordsPage = { open, close, isOpen: () => !panel.hidden, isRunning: () => !!run };
})(globalThis);
