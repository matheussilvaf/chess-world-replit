# bbpPairings v6.0.0 Source Code
# Repository: https://github.com/BieremaBoyzProgramming/bbpPairings
# License: Apache 2.0

This directory should contain the bbpPairings v6.0.0 source code.

## Setup

Clone or download the source from:
https://github.com/BieremaBoyzProgramming/bbpPairings

The build script (`server/scripts/build.sh`) expects:
- `src/` directory with C++ source files
- `Makefile` from the upstream repository

## Required files

```
vendor/bbpPairings/
  Makefile           (from upstream)
  Apache-2.0.txt    (license)
  LICENSE.txt        (license summary)
  README.txt         (upstream readme)
  src/               (all .cpp and .h files)
```

## Build requirements

- C++ compiler with C++20 support (g++ 10+, clang++ 13+)
- make
- Linux x86_64 or arm64

## If compilation is not possible

The build script will fall back to the pre-compiled static binary in `server/bin/bbpPairings`.
The health check endpoint will report the exact error encountered.
