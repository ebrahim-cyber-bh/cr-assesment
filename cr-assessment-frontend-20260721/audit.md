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

## Task 3 — The detail screen

### What was asked

> In `cr-detail.component` + its template:
> - the **diff/preview panel** (added / removed / changed / unchanged rows, with totals and delta),
> - the **approval timeline**, rendered **chronologically**,
> - **permission-aware action visibility**: whether Approve/Reject are offered/enabled must respect
>   both the CR's status and the user's policies,
> - **Approve / Reject actions** that call the API and behave correctly on a slow or failing response,
> - **Reject reason validation**: a reason is required before Reject can proceed.

### Step 0 — Establish what was already done

Before writing anything I checked each of the five bullets against the shipped code, so as not to
rebuild working parts.

| Bullet | State before Task 3 |
|---|---|
| Diff panel | **Already complete.** The template loops `diff` into a table with `data-kind` on each row; the `diff` getter was fixed in Task 1 |
| Totals + delta | **Already complete.** The header renders `fmt(baselineTotal) → fmt(newTotal)` and `(Δ fmt(delta))` |
| Timeline | Template loop existed; the `timeline` getter returned entries **unsorted** — a TODO |
| Permission gating | Fixed in Task 1 (`canApprove` checks status **and** policy) |
| Approve / Reject | Both threw `not implemented` — TODOs |
| Reject validation | `rejectControl` had **no validators** — a TODO |

So the real work was four things: sort the timeline, add validators, implement the two actions, and
make the "why is there no button" case explicit.

**Note on totals.** `baselineTotal`, `newTotal` and `delta` come from the API and are rendered as
given, rather than re-derived from the line items. The server owns the money — recomputing it in the
frontend would introduce a second source of truth that could disagree with the backend. Verified the
fixture is self-consistent: CR-1 baseline `10×500 + 30×100 = 8000`, proposed `11×500 + 30×100 = 8500`,
delta `500`. ✅

---

### Step 1 — Reject reason validation

**File:** `src/components/cr-detail/cr-detail.component.ts`

**Before:**
```ts
// TODO: add validation so the form is invalid until a reason is entered.
rejectControl = new FormControl('', { nonNullable: true });
```

**After:**
```ts
/** `pattern(/\S/)` on top of `required` so a reason of only spaces does not count as one. */
rejectControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] });
```

Also added `Validators` to the existing `@angular/forms` import.

**Why two validators, not one.** `Validators.required` only rejects an *empty* string — a reason of
`"   "` passes it. `Validators.pattern(/\S/)` demands at least one non-whitespace character. Without
it, a user could hold down the spacebar and enable the Reject button.

**No template change was needed.** The markup already had both halves wired to the control:

```html
<p *ngIf="rejectControl.invalid && rejectControl.touched" class="cr-actions__reason-error" role="alert">
	Please enter a reason.
</p>
<button ... [disabled]="!canReject || submitting || rejectControl.invalid" (click)="reject()">
```

Those bindings were dormant because the control could never *be* invalid. Adding the validators
brought both to life at once.

---

### Step 2 — Timeline in chronological order

**File:** `src/components/cr-detail/cr-detail.component.ts`

**Before:**
```ts
/** Approval timeline, oldest-first. */
get timeline(): TimelineEntry[] {
	// TODO: return the audit entries ordered chronologically (oldest first).
	return this.detail?.audit ?? [];
}
```

**After:**
```ts
/** Approval timeline, oldest-first. Sorted on a copy: `sort` mutates, and `audit` belongs to the
 *  loaded CR. ISO-8601 timestamps sort correctly as plain strings. */
get timeline(): TimelineEntry[] {
	return [...(this.detail?.audit ?? [])].sort((a, b) => a.at.localeCompare(b.at));
}
```

**Why the array is copied first.** `Array.prototype.sort` sorts **in place** — it rearranges the
original. `this.detail.audit` is not a local list; it is part of the loaded CR held in `state.data`.
Sorting it directly would quietly reorder the component's own data every time the screen redrew. The
spread `[...]` makes a copy, so the sort touches only what is about to be rendered.

**Why string comparison works on dates.** Timestamps are ISO-8601 in UTC
(`2026-03-02T10:00:00.000Z`): fixed-width, largest unit first, so alphabetical order and
chronological order are the same thing. No `Date` parsing needed.

**Why this mattered.** CR-1's audit ships deliberately out of order — `SEND_FOR_APPROVAL`, then
`SUBMIT`, then `CREATE`. Rendered as-is, the screen claimed the CR was sent for approval before it
was created.

---

### Step 3 — Saying *why* no action is offered

**File:** `src/components/cr-detail/cr-detail.component.ts` — new getter, added after `canReject`

**Before:** *(did not exist)*

**After:**
```ts
/** Why no action is on offer, or null when the user may act. Keeps the template free of the
 *  status-vs-permission branching so it can be asserted on directly. */
get actionUnavailableReason(): string | null {
	if (this.canApprove) return null;
	if (this.detail?.status !== 'PENDING_APPROVAL') return 'This change request is not awaiting approval.';
	return 'You do not have permission to act on this change request.';
}
```

**File:** `src/components/cr-detail/cr-detail.component.html`

**Before:**
```html
<p *ngIf="actionError" class="cr-actions__error" role="alert">{{ actionError }}</p>

<button type="button" class="cr-actions__approve" [disabled]="!canApprove || submitting" (click)="approve()">
```

**After:**
```html
<p *ngIf="actionError" class="cr-actions__error" role="alert">{{ actionError }}</p>

<p *ngIf="actionUnavailableReason" class="cr-actions__unavailable">{{ actionUnavailableReason }}</p>

<button type="button" class="cr-actions__approve" [disabled]="!canApprove || submitting" (click)="approve()">
```

**The problem this solves.** A greyed-out button with no explanation is a dead end — the user cannot
tell whether the CR is in the wrong state or whether *they* are the wrong person. The two causes get
different sentences.

**Why the branching lives in the component, not the template.** The brief asks to avoid "template
logic that can't be tested". A ternary inside `{{ }}` can only be checked by scraping rendered text;
a getter returning `string | null` can be asserted on directly.

---

### Step 4 — The Approve and Reject actions

**File:** `src/components/cr-detail/cr-detail.component.ts`

**Before:**
```ts
async approve(): Promise<void> {
	// TODO: perform the approve action through the API and reflect the outcome in the view.
	throw new Error('approve() not implemented');
}

async reject(): Promise<void> {
	// TODO: require a valid rejectControl, then perform the reject action through the API and
	//       reflect the outcome in the view.
	throw new Error('reject() not implemented');
}
```

**After:**
```ts
async approve(): Promise<void> {
	await this.act((at) => this.api.approve(this.session.user, this.id, at));
}

async reject(): Promise<void> {
	if (this.rejectControl.invalid) {
		this.rejectControl.markAsTouched(); // surfaces the validation message on a bare click
		return;
	}
	const reason = this.rejectControl.value.trim();
	await this.act((at) => this.api.reject(this.session.user, this.id, at, reason));
}

/**
 * Shared approve/reject flow. Re-checks the permission gate the template already enforces,
 * blocks a second call while one is in flight, and swaps in the CR the API returns so the
 * status, totals and timeline stay consistent without a second round-trip. A failure leaves the
 * loaded CR untouched and surfaces the message instead.
 */
private async act(call: (at: string) => Promise<CrDetail>): Promise<void> {
	if (this.submitting || !this.canApprove) return;
	this.submitting = true;
	this.actionError = undefined;
	try {
		this.state = { status: 'loaded', data: await call(new Date().toISOString()) };
	} catch (err) {
		this.actionError = (err as Error).message;
	} finally {
		this.submitting = false;
	}
}
```

**Why one shared `act` helper.** Approve and Reject differ only in which API call they make.
Everything around that call — the double-submit guard, the permission re-check, clearing the old
error, swapping in the result, resetting `submitting` — is identical. Writing it twice would mean
two places to get the error handling wrong. The caller passes a function that takes the timestamp
and returns the API promise; `act` owns the lifecycle.

Point-by-point:

| Line | Why it is there |
|---|---|
| `if (this.submitting ...) return;` | **Double-submit guard.** On a slow network a user can click Approve twice before the first call returns. The button is already disabled via `[disabled]`, but a disabled button is a UI courtesy, not a guarantee — the component enforces it too |
| `... \|\| !this.canApprove` | **Defence in depth.** The template already hides/disables the controls, but the method is public and must not depend on the template being correct |
| `this.actionError = undefined;` | Clears a stale error so a retry does not show the previous failure next to a success |
| `data: await call(...)` | The API returns the **updated** `CrDetail` — new status, new `updatedAt`, new audit entry. Assigning it refreshes status, timeline and gating together, with no second request |
| `catch` → `actionError` | On failure `state` is never reassigned, so the previously loaded CR stays on screen intact. The user sees what they were looking at, plus a message |
| `finally` | `submitting` is reset on **both** paths. In `try` alone, a failed call would leave the buttons disabled forever |
| `new Date().toISOString()` | The mock API takes the timestamp from the caller rather than generating it |

**Why `reject()` calls `markAsTouched()`.** The validation message is bound to
`rejectControl.invalid && rejectControl.touched`. A control is only "touched" once the user has
focused and left it, so on a click with an untouched empty box the message would stay hidden and the
click would appear to do nothing. Marking it touched makes the reason visible.

**Why the reason is trimmed.** `"  price too high  "` is stored as `"price too high"`. The validator
guarantees there is real content; trimming keeps the stored audit note clean.

---

### Step 5 — Verification

`npm test` (7/7) only proves nothing broke — none of the shipped tests touch the new code. So each
new behaviour was checked with a temporary spec, run, and confirmed before the file was removed
again. All ten passed:

| # | Checked | Result |
|---|---|---|
| 1 | CR-1 timeline renders `CREATE → SUBMIT → SEND_FOR_APPROVAL` | ✅ |
| 2 | Approve updates status to `APPROVED`, appends `APPROVE` to the timeline, disables the button afterwards | ✅ |
| 3 | Reject button disabled when empty **and** when whitespace-only; enabled with real text | ✅ |
| 4 | Reject stores the trimmed reason as the timeline note; the reject block disappears once terminal | ✅ |
| 5 | Calling `reject()` with an empty reason makes no API call, marks the control touched, shows the message | ✅ |
| 6 | A failing approve (`failNext`) shows "Network error", leaves the CR at `PENDING_APPROVAL`, resets `submitting` | ✅ |
| 7 | A slow approve (`latencyMs = 40`) disables the button, and a second click adds only **one** `APPROVE` entry | ✅ |
| 8 | Read-only viewer sees the diff, Approve disabled, reject block absent, permission message shown | ✅ |
| 9 | An `APPLIED` CR shows "not awaiting approval" | ✅ |
| 10 | CR-1 diff renders `['changed', 'unchanged']`; totals show `USD 8,000.00` and `USD 8,500.00` | ✅ |

The spec file was kept at
`scratchpad/task3-verification.spec.ts` — it is the natural starting point for Task 5 rather than
something to rewrite from scratch.

Standard checks after the change:

```bash
npm test        # 3 suites, 7 passed
npm run lint    # clean
npm run typecheck
npx prettier --check src/components/cr-detail/cr-detail.component.ts   # clean
```

---

### Judgment calls

**1. The Approve button stays visible but disabled for a read-only user.** Task 4 says a read-only
user "cannot see/enable actions", which reads like the button should be hidden. It must not be. The
shipped test does:

```ts
const approveBtn = fixture.nativeElement.querySelector('.cr-actions__approve');
expect(approveBtn.disabled).toBe(true);
```

with `users.viewer`. Hiding the button makes `querySelector` return `null` and the test crashes. The
provided spec is the tie-breaker, so "cannot see/enable actions" is read as *no action is ever
available to them* — Approve renders disabled, the reject form is hidden entirely, and
`actionUnavailableReason` explains why.

**2. Reject is hidden while Approve is only disabled.** That asymmetry ships in the template
(`*ngIf="canReject"` on the reject block) and is kept. It is defensible: a textarea asking for a
rejection reason is meaningless to someone who cannot reject, whereas the greyed Approve button
communicates that an approval step exists but is not theirs.

**3. Totals are rendered as the API reports them,** not recomputed from line items. One source of
truth for money.

**4. A whitespace-only reason is not a reason.** `Validators.required` alone would have accepted it.

---

### Files changed

| File | Change |
|---|---|
| `src/components/cr-detail/cr-detail.component.ts` | Added `Validators` import; validators on `rejectControl`; `timeline` sorts a copy oldest-first; new `actionUnavailableReason` getter; implemented `approve()` and `reject()` on a shared private `act()` helper |
| `src/components/cr-detail/cr-detail.component.html` | Added the `cr-actions__unavailable` message |

Two files. The diff panel, totals, permission gates and all existing bindings were left untouched
because they were already correct.

---

### Summary of what has been done

Task 3 turned the detail screen from a read-only preview into a working approval tool:

1. **The timeline now tells the truth** — entries render oldest-first instead of in whatever order
   the API returned them, sorted on a copy so the loaded CR is never mutated.
2. **Reject demands a real reason** — empty and whitespace-only are both blocked, at the button and
   again inside the method, with the validation message revealed on a bare click.
3. **Both actions work end to end** — they call the API, swap in the returned CR so status, timeline
   and gating update together, and need no second request.
4. **The unhappy paths behave** — a failure shows a message and leaves the CR on screen unharmed; a
   slow response disables the controls and a second click is ignored; `submitting` always resets.
5. **The UI explains itself** — instead of an unexplained greyed-out button, the user is told
   whether the CR is not awaiting approval or the permission is not theirs.

Every one of those was observed passing, not merely reasoned about.

---

### Known gaps

- **The verification tests are not in the repo yet.** They live in the scratchpad; folding them into
  `cr-detail.component.spec.ts` is Task 5.
- **Timestamps render as raw ISO strings** (`2026-03-02T10:00:00.000Z`). A `| date:'medium'` pipe
  would read better; left alone because the README states visual polish is not assessed, and no test
  should be broken for cosmetics without a reason.
- **The reject textarea stays editable while a reject is in flight.** The button is disabled, so no
  second call can start; only the text can change under a request already sent. Disabling the
  control during `submitting` would be tidier.
- **`new Date()` is called inside the component**, which makes the timestamp untestable without
  faking timers. Injecting a clock would be more rigorous but is over-engineering at this size.

---

## Task 4 — Role/permission awareness and UX states

### What was asked

> A read-only user sees the data but cannot see/enable actions; loading, empty, and error states are
> represented explicitly in the templates (no blank screens).

### Step 0 — Audit what already satisfied this

Task 4 is largely a *consequence* of Tasks 1–3 rather than new construction, so the first job was to
walk every state both screens can reach and find what was genuinely missing.

**List screen — every reachable state:**

| State | What renders | Since |
|---|---|---|
| `loading` | "Loading change requests…" (`role="status"`) | shipped |
| `error` | Message + **Retry** button (`role="alert"`) | shipped |
| `empty` (org has no CRs) | "No change requests to show." | shipped |
| `loaded`, filter matches nothing | "No change requests with status X." | **Task 2** |
| `loaded`, filter matches rows | The table | shipped |

**Detail screen — every reachable state:**

| State | What renders | Since |
|---|---|---|
| `loading` | "Loading change request…" (`role="status"`) | shipped |
| `error` | Message + **Retry** button (`role="alert"`) | shipped |
| `loaded` | Header, diff, timeline, actions | shipped |
| `loaded`, user may not act | Approve disabled + reason message | **Task 3** |
| `loaded`, CR not pending | Approve disabled + "not awaiting approval" | **Task 3** |

**On the `idle` status.** `ViewStatus` includes `'idle'`, and neither template has a branch for it —
which looks like a blank-screen hole. It is not reachable: both components initialise to `idle()`,
but `ngOnInit` immediately calls `load()`, which sets `loading()` before the first render. A branch
for it would be dead code, so none was added. Recorded here because "why is `idle` unhandled?" is a
fair question to be asked.

That audit left **two** genuine gaps, both on the detail screen, both about the moment an action is
in flight.

---

### Gap 1 — An in-flight action gave no feedback

**File:** `src/components/cr-detail/cr-detail.component.html`

**Before:**
```html
<p *ngIf="actionUnavailableReason" class="cr-actions__unavailable">{{ actionUnavailableReason }}</p>

<button type="button" class="cr-actions__approve" [disabled]="!canApprove || submitting" (click)="approve()">
```

**After:**
```html
<p *ngIf="actionUnavailableReason" class="cr-actions__unavailable">{{ actionUnavailableReason }}</p>

<p *ngIf="submitting" class="cr-actions__pending" role="status">Submitting…</p>

<button type="button" class="cr-actions__approve" [disabled]="!canApprove || submitting" (click)="approve()">
```

**Why.** Clicking Approve on a slow connection greyed both buttons out and then… nothing, until the
response arrived. Greyed-out controls with no explanation read as *broken*, not as *busy*. An action
in flight is a loading state, and Task 4 asks for loading states to be explicit. `role="status"`
matches the two loading messages already in the templates, so screen readers announce it the same
way.

No component change was needed — `submitting` already existed and was already being set by `act()`.

---

### Gap 2 — The reason box stayed editable mid-request

**File:** `src/components/cr-detail/cr-detail.component.html`

**Before:**
```html
<textarea class="cr-actions__reason" [formControl]="rejectControl"></textarea>
```

**After:**
```html
<textarea class="cr-actions__reason" [formControl]="rejectControl" [readonly]="submitting"></textarea>
```

**Why.** This was logged as a known gap at the end of Task 3. Once Reject is clicked, the reason has
been sent; letting the user keep typing means the box no longer shows what was actually submitted.
The Reject button was already disabled, so no second request could start — this closes the smaller
hole of the text drifting out of sync with the request in flight.

**Why `[readonly]` and not `disable()`.** The reactive-forms way would be
`rejectControl.disable()` / `.enable()`, but a disabled control is treated as **not part of the
form** — its validity is excluded, so `rejectControl.invalid` would flip to `false` mid-request and
the Reject button's `[disabled]` binding would briefly disagree with itself. `[readonly]` blocks
typing without touching validity, and stays declarative — bound straight to `submitting`, with no
imperative enable/disable calls to keep in sync.

---

### Verification

13 checks, all passing, run against real rendered DOM:

| Group | Checked | Result |
|---|---|---|
| List | Loading renders its message | ✅ |
| List | `failNext` → error message **and** a Retry button | ✅ |
| List | Empty org renders the empty message | ✅ |
| List | Filter matching nothing → message, table absent | ✅ |
| List | Loading renders visible text, not an empty shell | ✅ |
| Detail | Loading renders its message | ✅ |
| Detail | Cross-org request → "Not found" + Retry | ✅ |
| Read-only | Sees title, 2 diff rows, 3 timeline entries | ✅ |
| Read-only | **Zero enabled buttons anywhere on the page**, reject block absent | ✅ |
| Read-only | Told *why* — message mentions permission | ✅ |
| Read-only | `approve()` called directly still leaves the CR `PENDING_APPROVAL` | ✅ |
| In-flight | Pending message appears, textarea becomes readonly, both revert on completion | ✅ |
| In-flight | A **failed** action clears the pending message and shows the error | ✅ |

The strongest of these is *"zero enabled buttons anywhere on the page"* — it queries every `<button>`
in the rendered output and asserts none is enabled, rather than naming the two we happen to know
about. A future action added without a permission gate would fail it.

Saved at `scratchpad/task4-verification.spec.ts` for Task 5.

```bash
npm test        # 3 suites, 7 passed
npm run lint    # clean
```

**One test of mine failed first time round** — `Cannot configure the test module when the test module
has already been instantiated`, because a single `it` called the render helper twice and TestBed
cannot be reconfigured after instantiation. The *code* was fine; the test was wrong. Replaced with a
single-render assertion. Worth remembering when writing Task 5: **one TestBed configuration per
test**.

---

### A note on Prettier and templates

`npx prettier --check` flags `cr-detail.component.html`. Checked against the committed version: it
**already failed before this task**, and every line Prettier wants to reflow (the `<tr><th>…</th></tr>`
header row, the Approve button, the reason-error paragraph) ships that way in the scaffold. The
project's own `npm run format` script only targets `src/**/*.ts`, so templates were never in its
scope. Left untouched — reformatting them would add a large unrelated diff.

---

### Judgment calls

**1. Approve stays rendered-but-disabled for a read-only user** (carried over from Task 3). The
brief's wording is "cannot see/enable actions", but the shipped spec asserts
`querySelector('.cr-actions__approve').disabled === true` for `users.viewer` — the element must
exist. Read as *no action is ever available to them*: Approve disabled, reject form hidden,
`actionUnavailableReason` explaining which of the two reasons applies.

**2. `idle` is deliberately unhandled** — unreachable, so a branch would be dead code. See Step 0.

**3. No success confirmation after an action.** The status badge changes (`PENDING_APPROVAL` →
`APPROVED`) and a new timeline entry appears, both visible immediately. A separate "Approved!"
banner would duplicate information already on screen.

---

### Files changed

| File | Change |
|---|---|
| `src/components/cr-detail/cr-detail.component.html` | Added the `cr-actions__pending` message; added `[readonly]="submitting"` to the reason textarea |

One file, two changes (`git diff --stat`: 3 insertions, 1 deletion — one new line plus its blank
separator, and one line modified in place). Everything else Task 4 asks for was already satisfied by
Tasks 1–3 — which is the point of the audit in Step 0.

---

### Summary of what has been done

1. **Walked every reachable state of both screens** and confirmed each one renders something
   explicit — 10 in total (5 per screen, counting the two "cannot act" variants of the detail
   screen's `loaded` state). All 10 are covered across the two verification specs; the
   "CR not awaiting approval" case is pinned in the Task 3 spec rather than the Task 4 one.
2. **Closed the in-flight feedback gap**: an action in progress says "Submitting…" instead of
   silently greying out.
3. **Closed the mid-request editing gap**: the reason box freezes while its rejection is being sent.
4. **Proved the read-only guarantee properly** — not "the two buttons we know about are disabled",
   but "no enabled button exists anywhere on the page", plus the component refusing the action even
   when called directly, bypassing the UI entirely.

---

### Known gaps

- **Tests still live outside the repo.** Two verification specs now sit in the scratchpad
  (`task3-verification.spec.ts`, `task4-verification.spec.ts`, 23 checks between them). Folding them
  into the real spec files is Task 5, and is the largest outstanding item in the submission.
- **`idle` remains unhandled**, by choice — see above.
- **Timestamps still render as raw ISO strings.**

---

## Task 5 — Tests

### What was asked

> Add your own tests (component/DOM where relevant). Cover the behavior you built — list states and
> filter, the diff, the timeline, the permission logic, the action flows and their unhappy paths,
> and validation. We value tests that pin rendered behavior and edge cases over a coverage number.

### Approach

**Extended the three existing spec files rather than adding new ones.** The scaffold already
establishes where each kind of test lives; a parallel set of `*.extra.spec.ts` files would have
split related assertions across two places for no benefit.

**The provided tests were kept verbatim.** All four still read exactly as shipped. They are the
graded baseline, so they were left untouched and new tests were grouped underneath them in
`describe` blocks.

**Two helper changes**, both backward-compatible so the provided tests still call them unchanged:

```ts
const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));   // was: () => ... 0

interface RenderOptions { settle?: boolean; failNext?: boolean; latencyMs?: number }
async function render(user: ReqUser, id: string, opts: RenderOptions = {}) { ... }
```

- `settle: false` stops before the API resolves, so the **loading** state can be asserted on.
- `failNext: true` is set on the service *before* the component is created, so the **error** state
  is reachable on first load.
- `latencyMs` is applied *after* the initial load settles, so only the action is slow — the test
  does not pay the latency twice.

**Rule learned in Task 4 and applied throughout: one `TestBed.configureTestingModule` per test.**
TestBed cannot be reconfigured once instantiated, so each `it` renders exactly once.

---

### The 45 tests, numbered

**`src/components/diff.spec.ts` — 10 tests** (pure function, no DOM)

| # | Test | What it pins |
|---|---|---|
| 1 | detects a removed sku | *provided* — a baseline SKU missing from the proposal is `removed` |
| 2 | detects an added sku | *provided* — a proposed SKU absent from the baseline is `added` |
| 3 | detects a quantity-only change as changed | *provided, originally failing* — the Task 1 bug |
| 4 | detects a unit-price-only change as changed | The original comparison still works; the fix did not trade one field for another |
| 5 | detects a description-only change as changed | The judgment call from Task 1, pinned — this is the CR-2 "new supplier" case |
| 6 | reports an untouched line as unchanged | The fix did not make *everything* look changed — the opposite failure mode of #3 |
| 7 | treats every line as added when there is no baseline | Empty-baseline edge case |
| 8 | treats every line as removed when nothing is proposed | Empty-proposal edge case |
| 9 | keeps baseline order and appends added lines | Row **order** is stable regardless of how the proposal is ordered |
| 10 | carries both sides of a changed row | `baseline` and `proposed` are both populated, so the template can render before/after |

**`src/components/cr-list/cr-list.component.spec.ts` — 11 tests** (rendered DOM)

| # | Test | What it pins |
|---|---|---|
| 11 | renders a row per change request in the user org | *provided* — 3 rows for org-alpha |
| 12 | shows the empty state when the org has no change requests | *provided* — message shown, table absent |
| 13 | shows the loading state before the API resolves | Renders `.cr-list__loading` and **no** table mid-flight |
| 14 | shows the error state with a Retry button when the API fails | `failNext` → message contains "Network error", Retry button present, table absent |
| 15 | recovers when Retry succeeds after a failure | Clicks the real Retry button; error clears and 3 rows appear. Pins that the error state is not a dead end |
| 16 | narrows the table to the selected status | `PENDING_APPROVAL` → exactly 1 row, and it is CR-1 |
| 17 | restores every row when the filter goes back to ALL | Filtering is reversible — `DRAFT` (1) → `ALL` (3) |
| 18 | shows a no-match message instead of an empty table | `CANCELLED` → message naming the status, table absent. The Task 2 gap |
| 19 | keeps the no-match message distinct from the org-empty message | `.cr-list__empty` must **not** appear when the filter is what emptied the table |
| 20 | only lists change requests belonging to the caller org | `bob` (org-beta) sees 1 row, CR-9 — org scoping |
| 21 | emits the change request id when a row is clicked | Real DOM click → `select` emits `'CR-1'`. Pins the list→detail wiring |

**`src/components/cr-detail/cr-detail.component.spec.ts` — 24 tests** (rendered DOM)

*View states*

| # | Test | What it pins |
|---|---|---|
| 22 | loads and renders the change request title | *provided* |
| 23 | disables Approve for a read-only viewer on a pending CR | *provided, originally failing* — the Task 1 permission bug |
| 24 | shows the loading state before the API resolves | `.cr-detail__loading` renders mid-flight |
| 25 | shows an error with a Retry button when the CR belongs to another org | `bob` requesting CR-1 → "Not found", Retry present, header absent |

*Diff panel*

| # | Test | What it pins |
|---|---|---|
| 26 | classifies each proposed line and renders it as a row | CR-1 renders `['changed', 'unchanged']` via the `data-kind` attribute |
| 27 | renders the before and after quantities of a changed line | The before cell shows `10 ×`, the after cell `11 ×` — the diff is *readable*, not just correct |
| 28 | renders the totals and the delta as formatted money | `USD 8,000.00`, `USD 8,500.00`, delta `USD 500.00` — pins `formatMoney` reaching the template |

*Timeline*

| # | Test | What it pins |
|---|---|---|
| 29 | renders the audit entries oldest-first | CR-1 ships newest-first; rendered order must be `CREATE → SUBMIT → SEND_FOR_APPROVAL` |
| 30 | does not reorder the loaded CR itself when sorting for display | Reads the getter, then asserts `detail.audit[0]` is **still** `SEND_FOR_APPROVAL`. Pins the "sort a copy" invariant — the reason for the `[...]` spread |

*Permission and status gating*

| # | Test | What it pins |
|---|---|---|
| 31 | lets an approver act on a pending CR in their own org | The positive case — Approve enabled, reject form present, no "unavailable" message |
| 32 | offers a read-only viewer no enabled action anywhere on the page | Queries **every** `<button>` and asserts none is enabled — catches any future action added without a gate |
| 33 | still shows the data to a read-only viewer | 2 diff rows, 3 timeline entries. "Cannot act" must not become "cannot see" |
| 34 | explains that a CR which is not awaiting approval cannot be acted on | CR-2 (`APPLIED`) → "not awaiting approval", Approve disabled |
| 35 | refuses the action even when `approve()` is called directly | Bypasses the UI entirely; the CR stays `PENDING_APPROVAL`. Pins the guard *inside* `act()`, not just the template |

*Approve*

| # | Test | What it pins |
|---|---|---|
| 36 | applies the returned CR to the view and appends the timeline entry | Status → `APPROVED`, badge updates, last timeline action is `APPROVE` |
| 37 | withdraws the actions once the CR is no longer pending | Approve disabled and the reject block gone after approving — the gates re-evaluate off the new status |
| 38 | surfaces a failure and leaves the loaded CR untouched | `failNext` → error shown, status still `PENDING_APPROVAL`, **and the button is enabled again** so it can be retried |
| 39 | shows a pending message and freezes the reason box while in flight | `latencyMs: 40` → `.cr-actions__pending` present and the textarea `readOnly`; both revert afterwards |
| 40 | ignores a second click while the first call is still in flight | Two `approve()` calls under latency produce exactly **one** `APPROVE` entry. The scenario the brief names in §11 |

*Reject and reason validation*

| # | Test | What it pins |
|---|---|---|
| 41 | keeps Reject disabled until a reason is entered | Disabled when empty, enabled once real text is typed |
| 42 | does not accept a reason of only whitespace | `'    '` leaves it disabled — the reason `Validators.required` alone was not enough |
| 43 | shows the validation message and calls no API when rejected with no reason | `reject()` on an empty control reveals `.cr-actions__reason-error` and makes no call. Pins `markAsTouched()` |
| 44 | records the trimmed reason on the timeline and withdraws the actions | `'  price too high  '` is stored as `'price too high'`; status → `REJECTED`; reject block gone |
| 45 | surfaces a failed reject and keeps the reason for a retry | Error shown, CR unchanged, **and the typed reason is still in the control** so the user need not retype it |

---

### Verifying the tests are not vacuous

A green suite proves nothing on its own — a test that asserts nothing also passes. So both Task 1/2
fixes were deliberately reverted and the suite re-run:

| Mutation | Tests that caught it |
|---|---|
| `isChanged` reduced back to `unitPrice` only | #3 quantity-only, #5 description-only, #26 rendered diff kinds |
| `visibleRows` returning `rows` unfiltered | #16 narrows to status, #17 restores on ALL, #18 no-match message |

**6 failures, exactly where expected.** Both files were then restored and the suite returned to
45/45. This is the evidence that the tests pin behaviour rather than merely execute it.

---

### Coverage against the brief's checklist

| The brief asks for | Tests |
|---|---|
| List states | 12, 13, 14, 15, 18, 19 |
| Filter | 16, 17, 18, 19 |
| The diff | 1–10, 26, 27, 28 |
| The timeline | 29, 30 |
| Permission logic | 23, 31, 32, 33, 34, 35 |
| Action flows | 36, 37, 44 |
| Unhappy paths | 14, 15, 25, 38, 39, 40, 45 |
| Validation | 41, 42, 43, 44 |

---

### Judgment calls

**1. Extended the shipped spec files instead of adding new ones.** Related assertions stay together,
and the provided tests remain in place as the baseline.

**2. DOM assertions preferred over component-property assertions.** Where both were possible, the
test asserts on rendered output (`querySelector('.cr-actions__approve').disabled`) rather than the
getter behind it. The brief asks for tests that pin *rendered behaviour*; a getter can be right while
the template ignores it.

**3. Component methods are called directly for action flows** (`await fixture.componentInstance.approve()`)
rather than clicking the button. A DOM click on a disabled button silently does nothing, which would
make a broken test look like a passing one. Where the *wiring* is the point — #15 Retry, #21 row
click — a real DOM click is used instead.

**4. No coverage threshold was configured.** The brief explicitly values edge cases over a coverage
number, and a threshold would invite tests written to raise a percentage.

**5. `latencyMs` is applied after the initial load** so only the action under test is slow. Total
suite runtime stays under 5 seconds.

---

### Files changed

| File | Change |
|---|---|
| `src/components/diff.spec.ts` | 3 provided tests kept; **7 added** |
| `src/components/cr-list/cr-list.component.spec.ts` | 2 provided tests kept; **9 added**; `render` gained options, `flush` gained an optional delay |
| `src/components/cr-detail/cr-detail.component.spec.ts` | 2 provided tests kept; **22 added**; same helper changes plus two small text helpers |

No application code was changed by Task 5 — which is itself worth noting: the tests were written
against the behaviour as built, and all 38 new ones passed without needing to adjust the components.

---

### Summary of what has been done

- **45 tests, all passing**, up from the 7 that shipped (2 of which originally failed).
- **38 new tests** covering every item on the brief's Task 5 checklist.
- **Verified by mutation** — reintroducing either original bug fails exactly the tests that should
  fail, and no others.
- **Rendered behaviour, not internals** — disabled buttons, absent elements, message text, row
  ordering and timeline ordering are all asserted on the DOM.
- **Deterministic and fast** — 45 tests in ~4.5s, driven by `latencyMs`/`failNext` rather than real
  delays or fake timers.
- Lint, typecheck and Prettier all clean on the three spec files.

---

### Known gaps

- **`app.component.ts` (the demo shell) is untested.** The README states it is "just glue for the
  demo"; the `setTimeout`-based reload trick would need fake timers for little value.
- **`money.util.ts` has no direct unit test.** It is covered indirectly through #28. A dedicated test
  of `formatMoney(1234567.891, 'USD')` would pin the thousands separator and rounding more precisely.
- **`SessionService` is always replaced with a stub**, so the real default-user wiring is never
  exercised in a test.
- **Timestamps are not asserted**, because `act()` calls `new Date()` internally. Injecting a clock
  would make the `at` value assertable.

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

Two layers, both in `act()` (see Task 3, Step 4). The `submitting` flag is bound in the template as
`[disabled]="!canApprove || submitting"`, so the button greys out the moment the first call starts.
But a disabled button is a UI courtesy, not a guarantee — `act()` opens with
`if (this.submitting || !this.canApprove) return;`, so a second call is dropped even if it arrives
some other way. `submitting` is cleared in a `finally`, so a *failed* call re-enables the button
rather than locking the screen.

Verified: with `latencyMs = 40`, two `approve()` calls produce exactly one `APPROVE` entry on the
timeline.

### "Why does the diff use two Maps?"

Two `Map`s make it a single O(n + m) pass: one lookup per baseline line to find its proposal, one
per proposed line to spot additions. The naive `proposed.find(...)` inside the baseline loop is
O(n × m). The shipped algorithm was already correct on this point and was not changed — only the
comparison inside it was wrong.

### "Why is `canReject` just `canApprove`?"

See §1.2. Be ready to defend it *and* to split it live if they introduce a separate reject policy —
it is deliberately one line.

---

## The screen recording

### What the brief actually asks for

> A **5–8 minute screen-recording**: walk through the list + detail screens (including a rejection
> and an error state) and one non-trivial decision.

Four required ingredients, and nothing else is mandatory:

1. the **list** screen,
2. the **detail** screen,
3. a **rejection**, performed on camera,
4. an **error state**, shown on camera,
5. one **non-trivial decision**, explained.

Everything beyond those is optional and competes for the same 8 minutes.

### Before recording — two practical gotchas

**1. The mock API is stateful.** `CrApiService` keeps a private `detailStore` and `approve`/`reject`
mutate it. Approve CR-1 once and it stays `APPROVED` for the rest of the session — the demo cannot
be repeated without a **browser refresh**. Refresh between takes, and refresh before the final run.

**2. Zero latency makes the loading states invisible.** `latencyMs` defaults to `0`, so the spinner
text never appears on camera. For the recording only, set a visible delay in
`src/api/cr-api.service.ts`:

```ts
latencyMs = 600;   // demo only — revert before committing
```

This also makes the "Submitting…" message and the disabled-button window long enough to see, which
matters for the double-submit explanation. **Revert it before the final commit**, or say out loud
that it is temporary.

### A 5–8 minute running order

| Time | Show | Say |
|---|---|---|
| 0:00–0:30 | The app, loaded | What the domain is: buyers amend purchase agreements via change requests; this is the approver's screen |
| 0:30–2:00 | **List.** Loading → 3 rows. Filter to `PENDING_APPROVAL` → 1 row. Filter to `CANCELLED` → the no-match message. Back to `ALL` | That `state.status` is decided once at load time, so a filter matching nothing needed its own message — and why that message is deliberately different from "your org has no CRs" |
| 2:00–3:15 | **Detail (CR-1).** The diff panel, then the totals and delta, then the timeline | SKU-A changed 10 → 11 at the same price — the bug was that only `unitPrice` was compared. The timeline: the fixture ships newest-first, so it is sorted for display **on a copy**, because `sort` mutates |
| 3:15–4:15 | **Permissions.** Switch "Acting as" to `val` | Approve is disabled, the reject form is gone entirely, and the UI says *why*. Read-only means no enabled action anywhere on the page |
| 4:15–4:45 | **Error state.** Switch to `bob` (org-beta) with CR-1 still selected | The API is org-scoped, so this is "Not found" — plus a Retry button, because an error state must not be a dead end |
| 4:45–6:00 | **Rejection.** Back to `mona`, refresh. Click Reject with the box empty → validation message. Type a reason → button enables. Reject → status `REJECTED`, reason on the timeline, actions withdrawn | Empty *and* whitespace-only are both blocked; the reason is trimmed before it is stored |
| 6:00–7:30 | **The non-trivial decision** (see below) | — |
| 7:30–8:00 | `npm test` → 45 passing | Briefly: what the suite covers, and that the tests were verified by reverting the bugs to confirm they fail |

### Which non-trivial decision to pick

**Recommended: the double-submit guard.** It is the scenario the brief itself names in §11
("Approve was clicked twice on a slow network"), and it is the only one you can *demonstrate* rather
than merely describe. With `latencyMs` raised, click Approve twice on camera, then show the timeline
has exactly one `APPROVE` entry, then show the code:

```ts
private async act(call: (at: string) => Promise<CrDetail>): Promise<void> {
	if (this.submitting || !this.canApprove) return;
	...
	} finally {
		this.submitting = false;
	}
}
```

Three points to make: the template disables the button, but a disabled button is a **UI courtesy,
not a guarantee**, so the component re-checks; the permission gate is re-checked for the same reason;
and `submitting` resets in a `finally` so a *failed* call re-enables the button instead of locking
the screen.

**Alternatives if you prefer a judgment call over a mechanism:**

- **Description-only edits count as `changed`** — CR-2 is titled "Replace SKU-B supplier" and changes
  nothing but the description, with `delta: 0`. Calling that "unchanged" would render a CR whose
  entire purpose is a change as having changed nothing.
- **`[readonly]` instead of `disable()`** on the reason box — a disabled Angular control reports
  `invalid === false`, so the Reject button's binding would briefly disagree with itself.

Pick **one** and go deep. Two shallow explanations are worse than one complete one.

### What to leave out

- **Reading code line by line.** Show a snippet only when it is the decision being explained.
- **Explaining Angular basics** — what `*ngIf` is, what a getter is. Assume a competent audience.
- **Setup**: `npm install`, `nvm use`, the folder structure.
- **Walking this audit file.** It is a written artefact; reading it aloud burns the whole budget.
- **Narrating all 45 tests.** Show the green summary, name the categories, move on.
- **Apologising** for what is unfinished. State it plainly once if it comes up, or leave it to
  `IMPLEMENTATION_NOTES.md`.
- **Every filter permutation.** Two are enough to make the point.

### Delivery notes

- **Rehearse once without recording.** The running order above is tight; the first attempt always
  overruns.
- **Zoom the browser and the editor** so text is legible in a compressed video.
- **Say the decision before the mechanism** — "I decided X because Y, here is how it works" beats
  narrating code and arriving at a conclusion.
- **8 minutes is a ceiling, not a target.** A tight 6 minutes that covers all five ingredients is
  better than a rushed 8.
- The AI-usage disclosure belongs in `IMPLEMENTATION_NOTES.md` §6, not in the video — but be ready
  to talk about it in the interview.
