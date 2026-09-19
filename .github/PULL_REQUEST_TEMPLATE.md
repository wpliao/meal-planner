## Traceability

- Issue: <!-- Required for features and defects -->
- Feature design: <!-- docs/features/<issue>-<slug>.md, or Not applicable with reason -->
- Phase: <!-- Product phase or Maintenance -->
- Acceptance criteria: <!-- AC identifiers implemented or changed -->

## Outcome

<!-- Describe observable behavior and important non-goals. -->

## Design and implementation

<!-- Summarize design choices, implementation boundaries, and alternatives. -->

- [ ] Feature design and traceability table are current, or this is documented as lightweight work.
- [ ] Durable cross-feature decisions have an ADR or explicitly do not require one.

## Impact

- Data and migrations: <!-- Include rollout/recovery, or Not applicable -->
- Security and privacy: <!-- Identity, authorization, validation, logging, external disclosure -->
- Accessibility: <!-- Semantics, keyboard/screen reader, focus, contrast, manual checks -->
- Operations and deployment: <!-- Configuration, environments, rollout/rollback, or Not applicable -->

## Verification

| Criterion or risk | Test or check                      | Result                |
| ----------------- | ---------------------------------- | --------------------- |
| <!-- AC-01 -->    | <!-- file and exact test/check --> | <!-- pass/pending --> |

- `./scripts/verify.sh`: <!-- exact result -->
- CI: <!-- link or pending -->
- Sonar Quality Gate: <!-- link or pending -->
- Development validation: <!-- link/result or not yet required -->
- Production release: <!-- link/result, pending explicit approval, or not applicable -->

## Follow-up

<!-- Known limitations, linked issues, manual configuration, and next action. -->
