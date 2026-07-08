/**
 * Send-time material-edit telemetry — the ground-truth counterpart to the
 * replay audit. The app stamps each pipeline-priced row with an `asPriced`
 * snapshot; when the quote is actually sent, any difference between the sent
 * row and its snapshot is a tradie correction, i.e. a confirmed pipeline
 * miss. Sends with zero edits are logged too — they're the success signal
 * that makes a miss *rate* computable.
 *
 * Known limitation: deleted rows can't be detected (a removed material simply
 * isn't on the quote any more). Detecting those needs a quote-level snapshot
 * of pipeline row ids — not worth the write amplification yet.
 */

export interface SentMaterialLike {
  name?: string;
  quantity?: number;
  price?: number;
  origin?: string;
  manualPriceOverride?: boolean;
  asPriced?: {
    price?: number;
    quantity?: number;
    name?: string;
    pricingSource?: string;
    priceConfidence?: string;
  };
}

export interface MaterialEdit {
  name: string;
  field: 'price' | 'quantity' | 'name';
  from: string | number;
  to: string | number;
  pricingSource?: string;
  priceConfidence?: string;
}

export interface MaterialEditSummary {
  /** Rows the pipeline priced (carried an asPriced snapshot). */
  pipelineRows: number;
  /** Pipeline rows the tradie changed before sending. */
  editedRows: number;
  /** Rows the tradie added by hand (no snapshot, origin manual / hand-priced). */
  addedRows: number;
  edits: MaterialEdit[];
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Diff sent materials against their asPriced snapshots. Returns null when no
 * row carries a snapshot (quote priced before the app shipped stamping, or
 * never machine-priced) — there is no baseline, so nothing to learn.
 */
export function summarizeMaterialEdits(materials: SentMaterialLike[]): MaterialEditSummary | null {
  const rows = Array.isArray(materials) ? materials : [];
  const withSnapshot = rows.filter((m) => m.asPriced && typeof m.asPriced.price === 'number');
  if (withSnapshot.length === 0) return null;

  const edits: MaterialEdit[] = [];
  let editedRows = 0;
  for (const m of withSnapshot) {
    const snap = m.asPriced!;
    const rowEdits: MaterialEdit[] = [];
    if (typeof m.price === 'number' && typeof snap.price === 'number' && !near(m.price, snap.price)) {
      rowEdits.push({
        name: m.name || snap.name || '(unnamed)', field: 'price', from: snap.price, to: m.price,
        pricingSource: snap.pricingSource, priceConfidence: snap.priceConfidence,
      });
    }
    if (typeof m.quantity === 'number' && typeof snap.quantity === 'number' && m.quantity !== snap.quantity) {
      rowEdits.push({
        name: m.name || snap.name || '(unnamed)', field: 'quantity', from: snap.quantity, to: m.quantity,
        pricingSource: snap.pricingSource, priceConfidence: snap.priceConfidence,
      });
    }
    if (m.name && snap.name && m.name.trim() !== snap.name.trim()) {
      rowEdits.push({
        name: snap.name, field: 'name', from: snap.name, to: m.name,
        pricingSource: snap.pricingSource, priceConfidence: snap.priceConfidence,
      });
    }
    if (rowEdits.length > 0) {
      editedRows++;
      edits.push(...rowEdits);
    }
  }

  const addedRows = rows.filter((m) => !m.asPriced && (m.origin === 'manual' || m.manualPriceOverride)).length;

  return {
    pipelineRows: withSnapshot.length,
    editedRows,
    addedRows,
    edits: edits.slice(0, 50),
  };
}
