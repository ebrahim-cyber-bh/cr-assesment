import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrListComponent } from './cr-list.component';
import { SessionService } from '../../session/session.service';
import { CrApiService } from '../../api/cr-api.service';
import { users } from '../../api/fixtures';
import { ReqUser } from '../../models/cr.models';

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** `settle: false` stops before the API resolves, so the loading state can be asserted on. */
interface RenderOptions {
	settle?: boolean;
	failNext?: boolean;
}

async function render(user: ReqUser, opts: RenderOptions = {}): Promise<ComponentFixture<CrListComponent>> {
	TestBed.configureTestingModule({
		imports: [CrListComponent],
		providers: [{ provide: SessionService, useValue: { user } }],
	});
	await TestBed.compileComponents();
	TestBed.inject(CrApiService).failNext = opts.failNext ?? false;
	const fixture = TestBed.createComponent(CrListComponent);
	fixture.detectChanges(); // ngOnInit -> load()
	if (opts.settle !== false) {
		await flush(); // let the mock API resolve
		fixture.detectChanges(); // render the loaded/empty state
	}
	return fixture;
}

const rowCount = (f: ComponentFixture<CrListComponent>) => f.nativeElement.querySelectorAll('.cr-list__row').length;

const setFilter = (f: ComponentFixture<CrListComponent>, status: string) => {
	f.componentInstance.onFilterChange(status);
	f.detectChanges();
};

describe('CrListComponent', () => {
	it('renders a row per change request in the user org', async () => {
		const fixture = await render(users.approver);
		expect(fixture.nativeElement.querySelectorAll('.cr-list__row').length).toBe(3); // org-alpha: CR-1, CR-2, CR-3
	});

	it('shows the empty state when the org has no change requests', async () => {
		const fixture = await render({ id: 'x', orgCode: 'org-empty', policies: ['cr_r_o'] });
		expect(fixture.nativeElement.querySelector('.cr-list__empty')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
	});

	describe('view states', () => {
		it('shows the loading state before the API resolves', async () => {
			const fixture = await render(users.approver, { settle: false });
			expect(fixture.nativeElement.querySelector('.cr-list__loading')).not.toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
		});

		it('shows the error state with a Retry button when the API fails', async () => {
			const fixture = await render(users.approver, { failNext: true });
			expect(fixture.nativeElement.querySelector('.cr-list__error')).not.toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-list__error').textContent).toContain('Network error');
			expect(fixture.nativeElement.querySelector('.cr-list__error button').textContent).toContain('Retry');
			expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
		});

		it('recovers when Retry succeeds after a failure', async () => {
			const fixture = await render(users.approver, { failNext: true });
			fixture.nativeElement.querySelector('.cr-list__error button').click(); // failNext already reset itself
			await flush();
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('.cr-list__error')).toBeNull();
			expect(rowCount(fixture)).toBe(3);
		});
	});

	describe('status filter', () => {
		it('narrows the table to the selected status', async () => {
			const fixture = await render(users.approver);
			setFilter(fixture, 'PENDING_APPROVAL');
			expect(rowCount(fixture)).toBe(1); // CR-1 only
			expect(fixture.nativeElement.querySelector('.cr-list__row').textContent).toContain('CR-1');
		});

		it('restores every row when the filter goes back to ALL', async () => {
			const fixture = await render(users.approver);
			setFilter(fixture, 'DRAFT');
			expect(rowCount(fixture)).toBe(1);
			setFilter(fixture, 'ALL');
			expect(rowCount(fixture)).toBe(3);
		});

		it('shows a no-match message instead of an empty table when nothing matches', async () => {
			const fixture = await render(users.approver);
			setFilter(fixture, 'CANCELLED'); // org-alpha has none
			expect(fixture.nativeElement.querySelector('.cr-list__no-matches')).not.toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-list__no-matches').textContent).toContain('CANCELLED');
			expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
		});

		it('keeps the no-match message distinct from the org-empty message', async () => {
			const fixture = await render(users.approver);
			setFilter(fixture, 'CANCELLED');
			expect(fixture.nativeElement.querySelector('.cr-list__empty')).toBeNull();
		});
	});

	describe('org scoping and selection', () => {
		it('only lists change requests belonging to the caller org', async () => {
			const fixture = await render(users.otherOrg); // bob, org-beta
			expect(rowCount(fixture)).toBe(1);
			expect(fixture.nativeElement.querySelector('.cr-list__row').textContent).toContain('CR-9');
		});

		it('emits the change request id when a row is clicked', async () => {
			const fixture = await render(users.approver);
			const emitted: string[] = [];
			fixture.componentInstance.select.subscribe((id: string) => emitted.push(id));
			fixture.nativeElement.querySelector('.cr-list__row').click();
			expect(emitted).toEqual(['CR-1']);
		});
	});
});
