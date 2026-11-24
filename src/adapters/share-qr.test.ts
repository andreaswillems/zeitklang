import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderShareQr } from "./share-qr.ts";

const mocks = vi.hoisted(() => {
  const qr = {
    addData: vi.fn(),
    make: vi.fn(),
    getModuleCount: vi.fn(() => 2),
    isDark: vi.fn(
      (row: number, col: number) => (row === 0 && col === 1) || (row === 1 && col === 0),
    ),
  };
  return { qrcode: vi.fn(() => qr), qr, onImport: vi.fn() };
});

// Wie qr-scanner.test.ts: der Factory-Aufruf protokolliert, wann das Modul
// tatsächlich geladen wird. Ein statischer Import in share-qr.ts feuert
// sofort beim Laden des Testmoduls, das dynamische import() (XK91FVT) erst
// beim ersten renderShareQr-Aufruf.
vi.mock("qrcode-generator", () => {
  mocks.onImport();
  return { default: mocks.qrcode };
});

beforeEach(() => {
  // onImport bewusst NICHT zurücksetzen: kumulativ über die Tests, damit
  // „nur einmal geladen" prüfbar bleibt.
  mocks.qrcode.mockClear();
  mocks.qr.addData.mockClear();
  mocks.qr.make.mockClear();
  mocks.qr.isDark.mockClear();
});

function createCanvas() {
  const fillStyles: string[] = [];
  const context = {
    fillStyle: "",
    fillRect: vi.fn(() => {
      fillStyles.push(context.fillStyle);
    }),
  };
  const canvas = document.createElement("canvas");
  const getContext = vi
    .spyOn(canvas, "getContext")
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return { canvas, context, fillStyles, getContext };
}

describe("renderShareQr", () => {
  it("lädt qrcode-generator per Lazy-Import erst beim ersten Aufruf (nicht beim Modul-Load), nur einmal, und rendert die Parity-Geometrie", async () => {
    // Modul-Load von share-qr.ts darf qrcode-generator NICHT geladen haben
    // (die Mock-Factory feuert sonst sofort — statischer Import = rot).
    expect(mocks.onImport).not.toHaveBeenCalled();

    const text = "https://example.test/app?from=caller";
    const { canvas, context, fillStyles, getContext } = createCanvas();

    const result = renderShareQr(canvas, text);
    expect(result).toBeInstanceOf(Promise);
    await result;

    expect(mocks.onImport).toHaveBeenCalledTimes(1);
    expect(mocks.qrcode).toHaveBeenCalledWith(0, "M");
    expect(mocks.qr.addData).toHaveBeenCalledWith(text);
    expect(mocks.qr.make).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(80);
    expect(canvas.height).toBe(80);
    expect(getContext).toHaveBeenCalledWith("2d");
    expect(fillStyles).toEqual(["#ffffff", "#0e0e0e", "#0e0e0e"]);
    expect(context.fillRect.mock.calls).toEqual([
      [0, 0, 80, 80],
      [40, 32, 8, 8],
      [32, 40, 8, 8],
    ]);
    expect(mocks.qr.isDark.mock.calls).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);

    // Folgeaufruf: Modul-Cache des dynamischen import() → kein erneuter Import.
    await renderShareQr(canvas, "https://example.test/second");
    expect(mocks.onImport).toHaveBeenCalledTimes(1);
    expect(mocks.qr.addData.mock.calls).toEqual([
      [text],
      ["https://example.test/second"],
    ]);
  });
});
