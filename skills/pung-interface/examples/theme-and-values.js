// TapeDelay (a tape echo) on Push: six knobs on one page, no front panel of its own. Pung's page as a
// tape machine: the brown of the oxide, cream legends, brass for what is set, hardware knobs.
push.theme({ ground: "#1e1611", panel: "#3a2c22", ink: "#f2e4c9", dim: "#b39a7c", rule: "#5a4534",
             faint: "#33271e", accent: "#e6c36a", knob: "pointer" });

// The module answers bare numbers; its own metadata says what they are (ui_hierarchy: Time in ms,
// Feedback, Mix and Tone 0..1 as percent, Stereo Width 0..100 percent). Division is a list: Pung's own.
var PERCENT_OF_ONE = { feedback: 1, mix: 1, tone: 1 };
push.display(function (key, raw) {
  var x = parseFloat(raw);
  if (isNaN(x)) return undefined;
  if (key === "time") return { value: String(Math.round(x)), unit: "ms" };
  if (PERCENT_OF_ONE[key]) return { value: String(Math.round(x * 100)), unit: "%" };
  if (key === "stereo_width") return { value: String(Math.round(x)), unit: "%" };
  return undefined;
});
