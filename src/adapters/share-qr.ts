const QUIET_ZONE = 4;
const SCALE = 8;

/**
 * Rendert text als QR-Code mit der scanner-sicheren Kontrastfarbe des
 * Share-Dialogs. async: qrcode-generator wird per dynamischem import()
 * geladen (analog html5-qrcode in qr-scanner.ts) und landet so in einem
 * eigenen Lazy-Chunk statt im Main-Chunk (XK91FVT).
 */
export async function renderShareQr(
  canvas: HTMLCanvasElement,
  text: string,
): Promise<void> {
  const { default: qrcode } = await import("qrcode-generator");
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const modules = qr.getModuleCount();
  const dimension = (modules + QUIET_ZONE * 2) * SCALE;
  canvas.width = dimension;
  canvas.height = dimension;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, dimension, dimension);
  context.fillStyle = "#0e0e0e";
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) {
        context.fillRect(
          (col + QUIET_ZONE) * SCALE,
          (row + QUIET_ZONE) * SCALE,
          SCALE,
          SCALE,
        );
      }
    }
  }
}
