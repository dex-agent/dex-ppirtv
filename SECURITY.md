# Security Policy

## Supported Scope

This repository is an MCP stdio server for PPIRTV flow orchestration. Security
work here focuses on local runtime safety, secret handling, diagnostic
redaction and public MCP/tool contracts.

## Reporting

For now, report security issues through the repository maintainer or channel
that provided this project. Do not include real secrets, tokens, `.env`
contents, Authorization headers or private runtime payloads in the report.

## Secret Handling Rules

- Do not commit `.env` files.
- Do not commit `.ppirtv/`, local ledgers, meetings, evidence or agent memory.
- Do not paste tokens, API keys, Authorization headers or sensitive payloads
  into flows, meetings, evidence, docs or tests.
- Use redacted diagnostic output when sharing runtime state across machines.

## Diagnostic Bundles

`npm run diagnostic:bundle` exports a redacted snapshot from PPIRTV runtime
state after `npm run build`. It does not read `.env` files and it redacts
secret-like keys and Authorization bearer values.

## Before Public Release

Before publishing the repository or changing visibility, audit the current tree
and Git history. Removing a secret from the current working tree does not remove
it from earlier commits.
