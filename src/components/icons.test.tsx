import { render } from "@testing-library/preact";
import type { ComponentType } from "preact";
import { describe, expect, it } from "vitest";
import {
  CloseIcon,
  InstallIcon,
  LogoutIcon,
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  QrIcon,
  ScanStopIcon,
  SheetCloseIcon,
  SpotifyIcon,
  StepArrowIcon,
  TagIcon,
  TorchIcon,
  WarningIcon,
} from "./icons.tsx";

// Path-d byte-genau aus web/index.html gepinnt (Parity).
const icons: [string, ComponentType, string][] = [
  [
    "LogoutIcon",
    LogoutIcon,
    "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
  ],
  [
    "SpotifyIcon",
    SpotifyIcon,
    "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z",
  ],
  [
    "QrIcon",
    QrIcon,
    "M9.5,6.5v3h-3v-3H9.5 M11,5H5v6h6V5L11,5z M9.5,14.5v3h-3v-3H9.5 M11,13H5v6h6V13L11,13z M17.5,6.5v3h-3v-3H17.5 M19,5h-6v6 h6V5L19,5z M13,13h1.5v1.5H13V13z M14.5,14.5H16V16h-1.5V14.5z M16,13h1.5v1.5H16V13z M13,16h1.5v1.5H13V16z M14.5,17.5H16V19h-1.5 V17.5z M16,16h1.5v1.5H16V16z M17.5,14.5H19V16h-1.5V14.5z M17.5,17.5H19V19h-1.5V17.5z M22,7h-2V4h-3V2h5V7z M22,22v-5h-2v3h-3v2 H22z M2,22h5v-2H4v-3H2V22z M2,2v5h2V4h3V2H2z",
  ],
  ["InstallIcon", InstallIcon, "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"],
  ["TorchIcon", TorchIcon, "M8 2h8v4l-2.5 3v11a1.5 1.5 0 0 1-3 0V9L8 6V2z"],
  // #45: Scan-Stopp — byte-exact web/index.html L122 (derselbe Pfad wie CloseIcon).
  [
    "ScanStopIcon",
    ScanStopIcon,
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  ],
  // #70: Musik-Note des Guide-Schritts 2 — byte-exact web/index.html L153.
  [
    "MusicNoteIcon",
    MusicNoteIcon,
    "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
  ],
  // #70: Tag des Guide-Schritts 3 — byte-exact web/index.html L160.
  [
    "TagIcon",
    TagIcon,
    "M21.41 11.58l-9-9C12.05 2.23 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.23 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z",
  ],
  // #70: dekorativer Pfeil zwischen den Guide-Schritten — byte-exact web/index.html L150/L157.
  ["StepArrowIcon", StepArrowIcon, "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"],
  [
    "CloseIcon",
    CloseIcon,
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  ],
  ["PlayIcon", PlayIcon, "M8 5v14l11-7z"],
  ["PauseIcon", PauseIcon, "M6 5h4v14H6zm8 0h4v14h-4z"],
  // #37: Chevron-down des Sheet-Close — byte-exact web/index.html L195.
  ["SheetCloseIcon", SheetCloseIcon, "M12 17 5 10h14z"],
  ["WarningIcon", WarningIcon, "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"],
];

describe("icons (Parity web/index.html)", () => {
  it.each(icons)(
    "%s rendert svg 0 0 24 24, aria-hidden und gepinntes Path-d",
    (_name, Icon, d) => {
      const { container } = render(<Icon />);
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg?.querySelector("path")).toHaveAttribute("d", d);
    },
  );
});
