#!/bin/sh
# Copy every bank the writers have finished that is not yet in assessments/
# into tools/assessment-writing/work-in-progress/<folder>/, with the notes.
OUT=/home/user/cestis-work/banks/out
REPO=$(cd "$(dirname "$0")/../.." && pwd)
for d in "$OUT"/*/; do
  f=$(basename "$d")
  for j in "$d"*.json; do
    [ -e "$j" ] || continue
    [ -e "$REPO/assessments/$f/$(basename "$j")" ] && continue
    mkdir -p "$REPO/tools/assessment-writing/work-in-progress/$f"
    cp "$j" "$REPO/tools/assessment-writing/work-in-progress/$f/"
  done
done
mkdir -p "$REPO/tools/assessment-writing/notes/electives"
cp /home/user/cestis-work/banks/notes/electives/*.md "$REPO/tools/assessment-writing/notes/electives/" 2>/dev/null
cp /home/user/cestis-work/banks/notes/business-administration-level-5*.md "$REPO/tools/assessment-writing/notes/" 2>/dev/null
true
