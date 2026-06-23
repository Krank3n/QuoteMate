import json, sys
# Make the first chat (ask) bubble silent so the Veo presenter speaks the opening
# line (presenter-mode), without re-running the driver (preserves the priced quote).
s = sys.argv[1]
p = f'out/{s}.demo.json'
d = json.load(open(p))
for ev in d.get('events', []):
    if ev.get('kind') == 'user':
        ev.pop('vo', None)
        ev['holdMs'] = 1600
        break
json.dump(d, open(p, 'w'), indent=2)
print('patched', s)
