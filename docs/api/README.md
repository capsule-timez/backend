# Contrato da API — v1.0.0

Contrato HTTP entre o backend e o aplicativo da Cápsula. A fonte da verdade é o [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1). Este guia resume as convenções e serve de roteiro para validar o contrato. Se os dois divergirem, vale o `openapi.yaml`.

- [Convenções](#convenções)
- [Formato de erro](#formato-de-erro)
- [Autenticação](#autenticação)
- [Cápsulas](#cápsulas)
- [Anexos](#anexos)
- [Acesso do destinatário](#acesso-do-destinatário)
- [Dados simulados (mock)](#dados-simulados-mock)
- [Pontos para validar na sessão](#pontos-para-validar-na-sessão)
- [Versionamento](#versionamento)

## Convenções

| Item | Regra |
| --- | --- |
| Prefixo | Rotas de negócio sob `/api` (variável `API_PREFIX`). `/health` fica na raiz |
| Formato | JSON em **camelCase**, `Content-Type: application/json; charset=utf-8`. Upload em `multipart/form-data` |
| Datas | **ISO 8601 em UTC com sufixo `Z`**. Respostas sempre com milissegundos: `2026-09-28T18:59:12.000Z` (saída de `Date.prototype.toJSON()`). Requisições aceitam com ou sem milissegundos, mas **sempre com `Z`**. Outro fuso (`-03:00`) ou data sem fuso resulta em `422 VALIDATION_ERROR` |
| IDs | UUID v4 em string |
| Autenticação | `Authorization: Bearer <accessToken>` em todas as rotas, exceto `/health`, `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` e `/api/public/*` |
| Paginação | `?page=1&pageSize=20` (`pageSize` máx. 100). Resposta `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }` |
| Campos nulos | Campos opcionais do recurso vêm como `null`, nunca omitidos (ex.: `sentAt`) |

Conversão de datas no app: exibir com `new Date(iso).toLocaleString()`, que converte para o fuso do aparelho. Para enviar, use `date.toISOString()`.

### Códigos de sucesso

| HTTP | Uso |
| --- | --- |
| `200 OK` | Leitura e atualização (com o recurso no corpo) |
| `201 Created` | Criação (com o recurso criado no corpo) |
| `204 No Content` | Exclusão e logout (sem corpo) |

## Formato de erro

Todo erro tem o mesmo corpo. O cliente deve decidir o tratamento pelo `code`; a `message` é só informativa e pode mudar.

```json
{
  "status": "error",
  "code": "VALIDATION_ERROR",
  "message": "Dados invalidos",
  "details": [
    { "field": "scheduleDate", "message": "Deve ser uma data em UTC (sufixo Z) pelo menos 1 minuto no futuro" }
  ]
}
```

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `status` | `"error"` | sim | Sempre `"error"` |
| `code` | string (enum abaixo) | sim | Código estável |
| `message` | string | sim | Texto legível |
| `details` | `{ field, message }[]` | não | Presente em `VALIDATION_ERROR` e `UNSUPPORTED_MEDIA_TYPE` |
| `stack` | string | não | Só fora de produção. **Não faz parte do contrato** |

| HTTP | `code` | Quando |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | JSON malformado ou parâmetro com formato inválido (ex.: `id` que não é UUID) |
| 401 | `UNAUTHORIZED` | Token ausente ou inválido; refresh token inválido, expirado ou já usado |
| 401 | `INVALID_CREDENTIALS` | Login com e-mail ou senha incorretos |
| 401 | `TOKEN_EXPIRED` | Access token expirado. O cliente deve chamar `/api/auth/refresh` e repetir a requisição |
| 403 | `FORBIDDEN` | Reservado. Hoje, recurso de outro usuário responde `404` |
| 404 | `NOT_FOUND` | Recurso inexistente, de outro usuário, ou rota inexistente |
| 409 | `EMAIL_ALREADY_IN_USE` | Cadastro com e-mail já existente |
| 409 | `CAPSULE_NOT_EDITABLE` | Alterar, excluir ou anexar em cápsula que não está `SCHEDULED` |
| 409 | `FILE_LIMIT_REACHED` | Cápsula já tem 5 arquivos |
| 413 | `FILE_TOO_LARGE` | Arquivo acima de 10 MB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Tipo de arquivo não permitido |
| 422 | `VALIDATION_ERROR` | Campos inválidos (detalhes em `details`) |
| 429 | `TOO_MANY_REQUESTS` | Excesso de tentativas em login, cadastro ou acesso público. Header `Retry-After` em segundos |
| 500 | `INTERNAL_ERROR` | Erro inesperado |

## Autenticação

Modelo de dois tokens:

- **Access token**: JWT, validade de **15 minutos**, enviado em `Authorization: Bearer`.
- **Refresh token**: opaco, validade de **30 dias**, **uso único**. Cada `refresh` revoga o token enviado e devolve um novo par.

```
login/register ──► { user, tokens }
     │
     ▼
requisições com Bearer ──► 401 TOKEN_EXPIRED ──► POST /auth/refresh ──► novo par ──► repete a requisição
                                                        │
                                                        └─► 401 UNAUTHORIZED ──► volta ao login
```

### Schemas

```ts
type User = { id: string; name: string; email: string; createdAt: string };

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // segundos (900)
};

type AuthResponse = { user: User; tokens: AuthTokens };
```

### Endpoints

| Método | Rota | Auth | Corpo | Sucesso | Erros |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | — | `{ name, email, password }` | `201 AuthResponse` | 400, 409 `EMAIL_ALREADY_IN_USE`, 422, 429 |
| POST | `/api/auth/login` | — | `{ email, password }` | `200 AuthResponse` | 400, 401 `INVALID_CREDENTIALS`, 422, 429 |
| POST | `/api/auth/refresh` | — | `{ refreshToken }` | `200 AuthTokens` | 400, 401 `UNAUTHORIZED`, 422 |
| POST | `/api/auth/logout` | — | `{ refreshToken }` | `204` (idempotente) | 400, 422 |
| GET | `/api/auth/me` | Bearer | — | `200 User` | 401 |

Validação:

- `name`: 1 a 100 caracteres.
- `email`: formato de e-mail, máx. 254, normalizado para minúsculas.
- `password`: 8 a 72 caracteres (72 é o limite do bcrypt).

Exemplo — `POST /api/auth/login`:

```json
// requisição
{ "email": "maria@exemplo.com", "password": "senhaSegura123" }

// 200
{
  "user": {
    "id": "9b2f6c1e-3d4a-4e5b-8f6a-7b8c9d0e1f2a",
    "name": "Maria Souza",
    "email": "maria@exemplo.com",
    "createdAt": "2026-09-28T18:59:12.000Z"
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "rt_0a1b2c3d4e5f60718293a4b5c6d7e8f9",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

## Cápsulas

Todas exigem Bearer e só enxergam cápsulas do próprio usuário. Cápsula de outro usuário responde `404`, igual a uma inexistente.

### Ciclo de vida

| `status` | Significado | Pode editar/excluir/anexar? |
| --- | --- | --- |
| `SCHEDULED` | Aguardando `scheduleDate` | Sim |
| `SENT` | E-mail entregue; `sentAt` preenchido | Não (`409 CAPSULE_NOT_EDITABLE`) |
| `FAILED` | A entrega falhou | Não (`409 CAPSULE_NOT_EDITABLE`) |

### Schemas

```ts
type CapsuleStatus = 'SCHEDULED' | 'SENT' | 'FAILED';

type CapsuleFile = {
  id: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'audio/mpeg' | 'application/pdf';
  fileSize: number;             // bytes
  createdAt: string;
  downloadUrl: string;          // URL pré-assinada, temporária
  downloadUrlExpiresAt: string;
};

type Capsule = {
  id: string;
  title: string;
  text: string;
  recipientEmail: string;
  scheduleDate: string;
  status: CapsuleStatus;
  sentAt: string | null;
  createdAt: string;
  files: CapsuleFile[];
};

// Item da listagem: sem `text` e `files`, com a contagem de anexos
type CapsuleSummary = Omit<Capsule, 'text' | 'files'> & { fileCount: number };
```

### Endpoints

| Método | Rota | Corpo / query | Sucesso | Erros |
| --- | --- | --- | --- | --- |
| POST | `/api/capsules` | `{ title, text, recipientEmail, scheduleDate }` | `201 Capsule` | 400, 401, 422 |
| GET | `/api/capsules` | `?status&page&pageSize` | `200 { data: CapsuleSummary[], meta }` | 400, 401 |
| GET | `/api/capsules/{id}` | — | `200 Capsule` | 401, 404 |
| PATCH | `/api/capsules/{id}` | qualquer subconjunto dos campos de criação (mín. 1) | `200 Capsule` | 400, 401, 404, 409, 422 |
| DELETE | `/api/capsules/{id}` | — | `204` | 401, 404, 409 |

- A listagem é ordenada por `scheduleDate` crescente; `status` é um filtro opcional.
- Validação: `title` de 1 a 120 caracteres; `text` de 1 a 10.000; `recipientEmail` como e-mail; `scheduleDate` em UTC e pelo menos 1 minuto no futuro.
- Campos desconhecidos no corpo resultam em `422`.

Exemplo — `POST /api/capsules`:

```json
// requisição
{
  "title": "Para mim daqui a um ano",
  "text": "Lembra do que voce prometeu hoje?",
  "recipientEmail": "maria@exemplo.com",
  "scheduleDate": "2027-09-28T12:00:00.000Z"
}

// 201
{
  "id": "3f1e2d4c-5b6a-4789-9abc-def012345678",
  "title": "Para mim daqui a um ano",
  "text": "Lembra do que voce prometeu hoje?",
  "recipientEmail": "maria@exemplo.com",
  "scheduleDate": "2027-09-28T12:00:00.000Z",
  "status": "SCHEDULED",
  "sentAt": null,
  "createdAt": "2026-09-28T18:59:12.000Z",
  "files": []
}
```

### Mapeamento para o banco (referência do backend)

| JSON | Prisma (`Capsule`) | Coluna |
| --- | --- | --- |
| `title` | `titleContent` | `title_content` |
| `text` | `textContent` | `text_content` |
| `recipientEmail` | `recipientEmail` | `recipient_email` |
| `scheduleDate` | `scheduleDate` | `schedule_date` |
| — | `token` | `token` (hash SHA-256 do token de acesso; o texto puro nunca é persistido nem exposto ao criador, só vai no link do e-mail) |
| — | `objectKey` (`CapsuleFile`) | `object_key` (nunca exposto; vira `downloadUrl`) |

## Anexos

| Método | Rota | Corpo | Sucesso | Erros |
| --- | --- | --- | --- | --- |
| POST | `/api/capsules/{id}/files` | `multipart/form-data`, campo `file` | `201 CapsuleFile` | 400, 401, 404, 409 `CAPSULE_NOT_EDITABLE`/`FILE_LIMIT_REACHED`, 413, 415 |
| DELETE | `/api/capsules/{id}/files/{fileId}` | — | `204` | 401, 404, 409 |

- Um arquivo por requisição; até **5 por cápsula**; até **10 MB** cada.
- Tipos aceitos: `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `audio/mpeg`, `application/pdf`.
- `downloadUrl` expira em `downloadUrlExpiresAt`. Para renová-la, busque a cápsula de novo; não persista a URL.

## Acesso do destinatário

| Método | Rota | Auth | Sucesso | Erros |
| --- | --- | --- | --- | --- |
| GET | `/api/public/capsules/{token}` | — | `200 PublicCapsule` | 404, 429 |

```ts
type PublicCapsule = {
  title: string;
  text: string;
  creatorName: string;
  sentAt: string;
  files: CapsuleFile[];
};
```

Só responde `200` quando a cápsula está `SENT`. Token inexistente ou cápsula ainda não entregue respondem o mesmo `404`, para não revelar que o link existe antes da data.

## Dados simulados (mock)

O mock sobe direto do `openapi.yaml`, sem backend nem banco:

```bash
npm run docs:mock        # http://localhost:4010
```

No app, aponte `EXPO_PUBLIC_API_URL` para o IP da máquina (ex.: `http://192.168.0.10:4010`). O `localhost` do celular não é o do computador.

O mock responde com os exemplos do contrato e respeita o header `Prefer`:

```bash
# sucesso padrão
curl http://localhost:4010/api/capsules -H "Authorization: Bearer qualquer"

# escolher um exemplo específico
curl http://localhost:4010/api/capsules/7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d \
  -H "Authorization: Bearer qualquer" -H "Prefer: example=capsuleSent"

# forçar um erro
curl -X POST http://localhost:4010/api/capsules -H "Authorization: Bearer qualquer" \
  -H "Content-Type: application/json" -H "Prefer: code=422" \
  -d '{"title":"x","text":"y","recipientEmail":"a@b.com","scheduleDate":"2027-01-01T00:00:00.000Z"}'

# access token expirado
curl http://localhost:4010/api/auth/me -H "Authorization: Bearer qualquer" \
  -H "Prefer: code=401, example=tokenExpired"
```

Exemplos nomeados disponíveis:

| Endpoint | Exemplos |
| --- | --- |
| `GET /api/capsules` | `page`, `empty` |
| `GET /api/capsules/{id}` | `capsuleScheduled`, `capsuleSent` |
| `401` em rotas autenticadas | `unauthorized`, `tokenExpired` |
| `409` em anexos | `capsuleNotEditable`, `fileLimitReached` |

Limitação: quando a requisição viola o schema (ex.: campo obrigatório faltando), o próprio Prism responde `422` no formato dele (`application/problem+json`), não no formato de erro deste contrato. Para testar o erro do contrato, use `Prefer: code=422`.

Para validar o arquivo depois de editar:

```bash
npm run docs:lint
```

## Pontos para validar na sessão

Decisões assumidas como padrão, a confirmar na reunião:

- [ ] Cápsula de outro usuário responde `404` (e não `403`).
- [ ] Limites de anexo: 5 arquivos, 10 MB, tipos listados acima.
- [ ] Antecedência mínima do `scheduleDate`: 1 minuto.
- [ ] `PATCH` pode trocar o `recipientEmail`.
- [ ] Validade dos tokens: access de 15 min, refresh de 30 dias.
- [ ] Destinatário acessa só pelo link (sem conta) e só depois de `SENT`.
- [ ] Nomes dos campos em inglês (`title`, `text`) no JSON. O app hoje usa `titulo`.

A validação fica registrada como aprovação do PR deste contrato por cada integrante.

## Versionamento

O contrato segue [SemVer](https://semver.org/lang/pt-BR/) em `info.version` do `openapi.yaml`:

- **major**: mudança incompatível (remover/renomear campo ou rota, mudar tipo, novo campo obrigatório na requisição). Exige aviso ao time do app antes do merge.
- **minor**: adição compatível (nova rota, novo campo opcional na requisição, novo campo na resposta).
- **patch**: correção de texto ou exemplo, sem mudança de comportamento.

Cada versão aprovada ganha a tag `api-contract-vX.Y.Z` no repositório.

### Histórico

| Versão | Data | Mudanças |
| --- | --- | --- |
| 1.0.0 | 2026-09-28 | Versão inicial: autenticação, cápsulas, anexos e acesso do destinatário |
