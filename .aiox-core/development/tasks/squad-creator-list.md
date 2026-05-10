---
task: List Squads
responsavel: "@squad-creator"
responsavel_type: agent
atomic_layer: task
Entrada: |
  - path: Caminho alternativo (opcional, default: ./squads)
  - format: Formato de output (table | json | yaml)
Saida: |
  - squads: Lista de squads encontrados
  - count: Numero total de squads
Checklist:
  - "[ ] Usar squad-generator.listLocal()"
  - "[ ] Formatar output conforme format"
  - "[ ] Exibir informacoes basicas de cada squad"
---

# *list-squads

Lista todos os squads locais do projeto.

## Uso

```
@squad-creator
*list-squads
*list-squads --format json
*list-squads --path ./custom-squads
```

## Parametros

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `--path` | string | ./squads | Path to squads directory |
| `--format` | string | table | Output format: table, json, yaml |
| `--include-invalid` | flag | false | Include squads without valid manifest |

## Output Exemplo (Table)

```
Local Squads (./squads/)

┌─────────────────────┬─────────┬─────────────────────────────┬────────┐
│ Name                │ Version │ Description                 │ Status │
├─────────────────────┼─────────┼─────────────────────────────┼────────┤
│ meu-dominio-squad   │ 1.0.0   │ Squad para automacao de X   │ ✅     │
│ outro-squad         │ 2.1.0   │ Outro squad customizado     │ ✅     │
│ legacy-pack         │ 1.0.0   │ Using config.yaml           │ ⚠️     │
└─────────────────────┴─────────┴─────────────────────────────┴────────┘

Total: 3 squads (2 valid, 1 deprecated)
```

## Output Exemplo (JSON)

```json
{
  "squads": [
    {
      "name": "meu-dominio-squad",
      "version": "1.0.0",
      "description": "Squad para automacao de X",
      "path": "./squads/meu-dominio-squad",
      "status": "valid"
    },
    {
      "name": "outro-squad",
      "version": "2.1.0",
      "description": "Outro squad customizado",
      "path": "./squads/outro-squad",
      "status": "valid"
    }
  ],
  "count": 2,
  "path": "./squads"
}
```

## Output Exemplo (YAML)

```yaml
squads:
  - name: meu-dominio-squad
    version: 1.0.0
    description: Squad para automacao de X
    path: ./squads/meu-dominio-squad
    status: valid
  - name: outro-squad
    version: 2.1.0
    description: Outro squad customizado
    path: ./squads/outro-squad
    status: valid
count: 2
path: ./squads
```

## Status Indicators

| Status | Icon | Description |
|--------|------|-------------|
| valid | ✅ | Valid squad.yaml manifest |
| deprecated | ⚠️ | Using config.yaml (deprecated) |
| invalid | ❌ | No manifest found |

## Flow

```
1. Parse arguments
   ├── Get path (default: ./squads)
   └── Get format (default: table)

2. List squads
   ├── Call SquadGenerator.listLocal()
   └── Get array of squad info

3. Filter results
   ├── If --include-invalid → show all
   └── If not → filter out invalid

4. Format output
   ├── If table → format as ASCII table
   ├── If json → JSON.stringify
   └── If yaml → yaml.dump

5. Display result
   └── Output formatted list
```

## Implementation

```javascript
const { SquadGenerator } = require('./.aiox-core/development/scripts/squad');

async function listSquads(options) {
  const { path: squadsPath, format, includeInvalid } = options;

  // List local squads
  const generator = new SquadGenerator({ squadsPath });
  let squads = await generator.listLocal();

  // Filter if needed
  if (!includeInvalid) {
    squads = squads.filter(s => !s.invalid);
  }

  // Format output
  switch (format) {
    case 'json':
      return JSON.stringify({ squads, count: squads.length, path: squadsPath }, null, 2);

    case 'yaml':
      return formatYaml({ squads, count: squads.length, path: squadsPath });

    case 'table':
    default:
      return formatTable(squads, squadsPath);
  }
}

function formatTable(squads, squadsPath) {
  if (squads.length === 0) {
    return `No squads found in ${squadsPath}/\n\nCreate one with: @squad-creator *create-squad my-squad`;
  }

  let output = `Local Squads (${squadsPath}/)\n\n`;

  // Header
  output += '┌' + '─'.repeat(22) + '┬' + '─'.repeat(9) + '┬' + '─'.repeat(30) + '┬' + '─'.repeat(8) + '┐\n';
  output += '│ Name                 │ Version │ Description                  │ Status │\n';
  output += '├' + '─'.repeat(22) + '┼' + '─'.repeat(9) + '┼' + '─'.repeat(30) + '┼' + '─'.repeat(8) + '┤\n';

  // Rows
  for (const squad of squads) {
    const name = squad.name.padEnd(20).substring(0, 20);
    const version = squad.version.padEnd(7).substring(0, 7);
    const desc = (squad.description || '').padEnd(28).substring(0, 28);
    const status = squad.invalid ? '❌' : squad.deprecated ? '⚠️' : '✅';
    output += `│ ${name} │ ${version} │ ${desc} │ ${status}     │\n`;
  }

  output += '└' + '─'.repeat(22) + '┴' + '─'.repeat(9) + '┴' + '─'.repeat(30) + '┴' + '─'.repeat(8) + '┘\n';

  // Summary
  const valid = squads.filter(s => !s.invalid && !s.deprecated).length;
  const deprecated = squads.filter(s => s.deprecated).length;
  const invalid = squads.filter(s => s.invalid).length;

  output += `\nTotal: ${squads.length} squads`;
  if (deprecated > 0 || invalid > 0) {
    output += ` (${valid} valid`;
    if (deprecated > 0) output += `, ${deprecated} deprecated`;
    if (invalid > 0) output += `, ${invalid} invalid`;
    output += ')';
  }

  return output;
}
```

## Empty State

When no squads are found:

```
No squads found in ./squads/

Create one with: @squad-creator *create-squad my-squad

Or download a public squad: @squad-creator *download-squad squad-name
```

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `ENOENT` | Squads directory doesn't exist | Will return empty list |
| `PERMISSION_DENIED` | Can't read directory | Check permissions |

## Related

- **Agent:** @squad-creator (Craft)
- **Script:** squad-generator.js (listLocal method)
- **Create:** *create-squad
- **Validate:** *validate-squad
