# The front page's sounds

Values for the loops on pung.live's front page (`scripts/hero-loops.sh`, `src/heroframes_test.go`).

- `nodalred`, `ostirus`, `vavra`, `xenia`: sounds of Pung's own, made up for the picture. No value is read from
  any firmware or factory bank (CLAUDE.md, Ask first); Xenia's wavetable is a user table computed here
  (see the commit that added it). What a file does not name is drawn at the neutral setting of the card pictures.
- `vivace`: one of Vivace's own factory sounds (Glass Pad), read from a device without Live: Vivace is Pung's own.
  In the loop both its wavetables travel through their frames: the recorder reports their playing positions
  as Vivace's engine would under an LFO (`heroSweeps`, `heroReports` in `src/heroframes_test.go`), since
  Vivace is the first panel a visitor sees.
