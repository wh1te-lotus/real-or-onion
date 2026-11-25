/* Real or Onion? Game logic. All headline data lives in data/headlines.js. */
(function () {
  "use strict";

  const RUN_LENGTH = 20;
  const STORAGE_KEY = "realOrOnion:v1";
  const SEEN_CAP = 60; // how many recently seen ids to remember

  const THEMES = [
    { id: "forest", name: "Forest" },
    { id: "ultramarine", name: "Ultramarine" },
    { id: "tangerine", name: "Tangerine" },
    { id: "berry", name: "Berry" },
    { id: "ocean", name: "Ocean" },
  ];
  const MODES = [
    { id: "auto", name: "Auto" },
    { id: "light", name: "Light" },
    { id: "dark", name: "Dark" },
  ];

  const app = document.getElementById("app");

  // ---------- Storage (every access is wrapped in try/catch) ----------
  const DEFAULT_STATS = {
    totalCorrect: 0, totalAnswered: 0, runsCompleted: 0, bestRunPercent: 0,
    lastSeen: [], theme: "forest", mode: "auto",
  };

  function freshStats(keep) {
    return { ...DEFAULT_STATS, lastSeen: [], ...(keep || {}) };
  }

  function loadStats() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshStats();
      const p = JSON.parse(raw);
      const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
      return {
        totalCorrect: num(p.totalCorrect),
        totalAnswered: num(p.totalAnswered),
        runsCompleted: num(p.runsCompleted),
        bestRunPercent: Math.min(100, num(p.bestRunPercent)),
        lastSeen: Array.isArray(p.lastSeen) ? p.lastSeen.filter((x) => typeof x === "string") : [],
        theme: THEMES.some((t) => t.id === p.theme) ? p.theme : DEFAULT_STATS.theme,
        mode: MODES.some((m) => m.id === p.mode) ? p.mode : DEFAULT_STATS.mode,
      };
    } catch (e) {
      return freshStats();
    }
  }

  function saveStats(stats) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch (e) {
      /* storage unavailable: play on without saving */
    }
  }

  // ---------- Helpers ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function percent(correct, answered) {
    return answered === 0 ? 0 : Math.round((correct / answered) * 100);
  }

  // One row in the source data has a placeholder instead of the real original headline.
  function originalText(e) {
    const o = e.originalHeadline;
    return !o || /^see link\b/i.test(o) ? "Read the original article" : o;
  }

  function hostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  // Create an element. Text goes in via textContent, never innerHTML. Null kids are skipped.
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === "class") el.className = props[k];
        else if (k === "text") el.textContent = props[k];
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), props[k]);
        else if (props[k] !== false && props[k] != null) el.setAttribute(k, props[k] === true ? "" : props[k]);
      }
    }
    kids.flat().forEach((c) => {
      if (c != null && c !== false) el.append(c);
    });
    return el;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, ...kids) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    kids.forEach((c) => el.append(c));
    return el;
  }

  function icon(name) {
    const paths = {
      check: "M5 13l4 4L19 7",
      cross: "M6 6l12 12M18 6L6 18",
      real: "M5 4h11v16H7a2 2 0 0 1-2-2V4zM16 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h5",
      onion: "M12 3c0 3-1 4-1 6M12 9c-4 0-7 3-7 6.5S8 21 12 21s7-2 7-5.5S16 9 12 9zM12 9c-2 3-2 9 0 12M12 9c2 3 2 9 0 12",
    };
    return svgEl("svg", {
      viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.4",
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
    }, svgEl("path", { d: paths[name] }));
  }

  // ---------- Pool and run building ----------
  function readPool() {
    const raw = window.HEADLINES;
    if (!Array.isArray(raw)) return [];
    const ids = new Set();
    return raw.filter((e) => {
      if (!e || typeof e !== "object") return false;
      if (e.type !== "real" && e.type !== "onion") return false;
      if (typeof e.id !== "string" || !e.id || ids.has(e.id)) return false;
      if (typeof e.displayHeadline !== "string" || !e.displayHeadline) return false;
      ids.add(e.id);
      return true;
    });
  }

  // Unseen entries first (best effort), each group in random order.
  function preferUnseen(list, seen) {
    const s = shuffle(list);
    return s.filter((e) => !seen.has(e.id)).concat(s.filter((e) => seen.has(e.id)));
  }

  const MAX_IN_A_ROW = 3;

  function longestRun(list) {
    let best = 0, cur = 0, prev = null;
    list.forEach((e) => {
      cur = e.type === prev ? cur + 1 : 1;
      prev = e.type;
      best = Math.max(best, cur);
    });
    return best;
  }

  // Interleave the two (already shuffled) lists at random, but never let the same type
  // run longer than MAX_IN_A_ROW. A random pass can paint itself into a corner near the
  // end, so retry. If the mix makes the limit impossible (a lopsided pool), return the
  // best attempt instead of failing.
  function arrange(real, onion) {
    let best = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const r = real.slice(), o = onion.slice(), out = [];
      while (r.length || o.length) {
        const tail = out.slice(-MAX_IN_A_ROW);
        const blocked = tail.length === MAX_IN_A_ROW && tail.every((e) => e.type === tail[0].type) ? tail[0].type : null;
        let pickReal = Math.random() < r.length / (r.length + o.length);
        if (blocked === "real" && o.length) pickReal = false;
        if (blocked === "onion" && r.length) pickReal = true;
        out.push(pickReal ? r.pop() : o.pop());
      }
      const run = longestRun(out);
      if (!best || run < best.run) best = { out, run };
      if (run <= MAX_IN_A_ROW) break;
    }
    return best.out;
  }

  function buildRun(pool, lastSeen) {
    const n = Math.min(RUN_LENGTH, pool.length);
    const seen = new Set(lastSeen);
    const real = preferUnseen(pool.filter((e) => e.type === "real"), seen);
    const onion = preferUnseen(pool.filter((e) => e.type === "onion"), seen);

    let wantReal = Math.floor(n / 2);
    if (n % 2 === 1 && Math.random() < 0.5) wantReal += 1;
    let wantOnion = n - wantReal;
    if (real.length < wantReal) { wantReal = real.length; wantOnion = n - wantReal; }
    if (onion.length < wantOnion) { wantOnion = onion.length; wantReal = n - wantOnion; }

    return arrange(shuffle(real.slice(0, wantReal)), shuffle(onion.slice(0, wantOnion)));
  }

  // ---------- State ----------
  const state = {
    screen: "start", // start | play | end | error
    phase: "guessing", // guessing | revealed | finished
    pool: [],
    stats: freshStats(),
    run: [],
    idx: 0,
    correct: 0,
    answered: 0,
    streak: 0,
    answers: [], // { entry, guess, isCorrect }
    lastGuess: null,
    confirmReset: false,
    finalised: false,
  };

  function applyLook() {
    const root = document.documentElement;
    root.setAttribute("data-theme", state.stats.theme);
    if (state.stats.mode === "auto") root.removeAttribute("data-mode");
    else root.setAttribute("data-mode", state.stats.mode);
  }

  function setLook(key, value) {
    state.stats[key] = value;
    saveStats(state.stats);
    applyLook();
    render();
    const btn = document.querySelector(`[data-pick="${key}:${value}"]`);
    if (btn) btn.focus();
  }

  function startRun() {
    state.run = buildRun(state.pool, state.stats.lastSeen);
    state.idx = 0;
    state.correct = 0;
    state.answered = 0;
    state.streak = 0;
    state.answers = [];
    state.lastGuess = null;
    state.finalised = false;
    state.phase = "guessing";
    state.screen = "play";
    render();
  }

  function guess(choice) {
    if (state.screen !== "play" || state.phase !== "guessing") return; // ignores repeats
    const entry = state.run[state.idx];
    const isCorrect = entry.type === choice;
    state.phase = "revealed"; // set first so a second activation is ignored
    state.answered += 1;
    if (isCorrect) {
      state.correct += 1;
      state.streak += 1;
    } else {
      state.streak = 0;
    }
    state.lastGuess = choice;
    state.answers.push({ entry, guess: choice, isCorrect });
    render();
  }

  function next() {
    if (state.screen !== "play" || state.phase !== "revealed") return;
    if (state.idx + 1 >= state.run.length) {
      finishRun();
      return;
    }
    state.idx += 1;
    state.phase = "guessing";
    render();
    try { window.scrollTo(0, 0); } catch (e) { /* not essential */ }
  }

  function finishRun() {
    state.phase = "finished";
    state.screen = "end";
    if (!state.finalised) {
      state.finalised = true;
      const s = state.stats;
      s.totalCorrect += state.correct;
      s.totalAnswered += state.answered;
      s.runsCompleted += 1;
      s.bestRunPercent = Math.max(s.bestRunPercent, percent(state.correct, state.answered));
      s.lastSeen = state.run.map((e) => e.id).concat(s.lastSeen).slice(0, SEEN_CAP);
      saveStats(s);
    }
    render();
    try { window.scrollTo(0, 0); } catch (e) { /* not essential */ }
  }

  function goHome() {
    // Leaving mid-round: the run is abandoned and not counted in the accuracy stats,
    // but the headlines already answered go into the history so they are not repeated soon.
    if (state.screen === "play" && state.answers.length) {
      const ids = state.answers.map((a) => a.entry.id);
      state.stats.lastSeen = ids.concat(state.stats.lastSeen).slice(0, SEEN_CAP);
      saveStats(state.stats);
    }
    state.screen = "start";
    state.phase = "guessing";
    state.confirmReset = false;
    render();
    app.focus();
    try { window.scrollTo(0, 0); } catch (e) { /* not essential */ }
  }

  function renderMasthead() {
    const header = document.querySelector(".masthead");
    if (!header) return;
    const brand = [h("span", { class: "badge", "aria-hidden": "true", text: "?" }), h("span", { class: "name", text: "Real or Onion?" })];
    header.replaceChildren(
      h("button", { class: "wordmark home-link", type: "button", onclick: goHome, "aria-label": "Real or Onion? Back to home" }, brand));
  }

  function resetStats() {
    if (!state.confirmReset) {
      state.confirmReset = true;
    } else {
      state.stats = freshStats({ theme: state.stats.theme, mode: state.stats.mode });
      saveStats(state.stats);
      state.confirmReset = false;
    }
    render();
  }

  // ---------- Rendering ----------
  function mount(...nodes) {
    app.replaceChildren(...nodes.filter((n) => n != null && n !== false));
  }

  function resetControl() {
    return h("button", {
      class: "link-btn",
      type: "button",
      onclick: resetStats,
      text: state.confirmReset ? "Click again to erase stats and history" : "Reset saved stats",
    });
  }

  function lifetimeLine() {
    const s = state.stats;
    if (!s.totalAnswered) return null;
    return h("p", { class: "stats-line" },
      "Lifetime accuracy: ",
      h("strong", { text: percent(s.totalCorrect, s.totalAnswered) + "%" }),
      ` across ${s.totalAnswered} headlines in ${s.runsCompleted} ${s.runsCompleted === 1 ? "run" : "runs"}. Best run: `,
      h("strong", { text: s.bestRunPercent + "%" }),
      ".");
  }

  function lookPicker() {
    const pill = (key, item) =>
      h("button", {
        class: key === "theme" ? "sw" : "mode",
        type: "button",
        "data-pick": `${key}:${item.id}`,
        "aria-pressed": String(state.stats[key] === item.id),
        onclick: () => setLook(key, item.id),
      }, key === "theme" ? h("span", { class: "swatch", "data-theme": item.id, "aria-hidden": "true" }) : null, item.name);

    return h("section", { class: "picker", "aria-labelledby": "picker-title" },
      h("h2", { id: "picker-title", text: "Pick a look" }),
      h("div", { class: "swatches", role: "group", "aria-label": "Color theme" }, THEMES.map((t) => pill("theme", t))),
      h("div", { class: "modes", role: "group", "aria-label": "Appearance" }, MODES.map((m) => pill("mode", m))));
  }

  function renderError() {
    mount(h("div", { class: "notice", role: "alert" },
      h("h1", { class: "hero-title", text: "No headlines found" }),
      h("p", { text: "The game could not read any headlines from data/headlines.js. Check that the file exists, loads before game.js, and sets window.HEADLINES to an array. Then reload the page." })));
  }

  function renderStart() {
    const total = Math.min(RUN_LENGTH, state.pool.length);
    mount(
      h("section", { class: "hero" },
        h("h1", { class: "hero-title", text: "Can you spot the real headline?" }),
        h("p", { class: "lede", text: `You get ${total} headlines, one at a time. Some come from real news outlets and some from The Onion. Guess which is which.` }),
        h("div", { class: "chips", "aria-hidden": "true" },
          h("span", { class: "chip real", text: "Real" }),
          h("span", { class: "chip onion", text: "Onion" }))),
      h("button", { class: "btn btn-primary btn-start", type: "button", onclick: startRun, text: "Start" }),
      lifetimeLine(),
      state.stats.totalAnswered || state.stats.lastSeen.length ? resetControl() : null,
      lookPicker());
  }

  function revealPanel(a) {
    const e = a.entry;
    const isReal = e.type === "real";
    const linkText = isReal ? originalText(e) : e.displayHeadline;
    const isLast = state.idx + 1 >= state.run.length;
    const host = hostname(e.url);

    return h("section", { class: "reveal " + (a.isCorrect ? "good" : "bad"), "aria-labelledby": "verdict" },
      h("h2", { class: "verdict", tabindex: "-1", id: "verdict" },
        icon(a.isCorrect ? "check" : "cross"), a.isCorrect ? "Correct!" : "Not quite."),
      h("p", { class: "identity", text: isReal ? `This is real, and was published by ${e.publisher}.` : "This is from The Onion." }),
      h("p", { class: "source" },
        h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer", text: linkText }),
        host ? h("span", { class: "host", text: host }) : null),
      h("button", { class: "btn btn-primary", type: "button", id: "next", onclick: next, text: isLast ? "See results" : "Next" }));
  }

  function renderPlay() {
    const entry = state.run[state.idx];
    const total = state.run.length;
    const revealed = state.phase === "revealed";
    const last = revealed ? state.answers[state.answers.length - 1] : null;

    const pips = h("div", {
      class: "pips", role: "progressbar", "aria-label": "Progress",
      "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(state.answers.length),
    }, state.run.map((_, i) => {
      const a = state.answers[i];
      const cls = a ? (a.isCorrect ? " good" : " bad") : i === state.idx ? " now" : "";
      return h("span", { class: "pip" + cls });
    }));

    const btn = (choice, label, key) =>
      h("button", {
        class: `btn answer ${choice}` + (revealed && state.lastGuess === choice ? " chosen" : ""),
        type: "button",
        disabled: revealed,
        "aria-pressed": revealed ? String(state.lastGuess === choice) : false,
        onclick: () => guess(choice),
      }, icon(choice), label, h("kbd", { "aria-hidden": "true", text: key }));

    mount(
      h("div", { class: "status" },
        h("span", { text: `${state.idx + 1} of ${total}` }),
        h("span", { class: "streak", text: `Streak: ${state.streak}` }),
        h("span", { text: `Score: ${state.correct}/${state.answered} (${percent(state.correct, state.answered)}%)` })),
      pips,
      h("div", { class: "clipping" },
        h("p", { class: "headline", text: entry.displayHeadline }),
        last ? h("span", { class: "stamp " + (last.isCorrect ? "good" : "bad"), "aria-hidden": "true", text: entry.type === "real" ? "Real" : "Onion" }) : null),
      h("div", { class: "answers" }, btn("real", "Real", "R"), btn("onion", "The Onion", "O")),
      last ? revealPanel(last) : null);

    if (revealed) {
      const v = document.getElementById("verdict");
      if (v) v.focus();
    }
  }

  const BANDS = [
    [90, "Suspiciously good. Do you write these, or just read the news a lot?"],
    [75, "Strong instincts. The line between satire and reality is blurry, and you still see it."],
    [50, "Respectable. Some of those headlines were doing their best to confuse you."],
    [25, "Tough run. The news keeps making the satirists work overtime."],
    [0, "Reality has beaten you today. Honestly, it beats most of us."],
  ];

  function ring(pct, label) {
    const r = 52, c = 2 * Math.PI * r;
    return h("div", { class: "ring", role: "img", "aria-label": `${label} correct, ${pct} percent` },
      svgEl("svg", { viewBox: "0 0 120 120", "aria-hidden": "true" },
        svgEl("circle", { class: "ring-track", cx: 60, cy: 60, r, fill: "none", "stroke-width": 12 }),
        pct > 0 ? svgEl("circle", {
          class: "ring-fill", cx: 60, cy: 60, r, fill: "none", "stroke-width": 12, "stroke-linecap": "round",
          "stroke-dasharray": `${(c * pct) / 100} ${c}`, transform: "rotate(-90 60 60)",
        }) : null),
      h("div", { class: "ring-text" },
        h("span", { class: "ring-main", text: label }),
        h("span", { class: "ring-sub", text: pct + "%" })));
  }

  function tile(kind, label, value) {
    return h("div", { class: "tile " + kind },
      h("span", { class: "tile-num", text: value }),
      h("span", { class: "tile-label", text: label }));
  }

  function byType(kind) {
    const list = state.answers.filter((a) => a.entry.type === kind);
    return `${list.filter((a) => a.isCorrect).length}/${list.length}`;
  }

  function shareText() {
    const squares = state.answers.map((a) => (a.isCorrect ? "\uD83D\uDFE9" : "\uD83D\uDFE5"));
    const rows = [];
    for (let i = 0; i < squares.length; i += 10) rows.push(squares.slice(i, i + 10).join(""));
    return `Real or Onion? ${state.correct}/${state.answered} (${percent(state.correct, state.answered)}%)\n${rows.join("\n")}`;
  }

  function copyResults() {
    const status = document.getElementById("share-status");
    const say = (msg) => { if (status) status.textContent = msg; };
    const text = shareText();
    const fallback = () => {
      try {
        const ta = h("textarea", { "aria-hidden": "true", style: "position:fixed;opacity:0;top:0" });
        ta.value = text;
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        say(ok ? "Copied your results." : "Could not copy. Select the text and copy it yourself.");
      } catch (e) {
        say("Could not copy on this browser.");
      }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => say("Copied your results."), fallback);
      } else {
        fallback();
      }
    } catch (e) {
      fallback();
    }
  }

  function renderEnd() {
    const pct = percent(state.correct, state.answered);
    const msg = BANDS.find(([min]) => pct >= min)[1];
    const s = state.stats;

    const recap = h("ol", { class: "recap" }, state.answers.map((a) => {
      const e = a.entry;
      const isReal = e.type === "real";
      const text = isReal ? originalText(e) : e.displayHeadline;
      return h("li", { class: a.isCorrect ? "good" : "bad" },
        h("span", { class: "res" }, icon(a.isCorrect ? "check" : "cross"), a.isCorrect ? "Correct" : "Missed"),
        h("span", { class: "rh" }, h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer", text })),
        isReal && e.wasModified === true
          ? h("span", { class: "muted small", style: "display:block", text: "You saw: " + e.displayHeadline })
          : null);
    }));

    mount(
      h("h1", { class: "hero-title", tabindex: "-1", id: "end-title", text: "Your results" }),
      h("div", { class: "end-top" },
        ring(pct, `${state.correct}/${state.answered}`),
        h("p", { class: "end-msg", text: msg })),
      h("div", { class: "tiles" },
        tile("real", "Real headlines spotted", byType("real")),
        tile("onion", "Onion headlines spotted", byType("onion"))),
      h("p", { class: "stats-line" },
        "Lifetime accuracy: ",
        h("strong", { text: percent(s.totalCorrect, s.totalAnswered) + "%" }),
        ". Best run: ",
        h("strong", { text: s.bestRunPercent + "%" }),
        `. Runs completed: ${s.runsCompleted}.`),
      h("div", { class: "actions" },
        h("button", { class: "btn btn-primary", type: "button", onclick: startRun, text: "Play again" }),
        h("button", { class: "btn", type: "button", id: "share", onclick: copyResults, text: "Copy results" }),
        resetControl()),
      h("p", { class: "share-status", id: "share-status", role: "status" }),
      h("h2", { text: "Every headline in this run" }),
      recap);
    const t = document.getElementById("end-title");
    if (t) t.focus();
  }

  function render() {
    renderMasthead();
    if (state.screen === "error") return renderError();
    if (state.screen === "start") return renderStart();
    if (state.screen === "play") return renderPlay();
    return renderEnd();
  }

  // ---------- Keyboard ----------
  document.addEventListener("keydown", (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.repeat) return;
    const k = ev.key.toLowerCase();
    if (state.screen !== "play") return;
    if (state.phase === "guessing" && (k === "r" || k === "o")) {
      ev.preventDefault();
      guess(k === "r" ? "real" : "onion");
    } else if (state.phase === "revealed" && ev.key === "Enter") {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "A" || tag === "BUTTON") return; // let the focused control handle Enter natively
      ev.preventDefault();
      next();
    }
  });

  // ---------- Init ----------
  function init() {
    state.pool = readPool();
    if (!state.pool.length) {
      state.screen = "error";
    } else {
      state.stats = loadStats();
    }
    applyLook();
    render();
  }

  init();
})();
