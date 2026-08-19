# Implementation Notes
first of all i started by reading the candidate documnet. I started working on task 0 and getting the code to run.

I had to install nvm here. and ran the app.


## 1. What I changed

Task 1: 
  - Here the old code was compparing the change by only comapring it wiht the price (unitprice). Beacuse of that as qunitiy get chnaged it was showing unchnaged, menaing it was not considering it. for that i created isChnaged function which basically checks the quantity, unit, price and describtion. so that any chnage is now detected.

  - Second thing canApprove in the cr-detail.component.ts was only checking if the Cr is ahving a correct ststus without checking the privileges that user has (like having the permesion to approve or reject). so I added anApprovePolicy(user) which managed permesions (edit and view).
  
  - After that 7 test have passed.


Task 2:
  - The status that were there were working (loading, loaded, empty, and error states). 
  - The issue was with filter. When filter is applied all of cr shows without consdering the the status applied.
  -  I fixed it by applying the check of  statusFilter making sure the appropate cr shows when filter is applied.
  - For empty fileds (in our case CANCELLED for example) a meassage was added notifing the user that this filed is empt not just show nothing.

Task 3:
  - The diff and totals were working as Task 1 was fixed.
  - The timeline was having an order problem. it shows enteries as they recive it from the api. so i fixed it by making sure that timeline is sorted from oldest to newesst.
  - I sorted a audit list instade of doing the chnages in the original list. 
  - approve() and reject() were just shoing errors. So I implmented both of them so they call the api and update the cr on the screen.
  - Only approve or reject is allowed for once meaning if the user submitted once another submision wont be accepted,.
  - Rejection requires the user to enter text and then do the rejection other wise reject button is unclicable.
  - Appropriate messages were added to explain why these buttons are disabled (putting the user in context).


Task 4: 
  - First i checked the different states of both screens: loading, error, empty, loaded, no matching results, and no permission.
  - The idea is making sure the user dont get blank screen (not knowing whats going on).
  - So i added ""Submitting…" for Approve and Reject request is in process. 
  - I also made the rejection textbox read-only while the rejection is being submitted, so that the user dont change this field anymore.

Task 5:
  - Now i have full idea of most things to consider and make sure they are working well.
  - So what I did is added more tests to the current test file I was having.
  - I tested the list loading, error, empty, and no-match states, as well as the status filter.
  - For the diff logic, I tested all four results: added, removed, changed, and unchanged. I also specifically tested quantity-only and description-only changes.
  - For the detail screen, I tested timeline ordering, permissions, Approve and Reject, the double-click protection, and rejection validation.
  - I also checked that a read-only user has no enabled action buttons.

  - To make sure test is goin in the right side i removed fixes made in task 1 and ran the test. Tests that were supposed to fail did fail. I then restored the fixes and confirmed everything passed again.


## 2. Component & state model

- The app has two main screens, the list of change request and the detail page for one cr.
- Both pages has these states loading, loaded, empty and error and they use one status object menaing the page knows what to show.
- In the list screen there is a status filter, and the table only shows requests that matchs it. 
- In the detail screen there is the diff, the timeline, and whether Approve or Reject are enabled fresh each time, and also tracks whether an action is currently submitting, any action error, and the typed rejection reason.
- when you do an approve or reject, it calls the API and updates the screen directly from the response instead of reloading everything.

## 3. Invariants I keep

| Invariant | How / where |
|---|---|
1. The screen should always show a clear state instead of being blank.
Both screens check their current state and show the correct content or message

2. Approve and Reject should only work when the CR is PENDING_APPROVAL and the user has permission.
Checked using canApprove / canReject, and checked again before sending the action

3. The same action shouldn't be submitted twice.
A submitting flag blocks another request while one is already running

4. Reject must have a real reason.
Validation blocks empty text and whitespace-only text.

5. Timeline should go from oldest to newest.
The audit entries are sorted by their at timestamp.

6. Read-only users can view the CR but can't take actions.
Approve is disabled and Reject isn't available to them

## 4. Testing strategy
  - I used Jest with Angular TestBed (a bit new filed to me but i manged to understand the main concepts and way things are arranged) so I could test the actual components and what shows in the page.

  - For example, I checked whether buttons were disabled, whether the correct messages appeared, and how many rows were shown after filtering.
  
  - I kept the pure diff logic tests in diff.spec.ts because they don't need the UI. The list and detail tests use the actual components and rendered HTML.
  
  - I used the mock API's latencyMs and failNext options to test loading and error situations without needing real network delays. This keeps the tests quick and predictable.
  
  - I didn't add tests for app.component.ts because it's mainly a demo shell used to move around the application and isn't one of the main graded screens.
  
  - I also didn't create a separate test for money.util.ts. Its behaviour is already checked indirectly through the totals tests on the detail page.


## 5. Assumptions
- I treated a description-only change as a real change (not only the price and quantity).
- I used the same permission for Approve and Reject because the existing policy only defines read, approve, and apply permissions. (Both rejection and approving follow same rules).
- I treated "there are no CRs" and "there are no CRs matching this filter" as two different situations. (Meaningfully keeping the user in context as they are two diffrent things).
- ad-only users, I kept the Approve button visible but disabled because the provided test expects it to still exist on the page. I hid the Reject section because a read-only user can't do anything with it anyway.


## 6. Where I used AI
Speaking honstly and frontly without any kind going here and there. As I recived the project from Ms. Zainab (HR), I read the requiments and analysed the project goal and then took it to phase 0. where using claude ai and chatgbt I placed the project breif and the way files are arranged and satrt setting up the plan. I read the candidate breaif which placed me in context of the requirment. I sat the plan with the tools i worked with and splited the project into phases based on the task separation.

for each task I was asking claude code (built in with vs code) to explain to me the task and which files I'll be dealing with. Then i try to analyse the code get the idea and know the functionality then ask for a demo soloution. not to go and fix it but to state it in the terminal (for me to be in context first). I explain what I'm trying to reach and my logic and for the practicle work I ask him to provide the code block . (Example i will need a function to handle request... explain all logic and ai provide the code).

i did that to all task, some of them i didnt have the logic so i need to do some search for similer cases and see what they Implmnet and come bacj again exxplaining the logic. 

its my first time to deal with Angular framework however I worked with type-script, html, tailwind so it wansnt that deal.

For the tests i llisted things i want ot test in the code and asked claude again to add them in the current tests files.

so overall in my whole path I was using Ai, in plainng, working and testing but a smart way of using it and using the right tool for each thing.

for the implmentaion notes I wrote them by my self no ai.



## 7. What I'd improve with more time
- I would format the timeline dates instead of showing the full raw ISO timestamp like 2026-03-02T10:00:00.000Z.
- I would fully disable the reject textbox while submitting instead of only making it read-only.
- I would add a direct unit test for formatMoney instead of only testing it through the totals.
- I would avoid using new Date() directly inside the component and instead inject the clock/time dependency. That would make it easier to test the exact timestamp being sent to the API.
