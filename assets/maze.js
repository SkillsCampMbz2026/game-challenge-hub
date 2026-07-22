/* ===========================================================
   Sewer Escape — first-person 3D maze (raycasting)
   - randomized, always-solvable maze (recursive backtracker)
   - open ROOMS carved into the maze
   - find 3 keys, then reach the exit gate to escape
   - a giant bloody rat hunts you (BFS) — rendered as a real
     perspective-projected, wall-occluded 3D model
   - LOCKERS you can hide in (press E); the rat loses your scent
   - move counter, timer, difficulty, win/lose detection
   - localStorage leaderboard (name, difficulty, moves, time)

   Rendering is guarded so the logic can be unit-tested headlessly.
   Test hook: window.__maze
   =========================================================== */
(function () {
  "use strict";

  var FOV = Math.PI / 3;
  var LB_KEY = "maze.leaderboard.v1";
  var NAME_KEY = "maze.lastName";

  var DIFFS = {
    easy:   { label: "Easy",   cells: 6,  monsterSpeed: 1.15, viewDist: 8,  catch: 0.50, rooms: 2, lockers: 2 },
    medium: { label: "Medium", cells: 8,  monsterSpeed: 1.45, viewDist: 9,  catch: 0.48, rooms: 3, lockers: 3 },
    hard:   { label: "Hard",   cells: 11, monsterSpeed: 1.75, viewDist: 10, catch: 0.46, rooms: 4, lockers: 4 }
  };
  var PLAYER_SPEED = 2.7;
  var TURN_SPEED = 2.7;
  var RADIUS = 0.22;

  // ---------- DOM ----------
  var canvas = document.getElementById("view");
  var ctx = canvas ? canvas.getContext("2d") : null;
  var minimap = document.getElementById("minimap");
  var mmCtx = minimap ? minimap.getContext("2d") : null;

  var keysEl = document.getElementById("keysStat");
  var timerEl = document.getElementById("timer");
  var movesEl = document.getElementById("moveCount");
  var diffStatEl = document.getElementById("diffStat");
  var messageEl = document.getElementById("message");
  var interactEl = document.getElementById("interactHint");
  var lockerOverlayEl = document.getElementById("lockerOverlay");
  var vignetteEl = document.getElementById("vignette");
  var lockHintEl = document.getElementById("lockHint");

  var diffSelect = document.getElementById("diffSelect");
  var newBtn = document.getElementById("newBtn");
  var restartBtn = document.getElementById("restartBtn");
  var howToBtn = document.getElementById("howToBtn");
  var instructions = document.getElementById("instructions");

  var modal = document.getElementById("endModal");
  var modalIcon = document.getElementById("modalIcon");
  var modalTitle = document.getElementById("modalTitle");
  var modalSub = document.getElementById("modalSub");
  var modalStats = document.getElementById("modalStats");
  var saveRow = document.getElementById("saveRow");
  var playerNameInput = document.getElementById("playerName");
  var saveScoreBtn = document.getElementById("saveScoreBtn");
  var savedMsg = document.getElementById("savedMsg");
  var againBtn = document.getElementById("againBtn");

  var lbFilter = document.getElementById("lbFilter");
  var clearLbBtn = document.getElementById("clearLbBtn");
  var lbBody = document.getElementById("lbBody");
  var lbEmpty = document.getElementById("lbEmpty");

  var view = { w: 800, h: 500, dpr: 1 };
  var zBuffer = [];

  var state = null;
  var input = { forward: false, back: false, turnL: false, turnR: false, strafeL: false, strafeR: false };
  var mouseYaw = 0;

  // ============================================================
  //  Maze generation
  // ============================================================
  function generateMaze(cells) {
    var w = cells * 2 + 1, h = cells * 2 + 1;
    var g = new Array(w * h).fill(1);
    function idx(x, y) { return y * w + x; }
    var stack = [[1, 1]];
    g[idx(1, 1)] = 0;
    var dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    while (stack.length) {
      var cur = stack[stack.length - 1], cx = cur[0], cy = cur[1];
      var options = [];
      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && g[idx(nx, ny)] === 1) options.push([nx, ny, cx + dirs[d][0] / 2, cy + dirs[d][1] / 2]);
      }
      if (!options.length) { stack.pop(); continue; }
      var pick = options[randInt(options.length)];
      g[idx(pick[2], pick[3])] = 0;
      g[idx(pick[0], pick[1])] = 0;
      stack.push([pick[0], pick[1]]);
    }
    return { grid: g, w: w, h: h };
  }

  // Carve open rooms. Centered on an already-connected corridor cell and
  // grown as a contiguous rectangle -> the whole room stays connected.
  function carveRooms(grid, w, h, count) {
    var roomTiles = [];
    for (var r = 0; r < count; r++) {
      var cx = 1 + 2 * randInt((w - 1) / 2);   // odd interior corridor cell
      var cy = 1 + 2 * randInt((h - 1) / 2);
      var hw = 1 + randInt(2), hh = 1 + randInt(2); // half-sizes -> up to 5x5
      for (var y = Math.max(1, cy - hh); y <= Math.min(h - 2, cy + hh); y++) {
        for (var x = Math.max(1, cx - hw); x <= Math.min(w - 2, cx + hw); x++) {
          grid[y * w + x] = 0;
          roomTiles.push([x, y]);
        }
      }
    }
    return roomTiles;
  }

  function randInt(n) { return Math.floor(Math.random() * n); }

  function bfsFrom(grid, w, h, sx, sy, blocked) {
    var dist = new Int32Array(w * h).fill(-1);
    var prev = new Int32Array(w * h).fill(-1);
    var s = sy * w + sx;
    var q = [s]; dist[s] = 0; var head = 0;
    var nb = [1, -1, w, -w];
    while (head < q.length) {
      var c = q[head++], cx = c % w, cy = (c - cx) / w;
      for (var k = 0; k < 4; k++) {
        var n = c + nb[k], nx = n % w, ny = (n - nx) / w;
        if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (grid[n] !== 0) continue;
        if (blocked && blocked.has(nx + "," + ny)) continue;
        if (dist[n] !== -1) continue;
        dist[n] = dist[c] + 1; prev[n] = c; q.push(n);
      }
    }
    return { dist: dist, prev: prev };
  }

  function bfsPath(grid, w, h, from, to) {
    var res = bfsFrom(grid, w, h, from[0], from[1]);
    var t = to[1] * w + to[0];
    if (res.dist[t] === -1) return null;
    var path = [], c = t;
    while (c !== -1) { var cx = c % w; path.push([cx, (c - cx) / w]); c = res.prev[c]; }
    path.reverse();
    return path;
  }

  function reachableFrom(grid, w, h, sx, sy, blocked) {
    var res = bfsFrom(grid, w, h, sx, sy, blocked);
    var set = new Set();
    for (var i = 0; i < res.dist.length; i++) if (res.dist[i] >= 0) { var x = i % w; set.add(x + "," + ((i - x) / w)); }
    return set;
  }

  // ============================================================
  //  Level building
  // ============================================================
  function buildLevel(diffKey) {
    var cfg = DIFFS[diffKey];
    var m = generateMaze(cfg.cells);
    var w = m.w, h = m.h, grid = m.grid;
    var roomTiles = carveRooms(grid, w, h, cfg.rooms);
    var roomSet = new Set(roomTiles.map(function (t) { return t[0] + "," + t[1]; }));

    var start = [1, 1];
    var exit = [w - 2, h - 2];
    var res = bfsFrom(grid, w, h, start[0], start[1]);
    var maxDist = 0;
    for (var i = 0; i < res.dist.length; i++) if (res.dist[i] > maxDist) maxDist = res.dist[i];

    var floors = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (grid[y * w + x] === 0) floors.push({ x: x, y: y, d: res.dist[y * w + x] });

    // keys — far from start, spread apart
    var keyMin = Math.max(3, Math.floor(maxDist * 0.28));
    var keyCands = floors.filter(function (f) { return f.d >= keyMin && !same(f, start) && !same(f, exit); });
    shuffle(keyCands);
    var keyTiles = [];
    var spacing = Math.max(2, Math.floor(w / 4));
    for (var c = 0; c < keyCands.length && keyTiles.length < 3; c++) {
      if (keyTiles.every(function (k) { return Math.abs(keyCands[c].x - k[0]) + Math.abs(keyCands[c].y - k[1]) >= spacing; }))
        keyTiles.push([keyCands[c].x, keyCands[c].y]);
    }
    for (var c2 = 0; c2 < keyCands.length && keyTiles.length < 3; c2++) {
      var t = [keyCands[c2].x, keyCands[c2].y];
      if (!keyTiles.some(function (k) { return k[0] === t[0] && k[1] === t[1]; })) keyTiles.push(t);
    }
    var keySet = new Set(keyTiles.map(function (k) { return k[0] + "," + k[1]; }));

    // lockers — wall-backed floor tiles (prefer rooms), never breaking reachability
    var lockerCands = floors.filter(function (f) {
      if (same(f, start) || same(f, exit) || keySet.has(f.x + "," + f.y)) return false;
      return adjWallCount(grid, w, h, f.x, f.y) >= 1;
    });
    lockerCands.sort(function (a, b) { // rooms first, then variety
      var ra = roomSet.has(a.x + "," + a.y) ? 0 : 1;
      var rb = roomSet.has(b.x + "," + b.y) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return 0;
    });
    shuffleStable(lockerCands, function (f) { return roomSet.has(f.x + "," + f.y); });
    var lockers = [], lockerSet = new Set();
    for (var lc = 0; lc < lockerCands.length && lockers.length < cfg.lockers; lc++) {
      var f = lockerCands[lc];
      var key = f.x + "," + f.y;
      if (lockerSet.has(key)) continue;
      var trial = new Set(lockerSet); trial.add(key);
      // player must still reach every key + the exit with this locker blocked
      var reach = reachableFrom(grid, w, h, start[0], start[1], trial);
      var ok = reach.has(exit[0] + "," + exit[1]) && keyTiles.every(function (k) { return reach.has(k[0] + "," + k[1]); });
      if (ok) { lockers.push({ x: f.x, y: f.y }); lockerSet.add(key); }
    }

    // monster start — far, not on start/exit/key/locker
    var monCands = floors.filter(function (f) {
      return f.d >= maxDist * 0.5 && !same(f, start) && !same(f, exit) &&
        !keySet.has(f.x + "," + f.y) && !lockerSet.has(f.x + "," + f.y);
    });
    if (!monCands.length) monCands = floors.filter(function (f) { return f.d >= maxDist * 0.35; });
    var mon = monCands[randInt(monCands.length)] || { x: exit[0], y: exit[1] };

    var angle = 0;
    var nn = [[1, 0, 0], [0, 1, Math.PI / 2], [-1, 0, Math.PI], [0, -1, -Math.PI / 2]];
    for (var n = 0; n < nn.length; n++) if (grid[(start[1] + nn[n][1]) * w + (start[0] + nn[n][0])] === 0) { angle = nn[n][2]; break; }

    return {
      diff: diffKey, cfg: cfg, grid: grid, w: w, h: h, start: start, exit: exit,
      keyTiles: keyTiles, monsterStart: [mon.x, mon.y], startAngle: angle,
      lockers: lockers, lockerSet: lockerSet, roomSet: roomSet
    };
  }

  function same(f, t) { return f.x === t[0] && f.y === t[1]; }
  function adjWallCount(grid, w, h, x, y) {
    var n = 0, d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var nx = x + d[i][0], ny = y + d[i][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || grid[ny * w + nx] === 1) n++;
    }
    return n;
  }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = randInt(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function shuffleStable(a, pref) { // shuffle within the preferred group, keep group order
    var A = a.filter(pref), B = a.filter(function (x) { return !pref(x); });
    shuffle(A); shuffle(B);
    for (var i = 0; i < a.length; i++) a[i] = i < A.length ? A[i] : B[i - A.length];
    return a;
  }

  // ============================================================
  //  Lifecycle
  // ============================================================
  function newGame(diffKey) { initFromLevel(buildLevel(diffKey)); }

  function initFromLevel(level) {
    state = {
      level: level, diff: level.diff, grid: level.grid, w: level.w, h: level.h, exit: level.exit,
      player: { x: level.start[0] + 0.5, y: level.start[1] + 0.5, angle: level.startAngle },
      monster: { x: level.monsterStart[0] + 0.5, y: level.monsterStart[1] + 0.5, angle: 0, mode: "chase", wanderTarget: null },
      keys: level.keyTiles.map(function (t) { return { x: t[0] + 0.5, y: t[1] + 0.5, collected: false }; }),
      lockers: level.lockers.map(function (l) { return { x: l.x, y: l.y }; }),
      lockerSet: level.lockerSet,
      keysCollected: 0, moves: 0, lastTile: [level.start[0], level.start[1]],
      elapsed: 0, started: false, status: "playing", msgTimer: 0,
      hidden: false, hideLocker: null, t: 0
    };
    setMessage("Find all 3 keys, then reach the exit gate. Hide in a locker (E) if the rat gets close!", 4);
    hideModal();
    if (lockerOverlayEl) lockerOverlayEl.style.opacity = "0";
    updateHud(); render(); renderMinimap(); renderLb();
  }

  function restart() { if (state && state.level) initFromLevel(state.level); }

  // ============================================================
  //  Update (pure logic)
  // ============================================================
  function update(dt) {
    if (!state || state.status !== "playing") return;
    if (dt > 0.05) dt = 0.05;
    state.t += dt;
    movePlayer(dt);
    moveMonster(dt);
    if (!state.hidden) { collectKeys(); checkCatch(); checkExit(); }
    updateInteractHint();
    if (state.started) state.elapsed += dt * 1000;
    if (state.msgTimer > 0) { state.msgTimer -= dt; if (state.msgTimer <= 0) setMessage("", 0); }
  }

  function dirVec(a) { a = a === undefined ? state.player.angle : a; return { x: Math.cos(a), y: Math.sin(a) }; }

  function movePlayer(dt) {
    if (state.hidden) { mouseYaw = 0; return; } // frozen while hiding
    var p = state.player;
    var turn = (input.turnR ? 1 : 0) - (input.turnL ? 1 : 0);
    var fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    var strafe = (input.strafeR ? 1 : 0) - (input.strafeL ? 1 : 0);
    if (turn || fwd || strafe || mouseYaw) markStarted();
    p.angle += turn * TURN_SPEED * dt + mouseYaw; mouseYaw = 0;
    var d = dirVec();
    var rx = -d.y, ry = d.x;
    var vx = (d.x * fwd + rx * strafe) * PLAYER_SPEED * dt;
    var vy = (d.y * fwd + ry * strafe) * PLAYER_SPEED * dt;
    if (canBeAt(p.x + vx, p.y)) p.x += vx;
    if (canBeAt(p.x, p.y + vy)) p.y += vy;
    var tx = Math.floor(p.x), ty = Math.floor(p.y);
    if (tx !== state.lastTile[0] || ty !== state.lastTile[1]) { state.moves++; state.lastTile = [tx, ty]; }
  }
  function markStarted() { if (!state.started) state.started = true; }

  function isFloor(x, y) {
    var tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= state.w || ty >= state.h) return false;
    return state.grid[ty * state.w + tx] === 0;
  }
  function isLockerTile(tx, ty) { return state.lockerSet.has(tx + "," + ty); }
  function isWalkable(x, y) { return isFloor(x, y) && !isLockerTile(Math.floor(x), Math.floor(y)); }
  function canBeAt(x, y) {
    return isWalkable(x - RADIUS, y) && isWalkable(x + RADIUS, y) &&
           isWalkable(x, y - RADIUS) && isWalkable(x, y + RADIUS) &&
           isWalkable(x - RADIUS, y - RADIUS) && isWalkable(x + RADIUS, y + RADIUS) &&
           isWalkable(x - RADIUS, y + RADIUS) && isWalkable(x + RADIUS, y - RADIUS);
  }

  function moveMonster(dt) {
    var m = state.monster, p = state.player;
    var mt = [Math.floor(m.x), Math.floor(m.y)];
    var searching = state.hidden || m.mode === "wander";
    var goal;
    if (searching) {
      if (!m.wanderTarget || (mt[0] === m.wanderTarget[0] && mt[1] === m.wanderTarget[1])) m.wanderTarget = pickWanderTile(mt);
      goal = m.wanderTarget;
    } else {
      goal = [Math.floor(p.x), Math.floor(p.y)];
    }
    var target;
    if (mt[0] === goal[0] && mt[1] === goal[1]) target = searching ? [mt[0] + 0.5, mt[1] + 0.5] : [p.x, p.y];
    else {
      var path = bfsPath(state.grid, state.w, state.h, mt, goal);
      target = (path && path.length >= 2) ? [path[1][0] + 0.5, path[1][1] + 0.5] : (searching ? [mt[0] + 0.5, mt[1] + 0.5] : [p.x, p.y]);
    }
    var dx = target[0] - m.x, dy = target[1] - m.y, dd = Math.hypot(dx, dy);
    var speed = state.level.cfg.monsterSpeed * (searching ? 0.7 : 1);
    if (dd > 1e-4) {
      var step = Math.min(speed * dt, dd);
      m.x += dx / dd * step; m.y += dy / dd * step;
      var ta = Math.atan2(dy, dx);
      m.angle = angleLerp(m.angle, ta, Math.min(1, 10 * dt));
    }
  }
  function pickWanderTile(mt) {
    var res = bfsFrom(state.grid, state.w, state.h, mt[0], mt[1]);
    var cands = [];
    for (var i = 0; i < res.dist.length; i++) if (res.dist[i] >= 4) { var x = i % state.w; cands.push([x, (i - x) / state.w]); }
    if (!cands.length) return [mt[0], mt[1]];
    return cands[randInt(cands.length)];
  }
  function angleLerp(a, b, t) { var d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; }

  function collectKeys() {
    for (var i = 0; i < state.keys.length; i++) {
      var k = state.keys[i];
      if (k.collected) continue;
      if (Math.hypot(k.x - state.player.x, k.y - state.player.y) < 0.5) {
        k.collected = true; state.keysCollected++;
        var left = 3 - state.keysCollected;
        setMessage(left > 0 ? ("Key found! " + state.keysCollected + "/3 — " + left + " to go.") : "All 3 keys collected! Get to the exit gate!", 3);
        updateHud();
      }
    }
  }
  function checkCatch() {
    if (Math.hypot(state.monster.x - state.player.x, state.monster.y - state.player.y) < state.level.cfg.catch) { state.status = "lost"; showEnd(false); }
  }
  function checkExit() {
    var p = state.player;
    if (Math.floor(p.x) === state.exit[0] && Math.floor(p.y) === state.exit[1]) {
      if (state.keysCollected >= 3) { state.status = "won"; showEnd(true); }
      else if (state.msgTimer <= 0.1) setMessage("The gate is locked! You still need " + (3 - state.keysCollected) + " key(s).", 2);
    }
  }

  // ---------- Lockers ----------
  function nearestLocker() {
    var best = null, bd = Infinity;
    for (var i = 0; i < state.lockers.length; i++) {
      var l = state.lockers[i];
      var d = Math.hypot(l.x + 0.5 - state.player.x, l.y + 0.5 - state.player.y);
      if (d < bd) { bd = d; best = l; }
    }
    return best ? { locker: best, dist: bd } : null;
  }
  function interact() {
    if (!state || state.status !== "playing") return;
    if (state.hidden) { exitLocker(); return; }
    var nl = nearestLocker();
    if (nl && nl.dist <= 1.5) enterLocker(nl.locker);
  }
  function enterLocker(l) {
    state.hidden = true; state.hideLocker = l;
    markStarted();
    state.monster.mode = "wander"; state.monster.wanderTarget = null;
    setMessage("Hidden! The rat can't smell you in here. Press E to climb out.", 0);
    if (lockerOverlayEl) lockerOverlayEl.style.opacity = "1";
  }
  function exitLocker() {
    state.hidden = false; state.hideLocker = null;
    state.monster.mode = "chase"; state.monster.wanderTarget = null;
    setMessage("You slip out of the locker…", 2);
    if (lockerOverlayEl) lockerOverlayEl.style.opacity = "0";
  }
  function updateInteractHint() {
    if (!interactEl) return;
    if (state.hidden) { interactEl.textContent = "Hidden — press E to climb out"; interactEl.style.opacity = "1"; return; }
    var nl = nearestLocker();
    if (nl && nl.dist <= 1.5) { interactEl.textContent = "Press E to hide in the locker"; interactEl.style.opacity = "1"; }
    else interactEl.style.opacity = "0";
  }

  function setMessage(msg, secs) {
    state.msgTimer = secs;
    if (messageEl) { messageEl.textContent = msg; messageEl.style.opacity = msg ? "1" : "0"; }
  }

  // ============================================================
  //  HUD
  // ============================================================
  function updateHud() {
    if (keysEl) keysEl.textContent = state.keysCollected + " / 3";
    if (movesEl) movesEl.textContent = state.moves;
    if (diffStatEl) diffStatEl.textContent = DIFFS[state.diff].label;
    if (timerEl) timerEl.textContent = formatTime(state.elapsed);
  }
  function formatTime(ms) { var t = Math.floor(ms / 1000); return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); }

  // ============================================================
  //  Sprites (keys / gate / locker) — billboarded
  // ============================================================
  var sprites = { key: null, gateLocked: null, gateOpen: null, locker: null };
  function ensureSprites() {
    if (!ctx || sprites.key) return;
    sprites.key = makeKeySprite();
    sprites.gateLocked = makeGateSprite(false);
    sprites.gateOpen = makeGateSprite(true);
    sprites.locker = makeLockerSprite();
  }
  function offscreen(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

  function makeKeySprite() {
    var c = offscreen(64, 64), x = c.getContext("2d"); if (!x) return c;
    x.shadowColor = "rgba(255,210,80,0.9)"; x.shadowBlur = 12;
    x.strokeStyle = "#ffce4d"; x.fillStyle = "#ffce4d"; x.lineWidth = 6; x.lineCap = "round";
    x.beginPath(); x.arc(24, 22, 12, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(24, 34); x.lineTo(24, 56); x.stroke();
    x.beginPath(); x.moveTo(24, 50); x.lineTo(34, 50); x.moveTo(24, 44); x.lineTo(32, 44); x.stroke();
    return c;
  }
  function makeGateSprite(open) {
    var c = offscreen(96, 120), x = c.getContext("2d"); if (!x) return c;
    var glow = open ? "rgba(60,230,140,0.9)" : "rgba(240,70,70,0.9)";
    var bar = open ? "#3ce68c" : "#c94b4b";
    x.shadowColor = glow; x.shadowBlur = 16; x.strokeStyle = bar; x.lineWidth = 7; x.lineCap = "round";
    for (var i = 0; i < 4; i++) { var bx = 16 + i * 21; x.beginPath(); x.moveTo(bx, 8); x.lineTo(bx, 112); x.stroke(); }
    x.beginPath(); x.moveTo(10, 22); x.lineTo(86, 22); x.moveTo(10, 60); x.lineTo(86, 60); x.moveTo(10, 98); x.lineTo(86, 98); x.stroke();
    x.shadowBlur = 0;
    if (!open) { x.fillStyle = "#ffd24d"; x.fillRect(40, 66, 16, 14); x.strokeStyle = "#ffd24d"; x.lineWidth = 3; x.beginPath(); x.arc(48, 66, 6, Math.PI, 0); x.stroke(); }
    return c;
  }
  function makeLockerSprite() {
    var c = offscreen(70, 118), x = c.getContext("2d"); if (!x) return c;
    var g = x.createLinearGradient(0, 0, 70, 0);
    g.addColorStop(0, "#3a4750"); g.addColorStop(0.5, "#5b6b74"); g.addColorStop(1, "#2b353c");
    x.fillStyle = g; x.fillRect(6, 4, 58, 112);
    x.strokeStyle = "#1b2228"; x.lineWidth = 3; x.strokeRect(6, 4, 58, 112);
    x.strokeStyle = "#232c33"; x.lineWidth = 2; x.beginPath(); x.moveTo(35, 6); x.lineTo(35, 114); x.stroke(); // door seam
    // vents
    x.strokeStyle = "rgba(15,20,24,0.9)"; x.lineWidth = 2;
    for (var v = 0; v < 5; v++) { var vy = 16 + v * 7; x.beginPath(); x.moveTo(12, vy); x.lineTo(30, vy); x.moveTo(40, vy); x.lineTo(58, vy); x.stroke(); }
    // handles
    x.fillStyle = "#cfd8de"; x.fillRect(29, 60, 4, 16); x.fillRect(37, 60, 4, 16);
    // grime
    x.fillStyle = "rgba(40,70,45,0.28)"; x.fillRect(6, 92, 58, 24);
    return c;
  }

  function resize() {
    if (!canvas) return;
    var cssW = canvas.clientWidth || 800, cssH = canvas.clientHeight || 500;
    view.dpr = window.devicePixelRatio || 1;
    view.w = cssW; view.h = cssH;
    canvas.width = Math.floor(cssW * view.dpr); canvas.height = Math.floor(cssH * view.dpr);
    if (ctx) ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  function render() {
    if (!ctx || !state) return;
    ensureSprites();
    var W = view.w, H = view.h, horizon = H / 2, p = state.player;

    var cg = ctx.createLinearGradient(0, 0, 0, horizon);
    cg.addColorStop(0, "#080f0a"); cg.addColorStop(1, "#16241a");
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, horizon);
    var fg = ctx.createLinearGradient(0, horizon, 0, H);
    fg.addColorStop(0, "#14261a"); fg.addColorStop(1, "#050d08");
    ctx.fillStyle = fg; ctx.fillRect(0, horizon, W, H - horizon);

    var dir = dirVec();
    var planeX = -dir.y * Math.tan(FOV / 2), planeY = dir.x * Math.tan(FOV / 2);
    var viewDist = state.level.cfg.viewDist;

    for (var x = 0; x < W; x++) {
      var cameraX = 2 * x / W - 1;
      var rdx = dir.x + planeX * cameraX, rdy = dir.y + planeY * cameraX;
      var mapX = Math.floor(p.x), mapY = Math.floor(p.y);
      var deltaX = Math.abs(rdx) < 1e-6 ? 1e30 : Math.abs(1 / rdx);
      var deltaY = Math.abs(rdy) < 1e-6 ? 1e30 : Math.abs(1 / rdy);
      var stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (p.x - mapX) * deltaX; } else { stepX = 1; sdx = (mapX + 1 - p.x) * deltaX; }
      if (rdy < 0) { stepY = -1; sdy = (p.y - mapY) * deltaY; } else { stepY = 1; sdy = (mapY + 1 - p.y) * deltaY; }
      var side = 0, hit = 0, guard = 0;
      while (!hit && guard++ < 512) {
        if (sdx < sdy) { sdx += deltaX; mapX += stepX; side = 0; } else { sdy += deltaY; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= state.w || mapY >= state.h) { hit = 1; break; }
        if (state.grid[mapY * state.w + mapX] > 0) hit = 1;
      }
      var perp = side === 0 ? (sdx - deltaX) : (sdy - deltaY);
      if (perp < 1e-3) perp = 1e-3;
      zBuffer[x] = perp;
      var lineH = H / perp, startY = horizon - lineH / 2;
      var wallX = side === 0 ? (p.y + perp * rdy) : (p.x + perp * rdx); wallX -= Math.floor(wallX);
      var brick = (Math.floor(wallX * 5) % 2 === 0) ? 1 : 0.84;
      var fog = clamp(1 - perp / viewDist, 0.1, 1), sd = side === 1 ? 0.66 : 1, f = fog * sd * brick;
      ctx.fillStyle = "rgb(" + Math.floor(74 * f) + "," + Math.floor(96 * f) + "," + Math.floor(66 * f) + ")";
      ctx.fillRect(x, startY, 1, lineH + 1);
    }

    // renderables (billboards + the 3D rat), sorted far -> near
    var list = [];
    for (var i = 0; i < state.keys.length; i++) if (!state.keys[i].collected) list.push({ t: "bb", x: state.keys[i].x, y: state.keys[i].y, img: sprites.key, scale: 0.5, vy: 0.28 });
    for (var li = 0; li < state.lockers.length; li++) list.push({ t: "bb", x: state.lockers[li].x + 0.5, y: state.lockers[li].y + 0.5, img: sprites.locker, scale: 0.92, vy: 0.06 });
    list.push({ t: "bb", x: state.exit[0] + 0.5, y: state.exit[1] + 0.5, img: state.keysCollected >= 3 ? sprites.gateOpen : sprites.gateLocked, scale: 0.95, vy: 0.05 });
    list.push({ t: "rat", x: state.monster.x, y: state.monster.y });

    list.sort(function (a, b) {
      return ((b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y)) - ((a.x - p.x) * (a.x - p.x) + (a.y - p.y) * (a.y - p.y));
    });
    for (var s = 0; s < list.length; s++) {
      if (list[s].t === "rat") drawRat(dir, planeX, planeY, horizon);
      else drawSprite(list[s], dir, planeX, planeY);
    }

    if (vignetteEl) {
      var md = Math.hypot(state.monster.x - p.x, state.monster.y - p.y);
      var intensity = state.hidden ? 0 : clamp((3.2 - md) / 3.2, 0, 1);
      vignetteEl.style.opacity = (intensity * 0.85).toFixed(3);
    }
  }

  function drawSprite(s, dir, planeX, planeY) {
    var W = view.w, H = view.h, p = state.player;
    var relX = s.x - p.x, relY = s.y - p.y;
    var invDet = 1 / (planeX * dir.y - dir.x * planeY);
    var tX = invDet * (dir.y * relX - dir.x * relY);
    var tY = invDet * (-planeY * relX + planeX * relY);
    if (tY <= 0.05) return;
    var scrX = (W / 2) * (1 + tX / tY);
    var sh = Math.abs(H / tY) * s.scale, sw = sh * (s.img.width / s.img.height);
    var vShift = (s.vy || 0) * (H / tY);
    var startY = H / 2 - sh / 2 + vShift;
    var startX = Math.floor(scrX - sw / 2), endX = Math.floor(scrX + sw / 2), iw = s.img.width;
    for (var x = startX; x < endX; x++) {
      if (x < 0 || x >= W) continue;
      if (tY >= zBuffer[x]) continue;
      var texX = Math.floor((x - startX) / sw * iw);
      if (texX < 0) texX = 0; if (texX >= iw) texX = iw - 1;
      ctx.drawImage(s.img, texX, 0, 1, s.img.height, x, startY, 1, sh);
    }
  }

  // ---------- 3D rat (perspective-projected, shaded, wall-occluded) ----------
  var RAT_PARTS = ratModel();
  function ratModel() {
    // local: x forward, y left(+), z up. [x,y,z,r, colorType]
    return [
      [-0.34, 0, 0.34, 0.30, "body"],
      [-0.08, 0, 0.37, 0.35, "body"],
      [0.20, 0, 0.35, 0.28, "body"],
      [0.30, 0.05, 0.58, 0.11, "blood"],
      [-0.02, -0.06, 0.60, 0.12, "blood"],
      [0.48, 0, 0.35, 0.21, "head"],
      [0.66, 0, 0.29, 0.10, "head"],
      [0.76, 0, 0.28, 0.05, "nose"],
      [0.70, 0, 0.20, 0.05, "blood"],
      [0.45, 0.16, 0.54, 0.11, "ear"],
      [0.45, -0.16, 0.54, 0.11, "ear"],
      [0.60, 0.10, 0.41, 0.05, "eye"],
      [0.60, -0.10, 0.41, 0.05, "eye"],
      [0.30, 0.20, 0.10, 0.07, "leg0"],
      [0.30, -0.20, 0.10, 0.07, "leg1"],
      [-0.20, 0.22, 0.10, 0.08, "leg1"],
      [-0.20, -0.22, 0.10, 0.08, "leg0"],
      [-0.58, 0, 0.30, 0.06, "tail"],
      [-0.82, 0.06, 0.24, 0.05, "tail"],
      [-1.04, 0.14, 0.20, 0.04, "tail"],
      [-1.22, 0.24, 0.16, 0.035, "tail"]
    ];
  }
  var RAT_SIZE = 1.15;

  function drawRat(dir, planeX, planeY, horizon) {
    var W = view.w, H = view.h, p = state.player, m = state.monster;
    var ca = Math.cos(m.angle), sa = Math.sin(m.angle);
    var invDet = 1 / (planeX * dir.y - dir.x * planeY);
    var bob = Math.sin(state.t * 8) * 0.03;
    var legPh = Math.sin(state.t * 11) * 0.06;
    var fog = clamp(1 - Math.hypot(m.x - p.x, m.y - p.y) / (state.level.cfg.viewDist + 2), 0.18, 1);

    var parts = [];
    for (var i = 0; i < RAT_PARTS.length; i++) {
      var q = RAT_PARTS[i];
      var lx = q[0] * RAT_SIZE, ly = q[1] * RAT_SIZE, lz = q[2] * RAT_SIZE, r = q[3] * RAT_SIZE, type = q[4];
      if (type === "leg0") lz += Math.max(0, legPh);
      if (type === "leg1") lz += Math.max(0, -legPh);
      // rotate local (x fwd, y left) into world
      var wx = m.x + lx * ca - ly * sa;
      var wy = m.y + lx * sa + ly * ca;
      var wz = lz + bob;
      var relX = wx - p.x, relY = wy - p.y;
      var tX = invDet * (dir.y * relX - dir.x * relY);
      var tY = invDet * (-planeY * relX + planeX * relY);
      if (tY <= 0.06) continue;
      var scaleH = H / tY;
      var sx = (W / 2) * (1 + tX / tY);
      var sy = horizon + (0.5 - wz) * scaleH;
      var sr = r * scaleH;
      parts.push({ sx: sx, sy: sy, sr: sr, tY: tY, type: type });
    }
    parts.sort(function (a, b) { return b.tY - a.tY; });
    for (var pi = 0; pi < parts.length; pi++) drawRatPart(parts[pi], fog, W, H);
  }

  function drawRatPart(pt, fog, W, H) {
    if (pt.sr < 0.4) return;
    var runs = visibleRuns(pt.sx - pt.sr, pt.sx + pt.sr, pt.tY, W);
    if (!runs.length) return;
    for (var ri = 0; ri < runs.length; ri++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(runs[ri][0], 0, runs[ri][1] - runs[ri][0] + 1, H);
      ctx.clip();
      paintBlob(pt, fog);
      ctx.restore();
    }
  }

  function paintBlob(pt, fog) {
    var x = pt.sx, y = pt.sy, r = pt.sr, type = pt.type;
    if (type === "eye") {
      ctx.shadowColor = "rgba(255,40,40,0.95)"; ctx.shadowBlur = r * 4;
      ctx.fillStyle = "#ff3b3b";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }
    var pal;
    switch (type) {
      case "blood": pal = ["#c0161f", "#5c0206"]; break;
      case "ear": pal = ["#b78b92", "#5c4247"]; break;
      case "nose": pal = ["#c99", "#402a2d"]; break;
      case "tail": pal = ["#c8a6ad", "#6a4a50"]; break;
      case "head": pal = ["#9a9aa2", "#41414a"]; break;
      default: pal = ["#909299", "#3d3d45"];
    }
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, shade(pal[0], fog));
    g.addColorStop(1, shade(pal[1], fog));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function shade(hex, f) {
    var n = parseInt(hex.length === 4 ? hex.replace(/./g, function (c, i) { return i ? c + c : c; }).slice(1) : hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return "rgb(" + Math.floor(r * f) + "," + Math.floor(g * f) + "," + Math.floor(b * f) + ")";
  }

  function visibleRuns(x0, x1, depth, W) {
    var runs = [], s = -1;
    var a = Math.max(0, Math.floor(x0)), b = Math.min(W - 1, Math.ceil(x1));
    for (var x = a; x <= b; x++) {
      var vis = depth < (zBuffer[x] === undefined ? Infinity : zBuffer[x]);
      if (vis && s < 0) s = x;
      if (!vis && s >= 0) { runs.push([s, x - 1]); s = -1; }
    }
    if (s >= 0) runs.push([s, b]);
    return runs;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function renderMinimap() {
    if (!mmCtx || !state) return;
    var w = state.w, h = state.h, size = minimap.width, cell = size / Math.max(w, h);
    mmCtx.clearRect(0, 0, minimap.width, minimap.height);
    mmCtx.fillStyle = "rgba(6,12,8,0.85)"; mmCtx.fillRect(0, 0, size, size);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (state.grid[y * w + x] === 0) { mmCtx.fillStyle = "#24422e"; mmCtx.fillRect(x * cell, y * cell, cell, cell); }
    // lockers
    for (var l = 0; l < state.lockers.length; l++) { mmCtx.fillStyle = "#8aa0ad"; mmCtx.fillRect(state.lockers[l].x * cell + cell * 0.2, state.lockers[l].y * cell + cell * 0.2, cell * 0.6, cell * 0.6); }
    mmCtx.fillStyle = state.keysCollected >= 3 ? "#3ce68c" : "#c94b4b";
    mmCtx.fillRect(state.exit[0] * cell, state.exit[1] * cell, cell, cell);
    for (var i = 0; i < state.keys.length; i++) if (state.keys[i].collected) { mmCtx.fillStyle = "#ffce4d"; mmCtx.fillRect((state.keys[i].x - 0.5) * cell + cell * 0.25, (state.keys[i].y - 0.5) * cell + cell * 0.25, cell * 0.5, cell * 0.5); }
    var px = state.player.x * cell, py = state.player.y * cell;
    mmCtx.fillStyle = "#7dd3fc"; mmCtx.beginPath(); mmCtx.arc(px, py, Math.max(2, cell * 0.35), 0, Math.PI * 2); mmCtx.fill();
    var d = dirVec(); mmCtx.strokeStyle = "#7dd3fc"; mmCtx.lineWidth = 2; mmCtx.beginPath(); mmCtx.moveTo(px, py); mmCtx.lineTo(px + d.x * cell, py + d.y * cell); mmCtx.stroke();
  }

  // ============================================================
  //  Loop
  // ============================================================
  var running = false, lastT = 0;
  function frame(t) {
    if (!running) return;
    var dt = (t - lastT) / 1000; lastT = t;
    if (!isFinite(dt) || dt < 0) dt = 0;
    update(dt); render(); renderMinimap(); updateHud();
    window.requestAnimationFrame(frame);
  }
  function startLoop() { if (running) return; running = true; lastT = (window.performance && performance.now) ? performance.now() : 0; window.requestAnimationFrame(frame); }

  // ============================================================
  //  End / leaderboard
  // ============================================================
  function showEnd(won) {
    if (vignetteEl) vignetteEl.style.opacity = "0";
    if (lockerOverlayEl) lockerOverlayEl.style.opacity = "0";
    if (interactEl) interactEl.style.opacity = "0";
    if (!modal) return;
    modalIcon.textContent = won ? "🔑" : "🐀";
    modalTitle.textContent = won ? "You escaped!" : "You were caught!";
    modalSub.textContent = won ? "You found all 3 keys and made it out of the sewers alive." : "The giant rat sank its teeth in. Try again!";
    modalStats.innerHTML = "";
    addStat("Difficulty", DIFFS[state.diff].label); addStat("Moves", state.moves); addStat("Time", formatTime(state.elapsed));
    if (won) { saveRow.hidden = false; savedMsg.hidden = true; saveScoreBtn.disabled = false; playerNameInput.disabled = false; playerNameInput.value = localStorage.getItem(NAME_KEY) || ""; }
    else saveRow.hidden = true;
    modal.hidden = false; exitPointerLock();
    if (won) setTimeout(function () { try { playerNameInput.focus(); } catch (e) {} }, 60);
  }
  function addStat(label, value) { var d = document.createElement("div"); d.className = "stat"; d.innerHTML = '<span class="stat__label">' + label + '</span><span class="stat__value">' + value + "</span>"; modalStats.appendChild(d); }
  function hideModal() { if (modal) modal.hidden = true; }

  function loadLb() { try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch (e) { return []; } }
  function saveLb(l) { try { localStorage.setItem(LB_KEY, JSON.stringify(l)); } catch (e) {} }
  function saveScore() {
    var name = (playerNameInput.value || "").trim() || "Anonymous";
    localStorage.setItem(NAME_KEY, name);
    var l = loadLb();
    l.push({ name: name.slice(0, 20), difficulty: state.diff, moves: state.moves, timeMs: state.elapsed, date: Date.now() });
    saveLb(l); savedMsg.hidden = false; saveScoreBtn.disabled = true; playerNameInput.disabled = true; renderLb();
  }
  function renderLb() {
    if (!lbBody) return;
    var l = loadLb();
    if (lbFilter && lbFilter.value === "current" && state) l = l.filter(function (r) { return r.difficulty === state.diff; });
    l.sort(function (a, b) { if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs; return a.moves - b.moves; });
    l = l.slice(0, 10);
    lbBody.innerHTML = "";
    if (!l.length) { if (lbEmpty) lbEmpty.hidden = false; return; }
    if (lbEmpty) lbEmpty.hidden = true;
    var medals = ["🥇", "🥈", "🥉"];
    l.forEach(function (r, i) {
      var tr = document.createElement("tr");
      var rank = i < 3 ? '<span class="rank-medal">' + medals[i] + "</span>" : (i + 1);
      var dl = (DIFFS[r.difficulty] || { label: r.difficulty }).label;
      tr.innerHTML = "<td>" + rank + "</td><td>" + esc(r.name) + "</td><td>" + esc(dl) + "</td><td>" + r.moves + "</td><td>" + formatTime(r.timeMs) + "</td>";
      lbBody.appendChild(tr);
    });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // ============================================================
  //  Input
  // ============================================================
  function keyDown(e) {
    if (e.code === "KeyE") { if (!e.repeat) interact(); e.preventDefault(); return; }
    if (mapKey(e.code, true)) e.preventDefault();
  }
  function keyUp(e) { if (mapKey(e.code, false)) e.preventDefault(); }
  function mapKey(code, down) {
    switch (code) {
      case "ArrowUp": case "KeyW": input.forward = down; return true;
      case "ArrowDown": case "KeyS": input.back = down; return true;
      case "ArrowLeft": input.turnL = down; return true;
      case "ArrowRight": input.turnR = down; return true;
      case "KeyA": input.strafeL = down; return true;
      case "KeyD": input.strafeR = down; return true;
    }
    return false;
  }
  function bindHold(el, prop) {
    if (!el) return;
    var on = function (e) { e.preventDefault(); input[prop] = true; };
    var off = function (e) { e.preventDefault(); input[prop] = false; };
    el.addEventListener("mousedown", on); el.addEventListener("touchstart", on, { passive: false });
    el.addEventListener("mouseup", off); el.addEventListener("mouseleave", off);
    el.addEventListener("touchend", off); el.addEventListener("touchcancel", off);
  }
  function requestPointerLock() { if (canvas && canvas.requestPointerLock) canvas.requestPointerLock(); }
  function exitPointerLock() { if (document.exitPointerLock) document.exitPointerLock(); }
  function onMouseMove(e) { if (document.pointerLockElement === canvas) mouseYaw += (e.movementX || 0) * 0.0022; }
  function onPointerLockChange() { if (lockHintEl) lockHintEl.style.opacity = document.pointerLockElement === canvas ? "0" : "1"; }

  // ============================================================
  //  Wire-up
  // ============================================================
  if (diffSelect) diffSelect.addEventListener("change", function () { newGame(diffSelect.value); requestPointerLock(); });
  if (newBtn) newBtn.addEventListener("click", function () { newGame(diffSelect.value); requestPointerLock(); });
  if (restartBtn) restartBtn.addEventListener("click", function () { restart(); requestPointerLock(); });
  if (againBtn) againBtn.addEventListener("click", function () { newGame(diffSelect.value); requestPointerLock(); });
  if (saveScoreBtn) saveScoreBtn.addEventListener("click", saveScore);
  if (playerNameInput) playerNameInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (!saveScoreBtn.disabled) saveScore(); } });
  if (howToBtn) howToBtn.addEventListener("click", function () { var open = instructions.hasAttribute("hidden"); if (open) instructions.removeAttribute("hidden"); else instructions.setAttribute("hidden", ""); howToBtn.setAttribute("aria-expanded", String(open)); });
  if (lbFilter) lbFilter.addEventListener("change", renderLb);
  if (clearLbBtn) clearLbBtn.addEventListener("click", function () { if (confirm("Clear all saved leaderboard scores?")) { saveLb([]); renderLb(); } });

  document.addEventListener("keydown", keyDown);
  document.addEventListener("keyup", keyUp);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  if (canvas) canvas.addEventListener("click", function () { if (state && state.status === "playing" && !state.hidden) requestPointerLock(); });

  bindHold(document.getElementById("btnFwd"), "forward");
  bindHold(document.getElementById("btnBack"), "back");
  bindHold(document.getElementById("btnLeft"), "turnL");
  bindHold(document.getElementById("btnRight"), "turnR");
  bindHold(document.getElementById("btnStrafeL"), "strafeL");
  bindHold(document.getElementById("btnStrafeR"), "strafeR");
  var btnHide = document.getElementById("btnHide");
  if (btnHide) btnHide.addEventListener("click", function (e) { e.preventDefault(); interact(); });

  if (modal) modal.addEventListener("click", function (e) { if (e.target === modal) hideModal(); });
  window.addEventListener("resize", function () { resize(); render(); renderMinimap(); });

  // ============================================================
  //  Test hook
  // ============================================================
  window.__maze = {
    getState: function () { return state; },
    update: function (dt) { update(dt); },
    newGame: newGame,
    input: input,
    interact: interact,
    isHidden: function () { return state.hidden; },
    lockers: function () { return state.lockers; },
    bfsPath: function (from, to) { return bfsPath(state.grid, state.w, state.h, from, to); },
    reachableFloors: function () {
      var r = bfsFrom(state.grid, state.w, state.h, state.level.start[0], state.level.start[1]);
      var n = 0; for (var i = 0; i < r.dist.length; i++) if (r.dist[i] >= 0) n++; return n;
    },
    totalFloors: function () { var n = 0; for (var i = 0; i < state.grid.length; i++) if (state.grid[i] === 0) n++; return n; },
    playerCanReachAll: function () {
      var reach = reachableFrom(state.grid, state.w, state.h, state.level.start[0], state.level.start[1], state.lockerSet);
      if (!reach.has(state.exit[0] + "," + state.exit[1])) return false;
      return state.level.keyTiles.every(function (k) { return reach.has(k[0] + "," + k[1]); });
    },
    hasOpenRoom: function () { // any 2x2 all-floor block => a room exists
      for (var y = 1; y < state.h - 1; y++) for (var x = 1; x < state.w - 1; x++) {
        if (state.grid[y * state.w + x] === 0 && state.grid[y * state.w + x + 1] === 0 &&
            state.grid[(y + 1) * state.w + x] === 0 && state.grid[(y + 1) * state.w + x + 1] === 0) return true;
      }
      return false;
    },
    adjWallCount: function (x, y) { return adjWallCount(state.grid, state.w, state.h, x, y); },
    isLockerTile: isLockerTile,
    canBeAt: canBeAt,
    setPlayer: function (tx, ty, angle) { state.player.x = tx + 0.5; state.player.y = ty + 0.5; if (angle !== undefined) state.player.angle = angle; state.lastTile = [tx, ty]; },
    setMonster: function (tx, ty) { state.monster.x = tx + 0.5; state.monster.y = ty + 0.5; },
    monsterTileDistToPlayer: function () {
      var path = bfsPath(state.grid, state.w, state.h, [Math.floor(state.monster.x), Math.floor(state.monster.y)], [Math.floor(state.player.x), Math.floor(state.player.y)]);
      return path ? path.length - 1 : Infinity;
    },
    render: function () { render(); renderMinimap(); },
    _diffs: DIFFS
  };

  // ============================================================
  //  Init
  // ============================================================
  resize();
  newGame(diffSelect ? diffSelect.value : "medium");
  if (ctx && !window.__MAZE_NO_LOOP__) startLoop();
})();
