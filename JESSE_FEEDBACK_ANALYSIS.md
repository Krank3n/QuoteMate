# Jesse Gorman (Hobart Insulation) — Feature Request Analysis

Customer: J. Gorman Insulation. Coming off Tradify. Single-operator insulation business.
**Trade nuance**: insulation = sold by m², priced in bags, multi-layer R-value stacking, labour rated per 100 m². Quote shown as **flat rate** (materials + qty hidden).

Legend:
- **Feasibility**: 🟢 Easy (hours–1 day) · 🟡 Medium (2–5 days) · 🔴 Hard (>1 week / external dep)
- **Importance for Jesse**: ⭐⭐⭐ blocker · ⭐⭐ strong want · ⭐ nice-to-have
- **Importance for other users**: how much it generalises to all tradies

---

## 1. Bulk price uplift (+5.8%) and GST on supplier price list
- **Feasibility**: 🟢 — supplier price book already exists (`materialFavorites.ts`, `supplierListImporter.ts`). Add "bulk adjust %" + GST toggle in supplier list UI.
- **Jesse**: ⭐⭐⭐ — needed before he can quote at all.
- **Others**: ⭐⭐⭐ — every tradie deals with annual supplier price rises. Big win generally.
- **Note**: GST handling is global — need to confirm whether price book stores ex-GST or inc-GST consistently.

## 2. Auto-calc bags from m² (in increments: 5, 10, 20)
- **Feasibility**: 🟢 — coverage-per-bag is a property of the product. Add `coverage_m2` field per insulation product, then `bags = ceil(m² / coverage_per_bag)`.
- **Jesse**: ⭐⭐⭐ — core to his workflow.
- **Others**: ⭐⭐ — similar concept applies to tilers (m²/box), painters (L/m²), decking (lm/m²). Generalises well as "coverage-based materials".

## 3. Voice-to-quote
- **Feasibility**: 🟡 — `AssistantScreen.tsx` + `assistantService.ts` already exist. Extending the assistant to capture lead → measurements → line items via voice is achievable using existing LLM service. Real-world accuracy on a noisy job site is the risk.
- **Jesse**: ⭐⭐⭐ — explicitly asks again in #16, #17. Major appeal vs Tradify.
- **Others**: ⭐⭐⭐ — huge differentiator. Tradies hate typing on phones.

## 4. Branded sales pitch blocks on every quote (with editable R-value)
- **Feasibility**: 🟢 — PDF template already supports logo (`documentService.ts`). Add a "Quote intro/outro" rich-text field in Settings + per-quote override. R-value pitch = template with `{existing_R}`, `{added_R}`, `{total_R}` variables.
- **Jesse**: ⭐⭐⭐ — his sales conversion depends on this.
- **Others**: ⭐⭐⭐ — every tradie wants editable boilerplate. Generic "quote templates" feature.

## 5. Lead capture form (name/address/phone/email/total m²/total bags — bags hidden from customer)
- **Feasibility**: 🟢 — `ContactsScreen.tsx` + `contactService.ts` already store contacts. Add custom fields and an "internal only" flag.
- **Jesse**: ⭐⭐⭐
- **Others**: ⭐⭐ — custom-field support on contacts is broadly useful.

## 6. Quote shown as flat rate; hide line item prices & quantities from customer
- **Feasibility**: 🟡 — likely the **biggest architectural change**. Current quote PDF appears to itemise. Need a "presentation mode" toggle per quote: itemised (internal) vs flat-rate single line (customer). Internal copy must remain so he can order from supplier later (#18).
- **Jesse**: ⭐⭐⭐ — non-negotiable. Tradify's failure here is what pushed him to leave.
- **Others**: ⭐⭐⭐ — many tradies quote flat rate and don't want competitors / customers seeing margins. Strong differentiator vs Tradify/ServiceM8.

## 7. Per-job editable labour ($1500 ceiling / $2500 floor per 100 m²) — pre-set rates, override before send
- **Feasibility**: 🟢 — extend the existing labour-rate concept with named presets and a per-job override. Section templates (`sectionTemplateService.ts`) already do similar bundling.
- **Jesse**: ⭐⭐⭐
- **Others**: ⭐⭐⭐ — every trade has per-unit labour rates (per m², per lm, per fixture). Already partly modelled.

## 8. Preview quote before sending
- **Feasibility**: 🟢 — should already exist or be trivial; PDF generation is in place.
- **Jesse**: ⭐⭐⭐ baseline expectation.
- **Others**: ⭐⭐⭐ baseline expectation. Verify it works end-to-end.

## 9. Xero sync
- **Feasibility**: 🟡 — `xeroService.ts` already exists. Need to confirm scope: contacts, invoices, payments? OAuth refresh, mapping line items to Xero accounts/tax rates. Real work is in edge cases, not the integration.
- **Jesse**: ⭐⭐⭐ — accounting blocker.
- **Others**: ⭐⭐⭐ — table-stakes for AU tradies.

## 10. Automated quote reminders
- **Feasibility**: 🟡 — needs scheduled Firebase Function + email templates. `quoteAcceptanceService.ts` and `emailService.ts` are foundations. 2–3 days.
- **Jesse**: ⭐⭐ — wants it.
- **Others**: ⭐⭐⭐ — directly increases conversion. Strong universal value.

## 11. SMS day-before job reminders + quote SMS
- **Feasibility**: 🟡 — needs Twilio/MessageMedia integration + customer mobile number + scheduling. Recurring cost per SMS — pass-through or include in Pro?
- **Jesse**: ⭐⭐ — explicitly says "at some point".
- **Others**: ⭐⭐⭐ — reduces no-shows, big for any onsite trade.

## 12. Auto-sync to Google Calendar
- **Feasibility**: 🟡 — `googleCalendarAuth.ts` already exists. Need to wire job create/update → calendar event. Two-way sync is harder; one-way push is easy.
- **Jesse**: ⭐⭐⭐
- **Others**: ⭐⭐⭐ — universal.

## 13. Customer master view (name/address/email/phone/total m²/total bags/est. profit/total product cost) — internal fields hidden from customer
- **Feasibility**: 🟢 — essentially a richer contacts list with rollups from quotes/jobs. Builds on #5.
- **Jesse**: ⭐⭐⭐ — replaces his Google Sheet.
- **Others**: ⭐⭐ — a "CRM dashboard" is broadly useful; profit/cost rollups are valuable.

## 14. Pre-built insulation line-item library (with his exact descriptions and pricing)
- **Feasibility**: 🟢 — one-off data seed of 11 products tied to his account, plus the section-template system. He just needs descriptions + price + unit + coverage stored once. Tie into #2.
- **Jesse**: ⭐⭐⭐ — must-have on day one.
- **Others**: ⭐⭐ — implies we should ship **trade-specific starter kits** (insulation, fencing, decking, etc.). Strong onboarding moat.

## 15. Select insulation type → enter qty → auto price → add labour → present flat rate (no labour/materials split on PDF)
- **Feasibility**: 🟢 — combination of #2, #6, #7. No new mechanics.
- **Jesse**: ⭐⭐⭐
- **Others**: ⭐⭐⭐ — same flat-rate workflow benefits all.

## 16. Mobile app for sending quotes while driving (i.e. usable hands-free)
- **Feasibility**: 🔴 — the app is React Native so a mobile app already ships. The real ask is **fully hands-free voice flow**. Possible (overlaps with #3) but legally/UX-wise we should NOT encourage quoting while driving; better to frame as "voice capture now, send at next stop".
- **Jesse**: ⭐⭐ — convenience.
- **Others**: ⭐⭐ — risky framing. Voice capture: yes. "While driving": no.

## 17. Voice memo dates to Google Calendar
- **Feasibility**: 🟡 — voice → LLM extracts date/title/address → Calendar API insert. With #3 + #12 infra in place, this is small.
- **Jesse**: ⭐⭐
- **Others**: ⭐⭐ — pairs naturally with voice-to-quote.

## 18. Stock / on-hand inventory tracker (so he can subtract before ordering from supplier)
- **Feasibility**: 🟡 — new "inventory" model: product → qty on hand, decremented when a quote is accepted (or job completed). Plus a "draft purchase order" view. ~3–5 days done properly.
- **Jesse**: ⭐⭐ — important but not blocker.
- **Others**: ⭐⭐ — small operators carry stock; useful but secondary. Tradify doesn't do this well.

## 19. "Week ahead" view: upcoming jobs + total insulation required across them
- **Feasibility**: 🟢 — Jobs list already exists (`JobsListScreen.tsx`). Add a date-range view + aggregate of line-item quantities. Pairs with #18 to flag shortfall.
- **Jesse**: ⭐⭐⭐ — directly drives his supplier ordering rhythm.
- **Others**: ⭐⭐ — useful for any tradie with materials lead time. Becomes very valuable combined with #18.

## 20. All invoicing & quoting data to Xero
- **Feasibility**: 🟡 — same as #9, but extended to invoices/payments. Already partially scoped via `xeroService.ts`. Confirm chart-of-accounts mapping per user.
- **Jesse**: ⭐⭐⭐
- **Others**: ⭐⭐⭐

---

## Recommended priority order to send back to Jesse

**Phase 1 — unblock him (1–2 weeks):**
1, 2, 4, 5, 6, 7, 8, 14, 15 → he can quote at all, in his style.

**Phase 2 — replace his Google Sheet + accounting (1–2 weeks):**
9/20 (Xero), 13, 19.

**Phase 3 — automation & differentiators (2–3 weeks):**
3 (voice-to-quote), 10 (quote reminders), 12 (calendar push), 17 (voice → calendar), 18 (stock).

**Phase 4 — paid extras (later):**
11 (SMS — recurring cost), 16 (hands-free reframed safely).

## Patterns to extract into reusable platform features

- **Trade starter kits** (insulation, fencing, decking, painting…) — onboarding moat.
- **Coverage-based materials** (#2) — applies far beyond insulation.
- **Flat-rate presentation mode** (#6, #15) — Tradify's weakness; our wedge.
- **Editable quote intro/outro with variables** (#4) — generic.
- **Bulk price adjust + GST toggle** (#1) — every tradie, every year.
- **Stock on hand + week-ahead aggregation** (#18 + #19) — combined, almost no competitor does this for solo operators.

## Things to clarify with Jesse on a call
- Does he want invoices generated in QuoteMate and pushed to Xero, or just contacts + paid invoices reconciled?
- Stock tracking — does he want it decremented on quote accepted, or job completed?
- SMS — happy with a per-message cost, or expect it bundled?
- Multi-layer R-value pitch (#4) — does he want a calculator widget that produces the text, or just a fill-in-the-blanks template?
- Two sales-pitch templates — should the choice be per-customer-type, or just a dropdown when generating?
