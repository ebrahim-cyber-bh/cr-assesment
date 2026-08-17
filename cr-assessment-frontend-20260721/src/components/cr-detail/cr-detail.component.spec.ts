import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrDetailComponent } from './cr-detail.component';
import { SessionService } from '../../session/session.service';
import { CrApiService } from '../../api/cr-api.service';
import { users } from '../../api/fixtures';
import { ReqUser } from '../../models/cr.models';

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** `settle: false` stops before the API resolves; `latencyMs` keeps a call in flight on purpose. */
interface RenderOptions {
	settle?: boolean;
	failNext?: boolean;
	latencyMs?: number;
}

async function render(user: ReqUser, id: string, opts: RenderOptions = {}): Promise<ComponentFixture<CrDetailComponent>> {
	TestBed.configureTestingModule({
		imports: [CrDetailComponent],
		providers: [{ provide: SessionService, useValue: { user } }],
	});
	await TestBed.compileComponents();
	TestBed.inject(CrApiService).failNext = opts.failNext ?? false;
	const fixture = TestBed.createComponent(CrDetailComponent);
	fixture.componentInstance.id = id;
	fixture.detectChanges(); // ngOnInit -> load()
	if (opts.settle !== false) {
		await flush(); // let the mock API resolve
		fixture.detectChanges(); // render the loaded state
	}
	TestBed.inject(CrApiService).latencyMs = opts.latencyMs ?? 0;
	return fixture;
}

const textOf = (f: ComponentFixture<CrDetailComponent>, sel: string) => f.nativeElement.querySelector(sel)?.textContent ?? '';
const allText = (f: ComponentFixture<CrDetailComponent>, sel: string) =>
	[...f.nativeElement.querySelectorAll(sel)].map((e: any) => e.textContent.trim());

describe('CrDetailComponent', () => {
	it('loads and renders the change request title', async () => {
		const fixture = await render(users.approver, 'CR-1');
		expect(fixture.nativeElement.querySelector('.cr-detail__header h2').textContent).toContain('Add 1 unit of SKU-A');
	});

	it('disables Approve for a read-only viewer on a pending CR', async () => {
		const fixture = await render(users.viewer, 'CR-1'); // viewer: cr_r_o only; CR-1 is PENDING_APPROVAL
		const approveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');
		expect(approveBtn.disabled).toBe(true);
	});

	describe('view states', () => {
		it('shows the loading state before the API resolves', async () => {
			const fixture = await render(users.approver, 'CR-1', { settle: false });
			expect(fixture.nativeElement.querySelector('.cr-detail__loading')).not.toBeNull();
		});

		it('shows an error with a Retry button when the CR belongs to another org', async () => {
			const fixture = await render(users.otherOrg, 'CR-1'); // bob is org-beta, CR-1 is org-alpha
			expect(fixture.nativeElement.querySelector('.cr-detail__error').textContent).toContain('Not found');
			expect(fixture.nativeElement.querySelector('.cr-detail__error button').textContent).toContain('Retry');
			expect(fixture.nativeElement.querySelector('.cr-detail__header')).toBeNull();
		});
	});

	describe('diff panel', () => {
		it('classifies each proposed line and renders it as a row', async () => {
			const fixture = await render(users.approver, 'CR-1'); // SKU-A 10 -> 11 units, SKU-B untouched
			const kinds = [...fixture.nativeElement.querySelectorAll('.cr-diff__row')].map((r: any) => r.getAttribute('data-kind'));
			expect(kinds).toEqual(['changed', 'unchanged']);
		});

		it('renders the before and after quantities of a changed line', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const cells = [...fixture.nativeElement.querySelectorAll('.cr-diff__row')[0].querySelectorAll('td')].map((c: any) =>
				c.textContent.trim(),
			);
			expect(cells[2]).toContain('10 ×');
			expect(cells[3]).toContain('11 ×');
		});

		it('renders the totals and the delta as formatted money', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const totals = textOf(fixture, '.cr-detail__totals');
			expect(totals).toContain('USD 8,000.00');
			expect(totals).toContain('USD 8,500.00');
			expect(textOf(fixture, '.cr-detail__delta')).toContain('USD 500.00');
		});
	});

	describe('timeline', () => {
		it('renders the audit entries oldest-first, whatever order the API returned', async () => {
			// CR-1 ships as SEND_FOR_APPROVAL, SUBMIT, CREATE — i.e. newest first.
			const fixture = await render(users.approver, 'CR-1');
			expect(allText(fixture, '.cr-timeline__action')).toEqual(['CREATE', 'SUBMIT', 'SEND_FOR_APPROVAL']);
		});

		it('does not reorder the loaded CR itself when sorting for display', async () => {
			const fixture = await render(users.approver, 'CR-1');
			void fixture.componentInstance.timeline; // read the getter
			expect(fixture.componentInstance.detail?.audit[0].action).toBe('SEND_FOR_APPROVAL');
		});
	});

	describe('permission and status gating', () => {
		it('lets an approver act on a pending CR in their own org', async () => {
			const fixture = await render(users.approver, 'CR-1');
			expect(fixture.nativeElement.querySelector('.cr-actions__approve').disabled).toBe(false);
			expect(fixture.nativeElement.querySelector('.cr-actions__reject')).not.toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-actions__unavailable')).toBeNull();
		});

		it('offers a read-only viewer no enabled action anywhere on the page', async () => {
			const fixture = await render(users.viewer, 'CR-1');
			const enabled = [...fixture.nativeElement.querySelectorAll('button')].filter((b: any) => !b.disabled);
			expect(enabled).toEqual([]);
			expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
			expect(textOf(fixture, '.cr-actions__unavailable')).toContain('permission');
		});

		it('still shows the data to a read-only viewer', async () => {
			const fixture = await render(users.viewer, 'CR-1');
			expect(fixture.nativeElement.querySelectorAll('.cr-diff__row').length).toBe(2);
			expect(fixture.nativeElement.querySelectorAll('.cr-timeline__entry').length).toBe(3);
		});

		it('explains that a CR which is not awaiting approval cannot be acted on', async () => {
			const fixture = await render(users.approver, 'CR-2'); // APPLIED
			expect(textOf(fixture, '.cr-actions__unavailable')).toContain('not awaiting approval');
			expect(fixture.nativeElement.querySelector('.cr-actions__approve').disabled).toBe(true);
		});

		it('refuses the action even when approve() is called directly, bypassing the UI', async () => {
			const fixture = await render(users.viewer, 'CR-1');
			await fixture.componentInstance.approve();
			fixture.detectChanges();
			expect(fixture.componentInstance.detail?.status).toBe('PENDING_APPROVAL');
		});
	});

	describe('approve', () => {
		it('applies the returned CR to the view and appends the timeline entry', async () => {
			const fixture = await render(users.approver, 'CR-1');
			await fixture.componentInstance.approve();
			fixture.detectChanges();
			expect(fixture.componentInstance.detail?.status).toBe('APPROVED');
			expect(textOf(fixture, '.cr-status')).toContain('APPROVED');
			expect(allText(fixture, '.cr-timeline__action').pop()).toBe('APPROVE');
		});

		it('withdraws the actions once the CR is no longer pending', async () => {
			const fixture = await render(users.approver, 'CR-1');
			await fixture.componentInstance.approve();
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('.cr-actions__approve').disabled).toBe(true);
			expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
		});

		it('surfaces a failure and leaves the loaded CR untouched', async () => {
			const fixture = await render(users.approver, 'CR-1');
			TestBed.inject(CrApiService).failNext = true;
			await fixture.componentInstance.approve();
			fixture.detectChanges();
			expect(textOf(fixture, '.cr-actions__error')).toContain('Network error');
			expect(fixture.componentInstance.detail?.status).toBe('PENDING_APPROVAL');
			expect(fixture.nativeElement.querySelector('.cr-actions__approve').disabled).toBe(false); // retryable
		});

		it('shows a pending message and freezes the reason box while the call is in flight', async () => {
			const fixture = await render(users.approver, 'CR-1', { latencyMs: 40 });
			const pending = fixture.componentInstance.approve();
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('.cr-actions__pending')).not.toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-actions__reason').readOnly).toBe(true);
			await pending;
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('.cr-actions__pending')).toBeNull();
		});

		it('ignores a second click while the first call is still in flight', async () => {
			const fixture = await render(users.approver, 'CR-1', { latencyMs: 40 });
			await Promise.all([fixture.componentInstance.approve(), fixture.componentInstance.approve()]);
			fixture.detectChanges();
			expect(allText(fixture, '.cr-timeline__action').filter((a) => a === 'APPROVE').length).toBe(1);
		});
	});

	describe('reject and its reason validation', () => {
		it('keeps Reject disabled until a reason is entered', async () => {
			const fixture = await render(users.approver, 'CR-1');
			const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__reject-btn');
			expect(btn.disabled).toBe(true);
			fixture.componentInstance.rejectControl.setValue('over budget');
			fixture.detectChanges();
			expect(btn.disabled).toBe(false);
		});

		it('does not accept a reason of only whitespace', async () => {
			const fixture = await render(users.approver, 'CR-1');
			fixture.componentInstance.rejectControl.setValue('    ');
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('.cr-actions__reject-btn').disabled).toBe(true);
		});

		it('shows the validation message and calls no API when rejected with no reason', async () => {
			const fixture = await render(users.approver, 'CR-1');
			await fixture.componentInstance.reject();
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('.cr-actions__reason-error')).not.toBeNull();
			expect(fixture.componentInstance.detail?.status).toBe('PENDING_APPROVAL');
		});

		it('records the trimmed reason on the timeline and withdraws the actions', async () => {
			const fixture = await render(users.approver, 'CR-1');
			fixture.componentInstance.rejectControl.setValue('  price too high  ');
			await fixture.componentInstance.reject();
			fixture.detectChanges();
			expect(fixture.componentInstance.detail?.status).toBe('REJECTED');
			expect(textOf(fixture, '.cr-timeline__note')).toBe('price too high');
			expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
		});

		it('surfaces a failed reject and keeps the reason for a retry', async () => {
			const fixture = await render(users.approver, 'CR-1');
			fixture.componentInstance.rejectControl.setValue('over budget');
			TestBed.inject(CrApiService).failNext = true;
			await fixture.componentInstance.reject();
			fixture.detectChanges();
			expect(textOf(fixture, '.cr-actions__error')).toContain('Network error');
			expect(fixture.componentInstance.detail?.status).toBe('PENDING_APPROVAL');
			expect(fixture.componentInstance.rejectControl.value).toBe('over budget');
		});
	});
});
