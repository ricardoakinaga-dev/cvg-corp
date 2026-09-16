#!/usr/bin/env python3
"""Valida contratos documentais; não executa produto nem atesta qualidade AAA."""
from pathlib import Path
from collections import Counter
import hashlib
import json
import re
import sys

base = Path(__file__).resolve().parent
root = base.parent.parent
data = json.loads((base / "backlog.json").read_text())
bar_bytes = (root / data["active_quality_bar"]).read_bytes()
bar = json.loads(bar_bytes)
errors = []

def check(condition, message):
    if not condition:
        errors.append(message)

check(data["kind"] == "planning_contract_catalog", "Catálogo deve conter planejamento, não status de execução")
check(hashlib.sha256(bar_bytes).hexdigest() == data["active_quality_bar_sha256"], "Barra mudou: revalidar planejamento")
areas = {a["id"]: a for a in data["areas"]}
tasks = {t["id"]: t for t in data["tasks"]}
check(len(areas) == 16 == len(data["areas"]), "Exigem-se as 16 áreas sem duplicação")
check(len(tasks) == len(data["tasks"]), "IDs duplicados")
check(len(tasks) == 54, "Contagem mudou; revisar sumários e documentação")
check("AAA-000" in tasks, "Bootstrap ausente")
dimension_set = set(bar["scorecard"]["dimension_thresholds"])
check({d for a in areas.values() for d in a["dimensions"]} == dimension_set, "Dimensões da barra não cobertas exatamente")
check(set(data["gate_phases"]["humanApproval"]) == {"F38"}, "Numeração de autoridade incorreta")

script = (root / "scripts/verify-triplo-aaa.ts").read_text()
gate_block = script.split("export const PROMOTION_GATE_PHASES:", 1)[1].split("};", 1)[0]
actual_gates = {name: re.findall(r'"(F\d+)"', phases) for name, phases in re.findall(r'^\s+(\w+):\s*\[([^\]]*)\]', gate_block, re.M)}
check(actual_gates == data["gate_phases"], "Mapping de 25 gates difere do verificador")
expected_phases = {f"F{i}" for i in range(39)}
gate_phases = [p for phases in data["gate_phases"].values() for p in phases]
check(len(data["gate_phases"]) == 25, "São exigidos 25 gates")
check(set(gate_phases) == expected_phases and len(gate_phases) == 39, "Gate não possui cobertura exata F0–F38")
check({p for t in tasks.values() for p in t["phases"]} == expected_phases, "Alguma fase obrigatória não tem tarefa ou há fase inválida")

for area in areas.values():
    check(any(t["area"] == area["id"] for t in tasks.values()), f"Área sem backlog: {area['id']}")
    check(all(d in dimension_set for d in area["dimensions"]), f"Dimensão inválida em {area['id']}")
    check(area["target"] == max(bar["scorecard"]["dimension_thresholds"][d] for d in area["dimensions"]), f"Meta inconsistente: {area['id']}")

for task in tasks.values():
    tid = task["id"]
    check(task["area"] in areas, f"Área inválida: {tid}")
    check("status" not in task and "evidence_refs" not in task, f"Estado mutável duplicado no catálogo: {tid}")
    check(task["milestone"] in {f"M{i}" for i in range(6)}, f"Marco inválido: {tid}")
    for field in ["objective", "owned_paths", "exclusive_resources", "acceptance", "validation", "deliverable", "next_action", "review", "owner_role"]:
        check(bool(task.get(field)), f"Contrato incompleto {tid}: {field}")
    for dep in task["depends_on"]:
        check(dep in tasks and dep != tid, f"Dependência inválida {tid}: {dep}")
        if dep in tasks:
            check(tasks[dep]["milestone"] <= task["milestone"], f"Dependência de marco posterior: {tid} depende de {dep}")
    for path in task["owned_paths"]:
        check(not Path(path).is_absolute() and ".." not in Path(path).parts, f"Caminho fora do repo: {tid}/{path}")
        check(bool(list(root.glob(path))), f"Superfície planejada não existe: {tid}/{path}")
    for procedure in task["validation"]:
        for name in re.findall(r"npm run ([\w:.-]+)", procedure):
            check(name in json.loads((root / "package.json").read_text())["scripts"], f"Script inexistente {tid}: {name}")

visiting, visited = set(), set()
def visit(tid):
    if tid in visiting:
        errors.append(f"Ciclo: {tid}")
        return
    if tid in visited or tid not in tasks:
        return
    visiting.add(tid)
    for dep in tasks[tid]["depends_on"]:
        visit(dep)
    visiting.remove(tid)
    visited.add(tid)
for tid in tasks:
    visit(tid)

for md in base.rglob("*.md"):
    for link in re.findall(r'\]\(([^)]+)\)', md.read_text()):
        target = link.split("#", 1)[0]
        if not target or "://" in target or target.startswith("mailto:"):
            continue
        check((md.parent / target).exists(), f"Link quebrado: {md.relative_to(base)} -> {link}")

for i, area in enumerate(data["areas"], 1):
    path = base / "areas" / f"{i:02d}-{area['id'].lower()}.md"
    check(path.exists(), f"Ficha ausente: {area['id']}")
    if path.exists():
        ids = re.findall(r"^### ([A-Z0-9]+-\d+) —", path.read_text(), re.M)
        check(set(ids) == {t["id"] for t in tasks.values() if t["area"] == area["id"]}, f"Ficha diverge do catálogo: {area['id']}")

if errors:
    print("FAIL planejamento:")
    for error in errors:
        print("-", error)
    sys.exit(1)
print(f"PASS documental: {len(tasks)} tarefas; {len(areas)} áreas; 22 dimensões; 25 gates; 39 fases; DAG acíclico; links e comandos válidos.")
print("Marcos:", dict(sorted(Counter(t["milestone"] for t in tasks.values()).items())))
print("Única raiz de ativação:", ", ".join(t["id"] for t in tasks.values() if not t["depends_on"]))
print("Limitação: consistência documental não comprova implementação, segurança ou promoção AAA.")
