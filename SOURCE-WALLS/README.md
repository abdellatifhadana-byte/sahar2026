# SOURCE-WALLS — Historical 2M TECH source for forensic comparison

This directory is intentionally isolated from the active application.

It contains a historical implementation of the **Mur d'images / Video Wall** functionality that was not present in the workspace during Codex Phase 1 / Phase 1.5.

## Files

- `wallsManager.js` — historical wall/screen manager implementation.
- `mur-dimage-loader.js` — historical loader connecting the selected/current room to the wall manager.

## Important

**Do not import these files into `index.html` and do not merge them into the active application yet.**

They must first be included as an additional source in the cross-source audit (Phase 1.6).

The historical implementation introduces/assumes contracts that differ from the currently audited repository, including:

- `db.getAll('walls')`
- `db.save('walls', ...)`
- `db.getCurrentRoom()`
- a `Wall` object with `roomId`, `image`, and embedded `screens[]`
- screen geometry using `screen.position.{x,y,width,height}`
- optional `screen.deviceLinked`
- QR integration
- ticket integration
- screen diagnostics integration
- admin drawing, dragging and resizing of screens

The active audited repository instead primarily models the video wall through:

- `screens`
- `screen_groups`
- `screen.roomId`
- `positionX / positionY`
- `screen_issues`
- `diagnosis_history`

Codex must therefore compare the two models before choosing a canonical schema.

## Audit objective

Treat this directory as a new source, for example `SOURCE-WALLS`, and rebuild:

1. global source manifest;
2. feature matrix;
3. field-level matrix;
4. dependency graph;
5. data model;
6. relationship graph;
7. wall implementation comparison;
8. cross-source broken chains;
9. provenance matrix;
10. revised migration plan.

No application source file should be replaced or deleted merely because this source exists.
