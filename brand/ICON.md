# Community Fund icons

The app icon is the Community Fund mark: **a coin dropping into a shared
jar**. One flat mark, no text, drawn only with rounded rects and circles.
It follows the Homeroom brand framework's "Icons" tiles (one bold simple
mark on a single-colour rounded tile) and uses only brand colours.

## Files

| File | Size | Colours |
| --- | --- | --- |
| `icon.svg` → `icon.png` | 1024×1024 | Yellow `#FFEE6F` tile, Black `#000000` mark (Black + Yellow pairing) |
| `featured-light.svg` → `featured-light.png` | 1600×900 | Cream `#FFFEEA` ground, Black jar and lid, Yellow coin (Cream + Black, Yellow accent) |
| `featured-dark.svg` → `featured-dark.png` | 1600×900 | Black `#000000` ground, Cream jar and lid, Yellow coin (Black + Cream, Yellow accent) |

`icon.png` is referenced by `dapp.json` (`icon.image`) and shown on the
home screen tile; the platform rounds and crops it, so the SVG is full
bleed and square-cornered. `icon.emoji` (`💰`) stays as the fallback if
the image ever fails to load.

The featured PNGs are kept here for the Homeroom directory's featured
illustration (light and dark versions); the platform has no field that
serves them yet, so nothing links to them at runtime.

## Geometry (1024 grid)

- Tile: `rect 1024×1024`
- Lid: `rect x=352 y=392 w=320 h=60 rx=22`, slot cut as `rect x=432 y=410 w=160 h=24 rx=12` in tile colour
- Jar: `rect x=304 y=460 w=416 h=380 rx=104`
- Coin: `circle cx=512 cy=250 r=96` with rim `circle r=52` stroked in tile colour

The featured versions scale the same shapes by ~1.2 and centre them on
the 1600×900 ground; there the coin is a filled Yellow disc with a Black
rim ring (no cut-out centre).

## Rasterizing

No rasterizer ships with the repo. The PNGs were rendered with headless
Chromium (Playwright's bundled build) screenshotting each SVG at exactly
its viewBox size with no device scaling:

```sh
CHROME_PATH=<chromium binary> NODE_PATH=<dir with playwright-core> \
  node brand/rasterize.js
```

`brand/rasterize.js` is the script that did it. Checks run on the
outputs: real PNG bytes, exact pixel size, fully opaque, and pixel
samples only ever in `#FFEE6F`, `#000000`, `#FFFEEA` (edge pixels blend
from anti-aliasing, which is expected). The icon was also checked
downscaled to 32×32 on white and black backgrounds: coin and jar stay
two distinct shapes.
