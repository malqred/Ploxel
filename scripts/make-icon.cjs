// Иконка приложения из build/icon.svg: build/icon.png (512), icon-1024.png и build/icon.ico
// (16–256, 32-бит PNG внутри — чёткая на любом масштабе Windows).
// Запуск: npm run icon  (нужен Electron — он рисует SVG так же, как окно лаунчера)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const RENDER = 1024;

/** ICO с PNG-кадрами: заголовок, каталог по 16 байт на кадр, затем сами PNG. */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = 6 + dir.length;
  frames.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...frames.map((f) => f.png)]);
}

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ploxel-icon-'));
  try {
    const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8').replace('width="512" height="512"', `width="${RENDER}" height="${RENDER}"`);
    const page = path.join(tmp, 'icon.html');
    fs.writeFileSync(page, `<html><body style="margin:0;background:transparent">${svg}</body></html>`, 'utf8');
    const win = new BrowserWindow({ show: false, width: RENDER, height: RENDER, useContentSize: true, transparent: true, frame: false });
    await win.loadFile(page);
    await new Promise((r) => setTimeout(r, 500));
    // Снимок может прийти в масштабе экрана — приводим к точным размерам
    const full = (await win.webContents.capturePage({ x: 0, y: 0, width: RENDER, height: RENDER })).resize({ width: RENDER, height: RENDER, quality: 'best' });
    win.destroy();
    fs.writeFileSync(path.join(BUILD, 'icon.png'), full.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
    // 1024 × 1024 — для страниц вне лаунчера (Discord Developer Portal, каталоги)
    fs.writeFileSync(path.join(BUILD, 'icon-1024.png'), full.toPNG());
    const frames = SIZES.map((size) => ({ size, png: full.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
    fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(frames));
    console.log(`[icon] build/icon.png и build/icon.ico (${SIZES.join(', ')})`);
  } catch (e) {
    console.error('[icon] не удалось:', e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    app.quit();
  }
});
