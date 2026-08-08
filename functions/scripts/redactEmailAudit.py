#!/usr/bin/env python3
"""
Redact PII from emailLog audit snapshots before they are committed to the
public repo. Metrics, type keys and non-personal subject copy are preserved
verbatim; recipient addresses and person/business names are pseudonymised.

Pseudonyms are assigned from the UNION of all input files so the same person
keeps the same handle across baselines and snapshots stay comparable.
"""
import re
import sys

KEEP = {'tom@hansendev.com.au', 'thomas.andrew.hansen@gmail.com'}
FREEMAIL = {'gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com',
            'yahoo.com.au', 'bigpond.com', 'bigpond.net.au', 'live.com', 'me.com',
            'optusnet.com.au', 'iinet.net.au', 'outlook.com.au', 'msn.com', 'aol.com'}
EMAIL_RE = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')


def domain_class(addr):
    d = addr.rsplit('@', 1)[1].lower()
    if d == 'privaterelay.appleid.com':
        return '[apple-relay]'
    if d in ('example.com', 'example.org', 'example.net', 'test.com'):
        return '[test-domain]'
    if d in FREEMAIL:
        return '[freemail]'
    return '[business-domain]'


def build_map(texts):
    seen = set()
    for t in texts:
        seen.update(a.lower() for a in EMAIL_RE.findall(t))
    m = {}
    for i, a in enumerate(sorted(seen - {k.lower() for k in KEEP}), start=1):
        m[a] = 'user%02d@%s' % (i, domain_class(a))
    return m


def mask_emails(s, m):
    return EMAIL_RE.sub(lambda x: x.group(0) if x.group(0).lower() in {k.lower() for k in KEEP}
                        else m.get(x.group(0).lower(), '[email]'), s)


# (pattern, replacement) applied to subject sample text only.
SUBJECT_RULES = [
    (r'^(.+?), your next quote is waiting$', r'[business], your next quote is waiting'),
    (r'^(.+?), you have (\d+) unsent quotes \(.*\)$', r'[business], you have \2 unsent quotes ($[amount])'),
    (r'^(.+?), fancy an (.+)$', r'[business], fancy an \2'),
    (r"^(.+?), how'd your first quote go\?$", r"[name], how'd your first quote go?"),
    (r'^Following up on your quote from (.+)$', r'Following up on your quote from [business]'),
    (r'^(\[TEST\] )?Invoice from (.+?) - (.+)$', r'\1Invoice from [business] - [job]'),
    (r'^(\[TEST\] )?Quotation from (.+?) - (.+)$', r'\1Quotation from [business] - [job]'),
    (r'^(\[TEST\] )?Quotation from (.+)$', r'\1Quotation from [business]'),
    (r'^Quote #(\S+) (accepted by|declined by|sent to) (.+)$', r'Quote #[id] \2 [customer]'),
    (r'^Your quote for (.+?) is ready to send$', r'Your quote for [customer] is ready to send'),
    (r'^Reminder: your quote from (.+?) for (.+)$', r'Reminder: your quote from [business] for [job]'),
    (r'^Receipt from (.+?) — Invoice (.+)$', r'Receipt from [business] — Invoice [id]'),
    (r'^Service report from (.+?) - (.+)$', r'Service report from [business] - [job]'),
    (r'^(\[TEST\] )?Service report (\S+) — (.+)$', r'\1Service report [id] — [customer]'),
    (r'^New Katie lead: (.+)$', r'New Katie lead: [business]'),
    (r"^How'd the quote to (.+?) go\?(.*)$", r"How'd the quote to [customer] go?\2"),
    (r'^QuoteMate enquiry from (.+)$', r'QuoteMate enquiry from [name]'),
    (r'^Welcome to QuoteMate, (.+)!$', r'Welcome to QuoteMate, [name]!'),
    (r'^(💰 New Pro subscriber: )(.+?)( \(.*)$', r'\1[email]\3'),
]

# Types whose subject line is free-text personalised to a scraped prospect —
# no rule can safely parse a name out, so the whole subject is replaced.
BLANKET_TYPES = ('lead_outreach', 'callkatie')


def redact_subject(text, current_type, m):
    if current_type and current_type.split('/')[0] in BLANKET_TYPES:
        return '[personalised subject redacted]'
    text = mask_emails(text, m)
    for pat, rep in SUBJECT_RULES:
        new = re.sub(pat, rep, text)
        if new != text:
            return new
    return text


def redact(src, m):
    out, current_type = [], None
    for line in src.split('\n'):
        # type header: flush-left, not a banner
        if line and not line.startswith(' ') and not line.startswith('='):
            current_type = line.strip()
            out.append(line)
            continue
        sub = re.match(r'^(    \d+× )(.*)$', line)
        if sub:
            out.append(sub.group(1) + redact_subject(sub.group(2), current_type, m))
            continue
        recip = re.match(r'^(  \d+× )(.*)$', line)
        if recip:
            out.append(recip.group(1) + mask_emails(recip.group(2), m))
            continue
        out.append(mask_emails(line, m))
    return '\n'.join(out)


if __name__ == '__main__':
    paths = sys.argv[1:]
    texts = [open(p, encoding='utf-8').read() for p in paths]
    m = build_map(texts)
    for p, t in zip(paths, texts):
        open(p + '.redacted', 'w', encoding='utf-8').write(redact(t, m))
        print('wrote %s.redacted' % p)
    print('%d addresses pseudonymised (%d kept as the owner\'s own)' % (len(m), len(KEEP)))
