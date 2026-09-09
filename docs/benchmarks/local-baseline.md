# Baseline local de performance

**Perfil:** fixture sintética `CvgStore`, Node 24.20.0, Linux, 3 warmups e 30 amostras; provider `local-stub`.

O comando abaixo produz as amostras brutas, ordenadas e os percentis p50/p95/p99:

```bash
npm run benchmark:local > artifacts/benchmark-local.json
```

Um passe local registrado nesta etapa observou, em milissegundos:

| Operação | p50 | p95 | p99 |
|---|---:|---:|---:|
| patient lookup | 0,0049 | 0,0386 | 0,0475 |
| appointment list | 0,0038 | 0,0076 | 0,0131 |
| AI turn local stub | 0,0123 | 0,0435 | 0,0670 |

Esses números são somente uma fotografia do processo local e não são SLO, limite de capacidade, latência de provider ou critério de release. Login, commit PostgreSQL, overhead de RLS, outbox, recovery e AI externo permanecem `NOT_RUN`. Repetir o comando em outro host invalida comparações diretas sem fixar o mesmo perfil e dataset.
