# Capsula API

API em Node.js com TypeScript e Express, organizada em camadas.

## Ambiente local

O projeto utiliza Docker Compose para executar localmente os serviços de PostgreSQL e MinIO.

### Pré-requisitos

Antes de iniciar o ambiente, certifique-se de ter instalado:

* Node.js 20 ou superior
* Docker
* Docker Compose

### Configuração

Crie o arquivo `.env` a partir do exemplo.

#### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

#### Linux / macOS

```bash
cp .env.example .env
```

### Subindo a infraestrutura

Os volumes do `docker-compose.yml` são declarados como `external`, então precisam existir antes do primeiro `up` (só na primeira vez):

```bash
docker volume create capsula-api_postgres_data
docker volume create capsula-api_minio_data
```

```bash
docker compose up -d
```

> Se a porta `5432` já estiver ocupada por um PostgreSQL instalado na máquina, o `localhost:5432` pode responder por ele em vez do container (e a autenticação falha). Nesse caso, troque a porta no `.env`: ajuste `POSTGRES_PORT` e a porta em `DATABASE_URL` (ex.: `5433`) e rode `docker compose up -d` novamente.

## API

### Instalação

```bash
npm install
npm run db:generate
```

O `db:generate` cria o Prisma Client em `src/generated/prisma` (ignorado pelo git). Ele precisa ser executado após a instalação e sempre que o `prisma/schema.prisma` mudar.

### Scripts disponíveis

| Script | Descrição |
| --- | --- |
| `npm run dev` | Sobe o servidor em modo de desenvolvimento com recarga automática (tsx watch) |
| `npm run build` | Compila o TypeScript para `dist/` |
| `npm start` | Executa o build de produção a partir de `dist/` |
| `npm run lint` | Executa o ESLint |
| `npm run typecheck` | Verifica a tipagem sem gerar arquivos |
| `npm run db:generate` | Gera o Prisma Client a partir do `prisma/schema.prisma` |
| `npm run db:migrate` | Cria e aplica migrações no banco local (`prisma migrate dev`) |
| `npm run db:studio` | Abre o Prisma Studio em `http://localhost:5555` |

### Variáveis de ambiente

As variáveis são carregadas do `.env` e validadas com Zod na inicialização (`src/config/env.ts`). Se alguma variável for inválida, o processo é encerrado com a lista de erros.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `development` | Ambiente de execução (`development`, `test`, `production`) |
| `PORT` | `3000` | Porta HTTP do servidor |
| `API_PREFIX` | `/api` | Prefixo das rotas de negócio |
| `DATABASE_URL` | — (obrigatória) | URL de conexão do PostgreSQL (`postgresql://usuario:senha@host:porta/banco`). Deve refletir as variáveis `POSTGRES_*` do Docker Compose |

### Health check

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "environment": "development",
  "version": "0.1.0",
  "uptime": 12,
  "timestamp": "2026-09-19T01:15:59.018Z"
}
```

### Banco de dados (Prisma)

A API usa o [Prisma](https://www.prisma.io/) 7 com o driver adapter `@prisma/adapter-pg`. Na inicialização, `server.ts` valida a conexão com um `SELECT 1` e só então sobe o servidor HTTP; se o banco estiver inacessível, o erro é registrado e o processo encerra com código `1`.

Fluxo para alterar o modelo de dados:

```bash
# 1. edite prisma/schema.prisma
# 2. crie e aplique a migração
npm run db:migrate -- --name descricao_da_mudanca
# 3. atualize o client (o Prisma 7 não faz isso automaticamente no migrate)
npm run db:generate
```

O client único fica em `src/lib/prisma.ts` e deve ser importado de lá (`import { prisma } from '../lib/prisma'`); não instancie `PrismaClient` em outros pontos. A URL de conexão é lida de `DATABASE_URL` em `prisma.config.ts` (CLI) e em `src/config/env.ts` (runtime).

## Estrutura do projeto

```
prisma/
├── schema.prisma      # Modelos e configuração do generator
└── migrations/        # Migrações geradas pelo `prisma migrate dev`
prisma.config.ts       # Configuração do Prisma CLI (schema, migrações, DATABASE_URL)
src/
├── server.ts          # Entrypoint: valida o banco, sobe o listener HTTP e trata o shutdown
├── app.ts             # Monta o Express (middlewares globais + rotas)
├── config/            # Configuração da aplicação (validação de env)
├── routes/            # Definição das rotas HTTP
├── controllers/       # Recebem a requisição e devolvem a resposta
├── services/          # Regras de negócio
├── middlewares/       # Middlewares do Express (erros, 404)
├── lib/               # Utilitários compartilhados (logger, AppError, prisma)
└── generated/         # Prisma Client gerado (não versionado)
```

O fluxo de uma requisição é `routes → controllers → services`. Controllers não contêm regra de negócio e services não conhecem `Request`/`Response`.

Rotas registradas na raiz (como `/health`) ficam em `rootRoutes`; rotas de negócio são montadas sob o `API_PREFIX` via `apiRoutes`, ambos em `src/routes/index.ts`.

### Tratamento de erros

Erros esperados devem ser lançados com `AppError` (`src/lib/AppError.ts`), que carrega o status HTTP. O `errorHandler` centraliza a resposta; qualquer outro erro vira `500` sem expor detalhes internos em produção. Com Express 5, erros em handlers `async` chegam ao middleware automaticamente — não é necessário `try/catch` em cada rota.
