# Household decommission runbook

- Feature: [Household lifecycle](../features/0032-household-lifecycle.md)
  (`AC-02`, `AC-03`), issue [#32](https://github.com/wpliao/meal-planner/issues/32)
- Decision: [ADR 0008](../DECISIONS/0008-household-decommissioning.md)
- Workflow: `.github/workflows/household-decommission.yml`
- Script: `scripts/household-decommission.ts` (logic in
  `src/operations/household-decommission/`)

> **Eligibility.** Production is **not eligible**. The workflow's production
> job always fails, and the script refuses `production` before any Cloudflare
> call. Production becomes eligible only after the development rehearsal below
> is recorded, all three implementation gates in the feature design are closed,
> and the owner gives a separate production approval. Enabling it is a reviewed
> code change, not a workflow input.

## What the owner is agreeing to

Read this to the owner, or send it, before asking for approval:

> Deleting the family space removes, from the live database of the one
> environment you name, the household, every member record (including stored
> email addresses and sign-in identifiers), and every pantry item. Recipes will
> be included once that feature exists. The app for that environment stops
> working and stays unavailable afterwards; setting it up again is a new,
> separate decision.
>
> This is removal from the live database, not immediate erasure everywhere.
> Cloudflare keeps D1 point-in-time history ("Time Travel") for a recovery
> window: 7 days on Workers Free and 30 days on Workers Paid. During that
> window the deleted data could, with a further explicit decision, be restored;
> after it the history expires on Cloudflare's schedule. Cloudflare Access
> settings and the Worker itself are not deleted by this step and are retired
> separately. The workflow log records only the environment, opaque IDs, row
> counts, stages, and times. It never records names, emails, or item text.

Check the account's actual plan before quoting the window. Gate 3 (the
production retention wording) stays open until that check is recorded.

## Roles

- **Owner**: an active owner of the household. Requests and approves.
- **Operator**: a person with rights to dispatch workflows and change
  Cloudflare Access and Worker settings for the environment.

The owner and operator may be the same person. The private repository cannot
enforce a second reviewer ([ADR 0005](../DECISIONS/0005-production-deployment-approval-on-github-pro.md)).

## One-time setup (owner)

These are manual owner actions. The repository creates no token, secret, or
variable.

1. Create a Cloudflare API token **only for decommissioning**, separate from
   the deploy token, with:
   - Account › D1 › Edit (preflight reads, Time Travel bookmark, and the
     deletion batch; D1 permissions are account-wide, not per database)
   - Account › Access: Apps and Policies › Read
   - Account › Workers Scripts › Read

   Restrict it to the one account, give it a short expiry, and create it just
   before a planned run.

2. In the GitHub Environment `development`, add the secret
   `CLOUDFLARE_DECOMMISSION_API_TOKEN` with that token. `CLOUDFLARE_ACCOUNT_ID`
   already exists there.
3. In the same environment, add the variable `DECOMMISSION_ACCESS_APP_ID` with
   the **Access application ID** (a UUID, not the AUD tag) that protects
   `family-meal-planner-development.<account-subdomain>.workers.dev`.
4. Delete the token and secret after the run is recorded.

Do not add these to the `production` environment.

## Procedure

### 1. Approval and preflight (before dispatch)

1. Confirm the requester is an active owner through the established private
   contact channel. Do not publish their email.
2. Give the owner the summary above.
3. Have the owner post an approval comment on issue #32 or a linked private
   operational issue, for example:

   > I approve deleting the **development** household
   > `<household-id>` in D1 `<database-id>`. I have read the retention
   > summary. Approval for this run only.

   Copy the comment's URL (`https://github.com/wpliao/meal-planner/issues/<n>#issuecomment-<id>`).

4. Find the household ID and D1 database ID. The D1 ID for development is in
   `wrangler.jsonc` (`5f5e98ba-7b27-4fcf-8c2b-ab1605461082`). The household ID
   is the `household.id` returned by `GET /api/session` for a signed-in member.

### 2. Close access (manual, before dispatch)

1. In Cloudflare Zero Trust, open the environment's Access application.
   Remove or disable every Allow, Bypass, and Service Auth policy and leave one
   **Deny** policy that includes **Everyone** with no Require or Exclude rules.
2. In the Worker's **Settings › Domains & Routes**, disable the `workers.dev`
   route and **Preview URLs**. Confirm there is no custom domain.
3. Ask the owner to sign in from a formerly authorized account and confirm the
   app is no longer reached. Record that confirmation in the approval thread.

If any of these cannot be done or confirmed, stop. D1 is untouched.

The workflow re-checks the closure with read-only API calls before and after
deleting (see [what the checks prove](#what-the-closure-checks-prove)).

### 3. Dispatch

From **Actions › Household decommission › Run workflow**, choose branch
`main` and enter:

| Input                     | Value                                |
| ------------------------- | ------------------------------------ |
| `environment`             | `development`                        |
| `expected_household_id`   | the reviewed household ID            |
| `expected_d1_database_id` | the reviewed D1 ID                   |
| `approval_reference`      | the approval comment URL             |
| `confirmation`            | `DECOMMISSION_DEVELOPMENT_HOUSEHOLD` |

The run then performs, and logs one JSON line per step:

1. **approval**: validates the inputs, the `main` ref, and that the D1 ID
   matches `wrangler.jsonc`, before any Cloudflare call.
2. **preflight** (read-only): the D1 database's name and ID, that the applied
   migrations equal `migrations/`, that the table inventory is exactly the
   tables the procedure accounts for, and count-only checks that exactly one
   household exists, the installation pointer names the reviewed household,
   and no member or pantry row belongs to another household. It records the
   counts and a Time Travel bookmark.
3. **close-access** (read-only): the checks described below.
4. **delete**: one D1 REST request containing the two parameterized
   statements. It is sent once and never retried.
5. **verify**: every count is zero and the closure still holds.

### 4. Record the result

Record in the private operational record (not in the family app): the run URL,
the stage lines, the preflight counts, the bookmark, the final zero counts, the
remaining Time Travel window, and the owner's denial confirmation. Keep
development and production evidence separate.

Then, as separate reviewed steps: retire the Access application and Worker
route, and remove environment secrets that are no longer needed. Keep Access
denying until then.

## What the closure checks prove

The workflow proves closure without any family credential or Access
assertion, using only the scoped API token, which is never printed:

- `GET /accounts/{account}/workers/scripts/{worker}/subdomain` reports
  `enabled: false` and `previews_enabled: false`.
- `GET /accounts/{account}/workers/domains?service={worker}` lists no custom
  domain.
- `GET /accounts/{account}/access/apps/{app}` lists the Worker's `workers.dev`
  hostname, so the checked application is the right one.
- `GET /accounts/{account}/access/apps/{app}/policies` contains only `deny`
  policies, including one unconditional deny for everyone.

What they do not prove: zone-level Worker routes on a custom zone (none are
configured in `wrangler.jsonc`; check manually if one was added), and the
owner's real sign-in experience, which remains the manual confirmation in step
2.3.

## Failure handling

Every failure leaves Access closed. Each failure line names the stage and the
D1 state:

| D1 state    | Meaning                                                   | Next step                                                                                                                                  |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `untouched` | The deletion batch was never sent.                        | Fix the cause (inputs, target, closure, or credentials). Re-dispatch once resolved; the run repeats preflight.                             |
| `unknown`   | The batch was sent, but success was not confirmed.        | **Do not re-dispatch blindly.** Re-dispatching is safe only because it starts with read-only preflight; read its counts before any change. |
| `deleted`   | The batch reported success, but verification then failed. | Investigate the remaining counts or reopened access. Keep access closed.                                                                   |

Specific cases:

- **Preflight says no installation or household remains.** A previous run may
  have committed. Treat it as evidence to review, not success, and record it.
- **Preflight counts do not match.** Never edit data to make them match. Record
  the counts and return to the owner.
- **Table inventory differs.** A migration added a table this procedure does
  not cover (for example, recipes). Do not run it until the procedure is
  updated and reviewed.
- **Unexpected affected-row counts.** The household delete may report either
  `1` or `1 + members + pantry rows`, depending on whether cascaded rows are
  counted; anything else fails. Record the reported numbers.

Read-only calls retry up to three times on HTTP 429, 5xx, and network errors.
The deletion batch is never retried. Recovery through Time Travel restore
overwrites the whole database, is never automatic, and needs a new owner
approval and a post-restore authorization check. It must not silently re-open
Access or bootstrap.

## Development rehearsal (`AC-03`)

The rehearsal is required before production can become eligible. It runs this
workflow against development with disposable data, never against real family
data. If development holds family data, get a separately approved reset first.

1. Seed a disposable household in development (bootstrap as the development
   owner, add a member and pantry items).
2. Follow steps 1 to 4 above.
3. Record the stage lines, the reported affected-row counts, zero verification,
   the owner-observed denial, and that bootstrap stays unreachable.
4. Prove REST batch atomicity (gate 2). The Workers-runtime tests prove
   rollback through the D1 binding; the REST transport must be shown
   separately. The recommended way is an isolated, disposable D1 database with
   the repository migrations, a temporary `BEFORE DELETE ON households` trigger
   that raises an error, and the same two-statement request, then confirming
   the pointer row is still present. Delete the disposable database afterwards.
5. Re-establish a usable development environment before future feature
   validation.

## What stays manual

- Owner identity confirmation, the plain-language summary, and approval.
- Closing Access and the Worker route, and the owner's sign-in confirmation.
- Creating and deleting the decommission token, secret, and variable.
- Retiring the Access application, Worker route, and secrets after success.
- Checking the account plan's Time Travel window.
- Any restore, and any production run.
