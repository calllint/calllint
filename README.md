# CallLint

Deterministic risk linting for agent tools, MCP servers, and AI workflow integrations.

## Status

CallLint is in early development. It currently focuses on deterministic checks and evidence-backed reports.

## Install

```bash
npm install -g calllint
```

## Quick start

```bash
calllint scan ./mcp.json
```

## What CallLint checks

- risky tool permissions
- unsafe shell execution
- broad filesystem access
- unclear network access
- missing tool boundaries
- weak evidence reporting

## What CallLint does not do

- It does not guarantee that an agent is safe.
- It does not replace a human security review.
- It does not certify third-party tools.
- It does not analyze every runtime behavior yet.

## Output

CallLint can produce JSON and, later, HTML reports.

## Security

Please report security issues to security@calllint.com.

## License

MIT
