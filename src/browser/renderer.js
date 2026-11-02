// ゲームの状態を見て画面に描くだけの部分。状態は書き換えない。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const C = SF.constants;
  const { BUTTON, isDown } = SF.input;
  const { POSE, PHASE } = SF.game;
  const { CHARACTERS, BATTLE } = SF.characters;

  // 差し色：カゲツは刃が青、リンは鉢巻が赤。同じキャラ同士のときは右側を別の色にする
  const ACCENT = { kagetsu: "#4da6ff", rin: "#ff4d4d", genma: "#b25cff", gou: "#ff8c2a" };
  const ACCENT_MIRROR = { kagetsu: "#5cff8a", rin: "#ffd24d", genma: "#ff7ad9", gou: "#5fe0d0" };

  // 画面まわりの色と文字（墨と朱）。明朝は Windows・Mac・Linux それぞれにある書体を順に探す
  const SHU = "#c42c1e"; // 朱
  const PAPER = "#f3ead8"; // 和紙の白
  const INK = "#140a0e"; // 墨
  const FONT_SERIF = '"Yu Mincho", YuMincho, "Hiragino Mincho ProN", "Noto Serif JP", "Noto Serif CJK JP", "IPAMincho", serif';
  const FONT_SANS = '"Hiragino Sans", "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif';

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
    [POSE.WARP]: "ワープ（消えている）",
    [POSE.DASH_RECOVERY]: "止まり際（動けない）",
    [POSE.ATTACK]: "攻撃",
    [POSE.HIT]: "のけぞり",
    [POSE.BLOCK]: "ガードで受け止めた",
    [POSE.LAUNCH]: "空中でやられた",
    [POSE.DOWN]: "ダウン",
    [POSE.THROW]: "投げ",
    [POSE.THROWN]: "投げられている（弱＋強で投げ抜け）",
    [POSE.TECH]: "投げ抜け",
  };

  const KC = SF.keyconfig;

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
    // 今のキーの割り当て（押しているキーの表示と、キーコンフィグ画面で使う）
    let bindings = KC.defaults();
    const keyOf = (button) => KC.buttonLabel(bindings, button);
    const poseLabel = (pose) => (pose === POSE.THROWN ? `投げられている（${keyOf(BUTTON.LIGHT)}＋${keyOf(BUTTON.HEAVY)}で投げ抜け）` : POSE_LABEL[pose]);
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
      if (f.charId === "genma") {
        // ゲンマ：衣を広げて倒れる。角と光る目
        const len = CHARACTERS.genma.height * 0.75;
        ctx.beginPath();
        ctx.moveTo(-len * 0.45, -24);
        ctx.lineTo(len * 0.6, -26);
        ctx.lineTo(len * 0.7, 0);
        ctx.lineTo(-len * 0.4, 0);
        ctx.closePath();
        ctx.fill();
        circle(-len * 0.45 - 12, -14, 13);
        limb(-len * 0.45 - 16, -24, -len * 0.45 - 34, -36, 4);
        ctx.fillStyle = accent;
        ctx.fillRect(-len * 0.45 - 20, -18, 5, 2);
        ctx.fillStyle = "#000";
        return;
      }
      if (f.charId === "gou") {
        // ゴウ：大きな体をあお向けに投げ出す。差し色の帯
        const len = CHARACTERS.gou.height * 0.72;
        limb(-len * 0.42, -16, len * 0.12, -16, 34);
        circle(-len * 0.42 - 16, -16, 15);
        circle(-len * 0.42 - 26, -26, 7); // まげ
        limb(len * 0.12, -12, len * 0.55, -8, 18);
        limb(len * 0.12, -20, len * 0.5, -26, 18);
        ctx.fillStyle = accent;
        ctx.fillRect(len * 0.02, -34, 12, 34);
        ctx.fillStyle = "#000";
        return;
      }
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

    // 異空間の門：縦長の楕円。open は開き具合（0〜1）
    function portal(x, y, rw, rh, open, accent) {
      if (open <= 0) return;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#12001f";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y, rw * open, rh * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // ゲンマ（幻魔）：角のある頭巾と長い衣。足は衣に隠れ、地面から少し浮いている。差し色は目と爪と闇の術
    function drawGenma(f, state, o) {
      const { p, crouching, guarding, hurt, throwFollow, airborne, atk, move, accent } = o;
      let h = o.h;
      const frame = state.frame;
      const warping = p === POSE.WARP;
      const warpRec = p === POSE.DASH_RECOVERY && f.warpDir !== 0;
      // ワープ：消える（薄くなって門に吸い込まれる）・現れる（門から出てくる）
      if (warping || warpRec) {
        const dash = f.warpDir < 0 ? CHARACTERS.genma.backDash : CHARACTERS.genma.forwardDash;
        let alpha;
        if (warping) {
          const t = 1 - f.actionTimer / dash.frames; // 0〜1
          alpha = Math.max(0, 1 - t * 3);
          portal(0, -h * 0.5, 30, h * 0.55, Math.min(1, t * 3) * (1 - Math.max(0, t - 0.7) / 0.3), accent);
          // 出る先にも門が開く（向きは消えたときのまま）
          const dest = f.warpDir * dash.distance;
          portal(dest, -h * 0.5, 30, h * 0.55, Math.max(0, (t - 0.4) / 0.6), accent);
        } else {
          const t = 1 - f.actionTimer / dash.recovery;
          alpha = Math.min(1, 0.3 + t * 1.5);
          portal(0, -h * 0.5, 30, h * 0.55, Math.max(0, 1 - t * 2), accent);
        }
        if (alpha <= 0) return;
        ctx.globalAlpha = alpha;
      }
      if (f.floating) {
        // 浮いている：足元に紫の光
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.2 * Math.sin(frame * 0.4);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.ellipse(0, 4, 26, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (hurt) h = h * 0.95;
      const hover = airborne || crouching ? 0 : 4 + Math.sin(frame * 0.12) * 2; // 少し浮いて上下にゆれる
      ctx.translate(0, -hover);
      const headR = 13;
      const headY = -h + headR;
      const shoulderY = headY + headR + 4;
      const hemY = airborne ? -h * 0.2 : 0;
      let lean = { [POSE.GUARD_STAND]: -4, [POSE.GUARD_CROUCH]: -4, [POSE.BLOCK]: -6, [POSE.HIT]: -14, [POSE.LAUNCH]: -10, [POSE.THROWN]: -12, [POSE.TECH]: -12, [POSE.THROW]: 8, [POSE.WALK_FORWARD]: 3 }[p] || 0;
      if (atk) lean = lerp(-3 * atk.wind, move === "crouchSpecial" ? -4 : 8, atk.ext);

      // 後ろになびく衣のすそ
      const wave = Math.sin(frame * 0.15) * 6;
      ctx.beginPath();
      ctx.moveTo(lean - 10, shoulderY);
      ctx.quadraticCurveTo(-34, (shoulderY + hemY) / 2, -40 + wave, hemY - 2);
      ctx.lineTo(-10, hemY);
      ctx.closePath();
      ctx.fill();
      // 衣（肩から裾へ広がる）
      ctx.beginPath();
      ctx.moveTo(lean - 15, shoulderY);
      ctx.lineTo(lean + 15, shoulderY);
      ctx.lineTo(28, hemY);
      ctx.lineTo(-28, hemY);
      ctx.closePath();
      ctx.fill();
      // 頭巾と角
      circle(lean, headY, headR);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(lean - 4, headY - headR + 3);
      ctx.quadraticCurveTo(lean - 14, headY - headR - 14, lean - 26, headY - headR - 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lean + 4, headY - headR + 2);
      ctx.quadraticCurveTo(lean + 2, headY - headR - 16, lean - 10, headY - headR - 20);
      ctx.stroke();
      // 光る目
      ctx.fillStyle = accent;
      ctx.fillRect(lean + 4, headY - 2, 7, 3);
      ctx.fillStyle = "#000";

      // 腕と爪。hand は手の位置、claw は爪の向き（ラジアン）
      const armFrom = { x: lean + 4, y: shoulderY + 6 };
      let hand = { x: lean + 22, y: shoulderY + 30 };
      let back = { x: lean + 6, y: shoulderY + 36 };
      let claw = 0.3;
      if (guarding) {
        hand = { x: lean + 22, y: shoulderY + 2 };
        back = { x: lean + 20, y: shoulderY + 14 };
        claw = -1.2;
      } else if (hurt) {
        hand = { x: lean - 14, y: shoulderY - 6 };
        claw = -2.2;
      } else if (throwFollow || (atk && move === "throw")) {
        const e = throwFollow ? 1 : Math.max(atk.ext, atk.wind * 0.5);
        hand = { x: lean + lerp(22, 46, e), y: shoulderY + 22 };
        back = { x: lean + lerp(8, 38, e), y: shoulderY + 30 };
        claw = 0;
      } else if (atk) {
        const { wind, ext } = atk;
        if (move === "standLight") {
          hand = { x: lean + lerp(22, 62, ext), y: shoulderY + lerp(30, 20, ext) };
          claw = 0;
        } else if (move === "standHeavy" || move === "airHeavy" || move === "crouchHeavy") {
          hand = { x: lean + lerp(4, 34, ext), y: shoulderY + lerp(-10, 34, Math.max(ext, 0)) };
          claw = lerp(-1.4, 0.8, ext);
        } else if (move === "crouchLight" || move === "airLight") {
          hand = { x: lean + lerp(20, 50, ext), y: move === "airLight" ? shoulderY + lerp(30, 56, ext) : -lerp(30, 10, ext) };
          claw = 0.5;
        } else if (move === "special" || move === "airSpecial" || move === "super") {
          // 手を前にかざして門を開く
          hand = { x: lean + lerp(18, 40, Math.max(ext, wind)), y: shoulderY + 14 };
          claw = -0.2;
        } else if (move === "crouchSpecial") {
          // 手を振り上げて地面の門から柱を立てる
          hand = { x: lean + 26, y: shoulderY + lerp(30, -20, Math.max(ext, wind * 0.6)) };
          claw = -1.3;
        }
      }
      ctx.lineCap = "round";
      limb(armFrom.x, armFrom.y + 4, back.x, back.y, 8);
      limb(armFrom.x, armFrom.y, hand.x, hand.y, 8);
      ctx.strokeStyle = accent;
      for (let k = -1; k <= 1; k++) {
        const a = claw + k * 0.35;
        limb(hand.x, hand.y, hand.x + Math.cos(a) * 14, hand.y + Math.sin(a) * 14, 2.5);
      }
      ctx.strokeStyle = "#000";

      // 闇の術（技の当たる範囲あたりに差し色で描く）
      if (atk) {
        const m = atk.m;
        const e = atk.ext;
        ctx.save();
        ctx.translate(0, hover); // 術は足元を基準に描く
        ctx.globalAlpha *= 0.75;
        ctx.fillStyle = accent;
        ctx.strokeStyle = accent;
        if (move === "standHeavy" && e > 0) {
          // 影の鎌：前に大きな弧
          ctx.lineWidth = 8 * e;
          ctx.beginPath();
          ctx.arc(m.hitbox.x1 + 30, -105, 70, -1.1, 0.9 * e);
          ctx.stroke();
        } else if (move === "crouchHeavy" && e > 0) {
          // 闇溜まり：足元に広がる闇
          ctx.beginPath();
          ctx.ellipse((m.hitbox.x1 + m.hitbox.x2) / 2, -6, ((m.hitbox.x2 - m.hitbox.x1) / 2) * e, 10, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (move === "crouchSpecial") {
          // 闇柱：地面の門から柱が立つ
          const cx = (m.hitbox.x1 + m.hitbox.x2) / 2;
          const half = (m.hitbox.x2 - m.hitbox.x1) / 2;
          ctx.restore();
          ctx.save();
          ctx.translate(0, hover);
          portal(cx, -4, half + 6, 8, Math.max(atk.wind, e), accent);
          if (e > 0) {
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = accent;
            ctx.fillRect(cx - half * 0.7, -m.hitbox.y2 * e, half * 1.4, m.hitbox.y2 * e);
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = "#12001f";
            ctx.fillRect(cx - half * 0.3, -m.hitbox.y2 * e, half * 0.6, m.hitbox.y2 * e);
          }
        } else if ((move === "special" || move === "airSpecial" || move === "super") && !atk.rec) {
          // 異空間弾：門が先に開いてから弾が出る（弾が出たら門は効果として残る）
          const pr = m.projectile;
          ctx.restore();
          ctx.save();
          ctx.translate(0, hover);
          portal(pr.spawnX, -pr.y, pr.width * 0.6, pr.height, atk.wind, accent);
        }
        ctx.restore();
      }

      if (guarding) {
        ctx.strokeStyle = p === POSE.BLOCK ? "rgba(160, 220, 255, 0.9)" : "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = p === POSE.BLOCK ? 5 : 3;
        ctx.beginPath();
        const midY = crouching ? -h * 0.45 : -h * 0.6;
        ctx.arc(o.w / 2 + 10, midY, h * 0.45, -0.8, 0.8);
        ctx.stroke();
      }
    }

    // ゴウ（剛）：大きな体の力士風の大男。頭にまげ、腰に差し色の帯。太い腕で張り手と掴み
    function drawGou(f, state, o) {
      const { p, crouching, guarding, hurt, throwFollow, atk, move, accent } = o;
      const h = o.h;
      const frame = state.frame;
      const airborne = o.airborne;
      const m = atk && atk.m;
      // 踏ん張りの間は体のまわりが差し色に光る
      if (m && m.armor && !f.armorUsed && f.moveFrame >= m.armor.from && f.moveFrame <= m.armor.to) {
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(frame * 0.9);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(0, -h * 0.5, o.w * 0.95, h * 0.58, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // 大地落とし：突進中は後ろに差し色の土煙の帯
      if (move === "super" && !atk.rec && f.moveFrame >= 2 && !f.grab) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = accent;
        const trail = Math.min(f.moveFrame - 1, 14) * 14;
        ctx.fillRect(-trail, -h * 0.5, trail, 12);
        ctx.fillRect(-trail * 0.8, -20, trail * 0.8, 10);
        ctx.restore();
      }
      const headR = 15;
      const stomp = move === "crouchHeavy";
      const headY = -h + headR;
      const shoulderY = headY + headR + 4;
      const hipY = airborne ? -h * 0.42 : crouching ? -h * 0.38 : -h * 0.42;
      let lean = { [POSE.GUARD_STAND]: -4, [POSE.GUARD_CROUCH]: -4, [POSE.BLOCK]: -6, [POSE.WALK_FORWARD]: 3, [POSE.STEP]: 12, [POSE.BACKSTEP]: -8, [POSE.HIT]: -12, [POSE.LAUNCH]: -10, [POSE.THROWN]: -12, [POSE.TECH]: -12, [POSE.THROW]: 6 }[p] || 0;
      if (atk) {
        const fwd = { standLight: 8, standHeavy: 14, crouchLight: 4, crouchHeavy: 2, special: 10, throw: 8, super: 22, crouchSpecial: -6, airHeavy: 14 }[move] || 4;
        lean = lerp(-4 * atk.wind, fwd, atk.ext);
      }
      if (f.grab) lean = -2;
      const legW = 18;
      // 足：がに股で太い。四股踏みは前の足を高く上げてから踏み下ろす
      if (airborne) {
        if (move === "airHeavy") {
          // ボディプレス：体を前に倒し、足を後ろへ
          limb(-8, hipY, -34, hipY + 14, legW);
          limb(8, hipY, -20, hipY + 26, legW);
        } else {
          limb(-10, hipY, -20, hipY + 24, legW);
          limb(-20, hipY + 24, -10, hipY + 42, legW);
          limb(10, hipY, 22, hipY + 22, legW);
          limb(22, hipY + 22, 14, hipY + 40, legW);
        }
      } else if (stomp) {
        const raise = atk.ext > 0 || atk.rec ? 0 : atk.wind;
        limb(-10, hipY, -26, 0, legW);
        limb(10, hipY, lerp(30, 40, raise), lerp(0, hipY + 10, raise), legW);
      } else if (crouching) {
        limb(-10, hipY, -30, -26, legW);
        limb(-30, -26, -24, 0, legW);
        if (move === "crouchLight") {
          limb(10, hipY, lerp(30, 96, atk.ext), lerp(-26, -10, atk.ext), legW);
        } else {
          limb(10, hipY, 30, -26, legW);
          limb(30, -26, 26, 0, legW);
        }
      } else {
        const s = p === POSE.WALK_FORWARD || p === POSE.GUARD_STAND ? Math.sin(frame * 0.18) * 6 : 0;
        const wide = p === POSE.STEP || (atk && (move === "standHeavy" || move === "super" || move === "special")) ? 10 : 0;
        limb(-10, hipY, -24 - s - wide, 0, legW);
        limb(10, hipY, 24 + s + wide, 0, legW);
      }
      // 胴体：肩幅が広く、腹が出ている
      const bodyW = o.w * 0.9;
      ctx.beginPath();
      ctx.moveTo(lean - bodyW / 2, shoulderY);
      ctx.lineTo(lean + bodyW / 2, shoulderY);
      ctx.lineTo(bodyW / 2 + 2, hipY + 6);
      ctx.lineTo(-bodyW / 2 + 2, hipY + 6);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(lean * 0.6 + 6, (shoulderY + hipY) / 2 + 12, bodyW * 0.48, (hipY - shoulderY) * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      // 帯（差し色）
      ctx.fillStyle = accent;
      ctx.fillRect(-bodyW / 2 + 1, hipY - 6, bodyW, 12);
      ctx.fillStyle = "#000";
      // 頭とまげ
      circle(lean, headY, headR);
      ctx.beginPath();
      ctx.ellipse(lean - 4, headY - headR - 2, 9, 5, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // 腕：太い腕と大きな手のひら
      const sh = { x: lean + 8, y: shoulderY + 8 };
      const sh2 = { x: lean - 6, y: shoulderY + 10 };
      let front = { x: lean + 30, y: shoulderY + 40 };
      let back = { x: lean + 14, y: shoulderY + 48 };
      let palm = 9;
      if (f.grab) {
        // 掴んだ相手を頭の上に持ち上げる
        front = { x: lean + 10, y: headY - 34 };
        back = { x: lean - 10, y: headY - 34 };
      } else if (guarding) {
        front = { x: lean + 32, y: shoulderY + 4 };
        back = { x: lean + 30, y: shoulderY + 22 };
      } else if (hurt) {
        front = { x: lean - 20, y: shoulderY - 8 };
        back = { x: lean - 24, y: shoulderY + 20 };
      } else if (throwFollow) {
        front = { x: lean + 44, y: shoulderY + 50 };
        back = { x: lean + 36, y: shoulderY + 58 };
      } else if (atk) {
        const { wind, ext } = atk;
        if (move === "standLight") {
          front = { x: lean + lerp(30, m.hitbox.x2 - 10, ext), y: shoulderY + lerp(40, 18, ext) };
          palm = 12;
        } else if (move === "standHeavy") {
          front = ext > 0 || atk.rec ? { x: lean + lerp(30, m.hitbox.x2 - 12, ext), y: shoulderY + lerp(30, 14, ext) } : { x: lean - lerp(0, 26, wind), y: shoulderY + lerp(30, -10, wind) };
          back = { x: lean + 6, y: shoulderY + 40 };
          palm = 15;
        } else if (move === "special" || move === "throw" || move === "super") {
          // 掴みかかる：両手を前に大きく広げる
          const e = Math.max(ext, wind * 0.6);
          front = { x: lean + lerp(30, 70, e), y: shoulderY + 22 };
          back = { x: lean + lerp(14, 62, e), y: shoulderY + 44 };
          palm = 11;
        } else if (move === "crouchSpecial") {
          // つかみ上げ：両手を頭の上へ伸ばす
          const e = Math.max(ext, wind);
          front = { x: lean + lerp(30, 40, e), y: lerp(shoulderY + 40, headY - 70, e) };
          back = { x: lean + lerp(14, 20, e), y: lerp(shoulderY + 48, headY - 62, e) };
          palm = 11;
        } else if (move === "airLight") {
          front = { x: lean + lerp(20, 40, ext), y: shoulderY + lerp(30, 64, ext) };
        } else if (move === "airHeavy") {
          front = { x: lean + 44, y: shoulderY + 30 };
          back = { x: lean + 34, y: shoulderY + 44 };
        } else if (move === "crouchLight" || move === "crouchHeavy") {
          front = { x: lean + 30, y: shoulderY + 30 };
          back = { x: lean + 6, y: shoulderY + 34 };
        }
      }
      limb(sh2.x, sh2.y, back.x, back.y, 14);
      circle(back.x, back.y, 9);
      limb(sh.x, sh.y, front.x, front.y, 15);
      circle(front.x, front.y, palm);
      // 四股踏み：踏み下ろした所から地面に差し色の衝撃
      if (stomp && atk.ext > 0) {
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.8 * atk.ext;
        ctx.lineWidth = 4;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.ellipse(70 + k * 18, -2, 30 + k * 16, 8 + k * 3, 0, Math.PI, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (guarding) {
        ctx.strokeStyle = p === POSE.BLOCK ? "rgba(160, 220, 255, 0.9)" : "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = p === POSE.BLOCK ? 5 : 3;
        ctx.beginPath();
        const midY = crouching ? -h * 0.45 : -h * 0.6;
        ctx.arc(o.w / 2 + 10, midY, h * 0.45, -0.8, 0.8);
        ctx.stroke();
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

      // 頭の上に持ち上げられている（ゴウの投げ）：体を横にして、頭の上に寝かせる
      if (p === POSE.THROWN && f.y < (C.GROUND_Y - 20) * C.SCALE) {
        const lift = Math.min(1, (C.GROUND_Y * C.SCALE - f.y) / (120 * C.SCALE));
        ctx.translate(0, -15 * lift);
        ctx.rotate((-Math.PI / 2) * lift);
        ctx.translate(0, (h / 2) * lift);
      }

      if (f.charId === "genma") {
        drawGenma(f, state, { h, w, p, crouching, guarding, hurt, throwFollow, airborne, atk, move, accent });
        ctx.restore();
        return;
      }
      if (f.charId === "gou") {
        drawGou(f, state, { h, w, p, crouching, guarding, hurt, throwFollow, airborne, atk, move, accent });
        ctx.restore();
        return;
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
        const forwardLean = { standHeavy: 10, standLight: 6, crouchLight: 6, crouchHeavy: 8, special: isKagetsu ? 8 : 16, crouchSpecial: -2, throw: 8, super: isKagetsu ? 18 : -6 }[move] || 4;
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
      } else if (p === POSE.STEP || p === POSE.BACKSTEP || (atk && (move === "standHeavy" || move === "special" || move === "super"))) {
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
          } else if (move === "super") {
            // 月影斬：刀を腰に構えて駆け抜け、前へ水平に斬り抜く
            hand = { x: lean + lerp(4, 36, ext), y: handY + lerp(16, 10, ext) };
            angle = rec ? lerp(-0.55, 0.1, ext) : ext > 0 ? 0.1 : lerp(-0.55, 2.6, wind);
            len = ext > 0 ? 118 : 90;
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
          // 後ろの手（ふだんは胸の前で構える）
          let back = { from: shoulderY + 6, x: lean + 12, y: handY + 12 };
          if (atk && move === "standLight") front = { x: lean + lerp(24, 54, atk.ext), y: handY - 6 * atk.ext };
          if (atk && move === "special") front = { x: lean + lerp(24, 62, atk.ext), y: handY - 4 * atk.ext };
          if (atk && move === "super") {
            // 練気：両の拳を腰に引いて気をためる
            front = { x: lean + 10, y: handY + 18 };
            back = { from: shoulderY + 8, x: lean - 4, y: handY + 20 };
          }
          if ((atk && move === "throw") || throwFollow) {
            // 投げ：両手を前に出して掴む（後ろの手も前へ伸ばす。腕は2本のまま）
            const e = throwFollow ? 1 : Math.max(atk.ext, atk.wind * 0.5);
            front = { x: lean + lerp(24, 44, e), y: handY - 4 };
            back = { from: shoulderY + 10, x: lean + lerp(14, 40, e), y: handY + 8 };
          }
          if (atk && move === "airLight") front = { x: lean + lerp(24, 44, atk.ext), y: handY + 26 * atk.ext };
          limb(lean, shoulderY + 4, front.x - 2, front.y, 9);
          circle(front.x, front.y, 6);
          limb(lean, back.from, back.x - 2, back.y, 9);
          circle(back.x, back.y, 6);
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

      // 月影斬：駆け抜けた跡に、差し色の残像の帯を残す
      if (isKagetsu && atk && move === "super" && !atk.rec && f.moveFrame >= 4) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = accent;
        const trail = Math.min(f.moveFrame - 3, 14) * 17;
        ctx.fillRect(-trail, -h * 0.62, trail, 10);
        ctx.fillRect(-trail * 0.7, -h * 0.4, trail * 0.7, 6);
        ctx.restore();
      }
      // 練気（リン）：強くなっている間、体のまわりに差し色の気がゆらめく。出した瞬間は大きく広がる
      if (f.buffTimer > 0) {
        ctx.save();
        ctx.strokeStyle = accent;
        // 出した直後の20Fは大きく広がる（暗転の間も広がったまま）
        const sup = c.moves.super;
        const burst = state.superFreeze > 0 && state.superOwner === index ? 1 : Math.max(0, (f.buffTimer - (sup.buff.frames - 20)) / 20);
        ctx.globalAlpha = 0.45 + 0.25 * Math.sin(state.frame * 0.5) + burst * 0.3;
        ctx.lineWidth = 3 + burst * 4;
        for (let k = 0; k < 3; k++) {
          const flick = Math.sin(state.frame * 0.35 + k * 2) * 6;
          ctx.beginPath();
          ctx.ellipse(0, -h * 0.5, w * (0.75 + k * 0.18 + burst * 0.8) + flick, h * (0.55 + k * 0.06 + burst * 0.4), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      // 最大までためた突進拳：飛び道具をすり抜ける間、体のまわりが差し色に光る
      if (SF.game.fullCharge(f)) {
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(state.frame * 0.8);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(0, -h * 0.5, w * 0.9, h * 0.6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
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
        if (owner.charId === "genma") {
          // 異空間弾：差し色に光る闇の玉。動く向きに尾を引く
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.atan2(p.vy || 0, p.vx));
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.ellipse(-p.w * 0.6, 0, p.w * 0.8, p.h * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#12001f";
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2 - 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          continue;
        }
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
        if (e.kind === "portal") {
          // 飛び道具が出てきた門が、少しの間残って閉じる
          const c = ACCENT[e.charId] || "#b25cff";
          ctx.save();
          ctx.globalAlpha = Math.min(1, e.life / 10);
          portal(e.x, e.y, 22, e.h / 2 + 10, Math.min(1, e.life / 14), e.mirror ? ACCENT_MIRROR[e.charId] : c);
          ctx.restore();
          continue;
        }
        if (e.kind === "superName") {
          // ゲージ技の名前：出した側の頭の上に大きく
          const f = state.fighters[e.owner];
          const other = state.fighters[1 - e.owner];
          const c = e.owner === 1 && other.charId === f.charId ? ACCENT_MIRROR[f.charId] : ACCENT[f.charId];
          ctx.save();
          ctx.globalAlpha = Math.min(1, e.life / 15);
          ctx.font = `bold 44px ${FONT_SERIF}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 8;
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          const x = Math.max(120, Math.min(C.STAGE_WIDTH - 120, f.x / C.SCALE));
          const y = f.y / C.SCALE - SF.game.fighterHeight(f) - 60;
          ctx.strokeText(e.text, x, y);
          ctx.fillStyle = c;
          ctx.fillText(e.text, x, y);
          ctx.restore();
          continue;
        }
        if (e.kind === "text") {
          ctx.save();
          ctx.globalAlpha = Math.min(1, e.life / 15);
          ctx.font = `bold 28px ${FONT_SERIF}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineWidth = 6;
          ctx.strokeStyle = "rgba(0,0,0,0.8)";
          // 画面の端で文字が切れないように、横の位置を内側に寄せる
          const half = ctx.measureText(e.text).width / 2 + 8;
          const tx = Math.max(half, Math.min(C.STAGE_WIDTH - half, e.x));
          ctx.strokeText(e.text, tx, e.y - (45 - e.life) * 0.5);
          ctx.fillStyle = "#bfe6ff";
          ctx.fillText(e.text, tx, e.y - (45 - e.life) * 0.5);
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

    // ---- 見た目の共通部品（墨と朱）----

    // 文字の太さ・大きさを決める。serif＝明朝（見出し・名前）、そうでなければゴシック（説明文）
    function setFont(size, weight = "bold", serif = true) {
      ctx.font = `${weight} ${size}px ${serif ? FONT_SERIF : FONT_SANS}`;
    }
    function text(str, x, y, size, color, align = "center", weight = "bold", serif = false) {
      setFont(size, weight, serif);
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    }
    // 縁取りのある明朝の文字（背景の上でも読める）
    function outlined(str, x, y, size, color, align = "center", serif = true) {
      setFont(size, "bold", serif);
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, size / 7);
      ctx.strokeStyle = "rgba(10, 5, 8, 0.85)";
      ctx.strokeText(str, x, y);
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    }
    // 筆で引いたような形（左右の端が斜めに細くなる帯）。dir＝-1 で左右反転
    function brushPath(x, y, w, h, dir = 1) {
      const pts = [
        [0, h * 0.3],
        [w, 0],
        [w - h * 0.5, h],
        [h * 0.25, h * 0.88],
      ];
      ctx.beginPath();
      pts.forEach(([px, py], k) => {
        const xx = dir === 1 ? x + px : x + w - px;
        if (k === 0) ctx.moveTo(xx, y + py);
        else ctx.lineTo(xx, y + py);
      });
      ctx.closePath();
    }
    // 朱の筆跡（見出しの後ろや、選んでいる項目に敷く）
    function shuStroke(x, y, w, h, alpha = 0.9) {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, `rgba(196, 44, 30, ${alpha})`);
      g.addColorStop(0.75, `rgba(196, 44, 30, ${alpha * 0.85})`);
      g.addColorStop(1, "rgba(196, 44, 30, 0)");
      ctx.fillStyle = g;
      brushPath(x, y, w, h);
      ctx.fill();
    }
    // 落款（赤い四角の判子）。filled＝false なら枠だけ
    function seal(x, y, size, ch, filled = true) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.06);
      if (filled) {
        ctx.fillStyle = SHU;
        ctx.fillRect(-size / 2, -size / 2, size, size);
        text(ch, 0, 1, size * 0.68, PAPER, "center", "bold", true);
      } else {
        ctx.fillStyle = "rgba(10, 5, 8, 0.55)";
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(243, 234, 216, 0.5)";
        ctx.strokeRect(-size / 2 + 1, -size / 2 + 1, size - 2, size - 2);
      }
      ctx.restore();
    }
    // 墨の板（メニューの下地）。上下に細い線を引いて巻物のように
    function inkPanel(x, y, w, h, alpha = 0.72) {
      ctx.fillStyle = `rgba(12, 6, 10, ${alpha})`;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(243, 234, 216, 0.35)";
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y + h - 1, w, 1);
    }
    // メニューの1行。選んでいる行は朱の筆跡を敷いて、左に小さな菱形を置く
    function menuRow(x, y, w, h, sel) {
      ctx.fillStyle = "rgba(12, 6, 10, 0.6)";
      ctx.fillRect(x, y, w, h);
      if (sel) {
        shuStroke(x - 6, y + 2, w + 6, h - 4, 0.95);
        ctx.fillStyle = PAPER;
        ctx.save();
        ctx.translate(x + 14, y + h / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
      }
    }
    function dim(alpha) {
      ctx.fillStyle = `rgba(8, 4, 10, ${alpha})`;
      ctx.fillRect(0, 0, C.STAGE_WIDTH, C.STAGE_HEIGHT);
    }
    // 画面のいちばん下の操作のヒント
    function hint(str) {
      text(str, C.STAGE_WIDTH / 2, C.STAGE_HEIGHT - 22, 14, "rgba(243, 234, 216, 0.75)", "center", "normal");
    }
    // 見出し：明朝の大きな文字の下に朱の筆跡
    function heading(str, y, size = 32) {
      setFont(size, "bold", true);
      const w = ctx.measureText(str).width;
      shuStroke(C.STAGE_WIDTH / 2 - w / 2 - 20, y + size * 0.18, w + 60, size * 0.42, 0.85);
      outlined(str, C.STAGE_WIDTH / 2, y, size, PAPER);
    }
    // キーの札（白い角丸の板に黒い文字）。幅を返す
    function keyChip(label, x, y, size = 15) {
      setFont(size, "bold", false);
      const w = Math.max(size * 1.6, ctx.measureText(label).width + size * 0.9);
      const h = size * 1.6;
      ctx.fillStyle = PAPER;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y - h / 2, w, h, 4);
      else ctx.rect(x, y - h / 2, w, h);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x + 2, y + h / 2 - 2, w - 4, 2);
      text(label, x + w / 2, y + 1, size, INK, "center", "bold", false);
      return w;
    }
    // 「{DOWN}＋{LIGHT}」のような書き方を、キーの札と文字に分けて描く。幅を返す（draw＝false なら測るだけ）
    function keyLine(spec, x, y, size = 15, draw = true) {
      let cx = x;
      spec.split(/(\{[A-Z]+\})/).forEach((part) => {
        if (!part) return;
        const m = part.match(/^\{([A-Z]+)\}$/);
        if (m) {
          const label = KC.keyLabel(bindings[m[1]]);
          if (draw) cx += keyChip(label, cx, y, size) + 3;
          else {
            setFont(size, "bold", false);
            cx += Math.max(size * 1.6, ctx.measureText(label).width + size * 0.9) + 3;
          }
        } else {
          setFont(size, "bold", false);
          if (draw) text(part, cx, y, size, PAPER, "left", "bold", false);
          cx += ctx.measureText(part).width + 3;
        }
      });
      return cx - x;
    }
    // 決まった幅で折り返して書く。書いた行数を返す
    function wrapText(str, x, y, maxW, size, color, lineH = size * 1.5) {
      setFont(size, "normal", false);
      const lines = [];
      let line = "";
      for (const ch of str) {
        if (ctx.measureText(line + ch).width > maxW && line) {
          lines.push(line);
          line = ch;
        } else line += ch;
      }
      if (line) lines.push(line);
      lines.forEach((l, k) => text(l, x, y + k * lineH, size, color, "left", "normal", false));
      return lines.length;
    }

    // ---- 試合の表示 ----

    // 連続技の表示：何発つながったかと合計ダメージ（2発以上のとき）
    function drawCombo(state) {
      state.comboInfo.forEach((info, i) => {
        if (!info || info.hits < 2) return;
        ctx.save();
        ctx.globalAlpha = Math.min(1, info.timer / 20);
        const x = i === 0 ? 40 : C.STAGE_WIDTH - 40;
        const align = i === 0 ? "left" : "right";
        outlined(`${info.hits}`, x, 132, 48, PAPER, align);
        setFont(48, "bold", true);
        const nw = ctx.measureText(`${info.hits}`).width;
        outlined("ヒット", i === 0 ? x + nw + 8 : x - nw - 8, 140, 22, "#ffcf6b", align);
        outlined(`${info.damage} ダメージ`, x, 172, 16, PAPER, align, false);
        ctx.restore();
      });
    }

    // ゲージ：画面の下（地面の上）に左右それぞれ。満タンになると金色に脈打って「ゲージ技 I＋O」と出る。
    // リンの練気で強くなっている間は残り時間を白い線で出す
    function drawGauge(state, f, i) {
      const w = 280;
      const h = 14;
      const y = C.GROUND_Y + 26;
      const x = i === 0 ? 40 : C.STAGE_WIDTH - 40 - w;
      const rate = f.gauge / SF.game.GAUGE_FULL;
      const full = SF.game.gaugeFull(f);
      // 名札「気」
      seal(i === 0 ? x + 11 : x + w - 11, y + h / 2, 22, "気", full || rate > 0);
      const bx = i === 0 ? x + 28 : x;
      const bw = w - 28;
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      brushPath(bx, y, bw, h, i === 0 ? 1 : -1);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(243, 234, 216, 0.35)";
      ctx.stroke();
      // 中身は外側（画面の端）から溜まっていく
      const fillW = Math.round(bw * rate);
      ctx.save();
      brushPath(bx, y, bw, h, i === 0 ? 1 : -1);
      ctx.clip();
      if (full) {
        const pulse = 0.5 + 0.5 * Math.sin(state.frame / 5);
        ctx.fillStyle = `rgb(${232 + 23 * pulse}, ${176 + 60 * pulse}, ${74 + 100 * pulse})`;
      } else ctx.fillStyle = SHU;
      ctx.fillRect(i === 0 ? bx : bx + bw - fillW, y, fillW, h);
      // 4つの区切り
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      for (let k = 1; k < 4; k++) ctx.fillRect(bx + (bw * k) / 4, y, 2, h);
      const sup = CHARACTERS[f.charId].moves.super;
      if (f.buffTimer > 0 && sup && sup.buff) {
        const tw = Math.round((bw * f.buffTimer) / sup.buff.frames);
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.fillRect(i === 0 ? bx : bx + bw - tw, y + h - 4, tw, 4);
      }
      ctx.restore();
      let note = null;
      if (f.buffTimer > 0 && sup && sup.buff) note = `${sup.name} のこり${Math.ceil(f.buffTimer / C.FPS)}秒`;
      else if (full) note = `ゲージ技 ${keyOf(BUTTON.HEAVY)}＋${keyOf(BUTTON.SPECIAL)}`;
      if (note) outlined(note, i === 0 ? x : x + w, y - 12, 15, full ? "#ffcf6b" : PAPER, i === 0 ? "left" : "right", false);
    }

    // 体力の「減ったばかりの分」を朱で少し残してから縮める（どれだけ減ったか目で追えるように）
    const trail = [0, 0];
    const trailWait = [0, 0];
    const lastHealth = [0, 0];
    function updateTrail(state) {
      state.fighters.forEach((f, i) => {
        const max = CHARACTERS[f.charId].health;
        if (f.health < lastHealth[i]) trailWait[i] = 0; // 減ったばかりなら少し待つ
        lastHealth[i] = f.health;
        if (f.health >= trail[i] || trail[i] > max) trail[i] = f.health; // 回復（次のラウンド）や最初はそろえる
        else if (trailWait[i] < 30) trailWait[i] += 1;
        else trail[i] = Math.max(f.health, trail[i] - max * 0.008);
      });
    }

    // 画面上部：体力バー（筆の帯）、名前、だれが動かしているか、取ったラウンド（判子）、残り時間
    function drawHud(state, sideLabels) {
      const r = state.round;
      const barW = 370;
      const barH = 22;
      const top = 22;
      updateTrail(state);
      state.fighters.forEach((f, i) => {
        const c = CHARACTERS[f.charId];
        const x = i === 0 ? 40 : C.STAGE_WIDTH - 40 - barW;
        const dir = i === 0 ? -1 : 1; // 太い側を真ん中（時計の側）に
        const rate = f.health / c.health;
        const trailRate = trail[i] / c.health;
        // 下地
        ctx.fillStyle = "rgba(10, 5, 8, 0.75)";
        brushPath(x - 4, top - 4, barW + 8, barH + 8, dir);
        ctx.fill();
        ctx.save();
        brushPath(x, top, barW, barH, dir);
        ctx.clip();
        ctx.fillStyle = "#3a0c0c";
        ctx.fillRect(x, top, barW, barH);
        // 体力は真ん中（時計の側）から減っていく
        const tW = Math.round(barW * trailRate);
        ctx.fillStyle = SHU;
        ctx.fillRect(i === 0 ? x + barW - tW : x, top, tW, barH);
        const fillW = Math.round(barW * rate);
        ctx.fillStyle = rate > 0.3 ? PAPER : "#ff9a5a";
        ctx.fillRect(i === 0 ? x + barW - fillW : x, top, fillW, barH);
        // 上半分を少し明るく（つや）
        ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
        ctx.fillRect(x, top, barW, barH * 0.35);
        ctx.restore();

        // 名前とだれが動かしているか
        const lx = i === 0 ? x : x + barW;
        const align = i === 0 ? "left" : "right";
        outlined(c.name, lx, top + barH + 20, 22, PAPER, align);
        if (sideLabels && sideLabels[i]) {
          setFont(22, "bold", true);
          const nw = ctx.measureText(c.name).width;
          const you = sideLabels[i] === "あなた";
          outlined(sideLabels[i], i === 0 ? lx + nw + 12 : lx - nw - 12, top + barH + 22, 13, you ? "#ffcf6b" : "#cfe3ff", align, false);
        }

        // 取ったラウンド（判子「勝」）
        for (let k = 0; k < BATTLE.winsToMatch; k++) {
          const cx = i === 0 ? x + barW - 12 - k * 26 : x + 12 + k * 26;
          seal(cx, top + barH + 20, 20, "勝", k < r.wins[i]);
        }
      });
      // 残り時間：墨の丸に明朝の数字
      const sec = state.training ? "∞" : Math.ceil(r.timer / C.FPS);
      const cx = C.STAGE_WIDTH / 2;
      ctx.fillStyle = "rgba(10, 5, 8, 0.85)";
      circle(cx, 38, 32);
      ctx.lineWidth = 2;
      ctx.strokeStyle = sec <= 10 ? SHU : "rgba(243, 234, 216, 0.6)";
      ctx.beginPath();
      ctx.arc(cx, 38, 28, 0, Math.PI * 2);
      ctx.stroke();
      text(String(sec), cx, 40, 32, sec <= 10 ? "#ff7a5a" : PAPER, "center", "bold", true);
      ctx.textAlign = "left";
    }

    function bigText(str, y, size, color) {
      outlined(str, C.STAGE_WIDTH / 2, y, size, color);
      ctx.textAlign = "left";
    }
    // 筆跡を敷いた大きな文字（ラウンド開始など）
    function bannerText(str, y, size, color) {
      setFont(size, "bold", true);
      const w = ctx.measureText(str).width;
      shuStroke(C.STAGE_WIDTH / 2 - (w + 120) / 2, y - size * 0.32, w + 120, size * 0.7, 0.85);
      outlined(str, C.STAGE_WIDTH / 2, y, size, color);
    }

    // 画面の真ん中の大きな文字（ラウンド開始、KO、勝敗）
    function drawMessages(state) {
      const r = state.round;
      const name = (i) => CHARACTERS[state.fighters[i].charId].name;
      if (r.phase === PHASE.INTRO) {
        if (r.phaseTimer > 35) bannerText(`第${r.number}戦`, 200, 60, PAPER);
        else bannerText("勝負！", 200, 72, PAPER);
      } else if (r.phase === PHASE.ROUND_END || r.phase === PHASE.MATCH_END) {
        bigText(r.reason === "ko" ? "KO" : "時間切れ", 176, 80, r.reason === "ko" ? "#ff5a3c" : PAPER);
        const result = r.winner === "draw" ? "引き分け" : `${name(r.winner)}の勝ち`;
        bigText(result, 250, 34, PAPER);
        if (r.phase === PHASE.MATCH_END) {
          const m = r.matchWinner === "draw" ? "試合は引き分け" : `${name(r.matchWinner)}の勝利！`;
          bannerText(m, 310, 34, "#ffcf6b");
        }
      }
    }

    // 確認モード（Hキー）のときだけ、地面の真ん中に確認用の情報を小さく出す
    let lastMove = null; // トレーニング：あなたが最後に出した技
    function drawTraining(state, info) {
      const me = state.fighters[0];
      const m = SF.game.moveData(me);
      if (m) lastMove = { m, key: me.move };
      const x = 40;
      const y = 196;
      if (lastMove) {
        const t = lastMove.m;
        inkPanel(x, y, 250, 76, 0.7);
        text(t.name, x + 12, y + 16, 16, PAPER, "left", "bold", true);
        const rows = [
          `発生 ${t.buff ? "−" : t.startup + "F"}　持続 ${t.buff || t.projectile ? "−" : t.active + "F"}　硬直 ${t.recovery === null ? "着地まで" : t.recovery + "F"}`,
          t.kind === "throw" ? `投げ　${t.noTech ? "投げ抜けできない" : "投げ抜けできる"}` : `当てて ${adv(t.hitAdv)}　ガードされて ${adv(t.blockAdv)}`,
        ];
        rows.forEach((r, k) => text(r, x + 12, y + 40 + k * 20, 12, "rgba(243,234,216,0.85)", "left", "normal"));
      }
      ctx.fillStyle = "rgba(10, 5, 8, 0.7)";
      ctx.fillRect(0, C.STAGE_HEIGHT - 24, C.STAGE_WIDTH, 24);
      text(
        `トレーニング　H：当たり判定（${info.showBoxes ? "表示中" : "なし"}）　G：ゲージ満タン（${info.fullGauge ? "オン" : "オフ"}）　3：相手の動きを変える　4：CPUにする　Esc：一時停止`,
        C.STAGE_WIDTH / 2,
        C.STAGE_HEIGHT - 12,
        12,
        "rgba(243, 234, 216, 0.85)",
        "center",
        "normal",
      );
    }

    function drawDebug(state, info) {
      if (info.training) {
        drawTraining(state, info);
        return;
      }
      if (!info.showBoxes) {
        text(`Esc：一時停止　M：音のオン／オフ`, C.STAGE_WIDTH / 2, C.STAGE_HEIGHT - 16, 12, "rgba(243, 234, 216, 0.5)", "center", "normal");
        return;
      }
      const me = state.fighters[0];
      const pressed = KC.ACTIONS.filter((a) => isDown(info.input, a.button)).map((a) => keyOf(a.button));
      const m = SF.game.moveData(me);
      const now = poseLabel(me.pose) + (m ? `（${m.name}）` : "");
      ctx.fillStyle = "rgba(10, 5, 8, 0.7)";
      ctx.fillRect(0, C.STAGE_HEIGHT - 26, C.STAGE_WIDTH, 26);
      text(
        `確認モード（H で閉じる）　計算 ${info.updatesPerSec}回/秒　描画 ${info.drawsPerSec}回/秒　押しているキー: ${pressed.length ? pressed.join(" ") : "なし"}　いまの動き: ${now}`,
        C.STAGE_WIDTH / 2,
        C.STAGE_HEIGHT - 13,
        12,
        "rgba(255, 255, 255, 0.85)",
        "center",
        "normal",
      );
    }

    // ---- メニュー（タイトル・モード選択・キャラ選択）と、試合の上に出す小さなメニュー ----

    const CHAR_NOTE = { kagetsu: "リーチが長く一撃が重い剣士", rin: "速くて手数で攻める拳法家", genma: "ワープと術で翻弄する悪役", gou: "近づいて投げる力自慢の大男" };
    // キャラ一覧に出す短い説明
    const CHAR_SHORT = { kagetsu: "飛び道具と対空", rin: "速さで攻める", genma: "離れて術で戦う", gou: "投げで大ダメージ" };
    // 判子に使う1文字
    const CHAR_SEAL = { kagetsu: "影", rin: "拳", genma: "冥", gou: "剛" };
    const LEVEL_NOTE = ["はじめての人に", "慣れてきたら", "腕に自信がある人に", "対戦から学んだCPU"];
    const HINT_MENU = "↑↓：えらぶ　Enter：決定　Esc：もどる";
    const HINT_SELECT = "↑↓：項目をえらぶ　←→：変える　Enter：決定　Esc：もどる";
    const SIDE_COLOR = [SHU, "#3d6fb5"]; // あなた（左）＝朱、相手（右）＝藍

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

    function drawTitle(tick) {
      drawBackground();
      drawPreview(["kagetsu", "rin"], [C.STAGE_WIDTH * 0.3, C.STAGE_WIDTH * 0.7], tick);
      // 上を暗くして文字を読みやすく
      const shade = ctx.createLinearGradient(0, 0, 0, 290);
      shade.addColorStop(0, "rgba(10, 5, 20, 0.8)");
      shade.addColorStop(1, "rgba(10, 5, 20, 0)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, C.STAGE_WIDTH, 290);
      // 題字の後ろの朱の筆跡と、横の判子
      shuStroke(170, 128, 640, 36, 0.9);
      outlined("シルエット格闘", C.STAGE_WIDTH / 2, 108, 88, PAPER);
      seal(812, 70, 40, "影");
      text("S I L H O U E T T E   F I G H T E R", C.STAGE_WIDTH / 2, 186, 16, "#ffd8a0", "center", "bold", true);
      // ゆっくり明滅する「スタート」
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(tick / 14);
      outlined("Enter キーで はじめる", C.STAGE_WIDTH / 2, 240, 26, "#ffcf6b");
      ctx.restore();
      text(`ver ${C.VERSION}`, C.STAGE_WIDTH - 16, C.STAGE_HEIGHT - 22, 13, "rgba(243, 234, 216, 0.7)", "right", "normal");
      hint("（画面をクリックしてから操作してください）");
    }

    function drawModeSelect(menu, tick) {
      drawBackground();
      drawPreview(["kagetsu", "rin"], [C.STAGE_WIDTH * 0.66, C.STAGE_WIDTH * 0.86], tick);
      // 左側を墨で暗く
      const shade = ctx.createLinearGradient(0, 0, C.STAGE_WIDTH * 0.62, 0);
      shade.addColorStop(0, "rgba(8, 4, 10, 0.85)");
      shade.addColorStop(0.8, "rgba(8, 4, 10, 0.6)");
      shade.addColorStop(1, "rgba(8, 4, 10, 0)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, C.STAGE_WIDTH, C.STAGE_HEIGHT);
      outlined("モードをえらぶ", 70, 56, 34, PAPER, "left");
      shuStroke(60, 72, 260, 12, 0.85);
      const x = 70;
      const w = 400;
      const h = 46;
      const top = 100;
      SF.menu.MODES.forEach((m, i) => {
        const y = top + i * (h + 8);
        const sel = i === menu.modeCursor;
        menuRow(x, y, w, h, sel);
        text(m.label, x + 34, y + h / 2 + 1, 24, sel ? PAPER : "rgba(243, 234, 216, 0.6)", "left", "bold", true);
      });
      // 選んでいるモードの説明（一か所にまとめて出す）
      const note = SF.menu.MODES[menu.modeCursor].note;
      const ny = top + SF.menu.MODES.length * (h + 8) + 8;
      inkPanel(x, ny, w, 40, 0.6);
      text(note, x + 14, ny + 20, 14, "#ffd8a0", "left", "normal");
      hint(HINT_MENU);
    }

    function drawCharSelect(menu, tick) {
      const mode = SF.menu.MODES[menu.modeCursor];
      const p = SF.menu.picks(menu);
      const rows = SF.menu.rows(menu);
      const xs = [118, C.STAGE_WIDTH - 118];

      drawBackground();
      dim(0.35);
      drawPreview(p.chars, xs, tick);

      // 左右のキャラの名前と説明、だれが動かすか
      [0, 1].forEach((i) => {
        const id = p.chars[i];
        const cfg = SF.menu.matchConfig(menu);
        const you = cfg.levels[i] === null && !(i === 1 && cfg.dummy !== null && cfg.dummy !== undefined);
        let who = you ? "あなた" : `CPU ${SF.cpu.LEVELS[cfg.levels[i]] ? SF.cpu.LEVELS[cfg.levels[i]].label : ""}`;
        if (i === 1 && cfg.dummy !== null && cfg.dummy !== undefined) who = "練習相手";
        seal(xs[i], 118, 44, CHAR_SEAL[id] || "影");
        outlined(who, xs[i], 158, 15, you ? "#ffcf6b" : "#cfe3ff", "center", false);
        outlined(CHARACTERS[id].name, xs[i], 190, 32, PAPER);
        outlined(CHAR_NOTE[id] || "", xs[i], 222, 12, "#ffd8a0", "center", false);
        if (i === 1 && p.chars[0] === p.chars[1]) outlined("（同キャラ：差し色が変わります）", xs[i], 242, 11, "#ddd", "center", false);
      });

      heading("キャラと強さをえらぶ", 36, 28);
      text(mode.id === "training" ? "トレーニング" : `対戦：${SF.menu.VS_TYPES[p.type].label}`, C.STAGE_WIDTH / 2, 70, 13, "#ffd8a0", "center", "normal");

      drawRoster(mode.id === "versus" && SF.menu.VS_TYPES[p.type].id === "cvc" ? "cvc" : "pvc", p, rows[menu.cursor], tick, 86);

      const w = 480;
      const x = (C.STAGE_WIDTH - w) / 2;
      const rowH = rows.length > 5 ? 34 : 38;
      const top = rows.length > 5 ? 230 : 240;
      rows.forEach((row, r) => {
        const y = top + r * (rowH + 6);
        const sel = r === menu.cursor;
        if (row.kind === "start") {
          ctx.fillStyle = sel ? SHU : "rgba(12, 6, 10, 0.7)";
          brushPath(x + 40, y + 2, w - 80, rowH, 1);
          ctx.fill();
          if (!sel) {
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "rgba(196, 44, 30, 0.9)";
            ctx.stroke();
          }
          text(row.label, C.STAGE_WIDTH / 2, y + rowH / 2 + 3, 24, sel ? PAPER : "rgba(243, 234, 216, 0.7)", "center", "bold", true);
          return;
        }
        let value;
        let note = "";
        let off = false; // 今は使われない行（薄く描く）
        if (row.kind === "char") value = CHARACTERS[p.chars[row.side]].name;
        else if (row.kind === "vsType") value = SF.menu.VS_TYPES[p.type].label;
        else if (row.kind === "partner") {
          value = SF.menu.partners()[p.partner].label;
          note = p.partner < SF.dummy.MODES.length ? "決まった動きをくり返す" : "CPUが本気で戦う";
        } else {
          const lv = p.levels[row.side];
          value = SF.cpu.LEVELS[lv].label;
          note = LEVEL_NOTE[lv] || "";
        }
        const under = row.kind === "level" || row.kind === "partner"; // 説明を値の下に書く行
        menuRow(x, y, w, rowH, sel && !off);
        if (sel && off) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = "rgba(243, 234, 216, 0.4)";
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, rowH - 1);
        }
        text(row.label, x + 28, y + rowH / 2, 13, sel ? PAPER : "rgba(243, 234, 216, 0.55)", "left", "normal");
        const vx = x + 260;
        text(value, vx, y + rowH / 2 + (under ? -4 : 1), 20, off ? "rgba(243,234,216,0.3)" : sel ? PAPER : "rgba(243, 234, 216, 0.75)", "center", "bold", true);
        if (row.kind === "level" && SF.cpu.LEVELS[p.levels[row.side]].learned) note = "どの試合からも学ぶCPU";
        if (row.kind === "level") {
          // 強さを判子の数でも見せる
          const lv = p.levels[row.side];
          for (let k = 0; k < SF.cpu.LEVELS.length; k++) {
            ctx.fillStyle = k <= lv ? (sel ? PAPER : "#e07a4a") : "rgba(243,234,216,0.2)";
            ctx.fillRect(x + w - 70 + k * 14, y + rowH / 2 - 4, 9, 9);
          }
        }
        if (note && !under) text(note, x + w - 12, y + rowH / 2, 11, sel ? "rgba(243,234,216,0.85)" : "rgba(243,234,216,0.4)", "right", "normal");
        if (under) text(note, vx, y + rowH - 7, 10, sel ? "rgba(243,234,216,0.8)" : "rgba(243,234,216,0)", "center", "normal");
        if (sel && !off) {
          // 左右で変えられることを示す矢印（端の強さでは、それ以上いけない側を薄く）
          const lv = row.kind === "level" ? p.levels[row.side] : 0;
          let canL = row.kind !== "level" || lv > 0;
          let canR = row.kind !== "level" || lv < SF.cpu.LEVELS.length - 1;
          if (row.kind === "partner") {
            canL = p.partner > 0;
            canR = p.partner < SF.menu.partners().length - 1;
          }
          text("◀", vx - 110, y + rowH / 2, 15, canL ? PAPER : "rgba(243,234,216,0.25)");
          text("▶", vx + 110, y + rowH / 2, 15, canR ? PAPER : "rgba(243,234,216,0.25)");
        }
      });
      hint(HINT_SELECT);
    }

    // キャラ一覧：4人を大きなカードで並べて、今だれを選んでいるか（左右）を札で見せる。キャラの行を選んでいるときは、その側の枠を光らせる
    const rosterStates = {};
    function drawRoster(kind, p, row, tick, top) {
      const ids = Object.keys(CHARACTERS);
      const cw = 116;
      const ch = 136;
      const gap = 10;
      const left = (C.STAGE_WIDTH - (ids.length * cw + (ids.length - 1) * gap)) / 2;
      const sideLabel = kind === "pvc" ? ["あなた", "相手"] : ["左", "右"];
      ids.forEach((id, k) => {
        const cx = left + k * (cw + gap);
        const picked = [0, 1].filter((side) => p.chars[side] === id);
        const focus = row && row.kind === "char" && p.chars[row.side] === id ? row.side : -1;
        // カードの下地：夕焼けを切り取ったような色
        const g = ctx.createLinearGradient(0, top, 0, top + ch);
        g.addColorStop(0, picked.length ? "rgba(90, 30, 40, 0.9)" : "rgba(30, 16, 24, 0.75)");
        g.addColorStop(1, picked.length ? "rgba(200, 90, 60, 0.85)" : "rgba(60, 30, 30, 0.7)");
        ctx.fillStyle = g;
        ctx.fillRect(cx, top, cw, ch);
        ctx.fillStyle = "rgba(10, 5, 8, 0.85)";
        ctx.fillRect(cx, top + ch - 38, cw, 38);
        ctx.lineWidth = focus >= 0 ? 4 : 1;
        ctx.strokeStyle = focus >= 0 ? (focus === 0 ? "#ff6a4a" : "#6fa0ff") : picked.length ? "rgba(243, 234, 216, 0.6)" : "rgba(243, 234, 216, 0.2)";
        ctx.strokeRect(cx + ctx.lineWidth / 2, top + ctx.lineWidth / 2, cw - ctx.lineWidth, ch - ctx.lineWidth);
        // シルエット（試合と同じ描き方）
        if (!rosterStates[id]) {
          const st = SF.game.createGame(1, [id, id]);
          st.fighters[0].x = 0;
          st.fighters[0].y = 0;
          rosterStates[id] = st;
        }
        const st = rosterStates[id];
        st.frame = tick;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, top, cw, ch - 38);
        ctx.clip();
        ctx.globalAlpha = picked.length ? 1 : 0.55;
        ctx.translate(cx + cw / 2, top + ch - 40);
        ctx.scale(0.42, 0.42);
        drawFighter(st.fighters[0], 0, st);
        ctx.restore();
        text(CHARACTERS[id].name, cx + cw / 2, top + ch - 25, 17, picked.length ? PAPER : "rgba(243,234,216,0.6)", "center", "bold", true);
        text(CHAR_SHORT[id] || "", cx + cw / 2, top + ch - 9, 10, picked.length ? "#ffd8a0" : "rgba(255,216,160,0.5)", "center", "normal");
        // 選んでいる側の札（同じキャラ同士なら2つ）
        picked.forEach((side) => {
          setFont(12, "bold", false);
          const tw = ctx.measureText(sideLabel[side]).width + 10;
          const bx = side === 0 ? cx + 4 : cx + cw - 4 - tw;
          ctx.fillStyle = SIDE_COLOR[side];
          ctx.fillRect(bx, top + 4, tw, 18);
          text(sideLabel[side], bx + tw / 2, top + 13, 12, PAPER);
        });
      });
    }

    function drawMenu(menu, tick) {
      ctx.textAlign = "left";
      if (menu.screen === SF.menu.SCREEN.TITLE) drawTitle(tick);
      else if (menu.screen === SF.menu.SCREEN.MODE) drawModeSelect(menu, tick);
      else drawCharSelect(menu, tick);
      ctx.textAlign = "left";
    }

    // キーコンフィグ画面。左に操作の名前、右に今のキー（札）
    function drawKeyConfig(screen, tick) {
      drawBackground();
      dim(0.65);
      heading("キーコンフィグ", 38, 30);
      text("操作をえらんで Enter を押し、使いたいキーを押してください（ほかの操作と同じキーなら入れ替わります）", C.STAGE_WIDTH / 2, 76, 13, "#ffd8a0", "center", "normal");
      const w = 440;
      const x = (C.STAGE_WIDTH - w) / 2;
      const rowH = 36;
      const top = 96;
      KC.ROWS.forEach((row, r) => {
        const y = top + r * (rowH + 4) + (row.kind === "action" ? 0 : 10);
        const sel = r === screen.cursor;
        menuRow(x, y, w, rowH, sel);
        if (row.kind !== "action") {
          text(row.label, C.STAGE_WIDTH / 2, y + rowH / 2 + 1, 18, sel ? PAPER : "rgba(243,234,216,0.6)", "center", "bold", true);
          return;
        }
        text(row.label, x + 34, y + rowH / 2 + 1, 19, sel ? PAPER : "rgba(243,234,216,0.75)", "left", "bold", true);
        if (sel && screen.waiting) {
          if (Math.floor(tick / 20) % 2 === 0) text("キーを押してください", x + w - 16, y + rowH / 2, 16, "#ffcf6b", "right");
          return;
        }
        const label = KC.keyLabel(bindings[row.id]);
        setFont(15, "bold", false);
        const cw = Math.max(24, ctx.measureText(label).width + 13.5);
        keyChip(label, x + w - 16 - cw, y + rowH / 2, 15);
      });
      if (screen.message) text(screen.message, C.STAGE_WIDTH / 2, C.STAGE_HEIGHT - 50, 14, "#cfe3ff", "center", "normal");
      hint(screen.waiting ? "使いたいキーを押す　Esc：やめる" : "↑↓：えらぶ　Enter：キーを変える　Esc：もどる");
      ctx.textAlign = "left";
    }

    // ---- 資料（操作・ルール・キャラごとの技とフレーム）----
    // 行は [キーの書き方, 説明]。キーの書き方の {LIGHT} などは、今の割り当てのキーの札になる
    const CHAR_IDS = Object.keys(CHARACTERS);
    const LIBRARY_PAGES = [
      {
        title: "基本の動き",
        rows: [
          ["{LEFT} {RIGHT}", "左右に移動"],
          ["相手と反対", "立ちガード（相手と反対の向きに歩くとガード）"],
          ["{DOWN}", "しゃがむ（{DOWN}＋相手と反対でしゃがみガード）"],
          ["{JUMP}", "ジャンプ（{LEFT} か {RIGHT} と一緒で斜めジャンプ）"],
          ["前を2回", "ステップ・ダッシュ・ワープ・踏み込み（キャラで変わる）"],
          ["後ろを2回", "バックステップ（ゲンマは後ろへワープ）"],
        ],
        tip: "下段は しゃがみガード、中段と空中攻撃は 立ちガードでしか防げません。",
      },
      {
        title: "攻撃",
        rows: [
          ["{LIGHT}", "弱攻撃（速い）"],
          ["{HEAVY}", "強攻撃（遅いけど痛い）"],
          ["{DOWN}＋{LIGHT} / {HEAVY}", "しゃがみ攻撃（下段）"],
          ["空中で {LIGHT} / {HEAVY}", "空中攻撃（1回のジャンプで1回）"],
          ["{SPECIAL}", "必殺技"],
          ["{DOWN}＋{SPECIAL}", "対空の必殺技（跳んできた相手に）"],
          ["{LIGHT}＋{HEAVY}", "投げ（近くで。投げられたら8F以内に同じ押し方で投げ抜け）"],
        ],
        tip: "ガードを固める相手には投げ、投げようとする相手には攻撃が勝ちます。",
      },
      {
        title: "つなぎとゲージ",
        rows: [
          ["{LIGHT} → {HEAVY}", "当たるかガードされたらつながる（リンは {LIGHT} → {LIGHT} → {HEAVY}）"],
          ["→ {SPECIAL}", "{LIGHT} {HEAVY} {DOWN}＋{LIGHT} の途中で必殺技を出せる（キャンセル）"],
          ["コンボ補正", "連続技は2発目90%、3発目80%…とダメージが下がる"],
          ["ゲージ", "画面の下。攻撃を当てる・受ける・ガードすると溜まる"],
          ["{HEAVY}＋{SPECIAL}", "ゲージが満タン（金色）のときゲージ技"],
          ["消極的", "前に出ず飛び道具だけの時間が5秒続くとゲージが減る"],
        ],
        tip: "ゲージ技はどんな技の途中からでも出せます。体力バーの朱色は今減った分です。",
      },
      ...CHAR_IDS.map((id) => ({ title: CHARACTERS[id].name, char: id })),
      {
        title: "便利なキー",
        rows: [
          ["Esc", "一時停止（音量・資料を見る・キャラ選択・タイトルへ）"],
          ["M", "音のオン／オフ（どの画面でも）"],
          ["H", "当たり判定と、押しているキーなどを表示"],
          ["G", "トレーニング：ゲージをずっと満タンにする"],
          ["3", "相手を練習相手に（押すたびに動きが変わる）"],
          ["4", "練習相手からCPUにもどす"],
        ],
        tip: "3・4 は あなた VS CPU とトレーニングで使えます。試合の操作に割り当てたキーでは働きません。",
      },
      { title: "キーの変更", keys: true },
    ];

    // キャラのページの説明（技の表の下に出す）
    const CHAR_TIPS = {
      kagetsu: "リーチの長い剣士。飛刃で牽制し、跳んできたら昇り斬り。前2回でステップ。ゲージ技の月影斬は出だし10F無敵で、暗転前からガードしていないと防げない。",
      rin: "速い拳法家。突進拳は押してためて離す（最大ためで飛び道具をすり抜け、ガードされても+1）。前2回でダッシュ。練気は6秒間すべての攻撃がキャンセルできる。",
      genma: "術で戦う悪役。異空間弾は離れた所に開く門から出て、空中でも撃てる。前2回でワープ。ジャンプの頂上から押し続けると浮く。冥府球はガードされても押し続ける。",
      gou: "体力1300の投げの大男。張り手はリーチが長い。大張り手は1発だけ攻撃を受け止める（踏ん張り）。岩落とし・つかみ上げ・大地落としは投げ抜けできない。",
    };
    // 技の表に並べる順番と、出し方
    const MOVE_ORDER = [
      ["standLight", "{LIGHT}"],
      ["standHeavy", "{HEAVY}"],
      ["crouchLight", "{DOWN}＋{LIGHT}"],
      ["crouchHeavy", "{DOWN}＋{HEAVY}"],
      ["airLight", "空中 {LIGHT}"],
      ["airHeavy", "空中 {HEAVY}"],
      ["special", "{SPECIAL}"],
      ["airSpecial", "空中 {SPECIAL}"],
      ["crouchSpecial", "{DOWN}＋{SPECIAL}"],
      ["throw", "{LIGHT}＋{HEAVY}"],
      ["super", "{HEAVY}＋{SPECIAL}"],
    ];
    const GUARD_LABEL = { mid: "上下どちらでも", high: "中段（立ち）", low: "下段（しゃがみ）", air: "立ちガード" };
    const adv = (v) => (v === undefined || v === null ? "−" : v === "down" ? "ダウン" : v > 0 ? `+${v}` : String(v));

    function drawCharPage(id, top) {
      const c = CHARACTERS[id];
      const x = 40;
      const w = C.STAGE_WIDTH - 80;
      seal(x + 18, top + 16, 28, CHAR_SEAL[id] || "影");
      text(c.name, x + 42, top + 17, 24, PAPER, "left", "bold", true);
      text(`体力 ${c.health}　${CHAR_NOTE[id] || ""}`, x + 42 + 24 * c.name.length + 12, top + 18, 13, "#ffd8a0", "left", "normal");
      // 列：出し方・技・発生・持続・硬直・当てて・ガードされて・ダメージ・防ぎ方
      const cols = [
        { label: "出し方", x: x + 8, align: "left" },
        { label: "技", x: x + 150, align: "left" },
        { label: "発生", x: x + 350, align: "right" },
        { label: "持続", x: x + 405, align: "right" },
        { label: "硬直", x: x + 470, align: "right" },
        { label: "当てて", x: x + 545, align: "right" },
        { label: "ガードされて", x: x + 640, align: "right" },
        { label: "ダメージ", x: x + 715, align: "right" },
        { label: "防ぎ方", x: x + 735, align: "left" },
      ];
      const ty = top + 44;
      inkPanel(x, ty, w, 24, 0.85);
      cols.forEach((col) => text(col.label, col.x, ty + 12, 12, "#ffcf6b", col.align, "bold"));
      const rowH = 23;
      let y = ty + 26;
      MOVE_ORDER.forEach(([key, how]) => {
        const m = c.moves[key];
        if (!m) return;
        ctx.fillStyle = key === "super" ? "rgba(196, 44, 30, 0.35)" : "rgba(12, 6, 10, 0.55)";
        ctx.fillRect(x, y, w, rowH - 2);
        const cy = y + rowH / 2 - 1;
        keyLine(how, x + 8, cy, 11);
        const isThrow = m.kind === "throw";
        const name = m.name + (key === "super" ? "（ゲージ技）" : "");
        const vals = [
          name,
          m.buff ? "−" : `${m.startup}F`,
          m.buff || m.projectile ? "−" : `${m.active}F`,
          m.recovery === null ? "着地まで" : `${m.recovery}F`,
          isThrow || m.buff ? "−" : adv(m.hitAdv),
          isThrow || m.buff ? "−" : adv(m.blockAdv),
          m.damage ? String(m.damage) : "−",
          isThrow ? (m.noTech ? "投げ抜け不可" : "投げ抜け") : m.buff ? "−" : GUARD_LABEL[m.guard] || "",
        ];
        vals.forEach((v, k) => {
          const col = cols[k + 1];
          let color = "rgba(243,234,216,0.9)";
          if ((k === 4 || k === 5) && /^[+]/.test(v)) color = "#8fe08a";
          if ((k === 4 || k === 5) && /^-/.test(v)) color = "#ff9a7a";
          text(v, col.x, cy, k === 0 ? 13 : 12, color, col.align, k === 0 ? "bold" : "normal", k === 0);
        });
        y += rowH;
      });
      wrapText(CHAR_TIPS[id] || "", x + 4, y + 16, w - 8, 13, "#ffd8a0", 19);
    }

    function drawKeysPage(top) {
      const w = 420;
      const x = (C.STAGE_WIDTH - w) / 2;
      KC.ACTIONS.forEach((a, r) => {
        const y = top + 8 + r * 38;
        inkPanel(x, y, w, 34, 0.55);
        text(a.label, x + 16, y + 17, 17, PAPER, "left", "bold", true);
        const label = KC.keyLabel(bindings[a.id]);
        setFont(15, "bold", false);
        keyChip(label, x + w - 16 - Math.max(24, ctx.measureText(label).width + 13.5), y + 17, 15);
      });
      const by = top + 8 + KC.ACTIONS.length * 38 + 8;
      menuRow(x, by, w, 38, true);
      text("Enter：キーを変える", C.STAGE_WIDTH / 2, by + 20, 18, PAPER, "center", "bold", true);
    }

    function drawLibrary(page, tick) {
      drawBackground();
      dim(0.75);
      heading("資料", 30, 26);
      // ページの見出し（いま見ているページを朱で）
      const pages = LIBRARY_PAGES;
      setFont(13, "bold", true);
      const widths = pages.map((pg) => ctx.measureText(pg.title).width + 20);
      const total = widths.reduce((a, b) => a + b, 0) + (pages.length - 1) * 4;
      let tx = (C.STAGE_WIDTH - total) / 2;
      pages.forEach((pg, k) => {
        const sel = k === page;
        ctx.fillStyle = sel ? SHU : "rgba(12, 6, 10, 0.65)";
        ctx.fillRect(tx, 56, widths[k], 24);
        text(pg.title, tx + widths[k] / 2, 69, 13, sel ? PAPER : "rgba(243,234,216,0.55)", "center", "bold", true);
        tx += widths[k] + 4;
      });
      const pg = pages[page];
      if (pg.char) drawCharPage(pg.char, 92);
      else if (pg.keys) drawKeysPage(92);
      else {
        const x = 90;
        const w = C.STAGE_WIDTH - 180;
        const rowH = 40;
        pg.rows.forEach(([keys, desc], r) => {
          const y = 100 + r * (rowH + 4);
          inkPanel(x, y, w, rowH, 0.55);
          if (/\{/.test(keys)) keyLine(keys, x + 14, y + rowH / 2, 15);
          else text(keys, x + 14, y + rowH / 2, 15, "#ffcf6b", "left", "bold");
          keyLine(desc, x + 230, y + rowH / 2, 14);
        });
        if (pg.tip) {
          const y = 100 + pg.rows.length * (rowH + 4) + 12;
          seal(x + 12, y + 14, 22, "要");
          text(pg.tip, x + 32, y + 14, 14, "#ffd8a0", "left", "normal");
        }
      }
      // 左右の矢印
      const pulse = 0.5 + 0.5 * Math.sin(tick / 10);
      text("◀", 20, 290, 20, `rgba(243,234,216,${0.3 + 0.5 * pulse})`);
      text("▶", C.STAGE_WIDTH - 20, 290, 20, `rgba(243,234,216,${0.3 + 0.5 * pulse})`);
      hint(`←→：ページ（${page + 1} / ${pages.length}）　Esc：もどる`);
      ctx.textAlign = "left";
    }

    // 試合の上に出す小さなメニュー（一時停止・試合終了）
    function drawOverlay(o) {
      const w = 320;
      const itemH = 40;
      const h = o.items.length * (itemH + 4) + 12;
      const x = (C.STAGE_WIDTH - w) / 2;
      let y;
      if (o.kind === "pause") {
        dim(0.6);
        heading("一時停止", 150, 40);
        y = 196;
      } else {
        y = C.GROUND_Y - h + 30; // 決着の文字の下
      }
      inkPanel(x - 16, y, w + 32, h, 0.75);
      o.items.forEach((item, i) => {
        const iy = y + 8 + i * (itemH + 4);
        const sel = i === o.cursor;
        if (sel) menuRow(x, iy, w, itemH, true);
        text(item, C.STAGE_WIDTH / 2, iy + itemH / 2 + 1, 20, sel ? PAPER : "rgba(243,234,216,0.6)", "center", "bold", true);
      });
      ctx.textAlign = "left";
    }

    return {
      draw(state, info) {
        drawBackground();
        // ゲージ技を出した瞬間（暗転）：背景を暗くして、出した側を前に描く
        if (state.superFreeze > 0) {
          ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.65, state.superFreeze * 0.05)})`;
          ctx.fillRect(0, 0, C.STAGE_WIDTH, C.STAGE_HEIGHT);
        }
        const order = state.superFreeze > 0 && state.superOwner >= 0 ? [1 - state.superOwner, state.superOwner] : [0, 1];
        order.forEach((i) => drawFighter(state.fighters[i], i, state));
        drawProjectiles(state);
        if (info.showBoxes) drawBoxes(state);
        drawEffects(state);
        drawHud(state, info.sideLabels);
        state.fighters.forEach((f, i) => drawGauge(state, f, i));
        drawCombo(state);
        drawMessages(state);
        drawDebug(state, info);
        if (info.overlay) drawOverlay(info.overlay);
      },
      drawMenu,
      drawKeyConfig,
      drawLibrary,
      LIBRARY_PAGE_COUNT: LIBRARY_PAGES.length,
      setBindings(b) {
        bindings = Object.assign({}, b);
      },
    };
  }

  SF.renderer = { createRenderer, POSE_LABEL };
})(globalThis);
