# vendor/fonts

## GreatVibes-Regular-latin.ttf

The handwriting ("script") style a trainee's adopted signature is drawn in, on screen
(`@font-face` from this file) and in the assessment PDFs (embedded with jsPDF's
`addFileToVFS` / `addFont`). It is served from this site only — never from a font CDN.

- **Font:** Great Vibes, by Robert Leuschke — version 1.103
  (https://github.com/googlefonts/great-vibes, as published in google/fonts `ofl/greatvibes`,
  source commit f95eb967a3414e5accd65f4fa653c47f607654fa).
- **Licence:** SIL Open Font License 1.1 — `OFL-GreatVibes.txt` beside this file. The font
  declares no Reserved Font Name, so a subset may keep its name.
- **What was changed:** a subset only, made with fontTools `pyftsubset` 4.68:
  Basic Latin, Latin-1 Supplement and Latin Extended-A (U+0020–007E, U+00A0–017F), curly
  quotes, en and em dash and the ellipsis; no OpenType layout features, no hinting.
  457 KB → 41 KB, so a trainee's phone fetches it quickly the first time she signs.
  The outlines are untouched.
- Original file SHA-256: `8d509802186f1b51572531ecf313e8098f9a5bfdfaca93f0c9b34467f9982d15`.

To make the subset again:

```
pyftsubset GreatVibes-Regular.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2018-201E,U+2026,U+2013,U+2014" \
  --layout-features='' --no-hinting --output-file=GreatVibes-Regular-latin.ttf
```
