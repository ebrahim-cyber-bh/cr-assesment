# Implementation Notes

first of all i started by reading the candidate documnet. I started working on task 0 and getting the code to run.

I had to install nvm here. and ran the app.



> Fill this in as part of your submission. 1–2 pages, bullet points are fine. Delete these
> instructions before submitting.

## 1. What I changed
<!-- Grouped by task: bugs fixed and features implemented (component + template). -->
- Task 1: isChanged is quantity, unitPrice and description as it was comapring proce alone. ( diff.util.ts)
canApprove checks CR status and canApprovePolicy(user). (cr-detail.component.ts).

after doing that all the test have passed.


## 2. Component & state model
<!-- The screens, the view-state each component exposes, and how data flows from the mock API into the
template. -->

- The app has two screens, the list of change request and the detail page for one cr.
- Both pages has these states loading, loaded, empty and error and they use one status object menaing the page knows what to show.
- In the list screen there is a status filter, and the table only shows requests that matchs it. 
- In the detail screen there is the diff, the timeline, and whether Approve or Reject are enabled fresh each time, and also tracks whether an action is currently submitting, any action error, and the typed rejection reason.
- when you do an approve or reject, it calls the API and updates the screen directly from the response instead of reloading everything.

## 3. Invariants I keep
<!-- Which properties the UI guarantees, and where in the component/template each is enforced. -->

| Invariant | How / where |
|---|---|

## 4. Testing strategy
<!-- What you tested (component/DOM vs pure) and why; what you deliberately skipped given the budget. -->

-

## 5. Assumptions
<!-- Where the requirements left room for interpretation, the calls you made and why. -->

-

## 6. Where I used AI
-

## 7. What I'd improve with more time
-
