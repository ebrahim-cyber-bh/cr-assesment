# Audit Log

A running record of every change made to this repo, why it was made, and how it was verified.
Kept separately from `IMPLEMENTATION_NOTES.md`: the notes are the polished submission summary,
this file is the working log I can talk through in the interview.

---

## What this project is

### The business problem, in plain words

A company buys things under a long-term contract called a **Purchase Agreement** — for example
*"we will buy 10 Widget A at $500 each and 30 Widget B at $100 each."*

When something about that contract needs to change — buy 11 widgets instead of 10, switch to a
different supplier, extend the term — you cannot just quietly edit the contract. Someone raises a
**Change Request (CR)**, which is a formal proposal describing the change. That CR is then routed
to an **approver**, a person with the authority to say yes or no.

**This project is the approver's screen.** It answers four questions for them:

1. Which change requests are waiting for me?
2. What exactly does this one change?
3. Who has touched it so far, and when?
4. Can I approve or reject it — and am I even allowed to?

### What it is *not*

There is **no backend, no database, no login**. The data comes from a fake API
(`src/api/cr-api.service.ts`) that reads hardcoded sample data and hands it back after a short
delay, imitating a real network call. The exercise is purely the frontend.

### The two screens

| Screen | What it shows |
|---|---|
| **List** (`cr-list`) | A table of change requests, with a dropdown to filter by status |
| **Detail** (`cr-detail`) | One change request: what it changes, its history, and Approve / Reject buttons |

### The life of a change request

```
DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → APPLIED
                            │
                            └──→ REJECTED        (REJECTED and CANCELLED are dead ends)
```

Approve and Reject only make sense while a CR sits at **PENDING_APPROVAL**. That is why almost every
permission check in this codebase starts by asking "is this CR pending?"

### What's in the repo

| Folder / file | What lives there |
|---|---|
| `src/models/` | The shapes of the data — what a CR, a line item, a user look like |
| `src/api/` | The fake API and the sample data it serves |
| `src/common/` | Small shared helpers: view state, money formatting, permission checks |
| `src/session/` | Who is currently signed in |
| `src/components/cr-list/` | The list screen |
| `src/components/cr-detail/` | The detail screen |
| `src/components/diff.util.ts` | Works out what changed between the old and new line items |
| `*.spec.ts` files | The tests |

### Concepts you need to know to read this code

**Component = class + template.** Each screen is two files that work as a pair. The `.ts` file is a
TypeScript class holding the data and the logic. The `.html` file is the markup, and it can read
anything public on that class. Angular keeps them in sync automatically — change a value in the
class, the screen updates.

**Getter.** A property that is calculated fresh every time it is read, instead of being stored.
Written `get visibleRows() { ... }` in the class, but used as plain `visibleRows` in the template.
This codebase uses getters for everything derived — the filtered rows, the diff, the timeline, the
permission checks. The benefit: nothing can go stale, because nothing is stored in the first place.
Change the filter and the screen just re-reads the getter.

**ViewState.** One object describing what a screen should currently be showing:

```ts
{ status: 'idle' | 'loading' | 'loaded' | 'empty' | 'error', data: T | null, error?: string }
```

The template asks "what is the status?" and shows the matching thing — a spinner, the data, an
empty message, or an error with a Retry button. The point is that a screen is **never blank**:
every possible situation has something visible attached to it.

**Policy strings.** Permissions are plain strings shaped `cr_{action}_{scope}`:

| Part | Values | Meaning |
|---|---|---|
| action | `r` / `a` / `x` | read / approve / apply |
| scope | `u` / `w` / `o` | own CRs / workspace / whole org |

So `cr_a_o` means "may approve any CR in the organisation", while a user holding only `cr_r_o` can
look but not touch. The three sample users are `mona` (approver), `val` (read-only viewer), and
`bob` (approver, but in a different organisation).

**Org scoping.** The fake API only ever returns CRs belonging to the caller's own organisation.
`bob` asking for a CR from `org-alpha` gets an error, not a refusal — he cannot even see that it
exists.

**Promise / async / await.** The fake API does not answer instantly; it answers "in a moment",
which is what a `Promise` represents. `await` means "pause here until the answer arrives." This
matters in tests, which must let the answer arrive before checking what got rendered.

**Jest + TestBed.** `npm test` builds the components in a fake browser, renders them, and then
inspects the actual HTML that came out — for example, "is the Approve button disabled?" These are
not tests of the code's internals; they test what the user would really see.

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

## Task 2 — The status filter on the list screen

### What was asked

> In `cr-list.component`: the loading / loaded / empty / error states are wired — keep them
> correct, and implement the **status filter** so `visibleRows` (and the rendered table) narrows by
> status.

Two halves. The second half is the new work; the first half is a warning not to break what already
exists while doing it.

### Step 1 — Work out what was already there

Before changing anything, I traced what happens when someone picks a status from the dropdown.

The list screen has a `<select>` at the top of the table. The sample data for `org-alpha` is three
change requests: **CR-1** is `PENDING_APPROVAL`, **CR-2** is `APPLIED`, **CR-3** is `DRAFT`.

Following the dropdown through the code:

1. The user picks a status → the browser fires a `change` event.
2. The template calls `onFilterChange(...)` with the chosen value.
3. `onFilterChange` stores it: `this.statusFilter = value`.
4. The table draws one row for each item in `visibleRows`.

Steps 1 to 3 already worked perfectly. The problem was step 4 — `visibleRows` looked like this:

```ts
get visibleRows(): CrSummary[] {
	const rows = this.state.data ?? [];
	// TODO: narrow `rows` by `this.statusFilter` ('ALL' shows everything).
	return rows;
}
```

It handed back **every** row and never once looked at `statusFilter`.

**So the bug was not a broken dropdown.** The dropdown was recording the choice correctly; nothing
was reading it. Choosing a status genuinely changed the value stored in the component — the table
simply ignored it. Useful to know, because it meant the fix was one line in one place, and no
changes to the dropdown at all.

### Step 2 — Make the filter actually filter

**File:** `src/components/cr-list/cr-list.component.ts`

```ts
/** Rows to render, after applying the active status filter. */
get visibleRows(): CrSummary[] {
	const rows = this.state.data ?? [];
	return this.statusFilter === 'ALL' ? rows : rows.filter((cr) => cr.status === this.statusFilter);
}
```

Read in plain English: *"if the filter is set to ALL, hand back everything untouched; otherwise
hand back only the rows whose status matches the filter."*

`'ALL'` is treated as a special value meaning "no filtering", which is why it needs its own branch —
no CR ever has a literal status of `ALL`, so filtering by it would match nothing and empty the
table.

**Why this was the whole component change.** `visibleRows` is a *getter*, so Angular re-reads it
every time it refreshes the screen. Nobody has to tell the table "the filter changed, redraw
yourself" — it asks for the rows again on its own and gets the newly filtered list. This is the
single most useful thing to understand about this codebase.

### Step 3 — Find the hole that opened up

With the filter working, I ran the app and clicked through every status. Picking **CANCELLED**
produced this:

```
┌────────┬────────────┬────────┬───────┐
│ ID     │ Title      │ Status │ Delta │
├────────┴────────────┴────────┴───────┤
│           (nothing here)             │
└──────────────────────────────────────┘
```

Column headings, and nothing underneath. `org-alpha` has no cancelled CRs, so the filter correctly
matched zero rows — but the screen said nothing about it. To a user this looks broken rather than
empty.

**Why the existing "empty" message did not cover this.** The screen already has a
*"No change requests to show"* message, but it never appeared here. The reason is a timing one:

```ts
this.state = { status: rows.length ? 'loaded' : 'empty', data: rows };
```

That line runs **once**, when the data first arrives from the API, and it asks only *"did the API
return anything at all?"* For `org-alpha` the answer is yes, three of them — so the status is set
to `'loaded'` and stays `'loaded'` forever. Filtering happens later, every time the screen redraws,
and never revisits that decision. The empty message was wired to a question that had already been
answered.

### Step 4 — Add the missing message

**File:** `src/components/cr-list/cr-list.component.html`

```html
<p *ngIf="state.status === 'loaded' && !visibleRows.length" class="cr-list__no-matches">
	No change requests with status {{ statusFilter }}.
</p>

<table *ngIf="state.status === 'loaded' && visibleRows.length" class="cr-list__table">
```

Two things happen here. The new paragraph appears when the data loaded fine but the filter matched
nothing. The table gained the same `visibleRows.length` condition, so it hides in exactly that
case — which stops the message and the empty table from appearing together.

`*ngIf` means "only put this element on the page when the condition is true".

**Checking every case.** After the change I walked through every state the screen can be in, to be
sure exactly one thing shows each time:

| Situation | What appears |
|---|---|
| Still fetching | "Loading change requests…" |
| API failed | Error message + Retry button |
| Org has no CRs at all | "No change requests to show." |
| Filter matches some rows | The table |
| Filter matches nothing | "No change requests with status X." |

No situation shows two things, and no situation shows nothing.

**A detail that quietly matters.** The new message names the status: *"No change requests with
status CANCELLED"*. It can never say the nonsensical *"...with status ALL"*, because `'loaded'`
only ever gets set when the API returned at least one row, and `ALL` never filters any of them out.
That is a real dependency between two files — if the `rows.length ? 'loaded' : 'empty'` line were
ever changed, this message could start lying.

### Step 5 — Verify

```bash
npm test        # 3 suites, 7 passed — the two existing list tests still pass
npm run lint    # clean
npm start       # ALL -> 3 rows | PENDING_APPROVAL -> 1 | CANCELLED -> the new message
```

The passing tests matter for the first half of the task: *"keep them correct"*. One existing test
checks that three rows render for `org-alpha`, another that a user in an empty org sees the empty
message and no table. Both still pass, which is the evidence that adding the filter did not damage
the states that were already working.

### The judgment call

**"Your org has no change requests" and "your filter matched nothing" are deliberately different
messages**, in two separate elements (`cr-list__empty` and `cr-list__no-matches`).

They mean different things to the person reading them. The first says there is genuinely nothing
for you to do. The second says the data is there, you have just hidden it — change the filter.
Collapsing them into one message would tell a user with three pending approvals that they have
nothing to review.

There is also a practical reason: an existing test asserts on the `cr-list__empty` element
specifically. Reusing that class for a different meaning would have made that test ambiguous.

### Files changed

| File | Change |
|---|---|
| `src/components/cr-list/cr-list.component.ts` | `visibleRows` now filters by `statusFilter`; `'ALL'` passes everything through |
| `src/components/cr-list/cr-list.component.html` | Added the `cr-list__no-matches` message; table now also requires `visibleRows.length` |

### Known gaps

- **No test covers the no-match message yet.** The suite proves nothing broke; it does not prove
  the new message renders. That test belongs in Task 5.
- **`visibleRows` is evaluated three times per redraw** — once for each `*ngIf` and once for the
  `*ngFor`. Three passes over three rows is free, and the simplicity is worth it. If the list ever
  held thousands of rows, the fix would be to cache the result against `statusFilter` and
  `state.data`, or switch the component to `OnPush` change detection with a precomputed array.
- **Prettier still flags `cr-list.component.ts`**, on line 24 — the `statuses` array is 141
  characters against a 140 limit. That line ships that way and predates this task, so it was left
  alone rather than adding an unrelated reformat to the diff.

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
