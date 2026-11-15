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
// shared helpers
const kinds = ["LP 24 dB","LP12","Analog 4P","BandStop","HP+LP","N 12 dB","Comb","Off","SV-LP","LP Legacy Ladder"];
console.log(kinds.map((k) => k + "=" + window.PungVisuals.filterKind(k).join("")).join(" "));
console.log(`${n} pages, ${bad} differ`);
process.exit(bad ? 1 : 0);
