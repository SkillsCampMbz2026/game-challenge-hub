# 🎮 Game Challenge Hub

A responsive, dependency-free collection of browser mini-game challenges. The
first challenge is a full-featured **Tower of Hanoi** puzzle.

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
- **Auto-solve** button that animates the optimal solution (demo runs are not
  recorded).
- **Local leaderboard** stored in your browser (`localStorage`) — saves player
  name, disk count, moves, and time; ranked by fewest moves then fastest time.
- Fully **responsive** and keyboard-accessible.

## Project structure

```
index.html        # Game Challenge Hub menu
hanoi.html        # Tower of Hanoi game
assets/
  style.css       # shared base + hub styles
  hanoi.css       # game styles
  hanoi.js        # game logic (no dependencies)
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
