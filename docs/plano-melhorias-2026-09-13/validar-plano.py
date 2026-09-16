#!/usr/bin/env python3
"""Valida contratos e referências documentais; não executa gates do produto."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
PLAN = Path(__file__).resolve().parent


def validate(catalog):
    data = json.loads(catalog.read_text())
    tasks = data['tasks']
    ids = {t['id'] for t in tasks}
    assert len(tasks) == len(ids) == 38, 'IDs duplicados ou quantidade incorreta'
    assert ids == {f'AUD13-{i:02}' for i in range(1, 39)}, 'IDs inesperados'
    for key in ('source_report', 'quality_bar'):
        digest = hashlib.sha256((ROOT / data[key]).read_bytes()).hexdigest()
        assert digest == data[key + '_sha256'], f'Hash divergente: {key}'
    legacy = json.loads((ROOT / data['legacy_catalog']).read_text())
    legacy_ids = {t['id'] for t in legacy['tasks']}
    expected_findings = {f'H{i:02}' for i in range(1, 16)} | {f'M{i:02}' for i in range(1, 7)}
    assert set().union(*(set(t['findings']) for t in tasks)) == expected_findings, 'Cobertura de achados incompleta'
    scripts = json.loads((ROOT / 'package.json').read_text())['scripts']
    by_id = {t['id']: t for t in tasks}
    for task in tasks:
        name = task['id']
        for field in ('title', 'owner_role', 'allowed_paths', 'acceptance', 'validation',
                      'source_contracts', 'next_action', 'evidence_required', 'recovery'):
            assert task.get(field), f'{name}: campo vazio {field}'
        assert 'status' not in task, f'{name}: status de execução indevido'
        assert task['wave'] in {f'M{i}' for i in range(6)}, f'{name}: onda inválida'
        assert set(task['legacy_tasks']) <= legacy_ids, f'{name}: ID legado desconhecido'
        assert set(task['depends_on']) <= ids, f'{name}: dependência desconhecida'
        assert len(task['depends_on']) == len(set(task['depends_on'])), f'{name}: dependência duplicada'
        for path in task['source_contracts']:
            assert (ROOT / path).is_file(), f'{name}: contrato ausente {path}'
        for procedure in task['validation']:
            for script in re.findall(r'npm run ([\w:.-]+)', procedure):
                assert script in scripts, f'{name}: script desconhecido {script}'
    completed, visiting = set(), set()

    def walk(name):
        assert name not in visiting, f'Ciclo em {name}'
        if name in completed:
            return
        visiting.add(name)
        for dependency in by_id[name]['depends_on']:
            walk(dependency)
        visiting.remove(name)
        completed.add(name)

    walk('AUD13-38')
    assert completed == ids, 'Tarefa fora do caminho de conclusão'
    assert [t['id'] for t in tasks if not t['depends_on']] == ['AUD13-01'], 'Raiz inesperada'
    links = 0
    for document in [ROOT / data['source_report'], *PLAN.glob('*.md')]:
        for target in re.findall(r'\]\(([^)]+)\)', document.read_text()):
            if '://' in target or target.startswith('#'):
                continue
            target = target.split('#')[0].strip('<>')
            assert (document.parent / target).exists(), f'Link quebrado em {document.name}: {target}'
            links += 1
    print(f'PASS: 38 tarefas; 21 achados; DAG completo sem ciclos; IDs legados, contratos, scripts e hashes válidos; {links} links locais válidos.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=PLAN / 'backlog.json')
    args = parser.parse_args()
    try:
        validate(args.catalog)
    except (AssertionError, KeyError, ValueError, OSError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
