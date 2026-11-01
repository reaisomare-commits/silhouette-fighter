// ゲームの状態を見て画面に描くだけの部分。状態は書き換えない。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const C = SF.constants;
  const { BUTTON, isDown } = SF.input;
  const { POSE, PHASE } = SF.game;
  const { CHARACTERS, BATTLE } = SF.characters;

  // 差し色：カゲツは刃が青、リンは鉢巻が赤。同じキャラ同士のときは右側を別の色にする
  const ACCENT = { kagetsu: "#4da6ff", rin: "#ff4d4d" };
  const ACCENT_MIRROR = { kagetsu: "#5cff8a", rin: "#ffd24d" };

  const POSE_LABEL = {
    [POSE.STAND]: "立ち",
    [POSE.WALK_FORWARD]: "前に歩く",
    [POSE.GUARD_STAND]: "立ちガード",
    [POSE.CROUCH]: "しゃがみ",
    [POSE.GUARD_CROUCH]: "しゃがみガード",
    [POSE.JUMP]: "ジャンプ",
    [POSE.LANDING]: "着地硬直",
    [POSE.STEP]: "ステップ",
    [POSE.RUN]: "ダッシュ",
    [POSE.BACKSTEP]: "バックステップ",
    [POSE.DASH_RECOVERY]: "止まり際（動けない）",
    [POSE.ATTACK]: "攻撃",
    [POSE.HIT]: "のけぞり",
    [POSE.BLOCK]: "ガードで受け止めた",
    [POSE.LAUNCH]: "空中でやられた",
    [POSE.DOWN]: "ダウン",
    [POSE.THROW]: "投げ",
    [POSE.THROWN]: "投げられている（U＋Iで投げ抜け）",
    [POSE.TECH]: "投げ抜け",
  };

  const BUTTON_LABELS = [
    [BUTTON.LEFT, "A"],
    [BUTTON.RIGHT, "D"],
    [BUTTON.DOWN, "S"],
    [BUTTON.JUMP, "スペース"],
    [BUTTON.LIGHT, "U"],
    [BUTTON.HEAVY, "I"],
    [BUTTON.SPECIAL, "O"],
  ];

  const lerp = (a, b, t) => a + (b - a) * t;

  // 技の進み具合。wind＝出す前の振りかぶり(0〜1)、ext＝伸びきり具合(0〜1)
  function attackProgress(f) {
    const m = SF.game.moveData(f);
    if (!m) return null;
    const k = f.moveFrame;
    if (k < m.startup) return { m, wind: k / m.startup, ext: 0, rec: false };
    if (k < m.startup + m.active) return { m, wind: 1, ext: 1, rec: false };
    if (m.recovery === null) return { m, wind: 1, ext: 0.6, rec: false }; // 空中攻撃は着地まで少し伸ばしたまま
    const r = (k - (m.startup + m.active - 1)) / m.recovery;
    return { m, wind: 1, ext: Math.max(0, 1 - r), rec: true };
  }

  function createRenderer(canvas) {
    const ctx = canvas.getContext("2d");
    canvas.width = C.STAGE_WIDTH;
    canvas.height = C.STAGE_HEIGHT;

    // 背景は毎回同じなので一度だけ作っておく
    const sky = ctx.createLinearGradient(0, 0, 0, C.GROUND_Y);
    sky.addColorStop(0, "#3b2a5c");
    sky.addColorStop(0.45, "#e0605a");
    sky.addColorStop(0.8, "#f6a95c");
    sky.addColorStop(1, "#fbd78a");

    function drawBackground() {
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, C.STAGE_WIDTH, C.GROUND_Y);
      // 沈む太陽
      ctx.fillStyle = "rgba(255, 236, 170, 0.85)";
      ctx.beginPath();
      ctx.arc(C.STAGE_WIDTH / 2, C.GROUND_Y - 20, 70, Math.PI, 0);
      ctx.fill();
      // 地面
      ctx.fillStyle = "#2a1a1a";
      ctx.fillRect(0, C.GROUND_Y, C.STAGE_WIDTH, C.STAGE_HEIGHT - C.GROUND_Y);
    }

    // 太さのある線（手足や刀）を描く
    function limb(x1, y1, x2, y2, width) {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    function circle(x, y, r) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // カゲツの刀。hand から角度 angle（0＝前、マイナス＝上）に長さ len で描く
    function sword(hand, angle, len, accent) {
      const tip = { x: hand.x + Math.cos(angle) * len, y: hand.y + Math.sin(angle) * len };
      const gx = hand.x + (tip.x - hand.x) * 0.18;
      const gy = hand.y + (tip.y - hand.y) * 0.18;
      limb(hand.x, hand.y, gx, gy, 6);
      ctx.strokeStyle = accent;
      limb(gx, gy, tip.x, tip.y, 4);
      ctx.strokeStyle = "#000";
    }

    // 倒れている姿
    function drawDown(f, accent) {
      const isKagetsu = f.charId === "kagetsu";
      const len = CHARACTERS[f.charId].height * 0.75;
      // 頭が後ろ（相手と反対側）に来るように寝る
      limb(-len * 0.45, -12, len * 0.15, -12, 22);
      circle(-len * 0.45 - 14, -14, isKagetsu ? 13 : 12);
      limb(len * 0.15, -10, len * 0.55, -6, 12);
      limb(len * 0.15, -14, len * 0.5, -18, 12);
      if (isKagetsu) {
        sword({ x: -len * 0.1, y: -4 }, 0.02, 90, accent);
      } else {
        ctx.strokeStyle = accent;
        limb(-len * 0.45 - 14, -24, -len * 0.45 - 34, -20, 3);
        ctx.strokeStyle = "#000";
      }
    }

    // キャラのシルエットを描く。
    // 足元を(0,0)、前（相手の方）を+x、上を-yとした向きで描き、左向きのときは左右反転する
    function drawFighter(f, index, state) {
      const c = CHARACTERS[f.charId];
      const other = state.fighters[1 - index];
      const accent =
        index === 1 && other.charId === f.charId ? ACCENT_MIRROR[f.charId] : ACCENT[f.charId];
      let h = SF.game.fighterHeight(f);
      const w = c.width;
      const p = f.pose;
      let crouching = f.crouching;
      const guarding =
        p === POSE.GUARD_STAND || p === POSE.GUARD_CROUCH || p === POSE.BLOCK;
      let hurt = p === POSE.HIT || p === POSE.LAUNCH || p === POSE.THROWN || p === POSE.TECH;
      // 投げきったあとの、腕を振り抜いた姿
      const throwFollow = p === POSE.THROW && !f.move;
      const airborne = !f.onGround;
      const isKagetsu = f.charId === "kagetsu";
      const atk = attackProgress(f);
      const move = atk ? f.move : null;

      ctx.save();
      ctx.translate(f.x / C.SCALE, f.y / C.SCALE);
      ctx.scale(f.facing, 1);
      ctx.fillStyle = "#000";
      ctx.strokeStyle = "#000";
      ctx.lineCap = "round";

      if (p === POSE.DOWN) {
        // ダウンの流れ：倒れる → 地面でバウンド → 寝ている → 起き上がる
        const e = f.downFrame; // 倒れてからのフレーム
        const FALL = 6;
        const GETUP = 18;
        let lie = 0; // 0＝立っている 〜 1＝寝ている
        if (e < FALL) {
          lie = (e + 1) / FALL;
          hurt = true;
        } else if (f.downTimer > GETUP || f.health === 0) {
          // 寝ている。最初に大きく1回、小さく1回バウンドする
          let bounce = 0;
          if (e < FALL + 12) bounce = Math.sin(((e - FALL) / 12) * Math.PI) * 18;
          else if (e < FALL + 20) bounce = Math.sin(((e - FALL - 12) / 8) * Math.PI) * 5;
          ctx.translate(0, -bounce);
          drawDown(f, accent);
          ctx.restore();
          return;
        } else {
          // 起き上がり：手をついて体を起こし、しゃがみから立ち上がる
          const t = 1 - f.downTimer / GETUP;
          lie = Math.max(0, 1 - t / 0.6);
          crouching = t < 0.8;
        }
        h = crouching ? c.crouchHeight : c.height;
        // 足元を軸に後ろへ倒す。倒れた体が足元の中心に来るよう少し前にずらす
        ctx.translate(h * 0.4 * lie, 0);
        ctx.rotate((-Math.PI / 2) * lie);
      }
      if (p === POSE.LAUNCH) {
        // 空中でやられたら後ろにのけぞって回る
        ctx.translate(0, -h * 0.5);
        ctx.rotate(-0.7);
        ctx.translate(0, h * 0.5);
      }

      const headR = isKagetsu ? 13 : 12;
      // しゃがみ足払いは少し低く構える
      const sweepDrop = move === "crouchHeavy" ? 10 * (atk.ext || atk.wind * 0.5) : 0;
      // 対空技は伸び上がる（見た目だけ）
      const rise = move === "crouchSpecial" ? 14 * atk.ext : 0;
      ctx.translate(0, -rise);
      const headY = -h + headR + sweepDrop;
      const shoulderY = headY + headR + 6;
      const hipY = airborne ? -h * 0.45 : crouching ? -h * 0.42 : -h * 0.47;
      // 体の傾き：構えやバックステップは後ろに、歩き・ステップ・ダッシュは前に
      const LEAN = {
        [POSE.GUARD_STAND]: -4,
        [POSE.GUARD_CROUCH]: -4,
        [POSE.BLOCK]: -6,
        [POSE.WALK_FORWARD]: 3,
        [POSE.STEP]: 10,
        [POSE.RUN]: 14,
        [POSE.BACKSTEP]: -10,
        [POSE.HIT]: -14,
        [POSE.LAUNCH]: -10,
        [POSE.THROWN]: -12,
        [POSE.TECH]: -12,
        [POSE.THROW]: 8,
      };
      let lean = LEAN[p] || 0;
      if (atk) {
        // 攻撃は振りかぶりで少し後ろ、当たる瞬間に前へ
        const forwardLean = { standHeavy: 10, standLight: 6, crouchLight: 6, crouchHeavy: 8, special: isKagetsu ? 8 : 16, crouchSpecial: -2, throw: 8 }[move] || 4;
        const kickBack = !isKagetsu && (move === "standHeavy") ? -10 : 0;
        lean = lerp(-3 * atk.wind, forwardLean, atk.ext) + kickBack * atk.ext;
      }
      const bodyW = w * 0.55;

      // リンの蹴り：前の足を伸ばす先（足元からの位置）
      let kickFoot = null;
      if (!isKagetsu && atk) {
        const e = atk.ext;
        if (move === "standHeavy") kickFoot = { x: lerp(14, 88, e), y: lerp(0, -95, e) };
        if (move === "crouchLight") kickFoot = { x: lerp(20, 72, e), y: -6 };
        if (move === "crouchHeavy") kickFoot = { x: lerp(20, 92, e), y: -4 };
        if (move === "airHeavy") kickFoot = { x: lerp(16, 72, e), y: lerp(hipY + 38, hipY + 70, e) };
        // 跳び蹴り上げ：前の足を真上へ蹴り上げる
        if (move === "crouchSpecial") kickFoot = { x: lerp(20, 36, e), y: lerp(-10, -h - 40, e) };
      }

      // 足
      const legW = isKagetsu ? 13 : 12;
      const stride = Math.sin(state.frame * 0.25) * 8;
      if (airborne) {
        // 膝をたたむ
        limb(-6, hipY, -14, hipY + 22, legW);
        limb(-14, hipY + 22, -4, hipY + 40, legW);
        if (kickFoot) {
          limb(6, hipY, kickFoot.x, kickFoot.y, legW);
        } else {
          limb(6, hipY, 16, hipY + 18, legW);
          limb(16, hipY + 18, 10, hipY + 38, legW);
        }
      } else if (crouching) {
        limb(-6, hipY, -20, -18, legW);
        limb(-20, -18, -14, 0, legW);
        if (kickFoot) {
          limb(6, hipY, kickFoot.x, kickFoot.y, legW);
        } else {
          limb(6, hipY, 20, -22, legW);
          limb(20, -22, 18, 0, legW);
        }
      } else if (kickFoot) {
        // 立ち回し蹴り：後ろ足で立って前の足を高く上げる
        limb(-5, hipY, -14, 0, legW);
        limb(5, hipY, kickFoot.x, kickFoot.y, legW);
      } else if (p === POSE.RUN) {
        // 大きく足を開いて走る
        const r = Math.sin(state.frame * 0.5) * 18;
        limb(-5, hipY, -10 - r, 0, legW);
        limb(5, hipY, 10 + r, 0, legW);
      } else if (p === POSE.STEP || p === POSE.BACKSTEP || (atk && (move === "standHeavy" || move === "special"))) {
        // 足を前後に開く
        limb(-5, hipY, -24, 0, legW);
        limb(5, hipY, 22, 0, legW);
      } else {
        const s = p === POSE.WALK_FORWARD || p === POSE.GUARD_STAND ? stride : 0;
        limb(-5, hipY, -12 - s, 0, legW);
        limb(5, hipY, 12 + s, 0, legW);
      }

      // 胴体と頭
      ctx.beginPath();
      ctx.moveTo(lean - bodyW / 2, shoulderY);
      ctx.lineTo(lean + bodyW / 2, shoulderY);
      ctx.lineTo(bodyW / 2 - 2, hipY + 4);
      ctx.lineTo(-bodyW / 2 + 2, hipY + 4);
      ctx.closePath();
      ctx.fill();
      circle(lean, headY, headR);

      const handY = shoulderY + 10;
      if (isKagetsu) {
        // カゲツ：長い刀。構えると刀を立てて体の前に出す
        const shoulder = { x: lean, y: shoulderY + 4 };
        let hand = { x: lean + 20, y: handY + 14 };
        let angle = -0.55;
        let len = 84;
        if (guarding) {
          hand = { x: lean + 16, y: handY + 6 };
          angle = -1.45;
        } else if (hurt) {
          hand = { x: lean + 6, y: handY + 18 };
          angle = 0.9;
        } else if (throwFollow || (atk && move === "throw")) {
          // 投げ：刀を後ろに下げ、空いた手で掴む
          const e = throwFollow ? 1 : Math.max(atk.ext, atk.wind * 0.5);
          limb(lean, shoulderY + 8, lean + lerp(14, 44, e), handY + lerp(12, 4, e), 10);
          circle(lean + lerp(14, 46, e), handY + lerp(12, 4, e), 6);
          hand = { x: lean - 4, y: handY + 16 };
          angle = 2.4;
        } else if (atk) {
          const { wind, ext, rec } = atk;
          if (move === "standLight") {
            // 柄打ち：刀を立てたまま柄で突く
            hand = { x: lean + 20 + 34 * ext, y: handY + 14 - 10 * ext };
            angle = lerp(-1.2, -1.75, ext);
          } else if (move === "standHeavy") {
            // 大振り斬り：頭の後ろまで振りかぶって、前へ水平に振る
            hand = { x: lean + lerp(8, 36, ext), y: handY + lerp(-6, 16, ext) };
            // 戻りは振り抜いた所から元の構えへ
            angle = rec ? lerp(-0.55, 0.05, ext) : ext > 0 ? 0.05 : lerp(-0.55, -2.5, wind);
            len = ext > 0 ? lerp(84, 112, ext) : 84;
          } else if (move === "crouchLight") {
            // 足元突き：しゃがんで足元へ突く
            hand = { x: lean + 18 + 14 * ext, y: handY + 18 };
            angle = 0.35;
            len = lerp(70, 88, ext);
          } else if (move === "crouchHeavy") {
            // 足払い斬り：後ろから地面すれすれを払う
            hand = { x: lean + lerp(4, 28, ext), y: handY + 22 };
            angle = rec ? lerp(0.4, 0.3, ext) : ext > 0 ? 0.3 : lerp(0.4, 2.6, wind);
            len = 96;
          } else if (move === "airLight") {
            hand = { x: lean + 22, y: handY + 16 };
            angle = lerp(-0.4, 0.75, Math.max(ext, wind * 0.3));
            len = 80;
          } else if (move === "airHeavy") {
            hand = { x: lean + 18 + 8 * ext, y: handY + 10 };
            angle = ext > 0 ? lerp(-0.4, 0.95, ext) : lerp(-0.5, -2.2, wind);
            len = 94;
          } else if (move === "special") {
            // 飛刃：腰から前へ水平に振り抜いて、斬撃を飛ばす
            hand = { x: lean + lerp(10, 34, Math.max(ext, rec ? 0.8 : 0)), y: handY + 12 };
            angle = rec ? 0.05 : wind < 1 ? lerp(-0.55, 2.4, wind) : 0.05;
            len = 100;
          } else if (move === "crouchSpecial") {
            // 昇り斬り：下から真上へ斬り上げる
            hand = { x: lean + lerp(22, 14, ext), y: handY + lerp(20, -26, ext) };
            angle = rec ? lerp(-0.55, -1.55, ext) : lerp(0.6, -1.55, Math.max(ext, wind * 0.3));
            len = 104;
          }
        } else if (airborne) {
          angle = -0.4;
          len = 76;
        }
        limb(shoulder.x, shoulder.y, hand.x, hand.y, 10);
        sword(hand, angle, len, accent);
      } else {
        // リン：拳法の構え。ガードでは両腕を顔の前にそろえる
        if (guarding) {
          limb(lean, shoulderY + 4, lean + 18, shoulderY - 4, 9);
          limb(lean, shoulderY + 10, lean + 20, shoulderY + 4, 9);
          circle(lean + 20, shoulderY - 6, 6);
          circle(lean + 22, shoulderY + 3, 6);
        } else if (hurt) {
          limb(lean, shoulderY + 4, lean - 16, shoulderY - 10, 9);
          circle(lean - 18, shoulderY - 12, 6);
          limb(lean, shoulderY + 6, lean + 6, handY + 18, 9);
        } else {
          let front = { x: lean + 24, y: handY };
          if (atk && move === "standLight") front = { x: lean + lerp(24, 54, atk.ext), y: handY - 6 * atk.ext };
          if (atk && move === "special") front = { x: lean + lerp(24, 62, atk.ext), y: handY - 4 * atk.ext };
          if ((atk && move === "throw") || throwFollow) {
            // 投げ：両手を前に出して掴む
            const e = throwFollow ? 1 : Math.max(atk.ext, atk.wind * 0.5);
            front = { x: lean + lerp(24, 44, e), y: handY - 4 };
            limb(lean, shoulderY + 10, lean + lerp(14, 40, e), handY + 8, 9);
            circle(lean + lerp(14, 40, e), handY + 8, 6);
          }
          if (atk && move === "airLight") front = { x: lean + lerp(24, 44, atk.ext), y: handY + 26 * atk.ext };
          limb(lean, shoulderY + 4, front.x - 2, front.y, 9);
          circle(front.x, front.y, 6);
          limb(lean, shoulderY + 6, lean + 10, handY + 12, 9);
          circle(lean + 12, handY + 12, 6);
        }
        // 鉢巻（差し色）。後ろの端が風になびく
        ctx.strokeStyle = accent;
        limb(lean - headR, headY - 3, lean + headR, headY - 5, 4);
        const wave = Math.sin(state.frame * 0.3) * 5;
        const flap = airborne ? 10 : 0;
        limb(lean - headR, headY - 3, lean - headR - 18, headY + 2 + wave - flap, 3);
        limb(lean - headR, headY - 2, lean - headR - 14, headY + 9 - wave - flap, 3);
        ctx.strokeStyle = "#000";
      }

      // ガード中だとわかるよう、体の前に薄い光の弧を出す
      if (guarding) {
        ctx.strokeStyle = p === POSE.BLOCK ? "rgba(160, 220, 255, 0.9)" : "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = p === POSE.BLOCK ? 5 : 3;
        ctx.beginPath();
        const midY = crouching ? -h * 0.45 : -h * 0.6;
        ctx.arc(w / 2 + 10, midY, h * 0.45, -0.8, 0.8);
        ctx.stroke();
      }

      ctx.restore();
    }

    // 飛び道具（飛刃）：差し色の三日月
    function drawProjectiles(state) {
      for (const p of state.projectiles) {
        const owner = state.fighters[p.owner];
        const other = state.fighters[1 - p.owner];
        const accent = p.owner === 1 && other.charId === owner.charId ? ACCENT_MIRROR[owner.charId] : ACCENT[owner.charId];
        const x = p.x / C.SCALE;
        const y = p.y / C.SCALE;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(p.facing, 1);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.w / 2, p.h / 2 + 6, 0, -Math.PI / 2, Math.PI / 2);
        ctx.ellipse(-8, 0, p.w / 2 - 6, p.h / 2, 0, Math.PI / 2, -Math.PI / 2, true);
        ctx.fill();
        // 尾
        ctx.globalAlpha = 0.35;
        ctx.fillRect(-p.w / 2 - 26, -3, 30, 6);
        ctx.restore();
      }
    }

    // 当たった火花（白とオレンジ）、ガードの火花（青白）、文字（投げ抜け）
    function drawEffects(state) {
      for (const e of state.effects) {
        if (e.kind === "text") {
          ctx.save();
          ctx.globalAlpha = Math.min(1, e.life / 15);
          ctx.font = "bold 28px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 6;
          ctx.strokeStyle = "rgba(0,0,0,0.8)";
          ctx.strokeText(e.text, e.x, e.y - (45 - e.life) * 0.5);
          ctx.fillStyle = "#bfe6ff";
          ctx.fillText(e.text, e.x, e.y - (45 - e.life) * 0.5);
          ctx.restore();
          continue;
        }
        const t = e.life / 14;
        const r = (e.kind === "hit" ? 26 : 20) * (1.3 - t * 0.5);
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.globalAlpha = Math.min(1, t * 1.5);
        ctx.fillStyle = e.kind === "hit" ? "#fff3c4" : "#bfe6ff";
        ctx.strokeStyle = e.kind === "hit" ? "#ff8a2a" : "#4da6ff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const rr = i % 2 === 0 ? r : r * 0.4;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // 当たり判定を見えるようにする（Hキー）。青＝やられる範囲、赤＝当たる範囲、緑＝投げの掴める範囲、黄色の点線＝影縫い範囲
    function drawBoxes(state) {
      for (const f of state.fighters) {
        for (const body of [SF.game.hurtbox(f), SF.game.limbHurtbox(f)]) {
          if (!body) continue;
          ctx.fillStyle = "rgba(60, 140, 255, 0.25)";
          ctx.strokeStyle = "rgba(60, 140, 255, 0.9)";
          ctx.lineWidth = 1;
          ctx.fillRect(body.left, body.top, body.right - body.left, body.bottom - body.top);
          ctx.strokeRect(body.left, body.top, body.right - body.left, body.bottom - body.top);
        }
        const zone = SF.game.shadowStitchBox(f);
        if (zone) {
          // 影縫い範囲（黄色の点線）
          ctx.strokeStyle = "rgba(255, 220, 40, 0.95)";
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(zone.left, zone.top, zone.right - zone.left, zone.bottom - zone.top);
          ctx.setLineDash([]);
        }
        const box = SF.game.hitbox(f);
        if (box) {
          ctx.fillStyle = "rgba(255, 40, 40, 0.35)";
          ctx.strokeStyle = "rgba(255, 40, 40, 1)";
          ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
          ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
        }
        const grab = SF.game.grabBox(f);
        if (grab) {
          // 投げの掴める範囲（緑）
          ctx.fillStyle = "rgba(60, 230, 120, 0.3)";
          ctx.strokeStyle = "rgba(60, 230, 120, 1)";
          ctx.fillRect(grab.left, grab.top, grab.right - grab.left, grab.bottom - grab.top);
          ctx.strokeRect(grab.left, grab.top, grab.right - grab.left, grab.bottom - grab.top);
        }
      }
      for (const p of state.projectiles) {
        const box = SF.game.projectileBox(p);
        ctx.fillStyle = "rgba(255, 40, 40, 0.35)";
        ctx.strokeStyle = "rgba(255, 40, 40, 1)";
        ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
        ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
      }
    }

    // 連続技の表示：何発つながったかと合計ダメージ（2発以上のとき）
    function drawCombo(state) {
      state.comboInfo.forEach((info, i) => {
        if (!info || info.hits < 2) return;
        ctx.save();
        ctx.globalAlpha = Math.min(1, info.timer / 20);
        ctx.textAlign = i === 0 ? "left" : "right";
        ctx.textBaseline = "top";
        const x = i === 0 ? 40 : C.STAGE_WIDTH - 40;
        ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.font = "bold 34px sans-serif";
        ctx.strokeText(`${info.hits} ヒット`, x, 110);
        ctx.fillStyle = "#ffd24d";
        ctx.fillText(`${info.hits} ヒット`, x, 110);
        ctx.font = "bold 18px sans-serif";
        ctx.strokeText(`${info.damage} ダメージ`, x, 150);
        ctx.fillStyle = "#fff";
        ctx.fillText(`${info.damage} ダメージ`, x, 150);
        ctx.restore();
      });
    }

    // 画面上部：体力バー、名前、残り時間、取ったラウンド数
    function drawHud(state, sideLabels) {
      const r = state.round;
      const barW = 360;
      const barH = 22;
      const top = 20;
      state.fighters.forEach((f, i) => {
        const c = CHARACTERS[f.charId];
        const x = i === 0 ? 40 : C.STAGE_WIDTH - 40 - barW;
        const rate = f.health / c.health;
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(x - 3, top - 3, barW + 6, barH + 6);
        ctx.fillStyle = "#5a1010";
        ctx.fillRect(x, top, barW, barH);
        // 体力は真ん中（時計の側）から減っていく
        ctx.fillStyle = rate > 0.3 ? "#f2d14b" : "#ff5a3c";
        const fillW = Math.round(barW * rate);
        ctx.fillRect(i === 0 ? x + barW - fillW : x, top, fillW, barH);

        ctx.font = "bold 16px sans-serif";
        ctx.textBaseline = "top";
        ctx.textAlign = i === 0 ? "left" : "right";
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 3;
        const label = `${c.name}  ${f.health}`;
        const lx = i === 0 ? x : x + barW;
        ctx.strokeText(label, lx, top + barH + 6);
        ctx.fillText(label, lx, top + barH + 6);
        // だれが動かしているか（あなた／CPU の強さ）
        if (sideLabels && sideLabels[i]) {
          ctx.font = "bold 13px sans-serif";
          ctx.fillStyle = sideLabels[i] === "あなた" ? "#ffd24d" : "#cfe3ff";
          ctx.strokeText(sideLabels[i], lx, top + barH + 28);
          ctx.fillText(sideLabels[i], lx, top + barH + 28);
        }

        // 取ったラウンド数（丸）
        for (let k = 0; k < BATTLE.winsToMatch; k++) {
          const cx = i === 0 ? x + barW - 10 - k * 22 : x + 10 + k * 22;
          ctx.beginPath();
          ctx.arc(cx, top + barH + 16, 7, 0, Math.PI * 2);
          ctx.fillStyle = k < r.wins[i] ? "#f2d14b" : "rgba(0,0,0,0.5)";
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
      // 残り時間
      const sec = Math.ceil(r.timer / C.FPS);
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(C.STAGE_WIDTH / 2 - 40, 10, 80, 50);
      ctx.fillStyle = sec <= 10 ? "#ff6a4a" : "#fff";
      ctx.font = "bold 36px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(sec), C.STAGE_WIDTH / 2, 37);
      ctx.textAlign = "left";
    }

    function bigText(text, y, size, color) {
      ctx.font = `bold ${size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.strokeText(text, C.STAGE_WIDTH / 2, y);
      ctx.fillStyle = color;
      ctx.fillText(text, C.STAGE_WIDTH / 2, y);
      ctx.textAlign = "left";
    }

    // 画面の真ん中の大きな文字（ラウンド開始、KO、勝敗）
    function drawMessages(state) {
      const r = state.round;
      const name = (i) => CHARACTERS[state.fighters[i].charId].name;
      if (r.phase === PHASE.INTRO) {
        if (r.phaseTimer > 35) bigText(`ラウンド ${r.number}`, 200, 56, "#fff");
        else bigText("ファイト！", 200, 64, "#ffd24d");
      } else if (r.phase === PHASE.ROUND_END || r.phase === PHASE.MATCH_END) {
        bigText(r.reason === "ko" ? "KO" : "時間切れ", 180, 72, "#ff5a3c");
        const result = r.winner === "draw" ? "引き分け" : `${name(r.winner)}の勝ち`;
        bigText(result, 250, 36, "#fff");
        if (r.phase === PHASE.MATCH_END) {
          const m = r.matchWinner === "draw" ? "試合は引き分け" : `試合終了：${name(r.matchWinner)}の勝利！`;
          bigText(m, 310, 32, "#ffd24d");
        }
      }
    }

    // 地面の上に、確認用の情報を小さく出す
    function drawDebug(state, info) {
      const me = state.fighters[0];
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.font = "13px sans-serif";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      const pressed = BUTTON_LABELS.filter(([b]) => isDown(info.input, b)).map(([, l]) => l);
      const m = SF.game.moveData(me);
      const now = POSE_LABEL[me.pose] + (m ? `（${m.name}）` : "");
      ctx.fillText(
        `計算 ${info.updatesPerSec}回/秒　描画 ${info.drawsPerSec}回/秒　押しているキー: ${pressed.length ? pressed.join(" ") : "なし"}　いまの動き: ${now}`,
        16,
        C.GROUND_Y + 14,
      );
      const extra = info.mode === "pvc" ? "　3:練習相手にする（押すたびに動きを切り替え） 4:CPUにもどす" : "";
      ctx.fillText(
        `Esc:一時停止　当たり判定（H）: ${info.showBoxes ? "あり" : "なし"}${extra}`,
        16,
        C.GROUND_Y + 36,
      );
    }

    // ---- メニュー（タイトル・モード選択・キャラ選択）と、試合の上に出す小さなメニュー ----

    const CHAR_NOTE = { kagetsu: "リーチが長く一撃が重い剣士", rin: "速くて手数で攻める拳法家" };
    const LEVEL_NOTE = ["はじめての人に", "慣れてきたら", "腕に自信がある人に"];
    const HINT_MENU = "↑↓ / W S：えらぶ　Enter：決定　Esc：もどる";
    const HINT_SELECT = "↑↓ / W S：項目をえらぶ　←→ / A D：変える　Enter：決定　Esc：もどる";

    // 見本のキャラは、試合と同じ描き方で描く。キャラの組み合わせごとに状態を作っておく
    const previews = {};
    function previewState(chars, xs) {
      const key = chars.join("-") + xs.join("-");
      if (!previews[key]) {
        const st = SF.game.createGame(1, chars);
        st.fighters.forEach((f, i) => (f.x = xs[i] * C.SCALE));
        previews[key] = st;
      }
      return previews[key];
    }
    function drawPreview(chars, xs, tick) {
      const st = previewState(chars, xs);
      st.frame = tick; // 鉢巻をなびかせる
      st.fighters.forEach((f, i) => drawFighter(f, i, st));
      return st;
    }

    function text(str, x, y, size, color, align = "center", weight = "bold") {
      ctx.font = `${weight} ${size}px sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    }
    function outlined(str, x, y, size, color, align = "center") {
      ctx.font = `bold ${size}px sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(3, size / 8);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.strokeText(str, x, y);
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    }
    function panel(x, y, w, h, selected) {
      ctx.fillStyle = selected ? "rgba(0, 0, 0, 0.8)" : "rgba(20, 12, 20, 0.72)";
      ctx.fillRect(x, y, w, h);
      ctx.lineWidth = selected ? 3 : 1;
      ctx.strokeStyle = selected ? "#ffd24d" : "rgba(255, 255, 255, 0.25)";
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    function dim(alpha) {
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
      ctx.fillRect(0, 0, C.STAGE_WIDTH, C.STAGE_HEIGHT);
    }
    function hint(str) {
      text(str, C.STAGE_WIDTH / 2, C.STAGE_HEIGHT - 24, 15, "rgba(255, 255, 255, 0.8)", "center", "normal");
    }

    function drawTitle(tick) {
      drawBackground();
      drawPreview(["kagetsu", "rin"], [C.STAGE_WIDTH * 0.3, C.STAGE_WIDTH * 0.7], tick);
      // 上を少し暗くして文字を読みやすく
      const shade = ctx.createLinearGradient(0, 0, 0, 260);
      shade.addColorStop(0, "rgba(10, 5, 25, 0.75)");
      shade.addColorStop(1, "rgba(10, 5, 25, 0)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, C.STAGE_WIDTH, 260);
      outlined("シルエット格闘", C.STAGE_WIDTH / 2, 110, 84, "#fff");
      text("S I L H O U E T T E   F I G H T E R", C.STAGE_WIDTH / 2, 172, 18, "#ffd8a0");
      // 点滅する「スタート」
      if (Math.floor(tick / 30) % 2 === 0) outlined("Enterキーでスタート", C.STAGE_WIDTH / 2, 236, 28, "#ffd24d");
      hint("（画面をクリックしてから操作してください）");
    }

    function drawModeSelect(menu, tick) {
      drawBackground();
      drawPreview(["kagetsu", "rin"], [C.STAGE_WIDTH * 0.3, C.STAGE_WIDTH * 0.7], tick);
      dim(0.5);
      outlined("モードをえらぶ", C.STAGE_WIDTH / 2, 70, 36, "#fff");
      const w = 560;
      const h = 100;
      const x = (C.STAGE_WIDTH - w) / 2;
      SF.menu.MODES.forEach((m, i) => {
        const y = 115 + i * 120;
        const sel = i === menu.modeCursor;
        panel(x, y, w, h, sel);
        if (sel) text("▶", x + 34, y + h / 2, 26, "#ffd24d");
        text(m.label, C.STAGE_WIDTH / 2, y + 40, 34, sel ? "#fff" : "rgba(255,255,255,0.55)");
        text(m.note, C.STAGE_WIDTH / 2, y + 76, 17, sel ? "#ffd8a0" : "rgba(255,255,255,0.4)", "center", "normal");
      });
      hint(HINT_MENU);
    }

    function drawCharSelect(menu, tick) {
      const mode = SF.menu.MODES[menu.modeCursor];
      const p = SF.menu.picks(menu);
      const rows = SF.menu.rows(menu);
      const xs = [140, C.STAGE_WIDTH - 140];

      drawBackground();
      dim(0.3);
      drawPreview(p.chars, xs, tick);

      // 左右のキャラの名前と説明、だれが動かすか
      [0, 1].forEach((i) => {
        const id = p.chars[i];
        const who = mode.id === "pvc" && i === 0 ? "あなた" : `CPU ${SF.cpu.LEVELS[p.levels[i]].label}`;
        outlined(who, xs[i], 150, 18, i === 0 && mode.id === "pvc" ? "#ffd24d" : "#cfe3ff");
        outlined(CHARACTERS[id].name, xs[i], 186, 34, "#fff");
        outlined(CHAR_NOTE[id] || "", xs[i], 220, 14, "#ffd8a0");
        // 同じキャラ同士のときは、右の差し色が変わることを知らせる
        if (i === 1 && p.chars[0] === p.chars[1]) outlined("（同キャラ：差し色が変わります）", xs[i], 242, 12, "#ddd");
      });

      outlined("キャラと強さをえらぶ", C.STAGE_WIDTH / 2, 44, 30, "#fff");
      text(mode.label, C.STAGE_WIDTH / 2, 78, 16, "#ffd8a0");

      const w = 340;
      const x = (C.STAGE_WIDTH - w) / 2;
      const rowH = 60;
      const top = 100;
      rows.forEach((row, r) => {
        const y = top + r * (rowH + 8);
        const sel = r === menu.cursor;
        if (row.kind === "start") {
          ctx.fillStyle = sel ? "#ffd24d" : "#7a5a22";
          ctx.fillRect(x, y + 4, w, rowH - 8);
          if (sel) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = "#fff";
            ctx.strokeRect(x + 1.5, y + 5.5, w - 3, rowH - 11);
          }
          text(row.label, C.STAGE_WIDTH / 2, y + rowH / 2, 26, sel ? "#2a1a1a" : "rgba(255,255,255,0.7)");
          return;
        }
        panel(x, y, w, rowH, sel);
        text(row.label, x + 12, y + 15, 13, sel ? "#ffd8a0" : "rgba(255,255,255,0.5)", "left", "normal");
        let value;
        let note = "";
        if (row.kind === "char") value = CHARACTERS[p.chars[row.side]].name;
        else {
          const lv = p.levels[row.side];
          value = SF.cpu.LEVELS[lv].label;
          note = LEVEL_NOTE[lv] || "";
          // 強さを丸の数でも見せる
          for (let k = 0; k < SF.cpu.LEVELS.length; k++) {
            ctx.fillStyle = k <= lv ? "#ff8a4a" : "rgba(255,255,255,0.2)";
            circle(C.STAGE_WIDTH / 2 - 16 + k * 16, y + 52, 4);
          }
        }
        text(value, C.STAGE_WIDTH / 2, y + 34, 22, sel ? "#fff" : "rgba(255,255,255,0.7)");
        if (note) text(note, x + w - 12, y + 15, 12, sel ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.4)", "right", "normal");
        if (sel) {
          // 左右で変えられることを示す矢印（端の強さでは、それ以上いけない側を薄く）
          const lv = p.levels[row.side];
          const canL = row.kind === "char" || lv > 0;
          const canR = row.kind === "char" || lv < SF.cpu.LEVELS.length - 1;
          text("◀", x + 50, y + 34, 18, canL ? "#ffd24d" : "rgba(255,210,77,0.25)");
          text("▶", x + w - 50, y + 34, 18, canR ? "#ffd24d" : "rgba(255,210,77,0.25)");
        }
      });
      hint(HINT_SELECT);
    }

    function drawMenu(menu, tick) {
      ctx.textAlign = "left";
      if (menu.screen === SF.menu.SCREEN.TITLE) drawTitle(tick);
      else if (menu.screen === SF.menu.SCREEN.MODE) drawModeSelect(menu, tick);
      else drawCharSelect(menu, tick);
      ctx.textAlign = "left";
    }

    // 試合の上に出す小さなメニュー（一時停止・試合終了）
    function drawOverlay(o) {
      const w = 300;
      const itemH = 36;
      const h = o.items.length * itemH + 16;
      const x = (C.STAGE_WIDTH - w) / 2;
      let y;
      if (o.kind === "pause") {
        dim(0.55);
        outlined("一時停止", C.STAGE_WIDTH / 2, 170, 44, "#fff");
        y = 220;
      } else {
        y = C.GROUND_Y - h - 4; // 決着の文字の下、地面より上に
      }
      panel(x, y, w, h, true);
      o.items.forEach((item, i) => {
        const iy = y + 8 + i * itemH + itemH / 2;
        const sel = i === o.cursor;
        if (sel) {
          ctx.fillStyle = "rgba(255, 210, 77, 0.2)";
          ctx.fillRect(x + 8, iy - itemH / 2 + 3, w - 16, itemH - 6);
          text("▶", x + 30, iy, 16, "#ffd24d");
        }
        text(item, C.STAGE_WIDTH / 2, iy, 20, sel ? "#fff" : "rgba(255,255,255,0.6)");
      });
      ctx.textAlign = "left";
    }

    return {
      draw(state, info) {
        drawBackground();
        state.fighters.forEach((f, i) => drawFighter(f, i, state));
        drawProjectiles(state);
        if (info.showBoxes) drawBoxes(state);
        drawEffects(state);
        drawHud(state, info.sideLabels);
        drawCombo(state);
        drawMessages(state);
        drawDebug(state, info);
        if (info.overlay) drawOverlay(info.overlay);
      },
      drawMenu,
    };
  }

  SF.renderer = { createRenderer, POSE_LABEL };
})(globalThis);
