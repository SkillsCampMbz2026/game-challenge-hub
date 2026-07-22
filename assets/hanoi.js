/* ===========================================================
   Tower of Hanoi — game logic
   - click-to-move and pointer drag-and-drop
   - valid-move checking, move counter, timer
   - difficulty (disk count), min-moves, victory detection
   - localStorage leaderboard
   =========================================================== */
(function () {
  "use strict";

  var LB_KEY = "hanoi.leaderboard.v1";
  var NAME_KEY = "hanoi.lastName";

  // ---------- DOM ----------
  var boardEl = document.getElementById("board");
  var pegEls = Array.prototype.slice.call(boardEl.querySelectorAll(".peg"));
  var diskContainers = pegEls.map(function (p) { return p.querySelector(".peg__disks"); });
  var moveCountEl = document.getElementById("moveCount");
  var minMovesEl = document.getElementById("minMoves");
  var timerEl = document.getElementById("timer");
  var diskStatEl = document.getElementById("diskStat");
  var diskSelect = document.getElementById("diskSelect");
  var restartBtn = document.getElementById("restartBtn");
  var solveBtn = document.getElementById("solveBtn");
  var hintEl = document.getElementById("hint");
  var dragLayer = document.getElementById("dragLayer");

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

  function newState(numDisks) {
    var first = [];
    for (var s = numDisks; s >= 1; s--) first.push(s); // bottom(largest) -> top(smallest)
    return {
      numDisks: numDisks,
      pegs: [first, [], []],
      moves: 0,
      selected: null,      // peg index of lifted disk
      startTime: null,
      elapsed: 0,
      timerId: null,
      finished: false,
      isDemo: false,       // true when auto-solved (not recorded)
      solving: false
    };
  }

  function minMoves(n) { return Math.pow(2, n) - 1; }

  // ---------- Rendering ----------
  function render() {
    diskContainers.forEach(function (c) { c.innerHTML = ""; });
    state.pegs.forEach(function (peg, pi) {
      peg.forEach(function (size, idx) {
        var isTop = idx === peg.length - 1;
        var d = document.createElement("div");
        d.className = "disk" + (isTop ? " is-top" : "");
        d.dataset.size = size;
        d.dataset.peg = pi;
        // width scales with size relative to the largest disk
        var pct = 34 + (size / state.numDisks) * 60; // 34%..94%
        d.style.width = pct + "%";
        d.textContent = size;
        diskContainers[pi].appendChild(d);
      });
    });
    updateSelectionVisual();
  }

  function updateSelectionVisual() {
    pegEls.forEach(function (p, i) {
      p.classList.toggle("is-selected", state.selected === i);
    });
    // lift the top disk of the selected peg
    diskContainers.forEach(function (c, i) {
      var top = c.lastElementChild;
      if (top) top.classList.toggle("is-lifted", state.selected === i && !state.solving);
    });
  }

  function setHint(msg, bad) {
    hintEl.innerHTML = msg;
    hintEl.classList.toggle("hint--bad", !!bad);
  }

  function updateStats() {
    moveCountEl.textContent = state.moves;
    diskStatEl.textContent = state.numDisks;
    minMovesEl.textContent = minMoves(state.numDisks);
  }

  // ---------- Timer ----------
  function startTimerIfNeeded() {
    if (state.startTime || state.finished) return;
    state.startTime = Date.now();
    state.timerId = setInterval(tickTimer, 250);
  }
  function tickTimer() {
    state.elapsed = Date.now() - state.startTime;
    timerEl.textContent = formatTime(state.elapsed);
  }
  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }
  function formatTime(ms) {
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  // ---------- Move logic ----------
  function topOf(pi) {
    var peg = state.pegs[pi];
    return peg.length ? peg[peg.length - 1] : Infinity; // empty peg accepts anything
  }
  function canMove(from, to) {
    if (from === to) return false;
    if (!state.pegs[from].length) return false;
    return state.pegs[from][state.pegs[from].length - 1] < topOf(to);
  }
  function doMove(from, to) {
    var disk = state.pegs[from].pop();
    state.pegs[to].push(disk);
    state.moves++;
    updateStats();
  }

  function attemptMove(from, to) {
    if (state.finished) return false;
    if (canMove(from, to)) {
      startTimerIfNeeded();
      doMove(from, to);
      state.selected = null;
      render();
      checkVictory();
      if (!state.finished) setHint("Nice move! Keep going — get the whole stack onto <strong>Finish</strong>.");
      return true;
    } else {
      setHint("Invalid move — you can't place a larger disk on a smaller one.", true);
      flashInvalid(to);
      return false;
    }
  }

  function flashInvalid(pi) {
    var el = pegEls[pi];
    el.classList.add("is-invalid-target");
    setTimeout(function () { el.classList.remove("is-invalid-target"); }, 300);
  }

  // ---------- Click-to-move ----------
  function onPegActivate(pi) {
    if (state.finished || state.solving) return;
    if (state.selected === null) {
      if (!state.pegs[pi].length) {
        setHint("That tower is empty. Click a tower that has a disk on top.", true);
        return;
      }
      state.selected = pi;
      updateSelectionVisual();
      setHint("Lifted disk <strong>" + topOf(pi) + "</strong>. Now click another tower to drop it.");
    } else if (state.selected === pi) {
      state.selected = null;
      updateSelectionVisual();
      setHint("Disk put back. Click a tower to lift its top disk.");
    } else {
      attemptMove(state.selected, pi);
    }
  }

  // ---------- Pointer drag ----------
  var drag = null;
  function onPointerDown(e) {
    if (state.finished || state.solving) return;
    var diskEl = e.target.closest(".disk");
    if (!diskEl) return;
    var pi = parseInt(diskEl.dataset.peg, 10);
    // only the top disk of a peg is grabbable
    if (state.pegs[pi][state.pegs[pi].length - 1] !== parseInt(diskEl.dataset.size, 10)) return;

    var rect = diskEl.getBoundingClientRect();
    drag = {
      from: pi,
      size: parseInt(diskEl.dataset.size, 10),
      origEl: diskEl,
      clone: null,
      moved: false,
      w: rect.width,
      h: rect.height,
      startX: e.clientX,
      startY: e.clientY
    };
    // pre-select so click fallback works
    state.selected = pi;
    updateSelectionVisual();
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }

  function onPointerMove(e) {
    if (!drag) return;
    var dx = e.clientX - drag.startX;
    var dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return; // threshold before it counts as a drag
    if (!drag.moved) {
      drag.moved = true;
      drag.origEl.classList.add("dragging");
      var clone = drag.origEl.cloneNode(true);
      clone.classList.remove("is-lifted", "is-top", "dragging");
      clone.style.width = drag.w + "px";
      clone.style.height = drag.h + "px";
      dragLayer.appendChild(clone);
      drag.clone = clone;
    }
    drag.clone.style.left = e.clientX + "px";
    drag.clone.style.top = e.clientY + "px";
    highlightTargetUnder(e.clientX, e.clientY);
  }

  function highlightTargetUnder(x, y) {
    pegEls.forEach(function (p) { p.classList.remove("is-valid-target", "is-invalid-target"); });
    var pi = pegIndexUnder(x, y);
    if (pi === null || pi === drag.from) return;
    pegEls[pi].classList.add(canMove(drag.from, pi) ? "is-valid-target" : "is-invalid-target");
  }

  function pegIndexUnder(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    var peg = el.closest(".peg");
    if (!peg) return null;
    return parseInt(peg.dataset.peg, 10);
  }

  function onPointerUp(e) {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    if (!drag) return;
    pegEls.forEach(function (p) { p.classList.remove("is-valid-target", "is-invalid-target"); });

    if (drag.moved) {
      if (drag.clone) drag.clone.remove();
      if (drag.origEl) drag.origEl.classList.remove("dragging");
      var target = pegIndexUnder(e.clientX, e.clientY);
      state.selected = null;
      if (target !== null && target !== drag.from) {
        attemptMove(drag.from, target);
      } else {
        render();
      }
    } else {
      // treat as a tap/click on the disk's peg
      var pi = drag.from;
      state.selected = null;               // reset the pre-selection...
      updateSelectionVisual();
      onPegActivate(pi);                    // ...then run normal click logic
    }
    drag = null;
  }

  // ---------- Victory ----------
  function checkVictory() {
    if (state.pegs[2].length === state.numDisks) {
      state.finished = true;
      stopTimer();
      updateSelectionVisual();
      showVictory();
    }
  }

  function showVictory() {
    var optimal = state.moves === minMoves(state.numDisks);
    if (state.isDemo) {
      victorySub.textContent = "Auto-solved demo — this run is not recorded on the leaderboard.";
    } else if (optimal) {
      victorySub.textContent = "Perfect! You solved it in the minimum number of moves. 🌟";
    } else {
      victorySub.textContent = "Well done! Try again to match the optimal " + minMoves(state.numDisks) + " moves.";
    }

    modalStats.innerHTML = "";
    addModalStat("Disks", state.numDisks);
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
    try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveLb(list) {
    try { localStorage.setItem(LB_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function saveScore() {
    var name = (playerNameInput.value || "").trim() || "Anonymous";
    localStorage.setItem(NAME_KEY, name);
    var list = loadLb();
    list.push({
      name: name.slice(0, 20),
      disks: state.numDisks,
      moves: state.moves,
      timeMs: state.elapsed,
      optimal: state.moves === minMoves(state.numDisks),
      date: Date.now()
    });
    saveLb(list);
    savedMsg.hidden = false;
    saveScoreBtn.disabled = true;
    playerNameInput.disabled = true;
    renderLb();
  }

  function renderLb() {
    var list = loadLb();
    if (lbFilter.value === "current") {
      list = list.filter(function (r) { return r.disks === state.numDisks; });
    }
    // rank: fewer moves first, then faster time
    list.sort(function (a, b) {
      if (a.moves !== b.moves) return a.moves - b.moves;
      return a.timeMs - b.timeMs;
    });
    list = list.slice(0, 10);

    lbBody.innerHTML = "";
    if (!list.length) {
      lbEmpty.hidden = false;
      return;
    }
    lbEmpty.hidden = true;
    var medals = ["🥇", "🥈", "🥉"];
    list.forEach(function (r, i) {
      var tr = document.createElement("tr");
      var rank = i < 3 ? '<span class="rank-medal">' + medals[i] + "</span>" : (i + 1);
      tr.innerHTML =
        "<td>" + rank + "</td>" +
        "<td>" + escapeHtml(r.name) + "</td>" +
        "<td>" + r.disks + "</td>" +
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
    // build move list from current *fresh* board
    startGame(parseInt(diskSelect.value, 10), true);
    var moves = [];
    (function hanoi(n, from, to, via) {
      if (n === 0) return;
      hanoi(n - 1, from, via, to);
      moves.push([from, to]);
      hanoi(n - 1, via, to, from);
    })(state.numDisks, 0, 2, 1);

    state.solving = true;
    state.isDemo = true;
    solveBtn.disabled = true;
    restartBtn.disabled = false;
    setHint("Auto-solving… watch the optimal solution.");
    startTimerIfNeeded();

    var i = 0;
    var speed = Math.max(320, 1400 / state.numDisks);
    var iv = setInterval(function () {
      if (i >= moves.length || !state.solving) {
        clearInterval(iv);
        solveBtn.disabled = false;
        state.solving = false;
        if (state.pegs[2].length === state.numDisks && !state.finished) checkVictory();
        return;
      }
      doMove(moves[i][0], moves[i][1]);
      render();
      i++;
    }, speed);
  }

  // ---------- Game lifecycle ----------
  function startGame(numDisks, keepModalHidden) {
    if (state) stopTimer();
    state = newState(numDisks);
    state.solving = false;
    solveBtn.disabled = false;
    timerEl.textContent = "00:00";
    updateStats();
    render();
    setHint("Click the <strong>Start</strong> tower to lift its top disk — or drag a disk to another tower.");
    if (!keepModalHidden) hideVictory();
    renderLb();
  }

  // ---------- Events ----------
  pegEls.forEach(function (p) {
    var pi = parseInt(p.dataset.peg, 10);
    p.addEventListener("click", function (e) {
      // ignore clicks that were part of a drag (handled by pointer flow)
      if (drag) return;
      onPegActivate(pi);
    });
    p.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPegActivate(pi); }
    });
  });
  boardEl.addEventListener("pointerdown", onPointerDown);

  diskSelect.addEventListener("change", function () {
    startGame(parseInt(diskSelect.value, 10));
  });
  restartBtn.addEventListener("click", function () {
    state.solving = false;
    startGame(parseInt(diskSelect.value, 10));
  });
  solveBtn.addEventListener("click", autoSolve);

  playAgainBtn.addEventListener("click", function () {
    startGame(parseInt(diskSelect.value, 10));
  });
  saveScoreBtn.addEventListener("click", saveScore);
  playerNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); if (!saveScoreBtn.disabled) saveScore(); }
  });

  howToBtn.addEventListener("click", function () {
    var open = instructions.hasAttribute("hidden");
    if (open) { instructions.removeAttribute("hidden"); } else { instructions.setAttribute("hidden", ""); }
    howToBtn.setAttribute("aria-expanded", String(open));
  });

  lbFilter.addEventListener("change", renderLb);
  clearLbBtn.addEventListener("click", function () {
    if (confirm("Clear all saved leaderboard scores? This cannot be undone.")) {
      saveLb([]);
      renderLb();
    }
  });

  victoryModal.addEventListener("click", function (e) {
    if (e.target === victoryModal) hideVictory();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !victoryModal.hidden) hideVictory();
  });

  // Expose a tiny hook for automated testing / verification
  window.__hanoi = {
    getState: function () { return state; },
    move: function (from, to) { return attemptMove(from, to); },
    solved: function () { return state.pegs[2].length === state.numDisks; }
  };

  // ---------- Init ----------
  startGame(parseInt(diskSelect.value, 10));
})();
