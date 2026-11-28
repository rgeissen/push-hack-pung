# Skills for making Pung modules and interfaces

Instructions an AI assistant loads when the work calls for them (the open Agent Skills format: a folder
with a `SKILL.md`). They carry what Pung's own development has learned, so an assistant that has never
seen Pung can help design and build for it.

| Skill | For |
|---|---|
| `pung-interface` | A module's interface on the Push: its `push_ui.js`, from a theme to a front panel with segments |
| `pung-module` | Making or porting a module: the format, the build for the Push, checking it without a Push, the module pack |

- **In this repository** they are ready: Claude Code finds them through `.claude/skills/`.
- **Anywhere else**: `scripts/build-skills.sh` writes each as a folder and a zip into `build/skills/`, with
  the documents it refers to copied in. Put the folder into `~/.claude/skills/` (Claude Code), or add the
  zip as a skill in an assistant that takes them. pung.live offers the same zips.

A skill's `references/` and `examples/` are links to `docs/` and to shipped files: change the document,
not a copy. A skill says only what the documents and the code say; when they change, read the skill
again.
