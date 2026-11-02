// ゲーム全体で使う決まった数値。
// 位置や速度は「1ピクセル = 100」の整数で持つ（小数の誤差で試合がずれないようにするため）。
(function (root) {
  const SF = (root.SF = root.SF || {});

  SF.constants = Object.freeze({
    VERSION: "0.7.1", // ゲームのバージョン（タイトル画面に出す。package.json の version と同じにする）
    FPS: 60, // ゲームの計算は1秒に60回で固定
    SCALE: 100, // 1ピクセルを100として整数で計算する
    STAGE_WIDTH: 960, // 画面の横幅（ピクセル）
    STAGE_HEIGHT: 540, // 画面の縦幅（ピクセル）
    GROUND_Y: 460, // 地面の高さ（ピクセル、上から数える）
    STAGE_MARGIN: 40, // 画面端からこれ以上は外に出られない（ピクセル）
  });
})(globalThis);
