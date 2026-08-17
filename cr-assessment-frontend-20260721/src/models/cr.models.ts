/** Domain models as seen by the frontend (mirror the API response shapes). */

// the chnage request status
export type CrStatus = 'DRAFT' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'APPLIED' | 'REJECTED' | 'CANCELLED';

// interface is a way to descibe shap of an object (what it has in it)

//here we are descibing the loged in person 
export interface ReqUser {
	id: string;
	orgCode: string;

	// here read/ approve/ apply and user/ workpalce/prganization
	policies: string[]; // e.g. ['cr_r_o', 'cr_a_o'] — see README for the convention
}


// items details
export interface LineItem {
	sku: string;
	description: string;
	quantity: number;
	unitPrice: number;
}

// a change request (like a raw in a table)
export interface CrSummary {
	id: string;
	title: string;
	status: CrStatus;
	orgCode: string;
	delta: number;
	currency: string;
	updatedAt: string; // ISO
}


export interface TimelineEntry {
	action: string;
	byUserId: string;
	at: string; // ISO
	note?: string;
}


// here should be the full version of the cr.
export interface CrDetail extends CrSummary {
	agreementId: string;
	baselineLineItems: LineItem[];
	proposedLineItems: LineItem[];
	baselineTotal: number;
	newTotal: number;
	audit: TimelineEntry[];
}
