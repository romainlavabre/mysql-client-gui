// Renders build/logo.svg to build/icon.png (512x512, transparent corners).
//
// Run: npx electron build/render-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = Number(process.env.ICON_SIZE ?? 512)
const OUT = process.env.ICON_OUT ?? join(__dirname, 'icon.png')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = readFileSync(join(__dirname, 'logo.svg'), 'utf8')
  const window = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, frame: false, useContentSize: true })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${SIZE}" height="${SIZE}"`)}</body></html>`
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  writeFileSync(OUT, image.resize({ width: SIZE, height: SIZE }).toPNG())
  console.log(`Wrote ${OUT}`)
  app.quit()
})
