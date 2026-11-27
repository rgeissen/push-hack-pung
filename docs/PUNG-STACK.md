# The Pung stack: where it goes, in phases

A design document (2026-11-27). It states the owner's ambition, what Reason Studios does that it is measured
against, what must hold for a Live Set to open the same anywhere, and the phases that get there. Every phase
ends in something a player can use. Nothing after Phase 0 is built unless a line says so.

## The ambition

The owner's words, 2026-11-27:

- "My main goal is Set compatibility: between Pung with Ableton Live on a Push and Pung with Ableton Live on
  macOS or on Windows."
- "A stack is all Pung modules (and settings) that are associated with an Ableton Live Set, including the MIDI
  assignments."
- "My ambition is to have a similar stack as Reason Studios offers, but for open-source modules", and to
  "commercialize the Pung stack as the deployment infrastructure" once it travels beyond the Push.

In one sentence: **what the Reason Rack is for Reason's own devices, the Pung stack is for open-source
modules: the same instruments, effects and MIDI generators in every place a musician works, and a Set that
opens the same in each.** The modules stay free and open. What is sold is getting them, and a Set's whole
stack, onto every machine without work.

## Words

- **The Pung stack**: the whole thing: the modules, the host that runs them, the way they appear in a DAW, and
  the deployment that puts them on a machine. The counterpart of "the Reason Rack".
- **A stack**: what one Live Set uses of it: every Pung device in the Set, on its track and in its place,
  with its module, version and state, and what those need (firmware, samples, sounds). The MIDI and automation
  made against those devices are Live's and travel in the Set; a stack makes sure they still land on the
  right controls.
- **A patch**: what one Pung device holds (an instrument with the MIDI effect in front of it, Pung's
  modulation). This is what the Stacks page built on 2026-11-27 takes and sends: it was called a stack then,
  and is not one in the owner's sense. Reason's word for the same thing is a patch, or a Combinator patch.
- **A deployment**: a Pung that runs somewhere (CLAUDE.md, Words).

## What Reason Studios does

Read on 2026-11-27: reasonstudios.com (home, Reason 14, Reason Rack 14, Reason Free, the shop) and the Reason
13/14 manuals (the rack, the Combinator, Players, song files, the plugin's audio and MIDI). Not reached: the
plugin manual's chapters on automation and Remote, the help centre (it refuses automated readers) and the
Reason+ page. Sources are at the end.

| | Reason | Pung today | The gap |
|---|---|---|---|
| **One rack, several shells** | The Rack is "the heart of Reason": a standalone DAW, and since 2019 a plugin (VST3, AU, AAX) for macOS and Windows that works "natively in all major DAWs". | One shell: Ableton Live on Push 3 Standalone. | Live on macOS and Windows; later other DAWs. |
| **The same everywhere** | A project "will open and work the same on both platforms (provided of course that Reason is installed on both computers)". | Not promised, and not true today (The Set contract, below). | The contract, then the shells. |
| **The devices** | 68 in Reason Rack 14, over 90 with Reason+, in four kinds: instruments, effects, Player MIDI effects, utilities. | 132 modules in three kinds: instruments, audio effects, MIDI generators. Open source, each with its licence. | No utilities, and no device that combines others. |
| **Others' devices** | Rack Extensions: made by Reason Studios and many third parties, sold (and some given) in one shop; "they behave just like built-in devices". | Every module is someone else's open-source work, packaged by Pung. | A way for makers to publish themselves; later, paid ones. |
| **Getting them onto a machine** | The Reason Companion app: an account, a Devices tab with "Install all", sound packs; a second computer is set up by logging in and installing all. | pung.live: the installer, Modules, Deployments; a signed module pack; no account. | "Everything this Set needs, on this machine" in one step. |
| **Something is missing** | A missing Rack Extension becomes a silent "Missing Device" placeholder; installed later, it is "restored with all settings intact". Missing samples open a "Missing Sounds" window. | A Set with a module that is not there shows a plugin Live cannot find. | A placeholder that keeps the state, and says what to install. |
| **A Set that carries its sounds** | "A self-contained song contains not only the references to the used samples and REX files, but also the files themselves." | A state names a sample by its path on that Push. | Samples that travel, found by content, not by path. |
| **Several devices as one** | The Combinator: any devices with their connections, saved as one patch (.cmb), with up to 32 knobs and 32 buttons assigned to their controls. | One MIDI effect in front of an instrument, inside one device. Pung's modulation. | The stack as one playable device with knobs of its own (Phase 4). |
| **MIDI effects** | Players sit above an instrument and run top to bottom; a MIDI Out device sends their notes to the host. | MIDI generators: one in front of an instrument, or a device of their own. | Chains of more than one. |
| **In the host** | One plugin instance is one rack: MIDI in, two stereo inputs, sixteen stereo outputs, an instrument and an effect version. In Live, a control gets an automation lane only when it is asked for ("Configure"). | Each module is its own Live device with all its controls as Live parameters, so Push's own view, automation and mapping work without set-up. | Pung's way is the better fit for Live and the Push. It is also why parameter positions matter (below). |
| **What is sold** | Reason 14 at €269, Reason Rack 14 at €179, Reason+ at $169 a year, Rack Extensions one by one; Reason Free (15 devices, a free account). Authorised by account: a month offline, three computers for longer. | Nothing. | Phase 3. |

What to take from them: one rack in every shell; a companion that installs everything; a placeholder that
loses nothing; songs that carry their samples; the Combinator. What to do differently: the modules are open
and free and stay so; no licence server stands between a player and an instrument (Pung works offline, and
its modules are never "authorised"); a module is a device of the host, not a rack hidden inside one plugin
window; firmware is always the player's own.

## The Set contract

For a Set saved in one place to open the same in another, five things must hold. They are the centre of this
plan: every phase either establishes one or builds on them.

1. **Identity.** A module is the same device everywhere. *Holds:* its identifier in Live is made from its
   kind and its id alone (`livedevice.ClassUID`, `src/devices.go`).
2. **Parameter positions.** Live stores automation, clip envelopes and MIDI and Macro mappings by a
   parameter's position in the device (`src/stablelayout.go`: giving parameters ids of their own crashed Live
   13). *Does not hold:* an instrument's list also carries the parameters of every MIDI effect installed on
   that machine, and each installation keeps the order it grew with (`classes-known.json`). Two Pungs with
   different histories can disagree, and a Set then plays its automation on a neighbouring control. **This is
   the one clause that gets more expensive with every Set saved**, so it is fixed first (Phase 0).
3. **State.** What a device saves must mean the same elsewhere. *Mostly holds:* a module's state is its own.
   *Does not:* a device's state names its MIDI effect by its place in that machine's list (found while
   building patches, 2026-11-27), and samples by their path.
4. **Versions.** A Set saved with a module's version opens with a later one. *Assumed, not checked:* nothing
   tests that a module still reads the state its previous version wrote.
5. **What lies outside the Set.** Modules, firmware, samples, saved sounds. *Does not hold:* nothing says what
   a Set needs, or brings it along. Firmware never travels: it is named, and must be the player's own.

## The phases

Sizes are orders of magnitude, not promises: **S** days, **M** weeks, **L** months, **XL** many months.

### Phase 0: the launch, and the contract's first clause (S to M)

*Value:* 132 open-source modules on a Push 3, each with a screen made for it; pung.live; the installer. And
every Set saved from this release on can be carried later.

*What is built:*
- **A fixed order of parameters for each module, shipped in the module pack**, in place of an order that
  grows on each machine. A registry in the catalog, append-only: a module's parameters in the order they
  were first published; a new one goes to the end; the MIDI effects' parameters in one order for everyone,
  with placeholders where an effect is not installed. `build-catalog.py` refuses a pack that moves an entry.
  To be worked out and measured before anything changes: what a class of 256 entries can hold, what Live
  shows of it, and what happens to Sets already saved on the owner's Push.
- A device's state names its MIDI effect by id.
- The Stacks page as built: out of the menu, or under the name "Patches". A decision (below).

*Done when:* two Pushes, set up at different times with different modules, give every module the same
parameter list; a Set with automation saved on one opens on the other with the automation on the same
controls.

*Risk:* a class's list is close to full for the largest instruments; the MIDI effects' block may have to
become a fixed number of general slots. Sets saved before the change keep their machine's order and need a
one-time conversion or a kept exception.

### Phase 1: a Set's stack, between two Pushes (M)

*Value:* "this Set, on that Push": a second Push, a friend's Push, or the same Push after a reset plays the
Set as it was. A player sees what a Set uses and what it needs before anything is missing on stage.

*What is built:*
- **The stack of the open Set**: every Pung device with its track, its place in the chain, module, version,
  state, and what it needs (Pung asks Live through the Remote Script which device is where; it has the rest).
  pung.live shows it on Deployments and keeps it; a stack is a file.
- **Send a stack to a deployment**: it installs the modules that are missing from the pack, names the
  firmware that must be there, and brings the samples and saved sounds the states refer to (by content, to a
  place the receiving Pung maps: clause 3 and 5).
- **A placeholder for a module that is not there**: the device stays in the Set, silent, with its state kept
  whole and a line saying what to install; installed, it plays as saved. (Reason's "Missing Device".)
- **A check of clause 4** in the release: each changed module loads the state its last released version
  wrote, in `render-check`.

*Done when:* a Set made on one Push, with samples, an emulator and automation, is moved by Ableton's own Set
transfer to a second Push; pung.live prepares that Push from the stack in one step; the Set opens and sounds
the same; with one module left out on purpose, its placeholder keeps the state.

*Commercial:* nothing is sold. This is the free core: one's own machines of one kind, by hand or by file.

### Phase 2: Pung in Live on the computer (L to XL)

*Value:* the reason for all of it: start on the Push, finish in Live on a Mac or a PC (and the other way),
which is how Ableton means the Push to be used. The first thing a musician who never hacks a Push can use.

*What is built, in this order:*
- **A proof, before a plan** (S): Pung as a plugin in Live on macOS with one simple module, opening a Set
  moved from the Push. It answers what the rest costs.
- **The shell**: the plugin Live loads (VST3 on macOS and Windows; core's Linux plugin is the model), and
  Pung beside it as it runs on the Push (a local service the plugin talks to), so one code base serves
  both. The module's screen is the page Pung already serves for every device, shown in the plugin's window.
- **The modules, built for macOS and Windows**: a survey first (which of the 132 build as they are, which
  need work, which cannot), then the builds in the catalog as further packages of the same version. The
  emulators come from a desktop project and should be the easiest; a module that is not there yet is a
  placeholder (Phase 1), not a broken Set.
- **The installer for the computer** and pung.live's Deployments for a second kind (`site/pushlink.js`
  `KINDS` was made for it).

*Done when:* the Phase 1 test passes between a Push and a Mac, in both directions, automation and MIDI
mappings included; then the same with Windows.

*Risks:* the size of the module work is unknown until the survey; realtime audio between a plugin and a
service on desktop systems; signing and notarising for macOS and Windows; Pung's modules are GPL-3.0 in
large part, which a paid offering around them must respect (source offered, no added restrictions: to be
checked by someone who can advise on licences).

*Commercial:* the first moment something can be sold, because the product no longer needs a hacked Push
(below).

### Phase 3: the deployment service (L)

*Value:* what the Reason Companion gives its users, for open modules: sign in on any machine and it becomes
ready for your Sets.

*What is built:* an account on pung.live; a player's stacks and deployments kept there (today they are kept
in one browser); "prepare this machine for this Set" across kinds of machine; samples and saved sounds
synchronised between a player's deployments (never firmware); versions of a stack; a stack shared with
someone else; notices when a module a Set uses has an update, and what it changes.

*Done when:* a new computer goes from nothing to playing a named Set in one sitting, with no file carried by
hand.

*What it needs that is not software:* hosting that is not the owner's DiskStation; a legal form that can
sell; payment; terms; a data-protection footing for accounts (the privacy page changes on that day).

### Phase 4: a stack as one device, and other hosts (L)

*Value:* Pung for musicians who do not use Live, and one playable device out of several modules.

*What is built:* a single plugin that holds a whole stack (MIDI generators, an instrument, effects behind
it) with knobs of its own assigned to the modules' controls, saved and shared as one file: the Combinator's
counterpart, and the Reason Rack plugin's. With it, the plugin formats other hosts need (AU, AAX, CLAP).
Chains of more than one MIDI generator. Here the host sees only the stack's own knobs, as Reason's plugin
lets a host see only what the player picks, so clause 2 does not limit it.

### Phase 5: makers, and a marketplace (after there is pull)

*Value:* more modules than Pung can port; a living for those who make them.

*What is built:* a way for a maker to publish a module into the catalog themselves (the pack's signing and
the build checks are the gate); packs of stacks and sounds; paid modules and packs beside the free ones.
The Vision page said "paid modules later"; the sentence was taken out on the owner's word and comes back
only when they say there is enough pull.

## What is sold, and what never is

- **Never:** the modules (open, free, each under its licence); playing them on one's own machine; a stack
  as a file and its format; firmware, in any form.
- **Free:** Pung on a Push; Phase 1 in full; the plugin itself, as open source.
- **Sold (from Phase 3):** the deployment service: the account, a player's stacks and sounds on every machine
  and kind of machine, preparation in one step, sharing, versions. Later (Phase 5) a share of what makers
  sell.
- **Why there:** it is the part that costs to run, that players of Reason already pay for, and that stays
  honest beside open modules: nobody pays for someone else's free work, they pay for not having to carry it.
- **Where not:** nothing commercial runs on, or depends on, a hacked Push. The Push stays the place Pung is
  given away; selling starts where Pung is an ordinary plugin.

## Choices that shape it

1. **A module as its own device in the host (today), or one plugin that holds the rack (Reason).** Keep
   today's for Live: it is what makes Push's view, automation and mapping work without set-up, and it is
   Pung's difference. Add the one-plugin stack in Phase 4 for other hosts.
2. **Pung beside the plugin, or inside it.** Beside, as on the Push: one code base, the web page as the
   screen, a crash that does not take the host down. The proof in Phase 2 measures whether it holds for
   realtime on a desktop system.
3. **A fixed parameter order (Phase 0), or parameters picked on demand (Reason in Live).** Fixed, for the
   devices in Live: on demand would take the controls away from Push's own view. On demand for the Phase 4
   plugin.
4. **Where a player's things live before there are accounts.** In their browser and in files, as now; the
   account (Phase 3) is the service, not a requirement.

## Risks

- **Ableton.** Pung on the Push is a hack on a product whose maker has not agreed to it; on a computer it is
  an ordinary plugin. The plan moves the weight there. Their marks are used only to say what Pung runs on.
- **Licences.** Many modules are GPL-3.0; some forbid distribution and are left out. A paid service around
  them is possible and needs advice before it is offered.
- **Effort.** Phase 2 is the largest piece of work in the project so far, and its size is unknown until the
  survey and the proof.
- **The upstream.** The modules are Schwung's and their authors'. The plan is good for them only if they
  see it early (the note to Charles, drafted 2026-11-27).
- **One person.** The service in Phase 3 has to be run, not only built.

## Decisions for the owner

1. Phase 0's parameter order before the launch, or the launch first and the order in the release after?
   (Recommended: before. Every Set saved in between is one that needs converting.)
2. The page built as "Stacks": out of the menu for the launch, or kept as "Patches"?
3. macOS before Windows for the proof in Phase 2? (Recommended: yes; the owner's own machine.)
4. Whether "the Pung stack" becomes the name on the site, and when.

## Sources

Read on 2026-11-27.

- Reason Studios: [home](https://www.reasonstudios.com/), [Reason 14](https://www.reasonstudios.com/shop/product/reason),
  [Reason Rack 14](https://www.reasonstudios.com/shop/product/reason-rack-14/), [Reason Free](https://www.reasonstudios.com/reason-free),
  [the shop](https://www.reasonstudios.com/shop), [the Rack](https://reasonstudios.com/rack),
  [the Rack plugin in any DAW: routing](https://www.reasonstudios.com/news/post/use-the-reason-rack-plugin-in-any-daw-the-basics-of-routing).
- Manuals: [Reason 14, introduction](https://docs.reasonstudios.com/reason14/introduction),
  [Reason Rack Plugin 14, introduction](https://docs.reasonstudios.com/rackplugin14/introduction),
  [Rack Plugin: audio and MIDI basics](https://docs.reasonstudios.com/rackplugin13/audio-and-midi-basics),
  [the Combinator](https://docs.reasonstudios.com/rackplugin13/the-combinator),
  [working with the rack](https://docs.reasonstudios.com/reason13/working-with-the-rack),
  [working with Players](https://docs.reasonstudios.com/reason13/working-with-players),
  [song file handling](https://docs.reasonstudios.com/reason13/song-file-handling),
  [Rack Extensions in a song (Reason 12)](https://docs.propellerheads.se/reason12/RackExtensions.13.5.html).
- Sound On Sound: [Using the Reason plug-in within Ableton Live](https://www.soundonsound.com/techniques/using-reason-plug-within-ableton-live)
  (2020, Reason 11: how Live automates the plugin's controls).
- Search results only, not read at the source: the Reason Companion's "Install all" and moving to another
  computer (help.reasonstudios.com), and third-party price listings.
