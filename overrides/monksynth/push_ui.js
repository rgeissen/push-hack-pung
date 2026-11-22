// MonkSynth on the Push: a FOF vocal synth with twelve singing characters,
// after Delay Lama. What it is, is a face that sings, so the panel is that:
//
// - the character's portrait, drawn from the module's own rig (canvas.js:
//   every head, prop and eye is its geometry, ported verbatim below and
//   inked as line art instead of 1-bit pixels), its mouth shaped by the
//   Vowel through the character's five anchor apertures (OO OH AH EH EE)
//   and opening wider as the voice gets louder (the output's level);
// - the twelve characters, the one singing lit;
// - the voice as the engine makes it (voice.c): three formants at the
//   vowel's spline position, scaled by Head Size (0.75 baritone .. 1.25),
//   the breath's two noise bands at its level, on a log frequency axis,
//   the vowel's place between OO and EE under them;
// - the envelope (Pung's, on the engine's own seconds) and the encoder row
//   as saffron knobs on the robe's maroon.

var GROUND = "#1a1011", ROBE = "#4a1519", ROBE_DK = "#2c0d10", SAFFRON = "#f5a623", SAFF_DIM = "#a86d17";
var INK = "#f3e6cf", INK_DIM = "#b39d86", RULE = "#5a2a2c", HALO = "#3b2414", MOUTH = "#7d1622";

function known(v, k) { return v[k] && v[k].known; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function num(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function disp(v, k) { return known(v, k) ? String(v[k].display || v[k].value) : "--"; }
function up(s) { return String(s).toUpperCase(); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : (x === x ? x : 0); }

// ---- the faces: the module's rig (canvas.js, MonkSynth), drawn through g -----------------
//
// canvas.js draws onto a 1-bit panel through fillRect and line; here the same
// calls go to the Push in ink (1) and the portrait's ground (0), with lines
// and outlines as smooth strokes. ellipse, circleSolid, uline and quad are
// redefined after the table for that (strokes instead of pixel runs).

var LW = 2, FACE_BG = HALO, FACE_INK = INK;
function unitBox(g, bx, by, bw, bh, crop, xs) {
  var cw = crop[2] - crop[0], ch = crop[3] - crop[1], sx = xs > 0 ? xs : 1;
  var s = Math.min(bw / (cw * sx), bh / ch);
  var ox = bx + (bw - cw * s * sx) / 2 - crop[0] * s * sx, oy = by + (bh - ch * s) / 2 - crop[1] * s;
  var col = function (c) { return c ? FACE_INK : FACE_BG; };
  var ctx = {
    width: bw, height: bh,
    fillRect: function (x, y, w, h, c) { g.fill(x, y, w, h, col(c)); },
    line: function (x0, y0, x1, y1, c) { g.line(x0, y0, x1, y1, LW, col(c)); },
    poly: function (pts, c) { g.poly(pts, LW, col(c)); },
    drawCircle: function (cx, cy, r, c) { g.arc(cx, cy, r, 0, Math.PI * 2, LW, col(c)); },
    fillCircle: function (cx, cy, r, c) { g.dot(cx, cy, r, col(c)); }
  };
  return {
    ctx: ctx, s: s,
    x: function (fx) { return ox + fx * s * sx; },
    y: function (fy) { return oy + fy * s; },
    n: function (f) { var v = Math.round(f * s); return v < 1 ? 1 : v; }
  };
}

// ---- canvas.js (schwung-monksynth src/ui/canvas.js), from ellipseSolid to the end of FACES, verbatim ----
function ellipseSolid(u, cx, cy, rw, rh) {
    ellipse(u, cx, cy, rw, rh, true, 0);
    ellipse(u, cx, cy, rw, rh, false, 1);
}

/* An opaque disc, for a head sitting in front of ears, hair or a hat. */
function circleSolid(u, fcx, fcy, fr) {
    const cx = Math.round(u.x(fcx)), cy = Math.round(u.y(fcy));
    const r = Math.round(fr * u.s);
    u.ctx.fillCircle
        ? u.ctx.fillCircle(cx, cy, r, 0)
        : ellipse(u, fcx, fcy, fr, fr, true, 0);
    u.ctx.drawCircle(cx, cy, r, 1);
}

/* A straight line in unit coords. */
function uline(u, x0, y0, x1, y1, color) {
    u.ctx.line(Math.round(u.x(x0)), Math.round(u.y(y0)),
               Math.round(u.x(x1)), Math.round(u.y(y1)),
               color === undefined ? 1 : color);
}

/* A filled triangle — ears, horns, mohawk spikes, the pizza slice. */
function tri(u, ax, ay, bx, by, cx2, cy2, color) {
    const c = color === undefined ? 1 : color;
    const px = [u.x(ax), u.x(bx), u.x(cx2)], py = [u.y(ay), u.y(by), u.y(cy2)];
    const y0 = Math.round(Math.min(py[0], py[1], py[2]));
    const y1 = Math.round(Math.max(py[0], py[1], py[2]));
    for (let y = y0; y <= y1; y++) {
        let lo = Infinity, hi = -Infinity;
        for (let e = 0; e < 3; e++) {
            const f = (e + 1) % 3;
            const ya = py[e], yb = py[f];
            if (ya === yb) continue;
            const t = (y + 0.5 - ya) / (yb - ya);
            if (t < 0 || t > 1) continue;
            const x = px[e] + (px[f] - px[e]) * t;
            if (x < lo) lo = x;
            if (x > hi) hi = x;
        }
        if (hi < lo) continue;
        const xa = Math.round(lo), xb = Math.round(hi);
        u.ctx.fillRect(xa, y, Math.max(1, xb - xa), 1, c);
    }
}

/* An unfilled triangle for cues that become heavy white wedges at 1 bit. */
function triOutline(u, ax, ay, bx, by, cx2, cy2, color) {
    const c = color === undefined ? 1 : color;
    uline(u, ax, ay, bx, by, c);
    uline(u, bx, by, cx2, cy2, c);
    uline(u, cx2, cy2, ax, ay, c);
}

/* An opaque triangular foreground part: clear what is behind, then outline. */
function triSolid(u, ax, ay, bx, by, cx2, cy2) {
    tri(u, ax, ay, bx, by, cx2, cy2, 0);
    triOutline(u, ax, ay, bx, by, cx2, cy2, 1);
}

/*
 * A quadratic curve, as a polyline.
 *
 * The Swift art is mostly addQuadCurve, and at these sizes a curve is a
 * handful of pixels — so the segment count is derived from how many pixels the
 * curve actually spans rather than being a constant. A fixed count either
 * wastes bindings on a 6px cell feature or visibly facets a 64px one.
 */
function quad(u, x0, y0, cx, cy, x1, y1, color) {
    const span = Math.abs(u.x(x1) - u.x(x0)) + Math.abs(u.y(y1) - u.y(y0));
    const n = Math.max(2, Math.min(14, Math.round(span / 2)));
    let px = u.x(x0), py = u.y(y0);
    for (let i = 1; i <= n; i++) {
        const t = i / n, m = 1 - t;
        const qx = m * m * u.x(x0) + 2 * m * t * u.x(cx) + t * t * u.x(x1);
        const qy = m * m * u.y(y0) + 2 * m * t * u.y(cy) + t * t * u.y(y1);
        u.ctx.line(Math.round(px), Math.round(py), Math.round(qx), Math.round(qy),
                   color === undefined ? 1 : color);
        px = qx; py = qy;
    }
}

/* ------------------------------------------------------------- eye styles --
 *
 * Six shared styles, because the twelve characters only use six. Each takes
 * the unit mapper, the character's own geometry and whether the eye is shut.
 */

/* A stroked arc bowing DOWNWARD — monk, old man, Officer Eeoo. */
function arcEyes(u, cxs, fy, hw, depth, shut) {
    const d = shut ? depth[1] : depth[0];
    for (const cx of cxs) quad(u, cx - hw, fy, cx, fy + d, cx + hw, fy, 1);
}

/*
 * Sclera + pupil — cow, dog, little girl, unicorn, pizza.
 *
 * AN EYE NEEDS ROOM TO BE A RING WITH A DOT IN IT. At the rig's own radius the
 * sclera came out about four pixels across and the pupil two, and the two
 * merged into one solid blob -- every one of these characters ended up with
 * smudges instead of eyes. So the sclera has a pixel floor, and the pupil is
 * held to a single pixel whenever the sclera is small enough that anything more
 * would fill it.
 *
 * Both are floors, not scalings: at card and page size they bite, and on a big
 * surface the rig's own proportions are already right and nothing changes.
 */
function roundEyes(u, cxs, fy, r, pupil, shut) {
    const MIN_SCLERA_PX = 5;
    const rr = Math.max(r, (MIN_SCLERA_PX * 0.5) / u.s);
    /* A pupil bigger than this closes the ring back up. */
    const pr = Math.min(rr * pupil, Math.max((0.5) / u.s, rr - 1.2 / u.s));
    for (const cx of cxs) {
        if (shut) { uline(u, cx - rr, fy, cx + rr, fy, 1); continue; }
        ellipse(u, cx, fy, rr, rr, false, 1);
        ellipse(u, cx, fy, pr, pr, true, 1);
    }
}

/* Solid, no sclera and no pupil — the ghost's hollow sockets. */
function solidEyes(u, cxs, fy, rw, rh, shut) {
    for (const cx of cxs) {
        if (shut) uline(u, cx - rw, fy, cx + rw, fy, 1);
        else ellipse(u, cx, fy, rw, rh, true, 1);
    }
}

/* Filled almond with a vertical slit — the cat, and only the cat. */
function almondEyes(u, cxs, fy, hw, hh, shut) {
    for (const cx of cxs) {
        if (shut) { uline(u, cx - hw * 0.6, fy, cx + hw * 0.6, fy, 1); continue; }
        ellipse(u, cx, fy, hw, hh, true, 1);
        /* The slit is drawn UNLIT out of the filled almond — a lit slit on a
         * lit eye would be invisible. */
        ellipse(u, cx, fy, hw * 0.22, hh * 0.8, true, 0);
    }
}

/* A straight angular eyeliner flick, mirrored so both sweep away from the
 * nose — the punk. `outward` is what does the mirroring in the Swift. */
function flickEyes(u, cxs, fy, hw, flick, shut) {
    const f = shut ? flick[1] : flick[0];
    for (let i = 0; i < cxs.length; i++) {
        const out = i === 0 ? -1 : 1;
        uline(u, cxs[i] - hw * out, fy + f * 0.25, cxs[i] + hw * out, fy - f, 1);
    }
}

/* ------------------------------------------------------------ the twelve ---
 *
 * `crop` is the head-and-props box the small surfaces show; `cropFull` keeps
 * the complete rig available; `portrait` composes the fullscreen view. Most
 * portraits use a head-and-shoulders crop so the face survives at 128x64.
 * Fish, Ghost and Pizza keep the full figure because their silhouette is their
 * identity. A single crop either shrinks human faces or amputates those three.
 *
 * `d` is a DETAIL BUDGET derived from the frame size by faceDetail() below:
 * 0 for a knob cell, 1 for a card, 2 for the panel. A feature that would land
 * on fewer than a couple of pixels is skipped at low detail rather than drawn
 * as noise — but never the feature that IS the character (the mohawk, the
 * horn, the ears), which is why the budget is per-feature and not a scale.
 */
const FACES = [
{
    id: "monk", name: "Monk",
    anchors: [[0.16,0.26],[0.26,0.30],[0.34,0.22],[0.40,0.13],[0.44,0.07]],
    mc: [0.5,0.394], mbf: 0.27,
    crop: [0.29,0.09,0.71,0.51], picker: [0.25,0.04,0.75,0.57], cropFull: [0.02,0.06,0.98,1.00],
    portrait: [0.16,0.05,0.84,0.76],
    head(u, d) {
        /* Back to front: robe and neck first, then ears, then the opaque head.
         * The head clears the neck where it passes behind the jaw. */
        if (d >= 2) {
            uline(u, 0.44, 0.43, 0.43, 0.50); uline(u, 0.56, 0.43, 0.57, 0.50);
            quad(u, 0.20, 0.58, 0.27, 0.50, 0.43, 0.50);
            quad(u, 0.57, 0.50, 0.73, 0.50, 0.80, 0.58);
            quad(u, 0.80, 0.58, 0.90, 0.66, 0.92, 0.78);
            quad(u, 0.20, 0.58, 0.10, 0.66, 0.08, 0.78);
            uline(u, 0.92, 0.78, 0.90, 0.99); uline(u, 0.08, 0.78, 0.10, 0.99);
            quad(u, 0.10, 0.99, 0.50, 1.02, 0.90, 0.99);
        }
        /* Ears first, so the head circle overlaps their inner half. Snap the
         * pair around the SAME integer centre: independently rounded ellipse
         * centres left one visible crescent a pixel higher on the panel. */
        if (d >= 1) {
            const mid = 0.5 + (Math.round(u.x(0.5)) - u.x(0.5)) / u.s;
            const earY = 0.318 + (Math.round(u.y(0.318)) - u.y(0.318)) / u.s;
            const earDx = Math.round(0.16 * u.s) / u.s;
            for (const side of [-1, 1])
                ellipse(u, mid + side * earDx, earY, 0.0225, 0.038, false, 1);
        }
        circleSolid(u, 0.5, 0.30, 0.17);
        if (d >= 2) {
            /* Two parallel folds make this a sash, not a stray diagonal. */
            quad(u, 0.57, 0.50, 0.73, 0.62, 0.91, 0.76);
            quad(u, 0.61, 0.48, 0.77, 0.59, 0.94, 0.71);
        }
    },
    eyes(u, shut, d) { arcEyes(u, [0.415, 0.585], 0.296, 0.05, [0.027, 0.011], shut); },
},
{
    id: "fish", name: "Fish",
    /* A PROFILE, facing right: one eye, and a mouth off-axis at fx 0.80. */
    /* Exaggerated at the five phoneme anchors because this side-profile mouth
     * has only a handful of device pixels: OO is tall/round, EE broad/flat. */
    anchors: [[0.24,0.52],[0.36,0.60],[0.50,0.64],[0.62,0.34],[0.72,0.16]],
    mc: [0.80,0.56], mbf: 0.20, mouthBottom: 0.670,
    pickerXScale: 1.45, mouthWidthGain: 1.9,
    /* The whole fish, not a head crop: it is a profile creature and the tail is
     * half of what makes it a fish. The head-only box cut it off, which reads
     * as a clipped drawing rather than as a close-up. */
    crop: [0.00,0.14,1.00,0.92], picker: [-0.03,0.00,1.03,0.99], cropFull: [0.00,0.02,1.00,0.98],
    portrait: [0.00,0.02,1.00,0.98],
    head(u, d) {
        /* Tail behind everything. */
        if (d >= 1) {
            tri(u, 0.24, 0.50, 0.02, 0.26, 0.11, 0.50);
            tri(u, 0.24, 0.50, 0.02, 0.76, 0.11, 0.50);
        }
        /* Body contour, then opaque foreground fins. */
        quad(u, 0.16, 0.50, 0.50, 0.20, 0.88, 0.56);      /* back */
        quad(u, 0.88, 0.56, 0.48, 0.90, 0.16, 0.50);      /* belly */
        if (d >= 2) {
            /* The dorsal base follows the back curve at both ends; its old
             * left endpoint sat above the body and made the oversized fin
             * float. The pectoral base likewise sits on the belly contour. */
            /* Opaque interior plus two outer edges: omit the third edge so the
             * fin opens directly into the body instead of gaining a baseline. */
            tri(u, 0.405, 0.345, 0.495, 0.155, 0.585, 0.315, 0);
            uline(u, 0.405, 0.345, 0.495, 0.155);
            uline(u, 0.495, 0.155, 0.585, 0.315);
            triSolid(u, 0.390, 0.700, 0.430, 0.810, 0.520, 0.720); /* pectoral */

            /* Angler stalk and lure belong at the FRONT of a right-facing
             * fish, and are drawn last so both occlude the body contour. */
            quad(u, 0.65, 0.27, 0.78, 0.04, 0.90, 0.16);
            quad(u, 0.90, 0.16, 0.98, 0.22, 0.94, 0.31);
            ellipseSolid(u, 0.94, 0.32, 0.035, 0.035);
        }
        /* The puckered lip ring frames the aperture, so it is never dropped —
         * without it the mouth reads as a hole in a blob. */
        ellipse(u, 0.80, 0.56, 0.145, 0.115, false, 1);
    },
    eyes(u, shut, d) {
        if (shut) { uline(u, 0.525, 0.38, 0.675, 0.38, 1); return; }
        /* White eyeball over the body, with a black pupil: genuinely opaque
         * rather than another transparent ring. */
        ellipse(u, 0.60, 0.38, 0.075, 0.075, true, 1);
        ellipse(u, 0.60, 0.38, 0.026, 0.026, true, 0);
    },
},
{
    id: "unicorn", name: "Unicorn",
    anchors: [[0.20,0.10],[0.34,0.16],[0.46,0.20],[0.54,0.15],[0.58,0.09]],
    mc: [0.5,0.60], mbf: 0.26, pickerXScale: 1.20,
    crop: [0.22,-0.08,0.78,0.72], picker: [0.16,-0.15,0.84,0.76], cropFull: [0.02,-0.10,0.98,1.00],
    portrait: [0.12,-0.10,0.88,0.72],
    head(u, d) {
        if (d >= 2) {
            /* Torso only. The mane is intentionally omitted: neither loose
             * strands nor a solid slab read cleanly on this display. */
            uline(u, 0.40, 0.457, 0.30, 0.55); uline(u, 0.60, 0.457, 0.70, 0.55);
            uline(u, 0.30, 0.55, 0.14, 0.99); uline(u, 0.70, 0.55, 0.86, 0.99);
        }
        /* Ears and horn BEFORE the head, same reason as the monk's ears. The
         * horn is the character; it is drawn at every detail level. */
        /*
         * THE HORN MUST NOT LOOK LIKE A THIRD EAR. At page size the original
         * geometry gave three triangles of similar height and width, which read
         * as a crown of spikes on something alien rather than as a unicorn. The
         * horn is narrower and taller than both ears; the ears are shorter and
         * set wider, so the silhouette says horse-with-a-horn at a glance.
         */
        for (const sd of [-1, 1]) {
            const cx = 0.5 + sd * 0.150;
            tri(u, cx - 0.055, 0.205, cx + 0.055, 0.205, cx + sd * 0.02, 0.045);
        }
        tri(u, 0.474, 0.170, 0.526, 0.170, 0.500, -0.115);
        circleSolid(u, 0.5, 0.30, 0.185);
        /* The filled ears are behind the opaque head, but each gets a short
         * foreground root so both joins survive integer rasterisation. */
        uline(u, 0.35, 0.18, 0.37, 0.18);
        uline(u, 0.65, 0.18, 0.63, 0.18);
        ellipseSolid(u, 0.5, 0.500, 0.120, 0.200);       /* long horse snout */
        if (d >= 1) for (const nx of [0.468, 0.532]) ellipse(u, nx, 0.520, 0.011, 0.011, true, 1);
    },
    eyes(u, shut, d) { solidEyes(u, [0.425, 0.575], 0.29, 0.025, 0.030, shut); },
},
{
    id: "girl", name: "Little Girl",
    /* The head-to-body ratio IS the identity: r 0.115 against the monk's 0.17. */
    anchors: [[0.10,0.16],[0.16,0.20],[0.22,0.15],[0.26,0.10],[0.30,0.06]],
    mc: [0.5,0.255], mbf: 0.22,
    crop: [0.23,0.03,0.77,0.34], picker: [0.18,-0.02,0.82,0.39], cropFull: [0.02,0.02,0.98,1.00],
    portrait: [0.18,0.00,0.82,0.66],
    head(u, d) {
        if (d >= 2) {
            uline(u, 0.455, 0.298, 0.455, 0.34); uline(u, 0.545, 0.298, 0.545, 0.34);
            quad(u, 0.455, 0.34, 0.22, 0.62, 0.08, 0.99);
            quad(u, 0.545, 0.34, 0.78, 0.62, 0.92, 0.99);
            uline(u, 0.08, 0.99, 0.92, 0.99);
            uline(u, 0.10, 0.92, 0.90, 0.92);
        }
        /*
         * PIGTAIL MASSES FIRST, THEN THE HEAD.
         *
         * Hollow circles read as mouse ears at this resolution. Compact filled
         * teardrops create deliberate pixel clusters; the opaque head trims
         * their inner edges into a clear behind-the-head layer.
         */
        for (const cx of [0.35, 0.65])
            ellipse(u, cx, 0.245, 0.075, 0.115, true, 1);
        circleSolid(u, 0.5, 0.20, 0.115);
        if (d >= 1) for (const cx of [0.35, 0.65]) {
            ellipse(u, 0.5 + (cx - 0.5) * 0.83, 0.215,
                    0.018, 0.018, true, 1);               /* hair ties */
            uline(u, cx - 0.045, 0.27, cx + 0.045, 0.27, 0);
        }
        /* Filled bangs match the pigtail masses: a round cap with three small
         * fringe points, not loose wires or horn-like peaks. */
        ellipse(u, 0.5, 0.112, 0.108, 0.072, true, 1);
        for (const cx of [0.435, 0.5, 0.565])
            tri(u, cx - 0.030, 0.130, cx + 0.030, 0.130, cx, 0.166);
    },
    eyes(u, shut, d) { arcEyes(u, [0.445, 0.555], 0.180, 0.026, [0.016,0.006], shut); },
},
{
    id: "oldman", name: "Old Man",
    anchors: [[0.14,0.16],[0.22,0.20],[0.30,0.15],[0.36,0.10],[0.40,0.06]],
    mc: [0.5,0.40], mbf: 0.24,
    crop: [0.25,0.10,0.75,0.68], picker: [0.20,0.05,0.80,0.70], cropFull: [0.02,0.08,0.98,1.00],
    portrait: [0.16,0.06,0.84,0.74],
    head(u, d) {
        if (d >= 2) {
            quad(u, 0.28, 0.52, 0.18, 0.70, 0.06, 0.99);
            quad(u, 0.72, 0.52, 0.82, 0.70, 0.94, 0.99);
            /* Close the jacket's top edge into the beard instead of leaving
             * two shoulder strokes floating beside it. */
            quad(u, 0.28, 0.52, 0.34, 0.53, 0.390, 0.585);
            quad(u, 0.610, 0.585, 0.66, 0.53, 0.72, 0.52);
            uline(u, 0.06, 0.99, 0.94, 0.99);
            uline(u, 0.5, 0.60, 0.5, 0.99);
        }
        if (d >= 1) for (const cx of [0.3383, 0.6617]) ellipse(u, cx, 0.30, 0.021, 0.035, false, 1);
        circleSolid(u, 0.5, 0.30, 0.165);
        /* Side tufts, which bulge PAST the silhouette — that overhang is what
         * makes the bald crown read as bald rather than as a plain circle. */
        for (const s of [-1, 1]) {
            const bx = 0.5 + s * 0.1617, tx = 0.5 + s * 0.1452;
            quad(u, bx, 0.308, 0.5 + s * 0.2228, 0.280, tx, 0.237);
        }
        /* The beard is an opaque foreground part: clear its interior before
         * outlining it so the cardigan and neck cannot show through. */
        tri(u, 0.3383, 0.308, 0.6617, 0.308, 0.5, 0.638, 0);
        quad(u, 0.3383, 0.308, 0.3845, 0.614, 0.5, 0.638);
        quad(u, 0.5, 0.638, 0.6155, 0.614, 0.6617, 0.308);
        if (d >= 2) for (const w of [[0.201,0.0825],[0.181,0.0693],[0.160,0.0462]])
            quad(u, 0.5 - w[1], w[0], 0.5, w[0] - 0.012, 0.5 + w[1], w[0]);
    },
    eyes(u, shut, d) {
        /* Wider and set a touch lower than the rig, so the eye is separable
         * from the brow above it. Deep-set eyes at 0.032 half-width were three
         * pixels of arc directly under a four-pixel brow, and the pair read as
         * one dark mass rather than as a face. */
        arcEyes(u, [0.435, 0.565], 0.292, 0.046, [0.018, 0.006], shut);
        /* The heavy brow is always drawn — it is the age cue, not an eye. */
        /* Lifted clear of the eye: at page size the brow and the arc below it
         * merged into a single bar and the old man had no eyes at all. */
        for (const cx of [0.44, 0.56]) quad(u, cx - 0.048, 0.238, cx, 0.210, cx + 0.048, 0.233);
    },
},
{
    id: "cow", name: "Cow",
    anchors: [[0.18,0.08],[0.30,0.14],[0.42,0.20],[0.50,0.13],[0.56,0.07]],
    mc: [0.5,0.60], mbf: 0.34,
    crop: [0.10,-0.02,0.90,0.74], picker: [0.05,-0.07,0.95,0.78], cropFull: [0.02,-0.02,0.98,1.00],
    portrait: [0.08,-0.02,0.92,0.76],
    head(u, d) {
        if (d >= 2) {
            quad(u, 0.22, 0.64, 0.12, 0.80, 0.05, 0.99);
            quad(u, 0.78, 0.64, 0.88, 0.80, 0.95, 0.99);
            quad(u, 0.22, 0.64, 0.31, 0.61, 0.38, 0.62);
            quad(u, 0.62, 0.62, 0.69, 0.61, 0.78, 0.64);
            uline(u, 0.05, 0.99, 0.95, 0.99);
        }
        /* Ears and horns before the head. Both are identity cues, so both
         * survive to detail 0. */
        for (const s of [-1, 1]) {
            const rx = 0.5 + s * 0.1615;
            quad(u, rx, 0.2035, 0.5 + s * 0.30, 0.21, 0.5 + s * 0.3615, 0.285);
            quad(u, 0.5 + s * 0.3615, 0.285, 0.5 + s * 0.30, 0.33, rx, 0.327);
            tri(u, 0.5 + s * 0.0684 - s * 0.012, 0.11, 0.5 + s * 0.0684 + s * 0.012, 0.11,
                   0.5 + s * 0.1254, 0.004);
        }
        circleSolid(u, 0.5, 0.27, 0.19);
        /* The dark patch over one eye, as an outline — a filled patch at 1 bit
         * would swallow the eye it is supposed to sit around. */
        if (d >= 2) {
            /* Kept inside the head boundary; the old x=.30 point escaped the
             * circle and made the patch look like a crack in the silhouette. */
            quad(u, 0.335, 0.20, 0.36, 0.115, 0.455, 0.13);
            quad(u, 0.455, 0.13, 0.475, 0.235, 0.415, 0.325);
            quad(u, 0.415, 0.325, 0.35, 0.30, 0.335, 0.20);
        }
        ellipseSolid(u, 0.5, 0.540, 0.19, 0.15);         /* the big muzzle */
        if (d >= 1) for (const nx of [0.425, 0.575]) ellipse(u, nx, 0.522, 0.018, 0.013, true, 1);
    },
    eyes(u, shut, d) { roundEyes(u, [0.425, 0.575], 0.26, 0.044, 0.62, shut); },
},
{
    id: "dog", name: "Dog",
    /*
     * mbf 0.30 with the widest anchors of any character made an aperture that
     * reached the snout's own outline at EE -- the snout stopped reading as a
     * nose and became a filled disc. 0.21 keeps the mouth comfortably inside it
     * across the whole sweep while staying the biggest mouth in the set, which
     * is right for a dog.
     */
    anchors: [[0.20,0.14],[0.32,0.24],[0.44,0.34],[0.52,0.40],[0.58,0.44]],
    mc: [0.5,0.565], mbf: 0.21,
    crop: [0.26,0.09,0.74,0.70], picker: [0.19,0.04,0.81,0.74], cropFull: [0.02,0.08,0.98,1.00],
    portrait: [0.16,0.06,0.84,0.76],
    head(u, d) {
        if (d >= 2) {
            quad(u, 0.24, 0.62, 0.14, 0.80, 0.06, 0.99);
            quad(u, 0.76, 0.62, 0.86, 0.80, 0.94, 0.99);
            quad(u, 0.24, 0.62, 0.32, 0.60, 0.40, 0.60);
            quad(u, 0.60, 0.60, 0.68, 0.60, 0.76, 0.62);
            uline(u, 0.06, 0.99, 0.94, 0.99);
        }
        /* Filled drooping ears are the dog cue. Their old one-pixel contours
         * were indistinguishable from long hair on the physical display. */
        for (const cx of [0.31, 0.69])
            ellipse(u, cx, 0.42, 0.075, 0.18, true, 1);
        circleSolid(u, 0.5, 0.30, 0.185);
        if (d >= 1) for (const cx of [0.31, 0.69])
            uline(u, cx, 0.34, cx, 0.49, 0);             /* inner ear split */
        ellipseSolid(u, 0.5, 0.522, 0.15, 0.13);                 /* snout */
        ellipse(u, 0.5, 0.522 - 0.13 * 0.28, 0.035, 0.026, true, 1); /* nose */
    },
    eyes(u, shut, d) { roundEyes(u, [0.43, 0.57], 0.28, 0.042, 0.60, shut); },
},
{
    id: "ghost", name: "Ghost",
    /* The original near-circular anchors all rasterised to the same 4px dot.
     * Give the sheet a clear OO-to-EE aspect-ratio change instead. */
    anchors: [[0.22,0.48],[0.32,0.54],[0.44,0.58],[0.56,0.30],[0.66,0.14]],
    mc: [0.5,0.56], mbf: 0.42,
    /* The hem runs to fy 0.94. Cropping at 0.76 kept only the tops of the five
     * scallops, which drew as a row of loose dots under the face -- read on
     * hardware as "ghost is weird", and it was: a ghost with no hem. */
    crop: [0.04,0.02,0.96,0.97], picker: [-0.03,-0.03,1.03,1.04], cropFull: [0.02,0.01,0.98,0.99],
    portrait: [0.02,0.01,0.98,0.99],
    head(u, d) {
        /* One continuous sheet: no head/body split at all. */
        quad(u, 0.5, 0.04, 0.78, 0.02, 0.92, 0.20);
        quad(u, 0.92, 0.20, 0.92, 0.33, 0.92, 0.46);
        uline(u, 0.92, 0.46, 0.92, 0.72);
        uline(u, 0.08, 0.46, 0.08, 0.72);
        quad(u, 0.08, 0.46, 0.08, 0.20, 0.22, 0.02);
        quad(u, 0.22, 0.02, 0.36, 0.02, 0.5, 0.04);
        /* Five scalloped hem lobes. At cell size they collapse to one lit row,
         * which still reads as a hem, so the loop is not gated. */
        const pts = [0.92, 0.76, 0.60, 0.44, 0.28, 0.08];
        const ctl = [0.84, 0.68, 0.52, 0.36, 0.20];
        for (let i = 0; i < 5; i++) quad(u, pts[i], 0.72, ctl[i], 0.94, pts[i + 1], 0.72);
    },
    eyes(u, shut, d) { solidEyes(u, [0.40, 0.60], 0.34, 0.026, 0.034, shut); },
},
{
    id: "firefighter", name: "Officer Eeoo",
    anchors: [[0.16,0.18],[0.26,0.26],[0.36,0.32],[0.44,0.24],[0.48,0.16]],
    mc: [0.5,0.44], mbf: 0.25, mouthBottom: 0.505,
    crop: [0.23,0.09,0.77,0.54], picker: [0.17,0.03,0.83,0.60], cropFull: [0.02,0.08,0.98,1.00],
    portrait: [0.14,0.06,0.86,0.76],
    head(u, d) {
        if (d >= 2) {
            uline(u, 0.425, 0.47, 0.425, 0.54); uline(u, 0.575, 0.47, 0.575, 0.54);
            quad(u, 0.425, 0.54, 0.34, 0.53, 0.24, 0.62);
            quad(u, 0.575, 0.54, 0.66, 0.53, 0.76, 0.62);
            quad(u, 0.24, 0.62, 0.14, 0.80, 0.06, 0.99);
            quad(u, 0.76, 0.62, 0.86, 0.80, 0.94, 0.99);
            uline(u, 0.06, 0.99, 0.94, 0.99);
            uline(u, 0.115, 0.78, 0.885, 0.78); uline(u, 0.10, 0.86, 0.90, 0.86);
        }
        circleSolid(u, 0.5, 0.34, 0.165);
        /* The helmet is the character. Dome then brim, brim last so its flare
         * cuts across the dome the way the real silhouette does. Both opaque,
         * or the head's arc runs straight through the hat. */
        ellipseSolid(u, 0.5, 0.206, 0.175, 0.0809);
        /* ellipse() plots the first crown row as separated edge pixels. Join
         * those edges explicitly into one shallow, continuous helmet crown. */
        quad(u, 0.435, 0.149, 0.5, 0.112, 0.565, 0.149);
        ellipse(u, 0.5, 0.287, 0.223, 0.0297, true, 1);
        if (d >= 1) {
            ellipse(u, 0.5, 0.129, 0.018, 0.018, true, 1);      /* knob */
            uline(u, 0.5, 0.129, 0.5, 0.158);                  /* joined topper */
            uline(u, 0.35, 0.257, 0.35, 0.287);                /* dome to brim */
            uline(u, 0.65, 0.257, 0.65, 0.287);
        }
        if (d >= 2) {
            /* White helmet shield: the previous black outline was literally
             * invisible on the already-cleared dome interior. */
            ellipse(u, 0.5, 0.206, 0.045, 0.030, false, 1);
            uline(u, 0.5, 0.184, 0.5, 0.228);
        }
    },
    eyes(u, shut, d) {
        /* NOTE the fy: 0.34 + 0.01. This is the one character whose eye offset
         * ADDS to the head centre; every other one subtracts. Ported as found. */
        arcEyes(u, [0.435, 0.565], 0.35, 0.048, [0.024, 0.010], shut);
    },
},
{
    id: "punk", name: "Punk",
    anchors: [[0.18,0.12],[0.28,0.10],[0.36,0.08],[0.42,0.14],[0.46,0.20]],
    mc: [0.5,0.42], mbf: 0.24,
    crop: [0.30,-0.05,0.70,0.52], picker: [0.23,-0.10,0.77,0.58], cropFull: [0.02,-0.05,0.98,1.00],
    portrait: [0.19,-0.05,0.81,0.72],
    head(u, d) {
        if (d >= 2) {
            /* The original leather jacket: broad shoulders step up to a flat
             * collar around a constant-width neck instead of floating below. */
            uline(u, 0.418, 0.44, 0.418, 0.50); uline(u, 0.582, 0.44, 0.582, 0.50);
            quad(u, 0.26, 0.56, 0.16, 0.78, 0.06, 0.99);
            uline(u, 0.06, 0.99, 0.94, 0.99);
            quad(u, 0.94, 0.99, 0.84, 0.78, 0.74, 0.56);
            quad(u, 0.74, 0.56, 0.62, 0.50, 0.582, 0.50);
            uline(u, 0.582, 0.50, 0.418, 0.50);
            quad(u, 0.418, 0.50, 0.38, 0.50, 0.26, 0.56);
            /* Studs sit inside the jacket shoulders, never beyond the seams. */
            for (const sx of [0.29, 0.37, 0.63, 0.71])
                tri(u, sx - 0.018, 0.625, sx + 0.018, 0.625, sx, 0.602);
        }
        circleSolid(u, 0.5, 0.335, 0.145);
        /* A narrow, connected crest rather than loose hairs across the whole
         * skull. It is drawn over the scalp so its filled base physically
         * joins the head outline instead of being cleared away behind it. */
        const punkSpikes = [[0.480,0.040],[0.500,-0.040],[0.520,0.040]];
        for (const sp of punkSpikes)
            tri(u, sp[0] - 0.025, 0.205, sp[0] + 0.025, 0.205, sp[0], sp[1]);
        if (d >= 2) {
            ellipse(u, 0.6275, 0.3725, 0.02, 0.02, false, 1);   /* safety pin */
            uline(u, 0.418, 0.50, 0.50, 0.66);             /* jacket lapels */
            uline(u, 0.582, 0.50, 0.50, 0.66);
        }
    },
    eyes(u, shut, d) { flickEyes(u, [0.425, 0.575], 0.31, 0.034, [0.022, 0.004], shut); },
},
{
    id: "pizza", name: "Pizza",
    /* Not humanoid: the silhouette IS a slice, point-DOWN. No head circle. */
    anchors: [[0.24,0.10],[0.36,0.20],[0.46,0.30],[0.52,0.22],[0.56,0.14]],
    mc: [0.5,0.56], mbf: 0.26,
    crop: [0.04,0.02,0.96,0.86], picker: [-0.03,-0.03,1.03,1.04], cropFull: [0.01,0.00,0.99,1.00],
    portrait: [0.01,0.00,0.99,1.00],
    head(u, d) {
        quad(u, 0.5, 0.97, 0.20, 0.68, 0.09, 0.16);
        quad(u, 0.09, 0.16, 0.5, 0.06, 0.91, 0.16);
        quad(u, 0.91, 0.16, 0.80, 0.68, 0.5, 0.97);
        if (d >= 1) quad(u, 0.09, 0.24, 0.5, 0.14, 0.91, 0.24);   /* crust line */
        /* Outline-only pepperoni, distributed around rather than underneath
         * the face, and inset far enough to belong unmistakably to the slice. */
        if (d >= 2) for (const p of [[0.28,0.31,0.052],[0.72,0.34,0.052],
                                    [0.29,0.72,0.057],[0.71,0.72,0.057]])
            ellipse(u, p[0], p[1], p[2], p[2], false, 1);
        if (d >= 2) {
            /* Clip the lower toppings with opaque exterior wedges, then draw
             * the real curved slice edges back over the cut circles. */
            tri(u, 0.00, 0.54, 0.15, 0.54, 0.50, 0.97, 0);
            tri(u, 0.00, 0.54, 0.50, 0.97, 0.00, 1.00, 0);
            tri(u, 1.00, 0.54, 0.85, 0.54, 0.50, 0.97, 0);
            tri(u, 1.00, 0.54, 0.50, 0.97, 1.00, 1.00, 0);
            quad(u, 0.5, 0.97, 0.20, 0.68, 0.09, 0.16);
            quad(u, 0.91, 0.16, 0.80, 0.68, 0.5, 0.97);
        }
    },
    eyes(u, shut, d) { solidEyes(u, [0.40, 0.60], 0.40, 0.025, 0.028, shut); },
},
{
    id: "cat", name: "Cat",
    anchors: [[0.08,0.10],[0.14,0.14],[0.20,0.12],[0.24,0.09],[0.28,0.08]],
    mc: [0.5,0.400], mbf: 0.20, mouthScaleGain: 1.5,
    crop: [0.24,-0.05,0.76,0.46], picker: [0.18,-0.08,0.82,0.53], cropFull: [0.02,-0.05,0.98,1.00],
    portrait: [0.16,-0.05,0.84,0.70],
    head(u, d) {
        if (d >= 2) {
            uline(u, 0.405, 0.44, 0.405, 0.60); uline(u, 0.595, 0.44, 0.595, 0.60);
            quad(u, 0.405, 0.60, 0.30, 0.78, 0.24, 0.99);
            quad(u, 0.595, 0.60, 0.70, 0.78, 0.76, 0.99);
            uline(u, 0.24, 0.99, 0.76, 0.99);
            quad(u, 0.74, 0.88, 0.99, 0.55, 0.88, 0.42);
        }
        /* Big triangular ears, set wide: at page size the original pair were
         * small and sat inside the head's own outline, so the silhouette said
         * nothing. They are the cat cue and now read from across the room. */
        for (const sd of [-1, 1]) {
            triOutline(u, 0.5 + sd * 0.040, 0.255,
                       0.5 + sd * 0.205, 0.255,
                       0.5 + sd * 0.135, -0.030);
        }
        circleSolid(u, 0.5, 0.28, 0.175);
        /* Muzzle lower and wider, nose lifted onto the head above it: at page
         * size the nose triangle, the mouth and the muzzle outline all landed
         * within about four pixels and read as one scribble. */
        ellipseSolid(u, 0.5, 0.392, 0.132, 0.092);       /* muzzle */
        tri(u, 0.474, 0.300, 0.526, 0.300, 0.5, 0.322);  /* nose */
        if (d >= 2) {
            /* Two whiskers a side, not three: the third crossed the muzzle
             * outline and turned the lower face into hatching. */
            for (const sd of [-1, 1]) for (const dy of [-0.022, 0.022])
                uline(u, 0.5 + sd * 0.115, 0.372 + dy * 0.5, 0.5 + sd * 0.245, 0.372 + dy);
        }
    },
    eyes(u, shut, d) { almondEyes(u, [0.44, 0.56], 0.27, 0.052, 0.036, shut); },
},
];

// strokes instead of pixel runs (these replace canvas.js's own, above)
function ellipse(u, fcx, fcy, frw, frh, fill, color) {
  var cx = u.x(fcx), cy = u.y(fcy);
  var rw = Math.max(0.5, frw * u.s), rh = Math.max(0.5, frh * u.s);
  var c = color === undefined ? 1 : color;
  if (fill) {
    var y0 = Math.round(cy - rh), y1 = Math.round(cy + rh);
    for (var y = y0; y <= y1; y++) {
      var dy = (y + 0.5 - cy) / rh;
      if (dy < -1 || dy > 1) continue;
      var half = rw * Math.sqrt(Math.max(0, 1 - dy * dy));
      u.ctx.fillRect(Math.round(cx - half), y, Math.max(1, Math.round(2 * half)), 1, c);
    }
    return;
  }
  var pts = [], n = Math.max(12, Math.min(40, Math.round((rw + rh) / 2)));
  for (var i = 0; i <= n; i++) { var a = i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * rw, cy + Math.sin(a) * rh]); }
  u.ctx.poly(pts, c);
}
function circleSolid(u, fcx, fcy, fr) {
  var cx = u.x(fcx), cy = u.y(fcy), r = fr * u.s;
  u.ctx.fillCircle(cx, cy, r, 0);
  u.ctx.drawCircle(cx, cy, r, 1);
}
function uline(u, x0, y0, x1, y1, color) {
  u.ctx.line(u.x(x0), u.y(y0), u.x(x1), u.y(y1), color === undefined ? 1 : color);
}
function quad(u, x0, y0, cx, cy, x1, y1, color) {
  var pts = [];
  for (var i = 0; i <= 12; i++) {
    var t = i / 12, m = 1 - t;
    pts.push([m * m * u.x(x0) + 2 * m * t * u.x(cx) + t * t * u.x(x1), m * m * u.y(y0) + 2 * m * t * u.y(cy) + t * t * u.y(y1)]);
  }
  u.ctx.poly(pts, color === undefined ? 1 : color);
}

// the mouth (canvas.js mouthShape, drawMouth): the five anchor apertures,
// interpolated, at the character's mouth centre
function mouthShape(face, v) {
  var a = face.anchors, scaled = clamp01(v) * (a.length - 1);
  var i = Math.min(Math.floor(scaled), a.length - 2), t = scaled - i;
  return [a[i][0] + (a[i + 1][0] - a[i][0]) * t, a[i][1] + (a[i + 1][1] - a[i][1]) * t];
}
var FACE_MOUTH_GAIN = 1.6;
function drawMouth(g, u, face, vowel, boost, hot) {
  var wh = mouthShape(face, vowel), b = boost * FACE_MOUTH_GAIN * (face.mouthScaleGain || 1);
  var rw = wh[0] * face.mbf * 0.5 * b * (face.mouthWidthGain || 1), rh = wh[1] * face.mbf * 0.5 * b;
  var minR = 3 / u.s, largest = Math.max(rw, rh);
  if (largest > 0 && largest < minR) { rw *= minR / largest; rh *= minR / largest; }
  if (isFinite(face.mouthBottom)) {
    var maxR = face.mouthBottom - face.mc[1] - 2 / u.s;
    if (maxR > 0 && rh > maxR) { rw *= maxR / rh; rh *= maxR / rh; }
  }
  var cx = u.x(face.mc[0]), cy = u.y(face.mc[1]), RW = rw * u.s, RH = rh * u.s, pts = [];
  for (var y = Math.round(cy - RH); y <= Math.round(cy + RH); y++) {
    var dy = (y + 0.5 - cy) / RH;
    if (dy < -1 || dy > 1) continue;
    var half = RW * Math.sqrt(1 - dy * dy);
    g.fill(Math.round(cx - half), y, Math.max(1, Math.round(2 * half)), 1, MOUTH);
  }
  for (var i = 0; i <= 24; i++) { var a = i / 24 * Math.PI * 2; pts.push([cx + Math.cos(a) * RW, cy + Math.sin(a) * RH]); }
  g.poly(pts, hot ? 2.5 : 1.6, hot ? "slot" : INK);
}

var VOWELS = ["OO", "OH", "AH", "EH", "EE"];
function vowelName(v) { return VOWELS[Math.min(4, Math.round(clamp01(v) * 4))]; }

// ---- the voice the engine makes (voice.c) ------------------------------------------------

// formant centres at the five vowel positions, and their bandwidths
var FF = [[280, 450, 800, 350, 270], [600, 800, 1150, 2000, 2140], [2240, 2830, 2900, 2800, 2950]];
var FBW = [32.5, 47.5, 62.5];
// the engine's Catmull-Rom spline through the five (build_formant_tables)
function formant(f, vowel) {
  var p = FF[f], pad = [p[0], p[0], p[1], p[2], p[3], p[4], p[4]];
  var pos = clamp01(vowel) * 4, seg = Math.min(3, Math.floor(pos)), t = pos - seg;
  var p0 = pad[seg], p1 = pad[seg + 1], p2 = pad[seg + 2], p3 = pad[seg + 3], t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function headScale(h) { return clamp01(h) * 0.5 + 0.75; }

var FMT = { x: 366, y: 24, w: 282, h: 48 }, FLO = 150, FHI = 6000;
function fx(f) { return FMT.x + Math.log(f / FLO) / Math.log(FHI / FLO) * FMT.w; }

// the grain's spectral envelope: three damped sines (a resonance each, as wide
// as its bandwidth and the 20 ms grain allow) and the two breath partials
var fmtMemo = { sig: "", pts: null, peaks: null };
function formantCurve(vowel, head, breath) {
  var sig = [Math.round(vowel * 400), Math.round(head * 200), Math.round(breath * 50)].join("|");
  if (sig === fmtMemo.sig) return fmtMemo;
  var sc = headScale(head), F = [], i;
  for (i = 0; i < 3; i++) F.push(formant(i, vowel) * sc);
  var pts = [], base = FMT.y + FMT.h;
  for (var x = 0; x <= FMT.w; x += 2) {
    var f = FLO * Math.pow(FHI / FLO, x / FMT.w), m = 0;
    for (i = 0; i < 3; i++) { var bw = FBW[i] + 50, d = (f - F[i]) / (bw / 2); m += 1 / Math.sqrt(1 + d * d); }
    var a1 = (f - 4951) / 160, a2 = (f - 3802) / 180;
    m += breath * 0.5 * (1 / Math.sqrt(1 + a1 * a1) + 1 / Math.sqrt(1 + a2 * a2));
    var db = 20 * Math.log(Math.max(m, 1e-3)) / Math.LN10; // 0 dB at a lone formant's peak
    var yy = FMT.y + 4 + (-Math.max(-42, Math.min(3, db)) + 3) / 45 * (FMT.h - 4);
    pts.push([FMT.x + x, Math.min(base, yy)]);
  }
  fmtMemo = { sig: sig, pts: pts, F: F };
  return fmtMemo;
}

// ---- the panel --------------------------------------------------------------------------

var PORT = { x: 6, y: 3, w: 168, h: 99 };
var ENV = { x: 676, y: 20, w: 278, h: 82 };

function ground(g, face, fi) {
  g.layer("monk|" + fi, function () {
    g.fill(0, 0, 960, 160, GROUND);
    // the portrait: a warm halo behind the singer
    g.fill(PORT.x, PORT.y, PORT.w, PORT.h, GROUND);
    g.dot(PORT.x + PORT.w / 2, PORT.y + PORT.h / 2 + 2, 52, HALO);
    if (face) {
      var u = unitBox(g, PORT.x + 4, PORT.y + 2, PORT.w - 8, PORT.h - 4, face.portrait || face.crop, face.pickerXScale || 1);
      face.head(u, 2);
      face.eyes(u, false, 2);
    }
    // what a portrait drew past its box goes under the panel's ground
    g.fill(PORT.x + PORT.w, 0, 960 - PORT.x - PORT.w, 104, GROUND);
    g.fill(0, 0, PORT.x, 104, GROUND);
    g.fill(0, 0, 960, PORT.y, GROUND);
    g.fill(0, PORT.y + PORT.h, PORT.x + PORT.w, 104 - PORT.y - PORT.h, GROUND);
    // the robe: the encoder row
    g.fill(0, 104, 960, 56, ROBE_DK);
    g.fill(0, 104, 960, 2, SAFF_DIM);
    for (var i = 1; i < 8; i++) g.fill(i * 120, 114, 1, 40, RULE);
    // the formants' axis: octaves, and the vowel strip under it
    g.fill(FMT.x, FMT.y + FMT.h, FMT.w, 1, RULE);
    [250, 500, 1000, 2000, 4000].forEach(function (f) {
      g.fill(Math.round(fx(f)), FMT.y + 2, 1, FMT.h - 2, "#2a1a1a");
      g.text(Math.round(fx(f)), FMT.y + FMT.h + 10, f >= 1000 ? (f / 1000) + "K" : String(f), "#8a7766", 0);
    });
    g.text(FMT.x - 4, 14, "FORMANTS", SAFFRON, -1);
    g.text(ENV.x + 4, 14, "ENVELOPE", SAFFRON, -1);
    g.fill(352, 8, 1, 92, RULE);
    g.fill(664, 8, 1, 92, RULE);
  });
}

function faceOf(v) {
  var i = known(v, "face") ? parseInt(v.face.value, 10) : (known(v, "preset") ? parseInt(v.preset.value, 10) : -1);
  return i >= 0 && i < FACES.length ? i : -1;
}

function nameBlock(g, v, fi) {
  var x = 186, t = v.$touched || "";
  g.text(x, 14, "MONKSYNTH", SAFF_DIM, -1);
  var nm = fi >= 0 ? FACES[fi].name : disp(v, "preset_name");
  g.value(x, 36, up(nm), t === "face" ? "slot" : INK, -1, 158);
  // the twelve singers
  for (var i = 0; i < 12; i++) {
    var cx = x + 4 + i * 12.6;
    g.dot(cx, 47, i === fi ? 3.5 : 2, i === fi ? (t === "face" ? "slot" : SAFFRON) : RULE);
  }
  // the vowel, as the singer says it
  var vw = clamp01(num(v, "vowel", 0.5)), vh = t === "vowel";
  g.value(x, 76, known(v, "vowel") ? vowelName(vw) : "--", vh ? "slot" : SAFFRON, -1);
  g.text(x + 42, 70, "VOWEL", INK_DIM, -1);
  g.text(x + 42, 80, "HEAD " + Math.round(headScale(num(v, "head_size", 0.5)) * 100) + "%", t === "head_size" ? "slot" : INK_DIM, -1);
  // the choir: how many voices sing the note (unison rounds to a count)
  var n = known(v, "unison") ? Math.floor(num(v, "unison", 0) * 9 + 1.5) : 1, uh = /^unison/.test(t) || segLit(v, "choir");
  g.text(x, 98, n > 1 ? n + " VOICES, " + Math.round(num(v, "unison_detune", 0) * 50) + " CENTS" : "SOLO VOICE", uh ? "slot" : INK_DIM, -1, 160);
}

function formants(g, v) {
  var vw = num(v, "vowel", 0.5), hd = num(v, "head_size", 0.5), br = num(v, "aspiration", 0.5), t = v.$touched || "";
  var ok = known(v, "vowel") && known(v, "head_size");
  if (!ok) return;
  var m = formantCurve(vw, hd, br), base = FMT.y + FMT.h;
  var hot = t === "vowel" || t === "head_size" || t === "aspiration";
  g.area(m.pts, base, "#4a2c12");
  g.poly(m.pts, hot ? 2.6 : 2, hot ? "slot" : SAFFRON);
  for (var i = 0; i < 3; i++) {
    var x = fx(m.F[i]);
    g.text(x, FMT.y - 2, "F" + (i + 1), INK, 0);
  }
  // the vowel's place between OO and EE
  var y = 98, x0 = FMT.x + 24, x1 = FMT.x + FMT.w - 24, vh = t === "vowel";
  for (var k = 0; k < 5; k++) {
    var vx = x0 + k * (x1 - x0) / 4, on = Math.round(clamp01(vw) * 4) === k;
    g.text(vx, y, VOWELS[k], on ? INK : INK_DIM, 0);
    if (k < 4) g.fill(Math.round(vx + 12), y - 4, Math.round((x1 - x0) / 4 - 24), 1, RULE);
  }
  var px = x0 + clamp01(vw) * (x1 - x0);
  g.fill(Math.round(px) - 1, y - 14, 3, 6, vh ? "slot" : SAFFRON);
}

// ---- the encoder row: saffron knobs on the robe ---------------------------------------------

function knob(g, cx, cy, f, ok, hot, s) {
  s = s || 1;
  g.arc(cx, cy, 15 * s, Math.PI * 0.75, Math.PI * 1.5, 2, RULE);
  g.dot(cx, cy, 10.5 * s, hot ? "slot" : SAFFRON);
  g.dot(cx, cy, 8.5 * s, "#d58a16");
  if (!ok) return;
  var a = Math.PI * (0.75 + 1.5 * clamp01(f));
  g.arc(cx, cy, 15 * s, Math.PI * 0.75, Math.PI * 1.5 * clamp01(f), 2, hot ? "slot" : INK);
  g.line(cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, cx + Math.cos(a) * 9 * s, cy + Math.sin(a) * 9 * s, 2.5, ROBE_DK);
}

function valueOf(v, k) {
  if (!known(v, k)) return "--";
  return String(v[k].display || v[k].value) + (v[k].unit ? " " + v[k].unit : "");
}
// how the values read everywhere: the engine's units (monksynth_plugin.c
// apply_value), hundredths elsewhere
push.display(function (key, raw) {
  var x = parseFloat(raw);
  if (isNaN(x)) return;
  switch (key) {
  case "face": var i = Math.round(x); return i >= 0 && i < FACES.length ? FACES[i].name : undefined;
  case "vowel": return vowelName(x) + " " + Math.round(x * 100);
  case "head_size": return Math.round(headScale(x) * 100) + "%";
  case "unison": return String(Math.floor(x * 9 + 1.5));
  case "unison_detune": return Math.round(x * 50) + " ct";
  case "attack": case "decay": case "release": var s = x * 5; return s < 1 ? Math.round(s * 1000) + " ms" : s.toFixed(1) + " s";
  case "bend_range": case "pressure_routing": return;
  }
  if (String(raw).indexOf(".") >= 0) return String(Math.round(x * 100));
});

function row(g, v) {
  var knobs = v.$knobs || [], t = v.$touched || "";
  for (var i = 0; i < 8; i++) {
    var k = knobs[i];
    if (!k || !v[k]) continue;
    // in segment mode the bottom 18 pixels are Pung's: the row closes up
    var sm = !!v.$segmode, x0 = i * 120, hot = k === t, ok = known(v, k);
    g.text(x0 + 60, sm ? 116 : 120, up(v[k].name), hot ? "slot" : INK_DIM, 0, 110);
    knob(g, x0 + 30, sm ? 129 : 138, k === "face" ? (ok ? parseInt(v[k].value, 10) / 11 : 0) : fr(v, k, 0), ok, hot, sm ? 0.7 : 1);
    g.value(x0 + 82, sm ? 138 : 149, valueOf(v, k), hot ? "slot" : INK, 0, 70);
  }
  var ps = v.$pages || [];
  if (v.$segmode === "segment") { var sl = (v.$segments || []).filter(function (s) { return s.id === v.$segment; })[0]; if (sl) g.text(952, 14, up(sl.label), "slot", 1); }
  else if (ps.length > 1) g.text(952, 14, up(ps[v.$page] || "") + "  " + (v.$page + 1) + "/" + ps.length, INK_DIM, 1);
}

// ---- segments: the panel's sections under the hands ------------------------------------------
var SEGMENTS = [
  { id: "singer", label: "Singer", rect: [4, 0, 174, 102], keys: ["face", "vowel", "head_size", "aspiration", "glide", "pressure_routing", "pressure_depth", "bend_range"] },
  { id: "choir", label: "Choir", rect: [180, 0, 168, 102], keys: ["unison", "unison_detune", "unison_spread", "vibrato", "vibrato_rate", "delay", "delay_rate", "level"] },
  { id: "formants", label: "Formants", rect: [356, 0, 304, 102], keys: ["vowel", "head_size", "aspiration"] },
  { id: "envelope", label: "Envelope", rect: [668, 0, 288, 102], keys: ["attack", "decay", "sustain", "release"] }
];
// the active section: Pung draws the bar above it; its saffron legend lit
function segLit(v, id) { return v.$segmode === "segment" && v.$segment === id; }
function segmentMark(g, v) {
  if (segLit(v, "formants")) g.text(FMT.x - 4, 14, "FORMANTS", "slot", -1);
  if (segLit(v, "envelope")) g.text(ENV.x + 4, 14, "ENVELOPE", "slot", -1);
}

push.compartment({
  id: "voice", label: "Voice", front_panel: true, segments: SEGMENTS, draws_segments: true,
  pages: [
    { label: "Voice", keys: ["vowel", "head_size", "aspiration", "glide", "vibrato", "unison", "delay", "level"] },
    { label: "Effects", keys: ["vibrato", "vibrato_rate", "delay", "delay_rate", "unison", "unison_detune", "unison_spread"] },
    { label: "Envelope", keys: ["attack", "decay", "sustain", "release"] },
    { label: "Character", keys: ["face", "pressure_routing", "pressure_depth", "bend_range"] }
  ],
  extra_keys: ["face", "preset", "preset_name", "vowel", "head_size", "aspiration", "unison", "unison_detune",
    "attack", "decay", "sustain", "release"],
  screen: function (g, v) {
    var fi = faceOf(v), face = fi >= 0 ? FACES[fi] : null, t = v.$touched || "";
    ground(g, face, fi);
    if (face) {
      // the mouth: the vowel's aperture, wider as the voice gets louder
      var L = v.$live, amp = L && L.known && L.level > 0 ? Math.min(1, L.level) : 0;
      var u = unitBox(g, PORT.x + 4, PORT.y + 2, PORT.w - 8, PORT.h - 4, face.portrait || face.crop, face.pickerXScale || 1);
      drawMouth(g, u, face, num(v, "vowel", 0.5), 1 + Math.round(amp * 4) / 4 * 0.35, t === "vowel");
    }
    nameBlock(g, v, fi);
    formants(g, v);
    g.envelope(ENV.x, ENV.y, ENV.w, ENV.h, { attack: "attack", decay: "decay", sustain: "sustain", release: "release", color: SAFFRON, labels: true });
    segmentMark(g, v);
    row(g, v);
  }
});

// the engine's seconds (monksynth_plugin.c apply_value: attack, decay and
// release are the knob times 5 s)
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined) return null;
    if (s.key === "attack" || s.key === "decay" || s.key === "release") return Math.max(0.003, clamp01(parseFloat(s.raw)) * 5);
    return null;
  });
});
