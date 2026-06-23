import json, sys
s = sys.argv[1]
try:
    q = json.load(open(f'out/{s}.quote.json'))
    m = q['materials']; n = len(m)
    unp = sum(1 for x in m if x.get('price', 0) <= 0)
    mx = max((round(x.get('price', 0) * x.get('quantity', 0), 2) for x in m), default=0)
    t = q['total']
    status = 'CLEAN' if (unp == 0 and 150 <= t <= 25000 and mx <= 4000) else 'review'
    print(f'{s},{t},{n},{unp},{mx},{status}')
except Exception:
    print(f'{s},,,,,parsefail')
