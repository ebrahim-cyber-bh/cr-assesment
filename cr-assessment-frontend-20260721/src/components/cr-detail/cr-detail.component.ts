import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { CrApiService } from '../../api/cr-api.service';
import { SessionService } from '../../session/session.service';
import { CrDetail, TimelineEntry } from '../../models/cr.models';
import { idle, loading, ViewState } from '../../common/view-state';
import { computeDiff, DiffRow } from '../diff.util';
import { formatMoney } from '../../common/money.util';
import { canApprovePolicy } from '../../common/permissions';

/**
 * Change Request DETAIL page: loads a CR and renders the diff/preview, the approval timeline, and
 * permission-aware Approve/Reject actions. `load`, the diff binding, and the template skeleton are
 * provided; the timeline ordering, permission gating, actions, and reject validation are yours.
 */
@Component({
	selector: 'app-cr-detail',
	standalone: true,
	imports: [CommonModule, ReactiveFormsModule],
	templateUrl: './cr-detail.component.html',
})
export class CrDetailComponent implements OnInit {
	@Input() id!: string;

	state: ViewState<CrDetail> = idle();
	submitting = false;
	actionError?: string;
	/** `pattern(/\S/)` on top of `required` so a reason of only spaces does not count as one. */
	rejectControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] });

	constructor(private readonly api: CrApiService, private readonly session: SessionService) {}

	ngOnInit(): void {
		void this.load();
	}

	async load(): Promise<void> {
		this.state = loading();
		this.actionError = undefined;
		try {
			const detail = await this.api.getChangeRequest(this.session.user, this.id);
			this.state = { status: 'loaded', data: detail };
		} catch (err) {
			this.state = { status: 'error', data: null, error: (err as Error).message };
		}
	}

	get detail(): CrDetail | null {
		return this.state.data;
	}

	get diff(): DiffRow[] {
		return this.detail ? computeDiff(this.detail.baselineLineItems, this.detail.proposedLineItems) : [];
	}

	/** Approval timeline, oldest-first. Sorted on a copy: `sort` mutates, and `audit` belongs to the
	 *  loaded CR. ISO-8601 timestamps sort correctly as plain strings. */
	get timeline(): TimelineEntry[] {
		return [...(this.detail?.audit ?? [])].sort((a, b) => a.at.localeCompare(b.at));
	}

	/** Whether the current user may approve the loaded CR: the CR must be awaiting a decision AND
	 *  the user must hold an approve policy. */
	get canApprove(): boolean {
		return this.detail?.status === 'PENDING_APPROVAL' && canApprovePolicy(this.session.user);
	}

	/** Approve and Reject are the two outcomes of the same approval decision, so they share a gate. */
	get canReject(): boolean {
		return this.canApprove;
	}

	/** Why no action is on offer, or null when the user may act. Keeps the template free of the
	 *  status-vs-permission branching so it can be asserted on directly. */
	get actionUnavailableReason(): string | null {
		if (this.canApprove) return null;
		if (this.detail?.status !== 'PENDING_APPROVAL') return 'This change request is not awaiting approval.';
		return 'You do not have permission to act on this change request.';
	}

	fmt(amount: number): string {
		return this.detail ? formatMoney(amount, this.detail.currency) : String(amount);
	}

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
}
