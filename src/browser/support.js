// 画面の下に出す「支援する」「意見を送る」のリンク。
// アカウントを作ったら、下の LINKS の "" の中にページのURLを貼るだけで出ます。
// URLが空のリンクは出ません（全部空なら、この欄そのものが出ません）。
(function (root) {
  const SF = (root.SF = root.SF || {});

  const LINKS = [
    // 支援（投げ銭・月額）のページ。例: "https://www.fanbox.cc/@あなたのID" や "https://ko-fi.com/あなたのID"
    { id: "fanbox", label: "♥ pixivFANBOXで支援", url: "", kind: "support" },
    { id: "kofi", label: "☕ Ko-fiで支援", url: "", kind: "support" },
    { id: "itch", label: "🎮 itch.ioで支援（好きな金額）", url: "", kind: "support" },
    // だれでも書ける意見フォーム（Googleフォームなど）。支援者だけのフォームは支援サイトの限定記事に貼る
    { id: "form", label: "💬 意見・不具合を送る", url: "", kind: "feedback" },
  ];

  const NOTE = "支援してくれた人は、新キャラや調整の希望を送ったり、次に作るものの投票に参加したりできます（必ず採用されるわけではありません）。";

  // URLとして使ってよいか（https のみ）
  function usable(link) {
    return typeof link.url === "string" && /^https:\/\/[^\s"'<>]+$/.test(link.url);
  }

  function mount(doc) {
    const box = doc.getElementById("support");
    if (!box) return;
    const links = LINKS.filter(usable);
    if (!links.length) return; // まだ何も設定していない
    const list = doc.createElement("div");
    list.className = "support-links";
    for (const link of links) {
      const a = doc.createElement("a");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = link.label;
      a.className = link.kind;
      // クリック後にキー操作がリンクに取られないよう、ゲーム画面にフォーカスを返す
      a.addEventListener("click", () => setTimeout(() => a.blur(), 0));
      list.appendChild(a);
    }
    box.appendChild(list);
    if (links.some((l) => l.kind === "support")) {
      const note = doc.createElement("p");
      note.className = "support-note";
      note.textContent = NOTE;
      box.appendChild(note);
    }
    box.hidden = false;
  }

  SF.support = { LINKS, NOTE, usable, mount };
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => mount(root.document));
    else mount(root.document);
  }
})(typeof window !== "undefined" ? window : globalThis);
