// Braids on Push: its two envelopes drawn as envelopes.
// An overlay shipped with Pung (Braids itself ships no push_ui.js).
// Pung's own envelope, with the envelope's name on it; the encoders stay
// where they are and the native layer still writes every value.

function envelope(a, d, s, r) {
  return function (g, v) {
    // Pung's envelope (g.envelope): the same picture as the default view,
    // and live: each note a dot on its clock, the stage bar lit under it
    g.envelope(0, 0, g.w, g.h, { attack: a, decay: d, sustain: s, release: r, labels: true });
    g.fill(g.w - 84, 3, 80, 15, "black");
    g.text(g.w - 8, 14, v[a].name.indexOf("F") === 0 ? "FILTER ENV" : "AMP ENV", "dim", 1);
  };
}

push.widget({ keys: ["attack", "decay", "sustain", "release"], draw: envelope("attack", "decay", "sustain", "release") });
push.widget({ keys: ["f_attack", "f_decay", "f_sustain", "f_release"], draw: envelope("f_attack", "f_decay", "f_sustain", "f_release") });
