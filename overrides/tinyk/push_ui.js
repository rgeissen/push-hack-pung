// TinyK (a four-voice virtual analog in the style of the early-2000s pocket synths) on Push.
// An overlay shipped with Pung (TinyK ships its own canvas widgets for Move, no push_ui.js).
//
// The look is the small charcoal synth between wooden cheeks: a red three-digit LED naming the program
// (A.16: bank A, genre 1, program 6), the genre and the eight program keys, the edit sections in the
// order the panel's matrix reads them (oscillators, filter, filter EG, amp EG, arpeggiator), black knobs
// with a white line, the arpeggiator's eight step keys in two rows of four.
//
//   PANEL     the whole synth at once; its sections are the segments, the performance knobs on the
//             encoders (the module's own Perf page)
//   OSC       both oscillators drawn as TinyK makes them (Osc 1's wave bent by Control 1, the DWGS and Vox
//             waves from its own tables), Osc 2 against it with sync or ring, the mix
//   FILTER    the filter's response where TinyK's cutoff really puts it, its envelope (Pung's), how far
//             the envelope and the keys move it
//   AMP       the amp envelope (Pung's) on TinyK's measured times and as the level heard (the EG squared),
//             the level, the pan, the distortion
//   EFFECTS   the mod effect and the delay's repeats in time, as TinyK's delay makes them
//   ARP       the note order the type plays, the step keys (the sounding one lit), gate and swing
//
// Numbers from TinyK's source (src/dsp/dsp.c, arp.c): the cutoff's knob law (knob_fc), the envelope
// time table (EG_TIME_S) and its stage shape, the LFO and Mod FX rate tables, the delay's time and
// gain laws, the oscillator waves (the DWGS and Vox tables below are dwgs_waves.h and vox_pulse.h
// sampled through the engine's own formulas: one period at C4, 64 points, 6 bits).

function known(v, k) { return !!(v[k] && v[k].known); }
function raw(v, k, d) { if (!known(v, k)) return d; var n = parseFloat(v[k].value); return isNaN(n) ? d : n; }
function fr(v, k, d) { return known(v, k) ? v[k].frac : d; }
function idx(v, k, n, d) { return Math.max(0, Math.min(n - 1, Math.round(raw(v, k, d === undefined ? 0 : d)))); }
function txt(v, k) { return v[k] ? String(v[k].display || v[k].value || "") : ""; }
// where the sound has a control now (v[k].now: TinyK's live_mod, the edited layer's newest voice), 0..1 of its
// range; null when nothing moves it. rawNow: the same in the control's own units, else its knob
function nowOf(v, k) { return known(v, k) && typeof v[k].now === "number" ? Math.max(0, Math.min(1, v[k].now)) : null; }
function rawNow(v, k, d) { var n = nowOf(v, k); return n === null || !(v[k].max > v[k].min) ? raw(v, k, d) : v[k].min + n * (v[k].max - v[k].min); }
function frNow(v, k, d) { var n = nowOf(v, k); return n === null ? fr(v, k, d) : n; }
// Osc 1's Control 1 as the wave plays it, 0..1 (the Square plays Pulse Width, which follows Control 1)
function ctrl1Now(v, w1) {
  var n = nowOf(v, "osc1_ctrl1");
  if (n === null && w1 === 1) n = nowOf(v, "pulse_width");
  return n === null ? raw(v, "osc1_ctrl1", 0) / 127 : n;
}
var DWGS = "wtpnllmnpruwxyxvsojeYSMIEBAACEHLPSWYaaZYWURPONOQTXchntz37+//9740abdghjkkjheaWSOLIHHILPUagnu048+/+840vqlgcaYXXYaceghijjigfdbZYXYY/851xtokgdZWUSRQQRRSUVXYabcddddcbaYXVUSRQQQQRTVXZcfimpsuxz01111z64zskdWQOOQUafjmmkgZSLFBABFLTaglnnkgbVRPPRXelt05774ztnhecehmsy36/6xlaUTXfnrsmeUNKNVfotsmdUNLPWflniaPGABHRaikhbUPOUer29+5ypkjnv4+88vikv1qbXhrmYQXkmaPSgnfSPbmiTLSfgTHJWdUHFRdbPKUkpgXdu3xmmz/8vnvgrxqpy1ss32nekkZVcbRRejaVbcROUSEALSLLWaUWikYSbeWVfiadt1ur02trzxkuvxyz0122221zxurokfbWSOKHECBAABCEGJLORUWZbdfgijkllmmnnnooppqqrstphaTOLJJJKLMNNOOPPQSUXbfkpuy1466654310zyxwvusplgZSLFBADJTeox242xxtgjjcbfaTWSKIPMLQXSRVXSUabceiirmm++u293vtdocAFPDLGKfhZw4zz4321w98765320ywuspnljihggfAFGHHHGGFFFFFFFGHIJKMOPSUXZdgjnruy136799+++899987530yvspnkjhhggfAEFGHHHGFEEDCCCDEGILNQTWYbceeffg/7654445677xyyyyyxywsLLMADFIKMORUWZbegjlnopqrssssssqnFFIWVWYZacefhjlnprsuvwyurpnlkiiggdFMQTVYZbcdeffggePTysrponmlkjjiigLPTWZacdffghhiiiik/1qqpppppppppppppppppqpAFHJKMNPQRSTUVWXXYZZaabbcccccdcdyvuutssrrrqiiiiihhghggffffeeeeeeedf3zzxxwwvuttssrspRVVWXXYXAEFHIJKNmjjjjjji5321zyxvtqdDEGHIJLMNOPQVg9654311zyxwvutroTCEFHIJKLNOPQRUXVVX/+76mlluWTXYZnvykjiaVLATbany39upobWKMMNSotzywslhKMMOZbixywubjXYPQdolnmmljAGqonnmmllODaponnmmlhDHqponnmmkBFFJtrqpponnOEdqponnmmgDJpon20zhxxwvVqvuttQdntsqGBAQIXLQMLQJTKVQUgSvUmLboTpJYyRb2Rc0MXt2753rnccTfjbSdbqlaadmbML/zjXkmkUVmlukdjrfeUcliLYeiliifqdgShcecjkpwYZjzyywvTTUVWWXYiiiiiiihFHIJKLNOrqqppoomJLMMNNPR/+765420WYYYYYZa210rtsXaeilprtjmptvz1rAEJOSWabTXbfimpmSWaehlopgjmqsvxrLPTXbfiiaehlonoppppponmljihgeddcccccdefgiklnprsuvwxxxxwvusqnliebYUROLIGECBAAAlmllkjjjjiiiihhhhgggggffffffffefeel664321000zYWWXYYaabbaABDEGHJKihecaYWVTRPON7+52ywtqnkigecaYWUTRQa/841ywtrpnljhfecbZYWVUSRQONMLrmgaTOKIJMSZhpw26751umdUMFBADJRblu28//71tjZQJDABFMVfow27862wogYRfLNXTVdVepxg1qXSmKWkwZYRoqgdyydkzdNWdkpb7YhaiyLfqbhrO4AsaTlboZLyxcYtVRrecndTqiWmeZumg/oeniXXjRmkIngXhhQXrUfvQokXhgfcrKZwWijcfnhYjegklkcZXjomefgbdbfeiYjdjt/neXfdiadfdehhgolcTYfjjffcljlZbYeXcenlofleXYTTgXbdZhtw/2qkXRaSXWOTXWljjnfgrlrkaZXShcfkggjYfZQWacqloncgposxUkSVib1oqpoZdWYRWZM/txyylmfYaTUHsZhdagWUSbRYQzv10nqWZGKPbgnqgfgffVWUTWZXTTQMLNILOSVYiiw38/9+1751yrognllkigaeXXUVUTaTZbhlnsij71zrhpchSdkt0mpbkXTNLbVdKNIJLAOPopsoisgkUcgnrcgTeVVVZut5psomlVdYudWdqdSRXLLbwqklrdZjyofgnccr/4wvyhagtgVTZNMbvpjjpaWfujaahWWl5yqprrqqonlkigfdbZXVSPLHGLd2/4xtsrqponljihfedcbaaZYYXWVTROMJJNcy+5xsronmljihffgfcbdfcabeebacfdaaddbZabaYYXWWWUSRRQMKNSWZht1469/82yxvz/+ujiiYOPZcYUYZYVXYZcgfYZgjbWdmjZYimfXcjjbbgjfcccbcefcfjhZXhrspuu5mutipjfhebccXcZVeWZfWedXgaaeZZaWVYTQYNRYHaVLkRaqSsqc5ms+l54o/38//83yussvyyupiZSMLNRVXVTOJFDGLRWZZXTPNOSYfjkjgcYWYelrvwusollpwhebYVSPMKIJMQWbhntz48//94yrkeZUPMLMPUbhnsvy010xsmgbYVVUUVWYaehii1vngdfiifXOKLScjmkgdeinplbPFBDHMNLJKRds4//7436994sfVQSYcdbXWajt0mnzxjkwvijvtghtreepmYXiePOYVGFQOABNMACQRGKabSWmoeixynp33rs53qq20WgmmmliikiddhidchligjmljihimpfMADNSUWXXaghfhmojhlnjfhjighilsyrbR///9zqnllkkjlnmkkjhgXPNOPQSTcmqrrqqpfWUUVWWXbddddcccTLKLNPQSfw488+1wropqiVOVTJAHRZVTPPUYTPSipldmw1vussuwnaSXUKBIUedcadjpmjn294u1akgZbgliaZmtndcgu1z0cOZZZIADRlty1tkWVfeenogXTcpunfegeXRRglkihjifX/glov8YetgXJmgTcnwbLcfdcjvvtvvv1591wwkeQNJLHGODWKcWVUXeMYailfrc1upmkjhgfilmlkgefhjlliiiiieXRLGFECAABDFFGIJMQVcjosvxz11100014798eeggffeZYUVTTWRXZat04/41skjedcZbbZebeedfdcfcgdegdegeffhihijiggggedfdebhYWdgZWLkrhWI/riYh2tmgjpmclfgfgfeeefedfhfhhghccdcecfhgeffgmmmllkjjjkklllkjhfdccehknpokdULEAAEKQVZbdefghijklmnnnnmmllkkkllmx0476ztncTNIEBABEHLPSVZbdgiklmmnmllkjihhgghhhijijkiijjihfgjjimsv66555320zxvtpmjfbXSNJGDBABEINTahnqplfXQJFEEGILPTXbeilpsuxz124456flgjjlloorijkdgchiul0yntfPVFHLAKJJCMFLJQOSaUefgjoqoxtw2w3wwwpomjnwtelPWCLAKGSLbbmq6348/1u0mifbaUOVMPSPXZgianrinnhmgdkXghXggcsmr96khnw3lfZr10oVZewneUUlliKDFTdTNBRZeVFHQnjfPReknSOQlxvmXls6wkjo//2qhdbliev64tXe0iXy/3pVgvYTu1tiVYcSUdjsfLORSSLd1cCPWRPMk4dLabVWashXMTPQNWULcjgmbOu/1khcchandqtktjSS2wjfTeqplkmrinvkax5ifCASbUMYUbponmpu1551siaVVXZZXVVXbhmonibSMIJLNPQRSWckrvsmdVRQVadffgjqz6/+4v2/9lgnnioiYQKAHVflx1wpmmoommgVNNOVfsy1wrnmkkkjdVQNOQVZaYUQNJMf00upjkeQORgustkmjaUMXgqtrrojcVYcjmklggbXXXbddeaZUPKElx/6itciPFTc11ypcdcfWTQcnrsikjliYSTdggnfnnyofAGWcybmny5rYFNOiYahn7ztYSSaZRWYuybZkzsbIWjrpnkRSSn3jMf1xkAjgiSf2aUMvmWajyUXboiZsmgLapnmemRPbwzcXU";
var VOX = "jihgfedccbbXSNKGECBAAABDEHJMPSVYcfilortvxz022344332210yxvusrpomlddccbbbbbbYSNJGDBAAABDFHKNQTXbeiloruwy023444443210yxvusqonljigfebcccddeffcVPKGDBAAACDGJMQTXbfjnqtwz12345544320zxvtrpnlkihfeddccbhijklllkdVOJFCAABCFIMQUZdimqtwy0223221zywusqnljigfedccccccdeefghjjiihhdTLGCAABEIMSXchmruxz010zywurpmkhfedcbbbccdefghijkkllllllkkghhhhdRIDAACGLRYekptxzzzywuroligedccccdefgijjklllllkkjiihhggggggghhgbNEAADKRZhotxyyxurnkheccccdeghijkkkkkjiihhgggggghhhhiihhhhhhhhhePEABHQZiqvxxvrnjfdbbcdfgijkkkkjihhggggghhhhiiihhhhhgggggghhhghfSEAEOaltxwtojfcbcdfijkkjjhhggggghhhihhhhggggghhhhhhhgggggggggggdJADOcovwtnhdbbdgikkkihggggghhhhhhhgggghhhhhgggggggggggggggggggfWAAOftxunfbacgjkkihgfgghhhhggggghhhhhggggggggggggggggggggggggggeOAKdrvricacgjjihgfghhhhggggghhgggggggggggggggggggggggggggggggggbAAZtxpeacgjjhggghhhhghhhhggggggggggggggggggggggggggggggggggggggaANmvoebeijhggghhhggggggggggggggggggggggggggggggggggggggggggggggVAbvpdbgjiffghggggggggggggggggggggggggggggggggggggggggggggggggggNAoxgZfjhffhhgggggggggggggggggggggggggggggggggggggggggggggggggggAG1qXekhfghggghgggggggggggggggggggggggggggggggggggggggggggggggg"; // Control 1 = 0, 8, ... 120, 127

// ---- TinyK's own laws ------------------------------------------------------------------------------------
// the cutoff knob (knob_fc): exponential from 32.67 Hz over 10.56 octaves to knob 70, then measured points
var FC_K = [70, 80, 85, 90, 95, 100, 105, 110], FC_C = [0.2606, 0.4192, 0.5141, 0.6054, 0.7006, 0.7959, 0.8804, 0.9140];
function cutHz(f) {
  var k = Math.max(0, Math.min(1, f)) * 127;
  if (k < 70) return 32.67 * Math.pow(2, k * 10.56 / 127);
  var c = FC_C[FC_C.length - 1];
  for (var i = 1; i < FC_K.length; i++) if (k <= FC_K[i]) { c = FC_C[i - 1] + (FC_C[i] - FC_C[i - 1]) * (k - FC_K[i - 1]) / (FC_K[i] - FC_K[i - 1]); break; }
  return Math.min(0.99, c) * 44100 / (2 * Math.PI);
}
function cutAt(f) { return Math.max(0, Math.min(1, Math.log(cutHz(f) / 20) / Math.LN10 / 3)); } // g.filter's 20 Hz..20 kHz
// the envelopes (EG_TIME_S, eg_step): one time table for every stage, T every 4 knob steps; decay and release
// never faster than a floor against clicks
var EG_T = [0.00020, 0.01470, 0.03583, 0.05561, 0.07565, 0.09543, 0.12710, 0.16304, 0.19885, 0.23867, 0.27849,
  0.35400, 0.44178, 0.52917, 0.61670, 0.70435, 0.79174, 0.87953, 0.96705, 1.05509, 1.14262, 1.22962,
  1.31818, 1.40467, 1.49207, 1.58024, 1.98942, 3.18968, 4.87991, 6.91935, 10.37920, 19.58920, 30.23570];
function egSecs(f, attack) {
  var k = Math.max(0, Math.min(1, f)) * 127, pos = k / 4, i = Math.floor(pos), t;
  if (i >= EG_T.length - 2) t = EG_T[EG_T.length - 2] + (EG_T[EG_T.length - 1] - EG_T[EG_T.length - 2]) * Math.min(1, (k - 124) / 3);
  else t = EG_T[i] + (EG_T[i + 1] - EG_T[i]) * (pos - i);
  if (!attack) t = Math.max(t, k < 1 ? 0.008 + 0.010 * k : 0.0155 + 0.00254 * k);
  return t;
}
// the stage shape (adsr_process): every stage runs 1 - (1 - x)^2 of its way in its time x; the filter takes
// that EG (E) itself, the amp its square (E^2: sustain 64 holds 0.254 of full level). Pung's envelope is given
// each stage's shape as a table, 33 points of how far along its levels it is at evenly spaced times.
var NT = 32;
function table(f) { var t = []; for (var i = 0; i <= NT; i++) t.push(Math.max(0, Math.min(1, f(i / NT)))); return t; }
var T_EG = table(function (x) { return 1 - (1 - x) * (1 - x); });
var EG_CURVE = { attack: T_EG, decay: T_EG, release: T_EG };
// the amp: attack E^2 from 0 to 1; decay (S + (1 - S)(1 - x)^2)^2 from 1 down to S^2; release from S^2 to 0,
// (S (1 - x)^2)^2, which is 1 - (1 - x)^4 of its way whatever S
var T_AMP_A = table(function (x) { var e = 1 - (1 - x) * (1 - x); return e * e; });
var T_AMP_R = table(function (x) { var u = (1 - x) * (1 - x); return 1 - u * u; });
var AMPD = {};
function ampDecay(S) {
  var k = S.toFixed(3);
  if (!AMPD[k]) AMPD[k] = 1 - S * S < 1e-4 ? T_EG : table(function (x) { var e = S + (1 - S) * (1 - x) * (1 - x); return (1 - e * e) / (1 - S * S); });
  return AMPD[k];
}
// the amp envelope as the level heard: every stage keeps its knob (its time, its touch, the live dots); the
// decay ends and the sustain holds at the knob's level squared
function ampEnv(v, labels) {
  var S = fr(v, "sustain2", 0.8), o = { attack: "attack2", decay: "decay2", sustain: "sustain2", release: "release2",
    labels: labels, curves: { attack: T_AMP_A, decay: ampDecay(S), release: T_AMP_R }, color: CURVE };
  if (known(v, "sustain2")) o.levels = { decay: S * S, sustain: S * S };
  return o;
}
// LFO and Mod FX rates (rate_table): measured every 8 knob steps
var LFO_HZ = [0.0157, 0.0900, 0.1696, 0.2502, 0.8302, 1.7502, 2.7506, 3.7500, 4.9978, 8.1793, 12.9755, 20.5917, 32.7045, 51.9048, 82.4155, 130.8, 196.0];
var MFX_HZ = [0.0454, 0.0454, 0.0504, 0.0926, 0.1927, 0.4078, 0.7937, 1.4297, 2.3958, 3.8194, 5.7986, 8.4722, 11.9792, 16.4931, 22.1528, 27.1528, 31.5];
function rateHz(tab, f) {
  var k = Math.max(0, Math.min(1, f)) * 127;
  if (k >= 120) return tab[15] + (tab[16] - tab[15]) * (k - 120) / 7;
  var i = Math.floor(k / 8);
  return tab[i] + (tab[i + 1] - tab[i]) * (k / 8 - i);
}
// the delay (delay_time_s, delay_gain): free time in five straight segments of a 1.365 s line; one gain for the
// send and every repeat, less as the time grows; or a note value at the session's tempo
function delaySecs(f) {
  var k = Math.max(0, Math.min(1, f)) * 127, fr;
  if (k <= 64) fr = 0.01 + 0.15 * k / 64;
  else if (k <= 110) fr = 0.16 + 0.24 * (k - 64) / 46;
  else if (k <= 120) fr = 0.40 + 0.02 * (k - 110);
  else if (k <= 125) fr = 0.60 + 0.04 * (k - 120);
  else fr = 1.0 + 0.2 * (k - 126);
  return fr * 65536 / 48000;
}
function delayGain(f, secs) {
  var d = Math.max(0, Math.min(1, f)) * 127, g = d <= 64 ? d * 0.3 / 64 : 0.3 + (d - 64) * 0.69 / 63;
  return g * (1 - 0.25 * Math.min(1.2, secs * 48000 / 65536));
}
var SYNC_NOTE = [1 / 32, 1 / 24, 1 / 16, 1 / 12, 3 / 32, 1 / 8, 1 / 6, 3 / 16, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 3 / 4, 1];
var SYNC_NAME = ["1/32", "1/24", "1/16", "1/12", "3/32", "1/8", "1/6", "3/16", "1/4", "1/3", "3/8", "1/2", "2/3", "3/4", "1/1"];

function secTxt(s) { return s < 0.0995 ? (s * 1000).toFixed(s < 0.01 ? 1 : 0) + " MS" : s < 1 ? Math.round(s * 1000) + " MS" : s < 10 ? s.toFixed(2) + " S" : s.toFixed(1) + " S"; }
function hzTxt(h) { return h >= 1000 ? (h / 1000).toFixed(h >= 10000 ? 1 : 2) + " KHZ" : h >= 100 ? Math.round(h) + " HZ" : h >= 10 ? h.toFixed(1) + " HZ" : h.toFixed(2) + " HZ"; }
function k127(f) { return Math.round(Math.max(0, Math.min(1, f)) * 127); }
function pm63(x) { var n = Math.round(x); return (n > 0 ? "+" : "") + n; }

// how the values read wherever Pung writes them: times and frequencies in their units, the rest on the
// panel's own 0..127 (bipolar ones -63..+63) as the hardware it follows shows them
var STAGE = { attack1: 1, attack2: 1, decay1: 0, decay2: 0, release1: 0, release2: 0 };
var K127 = { resonance: 1, sustain1: 1, sustain2: 1, level: 1, noise_level: 1, osc_mix: 1, sub_level: 1, portamento: 1,
  mod_int: 1, vel_sens: 1, chorus_mix: 1, delay_feedback: 1, delay_mix: 1, master_vol: 1, timbre_balance: 1, detune: 1,
  pulse_width: 1, delay_time: 1 };
function fmt(key, n) {
  if (key === "cutoff") { var h = cutHz(n); return h >= 1000 ? [(h / 1000).toFixed(h >= 10000 ? 1 : 2), "kHz"] : [String(Math.round(h)), "Hz"]; }
  if (key in STAGE) { var s = egSecs(n, STAGE[key] === 1); return s < 1 ? [s < 0.01 ? (s * 1000).toFixed(1) : String(Math.round(s * 1000)), "ms"] : [s.toFixed(s < 10 ? 2 : 1), "s"]; }
  if (key === "lfo1_rate" || key === "lfo2_rate" || key === "modfx_speed") {
    var hz = rateHz(key === "modfx_speed" ? MFX_HZ : LFO_HZ, n);
    return [hz < 10 ? hz.toFixed(2) : hz < 100 ? hz.toFixed(1) : String(Math.round(hz)), "Hz"];
  }
  if (key === "env_int" || key === "keytrack") return pm63(key === "env_int" ? (n - 0.5) * 126 : (n * 2 - 1) * 63);
  if (key === "pan") { var p = Math.round((n - 0.5) * 126); return p === 0 ? "C" : (p < 0 ? "L" : "R") + Math.abs(p); }
  if (K127[key]) return String(k127(n));
  return null;
}
push.display(function (key, rv) {
  var n = parseFloat(rv);
  if (isNaN(n)) return;
  var f = fmt(key, n);
  if (f === null) return;
  return typeof f === "string" ? f : { value: f[0], unit: f[1] };
});
function valueOf(v, k) {
  if (!known(v, k)) return "--";
  var f = fmt(k, raw(v, k, 0));
  if (f === null) {
    if (k === "patch") { var m = /^[AB]\.\d\d/.exec(txt(v, k)); if (m) return m[0]; }
    return txt(v, k).toUpperCase() + (v[k].unit ? " " + String(v[k].unit).toUpperCase() : "");
  }
  return typeof f === "string" ? f : (f[0] + " " + f[1]).toUpperCase();
}

// ---- the panel's colours: charcoal, white print, red LEDs, walnut cheeks ---------------------------------------
var PANEL = "#252527", PANEL_DK = "#18181a", RAISE = "#2f2f32", WOOD = "#6a3a1e", WOOD_LT = "#8a5130";
var INK = "#f3f3ef", LEG = "#b4b4ae", DIM = "#6c6c6a", RULE = "#4a4a4e", GRID = "#38383b";
var LED = "#ff2d1f", LED_OFF = "#4a100b", LED_BG = "#120303", CAP = "#0e0e0f", WAVE = "#e9e7df", WAVE_FILL = "#3a3a3d";
var CURVE = "#dcdad2";

// ---- the parts -------------------------------------------------------------------------------------------------
// the three-digit LED: seven segments a digit, the unlit ones faintly there
var SEG7 = { "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg", "6": "acdefg", "7": "abc",
  "8": "abcdefg", "9": "abcdfg", "A": "abcefg", "B": "cdefg", "-": "g", " ": "" };
function seg7(g, ch, x, y, w, h, t, on, off) {
  var lit = SEG7[ch] || "", hh = Math.round(h / 2);
  var S = { a: [x + t, y, w - 2 * t, t], b: [x + w - t, y + t, t, hh - t], c: [x + w - t, y + hh, t, h - hh - t],
    d: [x + t, y + h - t, w - 2 * t, t], e: [x, y + hh, t, h - hh - t], f: [x, y + t, t, hh - t], g: [x + t, y + hh - t / 2, w - 2 * t, t] };
  for (var s in S) g.fill(S[s][0], S[s][1], S[s][2], S[s][3], lit.indexOf(s) >= 0 ? on : off);
}
// a black knob with its white line over a 300-degree travel, the scale printed round it
var K0 = Math.PI * (2 / 3), KS = Math.PI * (5 / 3);
function knob(g, cx, cy, r, f, ok, hot, bip) {
  g.arc(cx, cy, r + 4, K0, KS, 2, GRID);
  if (ok) {
    if (bip) { var m = K0 + KS / 2; g.arc(cx, cy, r + 4, Math.min(m, K0 + KS * f), Math.abs(KS * (f - 0.5)), 2, hot ? "slot" : LEG); }
    else g.arc(cx, cy, r + 4, K0, KS * f, 2, hot ? "slot" : LEG);
  }
  g.dot(cx, cy, r, CAP);
  g.arc(cx, cy, r, 0, Math.PI * 2, 1, "#3c3c40");
  if (ok) { var a = K0 + KS * f; g.line(cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), 2, hot ? "slot" : INK); }
}
function led(g, x, y, lit) { g.dot(x, y, 2.5, lit ? LED : LED_OFF); }
// the sound's place beside a knob (r: the mark's radius, outside the knob's scale): an arc in the modulation
// colour from the knob's line, and a dot
var MOD = "#3cc8e6", MOD_DK = "#1f5f6c";
function modMark(g, v, k, cx, cy, r) {
  var n = nowOf(v, k);
  if (n === null || Math.abs(n - v[k].frac) < 0.004) return;
  var f = v[k].frac;
  g.arc(cx, cy, r, K0 + Math.min(f, n) * KS, Math.abs(n - f) * KS, 2, MOD_DK);
  g.dot(cx + Math.cos(K0 + n * KS) * r, cy + Math.sin(K0 + n * KS) * r, 2.8, MOD);
}
// g.filter is given TinyK's cutoff on its own axis (at), so it draws where the sound has it; while modulation
// moves it, the knob's own mark under the response (as Pung marks it) and the way from there to the sound's
// place in the modulation colour
function cutNow(v) { return frNow(v, "cutoff", 0.5); }
function filterMod(g, v, x, y, w, h) {
  var n = nowOf(v, "cutoff");
  if (n === null || Math.abs(n - v.cutoff.frac) < 0.004) return;
  var x0 = x + 6, x1 = x + w - 6, base = y + h - 6, xs = x0 + (x1 - x0) * cutAt(v.cutoff.frac), xc = x0 + (x1 - x0) * cutAt(n);
  g.fill(xs, base - 7, 2, 7, INK);
  g.fill(Math.min(xs, xc), base - 3, Math.max(1, Math.abs(xc - xs)), 2, MOD_DK);
  g.dot(xc, base - 2, 3, MOD);
}

// ---- the oscillators as TinyK makes them (one period of Osc 1 at C4) --------------------------------------------
var AL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function tabAt(s, base, i) { return AL.indexOf(s.charAt(base + (i & 63))) / 31.5 - 1; }
var WAVES = ["SAW", "PULSE", "TRIANGLE", "SINE", "VOX", "DWGS", "NOISE"];
var WAVES2 = ["SAW", "SQUARE", "TRIANGLE"];
function noiseAt(i) { var x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return 2 * (x - Math.floor(x)) - 1; }
// Osc 1 at phase p (0..1 of its period): ctrl is Control 1 (0..1); dw the DWGS wave
function osc1At(w, p, ctrl, dw) {
  p -= Math.floor(p);
  switch (w) {
  case 0: { var p2 = p + 0.5 * ctrl; p2 -= Math.floor(p2); return 0.5 * ((2 * p - 1) + (2 * p2 - 1)) - (18.4 / 261.63) * Math.sin(2 * Math.PI * p); }
  case 1: { var pw = Math.min(0.999, 0.5 + 0.5 * ctrl), sq = p + 0.5; sq -= Math.floor(sq); return (sq < pw ? 1 : -1) - (2 * pw - 1); }
  case 2: { var tri = 2 * Math.abs(2 * p - 1) - 1, x = ((1 + 2 * ctrl) * tri + 1) * 0.25; x -= Math.floor(x); return 1 - 4 * Math.abs(x - 0.5); }
  case 3: return Math.cos(2 * Math.PI * p);
  case 4: { var vi = Math.min(16, Math.round(ctrl * 127 / 8)); return tabAt(VOX, vi * 64, Math.floor(p * 64)); }
  case 5: return tabAt(DWGS, dw * 64, Math.floor(p * 64));
  }
  return 0;
}
function osc2At(w, p) {
  p -= Math.floor(p);
  if (w === 0) { var q = p + 0.5; q -= Math.floor(q); return 2 * q - 1; }
  if (w === 1) return p < 0.5 ? 1 : -1;
  var r = p + 0.75; r -= Math.floor(r); return 2 * Math.abs(2 * r - 1) - 1;
}
// what Control 1 and 2 are on each Osc 1 wave
var CTRL1 = ["WAVEFORM", "PULSE WIDTH", "WAVEFORM", "CROSS MOD", "FORMANT", "DWGS WAVE", "LPF CUTOFF"];
var CTRL2 = ["LFO1 MOD", "LFO1 MOD", "LFO1 MOD", "LFO1 MOD", "LFO1 MOD", "", "RESONANCE"];
// one wave's points over [x0, x1], n samples, cached by everything that shapes it
var WCACHE = {}, WCOUNT = 0;
function wavePts(key, x0, x1, cy, amp, n, f) {
  var c = WCACHE[key];
  if (c) return c;
  if (++WCOUNT > 64) { WCACHE = {}; WCOUNT = 1; }
  var pts = [], pk = 0, vals = [], i;
  for (i = 0; i <= n; i++) { var y = f(i / n, i); vals.push(y); pk = Math.max(pk, Math.abs(y)); }
  var s = pk > 1e-6 ? amp / pk : 0;
  for (i = 0; i <= n; i++) pts.push(x0 + (x1 - x0) * i / n, cy - vals[i] * s);
  return (WCACHE[key] = pts);
}
// Osc 2 against Osc 1: its pitch (semitones and cents), sync restarting it at Osc 1's wrap
function osc2Ratio(v) { return Math.pow(2, (rawNow(v, "osc2_semi", 0) + raw(v, "osc2_tune", 0) / 100) / 12); }
function osc2Phase(t, ratio, sync) { return sync ? (t - Math.floor(t)) * ratio : t * ratio; } // t in Osc 1 periods

// ---- PANEL ------------------------------------------------------------------------------------------------------
// the sections: [segment, x, w, heading]; y 20..104
var SECT = [["program", 10, 198, "PROGRAM"], ["osc1", 212, 104, "OSC 1"], ["osc2", 318, 94, "OSC 2"], ["filter", 416, 166, "FILTER"],
  ["feg", 586, 120, "FILTER EG"], ["aeg", 710, 120, "AMP EG"], ["arp", 834, 116, "ARP"]];
var GENRE = ["TRANCE", "TECHNO/HOUSE", "ELECTRONICA", "DNB/BREAKS", "HIPHOP/VINTAGE", "RETRO", "SE/HIT", "INIT"];
var FILTERS = ["LP 24 dB", "LP 12 dB", "BP 12 dB", "HP 12 dB"], FILTER_NAME = ["LPF 24", "LPF 12", "BPF 12", "HPF 12"];
var SYNCRING = ["OFF", "RING", "SYNC", "RING+SYNC"];
var ARPT = ["UP", "DOWN", "ALT 1", "ALT 2", "RANDOM", "TRIGGER"], ARPRES = ["1/24", "1/16", "1/12", "1/8", "1/6", "1/4"];
var STEPS = ["arp_step1", "arp_step2", "arp_step3", "arp_step4", "arp_step5", "arp_step6", "arp_step7", "arp_step8"];

function panelGround(g, seg) {
  g.fill(0, 0, 960, 104, PANEL);
  g.fill(0, 0, 960, 19, PANEL_DK);
  g.value(16, 15, "TinyK", INK, -1);
  for (var i = 0; i < SECT.length; i++) {
    var S = SECT[i];
    g.fill(S[1], 22, S[2], 80, RAISE);
    g.fill(S[1], 22, S[2], 1, RULE);
  }
  // the LED window, the program keys
  g.fill(16, 38, 86, 32, LED_BG);
  for (var k = 0; k < 8; k++) g.fill(16 + k * 24, 74, 20, 13, PANEL_DK);
  // the scopes
  g.fill(218, 37, 92, 40, PANEL_DK);
  g.fill(322, 37, 86, 40, PANEL_DK);
  // the walnut cheeks
  g.fill(0, 0, 7, 104, WOOD); g.fill(6, 0, 1, 104, WOOD_LT);
  g.fill(953, 0, 7, 104, WOOD); g.fill(953, 0, 1, 104, WOOD_LT);
  // the encoder row
  g.fill(0, 104, 960, 56, PANEL_DK);
  g.fill(0, 104, 960, 1, RULE);
  for (var c = 1; c < 8; c++) g.fill(c * 120, 110, 1, seg ? 28 : 44, GRID);
}
// the program as the LED has it: bank, genre, number ("A.16"), from the program's own name when it says
function progCode(v) {
  var m = /^([AB])\.(\d)(\d)/.exec(txt(v, "patch")) || /^([AB])\.(\d)(\d)/.exec(txt(v, "preset_name"));
  if (m) return [m[1], m[2], m[3]];
  if (!known(v, "patch") || !known(v, "category")) return ["-", "-", "-"];
  var p = idx(v, "patch", 16), c = idx(v, "category", 8);
  return [p < 8 ? "A" : "B", String(c + 1), String(p % 8 + 1)];
}
function progName(v) {
  var s = txt(v, "preset_name") || txt(v, "patch");
  return s.replace(/^[AB]\.\d\d\s*/, "").toUpperCase();
}
function arpHead(v) {
  // "1,<length>,<next step>,<ms to it>,<step ms>,<swing>" while it runs: the lit step is the one before next
  var s = v.arp_playhead ? String(v.arp_playhead.value || "") : "", p = s.split(",");
  if (p[0] !== "1" || p.length < 3) return -1;
  var len = Math.max(1, parseInt(p[1], 10) || 8), nx = parseInt(p[2], 10) || 0;
  return ((nx - 1) % len + len) % len;
}

function panel(g, v) {
  var tk = v.$touched || "", kn = v.$knobs || [], seg = !!v.$segmode, sg = v.$segment || "", i;
  g.layer("panel|" + seg, function () { panelGround(g, seg); });
  for (i = 0; i < SECT.length; i++) g.text(SECT[i][1] + 6, 33, SECT[i][3], sg === SECT[i][0] ? INK : LEG, -1);
  // PROGRAM: the LED, the genre and the name, the eight keys, single or layer and the timbre edited
  var code = progCode(v), ph = tk === "patch" || tk === "category";
  seg7(g, code[0], 22, 42, 17, 24, 3, LED, LED_OFF);
  g.fill(43, 63, 3, 3, code[0] === "-" ? LED_OFF : LED);
  seg7(g, code[1], 50, 42, 17, 24, 3, LED, LED_OFF);
  seg7(g, code[2], 76, 42, 17, 24, 3, LED, LED_OFF);
  var gi = idx(v, "category", 8), gh = tk === "category";
  g.text(110, 50, known(v, "category") ? GENRE[gi] : "--", gh ? "slot" : LEG, -1, 94);
  g.value(110, 68, progName(v) || "--", tk === "patch" ? "slot" : INK, -1, 94);
  var num = /^\d$/.test(code[2]) ? +code[2] - 1 : -1;
  for (var k = 0; k < 8; k++) {
    var lit = k === num;
    g.text(26 + k * 24, 85, String(k + 1), lit ? (tk === "patch" ? "slot" : INK) : DIM, 0);
    if (lit) g.fill(18 + k * 24, 75, 16, 2, LED);
  }
  var layer = idx(v, "voice_mode", 2) === 1, te = idx(v, "timbre_edit", 2), mh = tk === "voice_mode", th = tk === "timbre_edit";
  led(g, 20, 97, !layer); g.text(27, 101, "SINGLE", mh ? "slot" : !layer ? INK : DIM, -1);
  led(g, 80, 97, layer); g.text(87, 101, "LAYER", mh ? "slot" : layer ? INK : DIM, -1);
  g.text(138, 101, "EDIT", th ? "slot" : layer ? LEG : DIM, -1);
  led(g, 172, 97, layer && te === 0); g.text(178, 101, "1", th ? "slot" : layer && te === 0 ? INK : DIM, -1);
  led(g, 192, 97, layer && te === 1); g.text(198, 101, "2", th ? "slot" : layer && te === 1 ? INK : DIM, -1);
  // OSC 1 and OSC 2: each wave as TinyK makes it, as loud as the mix leaves it; sync restarts Osc 2, ring
  // multiplies it by Osc 1
  var w1 = idx(v, "wave1", 7), w2 = idx(v, "wave2", 3), c1 = ctrl1Now(v, w1), c2 = raw(v, "osc1_ctrl2", 0);
  var dw = idx(v, "dwgs_wave", 64), sr = idx(v, "sync_ring", 4), ratio = osc2Ratio(v);
  var mix = fr(v, "osc_mix", 0.5), g1 = lcurve(Math.min(1, 2 * (1 - mix))) * (w1 === 1 ? 0.667 : w1 === 2 ? 1.333 : 1);
  var g2 = lcurve(Math.min(1, 2 * mix)) * (w2 === 1 ? 0.667 : w2 === 2 ? 1.333 : 1), gm = Math.max(g1, g2, 1e-6);
  var o1h = tk === "wave1" || tk === "osc1_ctrl1" || tk === "dwgs_wave", o2h = tk === "wave2" || tk === "sync_ring" || tk === "osc2_semi" || tk === "osc2_tune";
  g.text(310, 33, w1 === 5 ? "DWGS " + (dw + 1) : WAVES[w1], tk === "wave1" ? "slot" : INK, 1);
  var key1 = "o1|" + w1 + "|" + c1.toFixed(3) + "|" + dw + "|" + (g1 / gm).toFixed(2);
  var p1 = wavePts(key1, 220, 308, 57, 17 * g1 / gm, 96, function (x, j) { return w1 === 6 ? noiseAt(j) : osc1At(w1, 2 * x, c1, dw); });
  g.fill(220, 57, 88, 1, GRID);
  g.poly(p1, 2, known(v, "wave1") ? (o1h || tk === "osc_mix" ? "slot" : WAVE) : DIM);
  var ct1 = w1 === 5 ? (dw + 1) + " " + String(txt(v, "dwgs_wave")).replace(/^\d+\s*/, "").toUpperCase() : CTRL1[w1] + " " + Math.round(raw(v, "osc1_ctrl1", 0));
  g.text(218, 89, ct1, tk === "osc1_ctrl1" || tk === "dwgs_wave" ? "slot" : LEG, -1, 92);
  if (CTRL2[w1]) g.text(218, 100, CTRL2[w1] + " " + Math.round(c2), tk === "osc1_ctrl2" ? "slot" : c2 > 0 ? LEG : DIM, -1, 92);
  g.text(406, 33, WAVES2[w2] === "TRIANGLE" ? "TRI" : WAVES2[w2], tk === "wave2" ? "slot" : INK, 1);
  var key2 = "o2|" + w2 + "|" + ratio.toFixed(4) + "|" + sr + "|" + w1 + "|" + c1.toFixed(3) + "|" + dw + "|" + (g2 / gm).toFixed(2);
  var p2 = wavePts(key2, 324, 406, 57, 17 * g2 / gm, 96, function (x) {
    var t2 = 2 * x, o = osc2At(w2, osc2Phase(t2, ratio, sr >= 2));
    return sr === 1 || sr === 3 ? o * (w1 === 6 ? noiseAt(Math.round(x * 96)) : osc1At(w1, t2, c1, dw)) : o;
  });
  g.fill(324, 57, 82, 1, GRID);
  g.poly(p2, 2, known(v, "wave2") ? (o2h || tk === "osc_mix" ? "slot" : WAVE) : DIM);
  var semi = raw(v, "osc2_semi", 0), tune = raw(v, "osc2_tune", 0);
  g.text(322, 89, pm63(semi) + " ST " + pm63(tune) + " CT", tk === "osc2_semi" || tk === "osc2_tune" ? "slot" : LEG, -1, 88);
  led(g, 326, 96, sr === 2 || sr === 3); g.text(332, 100, "SYNC", tk === "sync_ring" ? "slot" : sr >= 2 ? INK : DIM, -1);
  led(g, 370, 96, sr === 1 || sr === 3); g.text(376, 100, "RING", tk === "sync_ring" ? "slot" : sr === 1 || sr === 3 ? INK : DIM, -1);
  // FILTER: Pung's response where TinyK's knob really puts the cutoff
  var ft = idx(v, "filter_type", 4), cut = fr(v, "cutoff", 0.5);
  g.text(576, 33, FILTER_NAME[ft], tk === "filter_type" ? "slot" : INK, 1);
  g.filter(420, 36, 158, 50, { cutoff: "cutoff", resonance: "resonance", type: FILTERS[ft], at: cutAt(cutNow(v)), color: CURVE });
  filterMod(g, v, 420, 36, 158, 50);
  var ei = (raw(v, "env_int", 0.5) - 0.5) * 126;
  g.text(422, 100, known(v, "cutoff") ? hzTxt(cutHz(cut)) : "--", tk === "cutoff" ? "slot" : INK, -1);
  g.text(522, 100, "RES " + k127(fr(v, "resonance", 0)), tk === "resonance" ? "slot" : LEG, 1);
  g.text(576, 100, "EG " + pm63(ei), tk === "env_int" ? "slot" : Math.abs(ei) >= 0.5 ? LEG : DIM, 1);
  // FILTER EG and AMP EG: Pung's envelopes on TinyK's times and stage shape
  g.envelope(590, 38, 112, 62, { attack: "attack1", decay: "decay1", sustain: "sustain1", release: "release1", curves: EG_CURVE, color: CURVE });
  g.text(824, 33, "LVL " + k127(fr(v, "level", 1)), tk === "level" ? "slot" : LEG, 1);
  g.envelope(714, 38, 112, 62, ampEnv(v, false));
  // ARP: the eight step keys in two rows of four (lit: the step sounding), the type, range, resolution
  var aon = idx(v, "arp_on", 2) === 1, ah = tk === "arp_on", len = Math.max(1, Math.min(8, Math.round(raw(v, "arp_length", 8)))), head = aon ? arpHead(v) : -1;
  led(g, 872, 29, aon);
  g.text(880, 33, aon ? "ON" : "OFF", ah ? "slot" : aon ? INK : DIM, -1);
  if (idx(v, "arp_latch", 2) === 1) g.text(944, 33, "LATCH", tk === "arp_latch" ? "slot" : LEG, 1);
  for (i = 0; i < 8; i++) {
    var sx = 841 + (i % 4) * 27, sy = 40 + (i >> 2) * 20, play = idx(v, STEPS[i], 2, 1) === 1, past = i >= len, sh = tk === STEPS[i];
    var on = i === head;
    if (past) { for (var d = 0; d < 22; d += 4) { g.fill(sx + d, sy, 2, 1, DIM); g.fill(sx + d, sy + 13, 2, 1, DIM); } }
    else if (on) g.fill(sx, sy, 22, 14, LED);
    else if (play) g.fill(sx, sy, 22, 14, sh ? "slot" : aon ? LEG : DIM);
    else { g.fill(sx, sy, 22, 2, sh ? "slot" : LEG); g.fill(sx, sy + 12, 22, 2, sh ? "slot" : LEG); g.fill(sx, sy, 2, 14, sh ? "slot" : LEG); g.fill(sx + 20, sy, 2, 14, sh ? "slot" : LEG); }
  }
  var at = idx(v, "arp_type", 6), rg = idx(v, "arp_range", 4) + 1;
  g.text(840, 89, ARPT[at] + "  " + rg + " OCT", tk === "arp_type" || tk === "arp_range" ? "slot" : aon ? INK : LEG, -1, 106);
  g.text(840, 100, ARPRES[idx(v, "arp_resolution", 6, 1)] + "  GATE " + Math.round(raw(v, "arp_gate", 80)) + "%", tk === "arp_resolution" || tk === "arp_gate" ? "slot" : LEG, -1, 106);
  // the page, when there are several
  var ps = v.$pages || [];
  if (!seg && ps.length > 1) g.text(946, 14, String(ps[v.$page] || "").toUpperCase() + "  " + ((v.$page || 0) + 1) + "/" + ps.length, LEG, 1);
  else if (!seg) g.text(946, 14, "BANK " + (txt(v, "bank_file") || "--").toUpperCase(), LEG, 1, 300);
  encoders(g, v, kn, tk, seg);
}
function lcurve(k) { // level_curve: the level knobs' law
  var K = [0, 16, 32, 64, 96, 127], A = [0, 0.082, 0.177, 0.404, 0.682, 1], x = Math.max(0, Math.min(1, k)) * 127;
  for (var i = 1; i < 6; i++) if (x <= K[i]) return A[i - 1] + (A[i] - A[i - 1]) * (x - K[i - 1]) / (K[i] - K[i - 1]);
  return 1;
}

// ---- the encoder row: black knobs with their white line; two-way switches as LEDs ---------------------------
var NAMES = { category: "GENRE", patch: "PROGRAM", arp_on: "ARP", voice_mode: "MODE", cutoff: "CUTOFF", resonance: "RESONANCE",
  release2: "AMP RELEASE", timbre_edit: "EDIT LAYER", wave1: "OSC1 WAVE", osc1_ctrl1: "CONTROL 1", osc1_ctrl2: "CONTROL 2",
  dwgs_wave: "DWGS WAVE", wave2: "OSC2 WAVE", sync_ring: "SYNC / RING", osc2_semi: "SEMITONE", osc2_tune: "TUNE", osc_mix: "OSC MIX",
  noise_level: "NOISE", filter_type: "TYPE", env_int: "EG INT", keytrack: "KEY TRACK", attack1: "ATTACK", decay1: "DECAY",
  sustain1: "SUSTAIN", release1: "RELEASE", attack2: "ATTACK", decay2: "DECAY", sustain2: "SUSTAIN", level: "LEVEL", pan: "PAN",
  drive: "DISTORTION", vel_sens: "VELOCITY", arp_type: "TYPE", arp_range: "RANGE", arp_resolution: "RESOLUTION", arp_gate: "GATE",
  arp_swing: "SWING", arp_latch: "LATCH", arp_key_sync: "KEY SYNC", arp_target: "TARGET", voice_assign: "VOICE",
  portamento: "PORTAMENTO", timbre_balance: "LAYER BAL", master_vol: "VOLUME", lfo1_rate: "LFO 1 RATE", lfo2_rate: "LFO 2 RATE",
  mod_wheel: "MOD WHEEL", modfx_type: "MOD FX", modfx_speed: "FX SPEED", chorus_mix: "FX DEPTH", delay_type: "DELAY",
  delay_time: "DELAY TIME", delay_feedback: "FEEDBACK", delay_mix: "DELAY DEPTH", bank_file: "BANK", detune: "DETUNE",
  sub_level: "SUB", mod_int: "MOD INT", pulse_width: "PULSE WIDTH" };
var BIP = { env_int: 1, keytrack: 1, pan: 1, osc2_semi: 1, osc2_tune: 1, arp_swing: 1 };
function encoders(g, v, kn, tk, seg) {
  for (var c = 0; c < 8; c++) {
    var k = kn[c] || "";
    if (!k) continue;
    var x0 = c * 120, cx = x0 + 20, cy = seg ? 124 : 130, hot = k === tk, ok = known(v, k);
    var two = v[k] && v[k].type === "enum" && v[k].max - v[k].min === 1 && k !== "voice_mode" && k !== "timbre_edit" ? true : (k === "arp_on" || k === "drive" || k === "arp_latch" || k === "arp_key_sync" || /^arp_step/.test(k));
    if (two) {
      var lit = ok && raw(v, k, 0) >= 0.5;
      g.dot(cx, cy, 6, lit ? LED : LED_OFF);
      if (hot) g.arc(cx, cy, 9, 0, Math.PI * 2, 2, "slot");
    } else { knob(g, cx, cy, 8, ok ? v[k].frac : 0.5, ok, hot, !!BIP[k]); modMark(g, v, k, cx, cy, 16); }
    g.text(x0 + 38, seg ? 119 : 124, NAMES[k] || String((v[k] && v[k].name) || k).toUpperCase(), hot ? "slot" : LEG, -1, 80);
    g.value(x0 + 38, seg ? 138 : 148, valueOf(v, k), hot ? "slot" : ok ? INK : DIM, -1, 80);
  }
}

push.theme({ ground: PANEL, panel: CAP, ink: INK, dim: LEG, rule: RULE, faint: GRID, accent: CURVE, knob: "pointer" });

push.compartment({
  id: "panel", label: "Panel", front_panel: true, draws_segments: true,
  segments: [
    { id: "program", label: "Program", rect: [10, 20, 198, 84], keys: ["category", "patch", "voice_mode", "timbre_edit", "voice_assign", "portamento", "timbre_balance", "master_vol"] },
    { id: "osc1", label: "Osc 1", rect: [212, 20, 104, 84], keys: ["wave1", "osc1_ctrl1", "osc1_ctrl2", "dwgs_wave"] },
    { id: "osc2", label: "Osc 2", rect: [318, 20, 94, 84], keys: ["wave2", "sync_ring", "osc2_semi", "osc2_tune", "osc_mix", "noise_level"] },
    { id: "filter", label: "Filter", rect: [416, 20, 166, 84], keys: ["filter_type", "cutoff", "resonance", "env_int", "keytrack"] },
    { id: "feg", label: "Filter EG", rect: [586, 20, 120, 84], keys: ["attack1", "decay1", "sustain1", "release1", "env_int"] },
    { id: "aeg", label: "Amp EG", rect: [710, 20, 120, 84], keys: ["attack2", "decay2", "sustain2", "release2", "level", "pan", "drive", "vel_sens"] },
    { id: "arp", label: "Arp", rect: [834, 20, 116, 84], keys: ["arp_on", "arp_type", "arp_range", "arp_resolution", "arp_gate", "arp_swing", "arp_latch", "arp_key_sync"] }
  ],
  pages: [{ label: "Perf", keys: ["category", "patch", "arp_on", "voice_mode", "cutoff", "resonance", "release2", "timbre_edit"] }],
  extra_keys: ["preset_name", "bank_file", "arp_length", "arp_step1", "arp_step2", "arp_step3", "arp_step4", "arp_step5", "arp_step6", "arp_step7", "arp_step8"],
  live_keys: ["arp_playhead"],
  screen: panel
});

// TinyK's envelope times (EG_TIME_S), for every envelope Pung draws of it
push.envelopeTimes(function (env) {
  return env.stages.map(function (s) {
    if (s.plateau || s.raw === null || s.raw === undefined || !(s.key in STAGE)) return null;
    return egSecs(+s.raw, STAGE[s.key] === 1);
  });
});

// ---- the band screens: the charcoal panel, its sections raised, headed in white ---------------------------------
function band(g, key, secs, extra) {
  g.layer(key, function () {
    g.fill(0, 0, g.w, g.h, PANEL);
    for (var i = 0; i < secs.length; i++) {
      var s = secs[i];
      g.fill(s[0], 0, s[1], g.h, RAISE);
      g.fill(s[0], 0, s[1], 1, RULE);
      g.text(s[0] + 6, 11, s[2], LEG, -1);
    }
    if (extra) extra();
  });
}

// ---- OSC -----------------------------------------------------------------------------------------------------------
function oscScreen(g, v) {
  var tk = v.$touched || "", w1 = idx(v, "wave1", 7), w2 = idx(v, "wave2", 3), c1 = ctrl1Now(v, w1), c2 = raw(v, "osc1_ctrl2", 0);
  var dw = idx(v, "dwgs_wave", 64), sr = idx(v, "sync_ring", 4), ratio = osc2Ratio(v), mix = fr(v, "osc_mix", 0.5);
  band(g, "osc", [[0, 356, "OSC 1"], [360, 476, "OSC 2"], [840, 112, "MIXER"]], function () {
    g.fill(8, 16, 232, 64, PANEL_DK); g.fill(368, 16, 232, 64, PANEL_DK);
    g.fill(10, 48, 228, 1, GRID); g.fill(370, 48, 228, 1, GRID);
  });
  var o1h = tk === "wave1" || tk === "osc1_ctrl1" || tk === "osc1_ctrl2" || tk === "dwgs_wave", o2h = tk === "wave2" || tk === "sync_ring" || tk === "osc2_semi" || tk === "osc2_tune";
  // Osc 1: two periods, as TinyK makes it
  var p1 = wavePts("O1|" + w1 + "|" + c1.toFixed(3) + "|" + dw, 12, 236, 48, 26, 160, function (x, j) { return w1 === 6 ? noiseAt(j) : osc1At(w1, 2 * x, c1, dw); });
  g.poly(p1, 2, known(v, "wave1") ? (o1h ? "slot" : WAVE) : DIM);
  g.text(350, 11, w1 === 5 ? "DWGS" : WAVES[w1], tk === "wave1" ? "slot" : INK, 1);
  g.text(248, 30, w1 === 5 ? "WAVE " + (dw + 1) : "CONTROL 1", LEG, -1);
  g.value(248, 46, w1 === 5 ? String(txt(v, "dwgs_wave")).replace(/^\d+\s*/, "").toUpperCase() : CTRL1[w1], tk === "osc1_ctrl1" || tk === "dwgs_wave" ? "slot" : INK, -1, 104);
  if (CTRL2[w1]) {
    g.text(248, 64, "CONTROL 2", LEG, -1);
    g.text(248, 78, CTRL2[w1] === "LFO1 MOD" ? "LFO 1 MOD" : CTRL2[w1], tk === "osc1_ctrl2" ? "slot" : c2 > 0 ? INK : DIM, -1, 104);
  } else g.text(248, 64, "ONE PERIOD AT C4", DIM, -1);
  // Osc 2 against Osc 1's two periods: its pitch, restarted by sync, multiplied by ring
  var p2 = wavePts("O2|" + w2 + "|" + ratio.toFixed(4) + "|" + sr + "|" + w1 + "|" + c1.toFixed(3) + "|" + dw, 372, 596, 48, 26, 160, function (x) {
    var t2 = 2 * x, o = osc2At(w2, osc2Phase(t2, ratio, sr >= 2));
    return sr === 1 || sr === 3 ? o * (w1 === 6 ? noiseAt(Math.round(x * 160)) : osc1At(w1, t2, c1, dw)) : o;
  });
  if (sr >= 2) for (var k = 1; k < 2; k++) g.fill(372 + 112 * k, 18, 1, 60, LED_OFF); // Osc 1's wrap: where sync restarts it
  g.poly(p2, 2, known(v, "wave2") ? (o2h ? "slot" : WAVE) : DIM);
  g.text(830, 11, WAVES2[w2], tk === "wave2" ? "slot" : INK, 1);
  var semi = raw(v, "osc2_semi", 0), tune = raw(v, "osc2_tune", 0), ph = tk === "osc2_semi" || tk === "osc2_tune";
  g.text(612, 30, "PITCH", LEG, -1);
  g.value(612, 46, pm63(semi) + " ST " + pm63(tune) + " CT", ph ? "slot" : INK, -1, 216);
  g.text(612, 64, "SYNC / RING", LEG, -1);
  var srs = ["SEPARATE", "RING: OSC 1 X OSC 2", "SYNC: RESTARTS WITH OSC 1", "RING AND SYNC"][sr];
  g.text(612, 78, srs, tk === "sync_ring" ? "slot" : sr ? INK : DIM, -1, 216);
  // the mixer: each source's level by its knob's law, the wave's own level with it
  var g1 = lcurve(Math.min(1, 2 * (1 - mix))) * (w1 === 1 ? 0.667 : w1 === 2 ? 1.333 : 1), g2 = lcurve(Math.min(1, 2 * mix)) * (w2 === 1 ? 0.667 : w2 === 2 ? 1.333 : 1);
  var nz = lcurve(frNow(v, "noise_level", 0)), mx = Math.max(1, g1, g2);
  g.mix(846, 16, 100, 66, [g1 / mx, g2 / mx, nz], { color: CURVE });
}

// ---- FILTER: the response, how far the envelope and the keys move it, the filter EG ---------------------------------
function filterScreen(g, v) {
  var tk = v.$touched || "", ft = idx(v, "filter_type", 4), cut = fr(v, "cutoff", 0.5), hz = cutHz(cut);
  var bip = (raw(v, "env_int", 0.5) - 0.5) * 2, sus = fr(v, "sustain1", 0), kt = (fr(v, "keytrack", 0.5) * 2 - 1) * 63;
  var kto = Math.abs(kt) <= 48 ? Math.abs(kt) / 48 : 1 + (Math.abs(kt) - 48) / 15;
  band(g, "filter", [[0, 476, "FILTER"], [480, 472, "FILTER EG"]]);
  g.text(470, 11, FILTER_NAME[ft], tk === "filter_type" ? "slot" : INK, 1);
  g.filter(4, 14, 468, 70, { cutoff: "cutoff", resonance: "resonance", type: FILTERS[ft], at: cutAt(cutNow(v)), color: CURVE });
  filterMod(g, v, 4, 14, 468, 70);
  // the envelope's reach: +-63 is 7.98 octaves at the envelope's top (and its sustain), never past the knob's top
  var x0 = 10, x1 = 466, a0 = cutAt(cut);
  function axX(h) { return x0 + (x1 - x0) * Math.max(0, Math.min(1, Math.log(Math.max(20, h) / 20) / Math.LN10 / 3)); }
  if (Math.abs(bip) > 0.008) {
    var xc = x0 + (x1 - x0) * a0, xp = axX(hz * Math.pow(2, bip * 7.98)), xs = axX(hz * Math.pow(2, bip * 7.98 * sus));
    var ec = tk === "env_int" ? "slot" : LED, y = 76, d = xp > xc ? -6 : 6;
    g.fill(Math.min(xc, xp), y - 1, Math.abs(xp - xc), 2, ec);
    g.poly([xp + d, y - 5, xp, y, xp + d, y + 5], 2, ec);
    g.fill(xs - 1, y - 4, 2, 9, ec);
    g.text(xp - d * 1.5, y - 6, "EG " + pm63(bip * 63), ec, d < 0 ? 1 : -1);
  }
  g.text(66, 11, hzTxt(hz), tk === "cutoff" ? "slot" : INK, -1);
  g.text(146, 11, "RES " + k127(fr(v, "resonance", 0)), tk === "resonance" ? "slot" : LEG, -1);
  g.text(340, 11, Math.round(kt) === 0 ? "KEYS: NO TRACKING" : "KEYS: " + (kt < 0 ? "-" : "") + kto.toFixed(2) + " OCT / OCT", tk === "keytrack" ? "slot" : LEG, 0);
  g.envelope(484, 16, 464, 68, { attack: "attack1", decay: "decay1", sustain: "sustain1", release: "release1", labels: true, curves: EG_CURVE, color: CURVE });
}

// ---- AMP: level, pan, distortion, velocity; the amp EG -----------------------------------------------------------
function ampScreen(g, v) {
  var tk = v.$touched || "", lv = fr(v, "level", 1), pan = fr(v, "pan", 0.5), dist = idx(v, "drive", 2) === 1, vs = fr(v, "vel_sens", 0);
  band(g, "amp", [[0, 476, "AMP"], [480, 472, "AMP EG"]]);
  // over each knob: the level (the amp's gain is its square), the pan (constant power), distortion, velocity
  var lh = tk === "level";
  g.fill(20, 24, 80, 6, PANEL_DK); g.fill(20, 24, Math.round(80 * lv), 6, lh ? "slot" : CURVE);
  var ln = nowOf(v, "level");
  if (ln !== null && Math.abs(ln - lv) > 0.004) { g.fill(20 + 80 * Math.min(lv, ln), 32, Math.max(1, 80 * Math.abs(ln - lv)), 2, MOD_DK); g.dot(20 + 80 * ln, 33, 3, MOD); }
  g.value(20, 52, String(k127(lv)), lh ? "slot" : INK, -1);
  g.text(20, 68, lv > 0 ? (40 * Math.log(lv) / Math.LN10).toFixed(1) + " DB" : "OFF", DIM, -1);
  var ph = tk === "pan", px = 140 + 80 * pan;
  g.fill(140, 27, 80, 1, LEG); g.fill(180, 22, 1, 11, LEG);
  g.dot(px, 27, 4, ph ? "slot" : INK);
  g.value(140, 52, fmt("pan", pan), ph ? "slot" : INK, -1);
  // constant power: each side cos / sin of the position, x 1.414 (0 dB each in the centre)
  function sdb(x) { x *= 1.4142; if (x < 0.001) return "OFF"; var d = Math.round(200 * Math.log(x) / Math.LN10) / 10; return d === 0 ? "0.0" : (d > 0 ? "+" : "") + d.toFixed(1); }
  g.text(140, 68, "L" + sdb(Math.cos(pan * Math.PI / 2)) + " R" + sdb(Math.sin(pan * Math.PI / 2)) + " DB", DIM, -1, 116);
  var dh = tk === "drive";
  g.dot(266, 27, 4, dist ? LED : LED_OFF);
  if (dh) g.arc(266, 27, 7, 0, Math.PI * 2, 2, "slot");
  g.value(260, 52, dist ? "DIST ON" : "CLEAN", dh ? "slot" : dist ? INK : LEG, -1);
  g.text(260, 68, dist ? "SOFT CLIPPING" : "", DIM, -1, 110);
  var vh = tk === "vel_sens";
  g.fill(380, 24, 80, 6, PANEL_DK); g.fill(380, 24, Math.round(80 * vs), 6, vh ? "slot" : CURVE);
  g.value(380, 52, String(k127(vs)), vh ? "slot" : INK, -1);
  g.text(380, 68, vs < 0.01 ? "NOTES ALIKE" : "SOFT IS QUIET", DIM, -1, 92);
  g.envelope(484, 16, 464, 68, ampEnv(v, true));
}

// ---- EFFECTS: the mod effect's sweep, the delay's repeats ----------------------------------------------------------
var MFX = ["CHORUS / FLANGER", "ENSEMBLE", "PHASER"], MFX_WAVE = ["Triangle", "Sine", "Triangle"];
var MFX_SAY = ["1 TAP, 2-8 MS", "4 TAPS, 8-12 MS", "SIX ALL-PASSES"];
var DLY = ["STEREO", "CROSS", "L/R"], DLY_SAY = ["EACH SIDE ITS OWN", "REPEATS SWAP SIDES", "MONO IN, L R L R"];
function fxScreen(g, v) {
  var tk = v.$touched || "", mt = idx(v, "modfx_type", 3), depth = fr(v, "chorus_mix", 0), sp = rateHz(MFX_HZ, fr(v, "modfx_speed", 0.3));
  var dt = idx(v, "delay_type", 3), sync = Math.round(raw(v, "delay_sync", -1)), L = v.$live, bpm = L && L.known && L.bpm > 0 ? L.bpm : 120;
  var secs = sync >= 0 ? 240 / bpm * SYNC_NOTE[Math.round(fr(v, "delay_time", 0.5) * 14)] : delaySecs(fr(v, "delay_time", 0.5));
  band(g, "fx", [[0, 356, "MOD FX"], [360, 476, "DELAY"], [840, 112, "OUT"]]);
  // the mod effect: its sweep, at its speed and depth (off at depth 0)
  var mh = tk === "modfx_type" || tk === "modfx_speed" || tk === "chorus_mix";
  g.text(350, 11, MFX[mt], tk === "modfx_type" ? "slot" : INK, 1);
  g.lfo(8, 16, 220, 46, { shape: MFX_WAVE[mt], rate: "modfx_speed", trig: false, color: depth > 0 ? CURVE : DIM });
  g.text(118, 76, sp.toFixed(sp < 10 ? 2 : 1) + " HZ", tk === "modfx_speed" ? "slot" : depth > 0 ? INK : DIM, 0);
  g.text(240, 30, "DEPTH", LEG, -1);
  g.value(240, 46, depth > 0 ? String(k127(depth)) : "OFF", tk === "chorus_mix" ? "slot" : depth > 0 ? INK : DIM, -1);
  g.text(240, 64, MFX_SAY[mt], DIM, -1, 110);
  // the delay: the dry note, then each repeat at its time, the send's gain then the feedback's each time
  var send = delayGain(fr(v, "delay_mix", 0), secs), fb = delayGain(fr(v, "delay_feedback", 0), secs), on = fr(v, "delay_mix", 0) > 0.005;
  g.text(830, 11, DLY[dt], tk === "delay_type" ? "slot" : INK, 1);
  var X0 = 372, W = 300, B = 76, H = 56, span = Math.max(1, Math.ceil(secs * 6)), dh = tk === "delay_time" || tk === "delay_feedback" || tk === "delay_mix";
  for (var s = 0; s <= span; s++) { var tx = X0 + W * s / span; g.fill(tx, B + 1, 1, 3, DIM); }
  g.fill(X0, B, W, 1, DIM);
  g.fill(X0, B - H, 3, H, INK); // the note itself
  var lvl = send, n = 1;
  while (on && n < 40) {
    var x = X0 + W * n * secs / span;
    if (x > X0 + W || lvl < 0.004) break;
    var side = dt === 0 ? 0 : (dt === 1 ? (n % 2 ? 1 : -1) : (n % 2 ? -1 : 1));
    g.fill(x, B - H * Math.min(1, lvl), 3, H * Math.min(1, lvl), dh ? "slot" : side < 0 ? CURVE : side > 0 ? LEG : CURVE);
    lvl *= fb; n++;
  }
  g.text(X0 + W, 30, span + " S", DIM, 1);
  var tt = sync >= 0 ? SYNC_NAME[Math.round(fr(v, "delay_time", 0.5) * 14)] + " AT " + Math.round(bpm) + " BPM" : secTxt(secs);
  g.text(684, 30, "TIME", LEG, -1);
  g.value(684, 46, on ? tt : "OFF", tk === "delay_time" ? "slot" : on ? INK : DIM, -1, 146);
  g.text(684, 64, on ? (fb > 0 ? "EACH REPEAT " + (20 * Math.log(fb) / Math.LN10).toFixed(1) + " DB" : "ONE REPEAT") : "", tk === "delay_feedback" ? "slot" : LEG, -1, 146);
  g.text(684, 78, DLY_SAY[dt], DIM, -1, 146);
  // the output level
  var mv = fr(v, "master_vol", 0.8), vh = tk === "master_vol";
  g.fill(850, 26, 8, 54, PANEL_DK); g.fill(850, 80 - Math.round(54 * mv), 8, Math.round(54 * mv), vh ? "slot" : CURVE);
  g.value(870, 46, String(k127(mv)), vh ? "slot" : INK, -1);
  g.text(870, 62, "VOLUME", DIM, -1);
}

// ---- ARP: eight steps over the eight encoders, the order the type plays a C major chord in ------------------------
var CHORD = [0, 4, 7], ROWNAME = ["C", "E", "G"];
function arpOrder(type, range) {
  var up = [], i, o;
  for (o = 0; o < range; o++) for (i = 0; i < 3; i++) up.push(CHORD[i] + 12 * o);
  if (type === 1) return up.slice().reverse();
  var seq = up.slice();
  if (type === 2) for (i = up.length - 2; i >= 1; i--) seq.push(up[i]);
  if (type === 3) for (i = up.length - 1; i >= 0; i--) seq.push(up[i]);
  return seq;
}
function arpScreen(g, v) {
  var tk = v.$touched || "", aon = idx(v, "arp_on", 2) === 1, type = idx(v, "arp_type", 6), range = idx(v, "arp_range", 4) + 1;
  var gate = Math.max(0.02, raw(v, "arp_gate", 80) / 100), swing = raw(v, "arp_swing", 0) / 100, len = Math.max(1, Math.min(8, Math.round(raw(v, "arp_length", 8))));
  var head = aon ? arpHead(v) : -1, res = idx(v, "arp_resolution", 6, 1);
  var rows = 3 * range + 1, top = 18, bot = 80, rh = (bot - top) / (rows - 1);
  band(g, "arp|" + range, [[0, 952, "ARPEGGIATOR"]], function () {
    for (var r = 0; r < rows - 1; r++) { var y = bot - r * rh; if (r % 3 === 0) g.fill(4, y, 944, 1, GRID); }
    for (var c = 1; c < 8; c++) g.fill(c * 120, 16, 1, 68, GRID);
  });
  g.text(944, 11, (aon ? "ON" : "OFF") + "   " + ARPT[type] + "   " + range + " OCT   " + ARPRES[res] + "   GATE " + Math.round(gate * 100) + "%   SWING " + pm63(swing * 100) + "%" + (idx(v, "arp_latch", 2) ? "   LATCH" : ""), aon ? INK : LEG, 1);
  var seq = arpOrder(type, range), pos = 0, sh = tk === "arp_gate" || tk === "arp_swing" || tk === "arp_type" || tk === "arp_range";
  for (var s = 0; s < 8; s++) {
    var play = idx(v, STEPS[s], 2, 1) === 1 && s < len, x0 = s * 120, hot = tk === STEPS[s];
    // the step starts on the grid, every second one swing / 3 of a step late
    var off = (s & 1) ? swing / 3 : 0, xs = x0 + 8 + 104 * off * 0.5, ws = 104 * gate * (1 - ((s & 1) ? swing / 3 : 0) * 0.5);
    var lit = s === head, col = hot ? "slot" : lit ? LED : sh ? "slot" : aon ? CURVE : LEG;
    if (s >= len) { g.text(x0 + 60, 52, "-", DIM, 0); continue; }
    if (!play) { g.text(x0 + 60, 52, "REST", hot ? "slot" : DIM, 0); continue; }
    if (type === 5) { // TRIGGER: the whole chord, an octave up each step over the range
      var oc = (pos % range) * 12;
      for (var i = 0; i < 3; i++) g.fill(xs, bot - (CHORD[i] + oc) / 4 * rh - 4, ws, 8, col);
    } else if (type === 4) { // RANDOM: any note of the order
      for (var j = 0; j < seq.length; j++) g.fill(xs + ws / 2 - 2, bot - seq[j] / 4 * rh - 2, 4, 4, hot ? "slot" : DIM);
      g.text(x0 + 60, top + 8, "?", col, 0);
    } else {
      var nt = seq[pos % seq.length];
      g.fill(xs, bot - nt / 4 * rh - 4, ws, 8, col);
      g.text(xs, bot - nt / 4 * rh - 7, ROWNAME[(nt % 12) === 0 ? 0 : (nt % 12) === 4 ? 1 : 2] + (Math.floor(nt / 12) + 4), lit ? LED : DIM, -1);
    }
    pos++;
  }
}

push.compartment({ id: "osc", label: "Osc",
  pages: [{ label: "Osc", keys: ["wave1", "osc1_ctrl1", "osc1_ctrl2", "wave2", "sync_ring", "osc2_semi", "osc2_tune", "osc_mix"] },
    { label: "Osc +", keys: ["dwgs_wave", "noise_level", "sub_level", "pulse_width", "detune"] }],
  screen: oscScreen });
push.compartment({ id: "filter", label: "Filter",
  pages: [{ label: "Filter", keys: ["filter_type", "cutoff", "resonance", "env_int", "attack1", "decay1", "sustain1", "release1"] },
    { label: "Key Track", keys: ["keytrack"] }],
  screen: filterScreen });
push.compartment({ id: "amp", label: "Amp",
  pages: [{ label: "Amp", keys: ["level", "pan", "drive", "vel_sens", "attack2", "decay2", "sustain2", "release2"] }],
  screen: ampScreen });
push.compartment({ id: "mod", label: "Mod",
  pages: [{ label: "Mod", keys: ["lfo1_rate", "lfo2_rate", "mod_int", "mod_wheel", "voice_assign", "portamento", "timbre_balance", "master_vol"] }] });
push.compartment({ id: "fx", label: "Effects",
  pages: [{ label: "Effects", keys: ["modfx_type", "modfx_speed", "chorus_mix", "delay_type", "delay_time", "delay_feedback", "delay_mix", "master_vol"] }],
  extra_keys: ["delay_sync"], screen: fxScreen });
push.compartment({ id: "arp", label: "Arp",
  pages: [{ label: "Arp", keys: ["arp_type", "arp_range", "arp_resolution", "arp_gate", "arp_swing", "arp_latch", "arp_key_sync", "arp_target"] },
    { label: "Steps", keys: STEPS }],
  extra_keys: ["arp_on", "arp_length"], live_keys: ["arp_playhead"], screen: arpScreen });
