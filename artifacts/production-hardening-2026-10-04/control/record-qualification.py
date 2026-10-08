"""Append observed local qualification without rebinding historical evidence."""
import datetime
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "artifacts/production-hardening-2026-10-04"
RECEIPT_ID = "VER-CVG-AUD27-001-HARDENING-20261004"
EVENT_ID = "EVT-CVG-AUD27-001-HARDENING-20261004"
ACTION = "AUD27-001:SEMANTIC-RECONCILIATION"


def load(path):
    return json.loads(path.read_text())


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    index = load(BASE / "verification/check-index.json")
    review = load(BASE / "review/final-review.json")
    assert review["decision"] in ("APPROVE", "UNAVAILABLE"), "unresolved review finding cannot be closed"
    script = "import{buildSubjectManifest}from'./scripts/subject-manifest.ts';console.log(JSON.stringify(buildSubjectManifest()));"
    subject = json.loads(subprocess.check_output(["node", "--import", "tsx", "--input-type=module", "-e", script], cwd=ROOT, text=True))
    assert subject["fingerprint"] == index["subject_fingerprint"]
    for check in index["checks"]:
        receipt_path = ROOT / check["receipt"]
        assert hashlib.sha256(receipt_path.read_bytes()).hexdigest() == check["receipt_sha256"]
        receipt = load(receipt_path)
        assert receipt["exit_status"] == 0 and receipt["source_unchanged"]
        assert receipt["source_fingerprint_before"] == subject["fingerprint"] == receipt["source_fingerprint_after"]
        assert hashlib.sha256((ROOT / receipt["log"]).read_bytes()).hexdigest() == receipt["log_sha256"]
    if review["decision"] == "APPROVE":
        assert review["source_fingerprint_before"] == subject["fingerprint"] == review["source_fingerprint_after"]
        assert review["mutation_sentinel_clean"] is True
    state_path = ROOT / ".agent/state.json"
    backlog_path = ROOT / ".agent/backlog.json"
    verification_path = ROOT / ".agent/verification.jsonl"
    event_path = ROOT / ".agent/execution-log.jsonl"
    state, backlog = load(state_path), load(backlog_path)
    verification_before, events_before = verification_path.read_bytes(), event_path.read_bytes()
    assert RECEIPT_ID.encode() not in verification_before and EVENT_ID.encode() not in events_before
    assert state["active_task"] == "AUD27-001" and state["active_action_id"] == ACTION
    active = next(item for item in backlog["items"] if item["id"] == "AUD27-001")
    assert active["next_action"]["id"] == ACTION
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result = "PASS_WITH_LIMITATIONS" if review["decision"] == "APPROVE" else "PARTIAL"
    note = f"{len(index['checks'])} current local checks PASS; independent review {review['decision']}; code remains unfrozen and production release unqualified."
    snapshots = BASE / "control/before-qualification"
    snapshots.mkdir(exist_ok=False)
    for path in (state_path, backlog_path):
        (snapshots / path.name).write_bytes(path.read_bytes())
    prefix_proofs = [{"path": str(path.relative_to(ROOT)), "length": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                     for path, data in [(verification_path, verification_before), (event_path, events_before)]]
    write(snapshots / "ledger-prefixes.json", prefix_proofs)

    index["review_status"] = review["decision"]
    index["review"] = {"path": "artifacts/production-hardening-2026-10-04/review/final-review.json",
                       "sha256": hashlib.sha256((BASE / "review/final-review.json").read_bytes()).hexdigest()}
    write(BASE / "verification/check-index.json", index)
    manifest_hash = hashlib.sha256((BASE / "verification/check-index.json").read_bytes()).hexdigest()
    plan_path = ROOT / ".agent/plans/2026-10-04-production-hardening.md"
    plan = plan_path.read_text()
    pending = "Verificação local integrada concluída; revisão final independente em andamento."
    assert pending in plan
    final = ("Verificação local integrada concluída; revisão final independente APPROVE no escopo local.\n"
             "Veredito: CONDITIONAL PASS para preparação local; produção permanece não qualificada."
             if review["decision"] == "APPROVE" else
             "Verificação local integrada concluída; revisão final sem parecer após tentativas de retomada.\n"
             "Veredito: PARTIAL; PROD-08 não concluído e produção permanece não qualificada.")
    plan_path.write_text(plan.replace(pending, final) + "\nEvidências consolidadas: `artifacts/production-hardening-2026-10-04/verification/check-index.json`.\n"
                         "Revisão: `artifacts/production-hardening-2026-10-04/review/final-review.md`.\n")
    active["observed"] = note
    active["remaining"] = "Current local qualification recorded; target staging, immutable candidate, external provider/operations evidence and release acceptance remain separate."
    active["evidence_state"] = "LOCAL_CURRENT_VERIFIED_PROMOTION_BLOCKED"
    active["evidence_refs"].append(RECEIPT_ID)
    active["local_production_hardening"] = {"receipt": RECEIPT_ID, "observed_subject_fingerprint": subject["fingerprint"],
                                            "result": result, "independent_review": review["decision"], "promotion": "BLOCKED"}
    backlog["updated_at"] = timestamp
    write(backlog_path, backlog)

    receipt = {"id": RECEIPT_ID, "timestamp": timestamp, "observed_at": timestamp,
               "task": "AUD27-001", "action": ACTION, "active_action_id": ACTION,
               "result": result, "freshness": "CURRENT", "candidate_fingerprint": None,
               "observed_subject_fingerprint": subject["fingerprint"], "fingerprint_status": "UNFROZEN_UNTIL_AUD27-004",
               "source_sha": subject["manifest"]["sourceSha"], "procedure_status": "EXECUTED",
               "evidence_kind": "LOCAL_COMMANDS_AND_REVIEW", "scope": "Local production hardening on observed modified code; not a frozen release or target-environment qualification.",
               "exit_status": 0,
               "command_results": [{"command": shlex.join(check["command"]), "exit_status": 0, "receipt": check["receipt"]} for check in index["checks"]],
               "evidence_artifacts": ["artifacts/production-hardening-2026-10-04/verification/check-index.json", "artifacts/production-hardening-2026-10-04/review/final-review.md"],
               "evidence_manifest_sha256": manifest_hash, "independent_review": review,
               "limitations": index["limits"], "preserved_failures": index["preserved_failures"],
               "promotion": "BLOCKED", "global_verdict": "AAA_NOT_PROVEN",
               "next_state": "IN_PROGRESS; active_action_id=" + ACTION}
    event = {"event_id": EVENT_ID, "timestamp": timestamp, "type": "CHECKPOINT", "task": "AUD27-001",
             "action": ACTION, "active_action_id": ACTION, "result": result, "verification": RECEIPT_ID,
             "candidate_fingerprint": None, "fingerprint_status": "UNFROZEN_UNTIL_AUD27-004",
             "source_sha": subject["manifest"]["sourceSha"], "observed_subject_fingerprint": subject["fingerprint"],
             "next_state": "IN_PROGRESS; active_action_id=" + ACTION,
             "previous_state": "IN_PROGRESS; active_action_id=" + ACTION,
             "decision": note + " Historical failures retained; no source freeze, deployment or production approval.",
             "promotion": "BLOCKED", "exit_status": 0}
    with verification_path.open("ab") as output:
        output.write((json.dumps(receipt, ensure_ascii=False) + "\n").encode())
    with event_path.open("ab") as output:
        output.write((json.dumps(event, ensure_ascii=False) + "\n").encode())
    for path, prefix in [(verification_path, verification_before), (event_path, events_before)]:
        assert path.read_bytes().startswith(prefix), "append-only ledger prefix changed"

    state["last_gate_record"], state["last_event_id"] = RECEIPT_ID, EVENT_ID
    state["state_revision"] += 1
    state["updated_at"] = timestamp
    state["verification_state"] = "LOCAL_HARDENING_VERIFIED_PROMOTION_BLOCKED" if review["decision"] == "APPROVE" else "LOCAL_CHECKS_PASS_FINAL_REVIEW_UNAVAILABLE_PROMOTION_BLOCKED"
    state["latest_evidence_note"] = state["current_evidence_note"] = note
    state["current_receipt_refs"] = [RECEIPT_ID]
    for key in ("current_checkpoint", "active_checkpoint"):
        state[key].update({"evidence": RECEIPT_ID, "result": result, "observed_subject_fingerprint": subject["fingerprint"],
                           "independent_review": review["decision"]})
    state["current_audit_addendum"].update({"record": RECEIPT_ID, "priorRecord": state["current_audit_addendum"]["record"],
        "observedAt": timestamp, "critic": review["agent_id"], "criticStatus": review["decision"],
        "status": result, "verificationRefs": [RECEIPT_ID], "current_receipt_refs": [RECEIPT_ID], "result": result})
    write(state_path, state)
    write(BASE / "control/qualification-transaction.json", {"receipt": RECEIPT_ID, "event": EVENT_ID,
          "source_fingerprint": subject["fingerprint"], "ledger_prefixes_preserved": True, "prefix_proofs": prefix_proofs,
          "state_revision": state["state_revision"], "promotion": "BLOCKED", "result": result})
    print(json.dumps({"receipt": RECEIPT_ID, "event": EVENT_ID, "result": result, "promotion": "BLOCKED", "ledger_prefixes_preserved": True}))
