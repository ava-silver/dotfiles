---
name: new-skill
description: Create a new Claude Code skill. Use when the user says 'new skill', 'create skill', 'add skill', 'make a skill', or wants to define a new reusable slash command.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# New Skill

Creates a new Claude Code skill, checked into the dotfiles repo and symlinked into `~/.claude/skills/`.

## Convention

All skills are stored in the dotfiles repo at `~/dotfiles/claude/<skill-name>.skill.md` and symlinked to `~/.claude/skills/<skill-name>/SKILL.md` by `setup.sh`. Never create skills directly in `~/.claude/skills/` — always check them into the repo.

## Workflow

### Step 1: Gather requirements

Ask the user:
- What should the skill do?
- What should it be called? (kebab-case, e.g. `post-review`)
- What trigger phrases should invoke it?
- What tools does it need access to?

### Step 2: Write the skill file

Create `~/dotfiles/claude/<skill-name>.skill.md` with this structure:

```markdown
---
name: <skill-name>
description: <One-line description. Include trigger phrases so Claude knows when to invoke it.>
allowed-tools: <comma-separated list of tools the skill needs>
---

# <Skill Title>

<Brief description of what the skill does.>

## Key Rules

<Numbered list of important constraints or behaviors.>

## Workflow

### Step 1: ...
### Step 2: ...
```

Guidelines for the skill file:
- The `description` field is critical — it controls when Claude auto-invokes the skill. Include explicit trigger phrases.
- `allowed-tools` should be minimal — only what the skill actually needs.
- Workflow steps should be concrete and actionable, not vague.
- Include example commands/payloads where relevant.

### Step 3: Create the symlink

```bash
skill_name="<skill-name>"
mkdir -p ~/.claude/skills/$skill_name
ln -sf ~/dotfiles/claude/$skill_name.skill.md ~/.claude/skills/$skill_name/SKILL.md
```

### Step 4: Verify

Confirm the symlink is correct:
```bash
ls -la ~/.claude/skills/<skill-name>/SKILL.md
```

Tell the user the skill is ready and can be invoked with `/<skill-name>`.
