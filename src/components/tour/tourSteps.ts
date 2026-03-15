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
export const INTRO_TOUR_TOTAL_STEPS = TOUR_STEPS.length + 8; // + jobDetails steps (including photo annotation)

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
  | 'materialsListAdded'
  | 'laborMarkup'
  | 'quotePreview'
  | 'dashboardComplete';

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
      id: 'jobPhotoThumbnail',
      title: "Show 'em what needs doing",
      description: "Snap photos of the job site — **they'll show up on your quote**. Tap any photo to **draw on it** — circle the dodgy bits, add arrows, write notes. Watch this...",
      tooltipPosition: 'top',
    },
    {
      id: 'annotatorCanvas',
      title: "Here's your canvas, Picasso",
      description: "This is where the magic happens — **draw right on the photo** to highlight what needs fixing. We've already chucked on a circle and arrow to show ya how it's done",
      tooltipPosition: 'bottom',
    },
    {
      id: 'annotatorTools',
      title: "Pick your weapon",
      description: "**Draw freehand, add arrows, circles, or text labels.** Tap a tool to switch it up, tap again for colour and thickness options. Go nuts",
      tooltipPosition: 'top',
    },
    {
      id: 'annotatorDone',
      title: "Hit Done when you're happy",
      description: "Tap **Done** to save your annotations onto the photo. They'll show up right on your quote — looking proper mint and dead professional",
      tooltipPosition: 'bottom',
    },
    {
      id: 'jobPhotoAnnotated',
      title: "Now THAT'S professional!",
      description: "Circled the busted hinge, arrowed the soggy frame — your customer gets it instantly. **Annotated photos show up on the quote** so everyone's on the same page",
      tooltipPosition: 'top',
    },
  ],

  // ─── Customer Details ───
  customerDetails: [
    {
      id: 'recentCustomers',
      title: "Your regulars, one tap away",
      description: "Quoted someone before? They'll pop up here as a **recent customer**. Tap one and we'll auto-fill the lot — name, email, phone, address. Give Davo a tap!",
      tooltipPosition: 'bottom',
    },
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
      title: "Strewth, look at that!",
      description: "The AI's sussed out everything you need for the job — **materials, quantities, the lot**. Use the **plus/minus buttons** to tweak quantities, or hit the **bin** to chuck something out",
      tooltipPosition: 'bottom',
    },
    {
      id: 'fetchPricesButton',
      title: "Time to get some real prices, legend",
      description: "Smash this button and we'll **hunt down real prices** from Bunnings, Reece, and other suppliers. If we can't track one down, she'll cop a **best-guess estimate** so you're not left hanging",
      tooltipPosition: 'top',
    },
    {
      id: 'firstMaterialItem',
      title: "Now we're cooking with gas!",
      description: "Prices are in! **Tap any material** to see the full description, brand, photo, and store link. The AI matched each item to a real product — proper mint",
      tooltipPosition: 'bottom',
    },
    {
      id: 'addMaterialButton',
      title: "Need more gear?",
      description: "Tap here to **add more materials** to the list — search the catalogue or punch 'em in by hand. She'll be right",
      tooltipPosition: 'top',
    },
  ],

  // ─── Add Material ───
  addMaterial: [
    {
      id: 'searchSection',
      title: "Hunt down the real deal",
      description: "Type in what you need and we'll **search Bunnings, Reece, and other suppliers** for the actual product with real pricing. Beats guessing every time",
      tooltipPosition: 'bottom',
    },
    {
      id: 'manualEntrySection',
      title: "Know exactly what you need?",
      description: "Punch in the **name, quantity, and price** yourself if you've already sussed it out. Handy for oddball items the catalogues don't stock",
      tooltipPosition: 'bottom',
    },
    {
      id: 'savedItemsTab',
      title: "Save time on repeat jobs",
      description: "Tap **Saved Items** to reuse materials from past quotes — no more searching for the same stuff every time. Absolute game changer for regulars",
      tooltipPosition: 'bottom',
    },
  ],

  // ─── Materials List (after adding a material) ───
  materialsListAdded: [
    {
      id: 'firstMaterialItem',
      title: "Chucked it in, no worries!",
      description: "Your new material's right there with the rest of the gear. **Tap any item** to see the full deets, edit, or bin it if you changed your mind",
      tooltipPosition: 'bottom',
    },
  ],

  // ─── Labor & Markup ───
  laborMarkup: [
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
    {
      id: 'travelSection',
      title: "Petrol ain't free, mate",
      description: "We've sussed out **how far the job is** and worked out the fuel. Use the **plus and minus** to dial it in, or hit **Dismiss** if they're just down the road. No judgement, ya tight-arse",
      tooltipPosition: 'top',
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
      description: "Tap here to **email, text, or share** Davo's quote. Whacks out a ripper PDF and fires it off — professional as. Go on, **send a test to yourself** to see what the customer gets!",
      tooltipPosition: 'top',
    },
  ],

  // ─── Dashboard (after tour completes) ───
  dashboardComplete: [
    {
      id: 'recentQuoteCard',
      title: "There's Davo's quote!",
      description: "Every quote you create lands right here. Tap the **three dots** to edit, send, duplicate, or convert to an invoice. **Swipe left to delete** it when you're done having a squiz",
      tooltipPosition: 'bottom',
    },
    {
      id: 'recentQuoteCard',
      title: "You're a QuoteMate pro now!",
      description: "That's the lot, legend! Go on — **delete Davo's practice quote** with a swipe or the three dots, then crack on with a real one. You've got this!",
      tooltipPosition: 'bottom',
    },
  ],
};
