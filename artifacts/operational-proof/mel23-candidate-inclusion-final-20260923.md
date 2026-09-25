# MEL23 final candidate inclusion review

- Base commit: `c990914148a8f375082cd12bbdb2ad20cfe1900f`
- Candidate commit: `f8a09bf97d218d3c372b77b75eb2d9caee3bd9b4`
- Candidate branch/worktree: `codex/mel23-candidate-20260923` at `/tmp/cvg-mel23-candidate-20260923`
- Final source fingerprint: `sha256:2bd85675cc076fc406f28c235e6100f5c5973f196212ba9873d5dcdb9aab4ca1`
- Exact final diff: 274 paths, each with its final mode and SHA-256 digest in `mel23-candidate-inclusion-final-20260923.json`.
- Commit sequence: `ab24b85` assembled the reviewed 274-path candidate; `b0a4810` adjusted the subject-manifest test; `f8a09bf` fixed migration cleanup lint findings. Both follow-up commits changed paths already in the original inclusion inventory.
- Clean reproduction checkout: `/tmp/cvg-mel23-repro-20260923`, detached at the candidate SHA, with empty subject status; `npm ci`, typecheck, build, and lint passed. The full 540-test browser matrix is running there against this exact SHA.
- `.agent/**`, `artifacts/**`, and the mutable/history/review Gauntlet paths listed in the JSON remain outside the source commits and subject fingerprint. Candidate-local fixtures and generated evidence were kept in the separate candidate worktree.
- The original workspace remains at its existing base HEAD and retains its prior dirty state.
- No push, merge, tag, release, deployment, external evidence-root edit, or real-provider call was performed.
