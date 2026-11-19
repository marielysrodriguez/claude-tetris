'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#90a4ae', // N - nut (steel gray)
  '#ffffff', // W - comodín (se dibuja con degradado arcoíris, ver drawWildBlock)
];

// Índice del comodín en el tablero. No tiene entrada en PIECES, así que randomPiece() nunca lo genera.
const WILD = 9;

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca (centro hueco)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// ---- Power-ups ----
const POWERUP_EVERY = 5;   // cada cuántas líneas borradas aparece un power-up
const FREEZE_MS = 5000;    // duración de Congelar
const POWER_BORDER = '#ffd54f';
const POWERUPS = {
  bomb:    { icon: '💣', name: 'Bomba' },
  ray:     { icon: '⚡', name: 'Rayo' },
  tint:    { icon: '🎨', name: 'Tinte' },
  gravity: { icon: '🌍', name: 'Gravedad' },
  freeze:  { icon: '❄️', name: 'Congelar' },
};
const POWERUP_TYPES = Object.keys(POWERUPS);

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const powerEl = document.getElementById('powerup-status');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const themeLabel = document.getElementById('theme-label');

let gridColor = '#22222e';
let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let freezeLeft = 0;      // ms restantes de Congelar
let powerupsGiven = 0;   // power-ups ya entregados (para no repetirlos)
let lastPowerText = '';  // evita reescribir el DOM del HUD en cada frame

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

// Pieza especial: un bloque 1×1 que no se fusiona con el tablero, aplica su efecto al caer.
function randomPowerPiece() {
  const power = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  return { type: 0, power, dir: 'h', shape: [[1]], x: Math.floor(COLS / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

// Una fila se borra si está llena; cada comodín cuenta como un bloque extra (tapa un hueco).
function rowComplete(row) {
  let filled = 0, wilds = 0;
  for (const v of row) {
    if (v) filled++;
    if (v === WILD) wilds++;
  }
  return filled + wilds >= COLS;
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (rowComplete(board[r])) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

// ---- Efectos de power-ups ----

// Fila que borra el Rayo horizontal: la de impacto (bajo la pieza), o la propia si está en el suelo.
function rayRow(y) {
  return y + 1 < ROWS ? y + 1 : y;
}

// Color que convierte el Tinte: el del bloque sobre el que cae; si no hay (suelo / comodín),
// el color más abundante del tablero. Devuelve 0 si el tablero no tiene bloques tintables.
function tintTarget(x, y) {
  const below = y + 1 < ROWS ? board[y + 1][x] : 0;
  if (below && below !== WILD) return below;
  const counts = {};
  let best = 0, bestN = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (!v || v === WILD) continue;
      const n = counts[v] = (counts[v] || 0) + 1;
      if (n > bestN) { best = v; bestN = n; }
    }
  }
  return best;
}

function applyGravity() {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const v = board[r][c];
      if (!v) continue;
      board[r][c] = 0;
      board[write][c] = v;
      write--;
    }
  }
}

function applyPowerUp(p) {
  let destroyed = 0;
  switch (p.power) {
    case 'bomb':
      for (let r = Math.max(0, p.y - 1); r <= Math.min(ROWS - 1, p.y + 1); r++)
        for (let c = Math.max(0, p.x - 1); c <= Math.min(COLS - 1, p.x + 1); c++)
          if (board[r][c]) { board[r][c] = 0; destroyed++; }
      break;
    case 'ray':
      if (p.dir === 'v') {
        for (let r = 0; r < ROWS; r++)
          if (board[r][p.x]) { board[r][p.x] = 0; destroyed++; }
      } else {
        // Se elimina como una línea normal (lo de arriba baja) pero no suma a `lines`,
        // para que los power-ups no se alimenten a sí mismos.
        const row = rayRow(p.y);
        destroyed = board[row].filter(Boolean).length;
        board.splice(row, 1);
        board.unshift(new Array(COLS).fill(0));
      }
      break;
    case 'tint': {
      const target = tintTarget(p.x, p.y);
      if (target)
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            if (board[r][c] === target) board[r][c] = WILD;
      break;
    }
    case 'gravity':
      applyGravity();
      break;
    case 'freeze':
      freezeLeft = FREEZE_MS; // se reinicia, no se acumula
      break;
  }
  if (destroyed) {
    score += destroyed * 10 * level;
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.power) applyPowerUp(current);
  else merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  if (Math.floor(lines / POWERUP_EVERY) > powerupsGiven) {
    powerupsGiven++;
    next = randomPowerPiece();
  } else {
    next = randomPiece();
  }
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function updatePowerHUD() {
  let text = '—';
  if (freezeLeft > 0) {
    text = `${POWERUPS.freeze.icon} ${(freezeLeft / 1000).toFixed(1)}s`;
  } else if (current && current.power) {
    const info = POWERUPS[current.power];
    text = `${info.icon} ${info.name}`;
    if (current.power === 'ray') text += current.dir === 'v' ? ' ↕' : ' ↔';
  }
  if (text !== lastPowerText) {
    lastPowerText = text;
    powerEl.textContent = text;
  }
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  if (colorIndex === WILD) { drawWildBlock(context, x, y, size, alpha); return; }
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

// Comodín: degradado arcoíris con una estrella (legible en tema claro y oscuro).
function drawWildBlock(context, x, y, size, alpha) {
  const px = x * size, py = y * size;
  const g = context.createLinearGradient(px, py, px + size, py + size);
  g.addColorStop(0, '#e57373');
  g.addColorStop(0.25, '#ffd54f');
  g.addColorStop(0.5, '#81c784');
  g.addColorStop(0.75, '#4dd0e1');
  g.addColorStop(1, '#ba68c8');
  context.save();
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = g;
  context.fillRect(px + 1, py + 1, size - 2, size - 2);
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(px + 1, py + 1, size - 2, 4);
  context.fillStyle = 'rgba(20,20,30,0.75)';
  context.font = `bold ${Math.floor(size * 0.6)}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('★', px + size / 2, py + size / 2 + 1);
  context.restore();
}

// Bloque de power-up: fondo oscuro, borde dorado y emoji. `dir` solo importa para el Rayo.
function drawPowerBlock(context, x, y, power, size, alpha, dir) {
  const px = x * size, py = y * size;
  context.save();
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = '#1d1d2b';
  context.fillRect(px + 1, py + 1, size - 2, size - 2);
  context.strokeStyle = POWER_BORDER;
  context.lineWidth = 2;
  context.strokeRect(px + 2, py + 2, size - 4, size - 4);
  context.font = `${Math.floor(size * 0.6)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#fff';
  context.fillText(POWERUPS[power].icon, px + size / 2, py + size / 2 + 1);
  if (power === 'ray') {
    // Barra que indica la orientación: abajo = fila, a la derecha = columna
    context.fillStyle = POWER_BORDER;
    if (dir === 'v') context.fillRect(px + size - 5, py + 4, 2, size - 8);
    else context.fillRect(px + 4, py + size - 5, size - 8, 2);
  }
  context.restore();
}

// Vista previa de la zona que afectará el power-up si cae en la posición fantasma.
function drawPowerTarget(p, gy) {
  ctx.save();
  if (p.power === 'bomb') {
    const r0 = Math.max(0, gy - 1), r1 = Math.min(ROWS - 1, gy + 1);
    const c0 = Math.max(0, p.x - 1), c1 = Math.min(COLS - 1, p.x + 1);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#e57373';
    ctx.fillRect(c0 * BLOCK, r0 * BLOCK, (c1 - c0 + 1) * BLOCK, (r1 - r0 + 1) * BLOCK);
  } else if (p.power === 'ray') {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = POWER_BORDER;
    if (p.dir === 'v') ctx.fillRect(p.x * BLOCK, 0, BLOCK, ROWS * BLOCK);
    else ctx.fillRect(0, rayRow(gy) * BLOCK, COLS * BLOCK, BLOCK);
  } else if (p.power === 'tint') {
    const target = tintTarget(p.x, gy);
    if (target) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = POWER_BORDER;
      ctx.lineWidth = 2;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (board[r][c] === target)
            ctx.strokeRect(c * BLOCK + 2, r * BLOCK + 2, BLOCK - 4, BLOCK - 4);
    }
  }
  ctx.restore();
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  const gy = ghostY();
  if (current.power) {
    drawPowerTarget(current, gy);
    drawPowerBlock(ctx, current.x, gy, current.power, BLOCK, 0.2, current.dir);
    drawPowerBlock(ctx, current.x, current.y, current.power, BLOCK, 1, current.dir);
  } else {
    // ghost
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c])
          drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

    // current piece
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
  }

  // velo helado mientras dura Congelar
  if (freezeLeft > 0) {
    ctx.fillStyle = 'rgba(129, 212, 250, 0.18)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  updatePowerHUD();
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (next.power) {
    // el canvas es 4×4 bloques: el 1×1 se centra en (1.5, 1.5)
    drawPowerBlock(nextCtx, 1.5, 1.5, next.power, NB, 1, next.dir);
    return;
  }
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (freezeLeft > 0) {
    // Congelar: la pieza no cae sola; el jugador aún puede moverla y soltarla
    freezeLeft = Math.max(0, freezeLeft - dt);
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
      } else {
        lockPiece();
      }
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  freezeLeft = 0;
  powerupsGiven = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      // El Rayo no rota: alterna entre fila (h) y columna (v)
      if (current.power === 'ray') current.dir = current.dir === 'h' ? 'v' : 'h';
      else tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function applyTheme(theme, save) {
  const isLight = theme === 'light';
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
  themeToggle.setAttribute('aria-checked', String(isLight));
  themeLabel.textContent = isLight ? 'Claro' : 'Oscuro';
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || gridColor;
  if (save) {
    try { localStorage.setItem('theme', theme); } catch (e) {}
  }
  // Redibujar también en pausa / game over, cuando el loop no corre
  if (current && next) { draw(); drawNext(); }
}

themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light', true);
  themeToggle.blur(); // evita que Space/Enter activen el switch en vez de la caída
});

let savedTheme = 'dark';
try { savedTheme = localStorage.getItem('theme') === 'light' ? 'light' : 'dark'; } catch (e) {}
applyTheme(savedTheme, false);

init();
