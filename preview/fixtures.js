// Sample tool inputs for every card state, in the shape the card tools take.
// Everything here is invented: Example Co., its people, products, prices and ids.

const INSTANCE = 'https://example.my.salesforce.com';
const QUOTE_ID = '0Q0EXAMPLE00001AAA';
const OPP_ID = '006EXAMPLE00001AAA';
const r = (path) => ({ path, from: 'result' });

const named = (type, Name) => ({ attributes: { type }, Name });

function line(n, product, quantity, listPrice, discount, extra = {}) {
  const unit = Math.round(listPrice * (1 - discount / 100) * 100) / 100;
  return {
    attributes: { type: 'QuoteLineItem' },
    Id: `0QLEXAMPLE0000${n}AAA`,
    Product2: named('Product2', product),
    Quantity: quantity,
    ListPrice: listPrice,
    Discount: discount,
    UnitPrice: unit,
    TotalPrice: Math.round(unit * quantity * 100) / 100,
    ...extra,
  };
}

const BASE_LINES = [
  line(1, 'Pro Plan – Seat', 200, 120, 10),
  line(2, 'Storage Add-on (1 TB)', 5, 2000, 0),
  line(3, 'Analytics Add-on – Seat', 50, 60, 20),
  line(4, 'Support Plan', 1, 5000, 0, { Example_Term__c: 10, ServiceDate: '2027-01-15', Example_End_Date__c: '2027-11-14' }),
];

function quote(lines = BASE_LINES, extra = {}) {
  const list = lines.reduce((s, l) => s + l.ListPrice * l.Quantity, 0);
  const total = lines.reduce((s, l) => s + l.TotalPrice, 0);
  return {
    totalSize: 1,
    done: true,
    records: [
      {
        attributes: { type: 'Quote' },
        Id: QUOTE_ID,
        Name: 'Example Co. – Annual Renewal',
        QuoteNumber: 'Q-0001',
        Status: 'Draft',
        CurrencyIsoCode: 'USD',
        Opportunity: named('Opportunity', 'Example Co. – Annual Renewal'),
        Account: named('Account', 'Example Co.'),
        ExpirationDate: '2026-10-31',
        Example_Payment_Terms__c: 'Net 30',
        Example_Billing_Notes__c: null,
        Example_Term__c: 12,
        Example_Start_Date__c: '2026-11-15',
        Example_End_Date__c: '2027-11-14',
        Subtotal: list,
        Discount: Math.round(((list - total) / list) * 10000) / 100,
        TotalPrice: total,
        GrandTotal: total,
        QuoteLineItems: { totalSize: lines.length, done: true, records: lines },
        ...extra,
      },
    ],
  };
}

function opportunity(stage, extra = {}) {
  return {
    totalSize: 1,
    done: true,
    records: [
      {
        attributes: { type: 'Opportunity' },
        Id: OPP_ID,
        Name: 'Example Co. – Annual Renewal',
        StageName: stage,
        Amount: 39000,
        CloseDate: '2026-11-14',
        Probability: 50,
        Type: 'Existing Business',
        CurrencyIsoCode: 'USD',
        Account: named('Account', 'Example Co.'),
        Owner: named('User', 'Alex Example'),
        ForecastCategoryName: 'Pipeline',
        NextStep: 'Send the renewal quote',
        LeadSource: 'Partner',
        Description: 'Renewal for 200 Pro seats, plus storage and analytics add-ons.',
        ...extra,
      },
    ],
  };
}

const account = (n, Name, extra = {}) => ({
  attributes: { type: 'Account' },
  Id: `001EXAMPLE0000${n}AAA`,
  Name,
  Type: 'Customer',
  Industry: 'Manufacturing',
  Owner: named('User', 'Alex Example'),
  Website: 'https://www.example.com',
  BillingCountry: 'United States',
  AnnualRevenue: 50000000,
  NumberOfEmployees: 250,
  BillingCity: 'Springfield',
  Description: 'A made-up customer for previews.',
  CreatedDate: '2025-03-11T16:00:00.000+0000',
  ...extra,
});

const STAGES = ['Prospecting', 'Qualification', 'Needs Analysis', 'Proposal', 'Negotiation', 'Closed Won'];

const opportunityCard = (read) => ({
  record: read,
  instanceUrl: INSTANCE,
  highlights: [
    { label: 'Account', value: { path: 'Account.Name' } },
    { label: 'Amount', value: { path: 'Amount' }, type: 'currency' },
    { label: 'Close Date', value: { path: 'CloseDate' }, type: 'date' },
    { label: 'Owner', value: { path: 'Owner.Name' } },
    { label: 'Probability', value: { path: 'Probability' }, type: 'percent' },
  ],
  stages: { steps: STAGES, current: { path: 'StageName' } },
  fields: [
    { label: 'Type', value: { path: 'Type' } },
    { label: 'Forecast Category', value: { path: 'ForecastCategoryName' } },
    { label: 'Next Step', value: { path: 'NextStep' } },
    { label: 'Lead Source', value: { path: 'LeadSource' } },
    { label: 'Description', value: { path: 'Description' } },
  ],
});

const accountCard = (read, extra = {}) => ({
  record: read,
  instanceUrl: INSTANCE,
  highlights: [
    { label: 'Type', value: { path: 'Type' } },
    { label: 'Industry', value: { path: 'Industry' } },
    { label: 'Owner', value: { path: 'Owner.Name' } },
    { label: 'Website', value: { path: 'Website' } },
    { label: 'Billing Country', value: { path: 'BillingCountry' } },
    { label: 'Annual Revenue', value: { path: 'AnnualRevenue' }, type: 'currency' },
  ],
  fields: [
    { label: 'Employees', value: { path: 'NumberOfEmployees' }, type: 'number' },
    { label: 'Billing City', value: { path: 'BillingCity' } },
    { label: 'Description', value: { path: 'Description' } },
    { label: 'Created', value: { path: 'CreatedDate' }, type: 'datetime' },
  ],
  ...extra,
});

const QUOTE_HIGHLIGHTS = [
  { label: 'Quote Number', value: { path: 'QuoteNumber' } },
  { label: 'Status', value: { path: 'Status' } },
  { label: 'Opportunity', value: { path: 'Opportunity.Name' } },
  { label: 'Account', value: { path: 'Account.Name' } },
  { label: 'Expiration Date', value: { path: 'ExpirationDate' }, type: 'date' },
];

const QUOTE_FIELDS = [
  { label: 'Payment Terms', value: { path: 'Example_Payment_Terms__c' } },
  { label: 'Billing Notes', value: { path: 'Example_Billing_Notes__c' } },
];

const LINE_ITEM = {
  name: 'Product2.Name',
  quantity: 'Quantity',
  price: 'UnitPrice',
  listPrice: 'ListPrice',
  discount: 'Discount',
  total: 'TotalPrice',
  term: 'Example_Term__c',
  start: 'ServiceDate',
  end: 'Example_End_Date__c',
};

const LINE_DEFAULTS = { term: { path: 'Example_Term__c' }, start: { path: 'Example_Start_Date__c' }, end: { path: 'Example_End_Date__c' } };

const QUOTE_TOTALS = [
  { label: 'Subtotal', value: { path: 'Subtotal' }, type: 'currency' },
  { label: 'Total Price', value: { path: 'TotalPrice' }, type: 'currency', main: true },
];

const quoteLines = (extra = {}) => ({
  title: 'Products',
  rows: { path: 'QuoteLineItems.records' },
  item: LINE_ITEM,
  recordType: 'QuoteLineItem',
  defaults: LINE_DEFAULTS,
  ...extra,
});

const quoteCard = (read) => ({
  record: read,
  instanceUrl: INSTANCE,
  highlights: QUOTE_HIGHLIGHTS,
  fields: QUOTE_FIELDS,
  lines: quoteLines(),
  totals: QUOTE_TOTALS,
});

// A preview tool's result. The card reads it only through the paths below.
const ADD_LINE_RESULT = {
  quote: { id: QUOTE_ID, name: 'Example Co. – Annual Renewal', number: 'Q-0001' },
  line: { product: 'Analytics Add-on – Seat', productId: '01tEXAMPLE00001AAA', qty: 25, listPrice: 60, discount: 10, unitPrice: 54 },
  summary: `**Analytics Add-on – Seat** will be added to quote **Q-0001**.

| Field | Value |
|---|---|
| Quantity | 25 |
| List price | $60.00 per seat per year |
| Discount | 10% |
| Net price | $54.00 per seat per year |

The quote is repriced after the line is saved.`,
  effects: ['The quote goes back to Draft.', 'Every line on the quote is repriced.'],
  warnings: ['Analytics Add-on is already on this quote at 20% off. This adds a second line.'],
};

const NEW_LINE_VALUES = {
  name: r('line.product'),
  quantity: r('line.qty'),
  price: r('line.unitPrice'),
  listPrice: r('line.listPrice'),
  discount: r('line.discount'),
  total: 'Pending',
};
const NEW_LINE = { ...NEW_LINE_VALUES, id: r('line.productId'), recordType: 'Product2' };

const CREATE_RESULT = {
  quote: { name: 'Example Co. – Expansion', opportunity: 'Example Co. – Expansion', account: 'Example Co.', term: 12, start: '2026-12-01', end: '2027-11-30' },
  opportunityId: '006EXAMPLE00002AAA',
  lines: [
    { product: 'Pro Plan – Seat', qty: 50, listPrice: 120, discount: 10, unitPrice: 108 },
    { product: 'Storage Add-on (1 TB)', qty: 2, listPrice: 2000, discount: 0, unitPrice: 2000 },
    { product: 'Support Plan', qty: 1, listPrice: 5000, discount: 0, unitPrice: 5000 },
  ],
  summary: `A new quote will be created on **Example Co. – Expansion**.

| Product | Qty | Discount |
|---|---|---|
| Pro Plan – Seat | 50 | 10% |
| Storage Add-on (1 TB) | 2 | 0% |
| Support Plan | 1 | 0% |

- Term: 12 months starting Dec 1, 2026`,
  effects: ['It becomes the primary quote on the opportunity.'],
};

const SAVED_LINE_RESULT = {
  ok: true,
  quote: { id: QUOTE_ID, name: 'Example Co. – Annual Renewal', number: 'Q-0001', link: `${INSTANCE}/lightning/r/Quote/${QUOTE_ID}/view` },
  line: { ...ADD_LINE_RESULT.line, link: `${INSTANCE}/lightning/r/QuoteLineItem/0QLEXAMPLE00005AAA/view` },
  message: 'Added 25 Analytics Add-on seats to Q-0001.',
};

export const FIXTURES = [
  { id: 'opportunity', group: 'Record', label: 'Opportunity · Needs Analysis', kind: 'record', args: opportunityCard(opportunity('Needs Analysis')) },
  {
    id: 'opportunity-won',
    group: 'Record',
    label: 'Opportunity · Closed Won',
    kind: 'record',
    args: opportunityCard(opportunity('Closed Won', { Probability: 100, ForecastCategoryName: 'Closed' })),
  },
  {
    id: 'opportunity-lost',
    group: 'Record',
    label: 'Opportunity · Closed Lost',
    kind: 'record',
    args: opportunityCard(opportunity('Closed Lost', { Probability: 0, ForecastCategoryName: 'Omitted' })),
  },
  { id: 'opportunity-off-path', group: 'Record', label: 'Opportunity · off-path stage', kind: 'record', args: opportunityCard(opportunity('On Hold')) },
  { id: 'account', group: 'Record', label: 'Account', kind: 'record', args: accountCard({ records: [account(1, 'Example Co.')] }) },
  {
    id: 'account-search',
    group: 'Record',
    label: 'Account · 1 of 3 search results',
    kind: 'record',
    args: accountCard({
      searchRecords: [
        account(1, 'Example Co.'),
        account(2, 'Example Co. GmbH', { BillingCountry: 'Germany' }),
        account(3, 'Example Co. Japan', { BillingCountry: 'Japan' }),
      ],
    }),
  },
  { id: 'quote', group: 'Record', label: 'Quote with 4 lines', kind: 'record', args: quoteCard(quote()) },
  {
    id: 'quote-table',
    group: 'Record',
    label: 'Quote lines as a table (columns)',
    kind: 'record',
    args: {
      ...quoteCard(quote()),
      lines: {
        title: 'Quote Line Items',
        rows: { path: 'QuoteLineItems.records' },
        columns: [
          { label: 'Product', path: 'Product2.Name' },
          { label: 'Qty', path: 'Quantity', type: 'number' },
          { label: 'List price', path: 'ListPrice', type: 'currency' },
          { label: 'Discount', path: 'Discount', type: 'percent' },
          { label: 'Total', path: 'TotalPrice', type: 'currency' },
        ],
      },
    },
  },
  { id: 'record-empty', group: 'Record', label: 'No record found', kind: 'record', args: { record: { totalSize: 0, done: true, records: [] } } },

  {
    id: 'add-line-preview',
    group: 'Change preview',
    label: 'Add a line · preview',
    kind: 'quote-change',
    args: {
      ...quoteCard(quote()),
      result: ADD_LINE_RESULT,
      status: 'preview',
      action: 'Add a quote line',
      summary: r('summary'),
      lines: quoteLines({ new: [NEW_LINE], note: 'Totals are today’s. The quote is repriced after the new line is saved.' }),
      consequences: r('effects'),
      notes: r('warnings'),
      confirmHint: 'Not saved until you reply “confirm” in the chat. The preview expires after a while.',
    },
  },
  {
    id: 'edit-preview',
    group: 'Change preview',
    label: 'Edit quote fields · before → after',
    kind: 'quote-change',
    args: {
      ...quoteCard(quote()),
      status: 'preview',
      action: 'Edit quote fields',
      changes: [
        { label: 'Expiration Date', before: { path: 'ExpirationDate' }, after: '2026-12-15', type: 'date' },
        { label: 'Payment Terms', before: { path: 'Example_Payment_Terms__c' }, after: 'Net 45' },
        { label: 'Billing Notes', before: { path: 'Example_Billing_Notes__c' }, after: 'Invoice the customer’s EU entity.' },
      ],
      consequences: ['Payment terms over 30 days need finance approval before the quote is sent.'],
    },
  },
  {
    id: 'create-quote-preview',
    group: 'Change preview',
    label: 'Create a quote · preview',
    kind: 'quote-change',
    args: {
      result: CREATE_RESULT,
      recordType: 'Quote',
      status: 'preview',
      draft: true,
      action: 'Create a quote',
      title: r('quote.name'),
      summary: r('summary'),
      highlights: [
        { label: 'Opportunity', value: r('quote.opportunity') },
        { label: 'Account', value: r('quote.account') },
        { label: 'Term (months)', value: r('quote.term'), type: 'number' },
        { label: 'Start Date', value: r('quote.start'), type: 'date' },
        { label: 'End Date', value: r('quote.end'), type: 'date' },
      ],
      lines: {
        title: 'Products',
        rows: r('lines'),
        item: { name: 'product', quantity: 'qty', price: 'unitPrice', listPrice: 'listPrice', discount: 'discount' },
        defaults: { term: r('quote.term'), start: r('quote.start'), end: r('quote.end') },
      },
      consequences: r('effects'),
      url: `${INSTANCE}/lightning/r/Opportunity/006EXAMPLE00002AAA/view`,
    },
  },
  {
    id: 'summary-preview',
    group: 'Change preview',
    label: 'Preview text only',
    kind: 'quote-change',
    args: {
      result: { summary: ADD_LINE_RESULT.summary, warnings: ADD_LINE_RESULT.warnings },
      recordType: 'Quote',
      status: 'preview',
      action: 'Add a quote line',
      title: 'Example Co. – Annual Renewal',
      subtitle: 'Q-0001',
      summary: r('summary'),
      notes: r('warnings'),
    },
  },
  {
    id: 'needs-input',
    group: 'Change preview',
    label: 'Needs input',
    kind: 'quote-change',
    args: {
      result: { message: '“Pro” matches 3 products: Pro Plan – Seat, Pro Plan – Usage, Pro Plan – Support. Which one?' },
      recordType: 'Quote',
      status: 'needs-input',
      action: 'Add a quote line',
      title: 'Example Co. – Annual Renewal',
      subtitle: 'Q-0001',
      message: r('message'),
    },
  },
  {
    id: 'rejected',
    group: 'Change preview',
    label: 'Refused',
    kind: 'quote-change',
    args: {
      result: { message: 'A discount above 30% needs finance approval. Lower the discount, or ask finance to approve it.' },
      recordType: 'Quote',
      status: 'rejected',
      action: 'Add a quote line',
      title: 'Example Co. – Annual Renewal',
      subtitle: 'Q-0001',
      message: r('message'),
    },
  },

  {
    id: 'saved-line-later-read',
    group: 'Write result',
    label: 'Line added · later read',
    kind: 'write-result',
    args: {
      result: SAVED_LINE_RESULT,
      record: quote([...BASE_LINES, line(5, 'Analytics Add-on – Seat', 25, 60, 10)]),
      recordType: 'Quote',
      status: 'saved',
      title: r('quote.name'),
      subtitle: { path: 'QuoteNumber' },
      message: r('message'),
      pendingNote: 'The quote was still repricing when this was saved, so the totals below may not include the new line yet.',
      lines: quoteLines({ added: [r('line.link')], note: 'Lines and totals are from a read after the save.' }),
      totals: QUOTE_TOTALS,
      url: r('quote.link'),
    },
  },
  {
    id: 'saved-line',
    group: 'Write result',
    label: 'Line added · no later read',
    kind: 'write-result',
    args: {
      result: SAVED_LINE_RESULT,
      recordType: 'Quote',
      status: 'saved',
      title: r('quote.name'),
      subtitle: r('quote.number'),
      message: r('message'),
      pendingNote: 'The quote is repricing in the background. Read it again to see the new totals.',
      lines: { title: 'Products', new: [{ ...NEW_LINE_VALUES, url: r('line.link') }] },
      url: r('quote.link'),
    },
  },
  {
    id: 'saved-quote',
    group: 'Write result',
    label: 'Quote created',
    kind: 'write-result',
    args: {
      result: { quote: { name: 'Example Co. – Expansion', number: 'Q-0002', opportunity: 'Example Co. – Expansion', lines: 3 }, message: 'Created Q-0002 with 3 lines.' },
      recordType: 'Quote',
      status: 'saved',
      title: r('quote.name'),
      subtitle: r('quote.number'),
      message: r('message'),
      pendingNote: 'The quote is repricing in the background. Read it again to see the new totals.',
      fields: [
        { label: 'Opportunity', value: r('quote.opportunity') },
        { label: 'Lines', value: r('quote.lines'), type: 'number' },
      ],
      url: `${INSTANCE}/lightning/r/Quote/0Q0EXAMPLE00002AAA/view`,
    },
  },
  {
    id: 'saved-fields',
    group: 'Write result',
    label: 'Quote fields updated',
    kind: 'write-result',
    args: {
      result: { success: true, id: QUOTE_ID, message: 'Updated Expiration Date, Payment Terms and Billing Notes.' },
      recordType: 'Quote',
      status: 'saved',
      title: 'Example Co. – Annual Renewal',
      subtitle: 'Q-0001',
      message: r('message'),
      fields: [
        { label: 'Expiration Date', value: '2026-12-15', type: 'date' },
        { label: 'Payment Terms', value: 'Net 45' },
      ],
      instanceUrl: INSTANCE,
      url: `${INSTANCE}/lightning/r/Quote/${QUOTE_ID}/view`,
    },
  },
  {
    id: 'save-failed',
    group: 'Write result',
    label: 'Save failed',
    kind: 'write-result',
    args: {
      result: { success: false, errors: [{ message: 'The expiration date can’t be after the opportunity close date (Nov 14, 2026).' }] },
      recordType: 'Quote',
      status: 'failed',
      title: 'Example Co. – Annual Renewal',
      subtitle: 'Q-0001',
      message: { path: 'errors.0.message', from: 'result' },
      url: `${INSTANCE}/lightning/r/Quote/${QUOTE_ID}/view`,
    },
  },
];

export const TOOL_FOR_KIND = { record: 'show_record_card', 'quote-change': 'show_quote_change', 'write-result': 'show_write_result' };
