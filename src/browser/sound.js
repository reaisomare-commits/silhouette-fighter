// 効果音とBGM。音のファイルは使わず、ブラウザの音の機能（Web Audio）でその場で音を作る。
// だからファイルを増やさずに、itch.io 用の zip でもそのまま鳴る。
//
// ゲームの計算部分（src/core）にはさわらない。試合を1フレーム進めるたびに observe(state) を呼ぶと、
// 前のフレームとくらべて「技を出した」「当たった」「ガードされた」「KO」などを見つけて音を鳴らす。
//
// BGMは和の音階（都節・陽音階）で、太鼓・三味線・笛・琴に似せた音を組み合わせて鳴らす。
//   タイトル・メニュー：琴と笛に太鼓のリズムが入った、軽快な曲（陽音階）
//   試合：太鼓・三味線・笛に、低いドラムと歪んだ音を重ねた激しい曲（都節）
// ブラウザは「画面をクリックするかキーを押すまで音を出さない」決まりなので、最初の操作で鳴りはじめる。
(function (root) {
  const SF = (root.SF = root.SF || {});

  const STORE = "silhouette-fighter.sound";
  // 音量の段階（0＝なし〜4＝最大）
  const LEVEL_LABELS = ["なし", "小", "中", "大", "最大"];
  const LEVEL_GAIN = [0, 0.3, 0.55, 0.8, 1];
  const DEFAULTS = { bgm: 2, sfx: 3, muted: false };

  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---- 曲の書き方 ----
  // 1文字が1マス。"." は休み、"-" は前の音をのばす、0〜9・a〜e は音階の何番目の音か（5つで1オクターブ上がる）
  function degreeOf(ch) {
    if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
    if (ch >= "a" && ch <= "e") return ch.charCodeAt(0) - 87;
    return null;
  }
  function noteOf(scale, base, d) {
    return base + 12 * Math.floor(d / scale.length) + scale[d % scale.length];
  }
  // 次の "-" が続く長さ（マス数）
  function holdLength(str, i) {
    let n = 1;
    while (str[i + n] === "-") n++;
    return n;
  }

  // 試合の曲：都節音階（D・E♭・G・A・B♭）。168BPM、16分音符で1マス、16小節で1周
  const MIYAKO = [0, 1, 5, 7, 8];
  const BATTLE_SONG = {
    stepDur: 60 / 168 / 4,
    stepsPerBar: 16,
    sections: [
      {
        // A：三味線の刻み
        shamisen: ["0.0.5.0.4.3.1.0.", "0.0.5.0.7.6.5.4.", "3.3.8.3.7.5.4.3.", "2.4.3.1.0...0.1."],
        flute: null,
        taiko: "x.....x...x.....",
        shime: "....x.......x.x.",
        bass: [38, 38, 45, 46],
      },
      {
        // A'：笛が入る
        shamisen: ["0.0.5.0.4.3.1.0.", "0.0.5.0.7.6.5.4.", "3.3.8.3.7.5.4.3.", "2.4.3.1.0...0.1."],
        flute: ["a-------c---d---", "c-------a---9---", "8-------9---a---", "c---------------"],
        taiko: "x.....x...x.....",
        shime: "..x.x...x...x.x.",
        bass: [38, 38, 45, 46],
      },
      {
        // B：音が上がって盛り上がる
        shamisen: ["8.8.7.8.a.9.8.7.", "5.5.4.5.7.5.4.3.", "3.3.4.5.6.5.4.3.", "1.1.2.3.4...4.5."],
        flute: ["d-------c---b---", "a-------b---c---", "d-------e---d---", "c-------b-------"],
        taiko: "x..x..x...x..x..",
        shime: "..x...x...x.x.xx",
        bass: [46, 43, 45, 38],
      },
      {
        // C：三味線の連打と太鼓の連打で1周目にもどる
        shamisen: ["0000000033335555", "0000000033335555", "1111111144446666", "3.3.3.3.4.4.5.5."],
        flute: null,
        taiko: ["x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x.x.", "x.x.x.x.xxxxxxxx"],
        shime: "xxxxxxxxxxxxxxxx",
        bass: [38, 38, 39, 45],
      },
    ],
  };

  // タイトル・メニューの曲：陽音階（D・E・G・A・B）。112BPM、8分音符で1マス、8小節で1周
  const YO = [0, 2, 5, 7, 9];
  const MENU_SONG = {
    stepDur: 60 / 112 / 2,
    stepsPerBar: 8,
    koto: ["0.24.7.4", "2.46.9.6", "1.35.8.5", "0.24.7.5", "3.57.a.7", "2.46.9.6", "1.35.6.5", "0..2.4.."],
    flute: ["7-------", "9---7---", "8-------", "7---5---", "a-------", "9---7-8-", "6-------", "5-------"],
    drone: [38, 38, 43, 45, 43, 38, 40, 38],
  };

  function loadSettings() {
    try {
      const saved = JSON.parse(root.localStorage.getItem(STORE) || "null");
      if (saved && typeof saved === "object") {
        const lv = (v, d) => (Number.isInteger(v) && v >= 0 && v < LEVEL_GAIN.length ? v : d);
        return { bgm: lv(saved.bgm, DEFAULTS.bgm), sfx: lv(saved.sfx, DEFAULTS.sfx), muted: !!saved.muted };
      }
    } catch (e) {
      // 保存できない設定のブラウザや、こわれたデータのときは初期値
    }
    return { ...DEFAULTS };
  }

  function createSound() {
    const settings = loadSettings();
    let ctx = null;
    let master = null;
    let sfxBus = null;
    let bgmBus = null;
    let duckGain = null;
    let reverb = null;
    let noiseBuf = null;

    function saveSettings() {
      try {
        root.localStorage.setItem(STORE, JSON.stringify(settings));
      } catch (e) {
        // 保存できなくても、開いている間はその音量で遊べる
      }
    }

    // ---- 音の土台を作る（最初の操作のとき） ----
    function ensure() {
      if (!ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        try {
          ctx = new AC();
        } catch (e) {
          return null;
        }
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        comp.connect(ctx.destination);
        master = ctx.createGain();
        master.gain.value = 0.8;
        master.connect(comp);
        sfxBus = ctx.createGain();
        sfxBus.connect(master);
        duckGain = ctx.createGain();
        duckGain.connect(master);
        bgmBus = ctx.createGain();
        bgmBus.connect(duckGain);
        // 響き（お寺の中のような残響）。笛・琴・鐘を少し響かせる
        reverb = ctx.createConvolver();
        reverb.buffer = makeImpulse(1.8);
        const wet = ctx.createGain();
        wet.gain.value = 0.35;
        reverb.connect(wet);
        wet.connect(master);
        // ザーッという音（打撃・風切り音のもと）
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        applyVolume();
        root.setInterval(scheduleMusic, 25);
      }
      if (ctx.state === "suspended" && !hidden) ctx.resume().catch(() => {});
      return ctx;
    }

    function makeImpulse(seconds) {
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      return buf;
    }

    function applyVolume() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const m = settings.muted ? 0 : 1;
      sfxBus.gain.setTargetAtTime(LEVEL_GAIN[settings.sfx] * m, t, 0.02);
      bgmBus.gain.setTargetAtTime(LEVEL_GAIN[settings.bgm] * m * 0.6, t, 0.05);
    }

    // タブを裏にしたら音を止める（もどったら再開）
    let hidden = false;
    if (root.document) {
      root.document.addEventListener("visibilitychange", () => {
        hidden = root.document.hidden;
        if (!ctx) return;
        if (hidden) ctx.suspend().catch(() => {});
        else ctx.resume().catch(() => {});
      });
    }

    // ---- 音のもと ----
    // 音の大きさの形：すぐ大きくなって、だんだん消える
    function envelope(g, t, attack, peak, decay) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }
    function sendTo(node, dest, rev) {
      node.connect(dest);
      if (rev) {
        const s = ctx.createGain();
        s.gain.value = rev;
        node.connect(s);
        s.connect(reverb);
      }
    }
    // 高さのある音（f0 から f1 へ高さが変わる）
    function tone(dest, o) {
      const t = o.t;
      const attack = o.attack || 0.002;
      const osc = ctx.createOscillator();
      osc.type = o.type || "sine";
      osc.frequency.setValueAtTime(o.f0, t);
      if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.sweep || o.dur));
      if (o.detune) osc.detune.value = o.detune;
      const g = ctx.createGain();
      envelope(g, t, attack, o.vol, o.dur);
      let node = osc;
      if (o.lowpass) {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.setValueAtTime(o.lowpass, t);
        if (o.lowpassTo) f.frequency.exponentialRampToValueAtTime(o.lowpassTo, t + o.dur * 0.6);
        f.Q.value = o.q || 0.7;
        osc.connect(f);
        node = f;
      }
      node.connect(g);
      sendTo(g, dest, o.rev);
      osc.start(t);
      osc.stop(t + attack + o.dur + 0.05);
      return osc;
    }
    // ザーッという音をフィルターで形を変えたもの（打撃・風切り音・布の音）
    function noise(dest, o) {
      const t = o.t;
      const attack = o.attack || 0.002;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = o.filter || "bandpass";
      f.frequency.setValueAtTime(o.f0, t);
      if (o.f1 && o.f1 !== o.f0) f.frequency.exponentialRampToValueAtTime(o.f1, t + attack + o.dur);
      f.Q.value = o.q || 1;
      const g = ctx.createGain();
      envelope(g, t, attack, o.vol, o.dur);
      src.connect(f);
      f.connect(g);
      sendTo(g, dest, o.rev);
      src.start(t, Math.random() * 0.5);
      src.stop(t + attack + o.dur + 0.05);
    }

    // ---- 楽器（BGM用） ----
    function taiko(dest, t, vol) {
      tone(dest, { t, f0: 120, f1: 50, sweep: 0.18, dur: 0.5, vol: vol });
      noise(dest, { t, filter: "lowpass", f0: 350, dur: 0.09, vol: vol * 0.6 });
    }
    function shime(dest, t, vol) {
      tone(dest, { t, type: "triangle", f0: 460, f1: 330, dur: 0.07, vol: vol * 0.6 });
      noise(dest, { t, f0: 2600, q: 2, dur: 0.035, vol: vol * 0.5 });
    }
    // 三味線：はじいた瞬間に少し高く、すぐ丸くなる音
    function shamisen(dest, t, freq, vol) {
      tone(dest, { t, type: "sawtooth", f0: freq * 1.012, f1: freq, sweep: 0.04, dur: 0.32, vol, lowpass: 4200, lowpassTo: 700, q: 2 });
      tone(dest, { t, type: "square", f0: freq * 2, dur: 0.06, vol: vol * 0.15, lowpass: 3000 });
      noise(dest, { t, f0: 3500, q: 3, dur: 0.02, vol: vol * 0.4 });
    }
    // 琴：やわらかく長く残る音
    function koto(dest, t, freq, vol) {
      tone(dest, { t, type: "triangle", f0: freq * 1.006, f1: freq, sweep: 0.05, dur: 1.4, vol, lowpass: 3200, lowpassTo: 900, rev: 0.6 });
      tone(dest, { t, type: "sine", f0: freq * 2, dur: 0.5, vol: vol * 0.25, rev: 0.6 });
      noise(dest, { t, f0: 2500, q: 4, dur: 0.015, vol: vol * 0.25 });
    }
    // 笛（尺八・篠笛のような音）：ゆっくり立ち上がり、途中からゆれる
    function flute(dest, t, freq, dur, vol) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * 0.97, t);
      osc.frequency.linearRampToValueAtTime(freq, t + 0.08);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(0, t + Math.min(0.25, dur * 0.4));
      depth.gain.linearRampToValueAtTime(freq * 0.012, t + Math.min(0.6, dur * 0.8));
      lfo.connect(depth);
      depth.connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.07);
      g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.08, dur - 0.08));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
      osc.connect(g);
      sendTo(g, dest, 0.9);
      noise(dest, { t, f0: freq * 2, q: 6, attack: 0.04, dur: Math.max(0.05, dur * 0.7), vol: vol * 0.18, rev: 0.6 });
      osc.start(t);
      lfo.start(t);
      osc.stop(t + dur + 0.2);
      lfo.stop(t + dur + 0.2);
    }
    function bass(dest, t, freq, dur, vol) {
      tone(dest, { t, type: "sawtooth", f0: freq, dur, vol, lowpass: 520, lowpassTo: 260, q: 3, attack: 0.004 });
      tone(dest, { t, type: "square", f0: freq / 2, dur, vol: vol * 0.5, lowpass: 200, attack: 0.004 });
    }
    // 低いドラム（お腹にひびくドン）
    function kick(dest, t, vol) {
      tone(dest, { t, f0: 150, f1: 42, sweep: 0.09, dur: 0.28, vol });
      noise(dest, { t, filter: "highpass", f0: 3000, dur: 0.012, vol: vol * 0.35 });
    }
    // シャン（小さな鳴り物）
    function hat(dest, t, vol, open) {
      noise(dest, { t, filter: "highpass", f0: 7000, dur: open ? 0.16 : 0.035, vol });
    }
    // ジャーン（区切りのシンバル）
    function crash(dest, t, vol) {
      noise(dest, { t, filter: "highpass", f0: 4500, dur: 1.4, vol, rev: 0.4 });
      noise(dest, { t, f0: 9000, q: 0.7, dur: 0.9, vol: vol * 0.5 });
    }
    // 歪んだ笛（笛の旋律を1オクターブ上で重ねて、とがった音にする）
    function lead(dest, t, freq, dur, vol) {
      [-8, 8].forEach((det) => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.setValueAtTime(3200, t);
        f.Q.value = 2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.015);
        g.gain.setValueAtTime(vol * 0.8, t + Math.max(0.02, dur - 0.05));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
        const sh = crunch();
        osc.connect(f);
        f.connect(sh);
        sh.connect(g);
        sendTo(g, dest, 0.3);
        osc.start(t);
        osc.stop(t + dur + 0.12);
      });
    }
    // 音を歪ませる（打撃と歪んだ笛に使う）。歪み方の表は1つを使い回す
    let crunchCurve = null;
    function crunch() {
      if (!crunchCurve) {
        const n = 1024;
        crunchCurve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * 2 - 1;
          crunchCurve[i] = Math.tanh(x * 3.5);
        }
      }
      const sh = ctx.createWaveShaper();
      sh.curve = crunchCurve;
      return sh;
    }
    // 歪ませてから dest に送る入口（効果音用）。vol は歪んだあとの大きさ
    function crunchTo(dest, vol, life) {
      const sh = crunch();
      const g = ctx.createGain();
      g.gain.value = vol;
      sh.connect(g);
      g.connect(dest);
      root.setTimeout(() => sh.disconnect(), (life || 1) * 1000 + 200);
      return sh;
    }

    // ---- BGMを鳴らす仕組み：少し先までの音を予約しておく ----
    const SONGS = {
      battle: { stepDur: BATTLE_SONG.stepDur, length: BATTLE_SONG.sections.length * 4 * 16, play: playBattleStep },
      menu: { stepDur: MENU_SONG.stepDur, length: MENU_SONG.koto.length * 8, play: playMenuStep, gain: 1.8 }, // 音数が少ないぶん大きく
    };
    let wanted = null; // 鳴らしたい曲（音の土台ができる前でも覚えておく）
    let current = null; // 鳴っている曲
    let trackGain = null;
    let songStep = 0;
    let songPass = 0; // 曲が何周したか
    let nextTime = 0;

    function playBattleStep(step, t, dest) {
      const bar = Math.floor(step / 16);
      const secIndex = Math.floor(bar / 4);
      const sec = BATTLE_SONG.sections[secIndex];
      const b = bar % 4;
      const i = step % 16;
      const at = (p) => (Array.isArray(p) ? p[b] : p)[i];
      // 区切りでジャーン
      if (i === 0 && b === 0) crash(dest, t, 0.22);
      // 低いドラムは拍ごと（最後の盛り上がりは8分ごと）
      if (i % 4 === 0 || (secIndex === 3 && i % 2 === 0)) kick(dest, t, 0.75);
      if (at(sec.taiko) === "x") taiko(dest, t, i % 4 === 0 ? 0.9 : 0.65);
      if (at(sec.shime) === "x") shime(dest, t, i % 2 ? 0.4 : 0.55);
      // 裏拍のシャン
      if (i % 4 === 2) hat(dest, t, 0.16, i === 14);
      else if (i % 2 === 1) hat(dest, t, 0.06, false);
      const s = degreeOf(sec.shamisen[b][i]);
      if (s !== null) shamisen(dest, t, midi(noteOf(MIYAKO, 62, s)), 0.2);
      if (sec.flute) {
        const ch = sec.flute[b][i];
        const d = degreeOf(ch);
        if (d !== null) {
          const dur = holdLength(sec.flute[b], i) * BATTLE_SONG.stepDur;
          flute(dest, t, midi(noteOf(MIYAKO, 50, d)), dur, 0.17);
          lead(dest, t, midi(noteOf(MIYAKO, 62, d)), dur, 0.035);
        }
      }
      // ベース：8分音符で刻み続ける（裏は1オクターブ上）
      if (i % 2 === 0) {
        const root = sec.bass[b];
        bass(dest, t, midi(i % 4 === 2 ? root + 12 : root), BATTLE_SONG.stepDur * 1.7, i % 4 === 0 ? 0.24 : 0.18);
      }
    }

    function playMenuStep(step, t, dest) {
      const bar = Math.floor(step / 8);
      const i = step % 8;
      const k = degreeOf(MENU_SONG.koto[bar][i]);
      if (k !== null) koto(dest, t, midi(noteOf(YO, 62, k)), 0.16);
      // 三味線で小節の頭と真ん中を強く
      if (i === 0 || i === 4) {
        const k0 = degreeOf(MENU_SONG.koto[bar][0]);
        if (k0 !== null) shamisen(dest, t, midi(noteOf(YO, 50, k0)), 0.14);
      }
      const d = degreeOf(MENU_SONG.flute[bar][i]);
      if (d !== null) flute(dest, t, midi(noteOf(YO, 62, d)), holdLength(MENU_SONG.flute[bar], i) * MENU_SONG.stepDur, songPass % 2 ? 0.15 : 0.12);
      // リズム：1・3拍目に太鼓、2・4拍目に締太鼓、8分でシャン
      if (i === 0 || i === 4) taiko(dest, t, i === 0 ? 0.6 : 0.45);
      if (i === 2 || i === 6) shime(dest, t, 0.45);
      if (i === 7 && bar % 2 === 1) shime(dest, t, 0.3);
      hat(dest, t, i % 2 ? 0.08 : 0.04, false);
      if (i === 0 && bar === 0) crash(dest, t, 0.12);
      // ベース：8分で刻む
      const r = MENU_SONG.drone[bar];
      if (i % 2 === 0) bass(dest, t, midi(i === 6 ? r + 12 : r), MENU_SONG.stepDur * 0.9, 0.15);
    }
    function scheduleMusic() {
      if (!ctx || ctx.state !== "running") return;
      if (wanted !== current) switchTrack();
      if (!current) return;
      const song = SONGS[current];
      if (nextTime < ctx.currentTime - 0.2) nextTime = ctx.currentTime + 0.05; // 遅れすぎたら追いつかずに今から
      while (nextTime < ctx.currentTime + 0.15) {
        song.play(songStep, nextTime, trackGain);
        nextTime += song.stepDur;
        songStep += 1;
        if (songStep >= song.length) {
          songStep = 0;
          songPass += 1;
        }
      }
    }

    function switchTrack() {
      const t = ctx.currentTime;
      if (trackGain) {
        const old = trackGain;
        old.gain.cancelScheduledValues(t);
        old.gain.setValueAtTime(old.gain.value, t);
        old.gain.linearRampToValueAtTime(0, t + 0.6);
        root.setTimeout(() => old.disconnect(), 2500);
        trackGain = null;
      }
      current = wanted;
      if (!current) return;
      trackGain = ctx.createGain();
      trackGain.gain.setValueAtTime(0, t);
      trackGain.gain.linearRampToValueAtTime(SONGS[current].gain || 1, t + 0.4);
      trackGain.connect(bgmBus);
      songStep = 0;
      songPass = 0;
      nextTime = t + 0.12;
    }

    // ---- 効果音 ----
    const SFX = {
      // 風切り音（技を出した）。heavy は低く長く
      swing(t, heavy) {
        noise(sfxBus, { t, f0: heavy ? 450 : 900, f1: heavy ? 2200 : 3800, q: 1.4, attack: heavy ? 0.035 : 0.015, dur: heavy ? 0.17 : 0.08, vol: heavy ? 0.45 : 0.3 });
        if (heavy) tone(sfxBus, { t, type: "sine", f0: 180, f1: 90, attack: 0.03, dur: 0.12, vol: 0.12 });
      },
      // 打撃：重さ（0〜1以上）で大きさと低さが変わる。blade は刀の金属音つき
      // 「ドン（低い音）」「バシッ（歪んだ破裂音）」「パン（高い音）」を重ねる
      hit(t, power, blade) {
        const p = Math.min(1.6, Math.max(0.3, power));
        const dist = crunchTo(sfxBus, 0.35 + p * 0.2, 0.6);
        // ドン
        tone(sfxBus, { t, f0: 260 - p * 70, f1: 40, sweep: 0.1 + p * 0.05, dur: 0.15 + p * 0.18, vol: 0.6 + p * 0.3 });
        // バシッ（歪ませる）
        noise(dist, { t, filter: "lowpass", f0: 2500 + p * 1500, f1: 400, dur: 0.05 + p * 0.09, vol: 0.9 });
        tone(dist, { t, type: "square", f0: 120 + p * 20, f1: 50, dur: 0.06 + p * 0.08, vol: 0.5 });
        // パン
        noise(sfxBus, { t, filter: "highpass", f0: 3000, dur: 0.025, vol: 0.5 });
        if (p > 0.8) noise(sfxBus, { t: t + 0.01, filter: "lowpass", f0: 600, f1: 120, dur: 0.25 + p * 0.1, vol: 0.35, rev: 0.25 });
        if (blade) {
          noise(sfxBus, { t, f0: 5000, q: 2, dur: 0.06, vol: 0.35 });
          tone(sfxBus, { t, type: "triangle", f0: 1900, dur: 0.3 + p * 0.15, vol: 0.16, rev: 0.4 });
          tone(sfxBus, { t, type: "sine", f0: 2870, dur: 0.25 + p * 0.1, vol: 0.1, rev: 0.4 });
        }
      },
      // ガード：ガキッと硬い音
      block(t) {
        const dist = crunchTo(sfxBus, 0.25, 0.3);
        tone(dist, { t, type: "square", f0: 1400, f1: 700, dur: 0.05, vol: 0.5 });
        noise(sfxBus, { t, f0: 4200, q: 1.5, dur: 0.07, vol: 0.45 });
        tone(sfxBus, { t, f0: 320, f1: 150, dur: 0.08, vol: 0.35 });
        tone(sfxBus, { t, type: "triangle", f0: 2600, dur: 0.12, vol: 0.06, rev: 0.3 });
      },
      // 飛び道具（カゲツの飛刃）：シュイン
      blade(t) {
        noise(sfxBus, { t, f0: 1200, f1: 5000, q: 3, attack: 0.03, dur: 0.18, vol: 0.25 });
        tone(sfxBus, { t, type: "triangle", f0: 1500, f1: 2400, dur: 0.2, vol: 0.1, rev: 0.4 });
      },
      // ゲンマの門が開く：低くゆがんだ音
      portal(t) {
        tone(sfxBus, { t, type: "sawtooth", f0: 90, f1: 260, attack: 0.03, dur: 0.3, vol: 0.14, lowpass: 900 });
        tone(sfxBus, { t, type: "sine", f0: 600, f1: 300, attack: 0.02, dur: 0.3, vol: 0.12, detune: 30, rev: 0.6 });
      },
      // ワープ（ゲンマ）
      warp(t) {
        tone(sfxBus, { t, type: "sine", f0: 300, f1: 1400, dur: 0.12, vol: 0.12, rev: 0.4 });
        noise(sfxBus, { t, f0: 3000, f1: 800, q: 4, dur: 0.12, vol: 0.12 });
      },
      // ステップ・ダッシュ：地面をける音
      dash(t) {
        noise(sfxBus, { t, filter: "lowpass", f0: 1400, f1: 400, dur: 0.1, vol: 0.18 });
      },
      jump(t) {
        noise(sfxBus, { t, f0: 1800, f1: 900, q: 1, dur: 0.06, vol: 0.12 });
      },
      land(t) {
        tone(sfxBus, { t, f0: 140, f1: 60, dur: 0.06, vol: 0.18 });
        noise(sfxBus, { t, filter: "lowpass", f0: 700, dur: 0.05, vol: 0.12 });
      },
      // 倒れた：ドスン
      down(t) {
        tone(sfxBus, { t, f0: 120, f1: 34, dur: 0.4, vol: 0.75 });
        noise(sfxBus, { t, filter: "lowpass", f0: 700, f1: 120, dur: 0.3, vol: 0.55 });
        noise(crunchTo(sfxBus, 0.2, 0.4), { t, filter: "lowpass", f0: 1500, f1: 200, dur: 0.12, vol: 0.8 });
      },
      // 掴んだ：布をつかむ音
      grab(t) {
        noise(sfxBus, { t, f0: 1500, q: 0.8, attack: 0.01, dur: 0.1, vol: 0.28 });
        tone(sfxBus, { t, f0: 180, f1: 90, dur: 0.08, vol: 0.25 });
      },
      // 投げ抜け：はじき合う音
      tech(t) {
        SFX.block(t);
        SFX.block(t + 0.07);
      },
      // 隙狩り：鋭い鐘
      counter(t) {
        tone(sfxBus, { t, type: "triangle", f0: 1760, dur: 0.4, vol: 0.18, rev: 0.5 });
        tone(sfxBus, { t, type: "sine", f0: 2640, dur: 0.3, vol: 0.1, rev: 0.5 });
      },
      // 消極的でゲージが減った：低いブザー
      passive(t) {
        tone(sfxBus, { t, type: "square", f0: 160, f1: 120, dur: 0.25, vol: 0.08, lowpass: 900 });
      },
      // ゲージが満タン：鈴
      gauge(t) {
        [0, 0.08].forEach((d, i) => {
          tone(sfxBus, { t: t + d, type: "sine", f0: i ? 1976 : 1480, dur: 0.6, vol: 0.13, rev: 0.6 });
          tone(sfxBus, { t: t + d, type: "sine", f0: (i ? 1976 : 1480) * 2.76, dur: 0.25, vol: 0.04, rev: 0.6 });
        });
      },
      // ゲージ技（暗転）：大きなドンと、ためてからの刀の音
      superFlash(t) {
        tone(sfxBus, { t, f0: 110, f1: 30, dur: 1, vol: 0.85 });
        noise(crunchTo(sfxBus, 0.3, 0.8), { t, filter: "lowpass", f0: 1200, f1: 120, dur: 0.5, vol: 0.9 });
        noise(sfxBus, { t, filter: "highpass", f0: 4000, dur: 1, vol: 0.2, rev: 0.5 });
        noise(sfxBus, { t: t + 0.05, f0: 300, f1: 7000, q: 2, attack: 0.5, dur: 0.12, vol: 0.4, rev: 0.5 });
        tone(sfxBus, { t: t + 0.55, type: "triangle", f0: 2200, dur: 0.7, vol: 0.18, rev: 0.7 });
        tone(sfxBus, { t: t + 0.55, type: "sine", f0: 3300, dur: 0.5, vol: 0.1, rev: 0.7 });
      },
      // 拍子木（カン、カン）：ラウンド開始の合図
      clappers(t) {
        [0, 0.22].forEach((d) => {
          noise(sfxBus, { t: t + d, f0: 2200, q: 8, dur: 0.07, vol: 0.5, rev: 0.4 });
          tone(sfxBus, { t: t + d, type: "square", f0: 1650, dur: 0.035, vol: 0.12, lowpass: 4000, rev: 0.3 });
        });
      },
      // 「ラウンド◯」：大太鼓2つ
      roundCall(t) {
        taiko(sfxBus, t, 0.8);
        taiko(sfxBus, t + 0.32, 1);
      },
      // 銅鑼（ゴーン）
      gong(t, vol) {
        [1, 1.48, 2.03, 2.74, 3.6].forEach((r, i) => {
          tone(sfxBus, { t, type: "sine", f0: 150 * r, f1: 150 * r * 0.985, dur: 2.2 - i * 0.3, vol: (vol || 0.3) / (i + 1), rev: 0.7 });
        });
      },
      // KO：大きな打撃と銅鑼
      ko(t) {
        SFX.hit(t, 1.6, false);
        SFX.hit(t + 0.09, 1.2, false);
        SFX.down(t + 0.02);
        SFX.crash(t + 0.05);
        SFX.gong(t + 0.05, 0.55);
      },
      crash(t) {
        crash(sfxBus, t, 0.35);
      },
      // 試合の決着：琴の上り調子と銅鑼
      victory(t) {
        [0, 2, 4, 5, 7, 10].forEach((d, i) => koto(sfxBus, t + i * 0.11, midi(noteOf(YO, 62, d)), 0.2));
        SFX.gong(t + 0.66, 0.3);
      },
      // メニュー
      move(t) {
        tone(sfxBus, { t, type: "sine", f0: 1100, dur: 0.035, vol: 0.12 });
        noise(sfxBus, { t, f0: 3000, q: 4, dur: 0.012, vol: 0.06 });
      },
      ok(t) {
        tone(sfxBus, { t, type: "triangle", f0: 880, dur: 0.1, vol: 0.16, rev: 0.3 });
        tone(sfxBus, { t: t + 0.06, type: "triangle", f0: 1320, dur: 0.16, vol: 0.16, rev: 0.3 });
      },
      back(t) {
        tone(sfxBus, { t, type: "triangle", f0: 700, f1: 500, dur: 0.12, vol: 0.14 });
      },
      page(t) {
        noise(sfxBus, { t, f0: 1800, f1: 4000, q: 0.7, attack: 0.03, dur: 0.12, vol: 0.12 });
      },
    };

    function play(name, ...args) {
      if (!ctx || ctx.state !== "running" || settings.muted || settings.sfx === 0) return;
      try {
        SFX[name](ctx.currentTime + 0.005, ...args);
      } catch (e) {
        // 音が鳴らなくてもゲームは止めない
      }
    }

    // ---- 試合を見て音を鳴らす ----
    const G = () => SF.game;
    let watched = null; // 見ている試合の状態
    let prev = null;
    let seen = new WeakSet(); // 鳴らしおえた効果（火花など）
    let pendingCharge = [false, false]; // リンの突進拳：ためている間は鳴らさず、離したときに鳴らす

    function snapshot(state) {
      return {
        phase: state.round.phase,
        number: state.round.number,
        projectiles: state.projectiles.length,
        fighters: state.fighters.map((f) => ({
          pose: f.pose,
          move: f.move,
          moveFrame: f.moveFrame,
          onGround: f.onGround,
          health: f.health,
          gaugeFull: G().gaugeFull(f),
          charging: f.charging,
        })),
      };
    }

    // 新しい試合を見はじめる
    function begin(state) {
      watched = state;
      prev = snapshot(state);
      seen = new WeakSet(state.effects);
      pendingCharge = [false, false];
      if (state.round.phase === G().PHASE.INTRO) play("roundCall");
    }

    function observe(state) {
      if (state !== watched) {
        begin(state);
        return;
      }
      const P = G().PHASE;
      const POSE = G().POSE;
      const r = state.round;
      const now = snapshot(state);

      // ラウンドの進み具合
      if (now.number !== prev.number && now.phase === P.INTRO) play("roundCall");
      if (prev.phase !== now.phase) {
        if (now.phase === P.FIGHT && prev.phase === P.INTRO) play("clappers");
        if (now.phase === P.ROUND_END) {
          if (r.reason === "ko") play("ko");
          else play("gong", 0.4);
        }
        if (now.phase === P.MATCH_END) play("victory"); // BGMを止めるのは main.js
      }
      // ラウンドが変わると火花なども消えるので、そのフレームはくらべない
      if (now.number !== prev.number) {
        prev = now;
        seen = new WeakSet(state.effects);
        return;
      }

      // ダメージ（当たった音の重さに使う）
      const dmg = [0, 1].map((i) => Math.max(0, prev.fighters[i].health - now.fighters[i].health));

      // 新しく出た効果（火花・ガード・ゲージ技の名前・文字）
      let hitPlayed = false;
      for (const e of state.effects) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (e.kind === "hit" && !hitPlayed) {
          hitPlayed = true;
          const victim = dmg[0] >= dmg[1] ? 0 : 1;
          const attacker = state.fighters[1 - victim];
          const big = Math.max(dmg[0], dmg[1]);
          play("hit", big / 110, attacker.charId === "kagetsu" && attacker.pose !== POSE.THROW);
        } else if (e.kind === "block") play("block");
        else if (e.kind === "superName") play("superFlash");
        else if (e.kind === "portal") play("portal");
        else if (e.kind === "text") {
          if (e.text.indexOf("投げ抜け") >= 0) play("tech");
          else if (e.text.indexOf("隙狩り") >= 0) play("counter");
          else if (e.text.indexOf("消極的") >= 0) play("passive");
          else if (e.text.indexOf("踏ん張り") >= 0) play("block");
        }
      }

      // 飛び道具が増えた（ゲンマのものは門の音で鳴らす）
      if (now.projectiles > prev.projectiles) {
        const p = state.projectiles[state.projectiles.length - 1];
        if (p && state.fighters[p.owner] && state.fighters[p.owner].charId === "kagetsu") play("blade");
      }

      for (let i = 0; i < 2; i++) {
        const f = state.fighters[i];
        const a = prev.fighters[i];
        const b = now.fighters[i];
        // 技を出した
        const started = b.move && (b.move !== a.move || b.moveFrame < a.moveFrame);
        if (started && b.move !== "super") {
          if (b.charging) pendingCharge[i] = true;
          else swingFor(f, b.move);
        }
        if (pendingCharge[i] && !b.charging) {
          pendingCharge[i] = false;
          if (b.move) swingFor(f, b.move);
        }
        if (!b.move) pendingCharge[i] = false;
        // 体の動き
        if (a.pose !== b.pose) {
          if (b.pose === POSE.DOWN) play("down");
          else if (b.pose === POSE.THROW) play("grab");
          else if (b.pose === POSE.WARP) play("warp");
          else if (b.pose === POSE.STEP || b.pose === POSE.RUN || b.pose === POSE.BACKSTEP) play("dash");
        }
        if (a.onGround && !b.onGround && b.pose === POSE.JUMP) play("jump");
        if (!a.onGround && b.onGround && b.pose !== POSE.DOWN && b.pose !== POSE.LAUNCH) play("land");
        if (!a.gaugeFull && b.gaugeFull && now.phase === P.FIGHT) play("gauge");
      }
      prev = now;
    }

    function swingFor(f, move) {
      const m = safeMove(f, move);
      if (m && m.kind === "throw") {
        play("swing", false);
        return;
      }
      const heavy = move === "standHeavy" || move === "crouchHeavy" || move === "airHeavy" || move === "special" || move === "crouchSpecial" || move === "airSpecial";
      play("swing", heavy);
    }
    function safeMove(f, move) {
      try {
        const c = SF.characters.CHARACTERS[f.charId];
        return c && c.moves ? c.moves[move] : null;
      } catch (e) {
        return null;
      }
    }

    // ---- 外から使う操作 ----
    function music(name) {
      wanted = name;
      if (ctx && ctx.state === "running") scheduleMusic();
    }
    function duck(on) {
      if (!ctx) return;
      duckGain.gain.setTargetAtTime(on ? 0.35 : 1, ctx.currentTime, 0.08);
    }
    // 音量を1段階変える（dir：+1 か -1。端まで行ったら反対の端へ）
    function change(kind, dir) {
      const n = LEVEL_GAIN.length;
      settings[kind] = (settings[kind] + n + dir) % n;
      if (settings[kind] > 0) settings.muted = false;
      saveSettings();
      applyVolume();
      if (kind === "sfx") play("ok");
    }
    function toggleMute() {
      settings.muted = !settings.muted;
      saveSettings();
      applyVolume();
      return settings.muted;
    }

    return {
      unlock: ensure,
      music,
      duck,
      play,
      begin,
      observe,
      change,
      toggleMute,
      settings,
      levelLabel: (kind) => (settings.muted ? "消音中" : LEVEL_LABELS[settings[kind]]),
    };
  }

  SF.sound = { createSound, LEVEL_LABELS };
})(globalThis);
