# BulkMail Pro - Gemini AI Instructions

These instructions are foundational mandates for the Gemini CLI when operating in this workspace. They override general workflows.

## Project Context
BulkMail Pro is a bulk email sending system via XLSX spreadsheets with processing queues.
- **Backend:** Node.js, Express, TypeScript, PostgreSQL, Redis, Bull Queue, Nodemailer.
- **Frontend:** React 18, TypeScript, Tailwind CSS, Vite.

## Directory Structure
- `backend/`: Express server, Bull queue processors, Knex migrations.
- `frontend/`: React application using Vite and Tailwind.

## Development Workflows

### Backend
- **Start server:** `cd backend && npm run dev`
- **Start worker:** `cd backend && npm run worker`
- **Database migrations:** `cd backend && npm run migrate`
- **Linting:** `cd backend && npm run lint`
- **Tests:** `cd backend && npm test`

### Frontend
- **Start dev server:** `cd frontend && npm run dev`
- **Linting:** `cd frontend && npm run lint`

## Architectural Constraints
- **RFC 5322 Validation:** Always use valid regex for email validation (RFC 5322 compliant).
- **Queues:** Use Bull queue for handling email jobs, with appropriate retry logic (max 3x) and throttling.
- **Deduplication:** Always ensure email lists are deduplicated during XLSX import.
- **UI Styling:** Use Tailwind CSS strictly for frontend styling.
- **Cross-Platform Compatibility:** 
    - Always use LF (Unix) line endings for `.sh`, `.conf`, and Docker configuration files to prevent errors in containers.
    - Git is configured via `.gitattributes` to enforce LF on these files even on Windows.

## Framework Integration (AIOX)
This repository also contains Synkra AIOX framework configurations. When dealing with agents or framework core:
- Refer to `.gemini/rules.md` for specific AIOX agent rules and multi-IDE parity commands.
- For quality gates related to the framework, ensure you run the required validation scripts (`npm run validate:parity`, `npm run validate:gemini-sync`, etc.).