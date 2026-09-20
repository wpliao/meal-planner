# Feature designs

This directory contains the living, versioned design and traceability record for
each product feature. See [the feature lifecycle](../FEATURE_LIFECYCLE.md) before
creating or changing one.

## Registry

| Feature                 | Phase | Status       | Issue                                                 | Design                                      | Pull requests                                                               |
| ----------------------- | ----- | ------------ | ----------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Engineering foundation  | 0     | Released     | Legacy: created before feature issues                 | Existing architecture and operations docs   | [#1](https://github.com/wpliao/meal-planner/pull/1)                         |
| Trusted family boundary | 1     | Implementing | [#7](https://github.com/wpliao/meal-planner/issues/7) | [Design](./0007-trusted-family-boundary.md) | [#8](https://github.com/wpliao/meal-planner/pull/8); implementation pending |

Add a row when a feature issue and design document are created. Keep the status
and links current through release, supersession, or retirement.

## Naming

Use `<issue-number>-<short-slug>.md`, for example:
`0006-household-identity.md`. Copy [TEMPLATE.md](./TEMPLATE.md), replace every
placeholder, and link the document from the issue.
