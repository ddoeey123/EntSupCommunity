"use strict";

const API = "https://qcwsg5pp5rwjnxp5hw25t3vh2y0tbdbj.lambda-url.ap-northeast-2.on.aws";

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));

const el = {
  dbs: $("#db-state"),
  opn: $("#db-open"),
  ref: $("#db-refresh"),
  inp: $("#db-file"),
  gn: $("#grp-name"),
  gm: $("#grp-meta"),
  gt: $("#grp-tabs"),
  tot: $("#post-total"),
  msg: $("#board-msg"),
  brd: $("#board"),
  lst: $("#post-list"),
  pag: $("#pagination"),
  srt: $("#sort"),
  trm: $("#term"),
  siz: $("#page-size"),
  sch: $("#search"),
  clr: $("#search-clear"),
  lv: $("#list-view"),
  dv: $("#detail-view"),
  dp: $("#detail-post"),
  cl: $("#comment-list"),
  cc: $("#comment-count"),
  bak: $("#detail-back"),
  prv: $("#detail-prev"),
  nxt: $("#detail-next"),
  toa: $("#toast"),
  lod: $("#loading")
};

const st = {
  db: null,
  gs: [],
  gid: null,
  ps: [],
  cs: [],
  cm: new Map(),
  pg: 1,
  n: 10,
  sort: "created",
  term: "all",
  q: "",
  did: null,
  syncing: false,
  tmr: null
};

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jp(v, d) {
  try {
    return v ? JSON.parse(v) : d;
  } catch (_) {
    return d;
  }
}

function txt(v) {
  if (!v) {
    return "";
  }
  const d = new DOMParser().parseFromString(String(v), "text/html");
  d.querySelectorAll("script,style").forEach((x) => x.remove());
  return (d.body.textContent || "").replace(/\s+/g, " ").trim();
}

function key(v) {
  return String(v || "").normalize("NFKC").toLowerCase();
}

function ini(v) {
  const s = String(v || "").trim();
  return s ? Array.from(s)[0].toUpperCase() : "?";
}

function num(v) {
  return new Intl.NumberFormat("ko-KR").format(Number(v) || 0);
}

function day(v, full) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  const opt = full
    ? {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }
    : {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit"
      };
  return new Intl.DateTimeFormat("ko-KR", opt).format(d);
}

function ago(v) {
  if (!v) {
    return "동기화 기록 없음";
  }
  return "DB 갱신 " + day(v, true);
}

function toast(s, bad) {
  clearTimeout(st.tmr);
  el.toa.textContent = s;
  el.toa.className = "toast show" + (bad ? " err" : "");
  st.tmr = setTimeout(() => {
    el.toa.className = "toast";
  }, 3400);
}

function load(on) {
  el.lod.hidden = !on;
}

function rows(q, p) {
  if (!st.db) {
    return [];
  }
  if (q.includes("FROM cmt WHERE post_id=?")) {
    return st.cs.slice().sort((a, b) => new Date(b.created) - new Date(a.created));
  }
  if (q.includes("FROM pst WHERE id=? AND grp_id=?")) {
    return st.ps.filter((x) => x.id === p[0] && x.grp_id === p[1]);
  }
  if (q.includes("FROM pst WHERE id=?")) {
    return st.ps.filter((x) => x.id === p[0]);
  }
  if (q.includes("FROM pst WHERE grp_id=?")) {
    return st.ps.slice();
  }
  if (q.includes("FROM grp")) {
    return st.gs.slice();
  }
  return [];
}

async function api(path, opt) {
  const o = Object.assign(
    {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" }
    },
    opt || {}
  );
  const r = await fetch(API + path, o);
  let d = {};
  try {
    d = await r.json();
  } catch (_) {
    d = {};
  }
  if (!r.ok) {
    throw new Error(d.error || "AWS 요청을 처리하지 못했습니다.");
  }
  return d;
}

async function getPs(gid) {
  const out = [];
  let cur = "";
  do {
    const p = new URLSearchParams({ group: gid });
    if (cur) {
      p.set("cursor", cur);
    }
    const d = await api("/api/data?" + p.toString());
    out.push(...(Array.isArray(d.posts) ? d.posts : []));
    cur = d.next || "";
  } while (cur);
  return out;
}

async function waitSync(gid, old) {
  for (let i = 0; i < 90; i += 1) {
    await new Promise((ok) => setTimeout(ok, 10000));
    const d = await api("/api/status?group=" + encodeURIComponent(gid));
    if (d.status === "error") {
      throw new Error(d.err || "동기화에 실패했습니다.");
    }
    if (d.status === "done" && (!old || d.synced_at !== old)) {
      return d;
    }
  }
  throw new Error("동기화가 오래 걸리고 있습니다. 잠시 후 새로고침해 주세요.");
}

async function reloadDb() {
  if (!st.db || !st.gid || st.syncing) {
    return;
  }
  const s = nav();
  const g = st.gs.find((x) => x.id === st.gid);
  el.ref.classList.add("busy");
  el.ref.disabled = true;
  st.syncing = true;
  try {
    await api("/api/sync?group=" + encodeURIComponent(st.gid), { method: "POST" });
    toast("현재 학급 갱신을 시작했습니다. 완료되면 다시 불러옵니다.");
    await waitSync(st.gid, g && g.synced_at);
    await setGrp(s.gid, false);
    st.sort = s.sort;
    st.term = s.term;
    st.n = s.n;
    st.q = s.q;
    st.pg = s.pg;
    draw();
    if (s.did && rows("SELECT id FROM pst WHERE id=? AND grp_id=?", [s.did, s.gid]).length) {
      await showDtl(s.did, false);
    } else {
      showList(false, false);
    }
    hist(true);
    toast("현재 학급 데이터를 새로 불러왔습니다.");
  } catch (e) {
    toast(e.message || String(e), true);
  } finally {
    st.syncing = false;
    el.ref.classList.remove("busy");
    el.ref.disabled = !st.db;
  }
}

function drawGs() {
  el.gt.innerHTML = st.gs
    .map(
      (g) =>
        '<button class="grp-tab' +
        (g.id === st.gid ? " active" : "") +
        '" type="button" data-id="' +
        esc(g.id) +
        '">' +
        esc(g.lbl) +
        "</button>"
    )
    .join("");
}

async function setGrp(id, push) {
  const g = st.gs.find((x) => x.id === id);
  if (!g) {
    return;
  }
  load(true);
  const ps = await getPs(id);
  st.gid = id;
  st.pg = 1;
  st.did = null;
  st.ps = ps;
  st.cs = [];
  st.cm = new Map();
  st.db = {};
  el.gn.textContent = g.name;
  el.gm.textContent = g.lbl + " · " + g.id + " · " + ago(g.synced_at);
  el.tot.textContent = "게시글 " + num(st.ps.length);
  drawGs();
  showList(false, false);
  draw();
  load(false);
  if (push) {
    hist(false);
  }
}

function cut() {
  const n = new Date();
  if (st.term === "today") {
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  }
  if (st.term === "week") {
    return n.getTime() - 7 * 86400000;
  }
  if (st.term === "month") {
    return n.getTime() - 30 * 86400000;
  }
  return 0;
}

function cmp(a, b) {
  const made = () => new Date(b.created).getTime() - new Date(a.created).getTime();
  if (st.sort === "visit") {
    return Number(b.visit) - Number(a.visit) || made();
  }
  if (st.sort === "likes") {
    return Number(b.likes_len) - Number(a.likes_len) || made();
  }
  if (st.sort === "comments") {
    return Number(b.comments_len) - Number(a.comments_len) || made();
  }
  return made();
}

function flt() {
  const c = cut();
  const q = key(st.q);
  const a = st.ps.filter((p) => {
    const t = new Date(p.created).getTime();
    if (c && (!t || t < c)) {
      return false;
    }
    if (!q) {
      return true;
    }
    return key(p.title + " " + txt(p.content) + " " + (p.nickname || "")).includes(q);
  });
  a.sort(cmp);
  const nt = a.filter((p) => Number(p.notice));
  const rg = a.filter((p) => !Number(p.notice));
  return { all: nt.concat(rg), nt: nt, rg: rg };
}

function pageDat() {
  const d = flt();
  const pin = d.nt.slice(0, st.n);
  const flow = d.nt.slice(st.n).concat(d.rg);
  const cap = st.n - pin.length;
  const left = Math.max(0, flow.length - cap);
  const pages = pin.length || flow.length ? 1 + Math.ceil(left / st.n) : 0;
  st.pg = Math.max(1, Math.min(st.pg, pages || 1));
  let list;
  if (st.pg === 1) {
    list = pin.concat(flow.slice(0, cap));
  } else {
    const s = cap + (st.pg - 2) * st.n;
    list = flow.slice(s, s + st.n);
  }
  return { list: list, pages: pages, total: d.all.length, seq: d.all };
}

function rowHtml(p) {
  const pre = txt(p.content).slice(0, 78);
  const badge = Number(p.notice)
    ? '<span class="notice-badge"><i class="fa-solid fa-bullhorn"></i> 공지</span>'
    : "";
  const com = Number(p.comments_len)
    ? '<span class="comment-num">[' + num(p.comments_len) + "]</span>"
    : "";
  return (
    '<button class="post-row' +
    (Number(p.notice) ? " notice" : "") +
    '" type="button" data-post="' +
    esc(p.id) +
    '">' +
    '<span class="post-title">' +
    '<span class="post-title-main">' +
    badge +
    "<strong>" +
    esc(p.title || "(제목 없음)") +
    "</strong>" +
    com +
    "</span>" +
    '<span class="post-preview">' +
    esc(pre || "본문 내용이 없습니다.") +
    "</span>" +
    "</span>" +
    '<span class="post-author"><span class="avatar">' +
    esc(ini(p.nickname)) +
    "</span><span>" +
    esc(p.nickname || "알 수 없음") +
    "</span></span>" +
    '<time class="post-stat" datetime="' +
    esc(p.created) +
    '">' +
    esc(day(p.created, false)) +
    "</time>" +
    '<span class="post-stat">' +
    num(p.visit) +
    "</span>" +
    '<span class="post-stat">' +
    num(p.likes_len) +
    "</span>" +
    "</button>"
  );
}

function msg(title, body, icon) {
  el.brd.hidden = true;
  el.pag.innerHTML = "";
  el.msg.hidden = false;
  el.msg.innerHTML =
    '<span class="msg-icon"><i class="' +
    esc(icon || "fa-regular fa-face-meh") +
    '"></i></span><strong>' +
    esc(title) +
    "</strong><p>" +
    esc(body) +
    "</p>";
}

function draw() {
  if (!st.db) {
    msg(
      "아직 AWS 데이터가 연결되지 않았습니다.",
      "잠시 후 DynamoDB에서 현재 학급 데이터를 불러옵니다.",
      "fa-solid fa-database"
    );
    return;
  }
  const d = pageDat();
  el.tot.textContent = "게시글 " + num(d.total);
  if (!d.total) {
    msg(
      "조건에 맞는 글이 없습니다.",
      "기간이나 검색어를 바꿔 다시 확인해 주세요.",
      "fa-solid fa-magnifying-glass"
    );
    return;
  }
  el.msg.hidden = true;
  el.brd.hidden = false;
  el.lst.innerHTML = d.list.map(rowHtml).join("");
  drawPag(d.pages);
}

function drawPag(n) {
  if (n <= 1) {
    el.pag.innerHTML = "";
    return;
  }
  const a = [];
  const from = Math.max(1, Math.min(st.pg - 2, n - 4));
  const to = Math.min(n, Math.max(5, st.pg + 2));
  a.push(
    '<button class="page-btn" type="button" data-p="' +
      Math.max(1, st.pg - 1) +
      '"' +
      (st.pg === 1 ? " disabled" : "") +
      ' aria-label="이전 페이지"><i class="fa-solid fa-chevron-left"></i></button>'
  );
  if (from > 1) {
    a.push('<button class="page-btn" type="button" data-p="1">1</button>');
    if (from > 2) {
      a.push('<span class="page-btn">···</span>');
    }
  }
  for (let i = from; i <= to; i += 1) {
    a.push(
      '<button class="page-btn' +
        (i === st.pg ? " active" : "") +
        '" type="button" data-p="' +
        i +
        '">' +
        i +
        "</button>"
    );
  }
  if (to < n) {
    if (to < n - 1) {
      a.push('<span class="page-btn">···</span>');
    }
    a.push(
      '<button class="page-btn" type="button" data-p="' +
        n +
        '">' +
        n +
        "</button>"
    );
  }
  a.push(
    '<button class="page-btn" type="button" data-p="' +
      Math.min(n, st.pg + 1) +
      '"' +
      (st.pg === n ? " disabled" : "") +
      ' aria-label="다음 페이지"><i class="fa-solid fa-chevron-right"></i></button>'
  );
  el.pag.innerHTML = a.join("");
}

function showList(top, push) {
  el.dv.hidden = true;
  el.lv.hidden = false;
  st.did = null;
  document.title = "서포터즈 커뮤니티";
  if (top) {
    el.lv.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (push) {
    hist(false);
  }
}

function cleanBody(v) {
  if (!v) {
    return '<p class="empty-comments">본문 내용이 없습니다.</p>';
  }
  if (window.DOMPurify) {
    const h = DOMPurify.sanitize(v, {
      FORBID_TAGS: ["script", "object", "embed"],
      FORBID_ATTR: ["onerror", "onload", "onclick"]
    });
    const t = document.createElement("template");
    t.innerHTML = h;
    t.content.querySelectorAll("a[href]").forEach((a) => {
      const u = a.getAttribute("href");
      if (!u || u === "#") {
        a.removeAttribute("href");
        return;
      }
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
    return t.innerHTML;
  }
  return "<p>" + esc(txt(v)).replace(/\n/g, "<br>") + "</p>";
}

function arr(v) {
  const x = jp(v, []);
  if (!x) {
    return [];
  }
  return Array.isArray(x) ? x : [x];
}

function cmtHtml(c, rep) {
  const gone = Number(c.removed) || Number(c.hide);
  const body = gone
    ? "삭제되었거나 숨김 처리된 댓글입니다."
    : esc(c.content || "").replace(/\n/g, "<br>");
  return (
    '<div class="comment' +
    (rep ? " reply" : "") +
    '">' +
    '<div class="comment-top"><span class="avatar">' +
    esc(ini(c.nickname)) +
    '</span><span class="comment-meta"><strong>' +
    esc(c.nickname || "알 수 없음") +
    '</strong><time datetime="' +
    esc(c.created) +
    '">' +
    esc(day(c.created, true)) +
    "</time></span></div>" +
    '<div class="comment-content' +
    (gone ? " removed" : "") +
    '">' +
    body +
    "</div>" +
    '<div class="comment-foot"><span><i class="fa-regular fa-heart"></i> ' +
    num(c.likes_len) +
    "</span></div></div>"
  );
}

function drawCmt(p) {
  const cs = rows(
    "SELECT * FROM cmt WHERE post_id=? ORDER BY created DESC",
    [p.id]
  );
  el.cc.textContent = num(cs.length);
  if (!cs.length) {
    const s = Number(p.comments_len)
      ? "공개 댓글 API에서 조회하지 못했거나 아직 수집되지 않은 댓글입니다."
      : "아직 저장된 댓글이 없습니다.";
    el.cl.innerHTML = '<div class="empty-comments">' + esc(s) + "</div>";
    return;
  }
  const top = cs
    .filter((c) => !c.parent_id)
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  const by = new Map();
  cs.filter((c) => c.parent_id).forEach((c) => {
    if (!by.has(c.parent_id)) {
      by.set(c.parent_id, []);
    }
    by.get(c.parent_id).push(c);
  });
  by.forEach((v) => v.sort((a, b) => new Date(a.created) - new Date(b.created)));
  const out = [];
  top.forEach((c) => {
    out.push(cmtHtml(c, false));
    const rs = by.get(c.id) || [];
    if (rs.length) {
      out.push(
        '<button class="reply-toggle" type="button" data-r="' +
          esc(c.id) +
          '"><i class="fa-solid fa-angle-down"></i> 답글 ' +
          num(rs.length) +
          "개 보기</button>"
      );
      out.push(
        '<div class="reply-list" data-r-list="' +
          esc(c.id) +
          '" hidden>' +
          rs.map((r) => cmtHtml(r, true)).join("") +
          "</div>"
      );
    }
  });
  el.cl.innerHTML = out.join("");
}

async function showDtl(id, push) {
  const p = rows("SELECT * FROM pst WHERE id=?", [id])[0];
  if (!p) {
    toast("글을 DB에서 찾을 수 없습니다.", true);
    return;
  }
  st.did = id;
  load(true);
  try {
    if (!st.cm.has(id)) {
      const d = await api(
        "/api/comments?group=" +
          encodeURIComponent(st.gid) +
          "&post=" +
          encodeURIComponent(id)
      );
      st.cm.set(id, Array.isArray(d.comments) ? d.comments : []);
    }
    st.cs = st.cm.get(id) || [];
  } catch (e) {
    st.cs = [];
    toast(e.message || String(e), true);
  } finally {
    load(false);
  }
  const at = arr(p.attachment_json)
    .filter((x) => x && x.filename)
    .map(
      (x) =>
        '<span class="attach-item"><i class="fa-solid fa-paperclip"></i>' +
        esc(x.filename) +
        "</span>"
    )
    .join("");
  const tag = Number(p.notice)
    ? '<span class="detail-label"><i class="fa-solid fa-bullhorn"></i> 공지사항</span>'
    : "";
  el.dp.innerHTML =
    '<div class="post-detail">' +
    tag +
    "<h2>" +
    esc(p.title || "(제목 없음)") +
    "</h2>" +
    '<div class="detail-info">' +
    '<div class="detail-user"><span class="avatar">' +
    esc(ini(p.nickname)) +
    '</span><span><strong>' +
    esc(p.nickname || "알 수 없음") +
    '</strong><time datetime="' +
    esc(p.created) +
    '">' +
    esc(day(p.created, true)) +
    "</time></span></div>" +
    '<div class="detail-stats">' +
    '<span><i class="fa-regular fa-eye"></i> ' +
    num(p.visit) +
    "</span>" +
    '<span><i class="fa-regular fa-heart"></i> ' +
    num(p.likes_len) +
    "</span>" +
    '<span><i class="fa-regular fa-comment"></i> ' +
    num(p.comments_len) +
    "</span>" +
    "</div></div>" +
    '<div class="detail-body">' +
    cleanBody(p.content || p.se_content) +
    "</div>" +
    (at ? '<div class="attach-list">' + at + "</div>" : "") +
    "</div>";
  drawCmt(p);
  const seq = flt().all;
  const i = seq.findIndex((x) => x.id === id);
  el.prv.disabled = i <= 0;
  el.nxt.disabled = i < 0 || i >= seq.length - 1;
  el.prv.dataset.id = i > 0 ? seq[i - 1].id : "";
  el.nxt.dataset.id = i >= 0 && i < seq.length - 1 ? seq[i + 1].id : "";
  el.lv.hidden = true;
  el.dv.hidden = false;
  document.title = (p.title || "글 상세") + " - 서포터즈 커뮤니티";
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (push) {
    hist(false);
  }
}

function resetDraw() {
  st.pg = 1;
  draw();
  hist(true);
}

function nav() {
  return {
    sup: 1,
    gid: st.gid,
    did: st.did,
    pg: st.pg,
    n: st.n,
    sort: st.sort,
    term: st.term,
    q: st.q
  };
}

function hist(rep) {
  if (!st.db || !st.gid) {
    return;
  }
  const s = nav();
  const p = new URLSearchParams();
  p.set("g", s.gid);
  if (s.did) {
    p.set("p", s.did);
  }
  if (s.pg > 1) {
    p.set("pg", s.pg);
  }
  if (s.n !== 10) {
    p.set("n", s.n);
  }
  if (s.sort !== "created") {
    p.set("s", s.sort);
  }
  if (s.term !== "all") {
    p.set("t", s.term);
  }
  if (s.q) {
    p.set("q", s.q);
  }
  history[rep ? "replaceState" : "pushState"](s, "", "#" + p.toString());
}

function urlSt() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  return {
    sup: 1,
    gid: p.get("g"),
    did: p.get("p"),
    pg: Number(p.get("pg")) || 1,
    n: Number(p.get("n")) || 10,
    sort: p.get("s") || "created",
    term: p.get("t") || "all",
    q: p.get("q") || ""
  };
}

function setDrp(d, v) {
  const b = d.querySelector('[data-v="' + CSS.escape(String(v)) + '"]');
  if (!b) {
    return;
  }
  d.dataset.val = String(v);
  d.querySelector(".drop-btn span").textContent = b.textContent;
  d.querySelectorAll("[data-v]").forEach((x) => {
    x.setAttribute("aria-selected", String(x === b));
  });
}

function clsDrp(skip) {
  $$(".drop.open").forEach((d) => {
    if (d !== skip) {
      d.classList.remove("open");
      d.querySelector(".drop-btn").setAttribute("aria-expanded", "false");
    }
  });
}

async function rstNav(s) {
  const gid = st.gs.some((g) => g.id === s.gid) ? s.gid : st.gs[0].id;
  st.sort = ["created", "visit", "likes", "comments"].includes(s.sort)
    ? s.sort
    : "created";
  st.term = ["all", "today", "week", "month"].includes(s.term)
    ? s.term
    : "all";
  st.n = [10, 30, 50, 70, 100].includes(Number(s.n)) ? Number(s.n) : 10;
  st.q = String(s.q || "");
  setDrp(el.srt, st.sort);
  setDrp(el.trm, st.term);
  setDrp(el.siz, st.n);
  el.sch.value = st.q;
  await setGrp(gid, false);
  st.pg = Number(s.pg) || 1;
  draw();
  if (s.did && rows("SELECT id FROM pst WHERE id=? AND grp_id=?", [s.did, gid]).length) {
    await showDtl(s.did, false);
  } else {
    showList(false, false);
  }
  hist(true);
}

el.ref.addEventListener("click", reloadDb);

el.gt.addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]");
  if (b) {
    setGrp(b.dataset.id, true).catch((x) => toast(x.message || String(x), true));
  }
});

$$('.drop').forEach((d) => {
  d.addEventListener("click", (e) => {
    const o = e.target.closest("[data-v]");
    if (o) {
      setDrp(d, o.dataset.v);
      d.classList.remove("open");
      d.querySelector(".drop-btn").setAttribute("aria-expanded", "false");
      if (d === el.srt) {
        st.sort = o.dataset.v;
      } else if (d === el.trm) {
        st.term = o.dataset.v;
      } else {
        st.n = Number(o.dataset.v) || 10;
      }
      resetDraw();
      return;
    }
    const b = e.target.closest(".drop-btn");
    if (!b) {
      return;
    }
    const on = !d.classList.contains("open");
    clsDrp(d);
    d.classList.toggle("open", on);
    b.setAttribute("aria-expanded", String(on));
  });
});

el.sch.addEventListener("input", () => {
  st.q = el.sch.value.trim();
  resetDraw();
});

el.clr.addEventListener("click", () => {
  el.sch.value = "";
  st.q = "";
  el.sch.focus();
  resetDraw();
});

el.lst.addEventListener("click", (e) => {
  const b = e.target.closest("[data-post]");
  if (b) {
    showDtl(b.dataset.post, true);
  }
});

el.pag.addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]");
  if (!b || b.disabled) {
    return;
  }
  st.pg = Number(b.dataset.p) || 1;
  draw();
  hist(true);
  el.lv.scrollIntoView({ behavior: "smooth", block: "start" });
});

el.bak.addEventListener("click", () => showList(true, true));

[el.prv, el.nxt].forEach((b) => {
  b.addEventListener("click", () => {
    if (b.dataset.id) {
      showDtl(b.dataset.id, true);
    }
  });
});

el.cl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-r]");
  if (!b) {
    return;
  }
  const x = el.cl.querySelector('[data-r-list="' + CSS.escape(b.dataset.r) + '"]');
  if (!x) {
    return;
  }
  x.hidden = !x.hidden;
  b.innerHTML = x.hidden
    ? '<i class="fa-solid fa-angle-down"></i> 답글 보기'
    : '<i class="fa-solid fa-angle-up"></i> 답글 접기';
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    clsDrp();
  }
  if (e.key === "Escape" && !el.dv.hidden) {
    showList(false, true);
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".drop")) {
    clsDrp();
  }
});

window.addEventListener("popstate", (e) => {
  if (st.db) {
    rstNav(e.state && e.state.sup ? e.state : urlSt()).catch((x) => {
      toast(x.message || String(x), true);
    });
  }
});

async function boot() {
  try {
    load(true);
    const d = await api("/api/groups");
    st.gs = Array.isArray(d.groups) ? d.groups : [];
    if (!st.gs.length) {
      throw new Error("활성화된 학급이 없습니다.");
    }
    el.dbs.classList.add("ready");
    el.dbs.innerHTML = '<i class="fa-solid fa-circle"></i> AWS DynamoDB 연결';
    el.opn.hidden = true;
    el.ref.disabled = false;
    await rstNav(history.state && history.state.sup ? history.state : urlSt());
  } catch (e) {
    toast(e.message || String(e), true);
  } finally {
    load(false);
  }
}

boot();
