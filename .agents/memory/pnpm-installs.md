---
name: pnpm per-package installs
description: Installing npm packages in this pnpm monorepo — root add fails
---
The package-management installer targets the workspace ROOT and fails with `ERR_PNPM_ADDING_TO_ROOT` in this monorepo (pnpm v10).
**Why:** pnpm refuses root-level deps without `-w`, and the tool doesn't pass it.
**How to apply:** install per package: `pnpm --filter @workspace/<pkg> add [-D] <dep>`. If a dependency's postinstall build is blocked, `pnpm approve-builds` may be needed.
