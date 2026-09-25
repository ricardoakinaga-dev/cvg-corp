import { chown, lstat, mkdir } from "node:fs/promises";

// Compose mounts the operator-owned backup volume at this exact path. Change
// only the directory inode needed by the unprivileged worker; never recurse
// into existing backup artifacts or rewrite their bytes.
const directory = "/var/lib/cvg/backups";
await mkdir(directory, { recursive: true, mode: 0o700 });
const before = await lstat(directory);
if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("backup volume mount must be a real directory");
await chown(directory, 65532, 65532);
const after = await lstat(directory);
if (after.uid !== 65532 || after.gid !== 65532) throw new Error("backup volume directory ownership could not be verified");
process.stdout.write("backup volume ready; directory owner=65532:65532; existing artifacts unchanged\n");
