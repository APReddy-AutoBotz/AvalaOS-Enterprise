// The words of the three trust pages: privacy, terms and security. Pure data, so the facts they share
// (who runs the service, the contact address, the deletion periods) are stated once and tested.
// Every statement describes what the product and its providers do today. Do not add a claim that the
// code or a provider's own documentation does not support; when the product changes, change the page.
// Inline links are written [text](href).
import type { TrustPageId } from './pages.ts';

export const OPERATOR = 'AP Reddy';
export const CONTACT_EMAIL = 'mailtoapreddy@gmail.com';
export const UPDATED = '14 November 2026';
/** Days from a confirmed deletion request (or the end of the agreement) to removal from live systems. */
export const DELETE_DAYS = 30;
/** Further days until the rolling database backups that still hold the data have expired. */
export const BACKUP_DAYS = 30;
/** Days a customer has to export its content after the agreement ends. */
export const EXPORT_DAYS = 30;
/** OpenAI's stated longest default retention of API inputs and outputs, for abuse monitoring. */
export const OPENAI_RETENTION_DAYS = 30;

const mail = `[${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`;

export type Block = string | { list: string[] };
export interface Section { id: string; title: string; body: Block[] }
export interface TrustPage { id: TrustPageId; title: string; summary: string; sections: Section[] }

const privacy: TrustPage = {
  id: 'privacy',
  title: 'Privacy notice',
  summary: 'What Avala OS collects, why, who else handles it, how long it is kept, and how to have it deleted.',
  sections: [
    {
      id: 'who', title: 'Who we are',
      body: [
        `Avala OS is run by ${OPERATOR}, an individual based in India ("we", "us"). Questions about this notice or your data go to ${mail}.`,
      ],
    },
    {
      id: 'role', title: 'Our role',
      body: [
        'Avala OS is a service for businesses. The organisation that holds a workspace (the "customer") decides what goes into it, who is invited and what it is used for.',
        'For the content of a workspace, the customer is responsible for the personal data in it (under India\'s Digital Personal Data Protection Act, 2023, the customer is the Data Fiduciary) and we process it on the customer\'s behalf. For the accounts of the people who use Avala OS, and for running and securing the service, we decide how data is used.',
      ],
    },
    {
      id: 'collect', title: 'What we collect',
      body: [
        {
          list: [
            'Account details: your email address, your display name, your password if you set one (kept by our sign-in provider as a one-way hash, never as text), the workspaces you belong to and your role in each.',
            'If you sign in with Google or Microsoft: your name, your email address and whether that provider has verified it. We never see your Google or Microsoft password, and we ask for nothing else from those accounts.',
            'Invitations: the email address and role an admin enters to invite someone.',
            'Workspace content: the text read from the files you add as sources, with each file\'s name and size; process models, assessments, requirements, documents and your edits to them; flows; work items and the Delivery board; document branding, including any logo you upload; and answers you give to open questions. Files are read in your browser, and only the text read from them is stored, not the file itself.',
            'Voice answers: when you answer by speaking, the recording is sent to be turned into text. Only the text is kept.',
            'Records of activity: who edited, approved or confirmed what and when, and changes to membership and roles.',
            'AI usage: for each request to the AI provider, the workspace, the person, the kind of task, the model, the number of tokens used and whether it succeeded. Not the content of the request.',
            'Technical data: our hosting and database providers keep standard request logs, such as IP address, browser and time.',
          ],
        },
        'We do not use analytics, advertising or tracking tools.',
      ],
    },
    {
      id: 'browser', title: 'Cookies and browser storage',
      body: [
        'Avala OS sets no cookies of its own. It keeps two things in your browser\'s local storage: your sign-in session, and the last workspace you opened. Both are needed for the service to work, and neither is used for tracking. Signing out removes the session.',
      ],
    },
    {
      id: 'use', title: 'How we use it',
      body: [
        {
          list: [
            'To provide the service: store your workspaces, build assessments, documents, flows and work items, and show them to the people the customer has invited.',
            'To read sources and draft wording with AI when you ask for it (see the next section).',
            'To keep the service secure, prevent abuse and measure and limit each workspace\'s AI use.',
            'To send the emails the service needs, such as confirming an email address when you create an account.',
          ],
        },
        'We do not sell personal data, use it for advertising, or use workspace content to train AI models.',
      ],
    },
    {
      id: 'ai', title: 'AI processing',
      body: [
        'When you ask Avala OS to read sources, read a flowchart image, turn a voice answer into text, or draft the wording of a document section, the text or image needed for that request is sent from our server to OpenAI\'s API. Requests never go from your browser to the AI provider directly.',
        `We ask OpenAI not to store the responses. OpenAI states that it does not train its models on API data by default, and that it may keep API inputs and outputs for up to ${OPENAI_RETENTION_DAYS} days to provide the service and detect abuse, or longer where the law requires.`,
        'Scores and recommendations are worked out by fixed rules, not by the AI. Anything the AI reads or drafts is shown to a person to confirm or edit.',
      ],
    },
    {
      id: 'providers', title: 'Service providers',
      body: [
        'These companies process data for us to run Avala OS:',
        {
          list: [
            'Supabase: the database, sign-in and the server functions. The database is hosted in Sydney, Australia.',
            'Resend: sending emails from avalaos.com (sign-up confirmations, password resets, invitations and the "Needs you" emails). It receives the address each email goes to and the email itself, and sends from its Tokyo, Japan region.',
            'OpenAI: the AI requests described above.',
            'Netlify: hosting of the website.',
            'Sentry: reports of errors in the website, so we can fix them. A report says what failed and on which page. It does not include what you typed or your account, and before it leaves your browser we remove email addresses and the tokens in links. It is used only to fix the product. Reports are stored in the European Union, and IP addresses are not stored.',
            'Google and Microsoft: only when you choose to sign in with them, to confirm who you are.',
          ],
        },
        'They may process data outside India, including in Australia, Japan, the European Union and the United States. We will update this list before adding a provider that handles workspace content.',
      ],
    },
    {
      id: 'retention', title: 'How long we keep it, and deletion',
      body: [
        'We keep a workspace and its content for as long as the customer uses Avala OS. Within the product, a source taken out of a process is archived rather than deleted, so the record of how each document was produced stays complete.',
        `A customer's admin can ask us to delete a workspace, and anyone can ask us to delete their account, by writing to ${mail}. We confirm the request with the workspace admin or the account holder, then delete the data from our live systems within ${DELETE_DAYS} days. Copies in database backups expire on a rolling cycle within a further ${BACKUP_DAYS} days.`,
        `When a customer stops using Avala OS, it has ${EXPORT_DAYS} days to export its documents and work items, after which we delete its workspaces in the same way. We keep something longer only where the law requires it, and then only that.`,
      ],
    },
    {
      id: 'rights', title: 'Your rights',
      body: [
        'You can ask to see the personal data we hold about you, correct it, have it deleted, or nominate someone to act for you. If your data is in a customer\'s workspace, please contact that organisation first: it decides what is in its workspace, and we will help it answer you.',
        `To make a request or a complaint, write to ${mail}. We aim to reply within 7 days. If you are not satisfied with our answer, you can complain to the Data Protection Board of India.`,
      ],
    },
    {
      id: 'security', title: 'Security',
      body: ['How we protect data is described on the [Security](/security) page.'],
    },
    {
      id: 'children', title: 'Children',
      body: ['Avala OS is for businesses and is not meant for anyone under 18.'],
    },
    {
      id: 'changes', title: 'Changes to this notice',
      body: ['When we change this notice we update the date at the top. If a change affects how workspace content is handled, we tell workspace admins by email before it takes effect.'],
    },
  ],
};

const terms: TrustPage = {
  id: 'terms',
  title: 'Terms of service',
  summary: 'The agreement between Avala OS and the organisations that use it.',
  sections: [
    {
      id: 'agreement', title: 'The agreement',
      body: [
        `These terms are an agreement between ${OPERATOR}, an individual based in India ("we", "us"), and the organisation that uses Avala OS (the "customer", "you"). The person who accepts them confirms they may do so for the customer.`,
        'Avala OS is for business use only. If the customer has signed a separate agreement with us, that agreement takes precedence where it differs from these terms.',
      ],
    },
    {
      id: 'service', title: 'The service',
      body: [
        'Avala OS reads a process from its sources, assesses each step, and produces documents, flows and work items for delivery. Access is by invitation.',
        'We improve the service over time and may change or remove features. If a change removes something your workspaces depend on, we will tell workspace admins in advance where we can.',
        'Fees, if any, are as agreed with us in writing. Where nothing has been agreed, the service is provided free of charge.',
      ],
    },
    {
      id: 'accounts', title: 'Accounts and access',
      body: [
        'You decide who is invited to your workspaces and what role each person has, and you are responsible for what they do there. Each person must keep their sign-in details to themselves.',
        `Tell us at once at ${mail} if you believe an account has been used without permission.`,
      ],
    },
    {
      id: 'content', title: 'Your content',
      body: [
        'You keep all rights in what you put into Avala OS and in the documents, flows and work items it produces from it. You allow us to host, copy and process that content only to provide the service to you, and for nothing else.',
        'You confirm that you have the right to use the content you add, including any personal data in transcripts and other sources, and that you have given any notice and obtained any consent the law requires. Please add only the personal data the work needs.',
        'Our [Privacy notice](/privacy) explains how we handle personal data. If you need a data processing agreement, ask us.',
      ],
    },
    {
      id: 'outputs', title: 'AI and the results',
      body: [
        'Avala OS uses AI to read sources and to draft wording when you ask. Scores and recommendations are worked out by fixed rules from the facts in the process model. Facts that are not known are shown as open questions rather than filled in.',
        'The results are working material for your team. Review them before relying on them. They are not legal, financial or other professional advice.',
      ],
    },
    {
      id: 'use', title: 'Acceptable use',
      body: [
        'You must not:',
        {
          list: [
            'use Avala OS for anything unlawful, or to store content you have no right to use;',
            'try to get into workspaces, accounts or data that are not yours, or to get around access controls or usage limits;',
            'upload malicious code, or disrupt or overload the service;',
            'copy, resell or offer the service to others without our written agreement.',
          ],
        },
        'Security research is welcome when it follows the rules on our [Security](/security) page.',
      ],
    },
    {
      id: 'ours', title: 'Our rights',
      body: [
        'Avala OS, its software and its name and logo belong to us. These terms do not transfer any of them to you. If you send us suggestions, we may use them without obligation to you.',
      ],
    },
    {
      id: 'availability', title: 'Availability and support',
      body: [
        `We work to keep Avala OS available and to fix problems promptly, but unless we have agreed otherwise in writing, we do not promise any particular availability. Support is by email at ${mail}.`,
      ],
    },
    {
      id: 'confidentiality', title: 'Confidentiality',
      body: [
        'Each of us will keep the other\'s confidential information confidential and use it only for the purposes of this agreement, unless the law requires disclosure.',
      ],
    },
    {
      id: 'ending', title: 'Suspension and ending the agreement',
      body: [
        'You can stop using Avala OS at any time by telling us. Unless a separate agreement says otherwise, we can end the agreement with 30 days\' notice to workspace admins.',
        'We may suspend access straight away if it is needed to stop a breach of these terms, a security risk or unlawful use, and we will tell you why.',
        `When the agreement ends, you have ${EXPORT_DAYS} days to export your content. We then delete it as described in our [Privacy notice](/privacy).`,
      ],
    },
    {
      id: 'liability', title: 'Warranties and liability',
      body: [
        'To the extent the law allows, Avala OS is provided "as is", without warranties of any kind, express or implied.',
        'To the extent the law allows, neither of us is liable to the other for indirect or consequential loss, or for lost profits, revenue or data. Our total liability under this agreement is limited to the fees you paid us in the 12 months before the claim arose.',
        'Nothing in these terms limits liability that cannot be limited by law.',
      ],
    },
    {
      id: 'law', title: 'Governing law',
      body: ['These terms are governed by the laws of India, and the courts of India have jurisdiction over any dispute arising from them.'],
    },
    {
      id: 'changes', title: 'Changes to these terms',
      body: ['We may update these terms. We tell workspace admins by email at least 30 days before a change that affects them takes effect. Continuing to use Avala OS after that means you accept the change.'],
    },
    {
      id: 'contact', title: 'Contact',
      body: [`${OPERATOR}, India. ${mail}`],
    },
  ],
};

const security: TrustPage = {
  id: 'security',
  title: 'Security',
  summary: 'How Avala OS protects your data, what it does not claim, and how to report a problem.',
  sections: [
    {
      id: 'hosting', title: 'Where data lives',
      body: [
        'Workspace data is stored in a PostgreSQL database run by Supabase in its Sydney, Australia region. Supabase states that customer data is encrypted at rest with AES-256 and in transit with TLS. The website is served by Netlify over HTTPS.',
        'Files you add as sources are read in your browser. Only the text read from them is sent to the server and stored.',
      ],
    },
    {
      id: 'access', title: 'Who can see what',
      body: [
        {
          list: [
            'Sign-up is by invitation only. The database refuses any new account whose email address has not been invited, and an invitation is used only once the account\'s email address is confirmed, whether by email or by Google or Microsoft.',
            'You can sign in with an email and password, or with Google or Microsoft. For Microsoft we ask Microsoft to say whether it has verified the email address, so an address nobody has verified cannot take up someone else\'s invitation.',
            'Every table in the database has row-level security: a person can read or change a workspace\'s data only if they are a member of it, and only as far as their role allows.',
            'Roles are Admin, Business analyst, Solution architect, Developer, Approver and Viewer. Viewers can read but not change. Only people with approval rights can approve a revision.',
            'Only admins can invite, change or remove members. The last admin of a workspace cannot be removed.',
            'Approved revisions are kept unchanged. Edits are recorded with who made them and when, and admins can see an audit trail of approvals and membership changes.',
          ],
        },
      ],
    },
    {
      id: 'ai', title: 'AI requests',
      body: [
        {
          list: [
            'AI requests are made only by our server functions. Before anything is sent to the AI provider, they check who is signed in and that the person belongs to the workspace; reading sources also needs the editor or admin role.',
            'The AI provider\'s key is held only on the server. It never reaches the browser and is not in the code repository.',
            'Every AI request is recorded against its workspace by its size, not its content.',
            'The AI is told that text and images in sources are material to read, not instructions to follow. Scores come from fixed rules, not from the AI.',
            `We ask the AI provider not to store responses. OpenAI may keep requests for up to ${OPENAI_RETENTION_DAYS} days to detect abuse (see the [Privacy notice](/privacy)).`,
          ],
        },
      ],
    },
    {
      id: 'app', title: 'In the browser and in the code',
      body: [
        {
          list: [
            'The site cannot be shown inside another site\'s frame, browsers are told not to guess content types, and pages send a limited referrer.',
            'No analytics or advertising scripts run on Avala OS, and the fonts are served from our own site.',
            'Text that people edit is cleaned before it is stored or shown, so it cannot carry scripts.',
            'Every proposed change to the code is checked automatically, including a scan for secrets.',
          ],
        },
      ],
    },
    {
      id: 'claims', title: 'What we do not claim',
      body: [
        'Avala OS is run by one person and does not hold SOC 2 or ISO 27001 certification. Supabase, which stores the data, states that it is SOC 2 Type 2 compliant. If your organisation needs a security questionnaire answered, write to us.',
      ],
    },
    {
      id: 'incidents', title: 'If something goes wrong',
      body: [
        'If we learn of a breach that affects your data, we tell the affected workspace admins without undue delay, with what we know, what we are doing and what they may need to do. We notify the authorities where the law requires it.',
      ],
    },
    {
      id: 'report', title: 'Reporting a vulnerability',
      body: [
        `Please report security problems to ${mail}, with the steps to reproduce them and the impact you expect. We aim to reply within 3 working days and will keep you informed until the problem is fixed.`,
        'When you test, use only accounts and workspaces you are entitled to use, do not access or change other people\'s data, and do not disrupt the service. If you follow these rules and report in good faith, we will not take action against you.',
        'The same contact is published in [security.txt](/.well-known/security.txt).',
      ],
    },
  ],
};

export const TRUST: Record<TrustPageId, TrustPage> = { privacy, terms, security };

/** Splits a block of text into plain runs and [text](href) links. */
export function inlineParts(text: string): ({ text: string } | { text: string; href: string })[] {
  const out: ({ text: string } | { text: string; href: string })[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1], href: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Every piece of text on a page, for checks. */
export function pageText(page: TrustPage): string {
  const blocks = page.sections.flatMap(s => [s.title, ...s.body.flatMap(b => (typeof b === 'string' ? [b] : b.list))]);
  return [page.title, page.summary, ...blocks].join('\n');
}
