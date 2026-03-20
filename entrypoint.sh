#!/bin/sh
# Ensure the data directory exists whether a named volume or a bind mount is
# used.  For named volumes Docker pre-creates the directory; for bind mounts
# the host path may not exist yet and this mkdir call creates it.
#
# The API entry point (src/api.js) is kept consistent with the CMD defined in
# the Dockerfile and the package.json "scripts.api" field.
set -e
mkdir -p /app/data
exec node src/api.js "$@"
