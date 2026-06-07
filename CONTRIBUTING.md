# Contributing

## Local Setup

```powershell
npm install
npm run check
```

Use Node.js 22 or newer.

## Validation

- `npm run check`: canonical sync audit, TypeScript build and unit/MCP tests.
- `npm run test:e2e`: build plus MCP stdio smoke and redacted diagnostic bundle
  smoke.
- `npm run smoke:mcp-tools`: list required MCP tools against `dist/index.js`.

When changing MCP tools, resources, prompts or public output, run `npm run
build` and a real MCP `list_tools` smoke against `dist/index.js`.

## PPIRTV Rules

- Follow `AGENTS.md` before editing.
- Do not declare a task ready without evidence.
- Preserve `.ppirtv/`, `.tmp/`, `.temp/` and local agent runtime data outside
  version control.
- If a future action is promised, include a date, trigger, condition, owner or
  review window.

## Pull Request Expectations

- Keep patches scoped.
- Add or update tests when behavior changes.
- Document public MCP contract changes.
- Declare what was not validated and residual risk.
