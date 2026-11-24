export interface CreateQrScannerOptions {
  onScan: (text: string) => void;
}

export interface QrScannerHandle {
  readonly torchSupported: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  applyTorch(on: boolean): Promise<boolean>;
}

type Html5QrcodeInstance = import("html5-qrcode").Html5Qrcode;

/** Callback wrapper around html5-qrcode; the library stays out of the initial bundle. */
export function createQrScanner({ onScan }: CreateQrScannerOptions): QrScannerHandle {
  let scanner: Html5QrcodeInstance | null = null;
  let starting: Promise<void> | null = null;
  let running = false;
  let torchSupported = false;

  async function start(): Promise<void> {
    if (running) return;
    if (starting) return starting;

    starting = (async () => {
      if (!scanner) {
        const { Html5Qrcode } = await import("html5-qrcode");
        scanner = new Html5Qrcode("reader");
      }
      const activeScanner = scanner;
      await activeScanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (width, height) => {
            const size = Math.min(250, Math.floor(Math.min(width, height) * 0.7));
            return { width: size, height: size };
          },
        },
        onScan,
        () => {},
      );
      running = true;
      try {
        // Chromium's non-standard torch field is absent from lib.dom.
        const capabilities =
          activeScanner.getRunningTrackCapabilities() as MediaTrackCapabilities & {
            torch?: unknown;
          };
        torchSupported = Boolean(capabilities.torch);
      } catch {
        torchSupported = false;
      }
    })();

    try {
      await starting;
    } finally {
      starting = null;
    }
  }

  return {
    start,
    get torchSupported() {
      return torchSupported;
    },
    async stop() {
      if (!scanner || !running) return;
      running = false;
      torchSupported = false;
      try {
        await scanner.stop();
      } catch {
        // #45: an already-stopped camera is the desired state.
      }
    },
    async applyTorch(on) {
      if (!scanner) return false;
      try {
        const constraints: MediaTrackConstraints & {
          advanced: Array<{ torch: boolean }>;
        } = { advanced: [{ torch: on }] };
        await scanner.applyVideoConstraints(constraints);
        return true;
      } catch {
        return false;
      }
    },
  };
}
