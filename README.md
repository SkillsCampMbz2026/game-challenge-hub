# 🎮 Game Challenge Hub

A responsive, dependency-free collection of browser mini-game challenges,
currently featuring **Tower of Hanoi**, **Lights Out**, and **Sewer Escape**
(a first-person 3D maze).

**▶ Live site:** https://skillscampmbz2026.github.io/game-challenge-hub/

## Tower of Hanoi

Move the entire stack of disks from the **left** tower to the **right** tower —
never placing a larger disk on a smaller one — in as few moves as possible.

Features:

- **Three towers** with **click-to-move** *and* **drag-and-drop** (mouse + touch).
- **Valid-move checking** — larger disks can never land on smaller ones.
- **Move counter** and a live **timer**.
- **Difficulty selection** by number of disks (3–8).
- **Minimum-moves display** (the optimal `2ⁿ − 1`).
- **Automatic victory detection** with a results dialog.
- A hidden keyboard shortcut can animate the optimal solution.
- **Local leaderboard** stored in your browser (`localStorage`) — saves player
  name, disk count, moves, and time; ranked by fewest moves then fastest time.
- Fully **responsive** and keyboard-accessible.

## Lights Out

Turn off **every** light on a 5×5 grid. Clicking a light toggles it and its four
orthogonal neighbours (up/down/left/right).

Features:

- **5×5 grid** of clickable lights with a satisfying glow.
- **Randomized but always-solvable** boards — each is scrambled from the solved
  state, so a solution is guaranteed to exist.
- **Difficulty options** (Easy → Expert) that control how far the board is
  scrambled, rejection-sampled to a target difficulty band.
- **Move counter**, live **timer**, and a live **lights-on** count.
- **Minimum-moves display** computed exactly with a **GF(2) Gaussian-elimination
  solver** (the true optimal, found over the puzzle's solution space).
- **Automatic victory detection**, **New puzzle** / **Restart**, and a hidden
  keyboard shortcut that plays the optimal solution.
- **Local leaderboard** (`localStorage`) — saves player name, difficulty, moves,
  and time; ranked by fewest moves then fastest time.

## Sewer Escape (first-person 3D maze)

Navigate a dark sewer maze in first person, **find all 3 keys**, then reach the
**exit gate** to escape — while a **giant blood-soaked rat** hunts you down.

Features:

- **First-person 3D** rendered with a from-scratch **raycasting engine** on a
  2D canvas (no WebGL, no libraries) — textured sewer walls, distance fog,
  murky water floor, billboarded sprites with wall occlusion.
- **Randomized but always-solvable** mazes via recursive-backtracker generation
  (a perfect maze is fully connected, so every key and the exit are reachable).
- **3 keys** to collect; the exit gate stays **locked (red)** until you have all
  three, then opens **(green)**.
- **A giant bloody rat** that hunts you along the **BFS shortest path** to your
  position; the screen reddens as it closes in. Get caught and it's game over.
- **Difficulty** (Easy/Medium/Hard) scales maze size and rat speed.
- **Move counter**, live **timer**, key counter, and a **minimap**.
- Controls: **WASD / arrow keys**, mouse look (pointer lock), and an on-screen
  **touch pad** for mobile.
- **Local leaderboard** (`localStorage`) — saves player name, difficulty, moves,
  and time; ranked by fastest escape.

## Project structure

```
index.html        # Game Challenge Hub menu
hanoi.html        # Tower of Hanoi game
lightsout.html    # Lights Out game
maze.html         # Sewer Escape (3D maze) game
assets/
  style.css       # shared base + hub styles
  hanoi.css       # Tower of Hanoi styles
  hanoi.js        # Tower of Hanoi logic (no dependencies)
  lightsout.css   # Lights Out styles
  lightsout.js    # Lights Out logic + GF(2) solver (no dependencies)
  maze.css        # Sewer Escape styles
  maze.js         # Sewer Escape raycasting engine + game logic (no dependencies)
```

## Running locally

It's plain static HTML/CSS/JS — just open `index.html`, or serve the folder:

```bash
npx serve .
# or
python -m http.server
```

## Testing

The game logic is verified with a headless [jsdom](https://github.com/jsdom/jsdom)
suite that drives the real `hanoi.js` (see the test in the project scratchpad).
It confirms optimal solvability for 3/4/6/8 disks, invalid-move rejection,
automatic victory detection, leaderboard persistence, and restart behaviour.

## License

MIT
