// The big logo of the front page: the dot starts in the G, rides each letter and hops to the next, and
// comes to rest in its place on the P's bowl (the logo's own idea: the dot that rides, site/brand/make.py).
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
  const RUN = t, IN = 0.35, SETTLE = 0.7, duration = IN + RUN + SETTLE;
  // the bowl, for the dot to settle on: a little way on, back, and still
  const bowl = (u) => {                                    // the bowl's curve near its shoulder (0.25 = rest)
    const a = m(36, 8), b = m(55.5, 8), c = m(55.5, 34), e = m(36, 34), w = 1 - u;
    return [w * w * w * a[0] + 3 * w * w * u * b[0] + 3 * w * u * u * c[0] + u * u * u * e[0],
            w * w * w * a[1] + 3 * w * w * u * b[1] + 3 * w * u * u * c[1] + u * u * u * e[1]];
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
      const f = (tt - T[lo]) / Math.max(1e-9, T[hi] - T[lo]);
      x = P[lo].x + (P[hi].x - P[lo].x) * f; y = P[lo].y + (P[hi].y - P[lo].y) * f;
    } else {
      const u = Math.min(1, (time - IN - RUN) / SETTLE);
      const swing = 0.16 * Math.exp(-4.2 * u) * Math.sin(u * Math.PI * 2.5);
      [x, y] = bowl(0.25 + swing);
      if (u >= 1) [x, y] = REST;
    }
    dot.setAttribute("cx", x.toFixed(1)); dot.setAttribute("cy", y.toFixed(1)); dot.setAttribute("r", (r * k).toFixed(1));
    hole.setAttribute("cx", x.toFixed(1)); hole.setAttribute("cy", y.toFixed(1)); hole.setAttribute("r", (gap * k).toFixed(1));
  }
  let raf = 0;
  function play() {
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const step = (now) => { const s = (now - t0) / 1000; at(Math.min(s, duration)); if (s < duration) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  return { at, play, duration, run: RUN };
}

(function () {
  const svg = document.querySelector(".biglogo svg");
  if (!svg) return;
  const quiet = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ride = PungRide(svg);
  const go = () => { if (!quiet.matches) ride.play(); };
  // once as the page opens (when it is seen), and again on a press. This script stands right after the
  // logo in the page, so the dot is taken off the P before the logo is first painted.
  if (!quiet.matches) {
    ride.at(0);
    const start = () => setTimeout(go, 450);
    if (document.visibilityState === "visible") start();
    else document.addEventListener("visibilitychange", function once() { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", once); start(); } });
  }
  svg.addEventListener("click", go);
  // the tagline under it, as wide as the logo: its size from the column's width
  const fit = () => document.querySelectorAll("[data-fit]").forEach((el) => {
    const box = el.parentElement.clientWidth, s = el.firstElementChild;
    if (!box || !s) return;
    el.style.fontSize = "100px";
    const w = s.getBoundingClientRect().width;
    el.style.fontSize = w ? (100 * box / w).toFixed(2) + "px" : "";
  });
  addEventListener("resize", fit);
  addEventListener("DOMContentLoaded", fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  // the bar's small logo is shown once the large one has scrolled away
  const bar = document.querySelector(".topbar");
  if (bar && "IntersectionObserver" in window) {
    new IntersectionObserver((es) => bar.classList.toggle("over-logo", es[0].isIntersecting), { rootMargin: "-56px 0px 0px 0px" }).observe(svg);
  }
})();
