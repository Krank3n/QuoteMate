/**
 * Tour step definitions
 *
 * Dashboard tour: quick intro → straight into quoting flow
 * Screen tours: contextual tips as users hit each screen
 *
 * Use **bold** for key emphasis — rendered by BoldText in TourTooltip
 */

export interface TourStep {
  id: string;
  title: string;
  description: string;
  tooltipPosition: 'top' | 'bottom';
}

/**
 * Dashboard spotlight tour (auto-triggers for new users)
 * Short intro → referral nudge → straight into the quoting flow
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'referralButton',
    title: "Oi, before we start!",
    description: "Got a tradie mate who's still quoting on napkins? **Refer 'em** and you both score rewards. Sharing is caring, ay",
    tooltipPosition: 'bottom',
  },
  {
    id: 'newQuoteButton',
    title: "Right, let's get quoting",
    description: "We'll walk you through the whole shebang — **describe the job, add materials, set your rate**, and send it off like a boss",
    tooltipPosition: 'bottom',
  },
];

/**
 * Total steps across the intro flow (dashboard + jobDetails)
 * Used for sequential "X of Y" numbering across both tours.
 */
export const INTRO_TOUR_TOTAL_STEPS = TOUR_STEPS.length + 4; // + jobDetails steps

/**
 * Screen-specific contextual tours
 * Only shown once per screen, only for non-obvious features
 */
export type ScreenTourId =
  | 'jobDetails'
  | 'customerDetails'
  | 'materialsList'
  | 'materialsListItems'
  | 'addMaterial'
  | 'laborMarkup'
  | 'quotePreview';

export const SCREEN_TOURS: Record<ScreenTourId, TourStep[]> = {
  // ─── Job Details ───
  jobDetails: [
    {
      id: 'micButton',
      title: "Describe the job, your way",
      description: "**Hit the mic** and yarn about the job like you're telling your apprentice, or bash it out on the keyboard. Measurements, scope, the works — **more detail = less stuffing around later**",
      tooltipPosition: 'top',
    },
    {
      id: 'jobDescription',
      title: "Bit rough around the edges, ay?",
      description: "That's what a voice note or quick brain dump looks like — **totally fine**. The AI's about to turn this drivel into something a customer would actually read. Hang tight...",
      tooltipPosition: 'top',
    },
    {
      id: 'jobDescriptionCleaned',
      title: "From bogan to boardroom",
      description: "The AI's cleaning up that mess right now — watch the description change. It'll spit out a **proper job description and a title** so you sound like a tradie who's got their act together",
      tooltipPosition: 'top',
    },
    {
      id: 'jobPhotos',
      title: "Show 'em what needs doing",
      description: "Snap photos of the job site — **they'll show up on your quote** so the customer knows exactly what's getting fixed. You can also flick them to the AI if you want help sussing out materials",
      tooltipPosition: 'top',
    },
  ],

  // ─── Customer Details ───
  customerDetails: [
    {
      id: 'customerName',
      title: "Who's getting the quote?",
      description: "Start typing and **we'll pull up past customers** — pick one and their email, phone, and address auto-fill. No more asking Karen twice",
      tooltipPosition: 'bottom',
    },
    {
      id: 'jobAddress',
      title: "Where's the job at?",
      description: "Pop in the address and we'll **auto-calculate travel distance and fuel** for the Labor & Markup screen. Handy for jobs out in the sticks",
      tooltipPosition: 'top',
    },
  ],

  // ─── Materials List ───
  materialsList: [
    {
      id: 'aiGenerateCard',
      title: "Let the AI do the shopping",
      description: "Based on your job description, the AI will **whip up a full materials list** — quantities, pricing, the works. You can tweak it after",
      tooltipPosition: 'bottom',
    },
    {
      id: 'addManualCard',
      title: "Old school? No wuckas",
      description: "**Search the catalogue** for real prices from Bunnings and other suppliers, or punch in materials by hand. Whatever works for ya",
      tooltipPosition: 'bottom',
    },
  ],

  // ─── Materials List (with items) ───
  materialsListItems: [
    {
      id: 'firstMaterialItem',
      title: "Tap to see the deets",
      description: "Tap any material to expand it — you'll see the **full description, brand, and photo**. Use the buttons to edit, delete, or open the store link",
      tooltipPosition: 'bottom',
    },
    {
      id: 'addMaterialButton',
      title: "Need more gear?",
      description: "Tap here to **add more materials** to the list — search the catalogue or punch 'em in by hand",
      tooltipPosition: 'top',
    },
  ],

  // ─── Add Material ───
  addMaterial: [
    {
      id: 'savedItemsTab',
      title: "Save time on repeat jobs",
      description: "Tap **Saved Items** to reuse materials from past quotes — no more searching for the same stuff every time. Absolute game changer for regulars",
      tooltipPosition: 'bottom',
    },
  ],

  // ─── Labor & Markup ───
  laborMarkup: [
    {
      id: 'travelSection',
      title: "Petrol ain't free, mate",
      description: "We've sussed out **how far the job is** and worked out the fuel. Bump it up for Woop Woop jobs, or ditch it if they're just down the road",
      tooltipPosition: 'bottom',
    },
    {
      id: 'laborSection',
      title: "Pay yourself proper",
      description: "Hours times your rate — simple as. **If in doubt, round up.** You're a tradie, not a volunteer",
      tooltipPosition: 'bottom',
    },
    {
      id: 'markupSection',
      title: "Your margin, your rules",
      description: "This covers the stuff no one sees — risk, know-how, and that new ute fund. **15-25% is standard**, but you do you",
      tooltipPosition: 'bottom',
    },
  ],

  // ─── Quote Preview ───
  quotePreview: [
    {
      id: 'editSections',
      title: "She'll be right... or will she?",
      description: "Give it a once-over. Spot a booboo? Tap the **edit button** on any section to duck back and fix it — no starting from scratch",
      tooltipPosition: 'bottom',
    },
    {
      id: 'sendButton',
      title: "Send it, ya legend!",
      description: "Smashes out a **ripper PDF** and sends it straight to the customer's inbox. Professional as, and took you about 3 minutes. Too easy",
      tooltipPosition: 'top',
    },
  ],
};
