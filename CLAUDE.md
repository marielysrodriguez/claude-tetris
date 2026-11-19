# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page Tetris implementation in vanilla JavaScript with HTML5 Canvas — no dependencies, no build step, no package.json. Three files: `index.html` (DOM/canvas structure), `style.css` (dark/retro styling), `game.js` (all game logic, ~300 lines).

## Running the game

No install or build. Either open `index.html` directly in a browser, or serve it locally (needed if canvas/module loading behaves differently under `file://`):

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then visit `http://localhost:8000`. There are no tests, linter, or build/watch commands in this repo.

## Architecture (`game.js`)

Everything lives in one file with module-level mutable state (`board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, freezeLeft, powerupsGiven`) — there's no class/module encapsulation, so changes to one part of state (e.g. `current`) can affect drawing, collision, and the game loop simultaneously. Keep this in mind when editing: functions read/write these globals directly rather than passing state around.

Key pieces and how they connect:

- **Board model**: `ROWS × COLS` matrix, each cell `0` (empty) or a color index `1–8` identifying the locked piece type, or `9` (`WILD`) for a wildcard block created by the Tint power-up. Index 9 is reserved for `WILD`: a new piece must use another index (or move `WILD`), and it must not get a `PIECES` entry or `randomPiece()` would spawn it.
- **Pieces**: `PIECES` are square matrices; `randomPiece()` picks uniformly from every entry in `PIECES` (the 7 standard tetrominoes plus the 3×3 "nut" challenge piece, index 8: a ring with an empty center, gray) and centers it at spawn. Adding a piece only needs a `COLORS` entry and a `PIECES` entry at the same index. The nut is symmetric, so rotating it changes nothing, and once locked its hollow center can't be filled until the row above it is cleared. Rotation (`rotateCW`) transposes + reverses rows — there's no per-piece rotation state (SRS), just a naive matrix rotation.
- **Collision** (`collide`): checks board bounds and overlap with locked cells for a shape at a given offset. This is the single source of truth used by movement, rotation, ghost-piece projection, and drop logic — reuse it rather than writing new bounds/overlap checks.
- **Wall kicks** (`tryRotate`): after rotating, tries offsets `[0, -1, 1, -2, 2]` against `collide` and takes the first that fits. This is a simplified stand-in for full SRS kick tables.
- **Lock → merge → clear → spawn pipeline** (`lockPiece`): `merge()` bakes the current piece into `board`, `clearLines()` removes completed rows (a row is complete per `rowComplete()`: filled cells + wildcard cells ≥ `COLS`, so each `WILD` plugs one hole; scans bottom-up, splices + unshifts an empty row, re-checks the same index after a splice), then `spawn()` promotes `next` to `current` and generates a new `next`. If the newly spawned piece immediately collides, `endGame()` fires.
- **Power-ups**: every `POWERUP_EVERY` (5) cleared lines, `spawn()` makes the new `next` a `randomPowerPiece()` instead of a tetromino (tracked by `powerupsGiven`, so it shows up in the NEXT panel first). It is a 1×1 piece (`shape: [[1]]`, `type: 0`, plus `power` and `dir`), so movement, `collide`, `ghostY` and drops work unchanged. On lock, `lockPiece()` calls `applyPowerUp(current)` instead of `merge()` — the piece is consumed and never written to `board`. Effects (`POWERUPS` has the icon/name of each): `bomb` clears a 3×3 around the piece, `ray` clears the impact row (`rayRow`) or the whole column (`↑`/`X` toggles `dir` `'h'`/`'v'` instead of rotating), `tint` turns every block of one color into `WILD` (`tintTarget`: the color below the piece, else the most common), `gravity` compacts each column (`applyGravity`), `freeze` sets `freezeLeft = FREEZE_MS`. Bomb/Ray award `10 × level` per destroyed block; rows removed by the Ray do not count toward `lines` (so power-ups can't chain themselves). `draw()` previews the affected area at the ghost position (`drawPowerTarget`).
- **Game loop** (`loop`, driven by `requestAnimationFrame`): accumulates elapsed time in `dropAccum`; when it exceeds `dropInterval`, the piece drops one row or locks. While `freezeLeft > 0` the loop only counts it down and skips the automatic drop (manual moves/drops still work; pausing also stops the countdown). Drawing happens every frame regardless of drop timing.
- **Scoring/leveling**: `LINE_SCORES = [0, 100, 300, 500, 800]` times `level`; hard drop adds 2 pts/row dropped, soft drop adds 1 pt/row. Level increases every 10 lines (`clearLines`), which also recomputes `dropInterval = max(100, 1000 - (level-1)*90)`.
- **Ghost piece** (`ghostY`): projects `current` straight down via repeated `collide` checks, drawn at `globalAlpha = 0.2` in `draw()`.
- **Input** (`keydown` listener): arrow keys move/rotate/soft-drop, `Space` hard-drops (with `preventDefault` to stop page scroll), `P` toggles pause. Input is ignored while `paused || gameOver` except the pause key itself.

Tunable constants live at the top of `game.js`: `COLS`, `ROWS`, `BLOCK` (pixel size per cell), `COLORS`, `LINE_SCORES`, `POWERUP_EVERY`, `FREEZE_MS`, and the initial `dropInterval` set in `init()`. If `COLS`/`ROWS`/`BLOCK` change, update the `<canvas id="board">` `width`/`height` in `index.html` to match (`COLS × BLOCK` by `ROWS × BLOCK`).

- **Theming**: colors are CSS variables in `style.css` (`:root` = dark default, `[data-theme="light"]` = light). `applyTheme()` in `game.js` sets `data-theme` on `<html>`, caches the `--grid` color for `drawGrid`, persists the choice in `localStorage` (`theme` key) and redraws. A small inline script in `index.html` applies the saved theme before first paint. Piece colors are the same in both themes.
