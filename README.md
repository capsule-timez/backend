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

```bash
docker compose up -d
```

## API

### Instalação

```bash
npm install
```

### Scripts disponíveis

| Script | Descrição |
| --- | --- |
| `npm run dev` | Sobe o servidor em modo de desenvolvimento com recarga automática (tsx watch) |
| `npm run build` | Compila o TypeScript para `dist/` |
| `npm start` | Executa o build de produção a partir de `dist/` |
| `npm run lint` | Executa o ESLint |
| `npm run typecheck` | Verifica a tipagem sem gerar arquivos |

### Variáveis de ambiente

As variáveis são carregadas do `.env` e validadas com Zod na inicialização (`src/config/env.ts`). Se alguma variável for inválida, o processo é encerrado com a lista de erros.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `development` | Ambiente de execução (`development`, `test`, `production`) |
| `PORT` | `3000` | Porta HTTP do servidor |
| `API_PREFIX` | `/api` | Prefixo das rotas de negócio |

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

## Estrutura do projeto

```
src/
├── server.ts          # Entrypoint: sobe o listener HTTP e trata o shutdown
├── app.ts             # Monta o Express (middlewares globais + rotas)
├── config/            # Configuração da aplicação (validação de env)
├── routes/            # Definição das rotas HTTP
├── controllers/       # Recebem a requisição e devolvem a resposta
├── services/          # Regras de negócio
├── middlewares/       # Middlewares do Express (erros, 404)
└── lib/               # Utilitários compartilhados (logger, AppError)
```

O fluxo de uma requisição é `routes → controllers → services`. Controllers não contêm regra de negócio e services não conhecem `Request`/`Response`.

Rotas registradas na raiz (como `/health`) ficam em `rootRoutes`; rotas de negócio são montadas sob o `API_PREFIX` via `apiRoutes`, ambos em `src/routes/index.ts`.

### Tratamento de erros

Erros esperados devem ser lançados com `AppError` (`src/lib/AppError.ts`), que carrega o status HTTP. O `errorHandler` centraliza a resposta; qualquer outro erro vira `500` sem expor detalhes internos em produção. Com Express 5, erros em handlers `async` chegam ao middleware automaticamente — não é necessário `try/catch` em cada rota.
