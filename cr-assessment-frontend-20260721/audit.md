# Audit Log

A running record of every change made to this repo, why it was made, and how it was verified.
Kept separately from `IMPLEMENTATION_NOTES.md`: the notes are the polished submission summary,
this file is the working log I can talk through in the interview.

---

## 0. Environment

The repo pins Node 18.20.3 via `.nvmrc`, and Angular 15 / `@angular-devkit/build-angular` 15
misbehave on newer Node. Setup used:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd cr-assessment-frontend-20260721
nvm install 18.20.3 && nvm use 18.20.3
npm ci                       # honours .npmrc (legacy-peer-deps) — kept as shipped
```

`nvm use` applies only to the current shell. Every command below assumes Node 18.20.3 is active.

**Baseline before any edit** — `npm test`: `2 failed, 5 passed, 7 total`. This matches the brief
("two tests fail on purpose"), which confirms a clean starting point.

---

## Task 0 — Orient (no code)

Read `README.md`, `CANDIDATE_BRIEF.md`, then `models/` → `fixtures.ts` → `view-state.ts` →
both templates → both components. No source changed. Written up in
`IMPLEMENTATION_NOTES.md` §2.

**What the codebase does**

| Piece | Role |
|---|---|
| `models/cr.models.ts` | `CrSummary`, `CrDetail`, `LineItem`, `TimelineEntry`, `ReqUser` |
| `common/view-state.ts` | `ViewState<T> = { status, data, error }` — the one state shape both screens use |
| `common/permissions.ts` | `hasPolicy` / `canApprovePolicy` over `cr_{action}_{scope}` strings |
| `api/cr-api.service.ts` | Mock API: org-scoped, Promise-based, `latencyMs` + `failNext` knobs |
| `api/fixtures.ts` | 3 users, 4 CRs — each fixture deliberately sets a trap (see below) |

**Patterns to preserve** (the brief's §5 asks for exactly this):

- One `ViewState` per screen; the template `*ngIf`s on `state.status`. No blank screens.
- Derived data lives in **getters** (`visibleRows`, `diff`, `timeline`, `canApprove`), never in
  fields updated by hand. Nothing is cached or mutated behind the template's back.
- The API returns a fresh `CrDetail` after a mutation, so the view can be refreshed from the
  response instead of re-fetching.

**Fixture traps noticed while reading** — these map 1:1 onto the remaining tasks:

| Fixture | Trap |
|---|---|
| `CR-1` SKU-A qty `10 → 11`, price unchanged | the `diff.util` defect (Task 1) |
| `CR-1` audit stored **newest-first** | the timeline ordering TODO (Task 3) |
| `CR-2` SKU-B description-only change, `delta: 0` | forces a call on what counts as "changed" |
| `val` holds only `cr_r_o` | the permission defect (Task 1) |
| `bob` is in `org-beta` | org scoping / the "Not found" error path |

---

## Task 1 — Fix the two failing tests at the root

### 1.1 `computeDiff` misclassified a quantity-only change

**Failing test:** `src/components/diff.spec.ts` → *"detects a quantity-only change as changed"*.
Expected `'changed'`, received `'unchanged'`.

**Root cause** — `src/components/diff.util.ts:30`. The comparison only looked at price:

```ts
const changed = b.unitPrice !== p.unitPrice;
```

A line item is `{ sku, description, quantity, unitPrice }`. Comparing one of the three mutable
fields means any edit to the other two is silently reported as `unchanged` — the user is shown a
diff panel that hides a real change. `CR-1` in the fixtures is exactly this case
(SKU-A goes 10 → 11 units at the same price), so the bug is visible in the running app, not just
in the test.

**Fix** — extract the comparison into a small named predicate and compare every field except the
identity key:

```ts
/**
 * A line is "changed" when any field other than its identity (`sku`) differs. Comparing only the
 * unit price misses quantity-only and description-only edits, which are real changes to the line.
 */
function isChanged(baseline: LineItem, proposed: LineItem): boolean {
	return (
		baseline.quantity !== proposed.quantity || baseline.unitPrice !== proposed.unitPrice || baseline.description !== proposed.description
	);
}
```

and at the call site:

```ts
rows.push({ sku: b.sku, kind: isChanged(b, p) ? 'changed' : 'unchanged', baseline: b, proposed: p });
```

**Why this shape.** The file already keeps `computeDiff` as one flat, readable pass with two
`Map`s for O(n + m) lookup — that algorithm was fine and was left alone. Only the predicate was
wrong, so only the predicate moved. Naming it `isChanged` gives the rule one place to live: when
`LineItem` grows a field, there is a single obvious line to update, and the misleading doc-comment
warning ("the change-detection here is not quite right") could be deleted rather than left to rot.

**Judgment call — description counts as a change.** The brief leaves this open. `CR-2` in the
fixtures is titled *"Replace SKU-B supplier"* and changes only the description
(`Widget B` → `Widget B (new supplier)`) with `delta: 0`. Treating that as `unchanged` would render
a CR whose entire purpose is a change as having changed nothing — wrong in the UI and confusing in
the demo video. A description-only edit has no financial delta but is still a real amendment, so it
is classified `changed`. → recorded in `IMPLEMENTATION_NOTES.md` §5.

### 1.2 Detail page enabled Approve for a user without permission

**Failing test:** `src/components/cr-detail/cr-detail.component.spec.ts` → *"disables Approve for a
read-only viewer on a pending CR"*. Expected `disabled === true`, received `false`.

**Root cause** — `src/components/cr-detail/cr-detail.component.ts:63-70`. Both gates checked only
the CR's status and never the user:

```ts
get canApprove(): boolean {
	// NOTE: this only looks at the CR status. The UI must also respect the user's permissions.
	return this.detail?.status === 'PENDING_APPROVAL';
}
```

`users.viewer` holds `['cr_r_o']` — read-only — and `CR-1` is `PENDING_APPROVAL`, so the status
check passed and the template rendered an enabled Approve button for someone who may not approve.
The template binding `[disabled]="!canApprove || submitting"` was already correct; the component
was feeding it a half-answer.

**Fix** — combine both halves of the rule, reusing the helper that already ships in
`common/permissions.ts` rather than hand-rolling a policy check:

```ts
import { canApprovePolicy } from '../../common/permissions';

/** Whether the current user may approve the loaded CR: the CR must be awaiting a decision AND
 *  the user must hold an approve policy. */
get canApprove(): boolean {
	return this.detail?.status === 'PENDING_APPROVAL' && canApprovePolicy(this.session.user);
}

/** Approve and Reject are the two outcomes of the same approval decision, so they share a gate. */
get canReject(): boolean {
	return this.canApprove;
}
```

**Why this shape.** `canApprovePolicy` already exists and already covers all three approve scopes
(`cr_a_u` / `cr_a_w` / `cr_a_o`) — reusing it means the policy convention has exactly one
implementation. The gate stays a getter so the template keeps re-reading it and nothing needs
manual invalidation when the CR reloads after an action.

**Judgment call — Reject shares the approve gate.** The policy convention in the README defines
`r` (read), `a` (approve) and `x` (apply); there is no separate reject policy. Reject is the other
outcome of the same approval decision, so it is gated by the same permission. Writing
`canReject` as `this.canApprove` keeps the two from drifting apart. If a `cr_j_*`-style reject
policy is introduced later, this is the one line to split. → recorded in
`IMPLEMENTATION_NOTES.md` §5.

### 1.3 Deliberately left for later

Scoping is part of the signal, so Task 1 stayed at root-cause only:

- The Approve button is **disabled but still visible** for a read-only user, while the Reject block
  is hidden by `*ngIf="canReject"`. Task 4 asks that a read-only user "cannot see/enable actions",
  so that asymmetry gets resolved there, not here.
- `approve()` / `reject()` still throw `not implemented` — Task 3.

### 1.4 Files changed

| File | Change |
|---|---|
| `src/components/diff.util.ts` | Added `isChanged` predicate; call site uses it; removed the stale "not quite right" warning from the doc comment |
| `src/components/cr-detail/cr-detail.component.ts` | Imported `canApprovePolicy`; `canApprove` now checks status **and** policy; `canReject` delegates to `canApprove` |

No test files were modified — both originally-failing tests pass unchanged, which is the point of
"fix at the root".

### 1.5 Verification

```bash
npm test        # 3 suites, 7 passed, 0 failed
npm run lint    # clean
npm run typecheck
npx prettier --check "src/**/*.ts"
```

Only `diff.util.ts` was run through Prettier. `cr-api.service.ts`, `fixtures.ts` and
`cr-list.component.ts` ship **already unformatted**; running `npm run format` across the repo would
reformat files this task never touched and bury the real change in noise. They are left as-is.

---

## Interview prep — live changes they may ask for

The brief's §11 says the follow-up includes making a live change and debugging a scenario. Notes on
how each likely ask lands on this code.

### "Add a new filter to the list"

`cr-list.component.ts` already has the shape: state field + derived getter + a `(change)` handler.
Adding, say, a title search is the same three moves:

1. add the state field — `titleQuery = '';`
2. add the handler — `onQueryChange(v: string) { this.titleQuery = v; }`
3. narrow inside `visibleRows` alongside the status check, since it is already the single place
   every rendered row passes through.

The reason this is a small change is that `visibleRows` is a **getter**, not a materialised array.
Nothing has to be re-computed or invalidated on filter change — the template just re-reads it.
That is the design decision to point at when asked why it was easy.

### "Add a Return action"

Mirrors Reject: a gate getter (status + policy), a `submitting` guard, an API call, and refreshing
`state.data` from the returned `CrDetail`. The gate goes in the component, never in the template —
template logic can't be unit-tested, which is why `canApprove` is a getter rather than an inline
`*ngIf` expression.

### "Approve was clicked twice on a slow network — what stops the double action?"

The `submitting` flag, bound in the template as `[disabled]="!canApprove || submitting"`. Set it
before `await`, clear it in a `finally` so a failed call re-enables the button. To demonstrate:
set `api.latencyMs = 500`, click twice, assert one call. This is the scenario the brief names
explicitly, so it is worth having a test that pins it.

### "Why does the diff use two Maps?"

Two `Map`s make it a single O(n + m) pass: one lookup per baseline line to find its proposal, one
per proposed line to spot additions. The naive `proposed.find(...)` inside the baseline loop is
O(n × m). The shipped algorithm was already correct on this point and was not changed — only the
comparison inside it was wrong.

### "Why is `canReject` just `canApprove`?"

See §1.2. Be ready to defend it *and* to split it live if they introduce a separate reject policy —
it is deliberately one line.
