#!/usr/bin/env python3
"""Valida a rodada documental, não o estado ativo nem qualidade do produto."""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
PLAN = Path(__file__).resolve().parent
try:
    data = json.loads((PLAN / 'backlog.json').read_text())
    tasks = data['tasks']
    by_id = {t['id']: t for t in tasks}
    assert len(tasks) == len(by_id) == 12, '12 contratos únicos esperados'
    assert set(by_id) == {f'AAA3-{i:02}' for i in range(1, 13)}, 'IDs inválidos'
    for key in ('source_report', 'inherited_catalog', 'quality_bar'):
        actual = hashlib.sha256((ROOT / data[key]).read_bytes()).hexdigest()
        assert actual == data[key + '_sha256'], f'Hash divergente: {key}'
    inherited = json.loads((ROOT / data['inherited_catalog']).read_text())['tasks']
    prior_ids = {t['id'] for t in inherited}
    continuation = data['aaa2_continuation']
    assert len(continuation) == 33, 'Continuidade incompleta'
    assert {t['aaa2_id'] for t in continuation} == prior_ids, 'Contrato herdado omitido'
    scripts = json.loads((ROOT / 'package.json').read_text())['scripts']
    for task in tasks:
        assert set(task['depends_on']) <= set(by_id), 'Dependência desconhecida'
        assert set(task['inherits']) <= prior_ids, 'Herança desconhecida'
        assert 'status' not in task, 'Catálogo duplicando status de execução'
        for field in ('acceptance', 'validation', 'allowed_paths', 'owner', 'next_action', 'recovery', 'evidence_required'):
            assert task.get(field), f'{task["id"]}: campo vazio {field}'
        for procedure in task['validation']:
            for name in re.findall(r'npm run ([\w:.-]+)', procedure):
                assert name in scripts, f'Script desconhecido {name}'
    for row in continuation:
        assert set(row['round_tasks']) == {t['id'] for t in tasks if row['aaa2_id'] in t['inherits']}, 'Ponte inversa divergente'
    visited, pending = set(), set()
    def visit(task_id):
        assert task_id not in pending, f'Ciclo em {task_id}'
        if task_id in visited:
            return
        pending.add(task_id)
        for dependency in by_id[task_id]['depends_on']:
            visit(dependency)
        pending.remove(task_id)
        visited.add(task_id)
    visit('AAA3-12')
    assert visited == set(by_id), 'Tarefa fora do fechamento da rodada'
    links = 0
    for document in [ROOT / data['source_report'], *PLAN.glob('*.md')]:
        for target in re.findall(r'\]\(([^)]+)\)', document.read_text()):
            if '://' in target or target.startswith('#'):
                continue
            path = target.split('#')[0].strip('<>')
            assert (document.parent / path).exists(), f'Link ausente: {document.name}: {path}'
            links += 1
    print(f'PASS: 12 contratos, 33 heranças, DAG/ponte completos, hashes/scripts e {links} links válidos. Estado ativo não avaliado por este validador.')
except (AssertionError, KeyError, ValueError, OSError) as error:
    print(f'FAIL: {error}', file=sys.stderr)
    sys.exit(1)
