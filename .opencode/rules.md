# Opencode Rules - Synkra AIOX

Este arquivo define as instrucoes do projeto para Opencode CLI neste repositorio.

<!-- AIOX-MANAGED-START: core -->
## Core Rules

1. Siga a Constitution em `.aiox-core/constitution.md`
2. Priorize `CLI First -> Observability Second -> UI Third`
3. Trabalhe por stories em `docs/stories/`
4. Nao invente requisitos fora dos artefatos existentes
<!-- AIOX-MANAGED-END: core -->

<!-- AIOX-MANAGED-START: quality -->
## Quality Gates

- Rode `npm run lint`
- Rode `npm run typecheck`
- Rode `npm test`
- Atualize checklist e file list da story antes de concluir
<!-- AIOX-MANAGED-END: quality -->

<!-- AIOX-MANAGED-START: codebase -->
## Project Map

- Core framework: `.aiox-core/`
- CLI entrypoints: `bin/`
- Shared packages: `packages/`
- Tests: `tests/`
- Docs: `docs/`
<!-- AIOX-MANAGED-END: codebase -->

<!-- AIOX-MANAGED-START: opencode-integration -->
## Opencode Integration

Fonte de verdade de agentes:
- Canonico: `.aiox-core/development/agents/*.md`
- Espelhado para Opencode: `.opencode/rules/*.md`

Hooks (Plugins) e settings:
- Hooks (plugins) locais: `.opencode/plugins/`
- Settings locais: `.opencode/opencode.json`

<!-- AIOX-MANAGED-START: activation -->
## Agent Activation

Preferencia de ativacao:
1. Use agentes em `.opencode/rules/agents/`
2. Se necessario, use fonte canonica em `.aiox-core/development/agents/`

Ao ativar agente:
- carregar definicao completa do agente
- renderizar greeting via `node .aiox-core/development/scripts/generate-greeting.js <agent-id>`
- manter persona ativa ate `*exit`

Atalhos recomendados no Opencode:
- `/aiox-menu` para listar agentes
- `@<agent-id>` (ex.: `@dev`, `@architect`)
<!-- AIOX-MANAGED-END: activation -->

<!-- AIOX-MANAGED-START: commands -->
## Common Commands

- `npm run sync:ide`
- `npm run sync:ide:check`
- `npm run validate:parity`
- `npm run validate:structure`
- `npm run validate:agents`
<!-- AIOX-MANAGED-END: commands -->
