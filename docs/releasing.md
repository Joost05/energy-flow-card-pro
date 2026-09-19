# Release process

This document describes the release flow used by Energy Flow Card Pro.

## Before creating a release

1. Update the source and documentation on `main`.
2. Update `package.json` version.
3. Update the runtime version banner in `src/index.ts`.
4. Update `CHANGELOG.md`.
5. Run the project checks:

   ```bash
   npm run check
   ```

6. Confirm that the generated file is:

   ```text
   dist/energy-flow-card-pro.js
   ```

7. Commit and push to `main`.

## Create the GitHub release

Use a semantic version tag such as:

```text
v1.0.0
```

Release title example:

```text
Energy Flow Card Pro v1.0.0
```

The GitHub Actions release workflow builds the project and uploads this asset:

```text
energy-flow-card-pro.js
```

After publishing, confirm that the Action completed successfully and that the asset is visible under **Assets**.

## Release notes matter for HACS

HACS displays the GitHub release description. It does **not** automatically render `CHANGELOG.md` as the update description.

Do not leave a release body containing only GitHub's generated compare link. Add concise human-readable notes, for example:

```markdown
## What's new

- Added ...
- Improved ...

## Fixes

- Fixed ...
```

`CHANGELOG.md` remains the complete project history; the GitHub release description should summarize what matters to someone deciding whether to update.

## Test the HACS update path

After publishing:

1. open Energy Flow Card Pro in HACS;
2. use **Update information** if the new release is not visible yet;
3. confirm the new version is offered;
4. update through HACS;
5. reload the frontend;
6. confirm an existing card still loads with its configuration intact;
7. test both desktop and mobile.

For a major release, also test a clean HACS installation in addition to an update from the previous version.

## 1.0.0 release checklist

### Docs and repository

- [ ] README finalized
- [ ] screenshots added and linked correctly
- [ ] configuration reference reviewed
- [ ] troubleshooting reviewed
- [ ] migration guide reviewed
- [ ] release guide reviewed
- [ ] changelog contains the `1.0.0` section
- [ ] repository is public
- [ ] HACS custom repository metadata is correct

### Versioning and build

- [ ] `package.json` = `1.0.0`
- [ ] runtime banner = `1.0.0`
- [ ] `npm run check` passes
- [ ] `dist/energy-flow-card-pro.js` is up to date
- [ ] GitHub Action passes
- [ ] `energy-flow-card-pro.js` is attached to the release

### Functional verification

- [ ] clean HACS install passes
- [ ] HACS update from the previous version passes
- [ ] existing configuration survives the update
- [ ] desktop layout checked
- [ ] phone layout checked
- [ ] tablet layout checked
- [ ] light theme checked
- [ ] dark theme checked
- [ ] demo mode checked
- [ ] history/replay checked
- [ ] hierarchy focus navigation checked
- [ ] descendant warning propagation checked
- [ ] Grid three-phase graph checked
- [ ] pricing and period statistics checked
