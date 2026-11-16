// The typical AP invoice process (docs/effort-first-plan.md, part I), the one reference process of the
// trial. Written by Avala OS from the hand-checked sample case (eval/corpus/ap-invoice): the sample's
// flow and its steps, rules and exceptions, with every name and text rewritten to be generic (no
// company, no people, no application brands, no transaction codes, no amounts or percentages).
// It never carries volumes, times, costs or whether an application has an API: a test keeps them out.
// Checked by the owner before it ships. Applications are placeholders ("Your ERP") a person maps to
// their own. Every element it gives a process is marked "typical" until a person confirms it.
import type { ReferenceProcess } from './typical.ts';

export const AP_INVOICE: ReferenceProcess = {
  id: 'ap-invoice',
  name: 'Supplier invoice processing (accounts payable)',
  noun: 'supplier invoice process',
  "roles": [
    {
      "id": "r-clerk",
      "name": "AP clerk",
      "kind": "person_role",
      "inScope": true
    },
    {
      "id": "r-lead",
      "name": "AP team lead",
      "kind": "person_role",
      "inScope": true
    },
    {
      "id": "r-stores",
      "name": "Requester or stores",
      "kind": "person_role",
      "inScope": true
    },
    {
      "id": "r-buyer",
      "name": "Buyer",
      "kind": "person_role",
      "inScope": true
    },
    {
      "id": "r-approver",
      "name": "Budget holder (approver)",
      "kind": "person_role",
      "inScope": true
    },
    {
      "id": "r-vmd",
      "name": "Supplier master data team",
      "kind": "team",
      "inScope": false
    },
    {
      "id": "r-vendor",
      "name": "Supplier",
      "kind": "external",
      "inScope": true
    }
  ],
  "systems": [
    {
      "id": "sys-sap",
      "name": "Your ERP",
      "kind": "erp"
    },
    {
      "id": "sys-mailbox",
      "name": "Your AP mailbox",
      "kind": "email"
    },
    {
      "id": "sys-sharepoint",
      "name": "Your document store",
      "kind": "document_store"
    },
    {
      "id": "sys-tracker",
      "name": "Your AP tracker",
      "kind": "spreadsheet"
    },
    {
      "id": "sys-servicenow",
      "name": "Your service desk",
      "kind": "workflow"
    },
    {
      "id": "sys-scanner",
      "name": "Your scanner",
      "kind": "scanner"
    }
  ],
  "events": [
    {
      "id": "e-start",
      "kind": "start",
      "name": "Invoice received from the supplier"
    },
    {
      "id": "e-posted",
      "kind": "end",
      "name": "Invoice posted"
    },
    {
      "id": "e-returned",
      "kind": "end",
      "name": "Invoice returned to the supplier"
    },
    {
      "id": "e-hold-vmd",
      "kind": "end",
      "name": "On hold: supplier master"
    },
    {
      "id": "e-duplicate",
      "kind": "end",
      "name": "Not posted: duplicate"
    },
    {
      "id": "e-rejected",
      "kind": "end",
      "name": "Rejected by the approver"
    },
    {
      "id": "e-credit",
      "kind": "end",
      "name": "On hold: awaiting credit note"
    }
  ],
  "steps": [
    {
      "id": "s-scan",
      "name": "Scan paper invoice",
      "description": "Scan invoices that arrive on paper so they reach the AP mailbox as documents.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-scanner",
        "sys-mailbox"
      ],
      "taskType": "manual",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-log",
      "name": "Log invoice",
      "description": "Save the invoice document and record it in the AP tracker.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-mailbox",
        "sys-sharepoint",
        "sys-tracker"
      ],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-check",
      "name": "Check mandatory fields",
      "description": "Check the legal entity, the supplier's tax number, invoice number and date, purchase order number, amounts and tax.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [],
      "taskType": "user",
      "ruleIds": [
        "br-entity"
      ],
      "exceptionIds": [
        "x-missing-field",
        "x-wrong-entity",
        "x-unreadable"
      ]
    },
    {
      "id": "s-return",
      "name": "Return invoice to supplier",
      "description": "Tell the supplier what is missing or wrong, and mark the invoice as returned.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-mailbox",
        "sys-tracker"
      ],
      "taskType": "send",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-vendor",
      "name": "Validate supplier",
      "description": "Check that the supplier exists in the ERP, is not blocked, and that its tax number and bank details match the invoice.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-sap"
      ],
      "taskType": "user",
      "ruleIds": [
        "br-bank"
      ],
      "exceptionIds": [
        "x-bank",
        "x-gstin"
      ]
    },
    {
      "id": "s-ticket",
      "name": "Raise supplier master request",
      "description": "Ask the supplier master data team to check or correct the supplier record, and hold the invoice.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-servicenow",
        "sys-tracker"
      ],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-dup",
      "name": "Check for duplicates",
      "description": "Search the ERP and the tracker for the same supplier and invoice number.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-sap",
        "sys-tracker"
      ],
      "taskType": "user",
      "ruleIds": [
        "br-duplicate"
      ],
      "exceptionIds": [
        "x-duplicate"
      ]
    },
    {
      "id": "s-miro",
      "name": "Enter PO invoice",
      "description": "Enter the invoice in the ERP against its purchase order and goods receipt.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-sap"
      ],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-park-gr",
      "name": "Park invoice and request goods receipt",
      "description": "Park the invoice and ask the requester or stores to post the goods receipt; remind, then escalate.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-sap",
        "sys-mailbox",
        "sys-tracker"
      ],
      "taskType": "user",
      "ruleIds": [
        "br-gr-followup"
      ],
      "exceptionIds": [
        "x-no-gr"
      ]
    },
    {
      "id": "s-gr",
      "name": "Post goods receipt",
      "description": "The requester or stores posts the goods receipt, or confirms the goods were not received.",
      "roleIds": [
        "r-stores"
      ],
      "systemIds": [
        "sys-sap"
      ],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-match",
      "name": "Three-way match",
      "description": "The ERP compares the invoice, purchase order and goods receipt for price and quantity against the tolerances.",
      "roleIds": [],
      "systemIds": [
        "sys-sap"
      ],
      "taskType": "service",
      "ruleIds": [
        "br-price-tolerance",
        "br-qty"
      ],
      "exceptionIds": []
    },
    {
      "id": "s-park-var",
      "name": "Park invoice and refer variance",
      "description": "Park the invoice and send the variance to the buyer with the purchase order and invoice.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-sap",
        "sys-mailbox",
        "sys-tracker"
      ],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": [
        "x-price",
        "x-qty"
      ]
    },
    {
      "id": "s-investigate",
      "name": "Investigate variance",
      "description": "The buyer decides whether the purchase order or the invoice is wrong.",
      "roleIds": [
        "r-buyer"
      ],
      "systemIds": [],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-amend-po",
      "name": "Amend purchase order",
      "description": "The buyer corrects the purchase order when its price is wrong.",
      "roleIds": [
        "r-buyer"
      ],
      "systemIds": [
        "sys-sap"
      ],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-credit",
      "name": "Request credit note or revised invoice",
      "description": "The buyer asks the supplier for a credit note or a corrected invoice.",
      "roleIds": [
        "r-buyer"
      ],
      "systemIds": [
        "sys-mailbox"
      ],
      "taskType": "send",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-approval-request",
      "name": "Request non-PO approval",
      "description": "Send the invoice to the approver the delegation of authority requires; remind, then escalate.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-mailbox"
      ],
      "taskType": "send",
      "ruleIds": [
        "br-doa",
        "br-approval-followup"
      ],
      "exceptionIds": [
        "x-approval-delay"
      ]
    },
    {
      "id": "s-approve",
      "name": "Approve non-PO invoice",
      "description": "The approver approves or rejects the invoice.",
      "roleIds": [
        "r-approver"
      ],
      "systemIds": [
        "sys-mailbox"
      ],
      "taskType": "user",
      "ruleIds": [
        "br-doa"
      ],
      "exceptionIds": []
    },
    {
      "id": "s-fb60",
      "name": "Enter non-PO invoice",
      "description": "Keep the approval with the invoice and enter it in the ERP with the account and cost centre.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-sap",
        "sys-sharepoint"
      ],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-review",
      "name": "Review high-value invoice",
      "description": "A second person reviews invoices above the value your policy sets before they are posted.",
      "roleIds": [
        "r-lead"
      ],
      "systemIds": [],
      "taskType": "user",
      "ruleIds": [
        "br-four-eyes"
      ],
      "exceptionIds": []
    },
    {
      "id": "s-post",
      "name": "Post invoice and attach the document",
      "description": "Post the invoice in the ERP and attach the invoice document.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-sap"
      ],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": []
    },
    {
      "id": "s-close",
      "name": "Update tracker to posted",
      "description": "Record the ERP document number and mark the invoice as posted.",
      "roleIds": [
        "r-clerk"
      ],
      "systemIds": [
        "sys-tracker"
      ],
      "taskType": "user",
      "ruleIds": [],
      "exceptionIds": []
    }
  ],
  "gateways": [
    {
      "id": "g-paper",
      "type": "exclusive",
      "question": "Paper invoice?"
    },
    {
      "id": "g-complete",
      "type": "exclusive",
      "question": "Complete and correct?"
    },
    {
      "id": "g-bank",
      "type": "exclusive",
      "question": "Bank details match the supplier record?"
    },
    {
      "id": "g-dup",
      "type": "exclusive",
      "question": "Duplicate?"
    },
    {
      "id": "g-po",
      "type": "exclusive",
      "question": "PO invoice?"
    },
    {
      "id": "g-approved",
      "type": "exclusive",
      "question": "Approved?"
    },
    {
      "id": "g-gr",
      "type": "exclusive",
      "question": "Goods receipt posted?"
    },
    {
      "id": "g-tolerance",
      "type": "exclusive",
      "question": "Within tolerance?"
    },
    {
      "id": "g-po-wrong",
      "type": "exclusive",
      "question": "Purchase order price wrong?"
    },
    {
      "id": "g-amount",
      "type": "exclusive",
      "question": "Above the review threshold?"
    }
  ],
  "flows": [
    {
      "id": "f-01",
      "from": "e-start",
      "to": "g-paper"
    },
    {
      "id": "f-02",
      "from": "g-paper",
      "to": "s-log",
      "label": "No"
    },
    {
      "id": "f-03",
      "from": "g-paper",
      "to": "s-scan",
      "label": "Yes"
    },
    {
      "id": "f-04",
      "from": "s-scan",
      "to": "s-log"
    },
    {
      "id": "f-05",
      "from": "s-log",
      "to": "s-check"
    },
    {
      "id": "f-06",
      "from": "s-check",
      "to": "g-complete"
    },
    {
      "id": "f-07",
      "from": "g-complete",
      "to": "s-vendor",
      "label": "Yes"
    },
    {
      "id": "f-08",
      "from": "g-complete",
      "to": "s-return",
      "label": "No"
    },
    {
      "id": "f-09",
      "from": "s-return",
      "to": "e-returned"
    },
    {
      "id": "f-10",
      "from": "s-vendor",
      "to": "g-bank"
    },
    {
      "id": "f-11",
      "from": "g-bank",
      "to": "s-dup",
      "label": "Yes"
    },
    {
      "id": "f-12",
      "from": "g-bank",
      "to": "s-ticket",
      "label": "No"
    },
    {
      "id": "f-13",
      "from": "s-ticket",
      "to": "e-hold-vmd"
    },
    {
      "id": "f-14",
      "from": "s-dup",
      "to": "g-dup"
    },
    {
      "id": "f-15",
      "from": "g-dup",
      "to": "e-duplicate",
      "label": "Yes"
    },
    {
      "id": "f-16",
      "from": "g-dup",
      "to": "g-po",
      "label": "No"
    },
    {
      "id": "f-17",
      "from": "g-po",
      "to": "s-miro",
      "label": "Yes"
    },
    {
      "id": "f-18",
      "from": "g-po",
      "to": "s-approval-request",
      "label": "No"
    },
    {
      "id": "f-19",
      "from": "s-approval-request",
      "to": "s-approve"
    },
    {
      "id": "f-20",
      "from": "s-approve",
      "to": "g-approved"
    },
    {
      "id": "f-21",
      "from": "g-approved",
      "to": "e-rejected",
      "label": "No"
    },
    {
      "id": "f-22",
      "from": "g-approved",
      "to": "s-fb60",
      "label": "Yes"
    },
    {
      "id": "f-23",
      "from": "s-fb60",
      "to": "g-amount"
    },
    {
      "id": "f-24",
      "from": "s-miro",
      "to": "g-gr"
    },
    {
      "id": "f-25",
      "from": "g-gr",
      "to": "s-match",
      "label": "Yes"
    },
    {
      "id": "f-26",
      "from": "g-gr",
      "to": "s-park-gr",
      "label": "No"
    },
    {
      "id": "f-27",
      "from": "s-park-gr",
      "to": "s-gr"
    },
    {
      "id": "f-28",
      "from": "s-gr",
      "to": "s-match"
    },
    {
      "id": "f-29",
      "from": "s-match",
      "to": "g-tolerance"
    },
    {
      "id": "f-30",
      "from": "g-tolerance",
      "to": "g-amount",
      "label": "Yes"
    },
    {
      "id": "f-31",
      "from": "g-tolerance",
      "to": "s-park-var",
      "label": "No"
    },
    {
      "id": "f-32",
      "from": "s-park-var",
      "to": "s-investigate"
    },
    {
      "id": "f-33",
      "from": "s-investigate",
      "to": "g-po-wrong"
    },
    {
      "id": "f-34",
      "from": "g-po-wrong",
      "to": "s-amend-po",
      "label": "Yes"
    },
    {
      "id": "f-35",
      "from": "s-amend-po",
      "to": "s-match"
    },
    {
      "id": "f-36",
      "from": "g-po-wrong",
      "to": "s-credit",
      "label": "No"
    },
    {
      "id": "f-37",
      "from": "s-credit",
      "to": "e-credit"
    },
    {
      "id": "f-38",
      "from": "g-amount",
      "to": "s-post",
      "label": "No"
    },
    {
      "id": "f-39",
      "from": "g-amount",
      "to": "s-review",
      "label": "Yes"
    },
    {
      "id": "f-40",
      "from": "s-review",
      "to": "s-post"
    },
    {
      "id": "f-41",
      "from": "s-post",
      "to": "s-close"
    },
    {
      "id": "f-42",
      "from": "s-close",
      "to": "e-posted"
    }
  ],
  "rules": [
    {
      "id": "br-price-tolerance",
      "name": "Price tolerance",
      "condition": "The invoice price differs from the purchase order price by no more than the tolerance your policy sets",
      "action": "The invoice may be posted; a larger difference goes to the buyer first"
    },
    {
      "id": "br-qty",
      "name": "No over-invoicing of quantity",
      "condition": "The invoiced quantity is more than the quantity received",
      "action": "The invoice is not posted until the difference is resolved"
    },
    {
      "id": "br-duplicate",
      "name": "Duplicate definition",
      "condition": "Same supplier and invoice number (and the same amount and date) as an invoice already recorded",
      "action": "The invoice is treated as a duplicate and not posted"
    },
    {
      "id": "br-four-eyes",
      "name": "Four-eyes review",
      "condition": "The invoice amount is at or above the review threshold your policy sets",
      "action": "A second person reviews it before posting"
    },
    {
      "id": "br-bank",
      "name": "Bank detail changes",
      "condition": "The bank details on the invoice differ from the supplier record",
      "action": "The invoice is held until the supplier master data team confirms the change"
    },
    {
      "id": "br-doa",
      "name": "Delegation of authority for non-PO invoices",
      "condition": "An invoice has no purchase order",
      "action": "It is approved by the approver the delegation of authority names for its amount"
    },
    {
      "id": "br-entity",
      "name": "Correct legal entity and tax number",
      "condition": "The invoice is addressed to another legal entity or carries a wrong tax number",
      "action": "It is returned to the supplier"
    },
    {
      "id": "br-gr-followup",
      "name": "Goods receipt follow-up",
      "condition": "No goods receipt is posted for a PO invoice",
      "action": "The requester or stores is reminded, then the matter is escalated"
    },
    {
      "id": "br-approval-followup",
      "name": "Approval follow-up",
      "condition": "A non-PO approval has not come back",
      "action": "The approver is reminded, then the matter is escalated"
    }
  ],
  "exceptions": [
    {
      "id": "x-missing-field",
      "kind": "business",
      "name": "Missing or incorrect mandatory field",
      "trigger": "A mandatory field is missing or wrong",
      "handling": "Return the invoice to the supplier with the reason",
      "stepIds": [
        "s-check"
      ],
      "routedToRoleId": "r-vendor"
    },
    {
      "id": "x-wrong-entity",
      "kind": "business",
      "name": "Invoice addressed to another legal entity",
      "trigger": "The invoice names another company of the group",
      "handling": "Return the invoice to the supplier",
      "stepIds": [
        "s-check"
      ],
      "routedToRoleId": "r-vendor"
    },
    {
      "id": "x-gstin",
      "kind": "business",
      "name": "Tax number mismatch",
      "trigger": "The supplier's tax number on the invoice differs from the supplier record",
      "handling": "Return the invoice or ask the supplier master data team",
      "stepIds": [
        "s-check",
        "s-vendor"
      ],
      "routedToRoleId": "r-vendor"
    },
    {
      "id": "x-bank",
      "kind": "business",
      "name": "Bank details differ from the supplier record",
      "trigger": "The bank details on the invoice differ from the supplier record",
      "handling": "Hold the invoice and raise a supplier master request",
      "stepIds": [
        "s-vendor"
      ],
      "routedToRoleId": "r-vmd"
    },
    {
      "id": "x-duplicate",
      "kind": "business",
      "name": "Suspected duplicate",
      "trigger": "An invoice with the same supplier and number is already recorded",
      "handling": "Do not post; confirm with the supplier if unclear",
      "stepIds": [
        "s-dup"
      ],
      "routedToRoleId": "r-clerk"
    },
    {
      "id": "x-no-gr",
      "kind": "business",
      "name": "No goods receipt",
      "trigger": "The goods receipt is not posted",
      "handling": "Park the invoice and ask for the goods receipt",
      "stepIds": [
        "s-miro"
      ],
      "routedToRoleId": "r-stores"
    },
    {
      "id": "x-price",
      "kind": "business",
      "name": "Price variance beyond tolerance",
      "trigger": "The price differs from the purchase order by more than the tolerance",
      "handling": "Park the invoice and refer it to the buyer",
      "stepIds": [
        "s-match"
      ],
      "routedToRoleId": "r-buyer"
    },
    {
      "id": "x-qty",
      "kind": "business",
      "name": "Quantity exceeds goods received",
      "trigger": "More is invoiced than was received",
      "handling": "Park the invoice and ask the requester or stores about the difference",
      "stepIds": [
        "s-match"
      ],
      "routedToRoleId": "r-stores"
    },
    {
      "id": "x-approval-delay",
      "kind": "business",
      "name": "Non-PO approval not received",
      "trigger": "The approver has not replied",
      "handling": "Remind, then escalate",
      "stepIds": [
        "s-approval-request"
      ]
    },
    {
      "id": "x-unreadable",
      "kind": "business",
      "name": "Unreadable or protected invoice document",
      "trigger": "The invoice document cannot be opened or read",
      "handling": "Ask the supplier for a readable copy",
      "stepIds": [
        "s-check"
      ],
      "routedToRoleId": "r-vendor"
    },
    {
      "id": "x-po-locked",
      "kind": "application",
      "name": "Purchase order locked in the ERP",
      "trigger": "The purchase order is being changed by someone else",
      "handling": "Wait and try again, or ask the buyer",
      "stepIds": [
        "s-miro"
      ],
      "routedToRoleId": "r-clerk"
    }
  ],
};
