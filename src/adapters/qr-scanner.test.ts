import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQrScanner } from "./qr-scanner.ts";

const moduleMock = vi.hoisted(() => ({ onImport: vi.fn() }));

type Qrbox = (width: number, height: number) => { width: number; height: number };
type ScanConfig = { fps: number; qrbox: Qrbox };

class FakeHtml5Qrcode {
  static instances: FakeHtml5Qrcode[] = [];

  onDecoded: ((text: string) => void) | null = null;
  onFrameError: ((error: unknown) => void) | null = null;
  start = vi.fn(
    async (
      _camera: { facingMode: string },
      _config: ScanConfig,
      onDecoded: (text: string) => void,
      onFrameError: (error: unknown) => void,
    ): Promise<void> => {
      this.onDecoded = onDecoded;
      this.onFrameError = onFrameError;
    },
  );
  stop = vi.fn<() => Promise<void>>(() => Promise.resolve());
  getRunningTrackCapabilities = vi.fn((): { torch?: unknown } => ({ torch: true }));
  applyVideoConstraints = vi.fn<
    (constraints: { advanced: Array<{ torch: boolean }> }) => Promise<void>
  >(() => Promise.resolve());

  constructor(readonly elementId: string) {
    FakeHtml5Qrcode.instances.push(this);
  }
}

vi.mock("html5-qrcode", () => {
  moduleMock.onImport();
  return { Html5Qrcode: FakeHtml5Qrcode };
});

beforeEach(() => {
  FakeHtml5Qrcode.instances = [];
});

describe("createQrScanner", () => {
  it("lazy-loads html5-qrcode on start and uses the parity camera configuration", async () => {
    const scanner = createQrScanner({ onScan: vi.fn() });
    expect(moduleMock.onImport).not.toHaveBeenCalled();
    expect(FakeHtml5Qrcode.instances).toHaveLength(0);

    await scanner.start();

    expect(moduleMock.onImport).toHaveBeenCalledTimes(1);
    expect(FakeHtml5Qrcode.instances).toHaveLength(1);
    const fake = FakeHtml5Qrcode.instances[0];
    expect(fake.elementId).toBe("reader");
    expect(fake.start).toHaveBeenCalledTimes(1);
    const [camera, config] = fake.start.mock.calls[0];
    expect(camera).toEqual({ facingMode: "environment" });
    expect(config.fps).toBe(10);
    expect(config.qrbox(400, 200)).toEqual({ width: 140, height: 140 });
    expect(config.qrbox(1000, 800)).toEqual({ width: 250, height: 250 });
    expect("Html5Qrcode" in window).toBe(false);
  });

  it("forwards every decoded text, ignores frame errors, and never stops or double-starts", async () => {
    const onScan = vi.fn<(text: string) => void>();
    const scanner = createQrScanner({ onScan });
    await scanner.start();
    const fake = FakeHtml5Qrcode.instances[0];

    fake.onDecoded?.("first");
    expect(() => fake.onFrameError?.(new Error("no QR in this frame"))).not.toThrow();
    fake.onDecoded?.("second");
    await scanner.start();

    expect(onScan.mock.calls).toEqual([["first"], ["second"]]);
    expect(fake.stop).not.toHaveBeenCalled();
    expect(fake.start).toHaveBeenCalledTimes(1);
  });

  it("exposes truthy torch capabilities and falls back to false on absence or errors", async () => {
    const scanner = createQrScanner({ onScan: vi.fn() });
    expect(scanner.torchSupported).toBe(false);
    await scanner.start();
    const fake = FakeHtml5Qrcode.instances[0];

    fake.getRunningTrackCapabilities.mockReturnValue({ torch: 1 });
    await scanner.stop();
    await scanner.start();
    expect(scanner.torchSupported).toBe(true);

    fake.getRunningTrackCapabilities.mockReturnValue({});
    await scanner.stop();
    await scanner.start();
    expect(scanner.torchSupported).toBe(false);

    fake.getRunningTrackCapabilities.mockImplementation(() => {
      throw new Error("capabilities unavailable");
    });
    await scanner.stop();
    await scanner.start();
    expect(scanner.torchSupported).toBe(false);
  });

  it("applies torch constraints and resolves false instead of throwing on failure", async () => {
    const scanner = createQrScanner({ onScan: vi.fn() });
    await scanner.start();
    const fake = FakeHtml5Qrcode.instances[0];

    await expect(scanner.applyTorch(true)).resolves.toBe(true);
    expect(fake.applyVideoConstraints).toHaveBeenCalledWith({
      advanced: [{ torch: true }],
    });

    fake.applyVideoConstraints.mockRejectedValueOnce(new Error("torch unavailable"));
    await expect(scanner.applyTorch(false)).resolves.toBe(false);
    expect(fake.applyVideoConstraints).toHaveBeenLastCalledWith({
      advanced: [{ torch: false }],
    });
  });

  it("stops tolerantly when the camera is already stopped", async () => {
    const scanner = createQrScanner({ onScan: vi.fn() });
    await scanner.start();
    const fake = FakeHtml5Qrcode.instances[0];
    fake.stop.mockRejectedValueOnce(new Error("already stopped"));

    await expect(scanner.stop()).resolves.toBeUndefined();
    await expect(scanner.stop()).resolves.toBeUndefined();
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });
});
