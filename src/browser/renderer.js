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
      let hurt = p === POSE.HIT || p === POSE.LAUNCH;
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
      };
      let lean = LEAN[p] || 0;
      if (atk) {
        // 攻撃は振りかぶりで少し後ろ、当たる瞬間に前へ
        const forwardLean = { standHeavy: 10, standLight: 6, crouchLight: 6, crouchHeavy: 8 }[move] || 4;
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
      } else if (p === POSE.STEP || p === POSE.BACKSTEP || (atk && move === "standHeavy")) {
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

    // 当たった火花（白とオレンジ）、ガードの火花（青白）
    function drawEffects(state) {
      for (const e of state.effects) {
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

    // 当たり判定を見えるようにする（Hキー）。青＝やられる範囲、赤＝当たる範囲
    function drawBoxes(state) {
      for (const f of state.fighters) {
        const body = SF.game.hurtbox(f);
        if (body) {
          ctx.fillStyle = "rgba(60, 140, 255, 0.25)";
          ctx.strokeStyle = "rgba(60, 140, 255, 0.9)";
          ctx.lineWidth = 1;
          ctx.fillRect(body.left, body.top, body.right - body.left, body.bottom - body.top);
          ctx.strokeRect(body.left, body.top, body.right - body.left, body.bottom - body.top);
        }
        const box = SF.game.hitbox(f);
        if (box) {
          ctx.fillStyle = "rgba(255, 40, 40, 0.35)";
          ctx.strokeStyle = "rgba(255, 40, 40, 1)";
          ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
          ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
        }
      }
    }

    // 画面上部：体力バー、名前、残り時間、取ったラウンド数
    function drawHud(state) {
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
          bigText("Enterキーでもう一度", 360, 22, "#fff");
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
      ctx.fillText(
        `自分: ${CHARACTERS[me.charId].name}（1:カゲツ / 2:リン）　練習相手（3キー）: ${info.dummyLabel}　当たり判定の表示（Hキー）: ${info.showBoxes ? "あり" : "なし"}　種: ${info.seed}`,
        16,
        C.GROUND_Y + 36,
      );
    }

    return {
      draw(state, info) {
        drawBackground();
        state.fighters.forEach((f, i) => drawFighter(f, i, state));
        if (info.showBoxes) drawBoxes(state);
        drawEffects(state);
        drawHud(state);
        drawMessages(state);
        drawDebug(state, info);
      },
    };
  }

  SF.renderer = { createRenderer, POSE_LABEL };
})(globalThis);
