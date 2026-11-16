// visuals-parity.js: web/visuals.js must find the same pictures as
// visuals_shapes.go on every page of the fleet (UX-GUIDELINES.md 1.2).
//   make test-visuals   (writes the pages with Go, then runs this with node)
const fs = require("fs");
global.window = {};
global.document = {};
eval(fs.readFileSync(process.argv[2], "utf8"));
const pages = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const spans = (gs) => gs.map((g) => `${g.kind}[${g.start},${g.end})`).join(" ");
let bad = 0, n = 0;
for (const p of pages) {
  const got = spans(window.PungVisuals.pictureGroups(p.keys || []));
  n++;
  if (got !== p.spans) { bad++; if (bad < 10) console.log("DIFF", JSON.stringify(p.keys), "go:", p.spans, "js:", got); }
}
// envelopes: the same shape, layout and clock as envmodel.go, number for number
const fsx = require("path");
const envFile = fsx.join(fsx.dirname(process.argv[3]), "env-cases.json");
let envBad = 0, envN = 0;
if (fs.existsSync(envFile)) {
  const V = window.PungVisuals, near = (a, b) => Math.abs(a - b) < 1e-6;
  for (const c of JSON.parse(fs.readFileSync(envFile, "utf8"))) {
    envN++;
    const e = V.envShapeOf(c.keys, (k) => (k in c.frac ? c.frac[k] : null), (k) => c.min[k] ?? 0, c.touched);
    const why = [];
    const g = c.shape;
    if (e.Segs.length !== g.Segs.length) why.push(`segs ${e.Segs.length} vs ${g.Segs.length}`);
    else e.Segs.forEach((s, i) => {
      const o = g.Segs[i];
      if (s.Label !== o.Label || !near(s.W, o.W) || !near(s.Level, o.Level) || s.Plateau !== o.Plateau || s.Release !== o.Release) why.push(`seg ${i}: ${JSON.stringify(s)} vs ${JSON.stringify(o)}`);
    });
    ["Start", "Signed", "Rates", "Known", "Still", "Hot", "Corner"].forEach((f) => { if (typeof e[f] === "number" ? !near(e[f], g[f]) : e[f] !== g[f]) why.push(`${f} ${e[f]} vs ${g[f]}`); });
    const L = V.layout(e, 10, 470, 12, 82);
    L.pts.forEach((p, i) => { const o = c.pts[i]; if (!o || !near(p.x, o.X) || !near(p.y, o.Y)) why.push(`pt ${i}`); });
    c.at.forEach((a) => {
      const p = V.envAt([a.age, a.off, 0].concat(c.t), 0, e);
      if (!!p.done !== a.done || (!a.done && (p.seg !== a.seg || !near(p.prog, a.prog) || !near(p.level, a.level)))) why.push(`at ${a.age}/${a.off}: ${JSON.stringify(p)} vs ${JSON.stringify(a)}`);
    });
    if (why.length) { envBad++; if (envBad < 10) console.log("ENV DIFF", c.name, c.touched, why.slice(0, 4).join("; ")); }
  }
}
console.log(`${envN} envelopes, ${envBad} differ`);
bad += envBad;
// shared helpers
const kinds = ["LP 24 dB","LP12","Analog 4P","BandStop","HP+LP","N 12 dB","Comb","Off","SV-LP","LP Legacy Ladder"];
console.log(kinds.map((k) => k + "=" + window.PungVisuals.filterKind(k).join("")).join(" "));
console.log(`${n} pages, ${bad} differ`);
process.exit(bad ? 1 : 0);
