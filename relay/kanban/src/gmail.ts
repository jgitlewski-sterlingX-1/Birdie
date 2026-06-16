// src/gmail.ts — prototype Gmail helpers (client-side reference; production is server-side)

export interface GmailThread {
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  messages: { from: string; date: string; body: string }[];
}

/**
 * In production, OAuth + token storage + fetch happen server-side.
 * This prototype simulates the data shape returned by a real Gmail fetch.
 */
export function mockGmailThreads(): GmailThread[] {
  return [
    {
      threadId: 'thread-001',
      subject: 'Re: Matter #4821 — Settlement Agreement Review',
      from: 'client@example.com',
      date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      snippet: 'Could you review the attached draft and confirm the terms by Friday?',
      messages: [
        {
          from: 'partner@sterlingx.com',
          date: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
          body: 'Please review the attached settlement agreement draft.',
        },
        {
          from: 'client@example.com',
          date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          body: 'Could you review the attached draft and confirm the terms by Friday? We need this finalized before the mediation.',
        },
      ],
    },
    {
      threadId: 'thread-002',
      subject: 'Deposition scheduling — Johnson v. Acme',
      from: 'opposing@lawfirm.com',
      date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      snippet: 'Please confirm availability for deposition next Tuesday.',
      messages: [
        {
          from: 'opposing@lawfirm.com',
          date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          body: 'Please confirm your client\'s availability for deposition on Tuesday at 10am. We need confirmation by end of day tomorrow.',
        },
      ],
    },
  ];
}

/**
 * Build a MIME draft body. In production this runs server-side via the Gmail API.
 * Prototype simulates the draft creation and returns a fake draft id.
 */
export function simulateCreateDraft(params: {
  to: string;
  subject: string;
  body: string;
  threadId: string;
}): { draftId: string } {
  console.log('[Gmail prototype] Would create draft:', params);
  return { draftId: `draft-${Date.now()}` };
}
