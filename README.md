# Capsula API

## Ambiente local

O projeto utiliza Docker Compose para executar localmente os serviços de PostgreSQL e MinIO.

### Pré-requisitos

Antes de iniciar o ambiente, certifique-se de ter instalado:

* Docker
* Docker Compose

### Configuração

Crie o arquivo `.env` a partir do exemplo.

#### Windows PowerShell

```powershell
Copy-Item .env.example .env