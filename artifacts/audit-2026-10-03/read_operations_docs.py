"""Bounded, read-only document output and explicit reading acknowledgements."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ASSIGNMENT = json.loads((HERE / "operations-assignment.json").read_text())
LEDGER = HERE / "operations-read-ledger.json"
BUDGET = 24000


def build_chunks():
    chunks = []
    current = []
    size = 0
    for entry in ASSIGNMENT["files"]:
        path = ROOT / entry["path"]
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError(f"Document changed since inventory: {entry['path']}")
        lines = raw.decode("utf-8").splitlines(keepends=True)
        for number, line in enumerate(lines, 1):
            if current and size + len(line.encode("utf-8")) > BUDGET:
                chunks.append(current)
                current = []
                size = 0
            current.append((entry["path"], number, line))
            size += len(line.encode("utf-8"))
    if current:
        chunks.append(current)
    return chunks


parser = argparse.ArgumentParser()
parser.add_argument("chunk", type=int, nargs="?")
parser.add_argument("--through", type=int)
parser.add_argument("--ack", type=int, nargs="+")
parser.add_argument("--note", default="")
args = parser.parse_args()
chunks = build_chunks()

if args.ack is not None:
    if not all(0 <= index < len(chunks) for index in args.ack) or not args.note.strip():
        raise ValueError("A valid returned chunk and explicit reading note are required")
    data = json.loads(LEDGER.read_text()) if LEDGER.exists() else {
        "reader": "lead_after_operations_agent_startup_failure",
        "method": "Full UTF-8 content, bounded line chunks; acknowledgements only after returned content is read",
        "acknowledged_chunks": {},
        "files": [],
    }
    for index in args.ack:
        data["acknowledged_chunks"][str(index)] = args.note
    files = []
    for entry in ASSIGNMENT["files"]:
        required = [i for i, chunk in enumerate(chunks) if any(row[0] == entry["path"] for row in chunk)]
        acknowledged = [i for i in required if str(i) in data["acknowledged_chunks"]]
        files.append({**entry, "chunks": required, "read_chunks": acknowledged,
                      "full_read": len(required) == len(acknowledged),
                      "summary": " ".join(data["acknowledged_chunks"][str(i)] for i in acknowledged),
                      "relevance": "Requirement or historical evidence; current claims are rechecked against code and current executions"})
    data["files"] = files
    data["status"] = "READING_COMPLETE" if all(f["full_read"] for f in files) else "READING_IN_PROGRESS"
    LEDGER.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"Acknowledged {args.ack}; {sum(f['full_read'] for f in files)}/{len(files)} files complete")
if args.chunk is not None:
    last = args.chunk if args.through is None else args.through
    if not 0 <= args.chunk <= last < len(chunks):
        raise ValueError("Invalid chunk")
    for index in range(args.chunk, last + 1):
        print(f"CHUNK {index}/{len(chunks)-1}")
        previous = None
        for path, number, line in chunks[index]:
            if path != previous:
                print(f"\nFILE {path} START LINE {number}")
                previous = path
            print(line, end="")
        print(f"\nEND CHUNK {index}; LAST {chunks[index][-1][0]}:{chunks[index][-1][1]}")
elif args.ack is None:
    for index, chunk in enumerate(chunks):
        print(index, len(chunk), chunk[0][0], chunk[0][1], "through", chunk[-1][0], chunk[-1][1])
