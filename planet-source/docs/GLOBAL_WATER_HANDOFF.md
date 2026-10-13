# Complete-cell global → broad-local water handoff

The new bounded experiment uses four **complete** L1 cells, rather than interpreting a center-to-center 3×3 anchor footprint as nine complete climate cells. L1 is reproduced from the saved L0 recipe and must match the exact expected saved layer ID.

- Initial 5×5 lattice spans complete 2×2 cells, with L1 centers at indices 1 and 3. Five explicit 2× stages reach 129×129, about 885×1,222 m, over 113×156 km.
- Each parent cell's spherical area × inherited local yield is distributed using tensor quadrature [¼,½,¼] over its 3×3 node support. Shared-node contributions sum. Every parent cell's owned source mass is independently audited through refinement. Positive local yield covers every node; no center-only dry bands.
- Incoming amounts and IDs are the actual L1 directed crossing edges. Imports stay at their exact inherited nodes. The full L1 source graph is checked before use. Any exit/re-entry path rejects and requires a wider joint domain.
- Fine exits can expand only inside explicit actual outgoing L1 edge corridors. The two original outlet budgets may redistribute; no rainfall is fabricated to repair them.

## Accepted immutable overlay

`acceptGlobalWaterOverlay` accepts only new, provisional external budgets. It binds the exact L1 source evidence, handoff proposal, regional context, corridor budgets, and downstream corrections. Existing externally adopted constraints reject.

The current accepted regional generation imports 2.0366 billion and generates 0.7855 billion m³/year of potential water. Its 2.8221 billion annual export closes to floating-point precision. Eight outside L1 accumulated flows change; all exterior node continuity residuals are below 4×10⁻¹⁶. This is potential water, not calibrated hydraulic discharge.

`saveGlobalWaterOverlay` persists the regional graph and all global downstream corrections as **one** immutable materialization. L1 remains unchanged. Existing entity/condition conflicts reject rather than overwrite. New schema hashes are canonical across persistence; legacy world hashes are untouched.

`createOverlayFlowAccessor(l1, overlay)` validates once and returns a private-snapshot O(1) cell-flow lookup. It recomputes the entire expected correction, validates source ownership, exact import positions, physical footprint, original anchors and all corridor volumes. It rejects missing corrections or superseded-cell sets even if a caller recalculates the record hash. Replaced coarse cells throw: callers must use the explicit regional graph, never their obsolete original totals. This accessor must be used by subsequent downstream-region readers.

## Further local detail

An already accepted overlay makes its downstream budgets adopted. A later local cut may be accepted only if all affected external port identities, positions, levels and annual budgets remain compatible. The end-to-end review uses a no-reentry, single-outlet crop at broad-node (76,20), for which four further 2× refinements preserve the adopted budget. Multi-outlet local proposals that redistribute it are not automatically adopted; those need a composed broader/global transaction.

## Reproduction

Run `node --max-old-space-size=768 scripts/experiments/build-global-water-handoff.mjs L0.json EXPECTED_L1_ID NEW_OUTPUT_DIRECTORY`.

For the review, `L0.json` is the saved `muna-atlas-001` ensemble world and `EXPECTED_L1_ID` is `sha256:343bd23a29779d6fb1005b43014963f79491358c933ee6f5aa9a28e66127aca9`.

Run `node --test test/global-water-handoff.test.mjs`.

The compact review in `reports/global-water-handoff-2026-10-12.json` records exact identities and diagnostics. Generated large review files remain outside the source tree. This experiment does not update legacy L1 readers, implement overlapping-overlay composition, replace coarse climate with a new rainfall simulation, or claim observed geological/rivers accuracy.
