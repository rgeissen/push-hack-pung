// The big logo of the front page: the dot starts in the G, rides each letter and hops to the next, and
// comes to rest in its place on the P's bowl (the logo's own idea: the dot that rides, site/brand/make.py).
// There the P is a controller: the dot turns down the bowl and back up to where it rests, as a hand turns
// an encoder and lets it come back (data-twist on the logo; without it the dot lands, gives and rests).
// Without this script, or where motion is turned down, the logo stands as it is drawn: the dot at rest.
function PungRide(svg) {
  const UX = 524.1, S = 11.9304, MX = -187.9, MY = -44.7;
  const m = (x, y) => [x * S + MX, y * S + MY];          // the mark's own coordinates
  const REST = (svg.getAttribute("data-rest") || "372.8 99.7").split(" ").map(Number);
  // the way, right to left (the logo's units; a letter's x plus UX)
  const gx = (x) => UX + x;
  const d = [
    `M ${gx(1960)} 367`, `H ${gx(2190)}`,                               // G: along its bar
    `V 500`, `C ${gx(2190)} 600 ${gx(2080)} 653 ${gx(1911)} 653`,       // down its stem, round the bottom
    `C ${gx(1740)} 653 ${gx(1633)} 540 ${gx(1633)} 343`,                // up its left side
    `C ${gx(1633)} 40 ${gx(1560)} -170 ${gx(1480)} -170`,               // off, over the gap
    `C ${gx(1400)} -170 ${gx(1360)} -80 ${gx(1360)} 40`,                // onto the N's right stem
    `V 600`, `Q ${gx(1360)} 650 ${gx(1325)} 608`,                       // down it, and round its foot
    `L ${gx(915)} 78`,                                                  // up the diagonal
    `C ${gx(840)} -20 ${gx(770)} -170 ${gx(690)} -170`,                 // off its top, over the gap
    `C ${gx(630)} -170 ${gx(596.5)} -80 ${gx(596.5)} 40`,               // onto the U's right stem
    `V 430`, `C ${gx(596.5)} 590 ${gx(500)} 653 ${gx(363)} 653`,        // down, round the bowl
    `C ${gx(226)} 653 ${gx(133.5)} 590 ${gx(133.5)} 430`, `V 60`,       // and up its left stem
    `C ${gx(133.5)} -150 ${REST[0] + 150} -220 ${REST[0] + 60} -120`,   // off, over to the P
    `Q ${REST[0] + 10} -40 ${REST[0]} ${REST[1]}`,                      // and down into its place
  ].join(" ");
  const way = svg.querySelector("#way"), dot = svg.querySelector("#dot"), hole = svg.querySelector("#hole");
  way.setAttribute("d", d);
  const L = way.getTotalLength();
  // time along the way: a step of the way takes its length over the speed at that height
  const N = Math.ceil(L / 6), T = new Float64Array(N + 1), P = new Array(N + 1);
  const TOP = -170, V0 = 620, G = 6200;                    // units/s at the top of a hop; the pull
  let t = 0;
  for (let i = 0; i <= N; i++) {
    const p = way.getPointAtLength((L * i) / N);
    P[i] = p;
    if (i) {
      const y = (P[i - 1].y + p.y) / 2, s = (L * (i - 1)) / N;
      let v = Math.sqrt(V0 * V0 + 2 * G * Math.max(0, y - TOP));
      v *= Math.min(1, 0.25 + s / 360);                    // it sets off gently
      t += L / N / v;
    }
    T[i] = t;
  }
  // (the twist is played where the logo asks for it, data-twist; without, the dot lands, gives and rests)
  const twist = svg.hasAttribute("data-twist");
  const RUN = t, IN = 0.35, TWIST = twist ? 1.55 : 0.55, duration = IN + RUN + TWIST;
  // on the P: the bowl is the dot's way (a fraction of it; it rests at REST_AT)
  const bowlWay = svg.querySelector("#pride");
  const LB = bowlWay.getTotalLength(), REST_AT = 0.345;
  const inOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const out = (u) => 1 - Math.pow(1 - u, 3);
  // in seconds after the dot has landed: [when, where on the bowl, how it gets there]
  const TURN = twist
    ? [[0, REST_AT], [0.6, 0.9, out], [0.74, 0.9, inOut], [1.5, REST_AT, inOut], [TWIST, REST_AT, inOut]]   // down the bowl with what it landed with, and back up
    : [[0, REST_AT], [0.2, 0.41, inOut], [0.42, REST_AT, inOut], [TWIST, REST_AT, inOut]];                  // it lands, and gives
  const turned = (s) => {
    for (let i = 1; i < TURN.length; i++) {
      if (s <= TURN[i][0]) {
        const [t0, f0] = TURN[i - 1], [t1, f1, how] = TURN[i];
        return f0 + (f1 - f0) * how((s - t0) / Math.max(1e-9, t1 - t0));
      }
    }
    return REST_AT;
  };
  function at(time) {
    let x, y, r = 65.6, gap = 97.8, k = 1;
    if (time <= IN) {                                      // it comes to be, where it starts
      k = Math.max(0, time / IN); k = 1 - Math.pow(1 - k, 3);
      x = P[0].x; y = P[0].y;
    } else if (time < IN + RUN) {
      const tt = time - IN;
      let lo = 0, hi = N;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= tt) lo = mid; else hi = mid; }
      const q = (tt - T[lo]) / Math.max(1e-9, T[hi] - T[lo]);
      x = P[lo].x + (P[hi].x - P[lo].x) * q; y = P[lo].y + (P[hi].y - P[lo].y) * q;
    } else if (time < duration) {
      const p = bowlWay.getPointAtLength(LB * turned(time - IN - RUN));
      [x, y] = m(p.x, p.y);
    } else {
      [x, y] = REST;
    }
    dot.setAttribute("cx", x.toFixed(1)); dot.setAttribute("cy", y.toFixed(1)); dot.setAttribute("r", (r * k).toFixed(1));
    hole.setAttribute("cx", x.toFixed(1)); hole.setAttribute("cy", y.toFixed(1)); hole.setAttribute("r", (gap * k).toFixed(1));
  }
  let raf = 0;
  function play(from) {
    cancelAnimationFrame(raf);
    const t0 = performance.now() - (from || 0) * 1000;
    const step = (now) => { const s = (now - t0) / 1000; at(Math.min(s, duration)); if (s < duration) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  return { at, play, duration, landing: IN + RUN };
}

(function () {
  const svg = document.querySelector(".biglogo svg");
  if (!svg) return;
  const quiet = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ride = PungRide(svg);
  const go = () => { if (!quiet.matches) ride.play(); };
  svg.pungRide = ride;
  // once as the page opens (when it is seen), and again on a press. This script stands right after the
  // logo in the page, so the dot is taken off the P before the logo is first painted.
  if (!quiet.matches) {
    ride.at(0);
    const start = () => setTimeout(go, 450);
    if (document.visibilityState === "visible") start();
    else document.addEventListener("visibilitychange", function once() { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", once); start(); } });
  }
  svg.addEventListener("click", go);
  // the bar's logo is the way home: on the front page itself that is the top of the page (the owner,
  // 2026-11-27; the link alone loaded the page again and left it where it was scrolled to)
  const home = document.querySelector(".topbar .mark");
  if (home) home.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;   // (a new tab or window: the link's)
    e.preventDefault();
    scrollTo({ top: 0, behavior: quiet.matches ? "auto" : "smooth" });
  });
  // scrolling settles on a section's start, just under the bar, and each section has the screen to itself:
  // the stylesheet needs the bar's height (two rows on a phone) and the foot's (the last section leaves it room)
  const bar = document.querySelector(".topbar"), root = document.documentElement;
  const sizes = () => {
    const b = bar ? Math.round(bar.getBoundingClientRect().height) : 54;
    const foot = document.querySelector("footer.sf");   // (it comes after this script in the page: looked for each time)
    root.style.scrollPaddingTop = b + "px";
    root.style.setProperty("--bar", b + "px");
    if (foot) root.style.setProperty("--foot", Math.round(foot.getBoundingClientRect().height) + "px");
  };
  sizes(); addEventListener("resize", sizes); addEventListener("load", sizes); addEventListener("DOMContentLoaded", sizes);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizes);
})();
