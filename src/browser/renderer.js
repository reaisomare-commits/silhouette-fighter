// ゲームの状態を見て画面に描くだけの部分。状態は書き換えない。
(function (root) {
  const SF = (root.SF = root.SF || {});
  const C = SF.constants;
  const { BUTTON, isDown } = SF.input;
  const { POSE } = SF.game;
  const { CHARACTERS } = SF.characters;

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

    // キャラのシルエットを描く。
    // 足元を(0,0)、前（相手の方）を+x、上を-yとした向きで描き、左向きのときは左右反転する
    function drawFighter(f, index, state) {
      const c = CHARACTERS[f.charId];
      const other = state.fighters[1 - index];
      const accent =
        index === 1 && other.charId === f.charId ? ACCENT_MIRROR[f.charId] : ACCENT[f.charId];
      const h = SF.game.fighterHeight(f);
      const w = c.width;
      const p = f.pose;
      const crouching = p === POSE.CROUCH || p === POSE.GUARD_CROUCH;
      const guarding = p === POSE.GUARD_STAND || p === POSE.GUARD_CROUCH;
      const airborne = p === POSE.JUMP;
      const isKagetsu = f.charId === "kagetsu";

      ctx.save();
      ctx.translate(f.x / C.SCALE, f.y / C.SCALE);
      ctx.scale(f.facing, 1);
      ctx.fillStyle = "#000";
      ctx.strokeStyle = "#000";
      ctx.lineCap = "round";

      const headR = isKagetsu ? 13 : 12;
      const headY = -h + headR;
      const shoulderY = headY + headR + 6;
      const hipY = airborne ? -h * 0.45 : crouching ? -h * 0.42 : -h * 0.47;
      const lean = guarding ? -4 : p === POSE.WALK_FORWARD ? 3 : 0; // 構えると少し後ろに引く
      const bodyW = w * 0.55;

      // 足
      const legW = isKagetsu ? 13 : 12;
      const stride = Math.sin(state.frame * 0.25) * 8;
      if (airborne) {
        // 膝をたたむ
        limb(-6, hipY, -14, hipY + 22, legW);
        limb(-14, hipY + 22, -4, hipY + 40, legW);
        limb(6, hipY, 16, hipY + 18, legW);
        limb(16, hipY + 18, 10, hipY + 38, legW);
      } else if (crouching) {
        limb(-6, hipY, -20, -18, legW);
        limb(-20, -18, -14, 0, legW);
        limb(6, hipY, 20, -22, legW);
        limb(20, -22, 18, 0, legW);
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
        const hand = guarding ? { x: lean + 16, y: handY + 6 } : { x: lean + 20, y: handY + 14 };
        limb(lean, shoulderY + 4, hand.x, hand.y, 10);
        let tip;
        if (guarding) tip = { x: hand.x + 10, y: hand.y - 80 };
        else if (airborne) tip = { x: hand.x + 70, y: hand.y - 30 };
        else tip = { x: hand.x + 72, y: hand.y - 44 };
        // 柄（黒）と刃（差し色）
        const gx = hand.x + (tip.x - hand.x) * 0.18;
        const gy = hand.y + (tip.y - hand.y) * 0.18;
        limb(hand.x, hand.y, gx, gy, 6);
        ctx.strokeStyle = accent;
        limb(gx, gy, tip.x, tip.y, 4);
        ctx.strokeStyle = "#000";
      } else {
        // リン：拳法の構え。ガードでは両腕を顔の前にそろえる
        if (guarding) {
          limb(lean, shoulderY + 4, lean + 18, shoulderY - 4, 9);
          limb(lean, shoulderY + 10, lean + 20, shoulderY + 4, 9);
          circle(lean + 20, shoulderY - 6, 6);
          circle(lean + 22, shoulderY + 3, 6);
        } else {
          limb(lean, shoulderY + 4, lean + 22, handY, 9);
          circle(lean + 24, handY, 6);
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
        ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        const midY = crouching ? -h * 0.45 : -h * 0.6;
        ctx.arc(w / 2 + 10, midY, h * 0.45, -0.8, 0.8);
        ctx.stroke();
      }

      ctx.restore();

      // 頭の上に名前
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(c.name, f.x / C.SCALE, f.y / C.SCALE - h - 8);
      ctx.textAlign = "left";
    }

    function drawDebug(state, info) {
      const me = state.fighters[0];
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(10, 10, 360, 152);
      ctx.fillStyle = "#fff";
      ctx.font = "14px sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(`計算: ${info.updatesPerSec} 回/秒（60なら正常）`, 20, 18);
      ctx.fillText(`描画: ${info.drawsPerSec} 回/秒（モニターに合わせて変わる）`, 20, 38);
      ctx.fillText(`経過フレーム: ${state.frame}`, 20, 58);
      const pressed = BUTTON_LABELS.filter(([b]) => isDown(info.input, b)).map(([, l]) => l);
      ctx.fillText(`押しているキー: ${pressed.length ? pressed.join(" ") : "なし"}`, 20, 78);
      ctx.fillText(`種（シード）: ${info.seed}`, 20, 96);
      ctx.fillText(`自分: ${CHARACTERS[me.charId].name}（1キー:カゲツ / 2キー:リン）`, 20, 116);
      ctx.fillText(`いまの動き: ${POSE_LABEL[me.pose]}`, 20, 136);
    }

    return {
      draw(state, info) {
        drawBackground();
        state.fighters.forEach((f, i) => drawFighter(f, i, state));
        drawDebug(state, info);
      },
    };
  }

  SF.renderer = { createRenderer, POSE_LABEL };
})(globalThis);
