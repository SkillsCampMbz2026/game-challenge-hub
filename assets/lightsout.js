/* ===========================================================
   Lights Out — game logic
   - 5x5 grid; clicking a cell toggles it + its 4 orthogonal neighbours
   - randomized but ALWAYS-solvable boards (scrambled from solved state)
   - GF(2) solver -> exact minimum-move target + auto-solve demo
   - move counter, timer, difficulty, automatic victory detection
   - localStorage leaderboard (name, difficulty, moves, time)
   =========================================================== */
(function () {
  "use strict";

  var N = 5;                 // grid is 5x5
  var CELLS = N * N;
  var LB_KEY = "lightsout.leaderboard.v1";
  var NAME_KEY = "lightsout.lastName";

  // Difficulty is controlled by how much the solved board is scrambled.
  // Boards are rejection-sampled so their true minimum-move count lands in band.
  var DIFFICULTY = {
    easy:   { label: "Easy",   pressMin: 2,  pressMax: 4,  min: 2,  max: 4 },
    medium: { label: "Medium", pressMin: 5,  pressMax: 7,  min: 5,  max: 8 },
    hard:   { label: "Hard",   pressMin: 8,  pressMax: 11, min: 8,  max: 12 },
    expert: { label: "Expert", pressMin: 12, pressMax: 15, min: 11, max: 16 }
  };

  // ---------- DOM ----------
  var gridEl = document.getElementById("grid");
  var moveCountEl = document.getElementById("moveCount");
  var minMovesEl = document.getElementById("minMoves");
  var timerEl = document.getElementById("timer");
  var litStatEl = document.getElementById("litStat");
  var diffSelect = document.getElementById("diffSelect");
  var newBtn = document.getElementById("newBtn");
  var restartBtn = document.getElementById("restartBtn");
  var solveBtn = document.getElementById("solveBtn");
  var hintEl = document.getElementById("hint");

  var victoryModal = document.getElementById("victoryModal");
  var victorySub = document.getElementById("victorySub");
  var modalStats = document.getElementById("modalStats");
  var saveRow = document.getElementById("saveRow");
  var playerNameInput = document.getElementById("playerName");
  var saveScoreBtn = document.getElementById("saveScoreBtn");
  var savedMsg = document.getElementById("savedMsg");
  var playAgainBtn = document.getElementById("playAgainBtn");

  var howToBtn = document.getElementById("howToBtn");
  var instructions = document.getElementById("instructions");

  var lbFilter = document.getElementById("lbFilter");
  var clearLbBtn = document.getElementById("clearLbBtn");
  var lbBody = document.getElementById("lbBody");
  var lbEmpty = document.getElementById("lbEmpty");

  // ---------- State ----------
  var state = null;
  var cellEls = [];

  // ---------- Board helpers ----------
  function neighbors(idx) {
    var r = Math.floor(idx / N), c = idx % N;
    var res = [idx];
    if (r > 0) res.push(idx - N);
    if (r < N - 1) res.push(idx + N);
    if (c > 0) res.push(idx - 1);
    if (c < N - 1) res.push(idx + 1);
    return res;
  }

  function pressInto(board, idx) {
    neighbors(idx).forEach(function (j) { board[j] ^= 1; });
  }

  function litCount(board) {
    var n = 0;
    for (var i = 0; i < CELLS; i++) n += board[i];
    return n;
  }

  // ---------- GF(2) solver ----------
  // Solve A x = board (mod 2); return {solution:[0/1..], moves:minWeight} or null.
  function solve(board) {
    var rhsBit = CELLS; // bit index used for the right-hand side
    var rows = [];
    for (var i = 0; i < CELLS; i++) {
      var mask = 0;
      neighbors(i).forEach(function (j) { mask |= (1 << j); });
      if (board[i]) mask |= (1 << rhsBit);
      rows.push(mask);
    }

    var pivotRowForCol = {};
    var pivotCols = [];
    var rank = 0;
    for (var col = 0; col < CELLS; col++) {
      var sel = -1;
      for (var rr = rank; rr < CELLS; rr++) {
        if (rows[rr] & (1 << col)) { sel = rr; break; }
      }
      if (sel === -1) continue;
      var tmp = rows[rank]; rows[rank] = rows[sel]; rows[sel] = tmp;
      for (var k = 0; k < CELLS; k++) {
        if (k !== rank && (rows[k] & (1 << col))) rows[k] ^= rows[rank];
      }
      pivotCols.push(col);
      pivotRowForCol[col] = rank;
      rank++;
    }
    // consistency: a row "0 ... 0 | 1" means unsolvable
    for (var z = rank; z < CELLS; z++) {
      if (rows[z] === (1 << rhsBit)) return null;
    }

    var isPivot = {};
    pivotCols.forEach(function (c) { isPivot[c] = true; });
    var freeCols = [];
    for (var c2 = 0; c2 < CELLS; c2++) if (!isPivot[c2]) freeCols.push(c2);

    // particular solution (free vars = 0)
    var part = new Array(CELLS).fill(0);
    pivotCols.forEach(function (col) {
      part[col] = (rows[pivotRowForCol[col]] >> rhsBit) & 1;
    });

    // kernel basis vectors (one per free column)
    var kernel = freeCols.map(function (f) {
      var v = new Array(CELLS).fill(0);
      v[f] = 1;
      pivotCols.forEach(function (p) {
        if (rows[pivotRowForCol[p]] & (1 << f)) v[p] = 1;
      });
      return v;
    });

    // enumerate all kernel combinations -> minimum-weight solution
    var best = part, bestW = weight(part);
    var K = kernel.length;
    for (var m = 1; m < (1 << K); m++) {
      var x = part.slice();
      for (var b = 0; b < K; b++) {
        if (m & (1 << b)) for (var idx = 0; idx < CELLS; idx++) x[idx] ^= kernel[b][idx];
      }
      var w = weight(x);
      if (w < bestW) { bestW = w; best = x; }
    }
    return { solution: best, moves: bestW };
  }

  function weight(v) { var w = 0; for (var i = 0; i < v.length; i++) w += v[i]; return w; }

  // ---------- Board generation (solvable + difficulty-banded) ----------
  function randomInt(n) { return Math.floor(Math.random() * n); }

  function scramble(pressCount) {
    var board = new Array(CELLS).fill(0);
    var pool = [];
    for (var i = 0; i < CELLS; i++) pool.push(i);
    // pick `pressCount` DISTINCT cells to press (Fisher-Yates partial shuffle)
    for (var k = 0; k < pressCount && k < CELLS; k++) {
      var j = k + randomInt(CELLS - k);
      var t = pool[k]; pool[k] = pool[j]; pool[j] = t;
      pressInto(board, pool[k]);
    }
    return board;
  }

  function generateBoard(diffKey) {
    var cfg = DIFFICULTY[diffKey];
    var best = null, bestDist = Infinity;
    var target = (cfg.min + cfg.max) / 2;
    for (var attempt = 0; attempt < 600; attempt++) {
      var presses = cfg.pressMin + randomInt(cfg.pressMax - cfg.pressMin + 1);
      var board = scramble(presses);
      if (litCount(board) === 0) continue;          // never start already solved
      var res = solve(board);
      if (!res) continue;                            // should not happen (scrambled = solvable)
      var mv = res.moves;
      if (mv >= cfg.min && mv <= cfg.max) {
        return { board: board, minMoves: mv };
      }
      var dist = Math.abs(mv - target);
      if (mv > 0 && dist < bestDist) { bestDist = dist; best = { board: board, minMoves: mv }; }
    }
    return best || { board: scramble(cfg.presses), minMoves: 0 };
  }

  // ---------- Rendering ----------
  function buildGrid() {
    gridEl.innerHTML = "";
    cellEls = [];
    for (var i = 0; i < CELLS; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cell";
      btn.dataset.idx = i;
      var r = Math.floor(i / N) + 1, c = (i % N) + 1;
      btn.setAttribute("aria-label", "Light row " + r + ", column " + c);
      btn.addEventListener("click", onCellClick);
      gridEl.appendChild(btn);
      cellEls.push(btn);
    }
  }

  function render() {
    for (var i = 0; i < CELLS; i++) {
      var on = state.board[i] === 1;
      cellEls[i].classList.toggle("cell--on", on);
      cellEls[i].setAttribute("aria-pressed", String(on));
    }
    litStatEl.textContent = litCount(state.board);
  }

  function setHint(msg, bad) {
    hintEl.innerHTML = msg;
    hintEl.classList.toggle("hint--bad", !!bad);
  }

  function updateStats() {
    moveCountEl.textContent = state.moves;
    minMovesEl.textContent = state.minMoves;
  }

  // ---------- Timer ----------
  function startTimerIfNeeded() {
    if (state.startTime || state.finished) return;
    state.startTime = Date.now();
    state.timerId = setInterval(function () {
      state.elapsed = Date.now() - state.startTime;
      timerEl.textContent = formatTime(state.elapsed);
    }, 250);
  }
  function stopTimer() { if (state.timerId) { clearInterval(state.timerId); state.timerId = null; } }
  function formatTime(ms) {
    var t = Math.floor(ms / 1000);
    return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  }

  // ---------- Interaction ----------
  function press(idx, byUser) {
    pressInto(state.board, idx);
    state.moves++;
    updateStats();
    render();
    if (byUser) {
      // brief pulse on the pressed cell
      cellEls[idx].classList.remove("cell--pulse");
      void cellEls[idx].offsetWidth;
      cellEls[idx].classList.add("cell--pulse");
    }
    checkVictory();
  }

  function onCellClick(e) {
    if (state.finished || state.solving) return;
    var idx = parseInt(e.currentTarget.dataset.idx, 10);
    startTimerIfNeeded();
    press(idx, true);
    if (!state.finished) {
      var left = litCount(state.board);
      setHint(left === 1 ? "Just <strong>1</strong> light left — you're nearly there!"
                         : "<strong>" + left + "</strong> lights still on. Turn them all off.");
    }
  }

  // ---------- Victory ----------
  function checkVictory() {
    if (litCount(state.board) === 0) {
      state.finished = true;
      stopTimer();
      showVictory();
    }
  }

  function showVictory() {
    var optimal = state.moves === state.minMoves && state.minMoves > 0;
    if (state.isDemo) {
      victorySub.textContent = "Auto-solved demo — this run is not recorded on the leaderboard.";
    } else if (optimal) {
      victorySub.textContent = "Perfect! You cleared the board in the minimum number of moves. 🌟";
    } else {
      victorySub.textContent = "All lights out! The optimal solution was " + state.minMoves + " moves — can you match it?";
    }

    modalStats.innerHTML = "";
    addModalStat("Difficulty", DIFFICULTY[state.difficulty].label);
    addModalStat("Moves", state.moves + (optimal ? " ✓" : ""));
    addModalStat("Time", formatTime(state.elapsed));

    if (state.isDemo) {
      saveRow.hidden = true;
    } else {
      saveRow.hidden = false;
      savedMsg.hidden = true;
      saveScoreBtn.disabled = false;
      playerNameInput.disabled = false;
      playerNameInput.value = localStorage.getItem(NAME_KEY) || "";
    }
    victoryModal.hidden = false;
    if (!state.isDemo) setTimeout(function () { playerNameInput.focus(); }, 50);
  }

  function addModalStat(label, value) {
    var d = document.createElement("div");
    d.className = "stat";
    d.innerHTML = '<span class="stat__label">' + label + '</span><span class="stat__value">' + value + "</span>";
    modalStats.appendChild(d);
  }
  function hideVictory() { victoryModal.hidden = true; }

  // ---------- Leaderboard ----------
  function loadLb() {
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch (e) { return []; }
  }
  function saveLb(list) { try { localStorage.setItem(LB_KEY, JSON.stringify(list)); } catch (e) {} }

  function saveScore() {
    var name = (playerNameInput.value || "").trim() || "Anonymous";
    localStorage.setItem(NAME_KEY, name);
    var list = loadLb();
    list.push({
      name: name.slice(0, 20),
      difficulty: state.difficulty,
      moves: state.moves,
      minMoves: state.minMoves,
      timeMs: state.elapsed,
      optimal: state.moves === state.minMoves && state.minMoves > 0,
      date: Date.now()
    });
    saveLb(list);
    savedMsg.hidden = false;
    saveScoreBtn.disabled = true;
    playerNameInput.disabled = true;
    renderLb();
  }

  var DIFF_ORDER = { easy: 0, medium: 1, hard: 2, expert: 3 };
  function renderLb() {
    var list = loadLb();
    if (lbFilter.value === "current") {
      list = list.filter(function (r) { return r.difficulty === state.difficulty; });
    }
    list.sort(function (a, b) {
      if (a.moves !== b.moves) return a.moves - b.moves;
      return a.timeMs - b.timeMs;
    });
    list = list.slice(0, 10);

    lbBody.innerHTML = "";
    if (!list.length) { lbEmpty.hidden = false; return; }
    lbEmpty.hidden = true;
    var medals = ["🥇", "🥈", "🥉"];
    list.forEach(function (r, i) {
      var tr = document.createElement("tr");
      var rank = i < 3 ? '<span class="rank-medal">' + medals[i] + "</span>" : (i + 1);
      var dlabel = (DIFFICULTY[r.difficulty] || { label: r.difficulty }).label;
      tr.innerHTML =
        "<td>" + rank + "</td>" +
        "<td>" + escapeHtml(r.name) + "</td>" +
        "<td>" + escapeHtml(dlabel) + "</td>" +
        "<td>" + r.moves + "</td>" +
        "<td>" + formatTime(r.timeMs) + "</td>" +
        '<td class="' + (r.optimal ? "lb-opt-yes" : "lb-opt-no") + '">' + (r.optimal ? "Yes" : "—") + "</td>";
      lbBody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- Auto-solve ----------
  function autoSolve() {
    if (state.solving) return;
    // reset to the puzzle's starting board, then play the optimal solution
    state.board = state.initialBoard.slice();
    state.moves = 0;
    state.finished = false;
    stopTimer(); state.startTime = null; state.elapsed = 0;
    timerEl.textContent = "00:00";
    hideVictory();
    updateStats();
    render();

    var res = solve(state.board);
    if (!res) { setHint("This board can't be solved — try a new puzzle.", true); return; }
    var order = [];
    for (var i = 0; i < CELLS; i++) if (res.solution[i]) order.push(i);

    state.solving = true;
    state.isDemo = true;
    solveBtn.disabled = true;
    setHint("Auto-solving… watch the optimal " + order.length + "-move solution.");
    startTimerIfNeeded();

    var step = 0;
    var iv = setInterval(function () {
      if (step >= order.length || !state.solving) {
        clearInterval(iv);
        solveBtn.disabled = false;
        state.solving = false;
        return;
      }
      press(order[step], true);
      step++;
    }, 480);
  }

  // ---------- Lifecycle ----------
  function newPuzzle(diffKey) {
    if (state) stopTimer();
    var gen = generateBoard(diffKey);
    state = {
      difficulty: diffKey,
      board: gen.board.slice(),
      initialBoard: gen.board.slice(),
      minMoves: gen.minMoves,
      moves: 0,
      startTime: null,
      elapsed: 0,
      timerId: null,
      finished: false,
      isDemo: false,
      solving: false
    };
    solveBtn.disabled = false;
    timerEl.textContent = "00:00";
    updateStats();
    render();
    setHint("Click any light to toggle it and its neighbours. Turn <strong>all</strong> lights off!");
    hideVictory();
    renderLb();
  }

  function restart() {
    if (!state) return;
    stopTimer();
    state.board = state.initialBoard.slice();
    state.moves = 0;
    state.startTime = null;
    state.elapsed = 0;
    state.finished = false;
    state.isDemo = false;
    state.solving = false;
    solveBtn.disabled = false;
    timerEl.textContent = "00:00";
    updateStats();
    render();
    setHint("Board reset. Turn all the lights off!");
    hideVictory();
  }

  // ---------- Events ----------
  diffSelect.addEventListener("change", function () { newPuzzle(diffSelect.value); });
  newBtn.addEventListener("click", function () { newPuzzle(diffSelect.value); });
  restartBtn.addEventListener("click", restart);
  solveBtn.addEventListener("click", autoSolve);

  playAgainBtn.addEventListener("click", function () { newPuzzle(diffSelect.value); });
  saveScoreBtn.addEventListener("click", saveScore);
  playerNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); if (!saveScoreBtn.disabled) saveScore(); }
  });

  howToBtn.addEventListener("click", function () {
    var open = instructions.hasAttribute("hidden");
    if (open) instructions.removeAttribute("hidden"); else instructions.setAttribute("hidden", "");
    howToBtn.setAttribute("aria-expanded", String(open));
  });

  lbFilter.addEventListener("change", renderLb);
  clearLbBtn.addEventListener("click", function () {
    if (confirm("Clear all saved leaderboard scores? This cannot be undone.")) { saveLb([]); renderLb(); }
  });

  victoryModal.addEventListener("click", function (e) { if (e.target === victoryModal) hideVictory(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !victoryModal.hidden) hideVictory();
  });

  // Test / verification hook
  window.__lightsout = {
    getState: function () { return state; },
    click: function (idx) {
      if (state.finished || state.solving) return;
      startTimerIfNeeded(); press(idx, false);
      if (!state.finished) { /* keep hint updates out of test path */ }
    },
    solve: solve,
    solved: function () { return litCount(state.board) === 0; },
    _neighbors: neighbors,
    _config: DIFFICULTY
  };

  // ---------- Init ----------
  buildGrid();
  newPuzzle(diffSelect.value);
})();
