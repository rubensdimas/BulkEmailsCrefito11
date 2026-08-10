# Production secrets

Create `deploy/secrets/` with mode `0700`. The bootstrap generates strong values for PostgreSQL, Redis, webhook and encryption when missing. You must create this file before bootstrap:

```text
deploy/secrets/mailgrid_password
deploy/secrets/oidc_client_secret
```

Never commit files from `deploy/secrets/`.

The bootstrap creates `oidc_session_encryption_key` automatically. The OIDC client
secret must be supplied by the operator and must have mode `0600`.
