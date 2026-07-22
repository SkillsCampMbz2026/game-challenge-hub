/* ===========================================================
   Sewer Escape — first-person 3D maze (raycasting)
   - randomized, always-solvable maze (recursive backtracker)
   - find 3 keys, then reach the exit gate to escape
   - a giant bloody rat hunts you via BFS shortest-path
   - move counter, timer, difficulty, win/lose detection
   - localStorage leaderboard (name, difficulty, moves, time)

   Rendering is fully guarded so the game logic can be unit-tested
   headlessly (no canvas needed). Test hook: window.__maze
   =========================================================== */
(function () {
  "use strict";

  var FOV = Math.PI / 3;            // 60° field of view
  var LB_KEY = "maze.leaderboard.v1";
  var NAME_KEY = "maze.lastName";

  var DIFFS = {
    easy:   { label: "Easy",   cells: 6,  monsterSpeed: 1.15, viewDist: 8,  catch: 0.50 },
    medium: { label: "Medium", cells: 8,  monsterSpeed: 1.45, viewDist: 9,  catch: 0.48 },
    hard:   { label: "Hard",   cells: 11, monsterSpeed: 1.75, viewDist: 10, catch: 0.46 }
  };
  var PLAYER_SPEED = 2.7;           // tiles / second
  var TURN_SPEED = 2.7;             // radians / second
  var RADIUS = 0.22;                // collision radius

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

  // ---------- View ----------
  var view = { w: 800, h: 500, dpr: 1 };
  var zBuffer = [];

  // ---------- State ----------
  var state = null;
  var input = { forward: false, back: false, turnL: false, turnR: false, strafeL: false, strafeR: false };
  var mouseYaw = 0;

  // ============================================================
  //  Maze generation (recursive backtracker -> perfect maze)
  // ============================================================
  function generateMaze(cells) {
    var w = cells * 2 + 1, h = cells * 2 + 1;
    var g = new Array(w * h).fill(1); // 1 = wall, 0 = floor
    function idx(x, y) { return y * w + x; }
    var stack = [[1, 1]];
    g[idx(1, 1)] = 0;
    var dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var cx = cur[0], cy = cur[1];
      var options = [];
      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && g[idx(nx, ny)] === 1) options.push([nx, ny, cx + dirs[d][0] / 2, cy + dirs[d][1] / 2]);
      }
      if (!options.length) { stack.pop(); continue; }
      var pick = options[randInt(options.length)];
      g[idx(pick[2], pick[3])] = 0; // knock out wall between
      g[idx(pick[0], pick[1])] = 0; // carve new cell
      stack.push([pick[0], pick[1]]);
    }
    return { grid: g, w: w, h: h };
  }

  function randInt(n) { return Math.floor(Math.random() * n); }

  // BFS over floor tiles (4-connected). Returns {dist:Map, from:Map}.
  function bfsFrom(grid, w, h, sx, sy) {
    var dist = new Int32Array(w * h).fill(-1);
    var prev = new Int32Array(w * h).fill(-1);
    var q = [sy * w + sx];
    dist[sy * w + sx] = 0;
    var head = 0;
    var nb = [1, -1, w, -w];
    while (head < q.length) {
      var c = q[head++];
      var cx = c % w, cy = (c - cx) / w;
      for (var k = 0; k < 4; k++) {
        var n = c + nb[k];
        var nx = n % w, ny = (n - nx) / w;
        if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue; // wrap guard
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (grid[n] !== 0) continue;
        if (dist[n] !== -1) continue;
        dist[n] = dist[c] + 1;
        prev[n] = c;
        q.push(n);
      }
    }
    return { dist: dist, prev: prev };
  }

  function bfsPath(grid, w, h, from, to) {
    var res = bfsFrom(grid, w, h, from[0], from[1]);
    var target = to[1] * w + to[0];
    if (res.dist[target] === -1) return null;
    var path = [];
    var c = target;
    while (c !== -1) { var cx = c % w; path.push([cx, (c - cx) / w]); c = res.prev[c]; }
    path.reverse();
    return path;
  }

  // ============================================================
  //  Level building
  // ============================================================
  function buildLevel(diffKey) {
    var cfg = DIFFS[diffKey];
    var m = generateMaze(cfg.cells);
    var w = m.w, h = m.h, grid = m.grid;
    var start = [1, 1];
    var exit = [w - 2, h - 2];

    var res = bfsFrom(grid, w, h, start[0], start[1]);
    var maxDist = 0;
    for (var i = 0; i < res.dist.length; i++) if (res.dist[i] > maxDist) maxDist = res.dist[i];

    // candidate floor tiles with their distance from start
    var floors = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (grid[y * w + x] === 0) floors.push({ x: x, y: y, d: res.dist[y * w + x] });
    }

    // keys: reasonably far from start, spread apart, not on start/exit
    var keyMin = Math.max(3, Math.floor(maxDist * 0.28));
    var keyCands = floors.filter(function (f) {
      return f.d >= keyMin && !(f.x === start[0] && f.y === start[1]) && !(f.x === exit[0] && f.y === exit[1]);
    });
    shuffle(keyCands);
    var keyTiles = [];
    var spacing = Math.max(2, Math.floor(w / 4));
    for (var c = 0; c < keyCands.length && keyTiles.length < 3; c++) {
      var ok = true;
      for (var j = 0; j < keyTiles.length; j++) {
        if (Math.abs(keyCands[c].x - keyTiles[j][0]) + Math.abs(keyCands[c].y - keyTiles[j][1]) < spacing) { ok = false; break; }
      }
      if (ok) keyTiles.push([keyCands[c].x, keyCands[c].y]);
    }
    // fallback: relax spacing if we couldn't place 3
    for (var c2 = 0; c2 < keyCands.length && keyTiles.length < 3; c2++) {
      var t = [keyCands[c2].x, keyCands[c2].y];
      if (!keyTiles.some(function (k) { return k[0] === t[0] && k[1] === t[1]; })) keyTiles.push(t);
    }

    // monster start: far from player, not on a key/exit/start
    var monCands = floors.filter(function (f) {
      return f.d >= maxDist * 0.5 &&
        !(f.x === start[0] && f.y === start[1]) &&
        !(f.x === exit[0] && f.y === exit[1]) &&
        !keyTiles.some(function (k) { return k[0] === f.x && k[1] === f.y; });
    });
    if (!monCands.length) monCands = floors.filter(function (f) { return f.d >= maxDist * 0.35; });
    var mon = monCands[randInt(monCands.length)] || { x: exit[0], y: exit[1] };

    // player facing: pick an open neighbour direction
    var angle = 0;
    var neigh = [[1, 0, 0], [0, 1, Math.PI / 2], [-1, 0, Math.PI], [0, -1, -Math.PI / 2]];
    for (var n = 0; n < neigh.length; n++) {
      var nx2 = start[0] + neigh[n][0], ny2 = start[1] + neigh[n][1];
      if (grid[ny2 * w + nx2] === 0) { angle = neigh[n][2]; break; }
    }

    return {
      diff: diffKey, cfg: cfg, grid: grid, w: w, h: h,
      start: start, exit: exit, keyTiles: keyTiles, monsterStart: [mon.x, mon.y], startAngle: angle
    };
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = randInt(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // ============================================================
  //  Game lifecycle
  // ============================================================
  function newGame(diffKey) {
    var level = buildLevel(diffKey);
    initFromLevel(level);
  }

  function initFromLevel(level) {
    state = {
      level: level,
      diff: level.diff,
      grid: level.grid, w: level.w, h: level.h,
      exit: level.exit,
      player: { x: level.start[0] + 0.5, y: level.start[1] + 0.5, angle: level.startAngle },
      monster: { x: level.monsterStart[0] + 0.5, y: level.monsterStart[1] + 0.5 },
      keys: level.keyTiles.map(function (t) { return { x: t[0] + 0.5, y: t[1] + 0.5, collected: false }; }),
      keysCollected: 0,
      moves: 0,
      lastTile: [level.start[0], level.start[1]],
      elapsed: 0,
      started: false,
      status: "playing",     // playing | won | lost
      msgTimer: 0,
      time: 0
    };
    setMessage("Find all 3 keys, then reach the exit gate. Don't let the rat catch you!", 3.5);
    hideModal();
    updateHud();
    render();
    renderMinimap();
    renderLb();
  }

  function restart() {
    if (state && state.level) initFromLevel(state.level);
  }

  // ============================================================
  //  Update loop (pure logic — safe to call from tests)
  // ============================================================
  function update(dt) {
    if (!state || state.status !== "playing") return;
    if (dt > 0.05) dt = 0.05;
    movePlayer(dt);
    moveMonster(dt);
    collectKeys();
    checkCatch();
    checkExit();
    if (state.started) { state.elapsed += dt * 1000; }
    if (state.msgTimer > 0) { state.msgTimer -= dt; if (state.msgTimer <= 0) setMessage("", 0); }
  }

  function dirVec() { return { x: Math.cos(state.player.angle), y: Math.sin(state.player.angle) }; }

  function movePlayer(dt) {
    var p = state.player;
    var turn = (input.turnR ? 1 : 0) - (input.turnL ? 1 : 0);
    var fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    var strafe = (input.strafeR ? 1 : 0) - (input.strafeL ? 1 : 0);

    if (turn || fwd || strafe || mouseYaw) markStarted();

    p.angle += turn * TURN_SPEED * dt + mouseYaw;
    mouseYaw = 0;

    var d = dirVec();
    var rightX = -d.y, rightY = d.x; // player's right
    var vx = (d.x * fwd + rightX * strafe) * PLAYER_SPEED * dt;
    var vy = (d.y * fwd + rightY * strafe) * PLAYER_SPEED * dt;

    if (canBeAt(p.x + vx, p.y)) p.x += vx;
    if (canBeAt(p.x, p.y + vy)) p.y += vy;

    var tx = Math.floor(p.x), ty = Math.floor(p.y);
    if (tx !== state.lastTile[0] || ty !== state.lastTile[1]) {
      state.moves++;
      state.lastTile = [tx, ty];
    }
  }

  function markStarted() { if (!state.started) state.started = true; }

  function isFloor(x, y) {
    var tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= state.w || ty >= state.h) return false;
    return state.grid[ty * state.w + tx] === 0;
  }
  function canBeAt(x, y) {
    return isFloor(x - RADIUS, y) && isFloor(x + RADIUS, y) &&
           isFloor(x, y - RADIUS) && isFloor(x, y + RADIUS) &&
           isFloor(x - RADIUS, y - RADIUS) && isFloor(x + RADIUS, y + RADIUS) &&
           isFloor(x - RADIUS, y + RADIUS) && isFloor(x + RADIUS, y - RADIUS);
  }

  function moveMonster(dt) {
    var m = state.monster, p = state.player;
    var mt = [Math.floor(m.x), Math.floor(m.y)];
    var pt = [Math.floor(p.x), Math.floor(p.y)];
    var target;
    if (mt[0] === pt[0] && mt[1] === pt[1]) {
      target = [p.x, p.y];
    } else {
      var path = bfsPath(state.grid, state.w, state.h, mt, pt);
      if (path && path.length >= 2) target = [path[1][0] + 0.5, path[1][1] + 0.5];
      else target = [p.x, p.y];
    }
    var dx = target[0] - m.x, dy = target[1] - m.y;
    var dd = Math.hypot(dx, dy);
    if (dd > 1e-4) {
      var sp = state.level.cfg.monsterSpeed * dt;
      var step = Math.min(sp, dd);
      m.x += dx / dd * step;
      m.y += dy / dd * step;
    }
  }

  function collectKeys() {
    for (var i = 0; i < state.keys.length; i++) {
      var k = state.keys[i];
      if (k.collected) continue;
      if (Math.hypot(k.x - state.player.x, k.y - state.player.y) < 0.5) {
        k.collected = true;
        state.keysCollected++;
        var left = 3 - state.keysCollected;
        setMessage(left > 0 ? ("Key found! " + state.keysCollected + "/3 — " + left + " to go.")
                            : "All 3 keys collected! Get to the exit gate!", 3);
        updateHud();
      }
    }
  }

  function checkCatch() {
    var m = state.monster, p = state.player;
    if (Math.hypot(m.x - p.x, m.y - p.y) < state.level.cfg.catch) {
      state.status = "lost";
      showEnd(false);
    }
  }

  function checkExit() {
    var p = state.player;
    if (Math.floor(p.x) === state.exit[0] && Math.floor(p.y) === state.exit[1]) {
      if (state.keysCollected >= 3) {
        state.status = "won";
        showEnd(true);
      } else if (state.msgTimer <= 0.1) {
        setMessage("The gate is locked! You still need " + (3 - state.keysCollected) + " key(s).", 2);
      }
    }
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
  function formatTime(ms) {
    var t = Math.floor(ms / 1000);
    return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  }

  // ============================================================
  //  Rendering (all guarded by ctx)
  // ============================================================
  var sprites = { rat: null, key: null, gateLocked: null, gateOpen: null };

  function ensureSprites() {
    if (!ctx || sprites.rat) return;
    sprites.key = makeKeySprite();
    sprites.rat = makeRatSprite();
    sprites.gateLocked = makeGateSprite(false);
    sprites.gateOpen = makeGateSprite(true);
  }

  function offscreen(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function makeKeySprite() {
    var c = offscreen(64, 64); var x = c.getContext("2d");
    if (!x) return c;
    x.shadowColor = "rgba(255,210,80,0.9)"; x.shadowBlur = 12;
    x.strokeStyle = "#ffce4d"; x.fillStyle = "#ffce4d"; x.lineWidth = 6; x.lineCap = "round";
    x.beginPath(); x.arc(24, 22, 12, 0, Math.PI * 2); x.stroke();      // bow
    x.beginPath(); x.moveTo(24, 34); x.lineTo(24, 56); x.stroke();     // shaft
    x.beginPath(); x.moveTo(24, 50); x.lineTo(34, 50); x.moveTo(24, 44); x.lineTo(32, 44); x.stroke(); // teeth
    return c;
  }

  function makeRatSprite() {
    var c = offscreen(128, 100); var x = c.getContext("2d");
    if (!x) return c;
    // tail
    x.strokeStyle = "#caa0a8"; x.lineWidth = 5; x.lineCap = "round";
    x.beginPath(); x.moveTo(14, 74); x.quadraticCurveTo(2, 60, 14, 44); x.stroke();
    // body
    x.fillStyle = "#6a6a6f";
    x.beginPath(); x.ellipse(66, 66, 46, 28, 0, 0, Math.PI * 2); x.fill();
    // head
    x.beginPath(); x.ellipse(104, 60, 20, 17, 0, 0, Math.PI * 2); x.fill();
    // ears
    x.fillStyle = "#7a7a80";
    x.beginPath(); x.arc(98, 44, 9, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(112, 44, 9, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#9a7f86";
    x.beginPath(); x.arc(98, 44, 4.5, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(112, 44, 4.5, 0, Math.PI * 2); x.fill();
    // snout
    x.fillStyle = "#7a7a80";
    x.beginPath(); x.ellipse(122, 64, 8, 6, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#3a3033"; x.beginPath(); x.arc(127, 64, 3, 0, Math.PI * 2); x.fill();
    // teeth
    x.fillStyle = "#fff";
    x.fillRect(120, 70, 3, 7); x.fillRect(124, 70, 3, 7);
    // glowing red eyes
    x.shadowColor = "rgba(255,30,30,0.95)"; x.shadowBlur = 14; x.fillStyle = "#ff2b2b";
    x.beginPath(); x.arc(101, 57, 4.5, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(112, 57, 4.5, 0, Math.PI * 2); x.fill();
    x.shadowBlur = 0;
    // feet
    x.fillStyle = "#5a5a5f";
    x.beginPath(); x.ellipse(52, 92, 7, 5, 0, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(84, 92, 7, 5, 0, 0, Math.PI * 2); x.fill();
    // BLOOD splatter + drips
    x.fillStyle = "rgba(150,10,12,0.92)";
    blob(x, 70, 58, 12); blob(x, 52, 70, 9); blob(x, 92, 74, 7);
    x.beginPath(); x.moveTo(120, 76); x.lineTo(118, 90); x.lineTo(123, 90); x.closePath(); x.fill(); // mouth drip
    x.fillStyle = "rgba(120,6,8,0.95)";
    x.beginPath(); x.arc(120, 92, 3, 0, Math.PI * 2); x.fill();
    return c;
  }
  function blob(x, cx, cy, r) {
    x.beginPath();
    for (var a = 0; a < Math.PI * 2; a += Math.PI / 5) {
      var rr = r * (0.7 + ((a * 13) % 1) * 0.5);
      var px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (a === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath(); x.fill();
  }

  function makeGateSprite(open) {
    var c = offscreen(96, 120); var x = c.getContext("2d");
    if (!x) return c;
    var glow = open ? "rgba(60,230,140,0.9)" : "rgba(240,70,70,0.9)";
    var bar = open ? "#3ce68c" : "#c94b4b";
    x.shadowColor = glow; x.shadowBlur = 16; x.strokeStyle = bar; x.lineWidth = 7; x.lineCap = "round";
    for (var i = 0; i < 4; i++) { var bx = 16 + i * 21; x.beginPath(); x.moveTo(bx, 8); x.lineTo(bx, 112); x.stroke(); }
    x.beginPath(); x.moveTo(10, 22); x.lineTo(86, 22); x.moveTo(10, 60); x.lineTo(86, 60); x.moveTo(10, 98); x.lineTo(86, 98); x.stroke();
    x.shadowBlur = 0;
    if (!open) { // padlock
      x.fillStyle = "#ffd24d"; x.fillRect(40, 66, 16, 14);
      x.strokeStyle = "#ffd24d"; x.lineWidth = 3;
      x.beginPath(); x.arc(48, 66, 6, Math.PI, 0); x.stroke();
    }
    return c;
  }

  function resize() {
    if (!canvas) return;
    var cssW = canvas.clientWidth || 800;
    var cssH = canvas.clientHeight || 500;
    view.dpr = (window.devicePixelRatio || 1);
    view.w = cssW; view.h = cssH;
    canvas.width = Math.floor(cssW * view.dpr);
    canvas.height = Math.floor(cssH * view.dpr);
    if (ctx) ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  function render() {
    if (!ctx || !state) return;
    ensureSprites();
    var W = view.w, H = view.h, horizon = H / 2;
    var p = state.player;

    // ceiling
    var cg = ctx.createLinearGradient(0, 0, 0, horizon);
    cg.addColorStop(0, "#080f0a"); cg.addColorStop(1, "#16241a");
    ctx.fillStyle = cg; ctx.fillRect(0, 0, W, horizon);
    // floor (murky water)
    var fg = ctx.createLinearGradient(0, horizon, 0, H);
    fg.addColorStop(0, "#14261a"); fg.addColorStop(1, "#050d08");
    ctx.fillStyle = fg; ctx.fillRect(0, horizon, W, H - horizon);

    var dir = dirVec();
    var planeX = -dir.y * Math.tan(FOV / 2), planeY = dir.x * Math.tan(FOV / 2);
    var viewDist = state.level.cfg.viewDist;

    for (var x = 0; x < W; x++) {
      var cameraX = 2 * x / W - 1;
      var rdx = dir.x + planeX * cameraX;
      var rdy = dir.y + planeY * cameraX;
      var mapX = Math.floor(p.x), mapY = Math.floor(p.y);
      var deltaX = Math.abs(rdx) < 1e-6 ? 1e30 : Math.abs(1 / rdx);
      var deltaY = Math.abs(rdy) < 1e-6 ? 1e30 : Math.abs(1 / rdy);
      var stepX, stepY, sideDistX, sideDistY;
      if (rdx < 0) { stepX = -1; sideDistX = (p.x - mapX) * deltaX; } else { stepX = 1; sideDistX = (mapX + 1 - p.x) * deltaX; }
      if (rdy < 0) { stepY = -1; sideDistY = (p.y - mapY) * deltaY; } else { stepY = 1; sideDistY = (mapY + 1 - p.y) * deltaY; }
      var side = 0, hit = 0, guard = 0;
      while (!hit && guard++ < 512) {
        if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
        else { sideDistY += deltaY; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= state.w || mapY >= state.h) { hit = 1; break; }
        if (state.grid[mapY * state.w + mapX] > 0) hit = 1;
      }
      var perp = side === 0 ? (sideDistX - deltaX) : (sideDistY - deltaY);
      if (perp < 1e-3) perp = 1e-3;
      zBuffer[x] = perp;

      var lineH = H / perp;
      var start = horizon - lineH / 2;
      var wallX = side === 0 ? (p.y + perp * rdy) : (p.x + perp * rdx);
      wallX -= Math.floor(wallX);
      var brick = (Math.floor(wallX * 5) % 2 === 0) ? 1 : 0.84;
      var fog = clamp(1 - perp / viewDist, 0.1, 1);
      var sd = side === 1 ? 0.66 : 1;
      var f = fog * sd * brick;
      ctx.fillStyle = "rgb(" + Math.floor(74 * f) + "," + Math.floor(96 * f) + "," + Math.floor(66 * f) + ")";
      ctx.fillRect(x, start, 1, lineH + 1);
    }

    // sprites: keys + gate + monster, sorted far -> near
    var list = [];
    for (var i = 0; i < state.keys.length; i++) if (!state.keys[i].collected) list.push({ x: state.keys[i].x, y: state.keys[i].y, img: sprites.key, scale: 0.5, vy: 0.28 });
    list.push({ x: state.exit[0] + 0.5, y: state.exit[1] + 0.5, img: state.keysCollected >= 3 ? sprites.gateOpen : sprites.gateLocked, scale: 0.95, vy: 0.05 });
    var bob = Math.sin(state.elapsed / 140) * (H / 40);
    list.push({ x: state.monster.x, y: state.monster.y, img: sprites.rat, scale: 1.0, vy: 0.18, bob: bob });

    list.sort(function (a, b) {
      var da = (a.x - p.x) * (a.x - p.x) + (a.y - p.y) * (a.y - p.y);
      var db = (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y);
      return db - da;
    });
    for (var s = 0; s < list.length; s++) drawSprite(list[s], dir, planeX, planeY);

    // proximity vignette
    if (vignetteEl) {
      var md = Math.hypot(state.monster.x - p.x, state.monster.y - p.y);
      var intensity = clamp((3.2 - md) / 3.2, 0, 1);
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
    var sh = Math.abs(H / tY) * s.scale;
    var sw = sh * (s.img.width / s.img.height);
    var vShift = (s.vy || 0) * (H / tY);
    var startY = H / 2 - sh / 2 + vShift + (s.bob || 0);
    var startX = Math.floor(scrX - sw / 2);
    var endX = Math.floor(scrX + sw / 2);
    var iw = s.img.width;
    for (var x = startX; x < endX; x++) {
      if (x < 0 || x >= W) continue;
      if (tY >= zBuffer[x]) continue; // behind a wall
      var texX = Math.floor((x - startX) / sw * iw);
      if (texX < 0) texX = 0; if (texX >= iw) texX = iw - 1;
      ctx.drawImage(s.img, texX, 0, 1, s.img.height, x, startY, 1, sh);
    }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function renderMinimap() {
    if (!mmCtx || !state) return;
    var w = state.w, h = state.h;
    var size = minimap.width;
    var cell = size / Math.max(w, h);
    mmCtx.clearRect(0, 0, minimap.width, minimap.height);
    mmCtx.fillStyle = "rgba(6,12,8,0.85)"; mmCtx.fillRect(0, 0, size, size);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (state.grid[y * w + x] === 0) { mmCtx.fillStyle = "#24422e"; mmCtx.fillRect(x * cell, y * cell, cell, cell); }
    }
    // exit
    mmCtx.fillStyle = state.keysCollected >= 3 ? "#3ce68c" : "#c94b4b";
    mmCtx.fillRect(state.exit[0] * cell, state.exit[1] * cell, cell, cell);
    // collected keys markers
    for (var i = 0; i < state.keys.length; i++) if (state.keys[i].collected) {
      mmCtx.fillStyle = "#ffce4d";
      mmCtx.fillRect((state.keys[i].x - 0.5) * cell + cell * 0.25, (state.keys[i].y - 0.5) * cell + cell * 0.25, cell * 0.5, cell * 0.5);
    }
    // player
    var px = state.player.x * cell, py = state.player.y * cell;
    mmCtx.fillStyle = "#7dd3fc";
    mmCtx.beginPath(); mmCtx.arc(px, py, Math.max(2, cell * 0.35), 0, Math.PI * 2); mmCtx.fill();
    var d = dirVec();
    mmCtx.strokeStyle = "#7dd3fc"; mmCtx.lineWidth = 2;
    mmCtx.beginPath(); mmCtx.moveTo(px, py); mmCtx.lineTo(px + d.x * cell, py + d.y * cell); mmCtx.stroke();
  }

  // ============================================================
  //  Game loop
  // ============================================================
  var running = false, lastT = 0;
  function frame(t) {
    if (!running) return;
    var dt = (t - lastT) / 1000; lastT = t;
    if (!isFinite(dt) || dt < 0) dt = 0;
    update(dt);
    render();
    renderMinimap();
    updateHud();
    window.requestAnimationFrame(frame);
  }
  function startLoop() {
    if (running) return;
    running = true; lastT = (window.performance && performance.now) ? performance.now() : 0;
    window.requestAnimationFrame(frame);
  }

  // ============================================================
  //  End / leaderboard
  // ============================================================
  function showEnd(won) {
    if (vignetteEl) vignetteEl.style.opacity = "0";
    if (!modal) return;
    modalIcon.textContent = won ? "🔑" : "🐀";
    modalTitle.textContent = won ? "You escaped!" : "You were caught!";
    modalSub.textContent = won
      ? "You found all 3 keys and made it out of the sewers alive."
      : "The giant rat caught you in the dark. Try again!";
    modalStats.innerHTML = "";
    addStat("Difficulty", DIFFS[state.diff].label);
    addStat("Moves", state.moves);
    addStat("Time", formatTime(state.elapsed));

    if (won) {
      saveRow.hidden = false; savedMsg.hidden = true;
      saveScoreBtn.disabled = false; playerNameInput.disabled = false;
      playerNameInput.value = localStorage.getItem(NAME_KEY) || "";
    } else {
      saveRow.hidden = true;
    }
    modal.hidden = false;
    exitPointerLock();
    if (won) setTimeout(function () { try { playerNameInput.focus(); } catch (e) {} }, 60);
  }
  function addStat(label, value) {
    var d = document.createElement("div");
    d.className = "stat";
    d.innerHTML = '<span class="stat__label">' + label + '</span><span class="stat__value">' + value + "</span>";
    modalStats.appendChild(d);
  }
  function hideModal() { if (modal) modal.hidden = true; }

  function loadLb() { try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch (e) { return []; } }
  function saveLb(l) { try { localStorage.setItem(LB_KEY, JSON.stringify(l)); } catch (e) {} }

  function saveScore() {
    var name = (playerNameInput.value || "").trim() || "Anonymous";
    localStorage.setItem(NAME_KEY, name);
    var l = loadLb();
    l.push({ name: name.slice(0, 20), difficulty: state.diff, moves: state.moves, timeMs: state.elapsed, date: Date.now() });
    saveLb(l);
    savedMsg.hidden = false; saveScoreBtn.disabled = true; playerNameInput.disabled = true;
    renderLb();
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
  function keyDown(e) { if (mapKey(e.code, true)) e.preventDefault(); }
  function keyUp(e) { if (mapKey(e.code, false)) e.preventDefault(); }
  function mapKey(code, down) {
    switch (code) {
      case "ArrowUp": case "KeyW": input.forward = down; return true;
      case "ArrowDown": case "KeyS": input.back = down; return true;
      case "ArrowLeft": input.turnL = down; return true;
      case "ArrowRight": input.turnR = down; return true;
      case "KeyA": input.strafeL = down; return true;
      case "KeyD": input.strafeR = down; return true;
      case "KeyQ": input.turnL = down; return true;
      case "KeyE": input.turnR = down; return true;
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
  function onMouseMove(e) {
    if (document.pointerLockElement === canvas) mouseYaw += (e.movementX || 0) * 0.0022;
  }
  function onPointerLockChange() {
    var locked = document.pointerLockElement === canvas;
    if (lockHintEl) lockHintEl.style.opacity = locked ? "0" : "1";
  }

  // ============================================================
  //  Wire-up
  // ============================================================
  if (diffSelect) diffSelect.addEventListener("change", function () { newGame(diffSelect.value); requestPointerLock(); });
  if (newBtn) newBtn.addEventListener("click", function () { newGame(diffSelect.value); requestPointerLock(); });
  if (restartBtn) restartBtn.addEventListener("click", function () { restart(); requestPointerLock(); });
  if (againBtn) againBtn.addEventListener("click", function () { newGame(diffSelect.value); requestPointerLock(); });
  if (saveScoreBtn) saveScoreBtn.addEventListener("click", saveScore);
  if (playerNameInput) playerNameInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (!saveScoreBtn.disabled) saveScore(); } });

  if (howToBtn) howToBtn.addEventListener("click", function () {
    var open = instructions.hasAttribute("hidden");
    if (open) instructions.removeAttribute("hidden"); else instructions.setAttribute("hidden", "");
    howToBtn.setAttribute("aria-expanded", String(open));
  });

  if (lbFilter) lbFilter.addEventListener("change", renderLb);
  if (clearLbBtn) clearLbBtn.addEventListener("click", function () { if (confirm("Clear all saved leaderboard scores?")) { saveLb([]); renderLb(); } });

  document.addEventListener("keydown", keyDown);
  document.addEventListener("keyup", keyUp);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  if (canvas) canvas.addEventListener("click", function () { if (state && state.status === "playing") requestPointerLock(); });

  bindHold(document.getElementById("btnFwd"), "forward");
  bindHold(document.getElementById("btnBack"), "back");
  bindHold(document.getElementById("btnLeft"), "turnL");
  bindHold(document.getElementById("btnRight"), "turnR");
  bindHold(document.getElementById("btnStrafeL"), "strafeL");
  bindHold(document.getElementById("btnStrafeR"), "strafeR");

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
    bfsPath: function (from, to) { return bfsPath(state.grid, state.w, state.h, from, to); },
    reachableFloors: function () {
      var r = bfsFrom(state.grid, state.w, state.h, state.level.start[0], state.level.start[1]);
      var n = 0; for (var i = 0; i < r.dist.length; i++) if (r.dist[i] >= 0) n++; return n;
    },
    totalFloors: function () { var n = 0; for (var i = 0; i < state.grid.length; i++) if (state.grid[i] === 0) n++; return n; },
    setPlayer: function (tx, ty, angle) {
      state.player.x = tx + 0.5; state.player.y = ty + 0.5;
      if (angle !== undefined) state.player.angle = angle;
      state.lastTile = [tx, ty];
    },
    setMonster: function (tx, ty) { state.monster.x = tx + 0.5; state.monster.y = ty + 0.5; },
    canBeAt: canBeAt,
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
