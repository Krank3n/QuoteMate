/**
 * Seed a throwaway demo account used ONLY for App Store / Play Store
 * screenshots.
 *
 *   npx tsx scripts/seedScreenshotDemo.ts [--wipe]
 *
 * Run from the functions/ directory. Needs Application Default Credentials.
 *
 * Why this exists: store screenshots must never show real customer data (the
 * live listing is public), so we stand up a self-contained account whose jobs
 * are built from the fake, already-priced payloads in marketing-video/out/*.
 * Those payloads came out of the real pricing pipeline, so the numbers and
 * material lines are genuine — only the people are invented.
 *
 * Idempotent: re-running wipes the demo account's jobs/documents/quotes/
 * contacts and rewrites them, so the relative dates stay fresh.
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

import { quoteRecordToDocumentRecord } from '../src/shared/document/adapter';

const DEMO_EMAIL = 'demo.screenshots@quotemateapp.au';
const PAYLOAD_DIR = path.resolve(__dirname, '../../marketing-video/out');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = Date.now();

const BUSINESS = {
  businessName: 'Riverbend Carpentry',
  abn: '54 118 207 441',
  email: 'jobs@riverbendcarpentry.com.au',
  phone: '0412 663 189',
  address: 'Preston VIC 3072',
  defaultLaborRate: 90,
  defaultMarkup: 30,
  defaultLaborMarkup: 0,
  tradeCategories: ['carpentry'],
  tradeNiches: ['outdoor'],
  pdfTemplate: 'bold',
  brandColor: '#0a0f1a',
  gstRegistered: true,
};

type Role =
  | 'paid'
  | 'part_paid'
  | 'scheduled'
  | 'in_progress'
  | 'quote_sent'
  | 'draft'
  | 'accepted'
  | 'awaiting_payment';

interface Seed {
  slug: string;          // marketing-video/out/<slug>.quote.json
  role: Role;
  customer: string;
  email: string;
  phone: string;
  address: string;
  name: string;          // job name shown in the list
  createdDaysAgo: number;
  /** For 'scheduled' seeds: days from today the job starts. Default 4. */
  startsInDays?: number;
}

// One coherent business: decks, pergolas, fences, paving. Two customers have
// two jobs each so the customer screen has something to show.
const SEEDS: Seed[] = [
  {
    slug: 'deck_construction',
    role: 'paid',
    customer: 'Marco Bianchi',
    email: 'marco.bianchi@example.com',
    phone: '0412 884 220',
    address: '14 Bellevue Rd, Coburg VIC 3058',
    name: 'Merbau deck + balustrade',
    createdDaysAgo: 46,
  },
  {
    slug: 'deck-quote-template',
    role: 'part_paid',
    customer: 'Sam Whitlock',
    email: 'sam.whitlock@example.com',
    phone: '0413 552 907',
    address: '8 Ashgrove St, Thornbury VIC 3071',
    name: 'Rear deck + steps',
    createdDaysAgo: 23,
  },
  {
    // Deliberately 'scheduled' and not 'in_progress': a Job left at
    // stage=in_progress gets healed by the client on load — it mints a fresh
    // Job for the document and leaves the seeded one empty, so the list showed
    // 9 jobs with a total-less duplicate. Every other stage round-trips fine.
    slug: 'fence_install_timber',
    role: 'scheduled',
    customer: 'Sam Whitlock',
    email: 'sam.whitlock@example.com',
    phone: '0413 552 907',
    address: '8 Ashgrove St, Thornbury VIC 3071',
    name: 'Timber paling fence - side boundary',
    createdDaysAgo: 9,
    startsInDays: 0,
  },
  {
    slug: 'pergola_build',
    role: 'scheduled',
    customer: 'Hayley Dorn',
    email: 'hayley.dorn@example.com',
    phone: '0421 330 116',
    address: '31 Miller St, Brunswick VIC 3056',
    name: 'Pergola over back patio',
    createdDaysAgo: 12,
  },
  {
    slug: 'retaining-wall-quote-template',
    role: 'quote_sent',
    customer: 'Mia Donnelly',
    email: 'mia.donnelly@example.com',
    phone: '0438 771 204',
    address: '5 Kendall Ct, Reservoir VIC 3073',
    name: 'Sleeper retaining wall',
    createdDaysAgo: 4,
  },
  {
    slug: 'paving_install',
    role: 'accepted',
    customer: 'Tom Reilly',
    email: 'tom.reilly@example.com',
    phone: '0417 208 663',
    address: '92 Gordon Gr, Northcote VIC 3070',
    name: 'Bluestone paving - courtyard',
    createdDaysAgo: 7,
  },
  {
    slug: 'turf_laying',
    role: 'draft',
    customer: 'Tom Reilly',
    email: 'tom.reilly@example.com',
    phone: '0417 208 663',
    address: '92 Gordon Gr, Northcote VIC 3070',
    name: 'Turf supply & lay - front yard',
    createdDaysAgo: 1,
  },
  {
    slug: 'fencers',
    role: 'awaiting_payment',
    customer: 'Dakota Reyes',
    email: 'dakota.reyes@example.com',
    phone: '0425 619 338',
    address: '17 Larkin Ave, Fairfield VIC 3078',
    name: 'Colorbond fence replacement',
    createdDaysAgo: 31,
  },
];

function loadQuote(slug: string): any {
  const file = path.join(PAYLOAD_DIR, `${slug}.quote.json`);
  if (!fs.existsSync(file)) throw new Error(`missing payload: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Legacy quote `status` that makes deriveStage land on the stage we want. */
function legacyStatus(role: Role): string {
  switch (role) {
    case 'draft': return 'draft';
    case 'quote_sent': return 'sent';
    case 'accepted':
    case 'scheduled':
    case 'in_progress': return 'accepted';
    case 'awaiting_payment':
    case 'part_paid':
    case 'paid': return 'completed';
  }
}

function jobStage(role: Role): string {
  switch (role) {
    case 'draft': return 'inquiry';
    case 'quote_sent': return 'quoted';
    case 'accepted': return 'accepted';
    case 'scheduled': return 'scheduled';
    case 'in_progress': return 'in_progress';
    case 'awaiting_payment': return 'completed';
    case 'part_paid': return 'completed';
    case 'paid': return 'paid';
  }
}

async function resolveDemoUid(): Promise<string> {
  try {
    const existing = await admin.auth().getUserByEmail(DEMO_EMAIL);
    console.log(`reusing demo auth user ${existing.uid}`);
    return existing.uid;
  } catch (e: any) {
    if (e?.code !== 'auth/user-not-found') throw e;
    const password = process.env.DEMO_PASSWORD;
    if (!password) {
      throw new Error('DEMO_PASSWORD env var required to create the demo user');
    }
    const created = await admin.auth().createUser({
      email: DEMO_EMAIL,
      password,
      displayName: BUSINESS.businessName,
      emailVerified: true,
    });
    console.log(`created demo auth user ${created.uid}`);
    return created.uid;
  }
}

async function wipe(db: admin.firestore.Firestore, uid: string) {
  for (const col of ['jobs', 'documents', 'quotes', 'invoices', 'contacts', 'assistantConversations']) {
    const snap = await db.collection('users').doc(uid).collection(col).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log(`  wiped ${snap.size} from ${col}`);
  }
}

async function report(db: admin.firestore.Firestore, uid: string) {
  const jobs = await db.collection('users').doc(uid).collection('jobs').get();
  const docs = await db.collection('users').doc(uid).collection('documents').get();
  console.log(`\n${jobs.size} jobs, ${docs.size} documents`);
  jobs.forEach((d) => {
    const j = d.data() as any;
    console.log(
      `  job ${d.id.padEnd(40)} stage=${String(j.stage).padEnd(12)} ` +
      `docs=[${(j.documentIds ?? []).join(',')}] quoted=${j.totalQuoted} name="${j.name}"`,
    );
  });
  docs.forEach((d) => {
    const doc = d.data() as any;
    console.log(`  doc ${d.id.padEnd(40)} jobId=${doc.jobId} stage=${doc.stage} total=${doc.total}`);
  });
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'hansendev' });
  }
  const db = admin.firestore();
  // The adapter leaves optional fields undefined (contactId, photos, ...);
  // dropping them is exactly what the client SDK does on write.
  db.settings({ ignoreUndefinedProperties: true });
  const uid = await resolveDemoUid();

  if (process.env.REPORT_ONLY === '1') {
    await report(db, uid);
    return;
  }

  console.log('wiping existing demo data...');
  await wipe(db, uid);

  // --- profile / settings -------------------------------------------------
  await db.collection('users').doc(uid).collection('settings').doc('business').set({
    ...BUSINESS,
    updatedAt: admin.firestore.Timestamp.fromMillis(now),
  });
  // `isOnboarded` is the field App.tsx gates the main app on — see
  // firestoreService.saveOnboardingStatus / listenToOnboardingStatus.
  await db.collection('users').doc(uid).collection('profile').doc('onboarding').set({
    isOnboarded: true,
    syncedAt: new Date(now - 60 * DAY).toISOString(),
    businessName: BUSINESS.businessName,
    tradeCategories: BUSINESS.tradeCategories,
  }, { merge: true });
  await db.collection('users').doc(uid).collection('profile').doc('subscription').set({
    isPro: true,
    plan: 'pro',
    quotesThisMonth: 0,
    freeQuotesLimit: 5,
    currentPeriodStart: now - 10 * DAY,
    currentPeriodEnd: now + 20 * DAY,
    updatedAt: now,
  }, { merge: true });
  console.log('wrote business settings / profile');

  // --- contacts -----------------------------------------------------------
  const contacts = new Map<string, Seed>();
  SEEDS.forEach((s) => { if (!contacts.has(s.customer)) contacts.set(s.customer, s); });
  for (const [name, s] of contacts) {
    const id = `demo-contact-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    await db.collection('users').doc(uid).collection('contacts').doc(id).set({
      id,
      name,
      email: s.email,
      phone: s.phone,
      address: s.address,
      source: 'manual',
      createdAt: new Date(now - 60 * DAY).toISOString(),
      updatedAt: new Date(now).toISOString(),
    });
  }
  console.log(`wrote ${contacts.size} contacts`);

  // --- jobs + documents ---------------------------------------------------
  let invoiceSeq = 1041;
  let quoteSeq = 1187;

  for (const seed of SEEDS) {
    const raw = loadQuote(seed.slug);
    const docId = `demo-${seed.slug}`;
    const jobId = `demo-job-${seed.slug}`;
    const createdAt = now - seed.createdDaysAgo * DAY;
    const total = Number(raw.total ?? 0);
    const isInvoice = seed.role === 'paid' || seed.role === 'part_paid' || seed.role === 'awaiting_payment';

    const quote: any = {
      ...raw,
      id: docId,
      quoteNumber: isInvoice ? `IN-${invoiceSeq++}` : `QU-${quoteSeq++}`,
      customerName: seed.customer,
      customerEmail: seed.email,
      customerPhone: seed.phone,
      jobAddress: seed.address,
      status: legacyStatus(seed.role),
      createdAt: new Date(createdAt),
      updatedAt: new Date(now - 2 * HOUR),
      job: { ...(raw.job ?? {}), name: seed.name },
    };

    const document: any = quoteRecordToDocumentRecord(quote, docId);
    document.jobId = jobId;
    document.createdAt = createdAt;
    document.number = quote.quoteNumber;

    // Stage-specific overlay: send/accept stamps + the payment ledger.
    const sentAt = createdAt + 3 * HOUR;
    const acceptedAt = createdAt + 2 * DAY;

    if (seed.role !== 'draft') {
      document.sentAt = sentAt;
      document.sendMethod = 'email';
    }
    if (['accepted', 'scheduled', 'in_progress', 'awaiting_payment', 'part_paid', 'paid'].includes(seed.role)) {
      document.acceptedAt = acceptedAt;
    }

    if (isInvoice) {
      document.type = 'invoice';
      document.invoicedAt = createdAt + 5 * DAY;
    }

    if (seed.role === 'paid') {
      document.stage = 'paid';
      document.payments = [
        { id: `${docId}-p1`, kind: 'deposit', amount: Math.round(total * 0.3 * 100) / 100, paidAt: acceptedAt + DAY, method: 'bank' },
        { id: `${docId}-p2`, kind: 'balance', amount: Math.round(total * 0.7 * 100) / 100, paidAt: now - 5 * DAY, method: 'square' },
      ];
      document.paidTotal = total;
      document.balanceDue = 0;
    } else if (seed.role === 'part_paid') {
      const deposit = Math.round(total * 0.35 * 100) / 100;
      document.stage = 'partially_paid';
      document.payments = [
        { id: `${docId}-p1`, kind: 'deposit', amount: deposit, paidAt: acceptedAt + 6 * HOUR, method: 'square' },
      ];
      document.paidTotal = deposit;
      document.balanceDue = Math.round((total - deposit) * 100) / 100;
    } else if (seed.role === 'awaiting_payment') {
      document.stage = 'invoice_sent';
      document.payments = [];
      document.paidTotal = 0;
      document.balanceDue = total;
    }

    // Last activity drives the "Accepted about 2 hours ago" line on each card,
    // so give every job its own plausible recency instead of a shared stamp.
    const lastActivity = (() => {
      switch (seed.role) {
        case 'draft': return createdAt;
        case 'quote_sent': return sentAt;
        case 'accepted': return acceptedAt;
        case 'scheduled': return acceptedAt + DAY;
        case 'in_progress': return now - 6 * HOUR;
        case 'part_paid': return acceptedAt + 6 * HOUR;
        case 'awaiting_payment': return now - 8 * DAY;
        case 'paid': return now - 5 * DAY;
      }
    })();
    document.updatedAt = lastActivity;

    const job: any = {
      id: jobId,
      userId: uid,
      customerId: `demo-contact-${seed.customer.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      customerName: seed.customer,
      customerEmail: seed.email,
      customerPhone: seed.phone,
      jobAddress: seed.address,
      name: seed.name,
      description: raw.job?.description ?? '',
      stage: jobStage(seed.role),
      documentIds: [docId],
      primaryDocumentId: docId,
      totalQuoted: total,
      totalInvoiced: isInvoice ? total : 0,
      totalPaid: document.paidTotal ?? 0,
      balanceDue: document.balanceDue ?? total,
      createdAt,
      updatedAt: lastActivity,
    };

    if (seed.role !== 'draft') job.quotedAt = sentAt;
    if (document.acceptedAt) job.acceptedAt = document.acceptedAt;

    if (seed.role === 'scheduled') {
      // Near-future start so the list shows a live "upcoming" chip.
      const start = now + (seed.startsInDays ?? 4) * DAY;
      job.scheduledAt = acceptedAt + DAY;
      job.scheduledStartDate = start;
      job.scheduledEndDate = start + 2 * DAY;
      job.estimatedDurationDays = 3;
    }
    if (seed.role === 'in_progress') {
      job.scheduledAt = acceptedAt + 12 * HOUR;
      job.scheduledStartDate = now - 2 * DAY;
      job.scheduledEndDate = now + DAY;
      job.inProgressAt = now - 6 * HOUR;
      job.actualStartDate = now - 6 * HOUR;
    }
    if (seed.role === 'awaiting_payment' || seed.role === 'part_paid') {
      job.completedAt = now - 8 * DAY;
      job.completedDate = now - 8 * DAY;
    }
    if (seed.role === 'paid') {
      job.completedAt = now - 12 * DAY;
      job.completedDate = now - 12 * DAY;
      job.paidAt = now - 5 * DAY;
    }

    // ORDER MATTERS. The document trigger mints a brand-new Job for any
    // document whose jobId doesn't resolve, then repoints the document at it —
    // which left the seeded Job document-less (no total) beside a duplicate.
    // Writing the Job first means the trigger finds it and links instead.
    //
    // NB: also deliberately NOT writing the legacy users/{uid}/quotes mirror —
    // the backend mirrors documents -> quotes itself, and seeding that mirror
    // by hand produced a second Job per seed (the list showed 16 for 8 seeds).
    await db.collection('users').doc(uid).collection('jobs').doc(jobId).set(job);
    await db.collection('users').doc(uid).collection('documents').doc(docId).set(document);
    console.log(`  ${seed.role.padEnd(16)} ${seed.name.slice(0, 34).padEnd(34)} $${total.toLocaleString('en-AU')}`);
  }

  console.log(`\nseeded ${SEEDS.length} jobs for ${DEMO_EMAIL} (uid ${uid})`);

  // Settle, then report what the backend triggers actually left behind — they
  // rewrite job/document links after our writes land.
  await new Promise((r) => setTimeout(r, 20000));
  await report(db, uid);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
