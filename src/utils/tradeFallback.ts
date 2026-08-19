/**
 * Non-retail routing + deterministic trade price table — single source of
 * truth shared by the production pipeline (materialsPipeline) and the replay
 * audit, which previously carried a hand-synced copy each.
 *
 * isNonRetailTradeRow decides that a row must NEVER hit retail supplier
 * search: services, allowances, hire, disposal, bulk supply (ready-mix
 * concrete), fuel, custom fabrication. The audit's flagship failure: a 20m³
 * ready-mix row fell through to retail and matched a "concrete umbrella
 * base". Routing here means the row gets a visible trade estimate, a
 * general-knowledge estimate, or an explicit needs-your-price flag — but
 * never a keyword-adjacent retail SKU.
 *
 * tradeFallbackUnitPrice is the last-resort visible estimate table. Real
 * supplier/saved/API prices always win. Values are deliberately conservative
 * AU retail-ish unit prices so the quote total is not silently $0.
 */

export function isNonRetailTradeRow(nameText: string, unit?: string, qty?: number): boolean {
  const name = nameText.toLowerCase();
  const quantity = qty ?? 0;
  if (/rinnai\s*b26|continuous\s+flow\s+gas\s+hot\s+water|gas\s+hot\s+water\s+heater|gas\s+compliance\s+certificate|compliance\s+certificate|stump\s+grinder\s+(?:replacement\s+)?teeth|grinder\s+teeth|material\s+delivery|delivery\s+fee/.test(name)) return true;
  if (/colorbond\s+fence\s+(?:sheet|panel|rail)|fence\s+(?:sheet|panel|rail).*colorbond/.test(name)) return true;
  if (/\b(?:rhs|shs)\b|rectangular\s+hollow|square\s+hollow|steel\s+base\s+plate|base\s+plate/.test(name)) return true;
  // Reinforcing steel comes off a steel merchant's rack, not a hardware shelf.
  // Bunnings stocks none of it, so the scraper returns whatever is lexically
  // nearby and stamps it high confidence: "N12 starter bar 600mm dowel"
  // matched a chrome towel bar at $85 and shipped 30 of them on QU-178711.
  // Deliberately NOT routed away: trench mesh and bar chairs, which Bunnings
  // genuinely stocks and prices correctly.
  if (/\bn(?:12|16|20|24|28|32|36)\b.*\b(?:bar|rod|dowel|reo|starter)\b|\b(?:starter|dowel|deformed|reinforcing|reo)\s+bars?\b(?!\s*chairs?)|\brebar\b/.test(name)) return true;
  if (/\bsl\s?(?:52|62|72|82|92|102)\b|\b(?:reo|slab|reinforcing)\s+mesh\b|\bmesh\s+sheets?\b/.test(name) && !/trench/.test(name)) return true;
  if (/formwork\s+(?:pegs?|pins?|stakes?)|\bform\s+pegs?\b/.test(name)) return true;
  if (/plasterboard|villaboard|fibre\s+cement\s+sheet|fiber\s+cement\s+sheet|cement\s+sheet|cladding\s+sheets?|external\s+cladding|floor\s+tiles?|wall\s+tiles?|\bgrout\b|basin\s+mixer|mixer\s+tap|plumber'?s?\s+putty|plumbing\s+putty|debris\s+netting|safety\s+debris/.test(name)) return true;
  if (/road\s+base|crusher\s+dust|aggregate\s+base/.test(name)) return true;
  if (/green\s+waste|tip\s*fee|tipping|dumping|disposal|hook\s*bin|soil\s+disposal|spoil\s+disposal|dirt\s+disposal|heavy\s+waste/.test(name)) return true;
  if (/vehicle\s+(?:running\s+)?(?:costs?|fuel)|travel\s+fuel/.test(name)) return true;
  if (/\b(?:diesel|petrol|unleaded|machine\s+fuel)\b/.test(name)) return true;
  if (/2[-\s]?stroke.*(?:fuel|mix)|chainsaw\s+fuel|fuel\s+mix|2[-\s]?stroke\s+(?:engine\s+)?oil/.test(name)) return true;
  if (/airless\s+sprayer\s+cleanup|sprayer\s+cleanup|pump\s+armor|pump\s+protector/.test(name)) return true;
  if (/concrete\s+pump|pump\s+hire|skip|\bhire\b/.test(name)) return true;
  // Concrete slabs/driveways/paths in m³ are supplied by a ready-mix truck or
  // mini-mix supplier. Never convert these to hundreds of retail 20kg bags.
  if ((/exposed\s+aggregate\s+concrete|ready[-\s]?mix\s+concrete|concrete\s+for\s+slab|slab\s+concrete|\b\d{2}\s*mpa\b.*concrete|concrete.*\b\d{2}\s*mpa\b/.test(name)) && (unit === 'm³' || quantity >= 0.5)) return true;
  // Services, call-outs and labour-only rows — a licensed plumber is not a
  // retail SKU ("Licensed Plumber Services" once priced as a $14.90 PVC trap).
  if (/\b(?:licensed|qualified)\s+(?:plumber|electrician|gas\s*fitter|sparky)\b|\b(?:plumbing|electrical|plumber|electrician)\s+services?\b|\bcall[-\s]?out\s+fee\b|\blabou?r\s+only\b|\bservice\s+fee\b/.test(name)) return true;
  // Allowances are budget lines, not products ("Fuel Allowance" matched BBQ charcoal).
  if (/\ballowances?\b/.test(name)) return true;
  // Custom fabrication/joinery packages are quoted by a fabricator, not shelved.
  if (/\bcustom\b.*\b(?:package|cabinetry|joinery|fabrication|benchtops?)\b/.test(name)) return true;
  // Welding/industrial gas bottles are BOC/supplier swap items, not hardware SKUs.
  if (/\bwelding\s+gas\b|\bargon\b|\bacetylene\b|\bgas\s+bottle\b|\bgas\s+(?:swap|refill)\b/.test(name)) return true;
  return false;
}

export function tradeFallbackUnitPrice(nameText: string, unit?: string): number | null {
  const name = nameText.toLowerCase();
  if (/screws?|nails?|brads?|staples?/.test(name)) return unit === 'each' ? 0.08 : 18;
  if (/(?:wire|lever)\s+connectors?|wago\s+connectors?/.test(name)) return unit === 'each' ? 0.5 : 25;
  if (/exposed\s+aggregate\s+concrete|ready[-\s]?mix\s+concrete|concrete\s+for\s+slab|slab\s+concrete|\b\d{2}\s*mpa\b.*concrete|concrete.*\b\d{2}\s*mpa\b/.test(name)) return unit === 'm³' ? 300 : unit === 'kg' ? 0.15 : 12;
  if (/rinnai\s*b26|continuous\s+flow\s+gas\s+hot\s+water|gas\s+hot\s+water\s+heater/.test(name)) return 1350;
  if (/gas\s+compliance\s+certificate|compliance\s+certificate/.test(name)) return 150;
  if (/stump\s+grinder\s+(?:replacement\s+)?teeth|grinder\s+teeth/.test(name)) return 35;
  if (/material\s+delivery|delivery\s+fee/.test(name)) return 150;
  if (/colorbond\s+fence\s+(?:sheet|panel)|fence\s+(?:sheet|panel).*colorbond/.test(name)) return 38;
  if (/colorbond\s+fence\s+rail|fence\s+rail.*colorbond/.test(name)) return 18;
  // Reinforcing steel, priced the way a steel merchant sells it. Bar length
  // decides the unit price, so read it off the row name: a 600mm starter/dowel
  // is a cut piece, anything longer (or unstated) is a full stock length.
  if (/\bn(?:12|16|20|24|28|32|36)\b.*\b(?:bar|rod|dowel|reo|starter)\b|\b(?:starter|dowel|deformed|reinforcing|reo)\s+bars?\b(?!\s*chairs?)|\brebar\b/.test(name)) {
    if (unit === 'm') return 4;
    const mm = name.match(/\b(\d{2,4})\s*mm\b/);
    return mm && parseInt(mm[1], 10) <= 1500 ? 6 : 26;
  }
  if (/\bsl\s?(?:52|62|72|82|92|102)\b|\b(?:reo|slab|reinforcing)\s+mesh\b|\bmesh\s+sheets?\b/.test(name) && !/trench/.test(name)) {
    return unit === 'm²' ? 8 : 105;
  }
  if (/formwork\s+(?:pegs?|pins?|stakes?)|\bform\s+pegs?\b/.test(name)) return 7;
  if (/\b(?:rhs|shs)\b|rectangular\s+hollow|square\s+hollow/.test(name)) return unit === 'm' ? 45 : 180;
  if (/steel\s+base\s+plate|base\s+plate/.test(name)) return 28;
  if (/steel\s+post|galvanised\s+post|galvanized\s+post/.test(name)) return unit === 'm' ? 38 : 90;
  if (/plasterboard|villaboard|fibre\s+cement\s+sheet|fiber\s+cement\s+sheet|cement\s+sheet|cladding\s+sheets?|external\s+cladding/.test(name)) return unit === 'm²' ? 12 : 35;
  if (/floor\s+tiles?|wall\s+tiles?|ceramic\s+tiles?|porcelain\s+tiles?/.test(name) && !/roof/.test(name)) return unit === 'm²' ? 45 : 30;
  if (/\bgrout\b/.test(name)) return unit === 'kg' ? 4 : 55;
  if (/\b(?:pvc|pex)\b.*\bpipe\b|\bpipe\b.*\b(?:pvc|pex)\b|waste\s+pipe|dwv\s+pipe/.test(name)) return unit === 'm' ? 8 : 24;
  if (/basin\s+mixer|mixer\s+tap/.test(name)) return 140;
  if (/plumber'?s?\s+putty|plumbing\s+putty/.test(name)) return 12;
  if (/disposable\s+coveralls?|painters?\s+coveralls?|coveralls?/.test(name)) return 12;
  if (/debris\s+netting|safety\s+debris|shade\s+cloth|safety\s+mesh/.test(name)) return unit === 'm²' ? 2 : 80;
  // Liquids before the decking/merbau family — "merbau decking oil" is a tin,
  // not a $75 board. \boils?\b, not a bare substring ('spOIL disposal').
  if (/\boils?\b|sealer|stain/.test(name)) return unit === 'L' ? 25 : 80;
  if (/decking.*board|deck.*board|hardwood.*decking|merbau|spotted\s+gum/.test(name)) return 75;
  if (/palings?|paling/.test(name)) return 3.5;
  if (/fence\s+rail|75\s*x\s*38.*rail/.test(name)) return unit === 'm' ? 4 : 15;
  if (/90\s*x\s*45|70\s*x\s*35|framing\s+timber|mgp10|mgp12|structural\s+pine|treated\s+pine/.test(name)) return unit === 'm' ? 8 : 15;
  if (/fascia.*board/.test(name)) return 65;
  if (/roof\s+tile|concrete\s+tile/.test(name)) return 7;
  if (/paint|ceiling\s+paint|wall\s+paint/.test(name)) return unit === 'L' ? 18 : 55;
  if (/weed\s+mat|geotextile|landscape\s+fabric/.test(name)) return unit === 'm²' ? 1.5 : 45;
  if (/road\s+base|crusher\s+dust|aggregate\s+base/.test(name)) return unit === 'm³' ? 110 : unit === 'kg' ? 0.08 : 95;
  if (/gravel|aggregate|sand/.test(name)) return unit === 'm³' ? 120 : unit === 'kg' ? 0.12 : 12;
  if (/sliding\s+gate\s+(?:catcher|receiver|stop)|gate\s+(?:catcher|receiver|stop)/.test(name)) return 30;
  if (/sliding\s+gate\s+wheels?|gate\s+wheels?/.test(name)) return 35;
  if (/electrical\s+tape|insulation\s+tape/.test(name)) return 5;
  if (/joist\s+hanger/.test(name)) return 8;
  if (/bracket|multigrip|connector|clip/.test(name)) return 3;
  if (/silicone|sealant|caulk/.test(name)) return 14;
  if (/pointing\s+compound/.test(name)) return unit === 'L' ? 5.5 : 55;
  if (/airless\s+sprayer\s+cleanup|sprayer\s+cleanup|pump\s+armor|pump\s+protector/.test(name)) return unit === 'L' ? 18 : 35;
  if (/2[-\s]?stroke.*(?:fuel|mix)|chainsaw\s+fuel|fuel\s+mix/.test(name)) return unit === 'L' ? 5 : null;
  if (/2[-\s]?stroke\s+(?:engine\s+)?oil/.test(name)) return unit === 'L' ? 18 : 22;
  if (/vehicle\s+(?:running\s+)?(?:costs?|fuel)|travel\s+fuel/.test(name)) return 35;
  if (/\bwelding\s+gas\b|\bargon\b|\bacetylene\b|\bgas\s+bottle\b|\bgas\s+(?:swap|refill)\b/.test(name)) return 120;
  if (/diesel|petrol|fuel|unleaded/.test(name)) return unit === 'L' ? 2.5 : unit === 'each' ? 35 : null;
  if (/concrete\s+pump|pump\s+hire/.test(name)) return 850;
  if (/hook\s*bin|soil\s+disposal|spoil\s+(?:disposal|removal)|dirt\s+disposal|heavy\s+waste/.test(name)) return unit === 'm³' ? 110 : unit === 'kg' ? 0.18 : 1200;
  if (/skip/.test(name)) return /\b2\s*m(?:³|3|\b)|2m(?:³|3)?/.test(name) ? 300 : unit === 'm³' ? 110 : 650;
  if (/green\s+waste.*(?:disposal|dump|tip)|(?:disposal|dump|tip).*green\s+waste/.test(name)) return unit === 'kg' ? 0.1 : unit === 'm³' ? 60 : 120;
  if (/dump|tipping|disposal/.test(name)) return unit === 'kg' ? 0.25 : 250;
  if (/hire/.test(name)) return 250;
  return null;
}
