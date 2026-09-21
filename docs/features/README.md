# Feature designs

This directory contains the living, versioned design and traceability record for
each product feature. See [the feature lifecycle](../FEATURE_LIFECYCLE.md) before
creating or changing one.

## Registry

| Feature                 | Phase | Status   | Issue                                                   | Design                                      | Pull requests                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----- | -------- | ------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineering foundation  | 0     | Released | Legacy: created before feature issues                   | Existing architecture and operations docs   | [#1](https://github.com/wpliao/meal-planner/pull/1)                                                                                                                                                                                                                                                                                                                                                                                                |
| Trusted family boundary | 1     | Released | [#7](https://github.com/wpliao/meal-planner/issues/7)   | [Design](./0007-trusted-family-boundary.md) | [#8](https://github.com/wpliao/meal-planner/pull/8); [#9](https://github.com/wpliao/meal-planner/pull/9); [#10](https://github.com/wpliao/meal-planner/pull/10); [#11](https://github.com/wpliao/meal-planner/pull/11); [#12](https://github.com/wpliao/meal-planner/pull/12); [#13](https://github.com/wpliao/meal-planner/pull/13); [#14](https://github.com/wpliao/meal-planner/pull/14); [#15](https://github.com/wpliao/meal-planner/pull/15) |
| Lightweight pantry      | 2     | Released | [#16](https://github.com/wpliao/meal-planner/issues/16) | [Design](./0016-lightweight-pantry.md)      | [#17](https://github.com/wpliao/meal-planner/pull/17); [#18](https://github.com/wpliao/meal-planner/pull/18); [#19](https://github.com/wpliao/meal-planner/pull/19); [#20](https://github.com/wpliao/meal-planner/pull/20); [#21](https://github.com/wpliao/meal-planner/pull/21)                                                                                                                                                                  |
| UI foundation           | —     | Accepted | [#23](https://github.com/wpliao/meal-planner/issues/23) | [Design](./0023-ui-foundation.md)           | [#24](https://github.com/wpliao/meal-planner/pull/24)                                                                                                                                                                                                                                                                                                                                                                                              |

Add a row when a feature issue and design document are created. Keep the status
and links current through release, supersession, or retirement.

## Naming

Use `<issue-number>-<short-slug>.md`, for example:
`0006-household-identity.md`. Copy [TEMPLATE.md](./TEMPLATE.md), replace every
placeholder, and link the document from the issue.
