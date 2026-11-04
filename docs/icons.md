# App-Icons — Dateien und Umfärben

> Die PWA-Icons sind bewusst **kein** Spotify-Brand-Look mehr (dunkles Theme + blaues Akzentschema, siehe `web/style.css` `:root`). Diese Doku beschreibt die Icon-Dateien und den reproduzierbaren Prozess, wie das Farbschema 2026 von Spotify-Grün auf Blau umgestellt wurde — für künftige Durchläufe mit anderem Akzent.

## Dateien und ihre Rollen

| Datei | Verwendung | Referenz |
|---|---|---|
| `web/icon.png` (1024×1024) | Favicon + Apple-Touch-Icon | `web/index.html` (`rel="icon"`, `rel="apple-touch-icon"`) |
| `web/icons/icon-192.png` | PWA-Icon | `web/manifest.webmanifest` |
| `web/icons/icon-512.png` | PWA-Icon | `web/manifest.webmanifest` |
| `web/icons/icon-maskable-512.png` | PWA-Icon, maskable (Android adaptiert Form) | `web/manifest.webmanifest`, `purpose: "maskable"` |

## Design

Ein „Z" (Zeitklang) auf dunklem Hintergrund `#0e0e0e`: Balken/Diagonale links in der **Akzentfarbe**, rechte Hälfte weiß, die Diagonale läuft als Verlauf Akzent→Weiß. Dazu ein feiner Magenta-Kantenakzent (~0,2 % der Pixel, bleibt bei Schema-Wechseln stehen — harmoniert mit Grün wie mit Blau).

> **Herkunft:** Das Original wurde mit einem einmaligen **Pillow-Skript** erzeugt (Commit `9b6ccde`, Skript selbst nicht im Repo). Auch das Umfärben unten läuft mit Pillow — für eine komplette Neuerzeugung bietet sich dasselbe Werkzeug an.

## Umfärben bei neuem Akzent (Hue-Shift, nicht neu zeichnen)

Statt die Icons neu zu generieren wird nur der **Hue** der Akzentfarbe verschoben — Struktur, Verläufe, Weiß und Antialiasing bleiben pixelgenau erhalten. Sättigung und Helligkeit jeder Pixel bleiben unberührt.

**Shift berechnen:** Hue(neue Akzentfarbe) − Hue(alte Akzentfarbe), in der 255er-Skala von PIL (`hue° × 255/360`). Beispiel Grün→Blau: 217° − 139° = +78° → **+55**.

```bash
uv run python -c "
from PIL import Image

ALT_BAND = (80, 140)   # Hue-Band der alten Akzentfarbe (255er-Skala)
SHIFT = 55            # Hue(alt) -> Hue(neu), hier Gruen ~139° -> Blau ~217°
shift = lambda hv: hv + SHIFT if ALT_BAND[0] <= hv <= ALT_BAND[1] else hv

for p in ['web/icon.png', 'web/icons/icon-192.png', 'web/icons/icon-512.png', 'web/icons/icon-maskable-512.png']:
    im = Image.open(p).convert('RGBA')
    alpha = im.getchannel('A')
    h, s, v = im.convert('RGB').convert('HSV').split()
    out = Image.merge('HSV', (h.point(shift), s, v)).convert('RGB')
    out.putalpha(alpha)
    out.save(p)
    print('umgefaerbt:', p)
"
```

Weiß/Grau/Schwarz haben Sättigung 0 und Hue 0 — sie werden vom Band nicht erfasst und bleiben automatisch unangetastet. Verläufe zur Umgebung (Antialiasing) tragen den Hue der Akzentfarbe und wandern mit.

## Verifikation

1. **Farben zählen** — gesättigte Pixel dürfen nicht mehr im alten Hue-Band liegen:

```bash
uv run python -c "
from PIL import Image
for p in ['web/icon.png', 'web/icons/icon-192.png', 'web/icons/icon-512.png', 'web/icons/icon-maskable-512.png']:
    im = Image.open(p).convert('HSV')
    h, s, v = im.split()
    sat = [hv for hv, sv, vv in zip(h.getdata(), s.getdata(), v.getdata()) if sv > 60 and vv > 60]
    alt = sum(1 for hv in sat if 70 <= hv <= 130)   # altes Band anpassen!
    neu = sum(1 for hv in sat if 140 <= hv <= 175)  # neues Band anpassen!
    print(f'{p}: alt={alt}, neu={neu}')
"
```

2. **Sichtcheck im Finder** — die Dateien öffnen und mit `web/style.css` abgleichen.

## Hinweise

- **Maskable-Icon:** Die Geometrie (Safe-Zone) wird nicht verändert, nur Farben — keine neue Prüfung nötig.
- **Sync mit CSS:** Die Akzentfarbe steht in `web/style.css` (`:root`, `--accent`/`--accent-bright`). Icon-Shift und CSS-Werte zusammen ändern.
- **Deployment:** Nach Commit/Push auf `main` deployt GitHub Pages die Icons automatisch; Browser cachen PWA-Icons aggressiv — auf dem Testgerät ggf. PWA von Homescreen entfernen und neu installieren.
- **theme_color** in `web/manifest.webmanifest` und `web/index.html` betrifft nur den Hintergrund (`#0e0e0e`) und bleibt bei Akzent-Wechseln unverändert.
