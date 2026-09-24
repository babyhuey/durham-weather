import { dbzToRgb } from './nowcast.js';

const CROP_W = 128;
const CROP_H = 72;
const SCALE = 3;
const RING_MI = 25;
const MIN_DBZ = 10;

function crop(grid, w, cx, cy) {
  const img = new ImageData(CROP_W, CROP_H);
  const x0 = Math.round(cx - CROP_W / 2), y0 = Math.round(cy - CROP_H / 2);
  for (let y = 0; y < CROP_H; y++) {
    for (let x = 0; x < CROP_W; x++) {
      const v = grid[(y0 + y) * w + x0 + x];
      if (!(v >= MIN_DBZ)) continue;
      img.data.set([...dbzToRgb(v), 235], (y * CROP_W + x) * 4);
    }
  }
  return img;
}

// The latest radar scan, cropped to ~160 x 90 miles around the point.
export function miniSnapshot(nowcast) {
  const { grid, w, px, py, validMs } = nowcast;
  return { ms: validMs, image: crop(grid, w, px, py) };
}

export function drawMini(canvas, frame, kmPerPx) {
  canvas.width = CROP_W * SCALE;
  canvas.height = CROP_H * SCALE;
  const ctx = canvas.getContext('2d');
  const src = document.createElement('canvas');
  src.width = CROP_W;
  src.height = CROP_H;
  src.getContext('2d').putImageData(frame.image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2, cy = canvas.height / 2;
  const ring = ((RING_MI * 1.609344) / kmPerPx) * SCALE;
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, ring, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '600 11px Figtree, system-ui, sans-serif';
  ctx.fillText(`${RING_MI} mi`, cx + ring * 0.72 + 4, cy - ring * 0.72);
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(126,195,255,0.9)';
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
}
