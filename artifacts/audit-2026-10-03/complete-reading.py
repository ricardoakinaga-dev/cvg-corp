"""Record lead-observed final readings and verify the original docs inventory."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

audit = Path(__file__).resolve().parent
root = audit.parent.parent
ledger_path = audit / "frontend-quality-read-ledger.json"
original = ledger_path.read_bytes()
ledger = json.loads(original)
notes = {
    "docs/rodada-aaa3-2026-09-13/backlog.json": "Leitura integral pelo coordenador, linhas 1–485 e 486–985: catálogo histórico de 12 contratos AAA3 e continuidade dos 33 AAA2; distingue status de execução, autoridade humana, evidência e herança. Não é autorização atual de implementação nem prova de defeitos atuais.",
    "docs/verification-vNext.md": "Leitura integral pelo coordenador, linhas 1–113 e 114–240: fotografia e checkpoints históricos de setembro, gates locais, CI de SHAs específicos, evolução dos writers e limites de staging/produção. Contagens antigas e WebKit então bloqueado não substituem a evidência de 03/10.",
}
backup = audit / "frontend-quality-read-ledger-before-lead-completion.json"
if not backup.exists():
    backup.write_bytes(original)
for record in ledger["files"]:
    if record["path"] not in notes:
        assert record["full_read"], record["path"]
        continue
    content = (root / record["path"]).read_bytes()
    assert hashlib.sha256(content).hexdigest() == record["assigned_sha256"]
    assert len(content) == record["bytes"]
    assert len(content.decode("utf-8").splitlines()) == record["total_lines"]
    record.update(full_read=True, read_status="full_read", read_bytes=len(content),
                  summary=notes[record["path"]], relevance="historical_requirement_and_evidence",
                  reader="lead_final_reading")
    for chunk in record["chunks"]:
        chunk["status"] = "full_read"
ledger.update(status="READING_COMPLETE", full_read_files=58,
              confirmed_read_bytes=ledger["total_assigned_bytes"], unread_bytes=0,
              updated_at=datetime.now(timezone.utc).isoformat())
ledger["lead_completion"] = {
    "files": list(notes), "basis": "Four complete, untruncated native tool outputs read by the lead before acknowledgement.",
    "prior_reader": "56 files acknowledged by frontend reviewer; prior unacknowledged overlap was reread by lead.",
    "source_review": "frontend-quality-review.md", "source_review_status": "COMPLETE",
}
ledger_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n")

inventory = json.loads((audit / "docs-inventory.json").read_text())
expected = {item["path"]: item for item in inventory["files"]}
actual_docs = {str(path.relative_to(root)) for path in (root / "docs").rglob("*") if path.is_file()}
assert actual_docs == set(expected), "Docs inventory changed"
seen, lanes = {}, []
for lane in ("architecture", "security-ai", "operations", "frontend-quality"):
    path = audit / f"{lane}-read-ledger.json"
    data = json.loads(path.read_text())
    for record in data["files"]:
        name = record["path"]
        assert name not in seen, f"Duplicate assignment: {name}"
        assert record.get("full_read") is True, f"Unread: {name}"
        assert record.get("summary"), f"No reading note: {name}"
        assert not record.get("unread_line_ranges"), f"Unread lines: {name}"
        content = (root / name).read_bytes()
        checksum = hashlib.sha256(content).hexdigest()
        assert checksum == expected[name]["sha256"] == record["sha256"], name
        seen[name] = lane
    lanes.append({"lane": lane, "files": len(data["files"]),
                  "ledger": path.name, "ledger_sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
assert set(seen) == set(expected) and len(seen) == 284
result = {"status": "PASS", "observed_at": datetime.now(timezone.utc).isoformat(),
          "head": inventory["head"], "files": len(seen),
          "bytes": sum(item["bytes"] for item in expected.values()),
          "fully_read": len(seen), "unread": 0, "changed": 0,
          "lanes": lanes,
          "method": "Content-read acknowledgements plus exact original inventory and per-file SHA256 validation. Hashes alone do not establish reading."}
(audit / "docs-reading-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(result, ensure_ascii=False))
