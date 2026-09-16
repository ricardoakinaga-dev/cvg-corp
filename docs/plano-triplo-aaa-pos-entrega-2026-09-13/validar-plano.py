from pathlib import Path
import json,hashlib,re,sys
ROOT=Path(__file__).resolve().parents[2]
PLAN=Path(__file__).resolve().parent
try:
 b=json.loads((PLAN/'backlog.json').read_text());ts=b['tasks'];by={t['id']:t for t in ts}
 assert len(ts)==len(by)==33,'33 contratos únicos obrigatórios'
 assert set(by)=={f'AAA2-{i:02}' for i in range(1,34)},'IDs inesperados'
 for k in ('source_report','quality_bar'):
  assert hashlib.sha256((ROOT/b[k]).read_bytes()).hexdigest()==b[k+'_sha256'],f'hash divergente: {k}'
 fs=json.loads((ROOT/'artifacts/audit-entrega-2026-09-13/findings.json').read_text());expected={f'E{i:02}' for i in range(1,19)}
 assert {f['id'] for f in fs}==expected,'inventário de achados'
 assert set().union(*(set(t['findings']) for t in ts))==expected,'cobertura de achados'
 legacy={f'AUD13-{i:02}' for i in range(1,39)}|{f'AUD13-{i}A' for i in (14,16,17,18,20,25)}
 assert {m['legacy_id'] for m in b['legacy_reconciliation']}==legacy,'ponte legada incompleta'
 assert len(b['legacy_reconciliation'])==44,'ponte duplicada'
 scripts=json.loads((ROOT/'package.json').read_text())['scripts']
 for t in ts:
  assert set(t['depends_on'])<=set(by),'dependência desconhecida'
  assert set(t['legacy_tasks'])<=legacy,'legado desconhecido'
  assert 'status' not in t,'catálogo não deve duplicar status'
  for field in ('acceptance','validation','owner_role','allowed_paths','exclusive_resources','evidence_required','recovery','next_action'):
   assert t.get(field),f"{t['id']}: {field} vazio"
  for path in t['source_contracts']:assert (ROOT/path).exists(),f'fonte ausente: {path}'
  for line in t['validation']:
   for script in re.findall(r'npm run ([\w:.-]+)',line):assert script in scripts,f'script desconhecido: {script}'
 for m in b['legacy_reconciliation']:assert set(m['new_tasks'])<=set(by),'ponte inválida'
 visited=set();stack=set()
 def visit(i):
  assert i not in stack,f'ciclo: {i}'
  if i in visited:return
  stack.add(i)
  for d in by[i]['depends_on']:visit(d)
  stack.remove(i);visited.add(i)
 visit('AAA2-32');assert visited==set(by),'tarefa fora da conclusão'
 assert [t['id'] for t in ts if not t['depends_on']]==['AAA2-01'],'raiz inesperada'
 links=0
 for doc in [ROOT/b['source_report'],*PLAN.glob('*.md')]:
  for target in re.findall(r'\]\(([^)]+)\)',doc.read_text()):
   if '://' in target or target.startswith('#'):continue
   target=target.split('#')[0].strip('<>');assert (doc.parent/target).exists(),f'link quebrado {doc.name}: {target}'
   links+=1
 print(f'PASS: 33 tarefas, 18 achados, 44 contratos legados; DAG completo sem ciclos; hashes/scripts/fontes e {links} links válidos.')
except (AssertionError,KeyError,ValueError,OSError) as e:
 print(f'FAIL: {e}',file=sys.stderr);sys.exit(1)
