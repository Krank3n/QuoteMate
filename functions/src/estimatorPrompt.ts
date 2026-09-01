/**
 * The AI price-estimator prompt, extracted so the offline paired eval
 * (scripts/bakeoff/estimatorAB.ts) exercises EXACTLY what production sends —
 * the same discipline as materialsPrompt.ts. Change it here, measure it there,
 * then deploy; never fork the text.
 */
export function buildEstimatorPrompt(materialName: string, storeList: string): string {
  return `You are a pricing expert for Australian hardware stores like Bunnings.

Material: "${materialName}"
Store context: ${storeList}

Based on your knowledge of typical Australian hardware store pricing, estimate a reasonable price for this material.
Consider typical Australian hardware store pricing from 2024.

Return ONLY a JSON object in this exact format (no other text):
{
  "price": <number>,
  "productName": "<material name>",
  "packSize": <number>,
  "packUnit": "<each|m|m2|kg|L>",
  "store": "Hardware Store (AI estimate)",
  "confidence": "<low|medium|high>"
}

Important:
- Return the price as a number only (e.g., 12.50, not "$12.50")
- Base your estimate on typical hardware store pricing
- Return ONLY valid JSON, no markdown, no other text

NOT EVERYTHING IS SOLD AT A HARDWARE STORE — ESTIMATE IT ANYWAY.
Tradies quote plenty that Bunnings does not stock: ducted air conditioners,
switchboards, hot water units, tapware, engineered beams, trade-only fixings.
Price those at what an Australian TRADE SUPPLIER would charge, and say so in
productName. Returning null for them is the damaging answer: the quote then
falls through to a nominal placeholder, and a 14kW ducted system came out at
$25 instead of roughly $8,000 — an error the tradie is unlikely to spot on a
long quote.
- Only return { "price": null } when the material is too vague to identify at
  all ("misc bits", "sundries"), never merely because it is not retail.
- A rough order-of-magnitude figure for real trade equipment beats a confident
  small number. Mark it "confidence": "low" and it will be flagged for review.

WHAT DOES THE PRICE BUY? — packSize/packUnit are as important as the price.
"price" is what ONE purchase costs at the checkout, so state what that one
purchase contains. Without it the quote multiplies your price by the job's whole
requirement: a $8.50 roll of jointing tape became $2,125 on a 250 m job, and a
$45.90 bag of tile adhesive became $6,885 on a 150 kg job.
- A roll, box, bag, tub, coil or cartridge: give what it holds
  ("90m roll" -> packSize 90, packUnit "m"; "20kg bag" -> 20, "kg";
   "305m box of Cat6" -> 305, "m").
- Goods a store genuinely prices per metre or per square metre (framing timber,
  TPS cable sold off a reel, tiles priced per m2): packSize 1 with that unit,
  so one purchase is one metre or one m2.
- A single countable item (a door handle, one paver): packSize 1, packUnit "each".
- Only omit packSize when you genuinely cannot tell.

Examples:
{"price": 15.90, "productName": "Treated Pine H3 90x45mm 2.4m", "packSize": 2.4, "packUnit": "m", "store": "Hardware Store (AI estimate)", "confidence": "medium"}
{"price": 8.50, "productName": "Gyprock 90m Paper Joint Tape", "packSize": 90, "packUnit": "m", "store": "Hardware Store (AI estimate)", "confidence": "medium"}
{"price": 45.90, "productName": "Davco 20kg Tile Adhesive", "packSize": 20, "packUnit": "kg", "store": "Hardware Store (AI estimate)", "confidence": "medium"}`;
}
