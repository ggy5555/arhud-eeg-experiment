import { ARROWS, POSITION_DEG } from "./config.js?v=20260915-web3";
import { mulberry32 } from "./randomization.js?v=20260915-web3";

const GRID_EDGES = [];
for (let row = 0; row < 3; row += 1) {
  for (let col = 0; col < 3; col += 1) {
    const node = row * 3 + col;
    if (col < 2) GRID_EDGES.push([node, node + 1]);
    if (row < 2) GRID_EDGES.push([node, node + 3]);
  }
}

function shuffle(items, rng) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function spanningTree(rng) {
  const visited = new Set([0]);
  const tree = [];
  while (visited.size < 9) {
    const candidates = GRID_EDGES.filter(([a, b]) => visited.has(a) !== visited.has(b));
    const [a, b] = candidates[Math.floor(rng() * candidates.length)];
    tree.push([a, b]);
    visited.add(a);
    visited.add(b);
  }
  return tree;
}

function key([a, b]) {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

export function connectorPair(seed, same) {
  const rng = mulberry32(seed >>> 0);
  const tree = spanningTree(rng);
  const used = new Set(tree.map(key));
  const extras = shuffle(GRID_EDGES.filter((edge) => !used.has(key(edge))), rng).slice(0, 2);
  const left = [...tree, ...extras];
  if (same) return { left, right: left.map((edge) => [...edge]) };
  const withoutOneExtra = [...tree, extras[1]];
  const nowUsed = new Set(withoutOneExtra.map(key));
  const replacement = shuffle(GRID_EDGES.filter((edge) => !nowUsed.has(key(edge))), rng)
    .find((edge) => key(edge) !== key(extras[0]));
  return { left, right: [...withoutOneExtra, replacement] };
}

export function degreesToCssPixels(degrees, monitor) {
  const cm = 2 * monitor.distanceCm * Math.tan((Math.abs(degrees) * Math.PI / 180) / 2);
  const pixelsPerCm = monitor.viewportWidthPx / monitor.widthCm;
  return Math.sign(degrees) * cm * pixelsPerCm;
}

function prepareCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#07111f";
  ctx.fillRect(0, 0, width, height);
  return { ctx, width, height };
}

function gridPoint(node, centerX, centerY, spacing) {
  const col = node % 3;
  const row = Math.floor(node / 3);
  return [centerX + (col - 1) * spacing, centerY + (row - 1) * spacing];
}

function drawPattern(ctx, edges, centerX, centerY, spacing, nodeRadius) {
  ctx.strokeStyle = "#e9f3ff";
  ctx.fillStyle = "#e9f3ff";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const [a, b] of edges) {
    const start = gridPoint(a, centerX, centerY, spacing);
    const end = gridPoint(b, centerX, centerY, spacing);
    ctx.beginPath();
    ctx.moveTo(...start);
    ctx.lineTo(...end);
    ctx.stroke();
  }
  for (let node = 0; node < 9; node += 1) {
    const [x, y] = gridPoint(node, centerX, centerY, spacing);
    ctx.beginPath();
    ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawFixation(canvas) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.strokeStyle = "#e9f3ff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 10, height / 2);
  ctx.lineTo(width / 2 + 10, height / 2);
  ctx.moveTo(width / 2, height / 2 - 10);
  ctx.lineTo(width / 2, height / 2 + 10);
  ctx.stroke();
}

export function drawBlank(canvas) {
  prepareCanvas(canvas);
}

export function drawSyncFlash(canvas) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
}

export function drawResponsePrompt(canvas, title, subtitle) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#e9f3ff";
  ctx.textAlign = "center";
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.fillText(title, width / 2, height / 2 - 10);
  ctx.fillStyle = "#9fb5cc";
  ctx.font = "500 20px system-ui, sans-serif";
  ctx.fillText(subtitle, width / 2, height / 2 + 32);
}

export function drawTrial(canvas, trial, monitor) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const px = (deg) => degreesToCssPixels(deg, monitor);
  const centerX = width / 2;
  const centerY = height / 2;
  const pair = connectorPair(trial.stimulusSeed, trial.primarySame);
  const patternOffset = px(1.05);
  const spacing = Math.max(8, Math.abs(px(0.35)));
  const nodeRadius = Math.max(2.5, Math.abs(px(0.055)));
  drawPattern(ctx, pair.left, centerX - patternOffset, centerY, spacing, nodeRadius);
  drawPattern(ctx, pair.right, centerX + patternOffset, centerY, spacing, nodeRadius);

  const [xDeg, yDeg] = POSITION_DEG[trial.condition];
  const cueX = centerX + px(xDeg);
  const cueY = centerY - px(yDeg);
  ctx.fillStyle = "#ffd166";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.max(28, Math.abs(px(0.65)))}px system-ui, sans-serif`;
  ctx.fillText(ARROWS[trial.cueDirection], cueX, cueY);
}

export function drawGeometry(canvas, monitor) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const px = (deg) => degreesToCssPixels(deg, monitor);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.abs(px(2.39));
  ctx.strokeStyle = "rgba(91, 192, 235, .35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  for (const [condition, [xDeg, yDeg]] of Object.entries(POSITION_DEG)) {
    const x = cx + px(xDeg);
    const y = cy - px(yDeg);
    ctx.fillStyle = condition === "CENTER" ? "#ffd166" : "#42d3a0";
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e9f3ff";
    ctx.font = "700 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(condition, x, y - 20);
  }
  const rulerPx = 5 * (monitor.viewportWidthPx / monitor.widthCm);
  const startX = 40;
  const y = height - 70;
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(startX + rulerPx, y);
  ctx.stroke();
  ctx.fillStyle = "#e9f3ff";
  ctx.textAlign = "left";
  ctx.font = "600 16px system-ui, sans-serif";
  ctx.fillText("실물 자로 5 cm인지 확인", startX, y - 14);
}

export function drawDigit(canvas, digit) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#e9f3ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "800 90px system-ui, sans-serif";
  ctx.fillText(String(digit), width / 2, height / 2);
}
