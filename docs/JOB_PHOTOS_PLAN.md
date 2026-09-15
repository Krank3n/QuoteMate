# Job photos: raise the cap, make photos findable, before/after

**Prepared 15 September 2026.** Plan only; no code, deploys or customer messages in this document.

## Why now

A tradie on Android (signed up 12 Sep, one accepted quote, one scheduled job, has never used Mate) sent two pieces of feedback on 15 Sep:

1. In-app feedback form: they want to link photos to a job so they can refer back to them while building the quote, and "a 5 photo limit isn't enough". Their one quote carries exactly 5 photos, so they hit the wall on day one.
2. Email reply: make it easier to **view and add** job photos ("very difficult to go back and find the photos"), and add **before and after** photos. Their stated goal is "a way to keep track of jobs".

Tom replied that the limit will go up to about 30 and that he'll look at viewing plus before/after, and promised to reach out when it's done.

Production check (read-only, 15 Sep): of 715 quote documents, 93 carry photos and 15 sit at exactly 5. Since 1 Aug: 53 quotes with photos, 10 at the cap. About one in five tradies who use photos hits the ceiling, so this is a general fix, not a one-user favour.

## What the app does today

**Cap.** `MAX_PHOTOS = 5` in `src/components/JobPhotos.tsx` (one constant; three alert sites and the multi-shot camera modal's remaining-slot count all derive from it). Mate's chat allows 2 photos per message and those ride onto the draft, so Mate can exceed 5 across turns while the wizard cannot.

**Storage.** Site photos are resized to 1200 px JPEG at quality 0.7 (roughly 150 to 300 KB each); plans go to 2400 px. Uploads run one at a time on purpose (parallel `uploadBytes` hit XHR/blob races). Storage rules have no per-user count cap.

**Where photos live.** On the quote/document (`photos: QuotePhoto[]`). `Job.photos` exists in `shared/job/types.ts` and `jobWritePayload` passes it through, but nothing in the app writes it today (backfill only). `JobPhotoStrip` on the job screen aggregates every attached document's photos plus `job.photos`.

**Viewing.** `JobPhotoStrip` is read-only: 80 px thumbs in a horizontal scroll with a lightbox (prev/next, close). It only renders when photos exist, and it sits **below** the header and scope block on `ViewJobScreen`. Its own header comment says a "+" tile is the natural next step. The jobs list shows no photo count.

**Adding after the quote exists.** The only add surface is the wizard's Job Details step. From the job screen that means: tap the job edit control, land in the wizard, scroll to the photo grid. That is the "hard to go back and find" experience the tradie described.

**Customer-facing use of photos.** On send, every http photo that is not a PDF plan is (a) embedded in the customer email as a single-row table of 160 px cells, (b) attached to the email as a file until a 7 MB budget stops it, and (c) shown under "Site Photos" on the acceptance page. The PDF does not embed photos. The analyse call sends every photo to the model with only a per-file byte cap.

**Help Centre** already says photos can be attached to a job and annotated (`knowledge-base/04-job-management/jobs-and-the-pipeline.md`, "On-site photos").

## Design stance

- Photos for the tradie's own record (before, during, after) are not the same thing as photos the customer should see on a quote. Raising the cap without separating the two turns a quote email into a 30-attachment message.
- Reuse the existing primitives: `JobPhotos` upload path, `JobPhotoStrip` lightbox, `PhotoAnnotator`, `Job.photos`. No new screens, no new toggles beyond a single before/after label.
- Ship the cap first (small, OTA-able), then the job-screen surface, then before/after.

## Phase 1: raise the cap safely (target: this week, OTA)

1. `MAX_PHOTOS` 5 to 30 in `JobPhotos.tsx`. The alerts interpolate the constant, so the copy follows. Check the multi-shot camera modal's counter ("3 / 30 photos") still reads well.
2. Customer email: turn the single `<tr>` of 160 px cells into a wrapping grid (3 per row) and cap the inline section at the first 6 photos. Cap file attachments at 10, plans first, so the 7 MB budget is not what silently decides which photos arrive. Acceptance page grid can show everything; it is a web page.
3. Analyse: cap the images sent to the model. Suggested rule: every plan/PDF plus the first 10 site photos. Log when photos are dropped so a 30-photo quote that prices oddly can be traced.
4. Upload feedback: with 30 photos a phone spends a minute or two uploading one at a time with Add disabled. Show "uploading 4 of 12" on the grid header so the tradie knows to wait rather than tap again.
5. Tests: the limit and trim path in `JobPhotos` (real, named cases); the email photo grid and attachment cap in `documentEmail.test.ts`; the analyse photo cap.
6. Delivery: functions deploy first (email + analyse caps), then OTA 1.57/1.56/1.55 and the web bundle. Then reply to the tradie as promised.

## Phase 2: photos live on the job (target: next week)

1. `ViewJobScreen`: move `JobPhotoStrip` up to sit directly under the header chip strip, render it even when empty (an "Add photos" tile), and add a "+" tile at the end. Adding from here writes to `job.photos`, not to a sent document. A customer has already seen the sent quote; it should not change under them.
2. Extract the upload/permission logic out of `JobPhotos` into a shared hook (camera and library permission prompts, plan detection, sequential upload, error alerts) so the strip and the wizard share one path instead of two copies.
3. Lightbox gains annotate (reuse `PhotoAnnotator`) and remove, so the job screen is the one place to manage photos after quoting. Removal from a sent document's photos stays blocked; removal from `job.photos` is allowed.
4. Keep the wizard's grid for quoting-time photos. The job screen becomes the place you "go back to".
5. Optional, only if cheap: a small photo count on the job card in the jobs list.
6. Tests: aggregation order (job photos first, then documents, de-duplicated by id/url), the `job.photos` write, the empty-state tile.

## Phase 3: before and after (target: after phase 2 lands)

1. Data: add optional `stage?: 'before' | 'after'` and `takenAt?: number` to the photo shape. The shape is copied structurally in three places (`src/types` QuotePhoto, `shared/job/types` JobPhoto, the Document type), so all three change together.
2. Default, no new prompt: photos added while the job is in a quoting stage are "before"; photos added while scheduled, in progress or completed are "after". A one-tap label on the tile flips it if the default is wrong. That keeps the UI at zero new toggles for the common case.
3. Strip and lightbox group under "Before" and "After" headings when both exist; otherwise no headings.
4. Customer-facing: nothing changes at quote time (after photos do not exist yet). Putting after photos into a completion email or the service report is a separate decision; the service report already carries its own photos.
5. Help Centre: update the "On-site photos" section with the new cap, the job-screen add path and before/after.
6. Tests: default stage by job stage, flip, grouping.

## Decisions for Tom

1. Inline email cap of 6 and attachment cap of 10, or keep sending everything?
2. Analyse photo cap of 10 site photos plus all plans, or higher?
3. Job-screen adds write to `job.photos` (recommended) rather than the primary document. Agree?
4. Before/after by job stage with a tap-to-flip, or an explicit picker every time?

## Not in scope

- A separate photo gallery screen or album feature.
- Sending after photos to customers automatically.
- Changing Mate's 2-per-message chat limit.
