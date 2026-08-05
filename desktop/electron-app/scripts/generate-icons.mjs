/**
 * Generate app icons from the official EcoPilot brand logo.
 *
 * Called by: npm script "build:icons" in package.json
 * Output:
 *   desktop/electron-app/assets/icon.png (1024x1024 PNG, white rounded bg)
 *   desktop/frontend/public/icon.png   (64x64 favicon)
 *
 * Source of truth: desktop/frontend/public/eco-logo.svg (eco wordmark).
 * Uses sharp to render the SVG at high resolution with a white rounded
 * background suitable for Windows taskbar / macOS Dock visibility.
 */
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SVG_PATH = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'eco-logo.svg');
const OUTPUT_DIR = path.resolve(__dirname, '..', 'assets');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'icon.png');
const ICON_SIZE = 1024;
const PADDING_RATIO = 0.12; // 12% padding around the logo

async function generateIcon() {
  if (!fs.existsSync(SVG_PATH)) {
    throw new Error(`Brand logo not found: ${SVG_PATH}`);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const svgBuffer = fs.readFileSync(SVG_PATH, 'utf-8');

  const logoSize = Math.round(ICON_SIZE * (1 - PADDING_RATIO * 2));
  const offset = Math.round(ICON_SIZE * PADDING_RATIO);

  // White rounded-rectangle background, then composite the wordmark on top
  const bgSvg = `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="${Math.round(ICON_SIZE * 0.225)}" fill="#ffffff"/>
  </svg>`;

  const bgBuffer = await sharp(Buffer.from(bgSvg)).png().toBuffer();

  // Wordmark is wide (788x348) — fit by width, center vertically
  const logoBuffer = await sharp(Buffer.from(svgBuffer), { density: 384 })
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(bgBuffer)
    .composite([{ input: logoBuffer, left: offset, top: offset }])
    .png()
    .toFile(OUTPUT_PATH);

  console.log(`Icon generated: ${OUTPUT_PATH} (${ICON_SIZE}x${ICON_SIZE})`);

  // Also generate a favicon-sized version for the frontend
  const faviconPath = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'icon.png');
  await sharp(Buffer.from(svgBuffer), { density: 384 })
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(faviconPath);
  console.log(`Favicon generated: ${faviconPath} (64x64)`);
}

generateIcon().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
