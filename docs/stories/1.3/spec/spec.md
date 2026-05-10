# Spec: Dashboard com listagem de jobs

> **Story ID:** 1.3
> **Complexity:** STANDARD (Score: 11)
> **Generated:** 2026-04-21T16:30:00Z
> **Status:** Draft

---

## 1. Overview

Implementação de um painel de controle (Dashboard) para visualização, acompanhamento e gestão de todos os jobs de envio de e-mail processados pelo sistema. Atualmente, o acompanhamento é limitado ao conhecimento prévio do `jobId`.

### 1.1 Goals

- Permitir a listagem centralizada de todos os jobs (FR-1).
- Disponibilizar filtros e paginação para facilitar a navegação em grandes volumes de dados (FR-2, CON-1).
- Permitir a exclusão manual de jobs concluídos para manutenção do banco de dados (FR-3).

### 1.2 Non-Goals

- Cancelamento de jobs em processamento (CON-2).
- Edição de conteúdo de e-mails em jobs já criados.
- Relatórios avançados de analytics (além do progresso básico).

---

## 2. Requirements Summary

### 2.1 Functional Requirements

| ID | Description | Priority | Source |
| :--- | :--- | :---: | :--- |
| FR-1 | Listagem geral de jobs com data, total de e-mails e progresso (%) | P0 | requirements.json |
| FR-2 | Filtros via Query Builder no backend e campos no frontend | P1 | requirements.json |
| FR-3 | Exclusão de jobs concluídos da lista e do banco de dados | P1 | requirements.json |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Metric |
| :--- | :--- | :--- | :--- |
| NFR-1 | Usability | Visibilidade pública para todos os usuários autenticados | 100% de visibilidade |

### 2.3 Constraints

| ID | Type | Constraint | Impact |
| :--- | :--- | :--- | :--- |
| CON-1 | Technical | Paginação obrigatória de 20 itens por página | Evita overhead de memória/rede |
| CON-2 | Business | Sem suporte a cancelamento de jobs ativos nesta fase | Redução de escopo inicial |

---

## 3. Technical Approach

### 3.1 Architecture Overview

A implementação seguirá o padrão MVC/Repository já existente no projeto:
1. **Backend:** Criação de `JobController` e `JobRoutes`. Uso do `JobRepository` existente para queries Knex.
2. **Frontend:** Nova página `DashboardPage` integrada ao `react-router-dom`. Uso de `Axios` para consumo dos novos endpoints.

### 3.2 Component Design

- **DashboardTable:** Componente para renderizar a lista de jobs com colunas dinâmicas.
- **PaginationControl:** Componente reutilizável para navegação entre páginas (limit/offset).
- **JobFilters:** Formulário com `debounce` para busca por status ou ID.
- **DeleteConfirmModal:** Modal de confirmação para exclusão de jobs.

### 3.3 Data Flow

1. Usuário acessa `/dashboard`.
2. Frontend solicita `GET /api/jobs?limit=20&offset=0`.
3. Backend (Knex) executa query com `ORDER BY created_at DESC`.
4. Dados são retornados e mapeados para o estado do componente via `useEffect` ou `react-query` (se disponível).

---

## 4. Dependencies

### 4.1 External Dependencies

| Dependency | Version | Purpose | Verified |
| :--- | :--- | :--- | :---: |
| knex | ^3.1.0 | Query Builder para paginação e filtros | ✅ |
| react-router-dom | ^6.21.1 | Roteamento para a nova página | ✅ |
| axios | ^1.6.3 | Requisições HTTP | ✅ |

### 4.2 Internal Dependencies

| Module | Purpose |
| :--- | :--- |
| jobRepository.ts | Centraliza acesso à tabela `jobs` |
| databaseService.ts | Inicialização e disponibilização do Knex |

---

## 5. Files to Modify/Create

### 5.1 New Files

| File Path | Purpose |
| :--- | :--- |
| backend/src/controllers/jobController.ts | Lógica de listagem e exclusão de jobs |
| backend/src/routes/jobRoutes.ts | Definição das rotas `/api/jobs` |
| frontend/src/pages/DashboardPage.tsx | Página principal da funcionalidade |

### 5.2 Modified Files

| File Path | Changes | Risk |
| :--- | :--- | :---: |
| backend/src/app.ts | Registro das novas rotas de jobs | Low |
| frontend/src/App.tsx | Registro da rota `/dashboard` | Low |
| frontend/src/pages/HomePage.tsx | Adição de link de navegação no Header | Low |
| frontend/src/services/api.ts | Adição de métodos `getJobs` e `deleteJob` | Low |

---

## 6. Testing Strategy

### 6.1 Unit Tests

| Test | Covers | Priority |
| :--- | :--- | :---: |
| getJobs logic | Paginação e filtros no controller | P0 |
| deleteJob validation | Impede exclusão de jobs não concluídos | P0 |

### 6.2 Acceptance Tests (Given-When-Then)

```gherkin
Feature: Dashboard de Jobs

  Scenario: Exclusão de Job Concluído
    Given um job com status 'completed'
    When o usuário clica em 'Excluir' e confirma
    Then o job deve ser removido da tabela 'jobs'
    And os logs relacionados devem ser removidos (on delete cascade)

  Scenario: Paginação de Resultados
    Given que existem 25 jobs no sistema
    When o usuário acessa o Dashboard
    Then deve ver apenas os 20 jobs mais recentes
    And deve ver controles para acessar a segunda página
```

---

## 7. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
| :--- | :--- | :--- | :--- |
| Deleção acidental de jobs ativos | Low | High | Validação rigorosa do status no backend antes do `DELETE`. |
| Performance em listas gigantes | Med | Med | Paginação obrigatória via banco de dados (limit/offset). |

---

## 8. Open Questions

| ID | Question | Blocking | Assigned To |
| :--- | :--- | :---: | :--- |
| OQ-1 | A exclusão deve ser lógica (soft) ou física (hard)? | No | @pm |

---

## 9. Implementation Checklist

- [ ] Criar `jobController.ts` com métodos `list` e `delete`.
- [ ] Criar `jobRoutes.ts` e registrar no `app.ts`.
- [ ] Implementar página `DashboardPage.tsx` no frontend.
- [ ] Adicionar navegação "Dashboard" no Header.
- [ ] Validar exclusão em cascata (cascade delete) no PostgreSQL.
- [ ] Escrever testes de integração para as novas rotas.

---

## Metadata

- **Generated by:** @pm via spec-write-spec
- **Inputs:** requirements.json, complexity.json, research.json
- **Iteration:** 1
