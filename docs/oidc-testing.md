# Testes OIDC

## Preparação local

1. Inicie o provedor da intranet com o compose OIDC e execute o `oidc-doctor.php`.
2. Crie arquivos locais, fora do Git, em `.secrets/`:
   - `oidc_client_secret`: segredo do cliente fornecido pela TI;
   - `oidc_session_encryption_key`: 32 bytes codificados em hexadecimal.
3. Use o cliente `oidc_b79664a0a1fddecefe7856581a592eb0` e confirme que as URIs locais estão cadastradas no SPI.
4. No `.env`, use o issuer público e o backchannel interno do Docker:

```dotenv
OIDC_ISSUER=http://127.0.0.1:8080
OIDC_BACKCHANNEL_ORIGIN=http://host.docker.internal:8080
```

5. Inicie o ambiente completo. O navegador acessa o issuer público, enquanto o
backend no container usa o backchannel para as requisições servidor a servidor:

```bash
cd /caminho/para/BulkEmailsCrefito11
docker compose up -d --build
curl --fail http://localhost:3000/api/health/ready
curl -I http://localhost:3000/api/auth/oidc/login
```

6. Para executar o backend diretamente no host, deixe o backchannel vazio:

```bash
cd /caminho/para/BulkEmailsCrefito11/backend
OIDC_BACKCHANNEL_ORIGIN= npm run dev

cd ../frontend
VITE_AUTH_ENABLED=true npm run dev
```

## Cenários

| Cenário | Resultado esperado |
| --- | --- |
| Discovery | O cliente usa apenas metadata e JWKS publicados pelo issuer. |
| Login e consentimento | O navegador retorna à raiz do BulkMail com cookie de sessão HttpOnly. |
| Callback inválido | State ausente, diferente ou reutilizado não cria sessão. |
| Token inválido | Assinatura, issuer, audience, expiração ou nonce inválidos são rejeitados. |
| API protegida | `POST /api/send` sem cookie recebe `401`; com origem diferente recebe `403`. |
| Renovação | Ao vencer access token, o refresh token é trocado, cifrado novamente e o usuário permanece autenticado. |
| Logout | A sessão Redis é removida, o refresh token é revogado e o navegador segue para o logout central. |
