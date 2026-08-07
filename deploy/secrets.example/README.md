# Production secrets

Create `deploy/secrets/` with mode `0700`. The bootstrap generates strong values for PostgreSQL, Redis, webhook and encryption when missing. You must create this file before bootstrap:

```text
deploy/secrets/mailgrid_password
```

Never commit files from `deploy/secrets/`.
